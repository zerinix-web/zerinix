import Planner from "@/components/Planner";
import { createClient } from "@/app/lib/supabase/server";
import { loadPlanConversations } from "./conversations";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

type PlanPageProps = {
  searchParams?: Promise<{
    workspaceId?: string;
  }>;
};

export default async function PlanPage({ searchParams }: PlanPageProps) {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    console.error("[plan auth missing]", userError?.message || "No authenticated user");
    redirect("/login?next=/plan");
  }

  const conversationResult = await loadPlanConversations(supabase, user);
  const params = searchParams ? await searchParams : {};

  return (
    <Planner
      initialConversations={conversationResult.conversations}
      conversationLoadError={conversationResult.error}
      initialWorkspaces={conversationResult.workspaces}
      initialReport={conversationResult.latestReport}
      initialWorkspaceId={params.workspaceId}
    />
  );
}
