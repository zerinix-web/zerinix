import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseConfigSource, requireSupabaseConfig } from "./env";

export async function createClient() {
  const { supabaseUrl, supabaseKey } = requireSupabaseConfig();
  const cookieStore = await cookies();

  console.info("[supabase:server_client]", {
    ...getSupabaseConfigSource(),
    finalUrl: supabaseUrl,
  });

  return createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Components cannot always set cookies. proxy.ts refreshes them.
        }
      },
    },
  });
}
