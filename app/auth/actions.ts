"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/app/lib/supabase/server";
import { sendWelcomeEmail } from "@/app/lib/integrations/email-events";
import {
  checkRateLimit,
  getServerActionClientIp,
} from "@/app/lib/security/rate-limit";
import { ensureFreeBillingProfile } from "@/app/lib/auth/provision-user";

export type LoginActionState = {
  error?: string;
};

export type RegisterErrorCode =
  | "invalidRegistration"
  | "passwordMismatch"
  | "weakPassword"
  | "registrationRateLimited"
  | "registrationFailed";

export type RegisterActionState = {
  error?: RegisterErrorCode;
  success?: boolean;
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
    redirect("/login?auth_error=invalid_credentials");
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

function getEmailConfirmationRedirect() {
  const configuredAppUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();

  if (!configuredAppUrl) {
    return undefined;
  }

  try {
    const redirectUrl = new URL("/auth/callback", configuredAppUrl);
    redirectUrl.searchParams.set("next", "/dashboard");

    if (
      redirectUrl.protocol !== "https:" &&
      !(process.env.NODE_ENV !== "production" && redirectUrl.protocol === "http:")
    ) {
      return undefined;
    }

    return redirectUrl.toString();
  } catch {
    return undefined;
  }
}

export async function signUpWithPassword(
  _prevState: RegisterActionState,
  formData: FormData
): Promise<RegisterActionState> {
  const fullName = String(formData.get("fullName") ?? "")
    .trim()
    .replace(/\s+/g, " ");
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");
  const ip = await getServerActionClientIp();
  const rateLimit = checkRateLimit(`auth:signup:${ip}:${email.toLowerCase()}`, {
    limit: 5,
    windowMs: 60_000,
  });

  if (!rateLimit.allowed) {
    return { error: "registrationRateLimited" };
  }

  if (
    fullName.length < 2 ||
    fullName.length > 100 ||
    /[\u0000-\u001f\u007f]/.test(fullName) ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    return { error: "invalidRegistration" };
  }

  if (password !== confirmPassword) {
    return { error: "passwordMismatch" };
  }

  if (password.length < 8) {
    return { error: "weakPassword" };
  }

  const supabase = await createClient();
  const emailRedirectTo = getEmailConfirmationRedirect();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: fullName,
      },
      ...(emailRedirectTo ? { emailRedirectTo } : {}),
    },
  });

  if (error || !data.user) {
    return { error: "registrationFailed" };
  }

  if (!data.session) {
    return { success: true };
  }

  const provisioned = await ensureFreeBillingProfile(supabase, data.user.id);

  if (!provisioned.ok) {
    await supabase.auth.signOut();
    return { error: "registrationFailed" };
  }

  revalidatePath("/login");
  revalidatePath("/register");
  redirect("/dashboard");
}

export async function signOut() {
  const supabase = await createClient();

  await supabase.auth.signOut();
  redirect("/login");
}
