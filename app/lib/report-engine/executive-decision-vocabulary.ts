import {
  extractExecutiveDecisionFromText,
  localizedLabelVariants,
  type ExecutiveDecisionCode,
} from "@/app/lib/report-engine/executive-decision-brief";
import type { DecisionRecommendation } from "@/app/lib/decision-intelligence/contracts";
import type { ResponseLanguage } from "@/app/lib/report-engine/schema";

// CRITICAL ARCHITECTURE FIX -- centralize executive decision vocabulary.
//
// A cross-report consistency audit found at least six distinct, live
// decision-vocabulary systems in this codebase, each produced by a
// different report kind or a different remapping of the same underlying
// score: investment-score.ts's raw "GO"/"WAIT"/"PASS", the same file's
// own second remap to "VALIDATE"/"HOLD"/"PASS", decision-confidence.ts's
// third remap to "GO"/"WAIT"/"NO-GO", the shared executive-decision-
// brief.ts banner's "GO"/"CONDITIONAL_GO"/"NO_GO", Acquisition Due
// Diligence's own required phrases ("Proceed with Conditions"/"Pause
// Pending Review"/"Reject"), and decision-intelligence's own
// "Proceed"/"Proceed Conditionally"/"Proceed Carefully"/"Wait"/"Avoid"/
// "Insufficient Evidence" (further remapped to "BUY"/"WAIT"/"AVOID" for
// Real Estate). This module does NOT replace any of them -- report
// generation, financial calculations, and PDF layout are all explicitly
// out of scope for this fix. It adds one canonical, 4-value vocabulary
// that every report kind's ALREADY-PRODUCED final recommendation is
// translated into for consistent display, plus the translation
// functions themselves. Nothing here changes what any report generates.
//
// "Strategic Advisory" is not a distinct, user-facing report kind (see
// the audit) -- its practical stand-in is the shared Legal/Finance/
// Accounting/Operations/Procurement domain-analysis family, which
// (like Business Plan, Market Intelligence, and Acquisition) renders
// its decision via the same shared executive-decision-brief.ts banner,
// so it is covered by mapExecutiveDecisionCodeToCanonicalDecision below
// without a dedicated mapper of its own.

export type CanonicalExecutiveDecision =
  | "PROCEED"
  | "PROCEED_WITH_CONDITIONS"
  | "PAUSE_PENDING_REVIEW"
  | "REJECT";

export const CANONICAL_EXECUTIVE_DECISIONS: readonly CanonicalExecutiveDecision[] = [
  "PROCEED",
  "PROCEED_WITH_CONDITIONS",
  "PAUSE_PENDING_REVIEW",
  "REJECT",
];

const canonicalDecisionLabels: Record<ResponseLanguage, Record<CanonicalExecutiveDecision, string>> = {
  English: {
    PROCEED: "Proceed",
    PROCEED_WITH_CONDITIONS: "Proceed with Conditions",
    PAUSE_PENDING_REVIEW: "Pause Pending Review",
    REJECT: "Reject",
  },
  Turkish: {
    PROCEED: "Devam Et",
    PROCEED_WITH_CONDITIONS: "Koşullu Devam",
    PAUSE_PENDING_REVIEW: "Gözden Geçirme Bekleniyor",
    REJECT: "Reddet",
  },
  German: {
    PROCEED: "Fortfahren",
    PROCEED_WITH_CONDITIONS: "Bedingt Fortfahren",
    PAUSE_PENDING_REVIEW: "Prüfung Ausstehend",
    REJECT: "Ablehnen",
  },
  French: {
    PROCEED: "Procéder",
    PROCEED_WITH_CONDITIONS: "Procéder Sous Conditions",
    PAUSE_PENDING_REVIEW: "Examen en Attente",
    REJECT: "Rejeter",
  },
  Spanish: {
    PROCEED: "Proceder",
    PROCEED_WITH_CONDITIONS: "Proceder con Condiciones",
    PAUSE_PENDING_REVIEW: "Revisión Pendiente",
    REJECT: "Rechazar",
  },
};

export function getCanonicalDecisionLabel(
  decision: CanonicalExecutiveDecision,
  language: ResponseLanguage = "English"
): string {
  return canonicalDecisionLabels[language][decision];
}

// -- Per-source mappers -----------------------------------------------
//
// Pure, additive translations FROM each report kind's existing,
// unmodified decision vocabulary INTO the canonical 4-value set. None
// of these change what any report generates -- they only translate an
// already-produced value for consistent display.

// The shared executive-decision-brief.ts banner: Business Plan, Market
// Intelligence, Acquisition, and the domain-analysis ("Strategic
// Advisory") family all render this as their primary decision line.
export function mapExecutiveDecisionCodeToCanonicalDecision(
  code: ExecutiveDecisionCode
): CanonicalExecutiveDecision {
  if (code === "GO") return "PROCEED";
  if (code === "CONDITIONAL_GO") return "PROCEED_WITH_CONDITIONS";
  return "REJECT"; // NO_GO
}

// investment-score.ts's raw, structured recommendation field -- the
// value app/dashboard pages read directly off report.investmentScore,
// distinct from that file's own internal-only "VALIDATE"/"HOLD"/"PASS"
// remap (createVisibleRecommendation), which is never rendered to a
// user and is left untouched.
export function mapInvestmentScoreRecommendationToCanonicalDecision(
  recommendation: "GO" | "WAIT" | "PASS"
): CanonicalExecutiveDecision {
  if (recommendation === "GO") return "PROCEED";
  if (recommendation === "WAIT") return "PAUSE_PENDING_REVIEW";
  return "REJECT"; // PASS
}

// Acquisition Due Diligence's finalInvestmentRecommendation field states
// its call as exactly one of these three phrases (see
// app/lib/report-engine/prompts/acquisition-analysis.ts) -- the most
// granular source available, distinguishing Pause-Pending-Review from
// Reject where the 3-tier shared banner cannot.
const acquisitionCallPattern = /\b(Proceed with Conditions|Pause Pending Review|Reject)\b/i;

export function mapAcquisitionCallToCanonicalDecision(
  text: string
): CanonicalExecutiveDecision | null {
  const match = text.match(acquisitionCallPattern);
  if (!match) return null;

  const call = match[1].toLowerCase();
  if (call === "proceed with conditions") return "PROCEED_WITH_CONDITIONS";
  if (call === "pause pending review") return "PAUSE_PENDING_REVIEW";
  return "REJECT";
}

// decision-intelligence's own recommendation vocabulary -- the engine
// actually behind Real Estate and the domain-analysis family's scoring
// (not their rendered banner text, which goes through
// executive-decision-brief.ts instead; this mapper exists for any
// caller working directly with a DecisionResult).
export function mapDecisionIntelligenceRecommendationToCanonicalDecision(
  recommendation: DecisionRecommendation
): CanonicalExecutiveDecision {
  if (recommendation === "Proceed") return "PROCEED";
  if (recommendation === "Proceed Conditionally" || recommendation === "Proceed Carefully") {
    return "PROCEED_WITH_CONDITIONS";
  }
  if (recommendation === "Wait" || recommendation === "Insufficient Evidence") {
    return "PAUSE_PENDING_REVIEW";
  }
  return "REJECT"; // Avoid
}

// Real Estate's own further-simplified committee label, rendered as a
// literal "Decision: BUY/WAIT/AVOID." line (see
// app/lib/report-jobs/plan-executor.ts's real-estate report builder).
export function mapRealEstateCommitteeDecisionToCanonicalDecision(
  decision: "BUY" | "WAIT" | "AVOID"
): CanonicalExecutiveDecision {
  if (decision === "BUY") return "PROCEED";
  if (decision === "WAIT") return "PAUSE_PENDING_REVIEW";
  return "REJECT"; // AVOID
}

const realEstateCommitteeDecisionPattern = /\b(?:Decision|Recommendation)\s*[:=]\s*(BUY|WAIT|AVOID)\b/i;

// -- Single resolver for the presentation layer ------------------------
//
// Tries, in priority order: (1) Acquisition's own literal call phrase --
// the most granular source; (2) Real Estate's labeled BUY/WAIT/AVOID
// line; (3) the shared executive-decision-brief.ts "Decision: TOKEN"
// line (deterministic, locale-aware -- covers Business Plan, Market
// Intelligence, Acquisition, and the domain-analysis/"Strategic
// Advisory" family); (4) investment-score.ts's raw recommendation
// field, the oldest fallback signal. Returns null when no report kind's
// recognizable decision vocabulary is present in the given text, so
// callers can fall back to their own existing safety net unchanged.
export function resolveCanonicalDecisionFromReportText(
  text: string,
  // Accepts plain string because the dashboard/Planner UI types read
  // report.investmentScore.recommendation from serialized report data
  // (typed as a loose string), not investment-score.ts's own strict
  // "GO" | "WAIT" | "PASS" union -- validated below before mapping.
  investmentScoreRecommendation?: string
): { decision: CanonicalExecutiveDecision; language: ResponseLanguage } | null {
  const acquisitionCall = mapAcquisitionCallToCanonicalDecision(text);
  if (acquisitionCall) {
    return { decision: acquisitionCall, language: "English" };
  }

  const realEstateMatch = text.match(realEstateCommitteeDecisionPattern);
  if (realEstateMatch) {
    return {
      decision: mapRealEstateCommitteeDecisionToCanonicalDecision(
        realEstateMatch[1].toUpperCase() as "BUY" | "WAIT" | "AVOID"
      ),
      language: "English",
    };
  }

  const brief = extractExecutiveDecisionFromText(text);
  if (brief) {
    return { decision: mapExecutiveDecisionCodeToCanonicalDecision(brief.code), language: brief.language };
  }

  if (
    investmentScoreRecommendation === "GO" ||
    investmentScoreRecommendation === "WAIT" ||
    investmentScoreRecommendation === "PASS"
  ) {
    return {
      decision: mapInvestmentScoreRecommendationToCanonicalDecision(investmentScoreRecommendation),
      language: "English",
    };
  }

  return null;
}

// -- Market Intelligence: single canonical decision/confidence source --
//
// CRITICAL FIX -- confirmed live: a Market Intelligence report whose
// executiveSummary predates the deterministic "Decision: TOKEN
// (Confidence: NN%)" banner (extractExecutiveDecisionFromText fails to
// match) previously fell back to buildExecutiveSnapshot's generic
// decision/confidence heuristic (report-presentation.ts) -- built around
// two unsafe, unlabeled full-content scans:
//   1. extractDecision's fallback: `content.match(/\b(GO|WAIT|NO-GO|...
//      |PASS|...)\b/i)` against the ENTIRE report, not just the executive
//      summary. Every Market Intelligence report contains a "Go-to-Market"
//      section/phrase -- `\bGO\b` matches the "GO" inside "Go-to-Market"
//      because a hyphen is a non-word character, so this scan returns
//      "GO" for virtually any report regardless of its real
//      recommendation. The same function additionally maps a matched
//      "PASS" token to "GO" -- backwards, since "pass" conventionally
//      means decline/reject.
//   2. extractConfidenceValue's fallback (via extractScore's fuzzy
//      "label within 30 non-digit characters" match): the SAME full-report
//      scan can attach an unrelated "NN%" mentioned anywhere near the word
//      "confidence" in ordinary prose to the Confidence Score card,
//      fabricating a number (e.g. "30%") the report never actually stated
//      as its decision confidence.
// This is the confirmed root cause of the reported live defect: web
// (correctly scoped to just the executiveSummary section) showed the
// report's real, conservative "MONITOR FOR A STAGED U.S. ..." text, while
// the PDF (passing the FULL report to the same generic fallback) hit the
// "Go-to-Market" trap and fabricated "GO"/"30%".
//
// This resolver is the ONE canonical source every surface (web Executive
// Summary, web Executive Snapshot, PDF cover, PDF Executive Summary) must
// call for Market Intelligence, replacing buildExecutiveSnapshot's
// decision/confidence fields entirely for this report kind -- never a
// second, independently reconstructed value:
//   Tier 1 (safe, structured): the deterministic "Decision: TOKEN
//   (Confidence: NN%)" banner. Confidence is captured from the banner's
//   OWN matched line only (immediately after the matched token), never a
//   scan of the rest of the document, so it can never attach an unrelated
//   percentage.
//   Tier 2 (safe, narrow): if no banner is present (a legacy report), the
//   raw text following a line-anchored "Decision:"/"Recommendation:"
//   label (matching the exact shape web already displayed correctly) is
//   returned VERBATIM -- never re-scanned for a GO/WAIT/PASS keyword,
//   never remapped through any token conversion. Confidence is left
//   unavailable (null) at this tier: a legacy report's raw decision text
//   has no reliably-adjacent confidence figure to read safely.
//   Tier 3: neither found -- decision is "—" (unavailable) and confidence
//   is null. No surface may guess a value here.
export type MarketIntelligenceExecutiveDecisionSource = "canonical-banner" | "raw-label" | "unavailable";

export interface MarketIntelligenceExecutiveDecision {
  decisionLabel: string;
  decisionSource: MarketIntelligenceExecutiveDecisionSource;
  // Only populated for decisionSource === "canonical-banner" -- a raw
  // labeled fallback's free text has no reliable enum mapping (never
  // guessed via keyword remapping), so callers that need a color/category
  // bucket for the raw-label/unavailable tiers should treat null as
  // "neutral", not silently default it to any one of the four values.
  canonicalDecision: CanonicalExecutiveDecision | null;
  confidenceScore: number | null;
  language: ResponseLanguage;
}

// CRITICAL FIX -- confirmed live (root-cause repair): "Recommendation"/
// "Tavsiye"/"Executive recommendation"/"Yönetici tavsiyesi" were
// previously treated as interchangeable synonyms for "Decision" here --
// safe for report kinds where "Executive Recommendation" is a genuinely
// dedicated, decision-restating field (a documented legacy convention),
// but for a raw line embedded inside Market Intelligence's free-flowing
// executiveSummary prose, "Recommendation:" is just as likely to
// introduce a recommended NEXT STEP ("Recommendation: Commission a $50k
// primary demand study before committing further resources") as it is to
// restate the decision verdict. A live report showed exactly that --
// the next-action text overwrote the canonical decision field. Only the
// unambiguous decision-specific labels are matched now.
const marketIntelligenceRawDecisionLabels = [
  "Decision",
  "Karar",
  "Final decision",
  "Nihai karar",
];

// Second, independent guard: even a genuinely decision-labeled line must
// never be accepted if it reads as an imperative next-step/action
// sentence rather than a decision verdict -- enforces the ticket's
// explicit "a recommendation/action must never overwrite the canonical
// decision field" requirement regardless of which label introduced it.
// Mirrors the instruction-leading-verb heuristic already proven safe
// elsewhere in this codebase (vendor-discovery.ts's
// isImplausibleCompetitorName), extended with the imperative verbs a
// "next action" recommendation typically opens with.
const actionShapedTextPattern =
  /^(?:commission|conduct|analyz[e]?|generate|write|provide|summarize|summarise|explain|list|identify|assess|evaluate|create|perform|produce|research|describe|compare|review|investigate|determine|prepare|draft|compile|outline|launch|pilot|test|validate|hire|build|run|execute|survey|interview|gather|collect|develop|establish|secure|obtain|schedule|initiate|begin|start)\b/i;

function extractMarketIntelligenceRawDecisionText(text: string): string {
  for (const label of marketIntelligenceRawDecisionLabels) {
    const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = text.match(
      new RegExp(`(?:^|\\n)\\s*(?:[-*•]\\s*)?${escapedLabel}\\s*[:\\-–—]\\s*([^\\n]+)`, "i")
    );
    const candidate = match?.[1]?.trim();

    if (candidate && !actionShapedTextPattern.test(candidate)) {
      return candidate.replace(/\*\*/g, "").slice(0, 120);
    }
  }

  return "";
}

function extractMarketIntelligenceBannerConfidence(text: string, decisionToken: string): number | null {
  const decisionLabelPattern = localizedLabelVariants("decision")
    .map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const confidenceLabelPattern = localizedLabelVariants("confidence")
    .map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const escapedToken = decisionToken.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Anchored to the SAME matched banner line: "<Decision label>: TOKEN
  // (<Confidence label>: NN%)" -- the parenthesis must open within 10
  // characters of the matched token, matching the deterministic
  // template's own known shape exactly, so this can never pick up an
  // unrelated confidence figure stated elsewhere in the report.
  const match = text.match(
    new RegExp(
      `(?:${decisionLabelPattern})\\s*[:\\-–—]\\s*${escapedToken}\\b[^\\n(]{0,10}\\(\\s*(?:${confidenceLabelPattern})\\s*[:\\-–—]?\\s*(\\d{1,3})\\s*%\\s*\\)`,
      "i"
    )
  );

  return match ? Math.max(0, Math.min(100, Number(match[1]))) : null;
}

export function resolveMarketIntelligenceExecutiveDecision(
  executiveSummaryContent: string,
  language: ResponseLanguage = "English"
): MarketIntelligenceExecutiveDecision {
  const text = executiveSummaryContent || "";
  const banner = extractExecutiveDecisionFromText(text);

  if (banner) {
    const canonical = mapExecutiveDecisionCodeToCanonicalDecision(banner.code);
    return {
      decisionLabel: getCanonicalDecisionLabel(canonical, banner.language),
      decisionSource: "canonical-banner",
      canonicalDecision: canonical,
      confidenceScore: extractMarketIntelligenceBannerConfidence(text, banner.token),
      language: banner.language,
    };
  }

  const rawDecisionText = extractMarketIntelligenceRawDecisionText(text);
  if (rawDecisionText) {
    return {
      decisionLabel: rawDecisionText,
      decisionSource: "raw-label",
      canonicalDecision: null,
      confidenceScore: null,
      language,
    };
  }

  return {
    decisionLabel: "—",
    canonicalDecision: null,
    decisionSource: "unavailable",
    confidenceScore: null,
    language,
  };
}
