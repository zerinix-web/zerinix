const suggestionRules: Array<{
  pattern: RegExp;
  suggestions: string[];
}> = [
  {
    pattern: /\b(contract|agreement|nda|lease|sözleşme|anlaşma)\b/i,
    suggestions: ["Risk Review", "Summary", "Compliance"],
  },
  {
    pattern: /\b(market|industry|sector|pazar|sektör)\b/i,
    suggestions: ["Competitor Analysis", "Market Size", "Industry Trends"],
  },
  {
    pattern: /\b(business idea|startup|venture|iş fikri|girişim)\b/i,
    suggestions: ["Business Validation", "Market Intelligence", "Financial Projection"],
  },
  {
    pattern: /\b(competitor|competition|competitive|rakip|rekabet)\b/i,
    suggestions: ["Competitor Mapping", "Positioning", "Opportunity Gaps"],
  },
  {
    pattern: /\b(pricing|price|fiyat|ücret)\b/i,
    suggestions: ["Pricing Strategy", "Unit Economics", "Competitive Benchmarking"],
  },
  {
    pattern: /\b(finance|financial|forecast|cash flow|finans|nakit)\b/i,
    suggestions: ["Forecast", "Cash Flow", "Profitability"],
  },
];

/**
 * Composer chips intentionally use only a small, synchronous keyword lookup.
 * Full intent, URL, file, and recommendation detection runs after Analyze.
 */
export function getComposerSuggestions(value: string) {
  const prompt = value.trim();

  if (!prompt) {
    return [];
  }

  return (
    suggestionRules.find((rule) => rule.pattern.test(prompt))?.suggestions || [
      "Clarify Goal",
      "Strategic Options",
      "Recommended Next Steps",
    ]
  );
}
