import AuthShell from "@/components/AuthShell";
import IosRegistrationForm from "@/components/IosRegistrationForm";
import { redirectAuthenticatedUserFromAuthPage } from "@/app/auth/server-guard";
import { getRequestDictionary } from "@/app/lib/i18n/server";

export default async function RegisterPage() {
  await redirectAuthenticatedUserFromAuthPage();
  const { locale, dictionary } = await getRequestDictionary();

  // This page is served from the same deployment to the website and to the
  // iOS shell, so both versions of the copy are rendered and app/globals.css
  // hides one of them based on the .zx-native-ios class that app/layout.tsx
  // sets before first paint. The web wording (private beta, invitation, early
  // access) is unchanged; the App Store build sees neutral production wording
  // instead, because App Store Review Guideline 2.2 rejects builds that
  // present themselves as beta or trial software. Access itself is not
  // changed by either version -- registration stays approval-based on both.
  return (
    <AuthShell
      eyebrow={dictionary.auth.accessEyebrow}
      title={
        <>
          <span className="zx-web-only">{dictionary.auth.privateBetaTitle}</span>
          <span className="zx-ios-only">{dictionary.auth.appAccessTitle}</span>
        </>
      }
      subtitle={dictionary.auth.privateBetaSubtitle}
      locale={locale}
      dictionary={dictionary}
      footerText={
        <>
          <span className="zx-web-only">{dictionary.auth.alreadyInvited}</span>
          <span className="zx-ios-only">{dictionary.auth.appAccessFooter}</span>
        </>
      }
      footerHref="/login"
      footerLinkText={dictionary.auth.signIn}
    >
      <div className="rounded-[28px] border border-teal-300/20 bg-teal-300/[0.055] p-5">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-teal-200/25 bg-teal-200/10 text-xl">
          🔒
        </div>
        <p className="mt-5 text-sm font-semibold tracking-[0.28em] text-teal-200/80">
          <span className="zx-web-only">{dictionary.auth.privateBetaBadge}</span>
          <span className="zx-ios-only">{dictionary.auth.appAccessBadge}</span>
        </p>
        <h2 className="mt-3 text-3xl font-bold tracking-tight text-white">
          <span className="zx-web-only">{dictionary.auth.privateBetaTitle}</span>
          <span className="zx-ios-only">{dictionary.auth.appAccessTitle}</span>
        </h2>
        <div className="mt-5 space-y-4 text-sm leading-7 text-zinc-300">
          <div className="zx-web-only space-y-4">
            <p>{dictionary.auth.privateBetaBody1}</p>
            <p>{dictionary.auth.privateBetaBody2}</p>
          </div>
          <div className="zx-ios-only space-y-4">
            <p>{dictionary.auth.appAccessBody1}</p>
          </div>
        </div>

        {/* Self-service registration, App Store only. The form is hidden on
            the web for presentation, but the security is entirely server-side:
            app/api/ios/registration/route.ts refuses anything without a
            verified Apple App Attest assertion, so rendering this form in a
            browser would still create no account. */}
        <div className="zx-ios-only mt-6">
          <IosRegistrationForm
            labels={{
              fullName: dictionary.auth.fullName,
              email: dictionary.auth.email,
              password: dictionary.auth.password,
              createAccount: dictionary.auth.createAccount,
              creating: dictionary.auth.creatingAccount,
              checkEmail: dictionary.auth.checkEmail,
              weakPassword: dictionary.auth.weakPassword,
              invalidRegistration: dictionary.auth.invalidRegistration,
              registrationFailed: dictionary.auth.registrationFailed,
              registrationRateLimited: dictionary.auth.registrationRateLimited,
              unavailable: dictionary.auth.registrationUnavailable,
              signIn: dictionary.auth.signIn,
              alreadyHaveAccount: dictionary.auth.appAccessFooter,
            }}
          />
        </div>

        <a
          href="mailto:admin@zerinix.com?subject=ZERINIX%20Private%20Beta"
          className="zx-web-only mt-7 inline-flex h-12 w-full items-center justify-center rounded-2xl bg-white px-5 text-sm font-semibold text-black shadow-lg shadow-white/10 transition duration-200 hover:-translate-y-0.5 hover:bg-zinc-200"
        >
          {dictionary.auth.requestEarlyAccess}
        </a>
      </div>
    </AuthShell>
  );
}
