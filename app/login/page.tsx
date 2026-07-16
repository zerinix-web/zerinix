import AuthShell from "@/components/AuthShell";
import LoginForm from "@/components/LoginForm";
import { redirectAuthenticatedUserFromAuthPage } from "@/app/auth/server-guard";
import { getRequestDictionary } from "@/app/lib/i18n/server";

type LoginPageProps = {
  searchParams: Promise<{
    auth_error?: string;
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  await redirectAuthenticatedUserFromAuthPage();

  const { auth_error: authError } = await searchParams;
  const { locale, dictionary } = await getRequestDictionary();

  return (
    <AuthShell
      eyebrow={dictionary.auth.loginEyebrow}
      title={dictionary.auth.loginTitle}
      subtitle={dictionary.auth.loginSubtitle}
      locale={locale}
      dictionary={dictionary}
      footerText={dictionary.auth.privateBetaAccess}
      footerHref="/register"
      footerLinkText={dictionary.auth.requestAccess}
    >
      <div>
        <p className="text-sm font-medium text-gray-500">{dictionary.auth.signIn}</p>
        <h2 className="mt-2 text-3xl font-bold text-white">
          {dictionary.auth.signInTitle}
        </h2>
      </div>

      {authError && (
        <p className="mt-6 rounded-2xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-100">
          {dictionary.auth.authError}
        </p>
      )}

      <LoginForm labels={dictionary.auth} />
    </AuthShell>
  );
}
