// Fail-fast integrity check for bracketed [R#] evidence citations: every
// reference actually rendered anywhere in the report must resolve to a
// real entry in the verified evidence/source registry (MarketIntelligenceGraph's
// own `sources`, built directly from research evidence -- see
// market-intelligence-graph.ts). A citation the model wrote that does not
// resolve is either a hallucinated reference number or a real source that
// was dropped somewhere between research and the final report -- in either
// case it must never reach the reader as a silent, unverifiable [R#]
// marker with nothing behind it. Matches the same fail-fast convention as
// this file's siblings (report-isolation-validator.ts,
// decision-contradiction-gate.ts): throw rather than silently degrade.

import type { ResponseLanguage } from "@/app/lib/report-language";

export type OrphanEvidenceReference = { field: string; reference: string };

const evidenceReferencePattern = /\[R(\d+)\]/g;

export function findOrphanEvidenceReferences(
  sections: Record<string, string | undefined>,
  knownEvidenceIds: ReadonlySet<string>
): OrphanEvidenceReference[] {
  const orphans: OrphanEvidenceReference[] = [];

  for (const [field, content] of Object.entries(sections)) {
    if (!content) continue;

    const seenInField = new Set<string>();
    evidenceReferencePattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = evidenceReferencePattern.exec(content))) {
      const id = `R${match[1]}`;
      if (seenInField.has(id)) continue;
      seenInField.add(id);
      if (!knownEvidenceIds.has(id)) {
        orphans.push({ field, reference: `[${id}]` });
      }
    }
  }

  return orphans;
}

export class OrphanEvidenceReferenceError extends Error {
  orphans: OrphanEvidenceReference[];

  constructor(orphans: OrphanEvidenceReference[]) {
    const summary = orphans
      .map((orphan) => `[${orphan.field}] ${orphan.reference}`)
      .join("; ");
    super(
      `Report cites ${orphans.length} evidence reference(s) with no matching entry in the verified source registry: ${summary}`
    );
    this.name = "OrphanEvidenceReferenceError";
    this.orphans = orphans;
  }
}

// Fail fast instead of silently shipping a report with an unresolvable
// [R#] marker -- every reference the model actually used must be backed
// by a real, verified source record.
export function assertNoOrphanEvidenceReferences(
  sections: Record<string, string | undefined>,
  knownEvidenceIds: ReadonlySet<string>
): void {
  const orphans = findOrphanEvidenceReferences(sections, knownEvidenceIds);
  if (orphans.length > 0) {
    throw new OrphanEvidenceReferenceError(orphans);
  }
}

// P0 PRODUCTION FIX -- confirmed live (Market Intelligence citation
// integrity audit): assertNoOrphanEvidenceReferences above is only ever
// called when a MarketIntelligenceGraph is available (`if (graph)` in
// route.ts), because it needs a real `citableEvidenceIds` registry to
// check against. A cache-hit reconstruction with no graph (a real,
// currently-occurring state -- e.g. an older cache row that predates the
// graph being persisted alongside it) skips that check entirely, and the
// Sources field degrades to a generic category+count summary
// (buildEvidenceSummary) that has no relationship to the specific [R#]
// numbers the model's own freeform prose used elsewhere in the SAME
// report. Confirmed live against a real persisted report: executiveSummary/
// majorPlayers/competitiveLandscape/strategicRecommendations cited
// [R3][R4][R5][R6][R12][R39] while Sources read "1 verified source used"
// -- every one of those six reference numbers was an unresolvable dead
// end for the reader, with nothing in this file's own safety net able to
// catch it because it had no registry to check against.
//
// This is the fallback for exactly that state: when there is no evidence
// registry to verify a [R#] marker against, the marker cannot be
// distinguished from a hallucination, so it must never reach the reader
// looking like a resolvable citation. Rather than silently deleting the
// marker (which would erase the fact the model claimed evidentiary
// support at all, understating the gap), each one is replaced with an
// explicit, localized "unverifiable" label -- the same "never fabricate
// confidence, always label the gap honestly" convention already used by
// financial-claim-labeling.ts and evidence-summary.ts's own
// noEvidenceCopy. The original reference number is deliberately dropped
// (not kept as e.g. "[R12 -- unverified]"): a surviving number implies
// there is something to look up, but with no registry there is nothing
// for a reader to resolve it against, in Sources or anywhere else.
// TASK #25C -- confirmed live (manual PDF inspection of a real report):
// the bracketed "[Unverified reference]" form reads as a raw technical
// placeholder to an investor -- syntax that looks like a template
// variable left un-filled, not an intentional editorial judgment. A
// parenthetical, sentence-flowing form preserves the exact same
// epistemic meaning (this claim's source could not be verified; nothing
// is fabricated or upgraded to "verified") while reading as a deliberate
// disclosure rather than a leaked implementation artifact. Kept lowercase
// and unbracketed specifically so it reads as prose punctuation, not as
// another citation-shaped token that a reader might expect to resolve
// against Sources.
const unverifiableReferenceLabel: Record<ResponseLanguage, string> = {
  English: "(unverified)",
  Turkish: "(doğrulanmamış)",
  German: "(nicht verifiziert)",
  French: "(non vérifié)",
  Spanish: "(no verificado)",
};

// TASK #25C -- render-time/legacy-content counterpart of the label change
// above. Reports persisted before this fix have the OLD bracketed label
// literally baked into their stored content -- this never regenerates or
// rewrites the persisted row, it only recognizes the 5 old literal strings
// (one per language, matching this constant's own previous values) so
// pdf-normalization.mjs's own copy of this map can clean up already-
// persisted reports' PDF output the same way Task #25's other legacy-
// content migrations do. Order-independent, plain string literals (no
// characters here are regex metacharacters), so building a RegExp from
// them via simple alternation is safe.
export const legacyBracketedUnverifiableReferenceLabels: readonly string[] = [
  "[Unverified reference]",
  "[Doğrulanamayan referans]",
  "[Nicht verifizierbarer Verweis]",
  "[Référence non vérifiable]",
  "[Referencia no verificable]",
];

const legacyToCurrentUnverifiableReferenceLabel: ReadonlyMap<string, string> = new Map([
  ["[Unverified reference]", unverifiableReferenceLabel.English],
  ["[Doğrulanamayan referans]", unverifiableReferenceLabel.Turkish],
  ["[Nicht verifizierbarer Verweis]", unverifiableReferenceLabel.German],
  ["[Référence non vérifiable]", unverifiableReferenceLabel.French],
  ["[Referencia no verificable]", unverifiableReferenceLabel.Spanish],
]);

// TASK #25C -- render-time counterpart of the label change above, for
// content persisted before this fix existed. Only ever replaces one of
// the 5 known OLD literal bracketed strings with its corresponding NEW
// clean form -- never invents, infers, or removes an epistemic claim,
// and never touches a valid "[R#]" reference (a completely different,
// digit-bearing bracket shape this never matches). Deliberately a plain
// literal-alternation replace, not a general bracket-content regex, so it
// can never accidentally catch an unrelated bracketed tag like
// "[Estimated]" or "[Verified]". See pdf-normalization.mjs's own mirrored
// copy for why this is duplicated in a dependency-free leaf module.
export function restyleUnverifiedReferenceMarkers(content: string | undefined): string | undefined {
  if (!content) return content;

  let result = content;
  for (const [legacyLabel, currentLabel] of legacyToCurrentUnverifiableReferenceLabel) {
    result = result.split(legacyLabel).join(currentLabel);
  }

  return result;
}

// TASK #25 -- confirmed live (real persisted report): a claim that
// originally cited multiple references adjacently (e.g. "...buyer
// expectations in vendor docs) [R5][R6].") had each one replaced
// independently, producing "[Unverified reference][Unverified
// reference]" for what a reader experiences as ONE evidentiary gap for
// ONE claim, not two. Matches a whole RUN of one-or-more consecutive
// [R#] tokens (only whitespace between them) as a single unit and
// replaces the entire run with ONE label -- the duplicate is never
// created in the first place, rather than being produced and then
// cleaned up afterward.
const evidenceReferenceRunPattern = /(?:\[R\d+\]\s*)+/g;

export function neutralizeUnverifiableEvidenceReferences(
  sections: Record<string, string | undefined>,
  language: ResponseLanguage
): Record<string, string | undefined> {
  const label = unverifiableReferenceLabel[language] || unverifiableReferenceLabel.English;
  const result: Record<string, string | undefined> = {};

  for (const [field, content] of Object.entries(sections)) {
    result[field] = content
      ? content.replace(evidenceReferenceRunPattern, () => label)
      : content;
  }

  return result;
}

// TASK #25 -- malformed citation bracket syntax. Confirmed live, across
// many real persisted reports' own "barriers" field: the model itself
// sometimes writes a bracket like "[, R12]" -- a leading empty entry
// before a real reference number, presumably a dropped first id in what
// was meant to be a multi-reference citation. This is not merely a
// visual defect: evidenceReferencePattern/bibliographyReferencePattern
// (market-intelligence-graph.ts) both require "[R<digits>]" with
// NOTHING else inside the brackets, so a malformed group like this is
// completely invisible to every existing citation-integrity check --
// assertNoOrphanEvidenceReferences, the bibliography builder, and
// neutralizeUnverifiableEvidenceReferences above all silently skip past
// it, leaving a real reference (R12 here) that never gets validated or
// linked at all. Restoring it to the standard one-reference-per-bracket
// "[R12]" shape returns it to every existing protection, rather than
// merely prettifying it.
//
// Deliberately narrow: only ever touches a bracket group whose ENTIRE
// content is composed of whitespace/digits/R/commas AND contains at
// least one literal "R" -- i.e. something that is unambiguously an
// attempted (possibly malformed) R-reference citation. A bracket like
// "[Estimated]", "[Verified from official source]", or a genuinely
// unrelated "[12]" (no "R" at all) never matches this pattern at all and
// is left completely untouched -- the character class itself guarantees
// it (no letters other than "R" are ever allowed inside). Once a bracket
// DOES match (it is unambiguously an R-reference attempt), it either
// yields one or more real "R<digits>" tokens (kept, normalized to
// standard one-per-bracket form) or it doesn't (e.g. a bare "[R]", or a
// pure comma/whitespace group like "[,]") -- in the latter case there is
// nothing resolvable to a real source at all, so it is removed entirely
// rather than left as meaningless bracket noise or guessed into a
// reference number that was never actually written, matching
// neutralizeUnverifiableEvidenceReferences's own "never leave a marker
// with nothing real behind it" convention.
const malformedCitationBracketPattern = /\[([\sR0-9,]*R[\sR0-9,]*)\]/g;

export function sanitizeCitationBracketSyntax(
  content: string | undefined
): string | undefined {
  if (!content) return content;

  return content.replace(malformedCitationBracketPattern, (fullMatch, inner: string) => {
    const refs = inner
      .split(",")
      .map((part) => part.trim())
      .filter((part) => /^R\d+$/.test(part));

    if (refs.length === 0) {
      // No real "R<digits>" token survived cleaning -- a bare "[R]", a
      // pure comma/whitespace group, or any combination of those.
      // Nothing here resolves to an actual source, so remove it rather
      // than leave meaningless bracket noise or fabricate a number that
      // was never written.
      return "";
    }

    return refs.map((ref) => `[${ref}]`).join("");
  })
  // A bracket containing ONLY whitespace and/or commas (no "R" at all, so
  // the pattern above never reaches it) can never be a legitimate
  // anything in this report format -- not a citation, not an
  // "[Estimated]"-style tag, not a page reference -- an unambiguous empty
  // citation group left behind by a dropped reference.
  .replace(/\[[\s,]+\]/g, "")
  // Removing an empty bracket can leave a doubled space behind where it
  // used to sit -- collapse back to one.
  .replace(/ {2,}/g, " ");
}

// TASK #25 -- language-agnostic defensive collapse of ANY run of 2+
// identical, textually-adjacent bracketed tokens (only whitespace
// between them) into a single occurrence. Complements the root-cause fix
// in neutralizeUnverifiableEvidenceReferences above (which prevents the
// duplicate from being created for every future report) by also cleaning
// up reports persisted BEFORE that fix existed -- see
// pdf-normalization.mjs's own copy of this exact regex, applied at PDF
// render time so already-persisted reports render cleanly today, not
// only after regeneration. Never touches two DIFFERENT adjacent
// citations (e.g. "[R5][R6]" is untouched -- the backreference only
// matches an EXACT repeat of the same bracket content).
export function collapseAdjacentDuplicateCitationMarkers(
  content: string | undefined
): string | undefined {
  if (!content) return content;
  return content.replace(/(\[[^\]]+\])(?:\s*\1)+/g, "$1");
}

// Deterministic duplicate-citation detection: two DIFFERENT evidence ids
// (surviving as two separate rows in graph.sources -- i.e. NOT already
// merged by canonicalUrl equality, the pre-existing same-URL merge that
// buildMarketIntelligenceBibliography/sourceRecordByEvidenceId already
// handle) can still be the identical underlying document reached via two
// slightly different URL strings (a protocol/www/trailing-slash/tracking-
// parameter variant the upstream canonicalizer left untouched, or a
// research-pipeline artifact that fetched the same page twice). Left
// undetected, the reader sees the same document cited under two different
// [R#] numbers with two separate bibliography entries -- a duplicate
// citation, not a fabricated one, but still a break in "one source, one
// identity."
//
// TASK #29D -- confirmed live (real generation failure): the match key
// used to be exact title AND exact publisher alone, on the theory that
// "two unrelated documents essentially never share both an exact title
// and an exact publisher." That theory holds for byline journalism but
// not for user-generated/forum platforms (Reddit, and any site shaped
// like it) -- when the evidence pipeline cannot extract a real per-page
// title, it falls back to the bare domain for BOTH title and publisher
// (e.g. "reddit.com" / "reddit.com"), so every distinct, unrelated thread
// on that domain collided onto the exact same key and was flagged as a
// duplicate of every other one -- confirmed live: two genuinely different
// Reddit threads, R40 and R87, blocked an otherwise-complete report.
// Title+publisher is a proxy for "is this the same document" -- URL
// identity is the actual fact being proxied for, so this now keys
// directly on the normalized URL instead: two sources are the "same
// source" if and only if they resolve to the same document location,
// regardless of what title or publisher string happens to be attached to
// them. This is stricter in the correct direction (a real document
// identity check, not a title heuristic) and cannot regress into the
// same false-positive class again, for Reddit or any other UGC/forum
// domain, without special-casing anything -- the check has no knowledge
// of Reddit or any other publisher at all.
//
// normalizeUrlForIdentity performs a SEPARATE, more thorough
// canonicalization than market-intelligence-graph.ts's own canonicalUrl
// (used for display/storage) specifically for identity comparison here:
// scheme and "www." are identity-irrelevant (http/https and the www.
// subdomain never change which document a URL points to), so both are
// stripped in addition to the hash/tracking-parameter/trailing-slash
// normalization already applied upstream. It deliberately never touches
// the path or any non-tracking query parameter -- those often ARE what
// distinguishes two genuinely different documents on the same domain
// (different thread ids, different article slugs, different page
// numbers), so stripping them would reintroduce exactly the false-
// positive risk this fix removes, just via a different mechanism. A
// source with no parseable URL is excluded entirely from matching (no
// identity signal to compare at all; being unable to compare two sources
// is not evidence they are the same document).
export type DuplicateCitationSourceGroup = {
  title: string;
  publisher: string;
  evidenceIds: string[];
  urls: string[];
};

const identityTrackingParamPattern = /^(?:utm_|fbclid|gclid)/i;

function normalizeUrlForIdentity(value: string): string {
  const trimmed = (value || "").trim();
  if (!trimmed) return "";

  try {
    const url = new URL(trimmed);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    for (const key of [...url.searchParams.keys()]) {
      if (identityTrackingParamPattern.test(key)) url.searchParams.delete(key);
    }
    const search = url.searchParams.toString();
    const path = url.pathname.replace(/\/+$/, "");
    return `${host}${path}${search ? `?${search}` : ""}`.toLowerCase();
  } catch {
    // Not a parseable absolute URL (e.g. a bare "reddit.com" with no
    // scheme) -- fall back to a plain case/whitespace-normalized string
    // rather than discarding it, so two identical bare strings still
    // compare equal, but never crash on malformed input.
    return trimmed.toLowerCase().replace(/\s+/g, " ").replace(/\/+$/, "");
  }
}

export function findDuplicateCitationSources(
  sources: readonly { evidenceId: string; title: string; publisher: string; url: string }[]
): DuplicateCitationSourceGroup[] {
  const groups = new Map<
    string,
    { title: string; publisher: string; evidenceIds: string[]; urls: string[] }
  >();

  for (const source of sources) {
    const urlKey = normalizeUrlForIdentity(source.url || "");
    if (!urlKey) continue;

    const entry = groups.get(urlKey) || {
      title: source.title,
      publisher: source.publisher,
      evidenceIds: [],
      urls: [],
    };
    entry.evidenceIds.push(source.evidenceId);
    if (!entry.urls.includes(source.url)) entry.urls.push(source.url);
    groups.set(urlKey, entry);
  }

  return [...groups.values()].filter((entry) => entry.evidenceIds.length > 1);
}

export class DuplicateCitationSourceError extends Error {
  duplicates: DuplicateCitationSourceGroup[];

  constructor(duplicates: DuplicateCitationSourceGroup[]) {
    const summary = duplicates
      .map(
        (group) =>
          `"${group.title}" (${group.publisher}): ${group.evidenceIds.join(", ")} share the same underlying document across ${group.urls.length} URL representation(s)`
      )
      .join("; ");
    super(
      `Report cites ${duplicates.length} source(s) whose distinct evidence ids resolve to the same underlying document: ${summary}`
    );
    this.name = "DuplicateCitationSourceError";
    this.duplicates = duplicates;
  }
}

// Fail fast instead of silently shipping two separate bibliography entries
// (and two separate [R#] numbers) for what is, by normalized URL, the
// same underlying document -- see findDuplicateCitationSources above for
// why the match key is safe against false positives.
export function assertNoDuplicateCitationSources(
  sources: readonly { evidenceId: string; title: string; publisher: string; url: string }[]
): void {
  const duplicates = findDuplicateCitationSources(sources);
  if (duplicates.length > 0) {
    throw new DuplicateCitationSourceError(duplicates);
  }
}

// Runtime invariant: every [R#] cited anywhere in the report body must
// resolve inside the SAME persisted bibliography text that Sources
// actually renders -- not merely against the graph's evidence registry
// (assertNoOrphanEvidenceReferences already guarantees that, but a real,
// citable id can still end up missing from the rendered bibliography
// itself, e.g. a citation introduced by a later normalization pass after
// the bibliography was already built -- confirmed live and fixed
// upstream in route.ts's inline-URL-rewrite ordering; this is the
// regression guard for that class of bug, not a duplicate of the orphan
// check). This is what makes "UI and PDF resolve citation IDs from the
// same persisted canonical mapping" true by construction rather than by
// convention: page.tsx, Planner.tsx, and ReportPdfButton.tsx all render
// this exact persisted section text verbatim, with no independent
// citation-numbering logic of their own (see
// market-intelligence-citation-claim-integrity.test.mjs's cross-file
// checks) -- so once the persisted text is guaranteed internally
// self-consistent, every renderer that only ever reads it inherits that
// guarantee automatically, including a future renderer that doesn't exist
// yet, as long as it keeps reading the persisted text rather than
// deriving its own numbering.
const bibliographyReferenceLinePattern = /^Reference:\s*((?:\[R\d+\])+)\s*$/gm;

export function findCitationsUnresolvedInBibliography(
  sections: Record<string, string | undefined>,
  bibliographyText: string
): OrphanEvidenceReference[] {
  const resolvedIds = new Set<string>();
  bibliographyReferenceLinePattern.lastIndex = 0;
  let referenceLineMatch: RegExpExecArray | null;
  while ((referenceLineMatch = bibliographyReferenceLinePattern.exec(bibliographyText || ""))) {
    evidenceReferencePattern.lastIndex = 0;
    let tagMatch: RegExpExecArray | null;
    while ((tagMatch = evidenceReferencePattern.exec(referenceLineMatch[1]))) {
      resolvedIds.add(`R${tagMatch[1]}`);
    }
  }

  const unresolved: OrphanEvidenceReference[] = [];
  for (const [field, content] of Object.entries(sections)) {
    if (field === "sources" || !content) continue;

    const seenInField = new Set<string>();
    evidenceReferencePattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = evidenceReferencePattern.exec(content))) {
      const id = `R${match[1]}`;
      if (seenInField.has(id)) continue;
      seenInField.add(id);
      if (!resolvedIds.has(id)) {
        unresolved.push({ field, reference: `[${id}]` });
      }
    }
  }

  return unresolved;
}

export class UnresolvedBibliographyCitationError extends Error {
  unresolved: OrphanEvidenceReference[];

  constructor(unresolved: OrphanEvidenceReference[]) {
    const summary = unresolved.map((item) => `[${item.field}] ${item.reference}`).join("; ");
    super(
      `Report cites ${unresolved.length} evidence reference(s) with no "Reference:" entry in the persisted Sources bibliography, even though the id is otherwise valid: ${summary}`
    );
    this.name = "UnresolvedBibliographyCitationError";
    this.unresolved = unresolved;
  }
}

// Fail fast instead of shipping a report where a citation is a real,
// non-orphan evidence id (passes assertNoOrphanEvidenceReferences) but
// still has no entry in the actual persisted Sources text a reader would
// use to resolve it -- the gap the orphan check alone cannot see.
export function assertCitationsResolveInBibliography(
  sections: Record<string, string | undefined>,
  bibliographyText: string
): void {
  const unresolved = findCitationsUnresolvedInBibliography(sections, bibliographyText);
  if (unresolved.length > 0) {
    throw new UnresolvedBibliographyCitationError(unresolved);
  }
}
