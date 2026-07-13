import AIChatWorkspace from "@/components/AIChatWorkspace";
import { createClient } from "@/app/lib/supabase/server";
import { loadPlanConversations } from "@/app/plan/conversations";
import { loadUserReport } from "@/app/dashboard/report-utils";
import { redirect } from "next/navigation";
import { headers } from "next/headers";

export const dynamic = "force-dynamic";

type ChatPageProps = {
  searchParams?: Promise<{
    reportId?: string;
    report?: string;
  }>;
};

function getReportIdFromReferrer(value: string | null) {
  if (!value) {
    return "";
  }

  try {
    const url = new URL(value);
    const match = url.pathname.match(/^\/dashboard\/([^/?#]+)$/);
    return match?.[1] ? decodeURIComponent(match[1]).trim() : "";
  } catch {
    return "";
  }
}

export default async function ChatPage({ searchParams }: ChatPageProps) {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    console.error("[chat auth missing]", userError?.message || "No authenticated user");
    redirect("/login?next=/chat");
  }

  const conversationResult = await loadPlanConversations(supabase, user);
  const params = searchParams ? await searchParams : {};
  const requestHeaders = await headers();
  const reportId =
    (params.reportId || params.report || "").trim() ||
    getReportIdFromReferrer(requestHeaders.get("referer")) ||
    "";
  const report = reportId ? await loadUserReport(supabase, user, reportId) : null;

  return (
    <AIChatWorkspace
      initialConversations={conversationResult.conversations}
      conversationLoadError={conversationResult.error}
      initialReportMemory={
        report
          ? {
              id: report.id,
              title: report.title,
              type: report.type,
            }
          : null
      }
    />
  );
}
