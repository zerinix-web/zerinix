import Planner from "@/components/Planner";
import { createClient } from "@/app/lib/supabase/server";
import { loadUserReport } from "@/app/dashboard/report-utils";
import { loadPlanConversations } from "./conversations";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

type PlanPageProps = {
  searchParams?: Promise<{
    mode?: string;
    new?: string;
    workspaceId?: string;
    reportId?: string;
  }>;
};

function getInitialMode(mode: string | undefined, shouldStartFresh: boolean) {
  if (mode === "market") {
    return "market";
  }

  if (mode === "plan") {
    return "plan";
  }

  return shouldStartFresh ? "plan" : undefined;
}

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
  const shouldStartFresh = params.new === "1" || params.new === "true";
  const regenerationReport = params.reportId
    ? await loadUserReport(supabase, user, params.reportId)
    : null;
  const regenerationMode = regenerationReport
    ? regenerationReport.type === "Market Analysis"
      ? "market"
      : "plan"
    : undefined;
  const initialMode = getInitialMode(regenerationMode || params.mode, shouldStartFresh);
  const regenerationContext =
    regenerationReport
      ? {
          reportId: regenerationReport?.id || "",
          reportTitle: regenerationReport?.title || "Existing report",
          reportType: regenerationReport?.type || (initialMode === "market" ? "Market Analysis" : "Business Plan"),
          workspaceId: regenerationReport?.workspaceId || params.workspaceId || "",
          prompt: regenerationReport?.prompt || "",
        }
      : null;

  return (
    <Planner
      initialConversations={conversationResult.conversations}
      conversationLoadError={conversationResult.error}
      initialWorkspaces={conversationResult.workspaces}
      initialReport={
        shouldStartFresh || regenerationContext ? null : conversationResult.latestReport
      }
      initialMode={initialMode}
      initialWorkspaceId={regenerationContext?.workspaceId || params.workspaceId}
      regenerationContext={regenerationContext}
    />
  );
}
