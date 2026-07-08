"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/app/lib/supabase/server";
import { getSupabaseConfigSource, getSupabaseUrl } from "@/app/lib/supabase/env";
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
      error: "E-posta ve şifre alanlarını doldur.",
    };
  }

  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    return {
      error: "Giriş bilgilerini kontrol edip tekrar dene.",
    };
  }

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

  redirect("/plan");
}

function redirectWithSignupError(error: unknown): never {
  const cause =
    error instanceof Error && "cause" in error
      ? (error as Error & { cause?: unknown }).cause
      : undefined;
  const causeMessage =
    typeof cause === "object" && cause
      ? [
          "code" in cause ? `code=${String((cause as { code?: unknown }).code)}` : "",
          "hostname" in cause
            ? `hostname=${String((cause as { hostname?: unknown }).hostname)}`
            : "",
          "message" in cause
            ? `message=${String((cause as { message?: unknown }).message)}`
            : "",
        ]
          .filter(Boolean)
          .join(", ")
      : "";
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error && "message" in error
        ? String((error as { message: unknown }).message)
        : String(error || "Unknown Supabase sign up error");
  const displayMessage = causeMessage ? `${message} (${causeMessage})` : message;

  redirect(`/register?auth_error=${encodeURIComponent(displayMessage)}`);
}

export async function signUpWithPassword(formData: FormData) {
  const name = String(formData.get("name") ?? "");
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const ip = await getServerActionClientIp();
  const rateLimit = checkRateLimit(`auth:signup:${ip}:${email.toLowerCase()}`, {
    limit: 5,
    windowMs: 60_000,
  });

  if (!rateLimit.allowed) {
    redirect("/register?auth_error=rate_limited");
  }

  let supabase: Awaited<ReturnType<typeof createClient>>;

  try {
    const supabaseUrl = getSupabaseUrl();

    console.info("[auth:signup:supabase_config]", {
      ...getSupabaseConfigSource(),
      finalUrl: supabaseUrl ?? "missing",
    });

    supabase = await createClient();
  } catch (error) {
    console.error("[auth:signup:supabase_config]", error);
    redirectWithSignupError(error);
  }

  const { error: signUpError } = await supabase.auth
    .signUp({
      email,
      password,
      options: {
        data: {
          full_name: name,
        },
      },
    })
    .catch((error: unknown) => {
      console.error("[auth:signup:supabase_fetch]", error);

      return { error };
    });

  if (signUpError) {
    console.error("[auth:signup:supabase_error]", signUpError);
    redirectWithSignupError(signUpError);
  }

  redirect("/plan");
}

export async function signOut() {
  const supabase = await createClient();

  await supabase.auth.signOut();
  redirect("/login");
}
