import {
  extractExecutiveDecisionFromText,
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
