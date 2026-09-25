import AuthShell from "@/components/AuthShell";
import LoginForm from "@/components/LoginForm";
import { redirectAuthenticatedUserFromAuthPage } from "@/app/auth/server-guard";
import { getRequestDictionary } from "@/app/lib/i18n/server";

type LoginPageProps = {
  searchParams: Promise<{
    auth_error?: string;
    error?: string;
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  await redirectAuthenticatedUserFromAuthPage();

  const { auth_error: authError, error } = await searchParams;
  const { locale, dictionary } = await getRequestDictionary();
  // The access-denied message is the one error whose wording differs between
  // the website and the App Store build: the web keeps "private beta access",
  // while the iOS build says the account has no access, without framing the
  // product as beta software (App Store Review Guideline 2.2). Both are
  // rendered and app/globals.css shows one, because the same deployment
  // serves both. The gate itself is unchanged -- the message only describes
  // an authorization failure that already happened.
  const pageError =
    error === "beta_access_required" ? (
      <>
        <span className="zx-web-only">{dictionary.auth.betaAccessRequired}</span>
        <span className="zx-ios-only">{dictionary.auth.appAccessDenied}</span>
      </>
    ) : error === "oauth_callback_failed" ? (
      dictionary.auth.oauthError
    ) : authError ? (
      dictionary.auth.authError
    ) : null;

  return (
    <AuthShell
      eyebrow={dictionary.auth.loginEyebrow}
      title={dictionary.auth.loginTitle}
      subtitle={dictionary.auth.loginSubtitle}
      locale={locale}
      dictionary={dictionary}
      footerText={
        <>
          <span className="zx-web-only">{dictionary.auth.privateBetaAccess}</span>
          <span className="zx-ios-only">{dictionary.auth.appAccessLabel}</span>
        </>
      }
      footerHref="/register"
      footerLinkText={dictionary.auth.requestAccess}
    >
      <div>
        <p className="text-sm font-medium text-gray-500">{dictionary.auth.signIn}</p>
        <h2 className="mt-2 text-3xl font-bold text-white">
          {dictionary.auth.signInTitle}
        </h2>
      </div>

      {pageError && (
        <p
          role="alert"
          className="mt-6 rounded-2xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-100"
        >
          {pageError}
        </p>
      )}

      <LoginForm labels={dictionary.auth} />
    </AuthShell>
  );
}
