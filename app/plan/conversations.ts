import type { SupabaseClient, User } from "@supabase/supabase-js";
import {
  loadUserReport,
  loadUserReportSummaries,
  loadUserWorkspaces,
  type DashboardReport,
  type DashboardWorkspace,
} from "@/app/dashboard/report-utils";

// TASK #69A-25 -- PERFORMANCE FIX. ROOT CAUSE (measured live against
// the real, healthy Supabase project): this used to call
// loadUserReports, which selects EVERY one of the user's reports WITH
// their full `sections` content (the entire report body) and
// `metadata`, purely to find the single most recent completed one --
// a live, isolated measurement of that exact query against a real
// account found it taking ~2.4s alone, by far the single most
// expensive query in this whole function, and one that grows with the
// user's total report count forever. Only ONE report's real content
// is ever actually needed here (see buildInitialReportData in
// Planner.tsx, which reads initialReport.sections to restore the
// report view on reload). Fixed: use the existing, already-established
// loadUserReportSummaries (no `sections`, capped at
// DASHBOARD_RECENT_REPORTS_LIMIT, the same lightweight query
// app/dashboard/page.tsx's own list view already uses) to find the
// most recent completed report's id cheaply, then fetch that ONE
// report's full content with loadUserReport -- never all of them.
const LATEST_REPORT_LOOKUP_ATTEMPTS = 5;

async function findLatestCompletedReportWithContent(
  supabase: SupabaseClient,
  user: User,
  reportSummaries: DashboardReport[]
): Promise<DashboardReport | null> {
  const completedSummaries = reportSummaries
    .filter((report) => report.status.toLowerCase() === "completed")
    .slice(0, LATEST_REPORT_LOOKUP_ATTEMPTS);

  for (const summary of completedSummaries) {
    const fullReport = await loadUserReport(supabase, user, summary.id);

    if (fullReport && fullReport.sections.length > 0) {
      return fullReport;
    }
  }

  return null;
}

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

// TASK #69A-25 -- PERFORMANCE FIX. ROOT CAUSE: each 25-conversation-id
// chunk is an independent query with no ordering dependency on any
// other chunk (results are merged and re-sorted by created_at below
// regardless of arrival order), but this loop ran them one at a time
// with `await` inside a `for` loop -- for any user with more than 25
// conversations, chunk N+1 could not even start until chunk N's full
// Supabase round trip finished, needlessly serializing otherwise-
// concurrent work. Fixed to dispatch every chunk at once via
// Promise.all; a single failed chunk still fails the whole call (same
// behavior as before -- Promise.all rejects on the first error found
// among the results here, same short-circuit-to-error semantics the
// original sequential loop had).
async function loadMessagesForConversations(
  supabase: SupabaseClient,
  userId: string,
  conversationIds: string[]
) {
  const chunkResults = await Promise.all(
    chunkValues(conversationIds, MESSAGE_CONVERSATION_ID_CHUNK_SIZE).map((chunk) =>
      supabase
        .from("ai_messages")
        .select("id,conversation_id,role,content,mode,status,attachments,created_at")
        .eq("user_id", userId)
        .in("conversation_id", chunk)
        .order("created_at", { ascending: true })
    )
  );

  const firstError = chunkResults.find((result) => result.error)?.error;

  if (firstError) {
    return { data: [] as MessageRow[], error: firstError };
  }

  const messages: MessageRow[] = chunkResults.flatMap(
    (result) => (result.data || []) as MessageRow[]
  );

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
  const [conversationsResult, { workspaces }, { reports: reportSummaries }] = await Promise.all([
    supabase
      .from("ai_conversations")
      .select("id,title,created_at,updated_at")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false }),
    loadUserWorkspaces(supabase, user),
    loadUserReportSummaries(supabase, user),
  ]);
  const { data, error } = conversationsResult;

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

  const latestReport = await findLatestCompletedReportWithContent(supabase, user, reportSummaries);

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
