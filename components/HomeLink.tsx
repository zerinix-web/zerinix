import Link from "next/link";
import type { ReactNode } from "react";

/**
 * A "back to ZERINIX" link that means something different inside the app.
 *
 * On the website it goes to the public landing page, as it always has. In the
 * App Store build it goes to `/login`, which sends a signed-out user to the
 * real sign-in screen and a signed-in user straight on to `/dashboard` (see
 * `redirectAuthenticatedUserFromAuthPage`). Either way an installed
 * application never navigates the user into its own marketing site.
 *
 * WHY A COMPONENT AND NOT THE REDIRECT IN app/layout.tsx: that redirect is an
 * inline <head> script, so it only runs on a full document load. These are
 * next/link navigations, which are handled on the client without a new
 * document -- so the script cannot see them, and without this the landing page
 * stayed one tap away inside the app. Rendering both links and letting
 * app/globals.css hide one needs no JavaScript at all and behaves identically
 * on a cold launch and on an in-app navigation.
 *
 * Authorization is untouched: `/login` enforces exactly the checks it already
 * did, and the web target is unchanged.
 */
export default function HomeLink({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <>
      <Link href="/" className={`zx-web-only ${className}`}>
        {children}
      </Link>
      <Link href="/login" className={`zx-ios-only ${className}`}>
        {children}
      </Link>
    </>
  );
}
