import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

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

  return createBrowserClient(supabaseUrl, supabaseKey);
}
