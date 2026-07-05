import type { SupabaseClient, User } from "@supabase/supabase-js";

type ConversationRow = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  ai_messages?: MessageRow[];
};

type MessageRow = {
  id: string;
  role: "user" | "assistant";
  content: string;
  mode: "plan" | "market" | null;
  status: "streaming" | "complete";
  attachments: Array<{
    id: string;
    name: string;
    size: number;
  }>;
  created_at: string;
};

export async function loadPlanConversations(
  supabase: SupabaseClient,
  user: User
) {
  const { data, error } = await supabase
    .from("ai_conversations")
    .select(
      "id,title,created_at,updated_at,ai_messages(id,role,content,mode,status,attachments,created_at)"
    )
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false })
    .order("created_at", {
      ascending: true,
      referencedTable: "ai_messages",
    });

  if (error) {
    return [];
  }

  return ((data || []) as ConversationRow[]).map((conversation) => ({
    id: conversation.id,
    title: conversation.title,
    createdAt: new Date(conversation.created_at).getTime(),
    updatedAt: new Date(conversation.updated_at).getTime(),
    messages: (conversation.ai_messages || []).map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      mode: message.mode || undefined,
      status: message.status,
      attachments: Array.isArray(message.attachments)
        ? message.attachments
        : [],
      createdAt: new Date(message.created_at).getTime(),
    })),
  }));
}
