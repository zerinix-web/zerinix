import Planner from "@/components/Planner";
import { createClient } from "@/app/lib/supabase/server";
import { loadPlanConversations } from "./conversations";

export const dynamic = "force-dynamic";

export default async function PlanPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const conversationResult = user
    ? await loadPlanConversations(supabase, user)
    : { conversations: [], error: "" };

  return (
    <Planner
      initialConversations={conversationResult.conversations}
      conversationLoadError={conversationResult.error}
    />
  );
}
