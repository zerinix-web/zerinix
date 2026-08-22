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
  { term: "Runway", pattern: /\brunway\b/i },
  { term: "EBITDA", pattern: /\bebitda\b/i },
  { term: "Product-Market Fit", pattern: /\bpmf\b|\bproduct[\s-]market\s+fit\b/i },
  { term: "Investor-facing language", pattern: /\binvestor[\s-]ready\b|\binvestment\s+readiness\b/i },
  { term: "Fundraising", pattern: /\bfundraising\b|\bfunding\s+round\b|\bseed\s+round\b|\bseries\s+[a-e]\s+(?:round|funding)\b/i },
  { term: "Startup/Business validation terminology", pattern: /\bstartup\s+validation\b|\bbusiness\s+validation\b/i },
  { term: "Build / Don't Build recommendation", pattern: /\bbuild\s*\/\s*(?:don'?t|do\s+not)\s*build\b/i },
  { term: "Internal execution gate", pattern: /\b(?:execution|evidence)\s+gate\b/i },
  { term: "Unit economics (CAC/LTV/ARR/MRR)", pattern: /\b(?:CAC|LTV|MRR|ARR)\b/ },
  // Case-sensitive on purpose: these are the decision-engine's canonical
  // bare-uppercase verdict tokens, not the ordinary lowercase verbs.
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
  { term: "Fundraising", pattern: /\bfundraising\b|\bfunding\s+round\b|\bseed\s+round\b|\bseries\s+[a-e]\s+(?:round|funding)\b/i },
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
