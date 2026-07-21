import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let browserClient: SupabaseClient | null = null;

export function createClient() {
  if (browserClient) {
    return browserClient;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

  if (supabaseKey?.startsWith("sb_secret_")) {
    console.error("[supabase:browser_client] Refusing secret Supabase key in browser config", {
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env
        .NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
        ? "loaded"
        : "missing",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
        ? "loaded"
        : "missing",
    });

    throw new Error(
      "Invalid Supabase browser configuration. Use NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY with a publishable key, not a secret key."
    );
  }

  if (!supabaseUrl || !supabaseKey) {
    console.error("[supabase:browser_client] Missing public Supabase config", {
      NEXT_PUBLIC_SUPABASE_URL: supabaseUrl ? "loaded" : "missing",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env
        .NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
        ? "loaded"
        : "missing",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
        ? "loaded"
        : "missing",
    });

    throw new Error(
      "Missing Supabase configuration. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to the production environment."
    );
  }

  browserClient = createBrowserClient(supabaseUrl, supabaseKey);

  return browserClient;
}
