import type { ReportQualityValidationResult } from "@/app/lib/report-quality-validation";
import type { SourceReliabilitySummary } from "@/app/lib/source-reliability";

export type ReportConfidenceLevel = "High" | "Medium" | "Low";

export type ReportConfidenceMetadata = {
  overall_confidence: ReportConfidenceLevel;
  section_confidence: Record<string, ReportConfidenceLevel>;
  confidence_reason_codes: string[];
};

type SectionGroup = {
  label: string;
  matcher: RegExp;
  numericExpected: boolean;
};

const sectionGroups: SectionGroup[] = [
  {
    label: "Executive Summary",
    matcher: /executive\s*summary|executiveSummary|yönetici\s*özeti/i,
    numericExpected: false,
  },
  {
    label: "Market Analysis",
    matcher:
      /market\s*(analysis|overview|opportunity)|marketOverview|marketOpportunity|tamSamSom|pazar\s*(analizi|genel|fırsatı)/i,
    numericExpected: true,
  },
  {
    label: "Business Model",
    matcher: /business\s*model|businessModel|iş\s*modeli/i,
    numericExpected: false,
  },
  {
    label: "Financial Overview",
    matcher:
      /financial\s*(overview|dashboard)|financialDashboard|unitEconomics|unit\s*economics|finansal|birim\s*ekonomisi/i,
    numericExpected: true,
  },
  {
    label: "Risks",
    matcher: /risks?|threats?|risk|tehdit/i,
    numericExpected: false,
  },
  {
    label: "Recommendations",
    matcher: /recommendation|recommendations|executiveRecommendation|tavsiye|öneri/i,
    numericExpected: false,
  },
];

function scoreToConfidence(score: number): ReportConfidenceLevel {
  if (score >= 75) {
    return "High";
  }

  if (score >= 50) {
    return "Medium";
  }

  return "Low";
}

function normalizeKey(value: string) {
  return value.trim().replace(/[_-]+/g, " ").replace(/\s+/g, " ").toLowerCase();
}

function readGroupContent(report: Record<string, string>, group: SectionGroup) {
  return Object.entries(report)
    .filter(([key]) => group.matcher.test(key) || group.matcher.test(normalizeKey(key)))
    .map(([, content]) => content)
    .join("\n");
}

export function evaluateReportConfidence(input: {
  report: Record<string, string>;
  validation: ReportQualityValidationResult;
  sources: SourceReliabilitySummary;
}): ReportConfidenceMetadata {
  const reasonCodes = new Set<string>();
  const sectionConfidence: Record<string, ReportConfidenceLevel> = {};
  const duplicateText = input.validation.duplicate_sections.join(" ").toLowerCase();
  const sourceScore = input.sources.average_source_score || 35;

  for (const group of sectionGroups) {
    const content = readGroupContent(input.report, group);
    const missing = input.validation.missing_sections.includes(group.label) || !content.trim();
    const duplicate = duplicateText.includes(group.label.toLowerCase());
    const hasNumericEvidence = /\d/.test(content);
    let score = 55;

    score += Math.round((sourceScore - 50) * 0.35);
    score += Math.round((input.validation.validation_score - 70) * 0.4);

    if (missing) {
      score -= 40;
      reasonCodes.add("missing_section");
    }

    if (duplicate) {
      score -= 18;
      reasonCodes.add("duplicate_content");
    }

    if (group.numericExpected && !hasNumericEvidence) {
      score -= 18;
      reasonCodes.add("missing_numeric_evidence");
    }

    if (sourceScore < 50) {
      score -= 12;
      reasonCodes.add("weak_sources");
    }

    if (input.sources.source_count === 0) {
      score -= 10;
      reasonCodes.add("no_sources_detected");
    }

    sectionConfidence[group.label] = scoreToConfidence(Math.max(0, Math.min(100, score)));
  }

  const confidenceScores = Object.values(sectionConfidence).map((level) =>
    level === "High" ? 85 : level === "Medium" ? 62 : 35
  );
  const averageScore = confidenceScores.length
    ? Math.round(confidenceScores.reduce((sum, score) => sum + score, 0) / confidenceScores.length)
    : 0;

  if (input.validation.validation_warnings.length > 0) {
    reasonCodes.add("validation_warnings_present");
  }

  return {
    overall_confidence: scoreToConfidence(averageScore),
    section_confidence: sectionConfidence,
    confidence_reason_codes: [...reasonCodes],
  };
}
