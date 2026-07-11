import { loadAdminNotifications, requireAdminApi, resolveAdminDateRange } from "@/app/admin/admin-data";
import { noStoreJson } from "@/app/lib/security/api-response";
import { validateApiRequest } from "@/app/lib/security/request-validation";

export async function GET(req: Request) {
  const requestValidation = validateApiRequest(req, {
    maxBodyBytes: 0,
  });

  if (!requestValidation.ok) {
    return noStoreJson(
      { error: requestValidation.message },
      { status: requestValidation.status }
    );
  }

  const admin = await requireAdminApi();

  if (!admin.ok) {
    return admin.response;
  }

  const url = new URL(req.url);
  const range = resolveAdminDateRange({
    range: url.searchParams.get("range") || "24h",
    from: url.searchParams.get("from") || undefined,
    to: url.searchParams.get("to") || undefined,
  });

  return noStoreJson({
    notifications: await loadAdminNotifications(range),
  });
}
