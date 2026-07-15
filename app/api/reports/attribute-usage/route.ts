import { NextRequest } from "next/server";
import { createServiceRoleClient } from "@/app/lib/supabase/admin";
import { createClient } from "@/app/lib/supabase/server";
import { noStoreJson } from "@/app/lib/security/api-response";
import { validateApiRequest } from "@/app/lib/security/request-validation";

function readBodyString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
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

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const reportId = readBodyString(body?.reportId);
  const reportRequestId = readBodyString(body?.reportRequestId);

  if (!reportId || !reportRequestId) {
    return noStoreJson(
      { error: "reportId and reportRequestId are required." },
      { status: 400 }
    );
  }

  const serviceClient = createServiceRoleClient();
  const { data: report, error: reportError } = await serviceClient
    .from("reports")
    .select("id,user_id")
    .eq("id", reportId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (reportError) {
    console.error("[reports:attribute-usage] report ownership query failed", {
      message: reportError.message,
      code: reportError.code,
    });

    return noStoreJson({ error: "Report could not be verified." }, { status: 500 });
  }

  if (!report) {
    return noStoreJson({ error: "Report not found." }, { status: 404 });
  }

  const updatePayload = {
    report_id: reportId,
    report_request_id: reportRequestId,
  };

  const { error: attributionError } = await serviceClient
    .from("ai_usage_events")
    .update(updatePayload)
    .eq("user_id", user.id)
    .eq("report_request_id", reportRequestId);

  if (attributionError) {
    console.error("[reports:attribute-usage] attribution failed", {
      message: attributionError.message,
      code: attributionError.code,
    });

    return noStoreJson({ error: "Report usage could not be attributed." }, { status: 500 });
  }

  return noStoreJson({ ok: true });
}
