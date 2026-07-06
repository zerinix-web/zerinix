type ResponseLanguage = "English" | "Turkish";

export function ceoAgent(prompt: string, language: ResponseLanguage = "English") {
  if (language === "Turkish") {
    return `Başlıklar: Executive Summary, Verdict, Confidence Score, TAM/SAM/SOM, Industry Trends, Competitor Analysis, Gap Analysis, Revenue Model, Go-To-Market, Risk Analysis, Financial Snapshot, AI Recommendation.
Önce sessizce Business Model, Customer, ICP, Market, Competition, TAM/SAM/SOM, Pricing, Revenue, GTM, Risks, Financial, Assumptions ve Founder priorities içeren tek bir Integrated Strategy Model kur.
Bağımlılık zincirini koru: Problem -> Solution -> Pricing -> Financial -> Runway -> Risk -> CEO Recommendation.
Financial zinciri: Revenue -> MRR -> Gross Margin -> CAC -> LTV -> Payback -> Burn -> Runway -> EBITDA.
CEO Decision bölümünde yalnızca bir karar seç: Launch, Delay, Pivot, Kill, Bootstrap, Raise, Acquire, Merge, Franchise, Licensing, Joint Venture.
McKinsey / BCG / Bain ve Sequoia yatırım notu kalitesinde yaz. Kısa, analitik ve kanıt odaklı ol. Her iddiada Evidence ve Confidence belirt. Hedef: ${prompt}`;
  }

  return `Headings: Executive Summary, Verdict, Confidence Score, TAM/SAM/SOM, Industry Trends, Competitor Analysis, Gap Analysis, Revenue Model, Go-To-Market, Risk Analysis, Financial Snapshot, AI Recommendation.
First silently build one Integrated Strategy Model containing Business Model, Customer, ICP, Market, Competition, TAM/SAM/SOM, Pricing, Revenue, GTM, Risks, Financial, Assumptions, and Founder priorities.
Preserve the dependency chain: Problem -> Solution -> Pricing -> Financial -> Runway -> Risk -> CEO Recommendation.
Financial chain: Revenue -> MRR -> Gross Margin -> CAC -> LTV -> Payback -> Burn -> Runway -> EBITDA.
In CEO Decision, select exactly one: Launch, Delay, Pivot, Kill, Bootstrap, Raise, Acquire, Merge, Franchise, Licensing, Joint Venture.
Write at McKinsey / BCG / Bain and Sequoia investment memo quality. Be concise, analytical, and evidence-led. Add Evidence and Confidence to every claim. Goal: ${prompt}`;
}
