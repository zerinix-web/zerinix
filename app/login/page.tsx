import AuthShell from "@/components/AuthShell";

export default function LoginPage() {
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

      <form className="mt-8 space-y-4">
        <label className="block">
          <span className="text-sm font-medium text-gray-300">E-posta</span>
          <input
            type="email"
            name="email"
            autoComplete="email"
            placeholder="you@company.com"
            className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-black/50 px-4 text-white outline-none transition placeholder:text-gray-600 focus:border-teal-300/70"
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium text-gray-300">Şifre</span>
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            placeholder="••••••••"
            className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-black/50 px-4 text-white outline-none transition placeholder:text-gray-600 focus:border-teal-300/70"
          />
        </label>

        <div className="flex items-center justify-between text-sm">
          <label className="flex items-center gap-2 text-gray-400">
            <input
              type="checkbox"
              name="remember"
              className="h-4 w-4 rounded border-white/10 bg-black accent-white"
            />
            Beni hatırla
          </label>

          <a href="#" className="text-gray-300 transition hover:text-white">
            Şifremi unuttum
          </a>
        </div>

        <button
          type="submit"
          className="h-12 w-full rounded-2xl bg-white font-semibold text-black transition hover:bg-zinc-200"
        >
          Giriş Yap
        </button>
      </form>
    </AuthShell>
  );
}
