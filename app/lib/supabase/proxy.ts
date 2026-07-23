import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getAuthRouteRedirectPath } from "@/app/auth/route-access";
import { requireSupabaseConfig } from "./env";
import { logServerError } from "@/app/lib/security/errors";

function isAuthRoute(pathname: string) {
  return pathname === "/login" || pathname === "/register";
}

function preventAuthRouteCaching(response: NextResponse, pathname: string) {
  if (!isAuthRoute(pathname)) {
    return;
  }

  response.headers.set(
    "Cache-Control",
    "private, no-cache, no-store, max-age=0, must-revalidate"
  );
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
}

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({
    request,
  });

  let supabaseUrl: string;
  let supabaseKey: string;

  try {
    const config = requireSupabaseConfig();

    supabaseUrl = config.supabaseUrl;
    supabaseKey = config.supabaseKey;
  } catch (error) {
    logServerError("supabase:proxy:config", error);
    return response;
  }

  const supabase = createServerClient(
    supabaseUrl,
    supabaseKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headersToSet) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });

          response = NextResponse.next({
            request,
          });

          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });

          Object.entries(headersToSet).forEach(([key, value]) => {
            response.headers.set(key, value);
          });
        },
      },
    }
  );

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const redirectPath = getAuthRouteRedirectPath(
      request.nextUrl.pathname,
      user
    );

    if (redirectPath) {
      const redirectResponse = NextResponse.redirect(
        new URL(redirectPath, request.url)
      );

      preventAuthRouteCaching(redirectResponse, request.nextUrl.pathname);

      return redirectResponse;
    }
  } catch (error) {
    logServerError("supabase:proxy:get_user", error);
  }

  preventAuthRouteCaching(response, request.nextUrl.pathname);

  return response;
}
