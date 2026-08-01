import type {
  DecisionIntent,
  IntentDetection,
} from "./contracts";

const intentSignals: Array<{
  intent: DecisionIntent;
  signals: RegExp[];
  rationale: string;
}> = [
  {
    intent: "investment_decision",
    signals: [/\b(invest|investment decision|buy|acquire|yatırım|satın al)\b/i],
    rationale: "The user is evaluating whether to commit capital.",
  },
  {
    intent: "real_estate",
    signals: [/\b(property|land|parcel|title deed|zoning|tapu|arsa|parsel|imar)\b/i],
    rationale: "The request concerns a real-estate asset or land-use decision.",
  },
  {
    intent: "legal",
    signals: [/\b(contract|agreement|legal|clause|liability|sözleşme|hukuk|sorumluluk)\b/i],
    rationale: "The request requires legal or contractual risk analysis.",
  },
  {
    intent: "medical",
    signals: [/\b(medical|clinical|patient|drug|health|tıbbi|klinik|hasta|ilaç|sağlık)\b/i],
    rationale: "The request concerns clinical or healthcare evidence.",
  },
  {
    intent: "financial_analysis",
    signals: [/\b(financial|cash flow|forecast|valuation|margin|bilanço|finans|nakit akışı|değerleme)\b/i],
    rationale: "The request requires financial analysis or forecasting.",
  },
  {
    intent: "manufacturing",
    signals: [/\b(manufacturing|factory|production line|capacity|üretim|fabrika|kapasite)\b/i],
    rationale: "The request concerns manufacturing capacity or performance.",
  },
  {
    intent: "market_research",
    signals: [/\b(market research|market size|industry trends|pazar araştırması|pazar büyüklüğü|sektör trendleri)\b/i],
    rationale: "The user is seeking external market evidence.",
  },
  {
    intent: "competitor_analysis",
    signals: [/\b(competitor|competition|rakip|rekabet)\b/i],
    rationale: "The decision depends on competitor evidence.",
  },
  {
    intent: "pricing",
    signals: [/\b(pricing|price strategy|fiyatlandırma|fiyat stratejisi)\b/i],
    rationale: "The user is evaluating pricing.",
  },
  {
    intent: "expansion",
    signals: [/\b(expand|expansion|new market|büyüme|genişleme|yeni pazar)\b/i],
    rationale: "The user is evaluating expansion.",
  },
  {
    intent: "risk_assessment",
    signals: [/\b(risk|due diligence|review|risk assessment|risk|durum tespiti|inceleme)\b/i],
    rationale: "The user explicitly requests risk or due-diligence analysis.",
  },
  {
    intent: "operational_improvement",
    signals: [/\b(improve operations|workflow|efficiency|optimize|operasyon|iş akışı|verimlilik|optimize)\b/i],
    rationale: "The user wants to improve operational performance.",
  },
  {
    intent: "business_validation",
    signals: [/\b(validate|business idea|startup|iş fikri|girişim|doğrula)\b/i],
    rationale: "The user wants to validate a business proposition.",
  },
  {
    intent: "investment_opportunity",
    signals: [/\b(opportunity|deal|fırsat|yatırım fırsatı)\b/i],
    rationale: "The request is framed as an investment opportunity.",
  },
];

export function detectDecisionIntent(input: string): IntentDetection {
  const matches = intentSignals.filter(({ signals }) =>
    signals.some((signal) => signal.test(input))
  );
  const primary = matches[0]?.intent || "strategic_advisory";
  const secondary = [
    ...new Set(matches.slice(1).map(({ intent }) => intent)),
  ].slice(0, 4);
  const confidence = matches.length
    ? Math.min(96, 68 + Math.min(4, matches.length - 1) * 7)
    : 55;

  return {
    primary,
    secondary,
    confidence,
    rationale: matches.length
      ? matches.map(({ rationale }) => rationale)
      : ["The request is best handled as general strategic advisory."],
  };
}
