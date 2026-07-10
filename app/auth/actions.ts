"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/app/lib/supabase/server";
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
    return {
      error: "Check your email and password, then try again.",
    };
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

  revalidatePath("/login");
  revalidatePath("/register");
  redirect("/plan");
}

function redirectWithSignupError(error: unknown): never {
  const serializedError = serializeSignupError(error);
  const isDevelopment = process.env.NODE_ENV !== "production";

  if (!isDevelopment) {
    redirect("/register?auth_error=registration_failed");
  }

  const details = [
    `message=${serializedError.message}`,
    serializedError.code ? `code=${String(serializedError.code)}` : "",
    serializedError.status ? `status=${String(serializedError.status)}` : "",
    serializedError.cause ? `cause=${JSON.stringify(serializedError.cause)}` : "",
  ]
    .filter(Boolean)
    .join("; ");

  redirect(`/register?auth_error=${encodeURIComponent(details)}`);
}

function serializeSignupError(error: unknown) {
  const errorRecord =
    typeof error === "object" && error ? (error as Record<string, unknown>) : {};
  const cause =
    error instanceof Error && "cause" in error ? errorRecord.cause : undefined;
  const causeRecord =
    typeof cause === "object" && cause ? (cause as Record<string, unknown>) : {};
  const causeDetails = cause
    ? {
        message:
          cause instanceof Error
            ? cause.message
            : typeof causeRecord.message === "string"
              ? causeRecord.message
              : undefined,
        code: causeRecord.code,
        status: causeRecord.status,
        hostname: causeRecord.hostname,
      }
    : undefined;
  const message =
    error instanceof Error
      ? error.message
      : typeof errorRecord.message === "string"
        ? errorRecord.message
        : String(error || "Unknown Supabase sign up error");

  return {
    message,
    code: errorRecord.code,
    status: errorRecord.status,
    stack: error instanceof Error ? error.stack : undefined,
    cause: causeDetails,
    raw: error,
  };
}

function logSignupError(scope: string, error: unknown) {
  console.error(scope, {
    error: serializeSignupError(error),
  });
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
    supabase = await createClient();
  } catch (error) {
    logSignupError("[auth:signup:supabase_config]", error);
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
      logSignupError("[auth:signup:supabase_fetch]", error);

      return { error };
    });

  if (signUpError) {
    logSignupError("[auth:signup:supabase_error]", signUpError);
    redirectWithSignupError(signUpError);
  }

  redirect("/plan");
}

export async function signOut() {
  const supabase = await createClient();

  await supabase.auth.signOut();
  redirect("/login");
}
