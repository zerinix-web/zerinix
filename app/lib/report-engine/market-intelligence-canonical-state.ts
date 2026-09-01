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
import type { EvidenceLevel } from "@/app/lib/report-evidence";
import type {
  MarketIntelligenceGraph,
  MarketIntelligenceCompetitor,
  MarketIntelligenceSource,
  MarketPlanningEstimate,
} from "@/app/lib/ai/market-intelligence-graph";
import {
  type DecisionCriticalEvidenceState,
  type MarketIntelligenceConfidenceFactors,
  buildMarketIntelligenceConfidenceFactors,
} from "@/app/lib/report-engine/market-intelligence-presentation";
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

// TASK #24 -- bumped from 1 to 2: added why/missingEvidence/
// whatWouldChangeThisDecision/immediateNextAction (see
// MarketIntelligenceCanonicalState below) so the Executive Decision
// card's "Next Action" -- explicitly named in this task's audit -- has a
// canonical source instead of falling back to prose extraction even when
// canonical state is otherwise available. Safe to bump with zero
// migration concern: no report persisted before this task carries ANY
// canonical state at all (confirmed against the real persisted report
// used throughout this session), so there is no existing v1 data to
// stop reading -- readMarketIntelligenceCanonicalState's version gate
// means a hypothetical v1 object would simply be treated as absent
// (identical to a legacy report), never partially trusted.
// TASK #33 -- bumped from 2 to 3: source-provenance audit found
// marketSizing silently dropped planningEstimate's own evidenceIds (the
// TAM/SAM/SOM figure's real upstream source link -- present in the
// generated graph, discarded on persistence), and there was no canonical
// representation of CAGR's evidence at all. Both are added below. Safe
// to bump with zero migration concern, for the same reason Task #24's
// 1->2 bump was safe: no report persisted before this task carries
// version 3, so there is no existing v2 data to stop reading --
// readMarketIntelligenceCanonicalState's version gate means a
// hypothetical v2 object is simply treated as absent (identical to a
// legacy report), never partially trusted.
export const MARKET_INTELLIGENCE_CANONICAL_STATE_VERSION = 3;

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
  // TASK #33 -- the real upstream evidence-id link backing this TAM/SAM/
  // SOM figure (shared across all 3 layers -- see MarketPlanningEstimate's
  // own comment; there is no per-layer split in the generated graph
  // either). Previously generated but silently dropped on persistence --
  // a derived value with no way to trace its own derivation once
  // reloaded. Never widens what's already resolved: an empty array here
  // means exactly what it always meant (no qualifying evidence backs
  // this estimate), same as before this field existed.
  | "evidenceIds"
>;

export type MarketIntelligenceCanonicalCitationSource = Pick<
  MarketIntelligenceSource,
  "evidenceId" | "title" | "publisher" | "url" | "sourceType" | "confidenceLevel"
>;

// TASK #33 -- CAGR had no canonical representation at all: a growth-rate
// figure could be extracted from the cagr field's own prose (a bare
// percentage regex, report-presentation.ts) with zero way to confirm
// whether generation ever actually found a qualifying CAGR evidence item
// for it. Mirrors graph.cagr's own real shape (market-intelligence-
// graph.ts) reduced to what a reader-facing surface needs: the
// description text, its evidence-id link, and whether it was Verified or
// Estimated -- never a new classification, the SAME one generation
// already computed.
export type MarketIntelligenceCanonicalCagrEstimate = {
  description: string;
  evidenceIds: string[];
  confidenceClassification: "Verified" | "Estimated";
};

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
  // TASK #24 -- the Executive Decision card's remaining prose-derived
  // fields (its "Why", "Missing Evidence", "What Would Change This
  // Decision", and -- explicitly named in this task's audit -- "Next
  // Action"). Each is already a single, decision-consistent sentence
  // ExecutiveDecisionBrief computed once at generation time (e.g.
  // immediateNextAction "must match the decision -- never 'run a pilot'/
  // 'execute' under NO_GO", per its own type comment); persisting them
  // verbatim closes the same class of drift risk as `decision` itself,
  // for the one card field this task found still falling back to prose
  // extraction (extractMetricValueFromAliases) even when canonical state
  // was otherwise available.
  why: string;
  missingEvidence: string[];
  whatWouldChangeThisDecision: string;
  immediateNextAction: string;
  // The 3-pillar gate resolveDecisionCriticalEvidenceState (route.ts)
  // already computes from the graph -- persisted verbatim so "Validation
  // Required -> Verified" drift is impossible: a reader on reload sees
  // the exact same pillar-resolved booleans generation itself gated the
  // decision on, not a fresh re-derivation from whatever the report's
  // prose happens to say today.
  decisionCriticalEvidence: DecisionCriticalEvidenceState;
  marketSizing: MarketIntelligenceCanonicalMarketSizing | null;
  // TASK #33 -- every qualifying CAGR evidence item generation found for
  // this market (graph.cagr, verbatim) -- an empty array is itself
  // meaningful: it means no CAGR evidence qualified at all, which lets a
  // render-time consumer distinguish "no real CAGR evidence exists" from
  // "a number happens to appear somewhere in this section's prose" (a
  // bare percentage regex cannot tell the two apart on its own).
  cagr: MarketIntelligenceCanonicalCagrEstimate[];
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
    why: decisionBrief.why,
    missingEvidence: [...decisionBrief.missingEvidence],
    whatWouldChangeThisDecision: decisionBrief.whatWouldChangeThisDecision,
    immediateNextAction: decisionBrief.immediateNextAction,
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
          evidenceIds: [...planningEstimate.evidenceIds],
        }
      : null,
    cagr: graph.cagr.map((item) => ({
      description: item.description,
      evidenceIds: [...item.evidenceIds],
      confidenceClassification: item.confidenceClassification,
    })),
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

// TASK #29B -- the single shared source for the cover's per-dimension
// confidence-factor breakdown (Market/Financial/Execution/Product/Market
// Signals). Both inputs buildMarketIntelligenceConfidenceFactors needs
// (coverage.dimensions, decisionCriticalEvidence) are already part of
// MarketIntelligenceCanonicalState (see its own comment for why -- Task
// #23 persisted them for exactly this kind of derivation, no new field or
// version bump required), so this is a pure re-packaging: canonical state
// present -> real, deterministic factor levels; absent -> null, and every
// caller falls back to whatever it already rendered for a report with no
// canonical state (never a fabricated guess). page.tsx, ReportPdfButton.tsx,
// and Planner.tsx must all call this SAME function rather than invoking
// buildMarketIntelligenceConfidenceFactors directly with their own
// independently-sourced coverage/evidence values, so the three surfaces
// are structurally unable to disagree.
export function resolveMarketIntelligenceConfidenceFactors(
  canonicalState: MarketIntelligenceCanonicalState | null
): MarketIntelligenceConfidenceFactors | null {
  if (!canonicalState) return null;
  return buildMarketIntelligenceConfidenceFactors(
    canonicalState.coverage,
    canonicalState.decisionCriticalEvidence
  );
}

// TASK #32 -- Executive Summary evidence-classification audit.
//
// PROBLEM (confirmed via full audit of every render site): the Executive
// Summary's own "Decision" KPI badge, and the Executive Summary section's
// header badge, both re-derived their evidence level by scanning the
// section's raw prose for bare keywords (inferEvidenceLevel's
// `\bverified\b`/`\bvalidate\b` regexes) -- even though
// canonicalState.decisionCriticalEvidence is already resolved and
// already used, in the SAME render, to compute the decision label two
// lines above. This is the exact "reconstructs classification from prose
// instead of structured state" failure mode: a summary that happens to
// contain the word "verified" anywhere (a real risk -- "no independent
// win-rate data has been verified" is exactly the kind of sentence this
// report style writes) could show "Data Confirmed" on a report whose
// real decision-critical evidence is incomplete. Separately, page.tsx and
// Planner.tsx used two DIFFERENT functions for the "Decision" badge
// (getDashboardMetricEvidence vs getSectionEvidenceLevel), a drift risk
// independent of the over-confidence one.
//
// FIX: a pure, deterministic mapping from the SAME 3-pillar
// decisionCriticalEvidence + confidence every other canonical-state
// consumer already reads, onto the EXISTING EvidenceLevel taxonomy
// (report-evidence.ts) -- no new taxonomy invented. All 3 pillars
// resolved and confidence at/above the same "strong" bar the decision
// engine itself uses (STRONG_CONFIDENCE_THRESHOLD,
// market-intelligence-presentation.ts) is the only path to "verified";
// a full pillar count at weaker confidence, or a partial pillar count,
// reads as "benchmarkDerived" (directional/partially supported); a
// single resolved pillar reads as "planningAssumption"; zero resolved
// pillars reads as "validationRequired". Returns null when no canonical
// state exists, so every caller's existing prose-scan fallback continues
// to run completely unchanged for legacy/degraded reports -- this never
// upgrades what a legacy report already showed, only replaces the
// re-derivation for reports that actually have canonical state.
export function resolveMarketIntelligenceDecisionEvidenceLevel(
  canonicalState: MarketIntelligenceCanonicalState | null
): EvidenceLevel | null {
  if (!canonicalState) return null;

  const evidence = canonicalState.decisionCriticalEvidence;
  const resolvedCount = [
    evidence.marketSizingResolved,
    evidence.competitiveEvidenceResolved,
    evidence.obtainableShareResolved,
  ].filter(Boolean).length;
  // Mirrors STRONG_CONFIDENCE_THRESHOLD (market-intelligence-presentation.ts)
  // -- the same "strong" bar the decision engine itself requires, reused
  // here (as in classifyStrategicRecommendationAction) rather than a new
  // arbitrary number.
  const hasStrongConfidence = canonicalState.confidence >= 65;

  if (resolvedCount === 3) {
    return hasStrongConfidence ? "verified" : "benchmarkDerived";
  }
  if (resolvedCount === 2) return "benchmarkDerived";
  if (resolvedCount === 1) return "planningAssumption";
  return "validationRequired";
}

// TASK #33 -- canonical-first CAGR evidence classification. A displayed
// CAGR figure's own evidence badge (deriveMarketSizeMetricEvidenceLevel,
// report-presentation.ts) is a prose-only heuristic: it can only tell
// whether the SPECIFIC line containing the extracted number mentions
// evidence-sounding language, never whether generation actually found a
// qualifying CAGR evidence item at all. canonicalState.cagr is ground
// truth for that: an EMPTY array means no CAGR evidence qualified,
// regardless of what a bare percentage regex happens to match elsewhere
// in the same field's prose (a real risk -- e.g. an unrelated SAM/SOM
// percentage aside, or a KPI target percentage). The zero-item case is
// this function's own whole point (handled explicitly below); when
// MULTIPLE items exist, the caller's own existing multi-estimate
// handling (forcing "benchmarkDerived" when the prose-level scan detects
// genuinely disagreeing figures) already handles it correctly and is
// left untouched -- this function returns null in that case so the
// caller's existing logic runs unmodified.
export function resolveMarketIntelligenceCagrEvidenceLevel(
  canonicalState: MarketIntelligenceCanonicalState | null,
  hasDisplayValue: boolean
): EvidenceLevel | null {
  if (!canonicalState || !hasDisplayValue) return null;
  if (canonicalState.cagr.length === 0) {
    return "planningAssumption";
  }
  if (canonicalState.cagr.length === 1) {
    return canonicalState.cagr[0].confidenceClassification === "Verified" ? "verified" : "benchmarkDerived";
  }
  return null;
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

// TASK #24 -- TAM/SAM/SOM decision implications. Every UI/PDF surface
// that shows a TAM/SAM/SOM "resolved" (Data Confirmed) vs "Validation
// Required" badge derives that boolean from the SECTION'S OWN PROSE
// (parsing displayed dollar figures back into magnitudes and checking
// SAM <= TAM, SOM <= SAM) -- a check that is completely independent of
// whether canonical state's own samMethod/somStatus say the figure is
// actually evidence-derived or a disclosed default assumption/pending
// explanation. A prose-formatting quirk that happens to make an
// ASSUMED SAM or a PENDING SOM look like a resolvable number to that
// magnitude check would let this surface display "resolved"/"verified"
// for a fact canonical state explicitly does not consider resolved --
// the exact "reconstructs a stronger... fact" failure mode this task
// audits for.
//
// This is a pure, one-directional NARROWING function: canonical state
// can only ever turn a prose-parsed samResolved/somResolved=true into
// false, never the reverse. It has no opinion at all when canonical
// state (or its marketSizing) is unavailable -- the existing prose-only
// resolution is untouched for every degraded/legacy report, preserving
// current behavior exactly. Applied at every TAM/SAM/SOM resolution call
// site across page.tsx, Planner.tsx (web + PDF), and ReportPdfButton.tsx
// so a single, shared rule replaces four independent copy-pasted checks.
// TASK #31 -- Strategic Recommendation evidence discipline.
//
// PROBLEM (confirmed via full audit of generation, extraction, and all 4
// render sites -- page.tsx web, Planner.tsx web + PDF, ReportPdfButton.tsx
// PDF): Strategic Recommendations' own action cards are built purely from
// AI-generated prose (extractRecommendationItems/extractRecommendationSignals
// in report-presentation.ts), with zero connection to the canonical
// decision or its underlying evidence pillars. The only decision-aware
// element on the whole section is the "Current Decision: X" badge drawn
// once above the card grid -- individual cards' own action text, budget,
// KPI, and timeline are never checked against the decision or against
// decisionCriticalEvidence, so a MONITOR (or even AVOID) report's own
// recommendation cards can read exactly like an unconditional ENTER
// scale-up plan. Confirmed against the real MONITOR/50%-confidence,
// SOM-unresolved CLM report used throughout Tasks #29-#30: its own First
// 90 Days actions name five-figure budgets and hard day-count KPIs with
// no evidence tie at all -- exactly the fake-precision, decision-
// inconsistent pattern this task closes.
//
// FIX: a pure, deterministic classification layer applied AFTER
// extraction (report-presentation.ts's extraction itself is untouched --
// this never re-parses prose that function didn't already parse). Given
// one action's raw text and its already-extracted signals, this assigns
// an actionType (validation/research/pilot/conditional_execution/scale)
// from the action's own language, then conservatively DOWNGRADES that
// classification -- never upgrades it -- using the SAME canonical state
// and decision-critical-evidence pillars every other MI surface already
// reads: AVOID (NO_GO) never keeps a pilot/conditional_execution/scale
// classification; MONITOR (CONDITIONAL_GO) never keeps an unconditional
// scale classification; and a scale classification survives under ANY
// decision (including ENTER, or an unavailable/legacy canonical state)
// only when every decision-critical evidence pillar is genuinely resolved
// and confidence clears the same "strong" threshold
// (STRONG_CONFIDENCE_THRESHOLD, market-intelligence-presentation.ts) the
// decision engine itself already uses for its own ENTER/MONITOR/AVOID
// split. Separately, every numeric budget/KPI/timeline figure is
// classified by its own evidence basis: tied to a stated Evidence Tie,
// already explicitly labeled a planning assumption by the model, or --
// the conservative default -- surfaced AS a planning assumption rather
// than presented as an unqualified fact. Applied identically at all 4
// render sites via this one shared function, so none of them can
// classify or gate a card differently from the others.
export type StrategicRecommendationActionType =
  | "validation"
  | "research"
  | "pilot"
  | "conditional_execution"
  | "scale";

export type StrategicRecommendationNumericBasis = "evidence" | "planning_assumption" | "none";

export type StrategicRecommendationClassification = {
  actionType: StrategicRecommendationActionType;
  actionTypeLabel: string;
  wasDowngraded: boolean;
  downgradeReason: string;
  numericBasis: StrategicRecommendationNumericBasis;
  // Whether the classification/downgrade decision above was informed by
  // real persisted canonical state, or applied as the conservative
  // default for a report with none -- mirrors
  // MarketIntelligenceExecutiveDecision's own decisionSource distinction,
  // exposed here so a caller can (optionally, without cluttering the UI)
  // surface why a scale action reads as conditional execution instead.
  evidenceBasis: "canonical-state" | "unavailable";
};

const STRATEGIC_RECOMMENDATION_ACTION_TYPE_LABELS: Record<
  StrategicRecommendationActionType,
  Record<ResponseLanguage, string>
> = {
  validation: {
    English: "Validation Action",
    Turkish: "Doğrulama Eylemi",
    German: "Validierungsmaßnahme",
    French: "Action de validation",
    Spanish: "Acción de validación",
  },
  research: {
    English: "Research Action",
    Turkish: "Araştırma Eylemi",
    German: "Recherchemaßnahme",
    French: "Action de recherche",
    Spanish: "Acción de investigación",
  },
  pilot: {
    English: "Pilot Action",
    Turkish: "Pilot Eylem",
    German: "Pilotmaßnahme",
    French: "Action pilote",
    Spanish: "Acción piloto",
  },
  conditional_execution: {
    English: "Conditional Execution",
    Turkish: "Koşullu Uygulama",
    German: "Bedingte Umsetzung",
    French: "Exécution conditionnelle",
    Spanish: "Ejecución condicional",
  },
  scale: {
    English: "Scale Action",
    Turkish: "Ölçeklendirme Eylemi",
    German: "Skalierungsmaßnahme",
    French: "Action de mise à l'échelle",
    Spanish: "Acción de escalado",
  },
};

const STRATEGIC_RECOMMENDATION_DOWNGRADE_REASONS: Record<"avoid" | "monitor" | "evidence", Record<ResponseLanguage, string>> = {
  avoid: {
    English: "AVOID decision: execution-framed actions are downgraded to research until this market-entry call changes.",
    Turkish: "AVOID kararı: uygulamaya yönelik eylemler, bu pazara giriş kararı değişene kadar araştırmaya indirgendi.",
    German: "AVOID-Entscheidung: umsetzungsorientierte Maßnahmen werden auf Recherche zurückgestuft, bis sich diese Markteintrittsentscheidung ändert.",
    French: "Décision AVOID : les actions orientées exécution sont ramenées à la recherche tant que cette décision d'entrée sur le marché ne change pas.",
    Spanish: "Decisión AVOID: las acciones orientadas a la ejecución se degradan a investigación hasta que cambie esta decisión de entrada al mercado.",
  },
  monitor: {
    English: "MONITOR decision: unconditional scale is downgraded to conditional execution until the stated evidence gate is met.",
    Turkish: "MONITOR kararı: koşulsuz ölçeklendirme, belirtilen kanıt eşiği sağlanana kadar koşullu uygulamaya indirgendi.",
    German: "MONITOR-Entscheidung: bedingungslose Skalierung wird auf bedingte Umsetzung zurückgestuft, bis die genannte Nachweisschwelle erreicht ist.",
    French: "Décision MONITOR : la mise à l'échelle inconditionnelle est ramenée à une exécution conditionnelle jusqu'à ce que le seuil de preuve indiqué soit atteint.",
    Spanish: "Decisión MONITOR: el escalado incondicional se degrada a ejecución condicional hasta que se cumpla el umbral de evidencia indicado.",
  },
  evidence: {
    English: "Scale is downgraded to conditional execution until every decision-critical evidence pillar is confirmed at strong confidence.",
    Turkish: "Ölçeklendirme, karar açısından kritik tüm kanıt unsurları güçlü güven düzeyinde doğrulanana kadar koşullu uygulamaya indirgendi.",
    German: "Die Skalierung wird auf bedingte Umsetzung zurückgestuft, bis jede entscheidungskritische Nachweissäule mit hoher Zuversicht bestätigt ist.",
    French: "La mise à l'échelle est ramenée à une exécution conditionnelle tant que chaque pilier de preuve déterminant pour la décision n'est pas confirmé avec une forte confiance.",
    Spanish: "El escalado se degrada a ejecución condicional hasta que se confirme con alta confianza cada pilar de evidencia crítico para la decisión.",
  },
};

const STRATEGIC_RECOMMENDATION_VALIDATION_PATTERN =
  /\b(validate|validating|validation|confirm|confirming|verify|verifying|customer discovery|discovery interviews?|interview \d+|survey(?:ing)?|test(?:ing)? the (?:hypothesis|assumption))\b/i;
const STRATEGIC_RECOMMENDATION_RESEARCH_PATTERN =
  /\b(research(?:ing)?|investigat(?:e|ing)|analy[sz]e|analy[sz]ing|benchmark(?:ing)?|commission(?:ing)? (?:a |an )?(?:study|report|audit)|gather(?:ing)? (?:data|evidence)|desk research)\b/i;
const STRATEGIC_RECOMMENDATION_PILOT_PATTERN =
  /\b(pilot(?:ing)?|trial(?:s|ing)?|proof[- ]of[- ]concept|\bpoc\b|beta(?:\s+program)?|limited rollout|controlled test)\b/i;
const STRATEGIC_RECOMMENDATION_SCALE_PATTERN =
  /\b(scale(?:s|d|ing)?(?:\s+up)?|national(?:ly)? launch|full[- ]scale|full market entry|hire (?:a |an )?(?:team|dozens|\d+)|expand(?:ing)? the team|mass hiring|nationwide rollout|open(?:ing)? (?:\d+|multiple) (?:new )?(?:offices|locations)|series [ab] raise|go[- ]to[- ]market (?:broadly|nationally|at scale))\b/i;

// Mirrors extractRecommendationSignals' own numeric-figure vocabulary
// (report-presentation.ts) -- any dollar amount, percentage, day/week/
// month count, or named-unit count (customers, SOWs, LOIs, ...) inside a
// card's own budget/success-metric/timeline fields.
const STRATEGIC_RECOMMENDATION_NUMERIC_PRECISION_PATTERN =
  /[$€₺]\s?\d[\d,.]*\s?[kKmMbB]?\b|\b\d+(?:\.\d+)?\s?%|\b\d+\+?\s?(?:days?|weeks?|months?|hours?|gün|hafta|ay)\b|\b\d+\+?\s?(?:customers?|accounts?|leads?|users?|trials?|pilots?|sign-?ups?|SOWs?|LOIs?|meetings?|calls?|responses?|interviews?|deals?|conversions?)\b/i;
const STRATEGIC_RECOMMENDATION_PLANNING_ASSUMPTION_MARKER_PATTERN =
  /\(?\s*planning assumption\s*\)?|\[\s*assumption\s*\]|\bassumed\b|\bestimated\b|\bplanning estimate\b|\bplanlama varsayımı\b|\bvarsayım\b/i;

function classifyRawStrategicRecommendationActionType(
  item: string,
  activity: string
): StrategicRecommendationActionType {
  const text = activity ? `${activity} ${item}` : item;
  if (STRATEGIC_RECOMMENDATION_VALIDATION_PATTERN.test(text)) return "validation";
  if (STRATEGIC_RECOMMENDATION_RESEARCH_PATTERN.test(text)) return "research";
  if (STRATEGIC_RECOMMENDATION_PILOT_PATTERN.test(text)) return "pilot";
  if (STRATEGIC_RECOMMENDATION_SCALE_PATTERN.test(text)) return "scale";
  return "conditional_execution";
}

// TASK #33 -- confirmed live (source-provenance audit): extractRecommendationSignals'
// own `evidenceTie` field is deliberately explicit-label-only free text
// (report-presentation.ts's own comment: "no guess fallback") -- it
// captures whatever follows an "Evidence tie/to collect/link/basis:"
// label VERBATIM, with no requirement that it name a real citation.
// The real 171cf10d... fixture's own evidenceTie is literally "signed
// SOWs and pilot KPIs" -- FUTURE evidence to be collected, not a
// citation to anything that exists yet. Treating any non-empty
// evidenceTie as sufficient to call a number "evidence"-based (the prior
// behavior) let a recommendation's budget/timeline look externally
// sourced merely because the action NAMED what evidence it intends to
// gather -- exactly the fake-precision pattern this task closes. A
// citation marker embedded in evidenceTie (e.g. "supported by [R4]") is
// only trusted when it resolves against the SAME citationSources
// registry every other MI surface already reads -- never a bare
// non-empty-string check.
const STRATEGIC_RECOMMENDATION_CITATION_MARKER_PATTERN = /\[R(\d+)\]/g;

export function isKnownCitationId(
  canonicalState: MarketIntelligenceCanonicalState | null,
  evidenceId: string
): boolean {
  if (!canonicalState || !evidenceId) return false;
  return canonicalState.citationSources.some((source) => source.evidenceId === evidenceId);
}

function evidenceTieReferencesKnownCitation(
  evidenceTie: string,
  canonicalState: MarketIntelligenceCanonicalState | null
): boolean {
  if (!evidenceTie || !canonicalState) return false;
  const matches = [...evidenceTie.matchAll(STRATEGIC_RECOMMENDATION_CITATION_MARKER_PATTERN)];
  return matches.some((match) => isKnownCitationId(canonicalState, `R${match[1]}`));
}

// Conservative-default numeric-precision basis: a budget/KPI/timeline
// figure is only ever treated as evidence-linked when the card's own
// Evidence Tie names a citation that actually resolves in the canonical
// source registry, or the model already labeled it a planning assumption
// itself -- an unlabeled, untied, or unresolvable-citation number
// defaults to "planning_assumption" rather than being presented as an
// unqualified fact. Mirrors this codebase's existing TAM/SAM/SOM
// "Planning Estimate" convention rather than inventing a new one.
function deriveStrategicRecommendationNumericBasis(
  item: string,
  signals: { budget: string; metric: string; timeframe: string; evidenceTie: string },
  canonicalState: MarketIntelligenceCanonicalState | null
): StrategicRecommendationNumericBasis {
  const numericFields = [signals.budget, signals.metric, signals.timeframe].filter(Boolean).join(" | ");
  if (!numericFields || !STRATEGIC_RECOMMENDATION_NUMERIC_PRECISION_PATTERN.test(numericFields)) {
    return "none";
  }
  if (
    STRATEGIC_RECOMMENDATION_PLANNING_ASSUMPTION_MARKER_PATTERN.test(numericFields) ||
    STRATEGIC_RECOMMENDATION_PLANNING_ASSUMPTION_MARKER_PATTERN.test(item)
  ) {
    return "planning_assumption";
  }
  return evidenceTieReferencesKnownCitation(signals.evidenceTie, canonicalState) ? "evidence" : "planning_assumption";
}

export function classifyStrategicRecommendationAction(input: {
  item: string;
  signals: {
    budget: string;
    metric: string;
    timeframe: string;
    owner: string;
    gate: string;
    activity: string;
    evidenceTie: string;
  };
  canonicalState: MarketIntelligenceCanonicalState | null;
  language?: ResponseLanguage;
}): StrategicRecommendationClassification {
  const { item, signals, canonicalState, language = "English" } = input;
  const rawType = classifyRawStrategicRecommendationActionType(item, signals.activity);

  let actionType = rawType;
  let wasDowngraded = false;
  let downgradeReasonKey: "avoid" | "monitor" | "evidence" | null = null;

  const decision = canonicalState?.decision ?? null;
  const evidence = canonicalState?.decisionCriticalEvidence ?? null;
  const allEvidenceResolved = Boolean(
    evidence?.marketSizingResolved && evidence?.competitiveEvidenceResolved && evidence?.obtainableShareResolved
  );
  // Mirrors STRONG_CONFIDENCE_THRESHOLD (market-intelligence-presentation.ts)
  // -- the same "strong" bar the decision engine itself requires before
  // an ENTER verdict, reused here rather than a new arbitrary number.
  const hasStrongConfidence = (canonicalState?.confidence ?? 0) >= 65;

  if (decision === "NO_GO" && actionType !== "validation" && actionType !== "research") {
    actionType = "research";
    wasDowngraded = true;
    downgradeReasonKey = "avoid";
  } else if (decision === "CONDITIONAL_GO" && actionType === "scale") {
    actionType = "conditional_execution";
    wasDowngraded = true;
    downgradeReasonKey = "monitor";
  } else if (actionType === "scale" && !(allEvidenceResolved && hasStrongConfidence)) {
    actionType = "conditional_execution";
    wasDowngraded = true;
    downgradeReasonKey = "evidence";
  }

  return {
    actionType,
    actionTypeLabel: STRATEGIC_RECOMMENDATION_ACTION_TYPE_LABELS[actionType][language],
    wasDowngraded,
    downgradeReason: downgradeReasonKey ? STRATEGIC_RECOMMENDATION_DOWNGRADE_REASONS[downgradeReasonKey][language] : "",
    numericBasis: deriveStrategicRecommendationNumericBasis(item, signals, canonicalState),
    evidenceBasis: canonicalState ? "canonical-state" : "unavailable",
  };
}

export function constrainMarketSizingResolutionToCanonicalState<
  T extends {
    samResolved: boolean;
    somResolved: boolean;
    tamResolved?: boolean;
    allResolved?: boolean;
  }
>(resolution: T, canonicalState: MarketIntelligenceCanonicalState | null): T {
  const marketSizing = canonicalState?.marketSizing;
  if (!marketSizing) return resolution;

  const samResolved = resolution.samResolved && marketSizing.samMethod === "evidenceDerived";
  const somResolved = resolution.somResolved && marketSizing.somStatus === "calculated";

  return {
    ...resolution,
    samResolved,
    somResolved,
    // `allResolved` (when the caller's own shape has one -- both
    // resolveTamSamSomCascade local variants and the shared
    // resolveMarketSizingCascade all compute it as tamResolved &&
    // samResolved && somResolved) must be recomputed from the NEWLY
    // constrained sam/somResolved, never left at its pre-constraint
    // value -- otherwise a caller reading only `allResolved` (e.g. an
    // evidence-badge dispatcher) would still see a stale "fully
    // resolved" verdict even though this function just downgraded one
    // of its inputs.
    ...("allResolved" in resolution
      ? { allResolved: Boolean(resolution.tamResolved) && samResolved && somResolved }
      : {}),
  };
}
