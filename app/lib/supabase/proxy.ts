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

// TEMPORARY PROFILING INSTRUMENTATION -- added to diagnose middleware
// latency, not permanent. Safe to delete every `performance.now()`
// call/`timings`/`console.log` line below without touching any auth
// logic, redirect behavior, or cookie handling: every wrapped step still
// does exactly what it did before, in the exact same order, this only
// measures how long each step takes and prints the result to the server
// console after the response is ready.
export async function updateSession(request: NextRequest) {
  const requestStart = performance.now();
  const timings: Record<string, number> = {};
  let cookieWriteMs = 0;
  let cookieWriteCount = 0;

  let response = NextResponse.next({
    request,
  });

  let supabaseUrl: string;
  let supabaseKey: string;

  const configStart = performance.now();
  try {
    const config = requireSupabaseConfig();

    supabaseUrl = config.supabaseUrl;
    supabaseKey = config.supabaseKey;
  } catch (error) {
    logServerError("supabase:proxy:config", error);
    return response;
  }
  timings.config = performance.now() - configStart;

  const clientCreateStart = performance.now();
  const supabase = createServerClient(
    supabaseUrl,
    supabaseKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headersToSet) {
          const cookieWriteStart = performance.now();
          cookieWriteCount += cookiesToSet.length;

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
          cookieWriteMs += performance.now() - cookieWriteStart;
        },
      },
    }
  );
  timings.clientCreate = performance.now() - clientCreateStart;

  const getUserStart = performance.now();
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    timings.getUser = performance.now() - getUserStart;

    const redirectCheckStart = performance.now();
    const redirectPath = getAuthRouteRedirectPath(
      request.nextUrl.pathname,
      user
    );
    timings.redirectCheck = performance.now() - redirectCheckStart;

    if (redirectPath) {
      const redirectResponse = NextResponse.redirect(
        new URL(redirectPath, request.url)
      );

      preventAuthRouteCaching(redirectResponse, request.nextUrl.pathname);
      timings.cookieWrite = cookieWriteMs;
      printProxyTimings(request, timings, cookieWriteCount, requestStart);

      return redirectResponse;
    }
  } catch (error) {
    timings.getUser = performance.now() - getUserStart;
    logServerError("supabase:proxy:get_user", error);
  }

  preventAuthRouteCaching(response, request.nextUrl.pathname);
  timings.cookieWrite = cookieWriteMs;
  printProxyTimings(request, timings, cookieWriteCount, requestStart);

  return response;
}

function printProxyTimings(
  request: NextRequest,
  timings: Record<string, number>,
  cookieWriteCount: number,
  requestStart: number
) {
  const order = [
    "config",
    "clientCreate",
    "getUser",
    "redirectCheck",
    "cookieWrite",
  ];
  const labelWidth = Math.max(...order.map((label) => label.length), "TOTAL".length);
  const lines = order
    .filter((label) => label in timings)
    .map((label) => {
      const dots = ".".repeat(Math.max(3, labelWidth - label.length + 3));
      return `${label} ${dots} ${timings[label].toFixed(1)} ms`;
    });
  const totalMs = performance.now() - requestStart;
  const totalDots = ".".repeat(Math.max(3, labelWidth - "TOTAL".length + 3));
  lines.push(`TOTAL ${totalDots} ${totalMs.toFixed(1)} ms (cookies written: ${cookieWriteCount})`);
  console.log(
    [`Proxy/middleware timings [${request.nextUrl.pathname}]`, ...lines].join("\n")
  );
}
