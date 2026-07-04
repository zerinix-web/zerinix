import Link from "next/link";

export default function Navbar() {
  return (
    <nav className="w-full border-b border-white/10 bg-black/95 px-6 py-5 text-white backdrop-blur md:px-8">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-6">
        <Link href="/" className="text-2xl font-bold tracking-[0.08em]">
          ZERINIX
        </Link>

        <div className="hidden gap-8 text-sm text-gray-300 md:flex">
          <a className="transition hover:text-white" href="#ozellikler">
            Özellikler
          </a>
          <a className="transition hover:text-white" href="#platform">
            Platform
          </a>
          <Link className="transition hover:text-white" href="/login">
            Giriş Yap
          </Link>
        </div>

        <Link
          href="/plan"
          className="rounded-xl bg-white px-5 py-2 text-sm font-semibold text-black transition hover:bg-zinc-200"
        >
          Plan Oluştur
        </Link>
      </div>
    </nav>
  );
}
