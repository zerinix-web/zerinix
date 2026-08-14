// Market Intelligence Research V2 -- execution layer.
//
// Deliberately one plain web-search call per task, with a strict JSON
// schema whose fields already are the target evidence shape (see types.ts).
// This replaces the old multi-stage, multi-task, native-citation-merging
// pipeline in domain-research.ts with something small enough to reason
// about end to end: one task in, one grounded evidence list out.
import type OpenAI from "openai";
import type {
  Response as OpenAIResponse,
  ResponseInput,
} from "openai/resources/responses/responses";
import type { ResearchTask } from "../../decision-intelligence/contracts.ts";
import {
  marketEvidenceTypeValues,
  type MarketEvidenceItem,
  type MarketFieldResearchOutcome,
} from "./types.ts";

const MAX_FINDINGS_PER_TASK = 6;

function buildEvidenceJsonSchema(field: string) {
  return {
    type: "json_schema" as const,
    name: "zerinix_market_evidence_v2",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        field: { type: "string", enum: [field] },
        findings: {
          type: "array",
          maxItems: MAX_FINDINGS_PER_TASK,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              claim: { type: "string" },
              value: { type: "string" },
              sourceTitle: { type: "string" },
              sourceUrl: { type: "string" },
              publisher: { type: "string" },
              publishedAt: { type: "string" },
              evidenceType: {
                type: "string",
                enum: [...marketEvidenceTypeValues],
              },
              confidence: {
                type: "number",
                minimum: 0,
                maximum: 100,
                description:
                  "Integer percentage from 0 to 100 (e.g. 80), never a 0-1 fraction.",
              },
            },
            required: [
              "claim",
              "value",
              "sourceTitle",
              "sourceUrl",
              "publisher",
              "publishedAt",
              "evidenceType",
              "confidence",
            ],
          },
        },
      },
      required: ["field", "findings"],
    },
  };
}

function normalizeUrl(value: unknown) {
  if (typeof value !== "string") return "";
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

// Walks the Responses API output for the web_search tool's own citation
// data. Only URLs the search tool itself surfaced are ever treated as
// "verified" -- a URL the model merely typed into a JSON field is not
// evidence of anything by itself (confirmed live: with a strict JSON
// schema response format, the model can and does assert a sourceUrl that
// never appeared in any web_search_call's own result set).
//
// Two distinct shapes both carry real, tool-surfaced URLs and are matched
// here: inline `url_citation` annotations on message text (the shape used
// when the model is free to write prose), and `{type: "url", url}` entries
// inside a `web_search_call`'s `action.sources` list (the shape actually
// returned when the response is constrained to a strict JSON schema, which
// is what every V2 request uses).
function collectCitedUrls(output: unknown): Set<string> {
  const urls = new Set<string>();
  const visit = (node: unknown, depth: number) => {
    if (depth > 12 || node === null || node === undefined) return;
    if (Array.isArray(node)) {
      node.forEach((item) => visit(item, depth + 1));
      return;
    }
    if (typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    if (
      (record.type === "url_citation" || record.type === "url") &&
      typeof record.url === "string"
    ) {
      const normalized = normalizeUrl(record.url);
      if (normalized) urls.add(normalized);
    }
    for (const value of Object.values(record)) visit(value, depth + 1);
  };
  visit(output, 0);
  return urls;
}

function extractOutputText(response: OpenAIResponse): string {
  for (const item of response.output) {
    if (item.type !== "message") continue;
    for (const content of item.content) {
      if (content.type === "output_text") return content.text;
    }
  }
  return "";
}

type RawFinding = {
  claim?: unknown;
  value?: unknown;
  sourceTitle?: unknown;
  sourceUrl?: unknown;
  publisher?: unknown;
  publishedAt?: unknown;
  evidenceType?: unknown;
  confidence?: unknown;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function normalizeFinding(
  raw: RawFinding,
  task: ResearchTask,
  citedUrls: Set<string>
): MarketEvidenceItem | null {
  const claim = typeof raw.claim === "string" ? raw.claim.trim().slice(0, 600) : "";
  const value = typeof raw.value === "string" ? raw.value.trim().slice(0, 300) : "";
  const sourceTitle =
    typeof raw.sourceTitle === "string" ? raw.sourceTitle.trim().slice(0, 200) : "";
  const sourceUrl = normalizeUrl(raw.sourceUrl);
  const publisher =
    typeof raw.publisher === "string" ? raw.publisher.trim().slice(0, 160) : "";
  const publishedAt =
    typeof raw.publishedAt === "string" ? raw.publishedAt.trim().slice(0, 40) : "";
  const evidenceType = marketEvidenceTypeValues.includes(
    raw.evidenceType as (typeof marketEvidenceTypeValues)[number]
  )
    ? (raw.evidenceType as (typeof marketEvidenceTypeValues)[number])
    : "other";
  // The schema documents a 0-100 scale, but a model can still return a
  // 0-1 fraction despite that -- a legitimate 0-100 score of 1 or less is
  // never meaningfully distinct from 0, so treating anything in (0, 1] as
  // a fraction and rescaling it is an unambiguous, deterministic fix
  // rather than a guess.
  const parsedConfidence = Number(raw.confidence) || 0;
  const rawConfidence = clamp(
    parsedConfidence > 0 && parsedConfidence <= 1
      ? parsedConfidence * 100
      : parsedConfidence,
    0,
    100
  );

  // A malformed record (missing the core identifying fields entirely) is
  // dropped, not padded with placeholders -- keeping the evidence list
  // free of anything that isn't a real, addressable claim.
  if (!claim || !value || !sourceTitle || !sourceUrl) return null;

  const verified = citedUrls.has(sourceUrl);
  // Never let an ungrounded, model-only claim carry the same confidence
  // weight as a search-grounded one: this is what keeps the completeness
  // check (completeness.ts) from ever counting a fabricated-looking claim
  // as satisfying a required evidence field.
  const confidence = verified ? Math.max(rawConfidence, 40) : Math.min(rawConfidence, 30);

  return {
    field: task.field,
    claim,
    value,
    sourceTitle,
    sourceUrl,
    publisher,
    publishedAt,
    evidenceType,
    confidence,
    verified,
  };
}

export async function executeMarketResearchTask({
  client,
  model,
  task,
  signal,
}: {
  client: OpenAI;
  model: string;
  task: ResearchTask;
  signal: AbortSignal;
}): Promise<MarketFieldResearchOutcome> {
  const queries = task.queryVariants?.length ? task.queryVariants : [task.query];
  const instructions = `You are a web research provider for ZERINIX Market Intelligence. Search the web for verifiable, citable evidence for exactly one evidence field: "${task.field}". ${task.reason} Run the supplied query variants. Only return findings you can support with a real source found via web search -- never invent a claim, value, publisher, date, or URL. If nothing verifiable is found, return an empty findings array. Return normalized evidence only; never write a report, summary, or recommendation.`;

  try {
    const response = (await client.responses.create(
      {
        model,
        stream: false,
        instructions,
        input: queries.join("\n") as unknown as ResponseInput,
        max_output_tokens: 2_000,
        reasoning: { effort: "low" },
        tools: [{ type: "web_search_preview", search_context_size: "medium" }],
        tool_choice: { type: "web_search_preview" },
        include: ["web_search_call.action.sources"],
        text: {
          verbosity: "low",
          format: buildEvidenceJsonSchema(task.field),
        },
      },
      { signal }
    )) as OpenAIResponse;

    const citedUrls = collectCitedUrls(response.output);
    const outputText = extractOutputText(response);
    let findings: RawFinding[] = [];
    try {
      const parsed = JSON.parse(outputText || "{}");
      findings = Array.isArray(parsed?.findings) ? parsed.findings : [];
    } catch {
      findings = [];
    }

    const items = findings
      .map((finding) => normalizeFinding(finding, task, citedUrls))
      .filter((item): item is MarketEvidenceItem => item !== null);
    // "completed_with_evidence" must mean grounded evidence, not merely
    // that the model returned *something* -- an ungrounded-only result is
    // "completed_no_evidence" downstream (completeness.ts, and the report
    // quality gate's requiredResearchCompletion consistency check, both
    // already define "resolved" as "has verified evidence"; this keeps
    // the task status in agreement with that instead of over-reporting).
    const hasVerifiedEvidence = items.some((item) => item.verified);

    return {
      task,
      items,
      status: hasVerifiedEvidence ? "completed_with_evidence" : "completed_no_evidence",
      reason: hasVerifiedEvidence ? "" : "No citable evidence was found for this field.",
    };
  } catch (error) {
    const timedOut = signal.aborted;
    return {
      task,
      items: [],
      status: timedOut ? "timed_out" : "failed",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
