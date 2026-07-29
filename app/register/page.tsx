import AuthShell from "@/components/AuthShell";
import RegisterForm from "@/components/RegisterForm";
import { redirectAuthenticatedUserFromAuthPage } from "@/app/auth/server-guard";
import { getRequestDictionary } from "@/app/lib/i18n/server";

export default async function RegisterPage() {
  await redirectAuthenticatedUserFromAuthPage();
  const { locale, dictionary } = await getRequestDictionary();

  return (
    <AuthShell
      eyebrow={dictionary.auth.registerEyebrow}
      title={dictionary.auth.registerTitle}
      subtitle={dictionary.auth.registerSubtitle}
      locale={locale}
      dictionary={dictionary}
      footerText={dictionary.auth.alreadyHaveAccount}
      footerHref="/login"
      footerLinkText={dictionary.auth.signIn}
    >
      <div>
        <p className="text-sm font-medium text-gray-500">
          {dictionary.auth.createAccount}
        </p>
        <h2 className="mt-2 text-3xl font-bold text-white">
          {dictionary.auth.createAccountTitle}
        </h2>
      </div>

      <RegisterForm labels={dictionary.auth} />
    </AuthShell>
  );
}
