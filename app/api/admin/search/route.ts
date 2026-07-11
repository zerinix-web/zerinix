import { requireAdminApi, searchAdminRecords } from "@/app/admin/admin-data";
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
  const query = String(url.searchParams.get("q") || "").trim();

  if (query.length < 2) {
    return noStoreJson({ groups: [] });
  }

  if (query.length > 80) {
    return noStoreJson({ error: "Search query is too long." }, { status: 400 });
  }

  return noStoreJson({ groups: await searchAdminRecords(query) });
}
