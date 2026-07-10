import AuthShell from "@/components/AuthShell";
import LoginForm from "@/components/LoginForm";
import { redirectAuthenticatedUserFromAuthPage } from "@/app/auth/server-guard";

type LoginPageProps = {
  searchParams: Promise<{
    auth_error?: string;
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  await redirectAuthenticatedUserFromAuthPage("/login");

  const { auth_error: authError } = await searchParams;

  return (
    <AuthShell
      eyebrow="ZERINIX LOGIN"
      title="Access your AI workspace."
      subtitle="Manage business ideas, strategic reports and execution workflows in one premium AI workspace."
      footerText="Private beta access"
      footerHref="/register"
      footerLinkText="Request access"
    >
      <div>
        <p className="text-sm font-medium text-gray-500">Sign in</p>
        <h2 className="mt-2 text-3xl font-bold text-white">Sign in to ZERINIX</h2>
      </div>

      {authError && (
        <p className="mt-6 rounded-2xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-100">
          Check your email and password, then try again.
        </p>
      )}

      <LoginForm />
    </AuthShell>
  );
}
