import OpenAI from "openai";
import { NextResponse } from "next/server";
import { isPrivateBetaAllowed } from "@/app/lib/beta-access";
import { createClient } from "@/app/lib/supabase/server";
import {
  checkRateLimit,
  getClientIpFromRequest,
  getRateLimitHeaders,
} from "@/app/lib/security/rate-limit";
import { logServerError } from "@/app/lib/security/errors";
import {
  estimateAiCostUsd,
  extractTokenUsage,
  recordAiUsage,
} from "@/app/lib/ai/governance";
import { checkAiProductionRateLimit } from "@/app/lib/ai/rate-limit";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

type ChatInputMessage = {
  role: "user" | "assistant";
  content: string;
};

type ChatAttachmentInput = {
  name: string;
  size: number;
  textContent: string;
};

function normalizeMessages(value: unknown): ChatInputMessage[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((message) => {
      if (!message || typeof message !== "object") {
        return null;
      }

      const role = (message as { role?: unknown }).role;
      const content = (message as { content?: unknown }).content;

      if (
        (role !== "user" && role !== "assistant") ||
        typeof content !== "string" ||
        !content.trim()
      ) {
        return null;
      }

      return {
        role,
        content: content.trim().slice(0, 6_000),
      };
    })
    .filter((message): message is ChatInputMessage => Boolean(message))
    .slice(-16);
}

function normalizeAttachments(value: unknown): ChatAttachmentInput[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((attachment) => {
      if (!attachment || typeof attachment !== "object") {
        return null;
      }

      const name = (attachment as { name?: unknown }).name;
      const size = (attachment as { size?: unknown }).size;
      const textContent = (attachment as { textContent?: unknown }).textContent;

      if (typeof name !== "string" || !name.trim()) {
        return null;
      }

      return {
        name: name.trim().slice(0, 180),
        size: typeof size === "number" && Number.isFinite(size) ? size : 0,
        textContent:
          typeof textContent === "string" ? textContent.trim().slice(0, 12_000) : "",
      };
    })
    .filter((attachment): attachment is ChatAttachmentInput => Boolean(attachment))
    .slice(-6);
}

function buildAttachmentContext(attachments: ChatAttachmentInput[]) {
  if (attachments.length === 0) {
    return "";
  }

  return attachments
    .map((attachment, index) => {
      const fileIntro = `File ${index + 1}: ${attachment.name} (${attachment.size} bytes)`;

      if (!attachment.textContent) {
        return `${fileIntro}\nReadable text was not available for this file.`;
      }

      return `${fileIntro}\n${attachment.textContent}`;
    })
    .join("\n\n---\n\n");
}

export async function POST(req: Request) {
  const startedAt = Date.now();
  const ip = getClientIpFromRequest(req);
  const ipRateLimit = checkRateLimit(`api:chat:ip:${ip}`, {
    limit: 60,
    windowMs: 60_000,
  });

  if (!ipRateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many chat requests. Please wait a moment and try again." },
      { status: 429, headers: getRateLimitHeaders(ipRateLimit) }
    );
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    if (!isPrivateBetaAllowed(user)) {
      return NextResponse.json(
        { error: "Private beta access only." },
        { status: 403 }
      );
    }

    const userRateLimit = checkRateLimit(`api:chat:${user.id}:${ip}`, {
      limit: 45,
      windowMs: 60_000,
    });

    if (!userRateLimit.allowed) {
      return NextResponse.json(
        { error: "Too many chat requests. Please wait a moment and try again." },
        { status: 429, headers: getRateLimitHeaders(userRateLimit) }
      );
    }

    const body = await req.json();
    const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
    const messages = normalizeMessages(body?.messages);
    const attachments = normalizeAttachments(body?.attachments);
    const modelPreference = body?.modelPreference === "balanced" ? "balanced" : "fast";
    const conversationId =
      typeof body?.conversationId === "string"
        ? body.conversationId.trim().slice(0, 128)
        : "";

    if (!prompt) {
      return NextResponse.json({ error: "Message is required." }, { status: 400 });
    }

    const productionLimit = await checkAiProductionRateLimit({
      supabase,
      userId: user.id,
      account: user,
      endpoint: "/api/chat",
      requestKind: "simple",
      promptText: prompt,
      reportField: "chat",
      ip,
    });
    const { model: routedModel, planTier, promptHash } = productionLimit;
    const model = modelPreference === "balanced" ? "gpt-5-mini" : routedModel;

    if (!productionLimit.allowed) {
      return NextResponse.json(
        { error: productionLimit.reason },
        { status: 429 }
      );
    }

    const attachmentContext = buildAttachmentContext(attachments);

    const stream = await client.responses.create({
      model,
      instructions: [
        "You are ZERINIX AI, a premium business operating assistant.",
        "Answer naturally and directly. You may help with business, strategy, operations, finance, product, marketing, technology, or general questions.",
        "Use the conversation history for context, but do not fabricate facts.",
        "When attached file text is provided, treat it as user-supplied context. If a file has no readable text, say so briefly when relevant.",
        "If the user asks for a structured investor report, suggest AI Plan or Market Analysis mode instead of generating the full report in Chat mode.",
        "Use concise markdown when it improves readability. Match the user's language.",
      ].join("\n"),
      input: [
        ...messages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
        ...(attachmentContext
          ? [
              {
                role: "user" as const,
                content: `Attached file context:\n\n${attachmentContext}`,
              },
            ]
          : []),
        {
          role: "user" as const,
          content: prompt,
        },
      ],
      max_output_tokens: 1_800,
      stream: true,
    });

    const encoder = new TextEncoder();

    return new Response(
      new ReadableStream({
        async start(controller) {
          let streamedText = "";
          let tokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

          try {
            for await (const event of stream) {
              if (event.type === "response.output_text.delta") {
                streamedText += event.delta;
                controller.enqueue(encoder.encode(event.delta));
              }

              if (event.type === "response.output_text.done" && !streamedText) {
                streamedText = event.text;
                controller.enqueue(encoder.encode(event.text));
              }

              if (event.type === "response.completed") {
                tokenUsage = extractTokenUsage(event.response);
              }
            }

            await recordAiUsage(supabase, {
              userId: user.id,
              endpoint: "/api/chat",
              reportField: "chat",
              promptHash,
              model,
              planTier,
              tokenUsage,
              estimatedCostUsd: estimateAiCostUsd(model, tokenUsage),
              cacheHit: false,
              responseTimeMs: Date.now() - startedAt,
              metadata: {
                quota_event: !productionLimit.quotaAlreadyCharged,
                quota_consumed: !productionLimit.quotaAlreadyCharged,
                usage_kind: "chat_message",
                conversation_id: conversationId || null,
                model_preference: modelPreference,
                attachment_count: attachments.length,
                actual_ai_call: true,
              },
            });

            controller.close();
          } catch (error) {
            logServerError("api:chat:stream", error);

            await recordAiUsage(supabase, {
              userId: user.id,
              endpoint: "/api/chat",
              reportField: "chat",
              promptHash,
              model,
              planTier,
              tokenUsage,
              estimatedCostUsd: 0,
              cacheHit: false,
              status: "failed",
              responseTimeMs: Date.now() - startedAt,
              metadata: {
                quota_event: false,
                quota_consumed: false,
                usage_kind: "chat_message",
                conversation_id: conversationId || null,
                model_preference: modelPreference,
                attachment_count: attachments.length,
                actual_ai_call: true,
              },
            });

            controller.error(error);
          }
        },
      }),
      {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (error) {
    logServerError("api:chat", error);

    return NextResponse.json(
      { error: "Chat response failed. Please try again." },
      { status: 500 }
    );
  }
}
