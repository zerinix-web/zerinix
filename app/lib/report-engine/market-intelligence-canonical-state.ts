// TASK #23 -- Market Intelligence persisted-report canonical data
// integrity.
//
// PROBLEM (confirmed via full-lifecycle audit: generation -> validation ->
// canonical structured report -> persistence -> reload -> UI -> PDF):
// today's `reports.metadata` column carries NOTHING Market-Intelligence-
// specific (confirmed: reports.metadata for a market_analysis row contains
// only reportLanguage, and optionally expertiseProfile/reportPlan/
// researchPlan -- see ReportMetadata in report-investment-score.ts). Every
// decision-critical fact (canonical decision, confidence, TAM/SAM/SOM
// values and their evidence methods, competitor/vendor evidence, citation
// registry) is generated ONCE as a rich, fully-typed MarketIntelligenceGraph
// + ExecutiveDecisionBrief in route.ts, then IMMEDIATELY flattened into
// prose strings (`sections`) and the structured objects are discarded.
// On every reload, page.tsx/Planner.tsx/ReportPdfButton.tsx each
// independently RE-PARSE that prose (regex/string-matching) to
// reconstruct an approximation of the same facts -- three separate
// reimplementations of the same interpretation, any of which can drift
// from the others or from what generation actually decided, and none of
// which are protected against the interpretation logic itself changing in
// a future deploy (a report finalized under old parsing rules would
// silently re-render under new ones on next view).
//
// FIX: this module defines a small, versioned, JSON-serializable snapshot
// of exactly the facts that must never drift (decision, confidence,
// decision-critical evidence pillars, TAM/SAM/SOM + methods/status,
// coverage dimensions, competitor evidence, citation registry) --
// captured ONCE, at generation time, straight from the already-computed
// MarketIntelligenceGraph/ExecutiveDecisionBrief with ZERO new
// interpretation logic (pure packaging, see buildMarketIntelligenceCanonicalState).
// It is persisted into `reports.metadata.marketIntelligenceCanonicalState`
// and re-read on load via readMarketIntelligenceCanonicalState, which is
// STRICTLY additive and version-gated (mirrors the exact
// `version === MARKET_INTELLIGENCE_GRAPH_VERSION` read-back guard already
// used for the short-lived AI response cache in research-cache.ts) --
// any report missing this field, or carrying a version this build does
// not recognize, safely returns null and every existing prose-parsing
// fallback path continues to run completely unchanged. No migration, no
// backfill, no destructive change to any existing persisted report.

import type { ResponseLanguage } from "@/app/lib/report-language";
import type {
  MarketIntelligenceGraph,
  MarketIntelligenceCompetitor,
  MarketIntelligenceSource,
  MarketPlanningEstimate,
} from "@/app/lib/ai/market-intelligence-graph";
import type { DecisionCriticalEvidenceState } from "@/app/lib/report-engine/market-intelligence-presentation";
import {
  type ExecutiveDecisionBrief,
  type ExecutiveDecisionCode,
  localizeExecutiveDecision,
} from "@/app/lib/report-engine/executive-decision-brief";
import {
  resolveMarketIntelligenceExecutiveDecision,
  mapExecutiveDecisionCodeToCanonicalDecision,
  type MarketIntelligenceExecutiveDecision,
} from "@/app/lib/report-engine/executive-decision-vocabulary";

export const MARKET_INTELLIGENCE_CANONICAL_STATE_VERSION = 1;

// A lean projection of MarketPlanningEstimate -- every field a reader-
// facing surface actually needs to show TAM/SAM/SOM and their evidence
// status without re-deriving it, none of the internal calculation-only
// fields (assumptions, formula, geography, year, ...) that exist purely
// for the report's own prose generation and aren't part of the drift-
// sensitive surface this task is hardening.
export type MarketIntelligenceCanonicalMarketSizing = Pick<
  MarketPlanningEstimate,
  | "tam"
  | "sam"
  | "som"
  | "method"
  | "tier"
  // Whether SAM's serviceable-share ratio came from real evidence or the
  // disclosed default assumption -- the exact field
  // resolveDecisionCriticalEvidenceState gates obtainableShareResolved on
  // (route.ts). Persisting it verbatim is what makes "unresolved SOM
  // cannot become numeric after reload" a structural guarantee rather
  // than something a future prose-parser could get wrong.
  | "samMethod"
  // "pending" means som is a non-numeric explanation, never a fabricated
  // figure -- see MarketPlanningEstimate's own comment in
  // market-intelligence-graph.ts.
  | "somStatus"
  | "conflicting"
  | "conflictNote"
  | "confidence"
  | "confidenceLevel"
>;

export type MarketIntelligenceCanonicalCitationSource = Pick<
  MarketIntelligenceSource,
  "evidenceId" | "title" | "publisher" | "url" | "sourceType" | "confidenceLevel"
>;

export type MarketIntelligenceCanonicalState = {
  version: typeof MARKET_INTELLIGENCE_CANONICAL_STATE_VERSION;
  // The exact ExecutiveDecisionCode (GO/CONDITIONAL_GO/NO_GO) computed by
  // buildMarketExecutiveDecisionBrief at generation time -- the same value
  // used to build the Tier-1 "Decision: TOKEN" banner baked into
  // executiveSummary's prose. Reading THIS instead of re-parsing that
  // banner text is what makes drift like MONITOR -> ENTER structurally
  // impossible on reload: there is no re-interpretation step left to
  // drift.
  decision: ExecutiveDecisionCode;
  confidence: number;
  confidenceDirection: ExecutiveDecisionBrief["confidenceDirection"];
  topRisks: string[];
  topReasons: string[];
  // The 3-pillar gate resolveDecisionCriticalEvidenceState (route.ts)
  // already computes from the graph -- persisted verbatim so "Validation
  // Required -> Verified" drift is impossible: a reader on reload sees
  // the exact same pillar-resolved booleans generation itself gated the
  // decision on, not a fresh re-derivation from whatever the report's
  // prose happens to say today.
  decisionCriticalEvidence: DecisionCriticalEvidenceState;
  marketSizing: MarketIntelligenceCanonicalMarketSizing | null;
  coverage: {
    overallConfidence: number;
    dimensions: MarketIntelligenceGraph["coverage"]["dimensions"];
  };
  // The already-curated, decision-relevant projection of vendor evidence
  // (MarketIntelligenceCompetitor -- name/positioning/pricingEvidence/
  // confidence/evidenceIds) -- NOT the full internal VendorIntelligence[]
  // (rankingScore, overallVendorScore, discovery/query logs, ...), which
  // market-intelligence-graph.ts's own projectMarketIntelligenceGraphToReport
  // already deliberately excludes even from the report's OWN prose as
  // "internal-only, never surfaced". Persisting a wider array than what
  // generation itself already treats as reader-facing would be a new
  // exposure decision this task was not asked to make -- see this
  // module's own top-of-file comment and the Task #23 final report for
  // the explicit architectural boundary.
  competitors: MarketIntelligenceCompetitor[];
  // The verified source registry (graph.sources) reduced to the fields a
  // citation card actually displays -- a stable, versioned snapshot of
  // "what does [R#] resolve to", independent of whatever the persisted
  // Sources bibliography TEXT says (which Task #22 already made
  // internally self-consistent; this is the structured counterpart, and
  // the artifact regression tests G/H check against directly rather than
  // re-parsing "Reference: [R#]" lines).
  citationSources: MarketIntelligenceCanonicalCitationSource[];
};

export function buildMarketIntelligenceCanonicalState(input: {
  graph: MarketIntelligenceGraph;
  decisionCriticalEvidence: DecisionCriticalEvidenceState;
  decisionBrief: ExecutiveDecisionBrief;
}): MarketIntelligenceCanonicalState {
  const { graph, decisionCriticalEvidence, decisionBrief } = input;
  const planningEstimate = graph.planningEstimate;

  return {
    version: MARKET_INTELLIGENCE_CANONICAL_STATE_VERSION,
    decision: decisionBrief.decision,
    confidence: decisionBrief.confidence,
    confidenceDirection: decisionBrief.confidenceDirection,
    topRisks: [...decisionBrief.topRisks],
    topReasons: [...decisionBrief.topReasons],
    decisionCriticalEvidence: { ...decisionCriticalEvidence },
    marketSizing: planningEstimate
      ? {
          tam: planningEstimate.tam,
          sam: planningEstimate.sam,
          som: planningEstimate.som,
          method: planningEstimate.method,
          tier: planningEstimate.tier,
          samMethod: planningEstimate.samMethod,
          somStatus: planningEstimate.somStatus,
          conflicting: planningEstimate.conflicting,
          conflictNote: planningEstimate.conflictNote,
          confidence: planningEstimate.confidence,
          confidenceLevel: planningEstimate.confidenceLevel,
        }
      : null,
    coverage: {
      overallConfidence: graph.coverage.overallConfidence,
      dimensions: { ...graph.coverage.dimensions },
    },
    competitors: graph.competitors.map((competitor) => ({ ...competitor, evidenceIds: [...competitor.evidenceIds] })),
    citationSources: graph.sources.map((source) => ({
      evidenceId: source.evidenceId,
      title: source.title,
      publisher: source.publisher,
      url: source.url,
      sourceType: source.sourceType,
      confidenceLevel: source.confidenceLevel,
    })),
  };
}

// Version-gated safe read-back -- mirrors research-cache.ts's
// `version === MARKET_INTELLIGENCE_GRAPH_VERSION` guard exactly. Returns
// null for: a report with no metadata, a report predating this field
// (100% of every report persisted before this task), a malformed value,
// or a version this build doesn't recognize (a downgrade, or a future
// version this build predates) -- in every one of those cases the caller
// must fall back to the pre-existing prose-parsing path, never guess or
// partially trust a shape it can't verify.
export function readMarketIntelligenceCanonicalState(
  metadata: unknown
): MarketIntelligenceCanonicalState | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;

  const state = (metadata as { marketIntelligenceCanonicalState?: unknown })
    .marketIntelligenceCanonicalState;
  if (!state || typeof state !== "object" || Array.isArray(state)) return null;

  return (state as Partial<MarketIntelligenceCanonicalState>).version ===
    MARKET_INTELLIGENCE_CANONICAL_STATE_VERSION
    ? (state as MarketIntelligenceCanonicalState)
    : null;
}

// Canonical-first decision resolution: when a persisted canonical state
// exists, the decision is read directly from it (Tier 0 -- ABOVE
// resolveMarketIntelligenceExecutiveDecision's own Tier 1 banner-parse),
// with zero re-interpretation of prose. Falls back to the existing,
// unmodified resolver (Tier 1/2/3, exactly as today) for any report
// without canonical state -- every legacy report renders identically to
// before this task. This is the single change point every UI/PDF caller
// needs to adopt to stop independently re-deriving the decision: it is a
// pure superset of the existing resolver's call signature (canonicalState
// first, then the same two args every caller already passes).
export function resolveMarketIntelligenceExecutiveDecisionWithCanonicalState(
  canonicalState: MarketIntelligenceCanonicalState | null,
  executiveSummaryContent: string,
  language: ResponseLanguage = "English"
): MarketIntelligenceExecutiveDecision {
  if (canonicalState) {
    return {
      decisionLabel: localizeExecutiveDecision(canonicalState.decision, language, "market"),
      decisionSource: "canonical-state",
      canonicalDecision: mapExecutiveDecisionCodeToCanonicalDecision(canonicalState.decision),
      confidenceScore: canonicalState.confidence,
      language,
    };
  }

  return resolveMarketIntelligenceExecutiveDecision(executiveSummaryContent, language);
}

// TASK #23 (follow-up) -- the degraded/graph-less persistence gap.
//
// INVESTIGATION: canonical state above is built only `if (graph &&
// marketExecutiveDecisionBrief)`. Tracing route.ts's actual data flow for
// BOTH the fresh-generation and cache-hit-reconstruction paths shows these
// two conditions are never actually independent -- `graph` truthy always
// implies `coverage` truthy (coverage is always derived using
// `graph.coverage` as its override in both applyMarketResearchCoverageToContext
// call sites), which always implies `marketExecutiveDecisionBrief` gets
// built (it only requires `coverage`). So there is exactly ONE real
// condition, not two: does this generation have a
// MarketIntelligenceGraph at all.
//
// `graph` (route.ts's `cachedMarketGraph`) is null ONLY when ALL THREE of
// its own fallbacks are unavailable: no live conversation-scoped research
// snapshot, no persisted graph in the cache row, AND no cached research
// bundle to rebuild one from (`cachedDomainResearch ?
// buildMarketIntelligenceGraph(cachedDomainResearch, ...) : null` --
// confirmed this ALWAYS succeeds whenever any research evidence is cached
// at all). In that exact state there is no evidence, no coverage, no
// decision brief, and nothing genuinely structured left to reconstruct --
// only the model's raw prose text. Building a "canonical state" from that
// would mean re-parsing prose and presenting the result as if it were the
// generation-time-authoritative snapshot, which is the exact anti-pattern
// this whole module exists to eliminate (Validation Required could read
// as Verified, an unresolved SOM could read as numeric, simply because
// SOME parser produced SOME value). CONCLUSION: it is not safe to
// reconstruct canonical state in this state -- confirmed, not assumed.
//
// FIX: this status is now always computed (never skipped) alongside
// canonical state, and persisted alongside it -- see
// serializeMarketReportMetadataChunk (route.ts). It gives every report a
// positive, explicit signal instead of a bare absence: "available" (a
// real canonical state exists), "unavailable_no_graph" (generation
// itself ran with no graph/evidence to snapshot -- deliberately not
// fabricated), or -- absent both fields entirely -- a report persisted
// before this mechanism existed at all (getMarketIntelligenceCanonicalStateAvailability's
// "legacy_unknown"). No UI/PDF surface currently branches on this distinction
// (out of scope for this pass); it exists so a degraded report can never
// be mistaken for, or silently treated as, a canonical one, and so this
// distinction is available for future observability/tooling without
// requiring a schema change later.
export type MarketIntelligenceCanonicalStateStatus = "available" | "unavailable_no_graph";

export function readMarketIntelligenceCanonicalStateStatus(
  metadata: unknown
): MarketIntelligenceCanonicalStateStatus | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;

  const status = (metadata as { marketIntelligenceCanonicalStateStatus?: unknown })
    .marketIntelligenceCanonicalStateStatus;
  return status === "available" || status === "unavailable_no_graph" ? status : null;
}

export type MarketIntelligenceCanonicalStateAvailability =
  | "available"
  | "unavailable_degraded"
  | "legacy_unknown";

// The single read-side entry point for "what do we actually know about
// this report's canonical state": "available" (use
// readMarketIntelligenceCanonicalState's result), "unavailable_degraded"
// (generation explicitly had no graph to snapshot -- fall back to prose
// parsing, and this is KNOWN to be why, not a mystery), or
// "legacy_unknown" (report predates this mechanism entirely -- fall back
// to prose parsing with no further information). Every branch falls back
// to the exact same pre-existing prose-parsing path; this function only
// ever changes what a caller can OBSERVE about why, never what gets
// rendered.
export function getMarketIntelligenceCanonicalStateAvailability(
  metadata: unknown
): MarketIntelligenceCanonicalStateAvailability {
  if (readMarketIntelligenceCanonicalState(metadata)) return "available";
  return readMarketIntelligenceCanonicalStateStatus(metadata) === "unavailable_no_graph"
    ? "unavailable_degraded"
    : "legacy_unknown";
}
