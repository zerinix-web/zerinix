// Schema/content enforcement that Business Idea Validation, Market
// Intelligence, and Strategic Advisory reports never leak each other's
// report-specific vocabulary. Field-level isolation (which JSON keys each
// report type can even have) is already enforced by each report's own
// parse*Report function picking only its own known field list -- this
// module adds the layer that was missing: scanning the *content* of those
// otherwise-correctly-named fields for foreign report terminology, and
// failing fast instead of silently returning a mixed report.

export type ReportProductType =
  | "market_intelligence"
  | "business_plan"
  | "strategic_advisory"
  | "acquisition_due_diligence";

export type IsolationViolation = {
  field: string;
  term: string;
  snippet: string;
};

type ForbiddenPattern = { term: string; pattern: RegExp };

// P0 PRODUCTION FIX -- confirmed live (Market Intelligence report-isolation
// false positive): "runway" and "fundraising" are ordinary English words
// with real, common meanings outside Business-Plan financial vocabulary --
// "the fastest adoption runway", "a long runway for growth", "the
// crowdfunding/fundraising platforms market" -- unlike every OTHER entry in
// this file, which is either a multi-word compound ("founder readiness",
// "validation gate"), an acronym unlikely to occur in ordinary prose
// (EBITDA, PMF), or already requires a specific following word ("founder
// score/scoring/execution"). A bare `\bword\b` match on either of these two
// specifically rejected a real, live Market Intelligence report that used
// "runway" only as an adoption-speed metaphor. Requiring genuine cash/
// startup-financing context nearby (never just changing/removing the term)
// keeps the SAME reported violation types actually blocked -- a report that
// genuinely leaks "cash runway", "18 months of runway", or startup
// fundraising-round language is still rejected exactly as before (see this
// module's own regression test) -- while no longer flagging the word used
// on its own, ordinary sense.
function nearbyContextPattern(primary: string, contextAlternation: string, window = 50) {
  return (
    `\\b${primary}\\b[^.!?\\n]{0,${window}}\\b(?:${contextAlternation})\\b` +
    `|\\b(?:${contextAlternation})\\b[^.!?\\n]{0,${window}}\\b${primary}\\b`
  );
}

const CASH_RUNWAY_CONTEXT_WORDS =
  "burn(?:\\s+rate)?|cash|capital|profitability|breakeven|break-even|remaining|extend(?:s|ed|ing)?";

// Genuine cash-runway phrasing ("cash runway", "18 months of runway",
// "runway of 12-18 months") is matched directly and unconditionally --
// these shapes have no ordinary non-financial reading. A bare "runway"
// elsewhere is only a violation when real financial/startup-financing
// context (burn rate, capital, profitability, extending it, etc.) appears
// in the same sentence -- an adoption/market/growth-speed metaphor never
// co-occurs with that vocabulary.
const MONTHS_RANGE = "\\d+\\s*(?:(?:-|to)\\s*\\d+\\s*)?months?";
// A short (<=15 char) gap tolerates an ordinary copula/connector directly
// between "runway" and the figure ("Runway is 14 months", "Runway
// remaining: 14 months", "Runway of 12-18 months") without being wide
// enough to span into an unrelated clause -- unlike
// nearbyContextPattern's intentionally wider window below, this is a tight
// PHRASE check, not a same-sentence co-occurrence check.
const runwayPattern = new RegExp(
  [
    "\\bcash\\s+runway\\b",
    `\\brunway\\b[^.!?\\n]{0,15}?${MONTHS_RANGE}\\b`,
    `\\b${MONTHS_RANGE}\\b[^.!?\\n]{0,15}?\\brunway\\b`,
    nearbyContextPattern("runway", CASH_RUNWAY_CONTEXT_WORDS),
  ].join("|"),
  "i"
);

const STARTUP_FUNDRAISING_CONTEXT_WORDS =
  "seed|pre-seed|angel|venture\\s+capital|\\bvc\\b|pitch\\s+deck|investor|founder|our|term\\s+sheet|cap\\s+table";

// "Funding round"/"seed round"/"series A round" (below) are already
// unambiguous Business-Plan-specific compounds -- unchanged. Bare
// "fundraising" alone is the same class of false positive as "runway": a
// Market Intelligence report legitimately asked to analyze the
// crowdfunding/donation/nonprofit-fundraising PLATFORMS market ("the
// global fundraising platforms market", "fundraising software vendors")
// needs the word repeatedly as its actual subject, not as a founder's own
// financing activity. Only flagged when it co-occurs with genuine startup-
// financing context (seed/angel/VC/investor/founder/term sheet/cap table).
const fundraisingPattern = new RegExp(
  [
    "\\bfunding\\s+round\\b",
    "\\bseed\\s+round\\b",
    "\\bseries\\s+[a-e]\\s+(?:round|funding)\\b",
    nearbyContextPattern("fundraising", STARTUP_FUNDRAISING_CONTEXT_WORDS),
  ].join("|"),
  "i"
);

// Business Idea Validation / founder-investment vocabulary that must never
// appear in a Market Intelligence report. Patterns target the specific
// compound terms and canonical decision tokens from the founder/investment
// scoring engine (app/lib/ai/investment-score.ts) -- not generic verbs like
// "validate" or "confirm" that are ordinary evidentiary language in any
// report type.
const founderInvestmentTerms: ForbiddenPattern[] = [
  { term: "Founder Readiness", pattern: /\bfounder\s+readiness\b/i },
  { term: "Founder Score / Founder Decision Engine", pattern: /\bfounder\s+(?:score|scoring|decision\s+engine|execution)\b/i },
  { term: "Validation Gate", pattern: /\bvalidation\s+gate\b/i },
  { term: "Runway", pattern: runwayPattern },
  { term: "EBITDA", pattern: /\bebitda\b/i },
  { term: "Product-Market Fit", pattern: /\bpmf\b|\bproduct[\s-]market\s+fit\b/i },
  { term: "Investor-facing language", pattern: /\binvestor[\s-]ready\b|\binvestment\s+readiness\b/i },
  { term: "Fundraising", pattern: fundraisingPattern },
  { term: "Startup/Business validation terminology", pattern: /\bstartup\s+validation\b|\bbusiness\s+validation\b/i },
  { term: "Build / Don't Build recommendation", pattern: /\bbuild\s*\/\s*(?:don'?t|do\s+not)\s*build\b/i },
  { term: "Internal execution gate", pattern: /\b(?:execution|evidence)\s+gate\b/i },
  // REVIEWED (same false-positive class as Runway/Fundraising above, see
  // this file's top-of-block comment) but deliberately left unchanged:
  // "LTV" also means Loan-to-Value in mortgage/real-estate market
  // analysis (a legitimate Market Intelligence subject -- e.g. "average
  // LTV ratios in the mortgage lending market tightened to 75%"), and
  // "ARR" is a standard SaaS/software MARKET-level sizing metric, not
  // only a single startup's own board-deck figure (e.g. "the CRM software
  // market's aggregate ARR reached $50B"). Unlike Runway/Fundraising,
  // there is no clean, symmetric "financial-context-nearby" signal that
  // safely separates the two readings here -- both the market-level and
  // company-level senses share the same core financial vocabulary
  // (loan/value for LTV; revenue/recurring for ARR), so a quick regex
  // narrowing risks either not fixing the false positive or silently
  // admitting a genuine unit-economics leak. Left as a strict, unweakened
  // bare-acronym match; a real production report of this exact shape
  // would need a dedicated, separately-tested fix (most likely a
  // predicate-based ForbiddenPattern rather than a single regex), not a
  // rushed change bundled into this pass.
  { term: "Unit economics (CAC/LTV/ARR/MRR)", pattern: /\b(?:CAC|LTV|MRR|ARR)\b/ },
  // REVIEWED, same class, deliberately left unchanged: case-sensitivity
  // already narrows this considerably (ordinary prose rarely writes
  // "PASS"/"HOLD"/"VALIDATE"/"REJECT" in bare all-caps for an unrelated
  // reason), so the residual risk is materially smaller than Runway's
  // was. These are the decision-engine's canonical bare-uppercase verdict
  // tokens, not the ordinary lowercase verbs.
  { term: "Business-plan decision verdict token", pattern: /\b(?:PASS|HOLD|VALIDATE|REJECT)\b/ },
];

// Market-Intelligence-exclusive section/template vocabulary that must never
// appear in a Business Idea Validation report. Business Plan legitimately
// owns its own "Competitor Landscape", "TAM / SAM / SOM", and "Porter's
// Five Forces" sections -- those are not listed here. Only Market
// Intelligence's own field labels (which have no Business Plan
// equivalent) and its adjective-form "Competitive Landscape" (distinct
// from Business Plan's noun-form "Competitor Landscape") are forbidden.
// Anchored to look like a section heading (start of line, title-cased,
// optionally followed by a colon) rather than a bare phrase match --
// "competitive landscape" and "market entry strategy" are ordinary English
// phrases that can legitimately appear in Business Plan prose (e.g. "given
// the competitive landscape, ...") without being a Market Intelligence
// template leak; only the heading usage is a real signal.
function headingPattern(phrase: string) {
  return new RegExp(`^\\s*${phrase}\\s*[:\\-–—]?\\s*$`, "im");
}

const marketIntelligenceTemplateTerms: ForbiddenPattern[] = [
  { term: "Market Intelligence executive layout", pattern: /\bmarket\s+intelligence\s+executive\s+summary\b/i },
  { term: "Industry report template", pattern: /\bindustry\s+report\s+template\b/i },
  { term: "Competitive Landscape (Market Intelligence template)", pattern: headingPattern("Competitive Landscape") },
  { term: "Market entry strategy template", pattern: headingPattern("Market Entry Strategy") },
  { term: "Market Overview section", pattern: headingPattern("Market Overview") },
  { term: "Regional Analysis section", pattern: headingPattern("Regional Analysis") },
  { term: "Market Segmentation section", pattern: headingPattern("Market Segmentation") },
  { term: "Major Players section", pattern: headingPattern("Major Players") },
];

// Acquisition Due Diligence's own forbidden vocabulary: the internal
// startup-scoring/validation-engine terms that can never legitimately
// belong in an M&A report of an already-operating target company,
// regardless of evidence. Deliberately NOT the raw metric names (CAC,
// LTV, ARR, MRR, Runway, EBITDA) that founderInvestmentTerms blocks
// outright -- those are legitimate, evidence-grounded acquisition
// vocabulary here (EV/ARR valuation, the target's real ARR, its runway
// pre-close) and are governed instead by a generation-time instruction
// (never fabricate them unless user-provided or labeled "Planning
// Assumption" -- see buildDomainAnalysisInstructions' acquisition
// directives), not a blanket word-level ban.
const startupValidationEngineTerms: ForbiddenPattern[] = [
  { term: "Founder Readiness", pattern: /\bfounder\s+readiness\b/i },
  { term: "Founder Score / Founder Decision Engine", pattern: /\bfounder\s+(?:score|scoring|decision\s+engine|execution)\b/i },
  { term: "Validation Gate", pattern: /\bvalidation\s+gate\b/i },
  { term: "Product-Market Fit", pattern: /\bpmf\b|\bproduct[\s-]market\s+fit\b/i },
  { term: "Investor-facing language", pattern: /\binvestor[\s-]ready\b|\binvestment\s+readiness\b/i },
  { term: "Fundraising", pattern: fundraisingPattern },
  { term: "Startup/Business validation terminology", pattern: /\bstartup\s+validation\b|\bbusiness\s+validation\b/i },
  { term: "Build / Don't Build recommendation", pattern: /\bbuild\s*\/\s*(?:don'?t|do\s+not)\s*build\b/i },
  { term: "Internal execution gate", pattern: /\b(?:execution|evidence)\s+gate\b/i },
  { term: "Business-plan decision verdict token", pattern: /\b(?:PASS|HOLD|VALIDATE|REJECT)\b/ },
];

const FORBIDDEN_TERMS: Record<ReportProductType, ForbiddenPattern[]> = {
  market_intelligence: founderInvestmentTerms,
  business_plan: marketIntelligenceTemplateTerms,
  // Strategic Advisory must inherit neither report's specific vocabulary.
  strategic_advisory: [...founderInvestmentTerms, ...marketIntelligenceTemplateTerms],
  acquisition_due_diligence: [...startupValidationEngineTerms, ...marketIntelligenceTemplateTerms],
};

// Single source of truth for "what must this report type never contain,"
// reusable by generation prompts so the model is instructed to avoid
// exactly what this validator will reject after the fact -- not a second,
// separately hand-maintained list that can silently drift from the real
// forbidden-term patterns above (confirmed live: the Market Intelligence
// prompt's own "never generate ..." exclusion sentence listed Unit
// Economics/CAC/LTV/ARR/Founder Score but never named "Runway"/"EBITDA",
// so nothing told the model to avoid that word even though this validator
// has always rejected it -- the model was free to write ordinary business
// prose using it, which then failed generation after the fact instead of
// never being written in the first place).
export function getForbiddenTermLabels(reportType: ReportProductType): string[] {
  return FORBIDDEN_TERMS[reportType].map((entry) => entry.term);
}

function snippetAround(content: string, match: RegExpMatchArray) {
  const index = match.index ?? 0;
  const start = Math.max(0, index - 40);
  const end = Math.min(content.length, index + (match[0]?.length ?? 0) + 40);
  return content.slice(start, end).replace(/\s+/g, " ").trim();
}

export function findReportIsolationViolations(
  reportType: ReportProductType,
  sections: Record<string, string | undefined>
): IsolationViolation[] {
  const patterns = FORBIDDEN_TERMS[reportType];
  const violations: IsolationViolation[] = [];

  for (const [field, content] of Object.entries(sections)) {
    if (!content) continue;

    for (const { term, pattern } of patterns) {
      const match = content.match(pattern);
      if (match) {
        violations.push({ field, term, snippet: snippetAround(content, match) });
      }
    }
  }

  return violations;
}

export class ReportIsolationError extends Error {
  violations: IsolationViolation[];
  reportType: ReportProductType;

  constructor(reportType: ReportProductType, violations: IsolationViolation[]) {
    const summary = violations
      .map((v) => `[${v.field}] "${v.term}" -> …${v.snippet}…`)
      .join("; ");
    super(
      `Report isolation violation for ${reportType}: found ${violations.length} foreign-report term(s): ${summary}`
    );
    this.name = "ReportIsolationError";
    this.violations = violations;
    this.reportType = reportType;
  }
}

// Fail fast instead of silently returning a mixed report: throws
// ReportIsolationError if any section contains another report type's
// specific vocabulary.
export function assertReportIsolation(
  reportType: ReportProductType,
  sections: Record<string, string | undefined>
): void {
  const violations = findReportIsolationViolations(reportType, sections);
  if (violations.length > 0) {
    throw new ReportIsolationError(reportType, violations);
  }
}
