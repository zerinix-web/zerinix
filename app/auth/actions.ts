"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/app/lib/supabase/server";
import { sendWelcomeEmail } from "@/app/lib/integrations/email-events";
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
