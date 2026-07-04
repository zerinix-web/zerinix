export default function AIDashboard() {
  return (
    <div className="w-[520px] rounded-3xl border border-white/10 bg-zinc-950/90 p-6 shadow-2xl backdrop-blur-xl">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500">Nexora AI Dashboard</p>
          <h2 className="mt-1 text-2xl font-bold text-white">
            Bugünün İş Planı
          </h2>
        </div>

        <div className="flex items-center gap-2 rounded-full bg-green-500/10 px-4 py-2 text-sm text-green-400">
          <span className="h-2 w-2 rounded-full bg-green-400 animate-pulse" />
          AI Aktif
        </div>
      </div>

      <div className="mt-8 rounded-2xl bg-zinc-900/80 p-5">
        <div className="flex justify-between text-sm">
          <span className="text-gray-400">Günlük ilerleme</span>
          <span className="font-bold text-white">68%</span>
        </div>

        <div className="mt-3 h-3 rounded-full bg-zinc-800">
          <div className="h-3 w-[68%] rounded-full bg-gradient-to-r from-purple-500 to-white" />
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-4">
        <div className="rounded-2xl bg-zinc-900/80 p-5">
          <p className="text-sm text-gray-500">Gelir hedefi</p>
          <h3 className="mt-2 text-2xl font-bold text-white">$10K</h3>
          <p className="mt-1 text-xs text-green-400">+12% bu hafta</p>
        </div>

        <div className="rounded-2xl bg-zinc-900/80 p-5">
          <p className="text-sm text-gray-500">Tamamlanan</p>
          <h3 className="mt-2 text-2xl font-bold text-white">7/10</h3>
          <p className="mt-1 text-xs text-purple-400">3 görev kaldı</p>
        </div>
      </div>

      <div className="mt-5 space-y-3">
        <div className="rounded-2xl bg-zinc-900/80 p-4 text-white">
          ✅ Marka konumlandırması
        </div>

        <div className="rounded-2xl bg-zinc-900/80 p-4 text-white">
          ⏳ Reklam metni hazırlanıyor
        </div>

        <div className="rounded-2xl bg-zinc-900/80 p-4 text-white">
          📈 Rakip analizi bekliyor
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-purple-500/20 bg-purple-500/10 p-4">
        <p className="text-sm text-purple-300">AI Önerisi</p>
        <p className="mt-2 text-sm text-gray-300">
          Bugün reklam metnini tamamla ve ilk kampanya için 3 farklı başlık test et.
        </p>
      </div>
    </div>
  );
}