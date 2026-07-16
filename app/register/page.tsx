import AuthShell from "@/components/AuthShell";
import { redirectAuthenticatedUserFromAuthPage } from "@/app/auth/server-guard";
import { getRequestDictionary } from "@/app/lib/i18n/server";

export default async function RegisterPage() {
  await redirectAuthenticatedUserFromAuthPage();
  const { locale, dictionary } = await getRequestDictionary();

  return (
    <AuthShell
      eyebrow={dictionary.auth.accessEyebrow}
      title={dictionary.auth.privateBetaTitle}
      subtitle={dictionary.auth.privateBetaSubtitle}
      locale={locale}
      dictionary={dictionary}
      footerText={dictionary.auth.alreadyInvited}
      footerHref="/login"
      footerLinkText={dictionary.auth.signIn}
    >
      <div className="rounded-[28px] border border-teal-300/20 bg-teal-300/[0.055] p-5">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-teal-200/25 bg-teal-200/10 text-xl">
          🔒
        </div>
        <p className="mt-5 text-sm font-semibold tracking-[0.28em] text-teal-200/80">
          {dictionary.auth.privateBetaBadge}
        </p>
        <h2 className="mt-3 text-3xl font-bold tracking-tight text-white">
          {dictionary.auth.privateBetaTitle}
        </h2>
        <div className="mt-5 space-y-4 text-sm leading-7 text-zinc-300">
          <p>
            {dictionary.auth.privateBetaBody1}
          </p>
          <p>
            {dictionary.auth.privateBetaBody2}
          </p>
        </div>

        <a
          href="mailto:admin@zerinix.com?subject=ZERINIX%20Private%20Beta"
          className="mt-7 inline-flex h-12 w-full items-center justify-center rounded-2xl bg-white px-5 text-sm font-semibold text-black shadow-lg shadow-white/10 transition duration-200 hover:-translate-y-0.5 hover:bg-zinc-200"
        >
          {dictionary.auth.requestEarlyAccess}
        </a>
      </div>
    </AuthShell>
  );
}
