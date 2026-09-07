"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/app/lib/supabase/server";
import { classifyPasswordSignInError } from "@/app/lib/supabase/auth-error-classification";
import { sendWelcomeEmail } from "@/app/lib/integrations/email-events";
import { logServerError } from "@/app/lib/security/errors";
import {
  checkRateLimit,
  getServerActionClientIp,
} from "@/app/lib/security/rate-limit";

export type LoginActionState = {
  error?: string;
};

export async function loginWithPassword(
  _prevState: LoginActionState,
  formData: FormData
): Promise<LoginActionState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const ip = await getServerActionClientIp();
  const rateLimit = checkRateLimit(`auth:login:${ip}:${email.toLowerCase()}`, {
    limit: 8,
    windowMs: 60_000,
  });

  if (!rateLimit.allowed) {
    return {
      error: "Too many attempts. Please wait a moment and try again.",
    };
  }

  if (!email || !password) {
    return {
      error: "Enter your email and password.",
    };
  }

  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    // TASK #69A-19A -- ROOT CAUSE FIX (classifier extracted to
    // classifyPasswordSignInError under #69A-21 so this and
    // signInWithPassword below share one truthful distinction instead
    // of each re-implementing it): every failure from
    // signInWithPassword used to collapse into the same "check your
    // email and password" message, regardless of WHY it failed --
    // confirmed live, a genuine Supabase connectivity outage (the auth
    // service itself unreachable, independent of anything this app
    // controls) surfaces here as a "connectivity" classification, which
    // was indistinguishable from real invalid credentials to the user.
    // That is misleading (it tells someone with a CORRECT password to
    // doubt it) and makes a real infrastructure incident look like a
    // login bug. The real error is logged server-side ONLY
    // (logServerError never reaches the client response) so this
    // failure stays diagnosable without exposing any sensitive detail
    // to the login form. Genuine invalid-credential failures (and
    // every other error type) still return the EXACT SAME generic
    // message as before -- this deliberately does not distinguish
    // "wrong email" from "wrong password" from "some other auth
    // error", since doing so would let an attacker enumerate which
    // part of a guess was wrong.
    logServerError("auth:login", error);

    if (classifyPasswordSignInError(error) === "connectivity") {
      return {
        error:
          "We couldn't reach the login service. Please check your connection and try again in a moment.",
      };
    }

    return {
      error: "Check your email and password, then try again.",
    };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user?.email && !user.user_metadata?.welcome_email_sent_at) {
    const result = await sendWelcomeEmail({
      userId: user.id,
      email: user.email,
      name: user.user_metadata?.full_name,
    });

    if (result.ok) {
      await supabase.auth.updateUser({
        data: {
          ...user.user_metadata,
          welcome_email_sent_at: new Date().toISOString(),
        },
      });
    }
  }

  revalidatePath("/login");
  revalidatePath("/register");
  redirect("/plan");
}

export async function signInWithPassword(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const ip = await getServerActionClientIp();
  const rateLimit = checkRateLimit(`auth:signin:${ip}:${email.toLowerCase()}`, {
    limit: 8,
    windowMs: 60_000,
  });

  if (!rateLimit.allowed) {
    redirect("/login?auth_error=rate_limited");
  }

  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    // TASK #69A-21 -- this redirect-based path currently has no live
    // caller (confirmed by a repo-wide search for its own name; the
    // real login form, LoginForm.tsx, calls
    // supabase.auth.signInWithPassword directly from the browser, not
    // this server action), but it carried the same collapse-every-
    // failure-into-invalid_credentials bug that #69A-19A fixed
    // elsewhere. Fixed here too so it can never reintroduce that
    // misleading behavior if it is ever wired up later. Mirrors
    // loginWithPassword above: the real error is logged server-side
    // only, and only the connectivity/transient-fetch case gets its
    // own distinct redirect value -- every other failure (genuinely
    // wrong credentials, or anything else) keeps the exact same
    // invalid_credentials value as before.
    logServerError("auth:signin", error);

    redirect(
      classifyPasswordSignInError(error) === "connectivity"
        ? "/login?auth_error=connection_error"
        : "/login?auth_error=invalid_credentials"
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user?.email && !user.user_metadata?.welcome_email_sent_at) {
    const result = await sendWelcomeEmail({
      userId: user.id,
      email: user.email,
      name: user.user_metadata?.full_name,
    });

    if (result.ok) {
      await supabase.auth.updateUser({
        data: {
          ...user.user_metadata,
          welcome_email_sent_at: new Date().toISOString(),
        },
      });
    }
  }

  revalidatePath("/login");
  revalidatePath("/register");
  redirect("/plan");
}

export async function signUpWithPassword(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const ip = await getServerActionClientIp();
  const rateLimit = checkRateLimit(`auth:signup:${ip}:${email.toLowerCase()}`, {
    limit: 5,
    windowMs: 60_000,
  });

  if (!rateLimit.allowed) {
    redirect("/register?auth_error=rate_limited");
  }

  redirect("/register?auth_error=registration_disabled");
}

export async function signOut() {
  const supabase = await createClient();

  await supabase.auth.signOut();
  redirect("/login");
}
