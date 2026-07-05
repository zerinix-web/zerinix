import type { SupabaseClient, User } from "@supabase/supabase-js";

type ConversationRow = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
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
    .select("id,title,created_at,updated_at")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false });

  if (error) {
    console.error("[ai_conversations select failed]", error);
    return { conversations: [], error: error.message };
  }

  const conversations = (data || []) as ConversationRow[];
  const conversationIds = conversations.map((conversation) => conversation.id);
  const { data: messages, error: messagesError } = conversationIds.length
    ? await supabase
        .from("ai_messages")
        .select("id,conversation_id,role,content,mode,status,attachments,created_at")
        .eq("user_id", user.id)
        .in("conversation_id", conversationIds)
        .order("created_at", { ascending: true })
    : { data: [], error: null };

  if (messagesError) {
    console.error("[ai_messages select failed]", messagesError);
    return { conversations: [], error: messagesError.message };
  }

  const messagesByConversation = new Map<string, MessageRow[]>();

  ((messages || []) as Array<MessageRow & { conversation_id: string }>).forEach(
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
        mode: message.mode || undefined,
        status: message.status,
        attachments: Array.isArray(message.attachments)
          ? message.attachments
          : [],
        createdAt: new Date(message.created_at).getTime(),
      })),
    })),
    error: "",
  };
}
