import type { AcquisitionAnalysisField } from "./prompts/acquisition-analysis.ts";

// CRITICAL FIX -- remove internal evidence/reasoning-pipeline leakage from
// the customer-facing acquisition report. The AI (and, for the timeout
// fallback, plan-executor.ts's createGroundedAcquisitionTimeoutFallback)
// is deliberately still asked to populate rich, citation-heavy content in
// these fields -- see acquisition-analysis.ts's own field prompts ("Every
// claim must cite an evidence registry ID", "List every ... source
// title, publisher, and URL") -- that detail is genuinely useful for
// internal reasoning/audit and stays intact in the stored report row
// exactly as generated. This module only controls what a CUSTOMER ever
// sees rendered, in the dashboard viewer or the PDF: presentation, never
// generation, routing, or storage.

// Whole fields that are internal reasoning material end to end -- never
// rendered to the customer, regardless of content.
export const acquisitionInternalOnlyFields: readonly AcquisitionAnalysisField[] = [
  "externalEvidence",
  "sources",
];

export function isAcquisitionCustomerFacingField(field: string): boolean {
  return !(acquisitionInternalOnlyFields as readonly string[]).includes(field);
}

// Bracket-tag citation/provenance markers: [R12], [Asset: ...],
// [Method: ...], [Required: ...], [Basis: ...] (including the exact
// leaked "[Basis:research task registry]" / "[Basis:acquisition evidence
// registry]" tags plan-executor.ts's timeout fallback writes into every
// field), [Recommendation], [User], and the "Verified from X"/[Unknown]/
// [Estimate]/[Assumption] evidence-classification tags. Deliberately does
// NOT match the bare [Verified]/[Derived] labels the deal-facts pipeline
// prepends to purchase price/ARR/EV-ARR/financing figures (see
// app/lib/ai/acquisition-deal-facts.ts) -- those are exactly the figures
// this fix is required to preserve, and neither is ever followed by
// "from ... source" or any other suffix, so this pattern never touches
// them.
const citationBracketTagPattern =
  /\[(?:R\d+|Asset:[^\]]*|Method:[^\]]*|Required:[^\]]*|Basis:[^\]]*|Recommendation|Verified from (?:uploaded asset|official source|external source)|Unknown|Estimated?|Assumption|User)\]/gi;

// A leaked decision-intelligence extracted-fact line -- e.g. a
// misclassified "legal_domain: legal" or "requested_decision: Assess
// legal position and decision options" that decision-intelligence's
// employment-signal detector can attach to an acquisition prompt purely
// because it mentions an ordinary word like "employees" (see
// app/lib/decision-intelligence/legal-research-context.mjs). Not fixed at
// that source here -- this is presentation, not extraction logic -- this
// is the safety net that guarantees it can never reach the customer
// regardless of why it was produced.
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
  /\b(?:evidence registry|research task registry|decision intelligence(?:\s+engine)?|executive assessment)\b/gi;

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

// Order matters: whole-line removals run first (so a bracket tag at the
// start of an internal-registry/leaked-fact line doesn't get stripped in
// isolation, leaving an orphaned rest-of-line fragment behind), then
// inline bracket tags, standalone vocabulary, confidence scores, and bare
// URLs are stripped from whatever prose remains.
export function stripAcquisitionInternalArtifacts(content: string): string {
  if (!content) return content;

  let sanitized = content;
  sanitized = sanitized.replace(leakedInternalFactLinePattern, "");
  sanitized = sanitized.replace(internalRegistryLinePattern, "");
  sanitized = sanitized.replace(citationBracketTagPattern, "");
  sanitized = sanitized.replace(internalVocabularyPattern, "");
  sanitized = sanitized.replace(confidenceScorePattern, "");
  sanitized = sanitized.replace(bareUrlPattern, "");

  return collapseWhitespace(sanitized);
}

// Applies both layers of the fix to an already-normalized section list:
// drops the internal-only fields entirely, then sanitizes the content of
// every remaining, genuinely customer-facing section. A section that
// becomes empty after sanitization (all internal artifact, no real
// prose) is dropped rather than rendered as a blank card.
export function sanitizeAcquisitionReportSections<
  T extends { field?: string; content: string },
>(sections: readonly T[]): T[] {
  return sections
    .filter((section) => !section.field || isAcquisitionCustomerFacingField(section.field))
    .map((section) => ({
      ...section,
      content: stripAcquisitionInternalArtifacts(section.content),
    }))
    .filter((section) => section.content.trim().length > 0);
}
