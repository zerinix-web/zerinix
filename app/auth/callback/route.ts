import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/app/lib/supabase/server";
import { ensureFreeBillingProfile } from "@/app/lib/auth/provision-user";
import { isPrivateBetaAllowed } from "@/app/lib/beta-access";
import { isAppAttestedAccount } from "@/app/lib/ios-app-store-access";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const oauthErrorUrl = new URL("/login?error=oauth_callback_failed", request.url);
  const accessDeniedUrl = new URL(
    "/login?error=beta_access_required",
    request.url
  );
  const dashboardUrl = new URL("/dashboard", request.url);

  if (!code) {
    return NextResponse.redirect(oauthErrorUrl);
  }

  try {
    const supabase = await createClient();
    const { error: exchangeError } =
      await supabase.auth.exchangeCodeForSession(code);

    if (exchangeError) {
      return NextResponse.redirect(oauthErrorUrl);
    }

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      await supabase.auth.signOut();
      return NextResponse.redirect(oauthErrorUrl);
    }

    // Self-service registration is email + password, so an attested account
    // only reaches this callback if the user later signs in with Google or
    // Apple. Their email is still not on the private-beta allowlist, so
    // without this they would be signed straight back out of an account they
    // legitimately created.
    if (!isPrivateBetaAllowed(user) && !isAppAttestedAccount(user)) {
      await supabase.auth.signOut();
      return NextResponse.redirect(accessDeniedUrl);
    }

    const provisioned = await ensureFreeBillingProfile(supabase, user.id);

    if (!provisioned.ok) {
      await supabase.auth.signOut();
      return NextResponse.redirect(oauthErrorUrl);
    }

    return NextResponse.redirect(dashboardUrl);
  } catch {
    return NextResponse.redirect(oauthErrorUrl);
  }
}
