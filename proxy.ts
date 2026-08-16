import type { NextRequest } from "next/server";
import { updateSession } from "@/app/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Excludes requests that can never need a fresh session cookie or an
  // auth-route redirect decision: Next.js's own static/image pipeline
  // (already excluded), and literal static files served from /public --
  // fonts, stylesheets/scripts placed outside the _next/static bundle,
  // and other public assets. Confirmed live: /fonts/Geist-Regular.ttf
  // (fetched client-side for PDF export font embedding) was triggering
  // the full Supabase client-creation + getUser() network round-trip on
  // every request despite having zero auth relevance. Every actual page
  // and API route -- including all protected ones -- is still matched
  // exactly as before; this only widens the existing static-asset
  // carve-out that already excluded images.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|ttf|otf|woff|woff2|eot|css|js|map|json|txt|xml|webmanifest)$).*)",
  ],
};
