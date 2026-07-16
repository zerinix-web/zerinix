import type { NextRequest } from "next/server";
import { updateSession } from "@/app/lib/supabase/proxy";
import {
  autoLocaleCookieName,
  detectLocaleFromAcceptLanguage,
  manualLocaleCookieName,
} from "@/app/lib/i18n/config";

export async function proxy(request: NextRequest) {
  const response = await updateSession(request);

  if (
    !request.cookies.get(manualLocaleCookieName)?.value &&
    !request.cookies.get(autoLocaleCookieName)?.value
  ) {
    response.cookies.set(
      autoLocaleCookieName,
      detectLocaleFromAcceptLanguage(request.headers.get("accept-language")),
      {
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
        sameSite: "lax",
      }
    );
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
