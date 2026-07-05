import Planner from "@/components/Planner";
import { createClient } from "@/app/lib/supabase/server";
import { loadPlanConversations } from "./conversations";

export const dynamic = "force-dynamic";

export default async function PlanPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const conversations = user
    ? await loadPlanConversations(supabase, user)
    : [];

  return <Planner initialConversations={conversations} />;
}
