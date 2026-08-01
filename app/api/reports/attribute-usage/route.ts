import { NextRequest } from "next/server";
import { createClient } from "@/app/lib/supabase/server";
import { noStoreJson } from "@/app/lib/security/api-response";
import { logServerError } from "@/app/lib/security/errors";
import { checkRateLimit, getClientIpFromRequest } from "@/app/lib/security/rate-limit";
import { validateApiRequest } from "@/app/lib/security/request-validation";
import { attributeReportUsageWithServerStorage } from "@/app/admin/report-attribution-storage";

function readBodyString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function analyticsSkipped(reason: string) {
  console.info("[reports:attribute-usage] analytics skipped", { reason });
  return noStoreJson({
    ok: true,
    attributed: false,
    skipped: true,
    reason,
  });
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
    `reports:attribute-usage:${user.id}:${getClientIpFromRequest(request)}`,
    {
      limit: 30,
      windowMs: 10 * 60 * 1000,
    }
  );

  if (!rateLimit.allowed) {
    return noStoreJson({ error: "Too many attribution attempts." }, { status: 429 });
  }

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const reportId = readBodyString(body?.reportId);
  const reportRequestId = readBodyString(body?.reportRequestId);

  if (!reportId || !reportRequestId) {
    return noStoreJson(
      { error: "reportId and reportRequestId are required." },
      { status: 400 }
    );
  }

  try {
    const { data: report, error: reportError } = await supabase
      .from("reports")
      .select("id,user_id")
      .eq("id", reportId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (reportError) {
      logServerError("reports:attribute-usage:ownership", reportError);
      return analyticsSkipped("ownership_check_unavailable");
    }

    if (!report) {
      return noStoreJson({ error: "Report not found." }, { status: 404 });
    }

    const updatePayload = {
      report_id: reportId,
      report_request_id: reportRequestId,
    };

    const { error: attributionError } = await supabase
      .from("ai_usage_events")
      .update(updatePayload)
      .eq("user_id", user.id)
      .eq("report_request_id", reportRequestId);

    if (attributionError) {
      logServerError("reports:attribute-usage:update", attributionError);
      const fallback = await attributeReportUsageWithServerStorage({
        userId: user.id,
        reportId,
        reportRequestId,
      });

      if (fallback.ok) {
        return noStoreJson({ ok: true, attributed: true, skipped: false });
      }

      if (fallback.reason === "service_role_unavailable") {
        return analyticsSkipped("service_role_unavailable");
      }

      return analyticsSkipped("attribution_write_unavailable");
    }

    return noStoreJson({ ok: true, attributed: true, skipped: false });
  } catch (error) {
    logServerError("reports:attribute-usage:unexpected", error);
    return analyticsSkipped("analytics_unavailable");
  }
}
