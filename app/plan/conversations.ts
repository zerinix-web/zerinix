import type { SupabaseClient, User } from "@supabase/supabase-js";
import {
  loadUserReports,
  loadUserWorkspaces,
  type DashboardReport,
  type DashboardWorkspace,
} from "@/app/dashboard/report-utils";

type ConversationRow = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

type MessageRow = {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  mode: "plan" | "market" | "chat" | null;
  status: "streaming" | "complete" | "failed";
  attachments: Array<{
    id: string;
    name: string;
    size: number;
  }>;
  created_at: string;
};

const MESSAGE_CONVERSATION_ID_CHUNK_SIZE = 25;

function chunkValues<T>(values: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
}

async function loadMessagesForConversations(
  supabase: SupabaseClient,
  userId: string,
  conversationIds: string[]
) {
  const messages: MessageRow[] = [];

  for (const chunk of chunkValues(conversationIds, MESSAGE_CONVERSATION_ID_CHUNK_SIZE)) {
    const { data, error } = await supabase
      .from("ai_messages")
      .select("id,conversation_id,role,content,mode,status,attachments,created_at")
      .eq("user_id", userId)
      .in("conversation_id", chunk)
      .order("created_at", { ascending: true });

    if (error) {
      return { data: [] as MessageRow[], error };
    }

    messages.push(...((data || []) as MessageRow[]));
  }

  messages.sort(
    (left, right) =>
      new Date(left.created_at).getTime() - new Date(right.created_at).getTime()
  );

  return { data: messages, error: null };
}

export async function loadPlanConversations(
  supabase: SupabaseClient,
  user: User
) {
  const { data, error } = await supabase
    .from("ai_conversations")
    .select("id,title,created_at,updated_at")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false });

  if (error) {
    console.error("[ai_conversations select failed]", error);
    return {
      conversations: [],
      error: error.message,
      workspaces: [] as DashboardWorkspace[],
      latestReport: null as DashboardReport | null,
    };
  }

  const conversations = (data || []) as ConversationRow[];
  const conversationIds = conversations.map((conversation) => conversation.id);
  const { data: messages, error: messagesError } = conversationIds.length
    ? await loadMessagesForConversations(supabase, user.id, conversationIds)
    : { data: [] as MessageRow[], error: null };

  if (messagesError) {
    console.error("[ai_messages select failed]", messagesError);
    return {
      conversations: [],
      error: messagesError.message,
      workspaces: [] as DashboardWorkspace[],
      latestReport: null as DashboardReport | null,
    };
  }

  const [{ workspaces }, { reports }] = await Promise.all([
    loadUserWorkspaces(supabase, user),
    loadUserReports(supabase, user),
  ]);
  const latestReport =
    reports.find(
      (report) => report.status.toLowerCase() === "completed" && report.sections.length > 0
    ) || null;

  const messagesByConversation = new Map<string, MessageRow[]>();

  (messages || []).forEach(
    (message) => {
      const existing = messagesByConversation.get(message.conversation_id) || [];
      existing.push(message);
      messagesByConversation.set(message.conversation_id, existing);
    }
  );

  return {
    conversations: conversations.map((conversation) => ({
      id: conversation.id,
      title: conversation.title,
      createdAt: new Date(conversation.created_at).getTime(),
      updatedAt: new Date(conversation.updated_at).getTime(),
      messages: (messagesByConversation.get(conversation.id) || []).map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        mode: message.mode || "chat",
        status: message.status,
        attachments: Array.isArray(message.attachments)
          ? message.attachments
          : [],
        createdAt: new Date(message.created_at).getTime(),
      })),
    })),
    error: "",
    workspaces,
    latestReport,
  };
}
