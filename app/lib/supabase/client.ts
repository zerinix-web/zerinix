import { createBrowserClient } from "@supabase/ssr";
import { requireSupabaseConfig } from "./env";

export function createClient() {
  const { supabaseUrl, supabaseKey } = requireSupabaseConfig();

  return createBrowserClient(supabaseUrl, supabaseKey);
}
