export default function Navbar() {
  return (
    <nav className="w-full flex justify-between items-center px-8 py-6 border-b border-white/10 bg-black text-white">
      <h1 className="text-2xl font-bold">Nexora AI</h1>

      <div className="flex gap-8 text-gray-300">
        <a href="#">Özellikler</a>
        <a href="#">Fiyatlandırma</a>
        <a href="#">Giriş Yap</a>
      </div>

      <button className="bg-white text-black px-5 py-2 rounded-xl font-semibold">
        Ücretsiz Başla
      </button>
    </nav>
  );
}