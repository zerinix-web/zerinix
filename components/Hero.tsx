import Link from "next/link";
import AIDashboard from "./AIDashboard";

export default function Hero() {
  return (
    <section className="relative min-h-screen overflow-hidden bg-black text-white flex items-center">

      {/* Arka plan efektleri */}
      <div className="absolute left-1/2 top-1/3 h-[500px] w-[500px] -translate-x-1/2 rounded-full bg-purple-700/20 blur-[140px]" />
      <div className="absolute right-10 top-24 h-[300px] w-[300px] rounded-full bg-blue-600/10 blur-[120px]" />

      <div className="relative mx-auto max-w-7xl px-6 grid lg:grid-cols-2 gap-16 items-center">

        {/* Sol taraf */}
        <div>
          <p className="text-sm tracking-[0.4em] text-gray-500">
            NEXORA AI
          </p>

          <h1 className="mt-6 text-6xl font-bold leading-tight">
            Girişimciler için yapay zekâ asistanı
          </h1>

          <p className="mt-6 text-xl text-gray-400">
            Hedefini yaz, Nexora sana günlük görevler ve yol haritası çıkarsın.
          </p>

          <Link href="/plan">
            <button className="mt-10 rounded-2xl bg-white px-8 py-4 font-semibold text-black hover:scale-105 transition">
              Hedefimi Planla
            </button>
          </Link>
        </div>

        {/* Sağ taraf */}
        <div className="hidden lg:flex justify-center">
          <AIDashboard />
        </div>

      </div>
    </section>
  );
}