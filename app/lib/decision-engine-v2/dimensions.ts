// Decision Engine V2 -- per-dimension assessment.
//
// PHASE 3 (the central requirement): every dimension here can land on
// "unknown" when the evidence needed to judge it simply is not
// available. "unknown" NEVER contributes a negative score to the
// market-quality aggregate in engine.ts -- it only reduces evidence
// completeness. This is the direct fix for the root cause found during
// investigation: the legacy engine's financialEvidence/competitive-
// Evidence/etc. dimensions are evidence-VOLUME metrics that get blended
// into the decision threshold regardless of whether the underlying
// findings are favorable or unfavorable. Every dimension below instead
// asks two SEPARATE questions -- "do we have evidence" and "what does
// that evidence say" -- and only the second question feeds market
// quality.
//
// Reads exclusively from already-computed structured evidence
// (MarketIntelligenceGraph, MarketResearchCoverage) and already-
// generated report section text (via evidence-signals.ts's deterministic
// scanners) -- no new AI or search calls (PHASE 9).

import type { MarketIntelligenceGraph } from "@/app/lib/ai/market-intelligence-graph";
import type { MarketResearchCoverage } from "@/app/lib/ai/market-research-coverage";
import type { MarketReportField } from "@/app/lib/report-engine/prompts/market";
import type { DimensionAssessment, DimensionKey } from "./types.ts";
import {
  competitionMildPatterns,
  competitionSeverePatterns,
  demandNegativePatterns,
  demandPositivePatterns,
  differentiationNegativePatterns,
  differentiationPositivePatterns,
  economicNegativePatterns,
  economicPositivePatterns,
  executionEasierPatterns,
  executionHarderPatterns,
  regulatoryManageableBurdenPatterns,
  regulatoryMaterialRiskPatterns,
  regulatoryProhibitionPatterns,
  regulatoryUncertaintyPatterns,
  scanFields,
  type SignalScan,
} from "./evidence-signals.ts";

export type DecisionEngineV2Input = {
  sections: Partial<Record<MarketReportField, string>>;
  coverage: MarketResearchCoverage;
  graph: MarketIntelligenceGraph;
};

function dimension(
  key: DimensionKey,
  state: DimensionAssessment["state"],
  options: {
    score?: number | null;
    supportingEvidence?: string[];
    contradictingEvidence?: string[];
    uncertainty?: DimensionAssessment["uncertainty"];
    evidenceRefs?: string[];
    rationale: string;
    isHardBlocker?: boolean;
  }
): DimensionAssessment {
  const defaultScoreByState: Record<DimensionAssessment["state"], number | null> = {
    strong: 85,
    favorable: 65,
    neutral: 50,
    unfavorable: 35,
    weak: 15,
    unknown: null,
  };

  return {
    key,
    state,
    score: options.score !== undefined ? options.score : defaultScoreByState[state],
    supportingEvidence: options.supportingEvidence || [],
    contradictingEvidence: options.contradictingEvidence || [],
    uncertainty: options.uncertainty || (state === "unknown" ? "high" : "medium"),
    evidenceRefs: options.evidenceRefs || [],
    rationale: options.rationale,
    isHardBlocker: options.isHardBlocker,
  };
}

function excerpts(scan: SignalScan, max = 2) {
  return {
    supporting: scan.positive.slice(0, max).map((m) => m.sentence),
    contradicting: scan.negative.slice(0, max).map((m) => m.sentence),
  };
}

function citationCount(text: string) {
  return (text.match(/\[R\d+\]/g) || []).length;
}

// --- 1. Market attractiveness ------------------------------------------

export function assessMarketAttractiveness(input: DecisionEngineV2Input): DimensionAssessment {
  const { graph, sections } = input;
  const demandScan = scanFields(
    sections,
    ["marketDrivers", "marketOverview", "industryTrends"],
    demandPositivePatterns,
    demandNegativePatterns
  );
  const { supporting, contradicting } = excerpts(demandScan);

  const hasQuantitativeSizing =
    graph.verifiedMarketSize.length > 0 ||
    (graph.planningEstimate !== null && graph.planningEstimate.tier === "supportedEstimate");
  const hasDirectionalSizing =
    graph.planningEstimate !== null && graph.planningEstimate.tier === "directional";
  const hasCagrEvidence = graph.cagr.length > 0;
  const evidenceRefs = [
    ...graph.verifiedMarketSize.flatMap((v) => v.evidenceIds),
    ...(graph.planningEstimate?.evidenceIds || []),
    ...graph.cagr.flatMap((c) => c.evidenceIds),
  ];

  if (demandScan.negative.length > 0 && demandScan.positive.length === 0) {
    return dimension("marketAttractiveness", contradicting.length > 1 ? "weak" : "unfavorable", {
      contradictingEvidence: contradicting,
      uncertainty: "medium",
      evidenceRefs,
      rationale:
        "Report prose describes declining, shrinking, or saturated demand, with no offsetting positive demand signal found.",
    });
  }

  if (hasQuantitativeSizing && demandScan.positive.length > 0) {
    return dimension("marketAttractiveness", "strong", {
      supportingEvidence: supporting,
      uncertainty: "low",
      evidenceRefs,
      rationale:
        "A verified or well-supported market-size figure exists and is corroborated by explicit positive demand language in the report's own prose.",
    });
  }

  if (hasQuantitativeSizing || (hasDirectionalSizing && demandScan.positive.length > 0)) {
    return dimension("marketAttractiveness", "favorable", {
      supportingEvidence: supporting,
      uncertainty: hasQuantitativeSizing ? "low" : "medium",
      evidenceRefs,
      rationale: hasQuantitativeSizing
        ? "A verified or well-supported market-size figure exists for this category."
        : "A directional (proxy-derived) market-size estimate exists and is corroborated by positive demand language.",
    });
  }

  if (demandScan.positive.length > 0) {
    // PHASE 3's central example: strong qualitative demand evidence with
    // incomplete TAM must read as favorable, not unknown or negative.
    return dimension("marketAttractiveness", "favorable", {
      supportingEvidence: supporting,
      uncertainty: "medium",
      evidenceRefs,
      rationale:
        "No independently verified market-size figure exists, but the report's own prose describes concrete, specific positive demand signals for this category.",
    });
  }

  if (hasCagrEvidence) {
    return dimension("marketAttractiveness", "neutral", {
      uncertainty: "medium",
      evidenceRefs,
      rationale: "Category growth-rate evidence exists but no market-size figure or explicit demand narrative was found.",
    });
  }

  return dimension("marketAttractiveness", "unknown", {
    rationale:
      "No verified market-size figure, directional estimate, or explicit demand narrative was found for this category -- market attractiveness cannot be assessed from current evidence. This is an evidence gap, not a finding that the market is unattractive.",
  });
}

// --- 2. Customer / problem evidence --------------------------------------

export function assessCustomerProblemEvidence(input: DecisionEngineV2Input): DimensionAssessment {
  const { sections } = input;
  const text = sections.customerSegments || "";
  const citations = citationCount(text);
  const overviewCitations = citationCount(sections.marketOverview || "");
  const totalCitations = citations + overviewCitations;

  if (!text.trim()) {
    return dimension("customerProblemEvidence", "unknown", {
      rationale: "No customer-segment content was generated for this report.",
    });
  }

  if (totalCitations >= 3) {
    return dimension("customerProblemEvidence", "favorable", {
      uncertainty: "medium",
      rationale: `Customer-segment discussion cites ${totalCitations} independent evidence reference(s), indicating grounded (not purely inferred) claims about buyers and their needs.`,
    });
  }

  if (totalCitations >= 1) {
    return dimension("customerProblemEvidence", "neutral", {
      uncertainty: "medium",
      rationale: `Customer-segment discussion cites ${totalCitations} evidence reference(s) -- partially grounded, but too thin to weigh heavily either way.`,
    });
  }

  return dimension("customerProblemEvidence", "unknown", {
    rationale:
      "Customer-segment content exists but cites no independent evidence -- the underlying problem/customer validation cannot be distinguished from inference.",
  });
}

// --- 3. Competitive intensity --------------------------------------------

export function assessCompetitiveIntensity(input: DecisionEngineV2Input): DimensionAssessment {
  const { graph, sections } = input;
  const competitorScan = scanFields(
    sections,
    ["competitiveLandscape", "majorPlayers"],
    competitionMildPatterns,
    competitionSeverePatterns
  );
  const { supporting, contradicting } = excerpts(competitorScan);
  const validatedCompetitorCount = graph.competitors.length;
  const adjacentPlayerCount = graph.vendorIntelligence.adjacentPlayers.length;
  const evidenceRefs = graph.competitors.flatMap((c) => c.evidenceIds).slice(0, 6);

  if (validatedCompetitorCount === 0 && adjacentPlayerCount === 0 && competitorScan.negative.length === 0) {
    // INVARIANT / TEST SCENARIO J: missing competitor data must produce
    // uncertainty, never an automatic negative competitive judgment.
    return dimension("competitiveIntensity", "unknown", {
      rationale:
        "No validated direct competitors or adjacent players were identified, and no competitive-intensity language was found in the report's own prose -- competitive intensity cannot be assessed, which is an evidence gap, not evidence of a favorable or unfavorable competitive position.",
    });
  }

  if (competitorScan.negative.length > 0) {
    return dimension("competitiveIntensity", competitorScan.negative.length > 1 ? "weak" : "unfavorable", {
      contradictingEvidence: contradicting,
      evidenceRefs,
      uncertainty: "medium",
      rationale:
        "Competitive-landscape prose describes entrenched incumbents, high switching costs, network effects, or an otherwise dominant competitive structure.",
    });
  }

  if (competitorScan.positive.length > 0) {
    return dimension("competitiveIntensity", "favorable", {
      supportingEvidence: supporting,
      evidenceRefs,
      uncertainty: "medium",
      rationale:
        "Competitive-landscape prose describes a fragmented market or the absence of a clear dominant player, suggesting room for a new entrant.",
    });
  }

  if (validatedCompetitorCount > 0) {
    return dimension("competitiveIntensity", "neutral", {
      evidenceRefs,
      uncertainty: "medium",
      rationale: `${validatedCompetitorCount} validated competitor(s) were identified, but the report's prose does not clearly describe the competitive structure as favorable or unfavorable for a new entrant.`,
    });
  }

  return dimension("competitiveIntensity", "unknown", {
    rationale:
      "Only adjacent/platform players were identified, with no validated direct competitor and no clear competitive-intensity language -- competitive intensity cannot be confidently assessed.",
  });
}

// --- 4. Differentiation potential -----------------------------------------

export function assessDifferentiationPotential(input: DecisionEngineV2Input): DimensionAssessment {
  const scan = scanFields(
    input.sections,
    ["opportunities", "strategicRecommendations"],
    differentiationPositivePatterns,
    differentiationNegativePatterns
  );
  const { supporting, contradicting } = excerpts(scan);

  if (scan.negative.length > 0 && scan.positive.length === 0) {
    return dimension("differentiationPotential", "unfavorable", {
      contradictingEvidence: contradicting,
      uncertainty: "medium",
      rationale: "Report prose describes the offering as commoditized, easily replicated, or undifferentiated.",
    });
  }

  if (scan.positive.length > 0) {
    return dimension("differentiationPotential", "favorable", {
      supportingEvidence: supporting,
      uncertainty: "medium",
      rationale: "Report prose identifies a specific, named differentiation angle or unmet need.",
    });
  }

  return dimension("differentiationPotential", "unknown", {
    rationale: "No explicit differentiation angle or commoditization risk was described in the report's own prose.",
  });
}

// --- 5. Economic viability -------------------------------------------------
//
// Two independent evidence CHANNELS feed this dimension: graph-validated
// vendor pricing (hasPricingEvidence, structured) and the report's own
// prose sentiment about margins/pricing (the scan, textual). The
// original implementation required pricing evidence AND (sentiment OR a
// calculated TAM) before ever returning "favorable" -- so a report with
// clear, explicit positive economic language ("healthy margins and
// attractive pricing") but no graph-validated pricing evidence fell
// through every branch and landed on "unknown", discarding real
// evidence. This is the same class of bug already fixed for
// marketAttractiveness (qualitative demand text alone is sufficient
// there) and regulatoryLegalExposure (severity tiers) -- each
// independent, credible channel should be able to support a verdict on
// its own; only their CONVERGENCE should earn the strongest tier, never
// their joint presence as a hard requirement.
//
// A second bug this fixes: the original negative branch only fired when
// `scan.positive.length === 0`, so a report containing BOTH a positive
// and a negative economic claim silently fell through toward
// "favorable" (if pricing evidence happened to exist) -- a real
// contradiction was never surfaced. Checked first, below.
export function assessEconomicViability(input: DecisionEngineV2Input): DimensionAssessment {
  const { graph, sections } = input;
  const scan = scanFields(
    sections,
    ["marketSegmentation", "competitiveLandscape", "tamSamSom"],
    economicPositivePatterns,
    economicNegativePatterns
  );
  const { supporting, contradicting } = excerpts(scan);
  const hasPricingEvidence = graph.pricingModels.length > 0;
  const hasCalculatedTam =
    graph.planningEstimate !== null || graph.verifiedMarketSize.length > 0;
  const evidenceRefs = graph.pricingModels.flatMap((p) => p.evidenceIds);
  const hasPositiveText = scan.positive.length > 0;
  const hasNegativeText = scan.negative.length > 0;

  // ADVERSARIAL SCENARIO 4: contradictory evidence (both a positive and
  // a negative economic claim in the report's own prose) must lower
  // certainty, not be silently resolved toward whichever branch happens
  // to check first -- mirrors how the decision level already treats
  // cross-dimension contradiction (TEST SCENARIO G), applied here
  // within a single dimension's own evidence.
  if (hasPositiveText && hasNegativeText) {
    return dimension("economicViability", "neutral", {
      supportingEvidence: supporting,
      contradictingEvidence: contradicting,
      evidenceRefs,
      uncertainty: "high",
      rationale:
        "Report prose contains both positive (e.g. healthy margins, attractive pricing) and negative (e.g. thin margins, price sensitivity) economic signals for this category -- contradictory evidence, which lowers certainty rather than resolving in either direction.",
    });
  }

  if (hasNegativeText) {
    return dimension("economicViability", "unfavorable", {
      contradictingEvidence: contradicting,
      evidenceRefs,
      uncertainty: "medium",
      rationale: "Report prose describes thin margins, price sensitivity, or unsustainable unit economics for this category.",
    });
  }

  // Strongest tier: two INDEPENDENT evidence channels (graph-validated
  // pricing + explicit positive sentiment) converge -- mirrors
  // assessMarketAttractiveness's "hasQuantitativeSizing && positive
  // demand text -> strong" convention for the same reason: agreement
  // across independent sources earns low uncertainty, not just a
  // slightly better score.
  if (hasPricingEvidence && hasPositiveText) {
    return dimension("economicViability", "strong", {
      supportingEvidence: supporting,
      evidenceRefs,
      uncertainty: "low",
      rationale:
        "Real, cited vendor pricing evidence AND explicit positive economic language (e.g. healthy margins, attractive pricing) both exist for this category and corroborate each other.",
    });
  }

  if (hasPricingEvidence && hasCalculatedTam) {
    return dimension("economicViability", "favorable", {
      evidenceRefs,
      uncertainty: "medium",
      rationale: "Real, cited vendor pricing evidence exists alongside a calculated market-size estimate for this category, supporting a viable spend/unit-economics baseline even without explicit margin language.",
    });
  }

  if (hasPricingEvidence) {
    return dimension("economicViability", "neutral", {
      evidenceRefs,
      uncertainty: "medium",
      rationale: "Vendor pricing evidence exists, but no explicit margin or unit-economics language was found.",
    });
  }

  // THE FIX: a real, specific, positive economic claim in the report's
  // own prose is sufficient on its own -- no independently validated
  // pricing evidence is required to credit it, the same qualitative
  // fallback assessMarketAttractiveness already gives demand claims.
  if (hasPositiveText) {
    return dimension("economicViability", "favorable", {
      supportingEvidence: supporting,
      uncertainty: "medium",
      rationale:
        "No independently validated pricing evidence exists, but the report's own prose describes a concrete, specific positive economic signal (e.g. healthy margins, attractive pricing, strong willingness to pay) for this category.",
    });
  }

  if (hasCalculatedTam) {
    return dimension("economicViability", "neutral", {
      uncertainty: "medium",
      rationale: "A market-size estimate exists for this category, but no independent pricing evidence or margin/economics language was found.",
    });
  }

  return dimension("economicViability", "unknown", {
    rationale:
      "No independently sourced pricing evidence and no explicit margin or economics language were found for this category -- economic viability cannot be assessed from current evidence.",
  });
}

// --- 6. Execution feasibility ----------------------------------------------

export function assessExecutionFeasibility(input: DecisionEngineV2Input): DimensionAssessment {
  const scan = scanFields(
    input.sections,
    ["barriers", "industryTrends"],
    executionEasierPatterns,
    executionHarderPatterns
  );
  const { supporting, contradicting } = excerpts(scan);

  if (scan.negative.length > 0 && scan.positive.length === 0) {
    return dimension("executionFeasibility", scan.negative.length > 1 ? "weak" : "unfavorable", {
      contradictingEvidence: contradicting,
      uncertainty: "medium",
      rationale: "Report prose describes long sales cycles, high capital requirements, or complex integration as execution barriers.",
    });
  }

  if (scan.positive.length > 0) {
    return dimension("executionFeasibility", "favorable", {
      supportingEvidence: supporting,
      uncertainty: "medium",
      rationale: "Report prose describes low capital requirements, existing distribution channels, or short sales cycles.",
    });
  }

  return dimension("executionFeasibility", "unknown", {
    rationale: "No explicit execution-difficulty language (sales cycle, capital intensity, integration complexity) was found.",
  });
}

// --- 7. Regulatory / legal exposure ----------------------------------------

// Deliberately one-directional AND severity-tiered. Absence of
// regulatory discussion is scored NEUTRAL, not "unknown" -- most
// markets genuinely carry no material regulatory exposure, and treating
// silence as a gap would manufacture a validation requirement for a
// large fraction of ordinary commercial-software markets that simply
// have nothing to report here.
//
// Checked most-severe-first, because a report can (and does, in real
// research prose) contain BOTH a generic compliance mention AND a
// genuine blocker in different sentences -- the more severe finding
// must win, not whichever pattern list happens to be checked last.
//
// Only the prohibition tier sets isHardBlocker: a specific, material
// risk (e.g. "requires FDA approval") is real and should weigh against
// the opportunity through the ordinary weighted blend, but it is not by
// itself evidence the business cannot operate -- many FDA-regulated
// businesses operate successfully, at higher cost/patience. Conflating
// "this is harder" with "this is impossible" was the original weakness:
// a genuine prohibition could get diluted into an ordinary CONDITIONAL_GO
// by an otherwise-strong market. Only an explicit statement of
// inability to legally/practically operate should bypass that blend.
// A prohibition-pattern match ("not permitted to operate", "cannot
// legally operate") is meant to detect a CATEGORICAL, business-ending
// finding -- but that exact phrasing also naturally appears in real
// research prose describing a PARTIAL, regional restriction ("not
// permitted to operate in some states"), which is real regulatory risk
// but is NOT evidence the business cannot operate at all. Confirmed via
// adversarial testing: the phrase alone, without this check, set
// isHardBlocker on a sentence that explicitly said the business
// "operates legally elsewhere" in the very same sentence. Since
// isHardBlocker bypasses every other dimension unconditionally, the bar
// for it must be held to a categorical, unqualified finding -- a
// same-sentence scope qualifier downgrades the match to the ordinary
// material-risk tier instead of discarding it.
const PARTIAL_SCOPE_QUALIFIER_PATTERN =
  /\bin\s+(?:some|certain|several|a\s+few|many|most)\s+(?:states?|jurisdictions?|regions?|markets?|countries?|counties?|provinces?)\b/i;

function describesOnlyPartialScope(sentence: string): boolean {
  return PARTIAL_SCOPE_QUALIFIER_PATTERN.test(sentence);
}

export function assessRegulatoryLegalExposure(input: DecisionEngineV2Input): DimensionAssessment {
  const fields = ["barriers", "threats", "industryTrends"] as const;

  const prohibitionScan = scanFields(input.sections, fields, [], regulatoryProhibitionPatterns);
  const categoricalProhibition = prohibitionScan.negative.filter((m) => !describesOnlyPartialScope(m.sentence));
  const partialScopeProhibition = prohibitionScan.negative.filter((m) => describesOnlyPartialScope(m.sentence));

  if (categoricalProhibition.length > 0) {
    return dimension("regulatoryLegalExposure", "weak", {
      contradictingEvidence: categoricalProhibition.slice(0, 3).map((m) => m.sentence),
      uncertainty: "low",
      score: 5,
      isHardBlocker: true,
      rationale:
        "Report prose explicitly states the business cannot legally or practically operate in this category (e.g. prohibited, banned, or no obtainable license) -- a material blocker, not a generic regulatory caution, and material enough on its own to outweigh how attractive the rest of the market looks.",
    });
  }

  const riskScan = scanFields(input.sections, fields, [], regulatoryMaterialRiskPatterns);
  const combinedRiskMatches = [...riskScan.negative, ...partialScopeProhibition];
  if (combinedRiskMatches.length > 0) {
    const contradicting = combinedRiskMatches.slice(0, 3).map((m) => m.sentence);
    return dimension("regulatoryLegalExposure", combinedRiskMatches.length > 1 ? "weak" : "unfavorable", {
      contradictingEvidence: contradicting,
      uncertainty: "low",
      rationale:
        partialScopeProhibition.length > 0 && riskScan.negative.length === 0
          ? "Report prose describes a regulatory restriction limited to part of the addressable market (e.g. specific states or jurisdictions) rather than a categorical prohibition -- real enough to weigh against the opportunity, but not evidence the business cannot operate at all."
          : "Report prose names a specific, material regulatory or legal risk (required approval, heavy regulation, active compliance or legal exposure) for this category -- real enough to weigh against the opportunity, but not on its own evidence that the business cannot operate at all.",
    });
  }

  const uncertaintyScan = scanFields(input.sections, fields, [], regulatoryUncertaintyPatterns);
  if (uncertaintyScan.negative.length > 0) {
    const { contradicting } = excerpts(uncertaintyScan, 2);
    return dimension("regulatoryLegalExposure", "unknown", {
      contradictingEvidence: contradicting,
      uncertainty: "high",
      rationale:
        "Report prose describes the regulatory status as unresolved or not yet determined -- this is a genuine evidence gap, not a finding that the category is blocked or that it is clear.",
    });
  }

  const burdenScan = scanFields(input.sections, fields, [], regulatoryManageableBurdenPatterns);
  if (burdenScan.negative.length > 0) {
    return dimension("regulatoryLegalExposure", "neutral", {
      uncertainty: "medium",
      score: 50,
      rationale:
        "Report prose mentions only routine, generic compliance or licensing language typical of nearly any ordinary business in this category -- named for transparency, but not treated as a material regulatory risk.",
    });
  }

  return dimension("regulatoryLegalExposure", "neutral", {
    uncertainty: "medium",
    rationale: "No regulatory, compliance, or legal blocker was described in the report's own prose.",
  });
}

export function assessAllDimensions(input: DecisionEngineV2Input): DimensionAssessment[] {
  return [
    assessMarketAttractiveness(input),
    assessCustomerProblemEvidence(input),
    assessCompetitiveIntensity(input),
    assessDifferentiationPotential(input),
    assessEconomicViability(input),
    assessExecutionFeasibility(input),
    assessRegulatoryLegalExposure(input),
  ];
}
