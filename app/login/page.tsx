import AuthShell from "@/components/AuthShell";
import LoginForm from "@/components/LoginForm";

type LoginPageProps = {
  searchParams: Promise<{
    auth_error?: string;
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { auth_error: authError } = await searchParams;

  return (
    <AuthShell
      eyebrow="ZERINIX LOGIN"
      title="Komuta merkezine giriş yap."
      subtitle="İş hedeflerini, planlarını ve günlük operasyonlarını tek bir premium AI çalışma alanında yönet."
      footerText="Hesabın yok mu?"
      footerHref="/register"
      footerLinkText="Hesap oluştur"
    >
      <div>
        <p className="text-sm font-medium text-gray-500">Giriş</p>
        <h2 className="mt-2 text-3xl font-bold text-white">ZERINIX hesabın</h2>
      </div>

      {authError && (
        <p className="mt-6 rounded-2xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-100">
          Giriş bilgilerini kontrol edip tekrar dene.
        </p>
      )}

      <LoginForm />
    </AuthShell>
  );
}
