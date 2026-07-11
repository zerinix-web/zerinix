import { NextResponse } from "next/server";
import { requireAdminApi, loadSystemStatus } from "@/app/admin/admin-data";
import { validateApiRequest } from "@/app/lib/security/request-validation";

export async function GET(req: Request) {
  const requestValidation = validateApiRequest(req, {
    maxBodyBytes: 0,
  });

  if (!requestValidation.ok) {
    return NextResponse.json(
      { error: requestValidation.message },
      { status: requestValidation.status }
    );
  }

  const admin = await requireAdminApi();

  if (!admin.ok) {
    return admin.response;
  }

  return NextResponse.json({
    cached: true,
    status: await loadSystemStatus(),
  });
}
