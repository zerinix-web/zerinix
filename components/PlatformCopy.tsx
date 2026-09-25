import type { ReactNode } from "react";

/**
 * One label, two wordings.
 *
 * The website and the iOS shell are served by the same deployment, so copy
 * that has to differ between them cannot be chosen on the server. Both
 * versions are rendered and app/globals.css hides one, keyed off the
 * .zx-native-ios class that app/layout.tsx sets before first paint.
 *
 * This exists for App Store Review Guideline 2.2: the App Store build must
 * not describe itself as beta, trial, invitation-only or early-access
 * software, while the website is free to keep doing exactly that. Only the
 * words differ -- access control, quotas and authorization are identical on
 * both platforms.
 */
export default function PlatformCopy({
  web,
  ios,
}: {
  web: ReactNode;
  ios: ReactNode;
}) {
  return (
    <>
      <span className="zx-web-only">{web}</span>
      <span className="zx-ios-only">{ios}</span>
    </>
  );
}
