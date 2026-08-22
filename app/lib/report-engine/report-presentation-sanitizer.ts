// CRITICAL PRODUCT FIX -- convert internal reasoning output into clean
// executive language, across every report type (Business Plan, Market
// Intelligence, Real Estate, Legal/Finance/Accounting/Operations/
// Procurement, Strategic Advisory, Acquisition Due Diligence).
//
// Every one of these report types is deliberately still asked to populate
// rich, citation-heavy content internally -- evidence-registry [R#]
// citations, research-task-registry detail, publisher/URL source lines,
// and (for every domain's timeout-fallback path in plan-executor.ts)
// bracket-tag provenance labels like [Unknown] [Required:field] and
// [Recommendation] [Basis:decision engine] -- that detail is genuinely
// useful for internal reasoning/audit and stays intact in the stored
// report row exactly as generated. This module only controls what a
// CUSTOMER ever sees rendered, in the dashboard viewer or the PDF:
// presentation, never generation, routing, or storage. Reasoning quality
// is unchanged -- a field still says exactly what it said before, just
// in the report's own natural executive language instead of internal
// pipeline notation.

// Whole fields that are internal reasoning material end to end -- never
// rendered to the customer, regardless of report type or content. Every
// schema in this codebase that has these fields uses these exact same
// two field names (acquisition-analysis.ts, domain-analysis.ts,
// real-estate.ts, market.ts) -- no report type spells them differently.
export const universalInternalOnlyFields: readonly string[] = [
  "externalEvidence",
  "sources",
];

export function isUniversalCustomerFacingField(field: string): boolean {
  return !universalInternalOnlyFields.includes(field);
}

// CRITICAL FIX -- apply presentation sanitization to ALL report surfaces.
// Confirmed live: excluding by field name alone was not enough -- Business
// Plan's own sources field is literally named "sourcesAssumptions" (not
// "sources"), and ReportPdfButton.tsx's legal-report path constructs its
// own fresh "legalSources" section from the report's own citation content
// AFTER normalizeReport already ran, so a field-name-only exclusion
// upstream could never catch it. Both still render under a title a reader
// unambiguously recognizes as a sources/evidence page (mirrors
// ReportPdfButton.tsx's own pre-existing isSourceSectionTitle check, kept
// here as the single canonical definition both the dashboard-viewer path
// (via sanitizeReportSectionsForPresentation below) and the PDF's own
// late-stage section filter share, so the two surfaces can never drift
// out of sync on what counts as a sources/evidence section).
const internalOnlySectionTitlePattern =
  /^(sources(?:\s+continued)?|references|verified sources|external evidence|sources\s*\/\s*assumptions|kaynaklar(?:\s+devamı)?|doğrulanmış kaynaklar|dış kaynak kanıtları|kaynaklar\s*\/\s*varsayımlar|quellen|externe nachweise|fuentes|evidencia externa|éléments probants externes)$/i;

export function isInternalOnlySectionTitle(title: string): boolean {
  return internalOnlySectionTitlePattern.test(title.trim());
}

export function isUniversalCustomerFacingSection(section: {
  field?: string;
  title?: string;
}): boolean {
  if (section.field && !isUniversalCustomerFacingField(section.field)) {
    return false;
  }
  if (section.title && isInternalOnlySectionTitle(section.title)) {
    return false;
  }
  return true;
}

// Bracket-tag citation/provenance markers: [R12], [Asset: ...],
// [Method: ...], [Required: ...], [Basis: ...] (including the exact
// "[Basis:research task registry]" / "[Basis:decision engine]" /
// "[Basis:verified evidence and deadline fallback]" tags every domain's
// timeout fallback in plan-executor.ts writes into its fields),
// [Recommendation], [User], and the "Verified from X"/[Unknown]/
// [Estimate]/[Assumption] evidence-classification tags. Deliberately does
// NOT match the bare [Verified]/[Derived] labels the deal-facts pipeline
// prepends to acquisition purchase price/ARR/EV-ARR/financing figures
// (app/lib/ai/acquisition-deal-facts.ts) -- those are meaningful figures
// this fix must preserve, and neither is ever followed by "from ...
// source" or any other suffix, so this pattern never touches them.
const citationBracketTagPattern =
  /\[(?:R\d+|Asset:[^\]]*|Method:[^\]]*|Required:[^\]]*|Basis:[^\]]*|Recommendation|Verified from (?:uploaded asset|official source|external source)|Unknown|Estimated?|Assumption|User)\]/gi;

// The same "Verified from X" evidence-classification phrase, unbracketed
// -- CRITICAL FIX -- apply presentation sanitization to ALL report
// surfaces: named explicitly as its own removal target, independent of
// bracket notation, so a report surface that renders this phrase as bare
// prose (not the "[Verified from X]" bracket-tag shape the pattern above
// already catches) is covered too.
const bareVerifiedFromPhrasePattern =
  /\bVerified from (?:uploaded asset|official source|external source)\b/gi;

// The exact "[Unknown] [Required:field] <generic template sentence>"
// shape every domain's timeout fallback writes for an unresolved
// research item (see plan-executor.ts's createGroundedDomainTimeoutFallback/
// createGroundedAcquisitionTimeoutFallback: "[Unknown] [Required:${task.
// field}] Some external sources could not be verified, so this field is
// not definitive."). Rewritten into a natural sentence built from the
// humanized field identifier BEFORE the generic bracket-tag stripper
// below ever runs, so the result reads like an executive advisor's own
// words ("Purchase price assessment requires additional information...")
// instead of a stripped-down fragment of the internal template sentence.
const unknownRequiredSentencePattern =
  /\[Unknown\]\s*\[Required:([^\]]+)\]\s*[^\n]*/gi;

function humanizeFieldIdentifier(field: string): string {
  const cleaned = field
    .trim()
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  return cleaned.replace(/^./, (char) => char.toUpperCase());
}

function rewriteUnknownRequiredSentences(content: string): string {
  return content.replace(unknownRequiredSentencePattern, (_match, field: string) => {
    const topic = humanizeFieldIdentifier(field);
    return `${topic} requires additional verification before this can be finalized.`;
  });
}

// A leaked decision-intelligence extracted-fact line -- e.g. a
// misclassified "legal_domain: legal" or "requested_decision: Assess
// legal position and decision options" that decision-intelligence's
// employment-signal detector can attach to any report's extracted facts
// purely because the prompt mentions an ordinary word like "employees"
// (see app/lib/decision-intelligence/legal-research-context.mjs). Not
// fixed at that source here -- this is presentation, not extraction
// logic -- this is the safety net that guarantees it can never reach the
// customer regardless of why it was produced.
const leakedInternalFactLinePattern =
  /^\s*(?:[-*•]\s*)?(?:\[[^\]]*\]\s*)?(?:legal_domain|requested_decision|jurisdiction_country|jurisdiction_region|governing_law)\s*:\s*.*$/gim;

// A raw citation-detail line from the research/evidence-registry format
// (app/lib/ai/domain-research.ts's formatDomainResearchBundle): Publisher,
// Source URL/title/type, Evidence ID, Confidence classification.
const internalRegistryLinePattern =
  /^\s*(?:[-*•]\s*)?(?:\[[^\]]*\]\s*)?(?:Publisher|Source\s*(?:URL|title|type)|Evidence\s*ID|Confidence\s*classification)\s*[:\-–—].*$/gim;

// Standalone internal-pipeline vocabulary that must never appear as prose
// in a customer report, even mid-sentence and even if not wrapped in a
// bracket tag or its own line.
const internalVocabularyPattern =
  /\b(?:evidence registry|research task registry|decision intelligence(?:\s+engine)?|executive assessment|decision engine|synthesis provider|deadline fallback)\b/gi;

const bareUrlPattern = /https?:\/\/\S+/gi;
const confidenceScorePattern = /\bconfidence\s*\d{1,3}\/100\b/gi;

function collapseWhitespace(value: string): string {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

// Order matters: the [Unknown]/[Required:...] rewrite runs FIRST (it
// needs the tags still in place to read the field identifier out of
// them), then whole-line removals (so a bracket tag at the start of an
// internal-registry/leaked-fact line doesn't get stripped in isolation,
// leaving an orphaned rest-of-line fragment behind), then inline bracket
// tags, standalone vocabulary, confidence scores, and bare URLs are
// stripped from whatever prose remains.
export function stripReportPresentationArtifacts(content: string): string {
  if (!content) return content;

  let sanitized = content;
  sanitized = rewriteUnknownRequiredSentences(sanitized);
  sanitized = sanitized.replace(leakedInternalFactLinePattern, "");
  sanitized = sanitized.replace(internalRegistryLinePattern, "");
  sanitized = sanitized.replace(citationBracketTagPattern, "");
  sanitized = sanitized.replace(bareVerifiedFromPhrasePattern, "");
  sanitized = sanitized.replace(internalVocabularyPattern, "");
  sanitized = sanitized.replace(confidenceScorePattern, "");
  sanitized = sanitized.replace(bareUrlPattern, "");

  return collapseWhitespace(sanitized);
}

// Applies both layers of the fix to an already-normalized section list,
// for ANY report type: drops the internal-only fields entirely, then
// sanitizes the content of every remaining, genuinely customer-facing
// section. A section that becomes empty after sanitization (all internal
// artifact, no real prose) is dropped rather than rendered as a blank
// card.
export function sanitizeReportSectionsForPresentation<
  T extends { field?: string; title?: string; content: string },
>(sections: readonly T[]): T[] {
  return sections
    .filter((section) => isUniversalCustomerFacingSection(section))
    .map((section) => ({
      ...section,
      content: stripReportPresentationArtifacts(section.content),
    }))
    .filter((section) => section.content.trim().length > 0);
}
