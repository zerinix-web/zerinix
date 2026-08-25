"use client";

import { useState, type ReactNode } from "react";
import { signOut } from "@/app/auth/actions";
import { createClient, persistSupabaseSession } from "@/app/lib/supabase/client";

export default function SignOutButton({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const [pending, setPending] = useState(false);

  return (
    <button
      type="button"
      disabled={pending}
      aria-busy={pending}
      onClick={() => {
        if (pending) return;
        setPending(true);

        void (async () => {
          // The server action alone clears the httpOnly-free auth cookies via
          // Set-Cookie on redirect, but never runs in the browser, so it can
          // never clear the client-only localStorage session backup/mirrors
          // (see app/lib/supabase/client.ts) that Capacitor/WKWebView relies
          // on for persistence. Signing out on the browser client first is
          // what actually clears those; the server action then performs the
          // authoritative cookie clear and redirect, exactly as it already
          // does for desktop.
          try {
            await createClient().auth.signOut();
          } catch {
            // Fall through to local cleanup and the server action below
            // even if the network call to Supabase failed.
          } finally {
            persistSupabaseSession(null);
          }

          await signOut();
        })();
      }}
      className={className}
    >
      {children}
    </button>
  );
}
