"use client";

import { useState } from "react";

type DomainResult = {
  domain: string;
  available: boolean | null;
  status: string;
};

export default function PlanPage() {
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState("");
  const [domains, setDomains] = useState<DomainResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);

  async function generatePlan() {
    setLoading(true);
    setResult("");
    setDomains([]);

    try {
      const res = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });

      const data = await res.json();
      setResult(data.result || data.error || "Cevap alınamadı.");
    } catch {
      setResult("Bir hata oluştu.");
    } finally {
      setLoading(false);
    }
  }

  function generateBrandNames(count: number) {
    const starts = [
      "zor", "vel", "kor", "rav", "xen", "var", "nov", "kar",
      "ory", "sol", "ven", "lyr", "qor", "zer", "kal", "mor"
    ];

    const mids = [
      "a", "e", "i", "o", "y", "ar", "en", "or", "iv", "el",
      "on", "ur", "ai", "ev"
    ];

    const ends = [
      "via", "nix", "ron", "vex", "ora", "ion", "exa", "rix",
      "ira", "yon", "ara", "xis", "nor", "lia"
    ];

    const names = new Set<string>();

    while (names.size < count) {
      const name =
        starts[Math.floor(Math.random() * starts.length)] +
        mids[Math.floor(Math.random() * mids.length)] +
        ends[Math.floor(Math.random() * ends.length)];

      names.add(name.toLowerCase() + ".com");
    }

    return Array.from(names);
  }

  async function checkDomain(domain: string) {
    const res = await fetch("/api/domain", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domain }),
    });

    const data = await res.json();
    setDomains((prev) => [...prev, data]);
  }

  async function checkBrandNames() {
    setChecking(true);
    setDomains([]);

    const names = generateBrandNames(30);

    for (const domain of names) {
      await checkDomain(domain);
    }

    setChecking(false);
  }

  return (
    <main className="min-h-screen bg-black text-white p-10">
      <div className="grid md:grid-cols-2 gap-8 mt-8">
        <div className="bg-zinc-900 rounded-3xl p-8">
          <p className="text-sm tracking-[6px] text-zinc-500 mb-6">
            NEXORA AI PLANLAYICI
          </p>

          <h1 className="text-5xl font-bold leading-tight mb-8">
            Hedefini anlat,
            <br />
            Nexora yol haritanı hazırlasın.
          </h1>

          <p className="text-zinc-400 mb-6">
            İş fikrini, hedefini ve bütçeni yaz.
          </p>

          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className="w-full h-56 mt-8 rounded-2xl bg-zinc-800 p-5 outline-none resize-none"
            placeholder="Örneğin: ABD'de yapay zeka şirketi kurmak istiyorum."
          />

          <button
            onClick={generatePlan}
            disabled={loading}
            className="mt-6 w-full bg-white text-black py-4 rounded-2xl font-semibold disabled:opacity-60"
          >
            {loading ? "AI düşünüyor..." : "AI Plan Oluştur"}
          </button>

          <button
            onClick={checkBrandNames}
            disabled={checking}
            className="mt-4 w-full bg-zinc-700 text-white py-4 rounded-2xl font-semibold disabled:opacity-60"
          >
            {checking ? "Domainler kontrol ediliyor..." : "30 Marka Domaini Bul"}
          </button>
        </div>

        <div className="bg-zinc-900 rounded-3xl p-8 whitespace-pre-wrap overflow-y-auto max-h-[80vh]">
          {result || "AI sonucu burada görünecek."}

          {domains.length > 0 && (
            <div className="mt-8 border-t border-zinc-700 pt-6">
              <h2 className="text-2xl font-bold mb-4">
                Domain Kontrol Sonuçları
              </h2>

              <div className="space-y-3">
                {domains.map((item, index) => (
                  <div
                    key={index}
                    className="flex justify-between items-center bg-zinc-800 p-4 rounded-xl"
                  >
                    <span>{item.domain}</span>

                    <span>
                      {item.available === true
                        ? "🟢 Available"
                        : item.available === false
                        ? "🔴 Taken"
                        : "⚪ Unknown"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}