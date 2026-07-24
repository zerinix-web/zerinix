export type ReportQualityValidationResult = {
  validation_score: number;
  validation_warnings: string[];
  missing_sections: string[];
  duplicate_sections: string[];
};

const requiredSectionMatchers = [
  {
    label: "Executive Summary",
    matcher: /executive\s*summary|executiveSummary|yönetici\s*özeti/i,
  },
  {
    label: "Market Analysis",
    matcher:
      /market\s*(analysis|overview|opportunity)|marketOverview|marketOpportunity|pazar\s*(analizi|genel|fırsatı)|tamSamSom/i,
  },
  {
    label: "Business Model",
    matcher: /business\s*model|businessModel|iş\s*modeli/i,
  },
  {
    label: "Financial Overview",
    matcher:
      /financial\s*(overview|dashboard)|financialDashboard|unitEconomics|unit\s*economics|finansal|birim\s*ekonomisi/i,
  },
  {
    label: "Risks",
    matcher: /risks?|threats?|risk|tehdit/i,
  },
  {
    label: "Recommendations",
    matcher: /recommendation|recommendations|executiveRecommendation|tavsiye|öneri/i,
  },
];

const numericSectionMatcher =
  /financial|unitEconomics|unit\s*economics|tamSamSom|market|scenario|kpi|finansal|pazar|senaryo/i;

function normalizeKey(value: string) {
  return value.trim().replace(/[_-]+/g, " ").replace(/\s+/g, " ").toLowerCase();
}

function normalizeParagraph(value: string) {
  return value
    .trim()
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function getRepeatedParagraphs(sections: Array<[string, string]>) {
  const seen = new Map<string, string>();
  const duplicates = new Set<string>();

  for (const [sectionKey, content] of sections) {
    const paragraphs = content
      .split(/\n{2,}|(?<=\.)\s+(?=[A-ZÇĞİÖŞÜ])/)
      .map(normalizeParagraph)
      .filter((paragraph) => paragraph.length >= 90);

    for (const paragraph of paragraphs) {
      const previousSection = seen.get(paragraph);

      if (previousSection && previousSection !== sectionKey) {
        duplicates.add(`${previousSection} / ${sectionKey}`);
      } else {
        seen.set(paragraph, sectionKey);
      }
    }
  }

  return [...duplicates];
}

export function validateGeneratedReportSections(
  report: Record<string, string>
): ReportQualityValidationResult {
  const sections = Object.entries(report).filter(
    ([, content]) => typeof content === "string" && content.trim().length > 0
  );
  const normalizedKeys = sections.map(([key]) => normalizeKey(key));
  const missingSections = requiredSectionMatchers
    .filter((required) => !normalizedKeys.some((key) => required.matcher.test(key)))
    .map((required) => required.label);
  const duplicateSectionKeys = normalizedKeys.filter(
    (key, index) => normalizedKeys.indexOf(key) !== index
  );
  const repeatedParagraphs = getRepeatedParagraphs(sections);
  const duplicateSections = [...new Set([...duplicateSectionKeys, ...repeatedParagraphs])];
  const numericWarnings = sections
    .filter(([key]) => numericSectionMatcher.test(key))
    .filter(([, content]) => !/\d/.test(content))
    .map(([key]) => key);
  const validationWarnings = [
    ...missingSections.map((section) => `Missing required section: ${section}`),
    ...duplicateSections.map((section) => `Potential duplicate section/content: ${section}`),
    ...numericWarnings.map((section) => `Missing numeric data in section: ${section}`),
  ];
  const penalty =
    missingSections.length * 12 +
    duplicateSections.length * 7 +
    numericWarnings.length * 6;

  return {
    validation_score: Math.max(0, Math.min(100, 100 - penalty)),
    validation_warnings: validationWarnings,
    missing_sections: missingSections,
    duplicate_sections: duplicateSections,
  };
}
