import AuthShell from "@/components/AuthShell";

export default function RegisterPage() {
  return (
    <AuthShell
      eyebrow="ZERINIX ACCESS"
      title="Private beta erişimi kontrollü olarak açılıyor."
      subtitle="ZERINIX, girişimciler için AI iş planlama, pazar zekası ve stratejik raporları premium bir çalışma alanında birleştirir."
      footerText="Zaten hesabın var mı?"
      footerHref="/login"
      footerLinkText="Giriş yap"
    >
      <div className="rounded-[28px] border border-teal-300/20 bg-teal-300/[0.055] p-5">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-teal-200/25 bg-teal-200/10 text-xl">
          🔒
        </div>
        <p className="mt-5 text-sm font-semibold tracking-[0.28em] text-teal-200/80">
          ZERINIX PRIVATE BETA
        </p>
        <h2 className="mt-3 text-3xl font-bold tracking-tight text-white">
          ZERINIX Private Beta
        </h2>
        <div className="mt-5 space-y-4 text-sm leading-7 text-zinc-300">
          <p>
            Şu anda yalnızca davet edilen kullanıcılar hesap oluşturabilir.
          </p>
          <p>
            ZERINIX&apos;i en yüksek kalite standartlarında geliştirebilmek için
            yeni kullanıcıları kontrollü olarak kabul ediyoruz.
          </p>
        </div>

        <a
          href="mailto:admin@zerinix.com?subject=ZERINIX%20Private%20Beta"
          className="mt-7 inline-flex h-12 w-full items-center justify-center rounded-2xl bg-white px-5 text-sm font-semibold text-black shadow-lg shadow-white/10 transition duration-200 hover:-translate-y-0.5 hover:bg-zinc-200"
        >
          Erken Erişim Talep Et
        </a>
      </div>
    </AuthShell>
  );
}
