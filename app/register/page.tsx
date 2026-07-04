import AuthShell from "@/components/AuthShell";

export default function RegisterPage() {
  return (
    <AuthShell
      eyebrow="ZERINIX ACCESS"
      title="AI işletim sistemini kurmaya başla."
      subtitle="ZERINIX, girişim hedefini anlaşılır bir plana çevirip iş akışını büyüme odaklı hale getirir."
      footerText="Zaten hesabın var mı?"
      footerHref="/login"
      footerLinkText="Giriş yap"
    >
      <div>
        <p className="text-sm font-medium text-gray-500">Kayıt</p>
        <h2 className="mt-2 text-3xl font-bold text-white">Yeni hesap oluştur</h2>
      </div>

      <form className="mt-8 space-y-4">
        <label className="block">
          <span className="text-sm font-medium text-gray-300">Ad soyad</span>
          <input
            type="text"
            name="name"
            autoComplete="name"
            placeholder="Ada Lovelace"
            className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-black/50 px-4 text-white outline-none transition placeholder:text-gray-600 focus:border-teal-300/70"
          />
        </label>

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
            autoComplete="new-password"
            placeholder="En az 8 karakter"
            className="mt-2 h-12 w-full rounded-2xl border border-white/10 bg-black/50 px-4 text-white outline-none transition placeholder:text-gray-600 focus:border-teal-300/70"
          />
        </label>

        <button
          type="submit"
          className="h-12 w-full rounded-2xl bg-white font-semibold text-black transition hover:bg-zinc-200"
        >
          Hesap Oluştur
        </button>
      </form>
    </AuthShell>
  );
}
