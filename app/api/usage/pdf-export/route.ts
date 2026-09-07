import { NextRequest } from "next/server";
import { createClient } from "@/app/lib/supabase/server";
import { noStoreJson } from "@/app/lib/security/api-response";
import { checkRateLimit, getClientIpFromRequest } from "@/app/lib/security/rate-limit";
import { validateApiRequest } from "@/app/lib/security/request-validation";
import {
  checkAIUsagePermission,
  createAiPromptHash,
  getUserPlanTier,
  recordAiUsage,
} from "@/app/lib/ai/governance";
import { isFounderAccount } from "@/app/lib/beta-access";
import { isVerifiedAdminOrOwnerAccount } from "@/app/lib/strategic-report-access";

function readBodyString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 256) : "";
}

export async function POST(request: NextRequest) {
  const requestValidation = validateApiRequest(request, {
    maxBodyBytes: 2048,
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
    `usage:pdf-export:${user.id}:${getClientIpFromRequest(request)}`,
    {
      limit: 30,
      windowMs: 10 * 60 * 1000,
    }
  );

  if (!rateLimit.allowed) {
    return noStoreJson({ error: "Too many PDF export attempts." }, { status: 429 });
  }

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const reportId = readBodyString(body?.reportId);
  const reportTitle = readBodyString(body?.reportTitle);

  if (reportId) {
    const { data: report, error } = await supabase
      .from("reports")
      .select("id")
      .eq("id", reportId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) {
      return noStoreJson({ error: "Report could not be verified." }, { status: 500 });
    }

    if (!report) {
      return noStoreJson({ error: "Report not found." }, { status: 404 });
    }
  }

  const planTier = await getUserPlanTier(supabase, user.id);
  // TASK #69A-16B -- ROOT CAUSE: this endpoint was the ONLY AI-usage
  // quota check with no admin/owner (or founder) exemption at all --
  // checkAiProductionRateLimit (app/lib/ai/rate-limit.ts) already exempts
  // founder accounts from the report/chat/market quotas it gates
  // ("founder account quota bypass"), but PDF export calls
  // checkAIUsagePermission directly and never consulted that or any
  // other exemption, so even the canonical admin/owner account was
  // treated as an ordinary quota-limited user. Resolved entirely
  // server-side from the already-authenticated `user` (Supabase's own
  // auth.getUser() result, never client-supplied): isFounderAccount
  // reuses the EXACT mechanism already granted quota-bypass authority
  // elsewhere; isVerifiedAdminOrOwnerAccount reuses the EXACT canonical
  // admin/owner resolution (verified JWT claim, then the service-role
  // admin_roles table lookup) authorizeStrategicReportAccess already
  // uses to gate Strategic Report access -- no new admin system, no
  // hardcoded email, nothing client-controllable. Normal users are
  // completely unaffected: this only ever WIDENS the allowed set, never
  // narrows it, and checkAIUsagePermission/recordAiUsage below are
  // otherwise byte-unchanged.
  const isUsageLimitExemptAccount =
    isFounderAccount(user) || (await isVerifiedAdminOrOwnerAccount(user));
  const permission = await checkAIUsagePermission({
    supabase,
    userId: user.id,
    operationType: "pdf_export",
    planTier,
  });
  const promptHash = createAiPromptHash(`pdf_export:${reportId || reportTitle || user.id}`);

  if (!permission.allowed && !isUsageLimitExemptAccount) {
    await recordAiUsage(supabase, {
      userId: user.id,
      endpoint: "/api/usage/pdf-export",
      operationType: "pdf_export",
      reportId: reportId || null,
      promptHash,
      model: "pdf-export",
      planTier,
      tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      estimatedCostUsd: 0,
      cacheHit: false,
      status: "rate_limited",
      responseTimeMs: 0,
      metadata: {
        quota_event: false,
        quota_mode: "pdf_export",
        quota_consumed: false,
        usage_kind: "pdf_export_limit",
        reason: permission.reason || "Monthly PDF export limit reached.",
        remainingUsage: permission.remainingUsage,
        report_title_present: Boolean(reportTitle),
      },
    });

    return noStoreJson(
      {
        error: permission.reason || "Monthly PDF export limit reached.\nUpgrade your plan to continue.",
        remainingUsage: permission.remainingUsage,
      },
      { status: 429 }
    );
  }

  await recordAiUsage(supabase, {
    userId: user.id,
    endpoint: "/api/usage/pdf-export",
    operationType: "pdf_export",
    reportId: reportId || null,
    promptHash,
    model: "pdf-export",
    planTier,
    tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    estimatedCostUsd: 0,
    cacheHit: false,
    responseTimeMs: 0,
    metadata: {
      quota_event: true,
      quota_mode: "pdf_export",
      quota_consumed: true,
      usage_kind: "pdf_export",
      remainingUsage: permission.remainingUsage,
      report_title_present: Boolean(reportTitle),
      // TASK #69A-16B -- purely additive audit annotation: true only when
      // this specific export succeeded via the admin/owner/founder
      // exemption despite an exhausted quota (!permission.allowed), never
      // when a normal user succeeded within their real remaining quota.
      quota_exempt: !permission.allowed && isUsageLimitExemptAccount,
    },
  });

  return noStoreJson({
    ok: true,
    remainingUsage: {
      ...permission.remainingUsage,
      pdfExports: Math.max(0, permission.remainingUsage.pdfExports - 1),
    },
  });
}
