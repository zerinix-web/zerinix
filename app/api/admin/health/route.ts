import { requireAdminApi, loadSystemStatus } from "@/app/admin/admin-data";
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

  return noStoreJson({
    cached: true,
    status: await loadSystemStatus(),
  });
}
