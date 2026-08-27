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
// [Estimate]/[Assumption] evidence-classification tags.
//
// CRITICAL FIX -- final cleanup: bare [Verified]/[Derived] now match too
// -- this reverses an earlier turn's deliberate exclusion. That turn kept
// them on the theory that a bracket LABEL naming the evidence tier was
// itself useful signal; confirmed live, it was not -- "[Verified]
// Purchase price: $40M" still reads as internal notation to a customer.
// The underlying figure is what must survive, not the classification
// label around it: "[Verified] Purchase price: $40M" -> "Purchase price:
// $40M". The heading line each deal-facts block is prepended under
// ("Verified Deal Facts:" / "Derived Valuation Metric:" / "Derived
// Financing Metrics:", see acquisition-deal-facts.ts's
// formatVerifiedDealFactsBlock/formatDerivedValuationBlock/
// formatDerivedFinancingBlock) is stripped separately below, by the same
// reasoning.
const citationBracketTagPattern =
  /\[(?:R\d+|Asset:[^\]]*|Method:[^\]]*|Required:[^\]]*|Basis:[^\]]*|Recommendation|Verified from (?:uploaded asset|official source|external source)|Unknown|Estimated?|Assumption|User|Verified|Derived)\]/gi;

// The internal block-label heading each deal-facts block is prepended
// under (acquisition-deal-facts.ts) -- a label for the block, not part of
// any individual figure, so it is removed as a whole line rather than
// left dangling once its own [Verified]/[Derived] tags are gone.
const dealFactsHeadingLinePattern =
  /^\s*(?:Verified Deal Facts|Derived Valuation Metric|Derived Financing Metrics|Doğrulanmış İşlem Bilgileri|Türetilmiş Değerleme Metriği|Türetilmiş Finansman Metrikleri)\s*:\s*$/gim;

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
// not definitive.").
//
// CRITICAL FIX -- final cleanup: an earlier turn rewrote this into a
// sentence built from the humanized field identifier ("Valuation
// purchase price requires additional verification before this can be
// finalized.") -- confirmed live, that still leaked the internal
// research-task field name (raw or lightly humanized: "authoritative
// source", "target_financials", "valuation_purchase_price",
// "integration_operational_risk", ...) as the sentence's own subject,
// which reads as internal notation regardless of the underscore cleanup.
// The field identifier is dropped entirely now -- every occurrence
// becomes the same fixed, genuinely natural executive sentence.
const unknownRequiredSentencePattern =
  /\[Unknown\]\s*\[Required:[^\]]+\]\s*[^\n]*/gi;
const unknownRequiredReplacementSentence =
  "Additional financial and operational information is needed before making a final decision.";

function rewriteUnknownRequiredSentences(content: string): string {
  return content.replace(unknownRequiredSentencePattern, unknownRequiredReplacementSentence);
}

// decision-intelligence/risk-engine.ts's own deterministic evidence-gap
// sentence: "Critical decision evidence remains unresolved: ${field}." --
// unlike the [Required:...] tag above, this one names a genuinely
// meaningful topic (e.g. "valuation"), so it is rewritten to keep that
// topic rather than genericized away, matching the fix's own required
// example.
const criticalDecisionEvidenceSentencePattern =
  /\bCritical decision evidence remains unresolved:\s*([^.\n]+)\.?/gi;

function rewriteCriticalDecisionEvidenceSentences(content: string): string {
  return content.replace(criticalDecisionEvidenceSentencePattern, (_match, topic: string) => {
    const cleanTopic = topic.trim().replace(/_/g, " ").toLowerCase();
    return `The ${cleanTopic} should be reviewed further before closing.`;
  });
}

// plan-executor.ts's per-domain timeout-fallback disclosure sentence
// (English and Turkish; see createGroundedDomainTimeoutFallback/
// createGroundedAcquisitionTimeoutFallback's own `localized.timeout`) --
// entirely internal operational status text with no analytical content,
// so it is removed as a whole sentence rather than word-by-word: removing
// only "synthesis provider"/"existing decision engine" from inside it
// would leave a grammatically broken remnant ("The  reached its
// deadline; ... and the ."). Matched loosely (word-count-bounded gaps,
// not an exact string) so minor wording drift in plan-executor.ts still
// gets caught.
const timeoutDisclosureSentencePattern =
  /\bThe synthesis provider reached its deadline[\s\S]{0,20}?this preliminary report was completed from verified evidence and the existing decision engine\.?/gi;
const timeoutDisclosureSentencePatternTr =
  /\bSentez sağlayıcısı süre sınırına ulaştı[\s\S]{0,20}?bu ön rapor doğrulanmış kanıtlar ve mevcut karar motoru kullanılarak tamamlandı\.?/gi;

// Any bare snake_case token (lowercase words joined by underscores) is
// unambiguously an internal identifier leak -- ordinary English prose
// never contains an underscore, so this can never mistakenly rewrite
// legitimate analysis. Catches every research-task/section-plan field
// identifier this codebase uses (target_financials, purchase_price,
// valuation_purchase_price, integration_operational_risk, and any other,
// not-yet-seen one) without needing a hand-maintained lookup table.
const snakeCaseIdentifierPattern = /\b[a-z]+(?:_[a-z]+)+\b/g;

function naturalizeSnakeCaseIdentifiers(content: string): string {
  return content.replace(snakeCaseIdentifierPattern, (match) => match.replace(/_/g, " "));
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
// CRITICAL FIX -- sanitization must preserve complete report payload:
// while auditing for that fix, both line patterns below turned out to
// only consume ONE leading bracket tag ((?:\[[^\]]*\]\s*)?) before
// requiring the label -- a real citation line commonly carries more than
// one ("[Verified] [R1] Publisher: Statista"), so the second tag broke
// the match entirely and the whole line survived unstripped. Both
// patterns now consume any NUMBER of leading bracket tags
// ((?:\[[^\]]*\]\s*)*), strengthening (never weakening) what already
// matched.
const leakedInternalFactLinePattern =
  /^\s*(?:[-*•]\s*)?(?:\[[^\]]*\]\s*)*(?:legal_domain|requested_decision|jurisdiction_country|jurisdiction_region|governing_law)\s*:\s*.*$/gim;

// A raw citation-detail line from the research/evidence-registry format
// (app/lib/ai/domain-research.ts's formatDomainResearchBundle): Publisher,
// Source URL/title/type, Evidence ID, Confidence classification.
const internalRegistryLinePattern =
  /^\s*(?:[-*•]\s*)?(?:\[[^\]]*\]\s*)*(?:Publisher|Source\s*(?:URL|title|type)|Evidence\s*ID|Confidence\s*classification)\s*[:\-–—].*$/gim;

// Standalone internal-pipeline vocabulary that must never appear as prose
// in a customer report, even mid-sentence and even if not wrapped in a
// bracket tag or its own line. "existing decision engine" listed before
// the bare "decision engine" it contains, as a defensive second layer --
// timeoutDisclosureSentencePattern above already removes the full
// sentence this phrase normally appears in, but if that sentence's
// wording ever drifts enough to not match, this still catches the phrase
// itself instead of leaving "existing" orphaned.
const internalVocabularyPattern =
  /\b(?:evidence registry|research task registry|decision intelligence(?:\s+engine)?|executive assessment|existing decision engine|decision engine|synthesis provider|deadline fallback)\b/gi;

const bareUrlPattern = /https?:\/\/\S+/gi;
const confidenceScorePattern = /\bconfidence\s*\d{1,3}\/100\b/gi;

// P0 PRODUCTION FIX -- confirmed live (Market Intelligence production
// consistency hardening): every section prompt in
// app/lib/report-engine/prompts/market.ts ends with its own word-count
// budget as the LAST sentence of the model's instructions ("... Max 200
// words.", "... Max 180 words.", etc.) -- a known LLM failure mode is
// echoing a trailing generation constraint verbatim into the answer
// itself when it isn't clearly separated from "write this" framing.
// Confirmed live: a PDF export displayed literal "(Max 180 words)"/
// "(Max 160 words)" fragments as if they were report content. Anchored
// to end-of-line (the `m` flag's `$`) rather than matching anywhere in
// a line -- the real leaked artifact always appears as the LAST thing
// the model wrote for that section, exactly mirroring how it sits at
// the end of its own prompt instruction -- so this can never strip a
// legitimate business sentence that merely mentions a word count or the
// word "words" in the middle of otherwise-real content (e.g. "the
// report contains 200 words of executive commentary before the
// appendix" is left completely untouched, since more text follows it on
// the same line).
const promptWordBudgetLeakPattern = /\s*\(?\b(?:max|maximum)\.?\s+\d{1,4}\s+words\)?\.?\s*$/gim;

function collapseWhitespace(value: string): string {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

// CRITICAL FIX -- sanitization must preserve complete report payload.
// Confirmed live: some fields in the per-domain timeout fallback
// (plan-executor.ts's createGroundedAcquisitionTimeoutFallback/
// createGroundedDomainTimeoutFallback) are set to ENTIRELY the timeout-
// disclosure sentence and nothing else -- e.g. `roiAnalysis:
// localized.timeout` / `irrAnalysis: localized.timeout` -- so once
// timeoutDisclosureSentencePattern (added in the prior "final cleanup"
// turn) correctly removes that whole sentence, those two fields'
// sanitized content became a true empty string. Planner.tsx's live view
// then never called markSectionComplete for them (content is falsy), so
// completedFields.size fell short of outputFields.length and the
// hasCompletePayload check failed outright -- "Report job completed
// without a complete report payload." This is never allowed to happen
// again for ANY field, known or future: if a field HAD real content but
// sanitization consumed all of it, the section still needs SOMETHING to
// satisfy the report contract (title, sections array, section content,
// recommendation, metrics, risks, next actions all present) -- so a
// genuinely non-empty input that fully sanitizes down to nothing gets
// this fallback sentence instead of true emptiness. This does not weaken
// what gets removed above -- every pattern still runs exactly as before;
// it only guarantees the section itself is never blank. A field whose
// ORIGINAL content was already empty is untouched by this and still
// returns empty (see the early return below), so
// sanitizeReportSectionsForPresentation's own "drop a section with no
// real content" filter keeps working for that case.
const emptyAfterSanitizationFallback =
  "Additional information is needed to complete this section.";

// Order matters: sentence-level rewrites run FIRST, while their own
// bracket tags/exact wording are still intact ([Unknown]/[Required:...]
// and the timeout-disclosure sentence need to match themselves whole,
// before any smaller pattern below could partially consume them and
// leave a broken remnant); then whole-line removals (so a bracket tag at
// the start of an internal-registry/leaked-fact/deal-facts-heading line
// doesn't get stripped in isolation, leaving an orphaned rest-of-line
// fragment behind); then inline bracket tags (now including bare
// [Verified]/[Derived]), the unbracketed "Verified from X" phrase,
// standalone vocabulary, confidence scores, and bare URLs; then any
// remaining raw snake_case identifier is naturalized as the last polish
// pass; and finally, if a genuinely non-empty input sanitized down to
// nothing, the schema-preservation fallback above takes its place.
export function stripReportPresentationArtifacts(content: string): string {
  if (!content) return content;

  let sanitized = content;
  sanitized = rewriteUnknownRequiredSentences(sanitized);
  sanitized = rewriteCriticalDecisionEvidenceSentences(sanitized);
  sanitized = sanitized.replace(timeoutDisclosureSentencePattern, "");
  sanitized = sanitized.replace(timeoutDisclosureSentencePatternTr, "");
  sanitized = sanitized.replace(leakedInternalFactLinePattern, "");
  sanitized = sanitized.replace(internalRegistryLinePattern, "");
  sanitized = sanitized.replace(dealFactsHeadingLinePattern, "");
  sanitized = sanitized.replace(citationBracketTagPattern, "");
  sanitized = sanitized.replace(bareVerifiedFromPhrasePattern, "");
  sanitized = sanitized.replace(internalVocabularyPattern, "");
  sanitized = sanitized.replace(confidenceScorePattern, "");
  sanitized = sanitized.replace(bareUrlPattern, "");
  sanitized = sanitized.replace(promptWordBudgetLeakPattern, "");
  sanitized = naturalizeSnakeCaseIdentifiers(sanitized);

  return collapseWhitespace(sanitized) || emptyAfterSanitizationFallback;
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

// CRITICAL FIX -- remove internal system language from user-facing
// Market Intelligence output. formatExecutiveDecisionBrief
// (executive-decision-brief.ts) bakes a "What Evidence Is Missing:"
// heading directly into the stored report text at generation time --
// that module is shared with Business Plan, Acquisition, and the
// domain-analysis family, so its heading text cannot be relabeled at
// the source without changing report generation for every report kind
// that shares it, which is out of scope here. This is an additional,
// Market-Intelligence-only presentation pass applied on top of the
// universal stripReportPresentationArtifacts above -- it matches only
// the exact, whole-line heading text that function produces (anchored,
// so it can never partially match ordinary prose that happens to
// mention "evidence"), and reframes it as an honest, non-alarming
// statement of what the reader should do next rather than a bare
// internal-audit label.
const marketIntelligenceHeadingReplacements: ReadonlyArray<readonly [RegExp, string]> = [
  [/^What Evidence Is Missing:\s*$/gim, "Information Required Before Decision:"],
  [/^Eksik Olan Kanıtlar:\s*$/gim, "Karardan Önce Gereken Bilgiler:"],
  [/^Welche Belege fehlen:\s*$/gim, "Vor der Entscheidung erforderliche Informationen:"],
  [/^Quelles preuves manquent:\s*$/gim, "Informations requises avant la décision:"],
  [/^Qué evidencia falta:\s*$/gim, "Información requerida antes de la decisión:"],
];

// CRITICAL FIX -- a bracketed evidence-ID citation list ("Evidence:
// [R1], [R2]") has its bracket tags already removed by the universal
// stripReportPresentationArtifacts above (citationBracketTagPattern),
// but that leaves a dangling, broken-looking "Evidence: ," or
// "Evidence: , ," fragment behind -- confirmed live. Market
// Intelligence's own market-intelligence-graph.ts is the only producer
// of this exact "| Evidence: [ids]" shape, so removing the whole
// dangling fragment here (rather than just relabeling it, since its
// content is already gone) is honest: no information is hidden that
// wasn't already stripped by the universal pass.
const marketIntelligenceDanglingEvidenceLabelPattern = /\s*\|\s*Evidence:\s*(?:,\s*)*(?=\||$)/gim;

// CRITICAL FIX -- "Some external sources could not be verified..." reads
// as an internal audit disclosure rather than an executive statement of
// what to do next. Multiple trailing clauses exist across this
// codebase's generation-time fallback text ("...so this section does
// not contain a definitive conclusion." / "...so the affected sections
// are not definitive." / "...so this field is not definitive."); all are
// replaced with the ticket's own single, canonical sentence regardless
// of which trailing clause was generated.
const marketIntelligenceUnverifiedSourcesReplacements: ReadonlyArray<readonly [RegExp, string]> = [
  [
    /Some external sources could not be verified,?\s*so[^.]*\./gi,
    "Some assumptions require additional validation before a final conclusion.",
  ],
  [
    /Bazı dış kaynaklar doğrulanamadığı için[^.]*\./gi,
    "Bazı varsayımlar nihai bir sonuca varılmadan önce ek doğrulama gerektiriyor.",
  ],
];

export function sanitizeMarketIntelligencePresentationText(content: string): string {
  if (!content) return content;

  let sanitized = content;
  for (const [pattern, replacement] of marketIntelligenceHeadingReplacements) {
    sanitized = sanitized.replace(pattern, replacement);
  }
  for (const [pattern, replacement] of marketIntelligenceUnverifiedSourcesReplacements) {
    sanitized = sanitized.replace(pattern, replacement);
  }
  sanitized = sanitized.replace(marketIntelligenceDanglingEvidenceLabelPattern, "");

  return sanitized;
}
