import { z } from "zod";
import type { EvidenceAcquisitionResult } from "./evidence-acquisition-engine.ts";
import type { EvidenceQualityScoringResult } from "./evidence-quality-scoring.ts";

// ZERINIX Live Research Engine v1.
//
// Before ZERINIX makes a strategic recommendation, it must decide
// whether additional live research is required first -- not perform
// that research itself (this module makes no network/AI calls and
// never invents a research finding), only detect the specific gap,
// explain why it matters, and describe what a live research task should
// look for.
//
// Detects exactly 5 named gaps: insufficient evidence, outdated
// evidence, missing market data, missing competitor intelligence, and
// missing financial evidence. Each detected gap becomes a prioritized
// task with a required-evidence checklist (methodology text describing
// what to look for -- never a claim about what would be found) and an
// expected decision impact (Low/Medium/High/Critical), and the overall
// result always reports the WORST impact found, never averaged down.
//
// Reuse, not re-detection: when Evidence Acquisition Engine's and/or
// Evidence Quality Scoring's already-computed results are supplied,
// every gap is derived directly from their real fields (missing
// categories, overall pool score, freshness dimension) -- never
// re-guessed. When neither is supplied, there is genuinely no evidence
// to point to, so every gap is honestly reported as detected (a pool of
// zero evidence really is insufficient, outdated-by-default, and
// missing every named category -- that is not a fabrication, it is the
// correct conclusion from having nothing to check).
//
// Scope (v1, standalone): this module makes no network/AI calls, never
// generates a report, and is not wired into any route, engine, PDF
// generation, UI, or billing. Feature-flagged via
// ZERINIX_LIVE_RESEARCH_ENGINE_ENABLED, defaulting to disabled (or pass
// `enabled: true`, primarily for tests) -- when disabled, no detection
// runs at all.

export const researchGapValues = [
  "insufficient_evidence",
  "outdated_evidence",
  "missing_market_data",
  "missing_competitor_intelligence",
  "missing_financial_evidence",
] as const;

export type ResearchGap = (typeof researchGapValues)[number];

export const liveResearchPriorityValues = ["critical", "high", "medium", "low"] as const;

export type LiveResearchPriority = (typeof liveResearchPriorityValues)[number];

export const decisionImpactValues = ["low", "medium", "high", "critical"] as const;

export type DecisionImpact = (typeof decisionImpactValues)[number];

export const LIVE_RESEARCH_ENGINE_ENABLED_ENV_VAR = "ZERINIX_LIVE_RESEARCH_ENGINE_ENABLED";

export function isLiveResearchEngineEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env[LIVE_RESEARCH_ENGINE_ENABLED_ENV_VAR] === "true";
}

const shortString = (max: number) => z.string().trim().min(1).max(max);

export const liveResearchTaskSchema = z
  .object({
    gap: z.enum(researchGapValues),
    priority: z.enum(liveResearchPriorityValues),
    topic: shortString(160),
    requiredEvidence: z.array(shortString(200)).min(1).max(6),
    expectedDecisionImpact: z.enum(decisionImpactValues),
    rationale: shortString(500),
  })
  .strict();

export type LiveResearchTask = z.infer<typeof liveResearchTaskSchema>;

export const liveResearchEngineResultSchema = z
  .object({
    enabled: z.boolean(),
    liveResearchRequired: z.boolean(),
    detectedGaps: z.array(z.enum(researchGapValues)).max(researchGapValues.length),
    tasks: z.array(liveResearchTaskSchema).max(researchGapValues.length),
    overallExpectedDecisionImpact: z.enum(decisionImpactValues).nullable(),
    explanation: shortString(800),
    scoringTrace: z.array(shortString(500)).max(30),
  })
  .strict();

export type LiveResearchEngineResult = z.infer<typeof liveResearchEngineResultSchema>;

export type LiveResearchEngineInput = {
  evidenceAcquisitionResult?: EvidenceAcquisitionResult;
  evidenceQualityResult?: EvidenceQualityScoringResult;
  // Explicit override, primarily for tests; when omitted, falls back to
  // the ZERINIX_LIVE_RESEARCH_ENGINE_ENABLED environment variable.
  enabled?: boolean;
};

const INSUFFICIENT_EVIDENCE_SCORE_THRESHOLD = 50;
const OUTDATED_FRESHNESS_THRESHOLD = 40;
const MISSING_EVIDENCE_MAJORITY_THRESHOLD = 5;

const MARKET_DATA_CATEGORIES = ["market_size", "cagr", "industry_trends"] as const;

function meanDimensionScore(
  result: EvidenceQualityScoringResult,
  dimension: "source_freshness"
): number | null {
  if (result.itemScores.length === 0) {
    return null;
  }
  const total = result.itemScores.reduce((sum, item) => {
    const entry = item.dimensionScores.find((d) => d.dimension === dimension);
    return sum + (entry?.score ?? 0);
  }, 0);
  return total / result.itemScores.length;
}

type GapDetection = {
  detected: boolean;
  impact: DecisionImpact;
  rationale: string;
};

function detectInsufficientEvidence(input: LiveResearchEngineInput): GapDetection {
  if (input.evidenceQualityResult) {
    const score = input.evidenceQualityResult.overallPoolScore;
    if (score >= INSUFFICIENT_EVIDENCE_SCORE_THRESHOLD) {
      return { detected: false, impact: "low", rationale: `Evidence Quality Scoring's overall pool score is ${score}.` };
    }
    const impact: DecisionImpact = score < 20 ? "critical" : score < 35 ? "high" : "medium";
    return {
      detected: true,
      impact,
      rationale: `Evidence Quality Scoring's overall pool score is ${score}, below the sufficiency threshold of ${INSUFFICIENT_EVIDENCE_SCORE_THRESHOLD}.`,
    };
  }

  if (input.evidenceAcquisitionResult) {
    const { missingEvidenceCount, externalVerifiedCount } = input.evidenceAcquisitionResult;
    if (missingEvidenceCount < MISSING_EVIDENCE_MAJORITY_THRESHOLD && externalVerifiedCount > 0) {
      return {
        detected: false,
        impact: "low",
        rationale: `Only ${missingEvidenceCount} evidence category/categories are missing, and ${externalVerifiedCount} are externally verified.`,
      };
    }
    return {
      detected: true,
      impact: missingEvidenceCount >= 8 ? "critical" : "high",
      rationale: `${missingEvidenceCount} of the 9 evidence categories are missing and ${externalVerifiedCount} are externally verified.`,
    };
  }

  return {
    detected: true,
    impact: "critical",
    rationale: "No evidence was supplied at all, so the evidence base is insufficient by definition.",
  };
}

function detectOutdatedEvidence(input: LiveResearchEngineInput): GapDetection {
  if (input.evidenceQualityResult) {
    const meanFreshness = meanDimensionScore(input.evidenceQualityResult, "source_freshness");
    if (meanFreshness === null) {
      return {
        detected: true,
        impact: "high",
        rationale: "Evidence Quality Scoring returned no evidence items, so freshness cannot be confirmed.",
      };
    }
    if (meanFreshness >= OUTDATED_FRESHNESS_THRESHOLD) {
      return { detected: false, impact: "low", rationale: `Mean source_freshness is ${Math.round(meanFreshness)}.` };
    }
    return {
      detected: true,
      impact: "high",
      rationale: `Mean source_freshness is ${Math.round(meanFreshness)}, below the freshness threshold of ${OUTDATED_FRESHNESS_THRESHOLD}.`,
    };
  }

  if (input.evidenceAcquisitionResult) {
    const datedEntries = Object.values(input.evidenceAcquisitionResult.evidence).filter(
      (entry) => entry.evidence_type !== "missing" && entry.date
    );
    if (datedEntries.length === 0) {
      return {
        detected: true,
        impact: "high",
        rationale: "None of the available evidence carries a publication date, so freshness cannot be confirmed.",
      };
    }
    return {
      detected: false,
      impact: "low",
      rationale: `${datedEntries.length} evidence item(s) carry a publication date.`,
    };
  }

  return {
    detected: true,
    impact: "high",
    rationale: "No evidence was supplied at all, so freshness cannot be confirmed.",
  };
}

function detectMissingMarketData(input: LiveResearchEngineInput): GapDetection {
  if (!input.evidenceAcquisitionResult) {
    return {
      detected: true,
      impact: "high",
      rationale: "No Evidence Acquisition Engine result was supplied, so market data cannot be confirmed present.",
    };
  }

  const missing = MARKET_DATA_CATEGORIES.filter(
    (category) => input.evidenceAcquisitionResult!.evidence[category].evidence_type === "missing"
  );
  if (missing.length === 0) {
    return { detected: false, impact: "low", rationale: "Market size, CAGR, and industry trend evidence are all present." };
  }
  return {
    detected: true,
    impact: missing.length === MARKET_DATA_CATEGORIES.length ? "high" : "medium",
    rationale: `The following market-data category/categories are marked missing: ${missing.join(", ")}.`,
  };
}

function detectMissingCompetitorIntelligence(input: LiveResearchEngineInput): GapDetection {
  if (!input.evidenceAcquisitionResult) {
    return {
      detected: true,
      impact: "medium",
      rationale: "No Evidence Acquisition Engine result was supplied, so competitor intelligence cannot be confirmed present.",
    };
  }

  const missing = input.evidenceAcquisitionResult.evidence.competitors.evidence_type === "missing";
  return missing
    ? { detected: true, impact: "medium", rationale: "The 'competitors' evidence category is marked missing." }
    : { detected: false, impact: "low", rationale: "Competitor evidence is present." };
}

function detectMissingFinancialEvidence(input: LiveResearchEngineInput): GapDetection {
  if (!input.evidenceAcquisitionResult) {
    return {
      detected: true,
      impact: "high",
      rationale: "No Evidence Acquisition Engine result was supplied, so financial evidence cannot be confirmed present.",
    };
  }

  const missing = input.evidenceAcquisitionResult.evidence.unit_economics_benchmarks.evidence_type === "missing";
  return missing
    ? { detected: true, impact: "high", rationale: "The 'unit_economics_benchmarks' evidence category is marked missing." }
    : { detected: false, impact: "low", rationale: "Unit economics benchmark evidence is present." };
}

const GAP_PRIORITY: Record<ResearchGap, LiveResearchPriority> = {
  insufficient_evidence: "critical",
  outdated_evidence: "high",
  missing_market_data: "high",
  missing_competitor_intelligence: "medium",
  missing_financial_evidence: "high",
};

const GAP_TOPIC: Record<ResearchGap, string> = {
  insufficient_evidence: "Strengthen the overall evidence base",
  outdated_evidence: "Refresh outdated evidence with current sources",
  missing_market_data: "Research market size, growth rate, and industry trends",
  missing_competitor_intelligence: "Research direct and indirect competitors",
  missing_financial_evidence: "Research unit economics benchmarks",
};

const GAP_REQUIRED_EVIDENCE: Record<ResearchGap, readonly string[]> = {
  insufficient_evidence: [
    "At least one externally verified, attributable source for the core decision-relevant claims",
    "A minimum evidence-quality score sufficient to support a recommendation",
  ],
  outdated_evidence: [
    "A source published within the last 12 months for each decision-relevant claim",
    "Confirmation that the underlying facts have not materially changed since the source's publication date",
  ],
  missing_market_data: [
    "Total or serviceable addressable market size with a cited source",
    "Market growth rate (CAGR) with a cited source",
    "Current industry trend data relevant to this decision",
  ],
  missing_competitor_intelligence: [
    "A list of direct competitors with sourced positioning or market-share data",
    "Evidence of competitor pricing or differentiation",
  ],
  missing_financial_evidence: [
    "Unit economics benchmarks (e.g. CAC, LTV, gross margin) for comparable businesses",
    "A cited source for each financial benchmark used",
  ],
};

const IMPACT_RANK: Record<DecisionImpact, number> = { low: 1, medium: 2, high: 3, critical: 4 };
const PRIORITY_RANK: Record<LiveResearchPriority, number> = { low: 1, medium: 2, high: 3, critical: 4 };

function disabledResult(): LiveResearchEngineResult {
  return {
    enabled: false,
    liveResearchRequired: false,
    detectedGaps: [],
    tasks: [],
    overallExpectedDecisionImpact: null,
    explanation: `Live Research Engine is disabled (set ${LIVE_RESEARCH_ENGINE_ENABLED_ENV_VAR}="true" to enable it).`,
    scoringTrace: [
      `Live Research Engine is disabled (${LIVE_RESEARCH_ENGINE_ENABLED_ENV_VAR} is not "true"); no detection ran.`,
    ],
  };
}

const GAP_DETECTORS: Record<ResearchGap, (input: LiveResearchEngineInput) => GapDetection> = {
  insufficient_evidence: detectInsufficientEvidence,
  outdated_evidence: detectOutdatedEvidence,
  missing_market_data: detectMissingMarketData,
  missing_competitor_intelligence: detectMissingCompetitorIntelligence,
  missing_financial_evidence: detectMissingFinancialEvidence,
};

export function detectLiveResearchNeed(input: LiveResearchEngineInput = {}): LiveResearchEngineResult {
  const enabled = input.enabled ?? isLiveResearchEngineEnabled();
  if (!enabled) {
    return disabledResult();
  }

  const scoringTrace: string[] = [];
  const detectedGaps: ResearchGap[] = [];
  const tasks: LiveResearchTask[] = [];

  for (const gap of researchGapValues) {
    const detection = GAP_DETECTORS[gap](input);
    scoringTrace.push(`${gap}: detected=${detection.detected} -- ${detection.rationale}`);

    if (!detection.detected) {
      continue;
    }

    detectedGaps.push(gap);
    tasks.push({
      gap,
      priority: GAP_PRIORITY[gap],
      topic: GAP_TOPIC[gap],
      requiredEvidence: [...GAP_REQUIRED_EVIDENCE[gap]],
      expectedDecisionImpact: detection.impact,
      rationale: detection.rationale,
    });
  }

  tasks.sort((a, b) => PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority]);

  const overallExpectedDecisionImpact =
    tasks.length === 0
      ? null
      : tasks.map((task) => task.expectedDecisionImpact).sort((a, b) => IMPACT_RANK[b] - IMPACT_RANK[a])[0];

  const explanation =
    tasks.length === 0
      ? "No additional live research is required based on the evidence currently available."
      : `Live research is required: ${detectedGaps.length} gap(s) detected (${detectedGaps.join(", ")}). The most significant expected impact is "${overallExpectedDecisionImpact}".`;

  scoringTrace.push(explanation);

  return {
    enabled: true,
    liveResearchRequired: tasks.length > 0,
    detectedGaps,
    tasks,
    overallExpectedDecisionImpact,
    explanation,
    scoringTrace,
  };
}
