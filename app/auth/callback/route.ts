import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/app/lib/supabase/server";
import { ensureFreeBillingProfile } from "@/app/lib/auth/provision-user";

function getSafeNextPath(value: string | null) {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.startsWith("/\\")
  ) {
    return "/dashboard";
  }

  return value;
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const nextPath = getSafeNextPath(request.nextUrl.searchParams.get("next"));
  const loginUrl = new URL("/login?auth_error=oauth_callback", request.url);

  if (!code) {
    return NextResponse.redirect(loginUrl);
  }

  try {
    const supabase = await createClient();
    const { error: exchangeError } =
      await supabase.auth.exchangeCodeForSession(code);

    if (exchangeError) {
      return NextResponse.redirect(loginUrl);
    }

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      await supabase.auth.signOut();
      return NextResponse.redirect(loginUrl);
    }

    const provisioned = await ensureFreeBillingProfile(supabase, user.id);

    if (!provisioned.ok) {
      await supabase.auth.signOut();
      return NextResponse.redirect(loginUrl);
    }

    return NextResponse.redirect(new URL(nextPath, request.nextUrl.origin));
  } catch {
    return NextResponse.redirect(loginUrl);
  }
}
