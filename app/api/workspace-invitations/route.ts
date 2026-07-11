import { NextRequest } from "next/server";
import { createClient } from "@/app/lib/supabase/server";
import { sendWorkspaceInvitationEmail } from "@/app/lib/integrations/email-events";
import { checkRateLimit, getClientIpFromRequest } from "@/app/lib/security/rate-limit";
import { noStoreJson } from "@/app/lib/security/api-response";
import { validateApiRequest } from "@/app/lib/security/request-validation";

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function POST(request: NextRequest) {
  const requestValidation = validateApiRequest(request, {
    maxBodyBytes: 10_000,
  });

  if (!requestValidation.ok) {
    return noStoreJson(
      { error: requestValidation.message },
      { status: requestValidation.status }
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return noStoreJson({ error: "Authentication required." }, { status: 401 });
  }

  const rateLimit = checkRateLimit(
    `email:workspace-invite:${user.id}:${getClientIpFromRequest(request)}`,
    {
      limit: 6,
      windowMs: 10 * 60 * 1000,
    }
  );

  if (!rateLimit.allowed) {
    return noStoreJson({ error: "Too many invitation attempts." }, { status: 429 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    workspaceId?: string;
    recipientEmail?: string;
  };
  const workspaceId = String(body.workspaceId || "").trim();
  const recipientEmail = String(body.recipientEmail || "").trim().toLowerCase();

  if (!workspaceId || !isValidEmail(recipientEmail)) {
    return noStoreJson({ error: "Invitation request is invalid." }, { status: 400 });
  }

  const { data: workspace, error } = await supabase
    .from("report_workspaces")
    .select("id,name,user_id")
    .eq("id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error || !workspace) {
    return noStoreJson({ error: "Workspace not found." }, { status: 404 });
  }

  const result = await sendWorkspaceInvitationEmail({
    inviterUserId: user.id,
    recipientEmail,
    workspaceId: workspace.id as string,
    workspaceName: workspace.name as string,
    inviterName: user.user_metadata?.full_name || user.email || "ZERINIX user",
  });

  if (!result.ok) {
    return noStoreJson(
      { error: result.message, missing: result.missing || [] },
      { status: result.reason === "not_configured" ? 503 : 400 }
    );
  }

  return noStoreJson({ ok: true });
}
