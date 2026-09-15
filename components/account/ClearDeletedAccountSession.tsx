"use client";

import { useEffect } from "react";
import {
  createClient,
  persistSupabaseSession,
  restoreSupabaseSession,
} from "@/app/lib/supabase/client";

// Runs on the post-deletion page. The server action already cleared the
// auth cookies, but the Capacitor/WKWebView session mirrors in localStorage
// (see app/lib/supabase/client.ts) can only be cleared in the browser.
// Local state is cleared only when Supabase reports that the session's
// user no longer exists, so opening this public URL while signed in to a
// live account (or while offline) changes nothing.
export default function ClearDeletedAccountSession() {
  useEffect(() => {
    void (async () => {
      try {
        const client = createClient();
        const session = await restoreSupabaseSession(client);

        if (!session) {
          return;
        }

        const { data, error } = await client.auth.getUser();

        if (data.user || !error || ![401, 403, 404].includes(error.status ?? 0)) {
          return;
        }

        await client.auth.signOut({ scope: "local" });
        persistSupabaseSession(null);
      } catch {
        // Nothing else to clean up; the server-side session is already gone.
      }
    })();
  }, []);

  return null;
}
