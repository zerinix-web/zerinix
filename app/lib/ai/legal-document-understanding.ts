import { z } from "zod";
import type { DocumentClassificationAsset } from "./document-intelligence.ts";

// Second layer of ZERINIX Legal Intelligence: structured document
// understanding for legal_document / legal_case_analysis attachments,
// generated before any advisory analysis. This is deliberately a
// deterministic, pattern-based extractor (not a model call) so every
// field it produces is directly traceable to text that is actually
// present in the attachment -- there is nothing to "invent" because
// nothing is generated beyond what a regex found. A later layer can add
// a model-generated candidate and resolve it against this fallback using
// the same value/fallback pattern already used across this codebase
// (see resolveExpertiseProfile, resolveDynamicReportPlan), but that is out
// of scope here.

const namedPersonSchema = z.object({
  person: z.string().trim().min(1).max(200),
  decision: z.string().trim().min(1).max(400),
});

export const legalDocumentSummarySchema = z
  .object({
    documentType: z.string().trim().max(200),
    courtOrAuthority: z.string().trim().max(300),
    proceedingType: z.string().trim().max(200),
    caseSubject: z.string().trim().max(400),
    parties: z.array(z.string().trim().min(1).max(200)).max(30),
    defendants: z.array(z.string().trim().min(1).max(200)).max(30),
    complainantsOrParticipants: z.array(z.string().trim().min(1).max(200)).max(30),
    allegedOffenses: z.array(z.string().trim().min(1).max(300)).max(20),
    citedStatutes: z.array(z.string().trim().min(1).max(120)).max(40),
    proceduralStage: z.string().trim().max(300),
    decisionsByPerson: z.array(namedPersonSchema).max(30),
    confirmedFacts: z.array(z.string().trim().min(1).max(400)).max(40),
    disputedClaims: z.array(z.string().trim().min(1).max(400)).max(40),
    unresolvedQuestions: z.array(z.string().trim().min(1).max(400)).max(20),
    sourceLimitations: z.array(z.string().trim().min(1).max(400)).max(10),
  })
  .strict();

export type LegalDocumentSummary = z.infer<typeof legalDocumentSummarySchema>;

function emptySummary(): LegalDocumentSummary {
  return {
    documentType: "",
    courtOrAuthority: "",
    proceedingType: "",
    caseSubject: "",
    parties: [],
    defendants: [],
    complainantsOrParticipants: [],
    allegedOffenses: [],
    citedStatutes: [],
    proceduralStage: "",
    decisionsByPerson: [],
    confirmedFacts: [],
    disputedClaims: [],
    unresolvedQuestions: [],
    sourceLimitations: [],
  };
}

function combinedText(assets: readonly DocumentClassificationAsset[]) {
  return assets.map((asset) => asset.textContent || "").join("\n\n");
}

function unique(values: readonly string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

// Turkish uppercase text (as commonly used throughout court decisions,
// e.g. "REDDİ", "MÜDAHİL", "KATILAN") does not case-fold to plain ASCII
// under JS's default (locale-independent) case conversion: "İ".
// toLowerCase() produces "i" + a combining dot (two code units), and
// dotless "I"/"ı" never fold to "i" at all. Both break plain /i-flag
// regex matching. This normalizes Turkish casing correctly and then
// additionally folds dotless/circumflex variants onto their plain ASCII
// counterpart so every pattern below can be written once, in plain
// lowercase ASCII, and still match every casing variant. Every
// replacement here is one-character-to-one-character, so the result
// stays index-aligned with the original string -- a match position found
// against the normalized text can be used directly to slice the
// original text and recover its real casing/diacritics for display.
export function normalizeForMatch(text: string) {
  return text
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .replace(/â/g, "a")
    .replace(/î/g, "i")
    .replace(/û/g, "u");
}

const SENTENCE_BOUNDARY = /[.;\n]/;

function sentenceAround(original: string, normalized: string, index: number) {
  let start = index;
  while (start > 0 && !SENTENCE_BOUNDARY.test(normalized[start - 1])) start -= 1;
  let end = index;
  while (end < normalized.length && !SENTENCE_BOUNDARY.test(normalized[end])) end += 1;
  return original
    .slice(start, Math.min(end + 1, original.length))
    .replace(/\s+/g, " ")
    .trim();
}

// Turkish court decisions overwhelmingly label roles in ALL CAPS followed
// by a colon (SANIK:, DAVACI:, MÜDAHİL:, KATILAN:, MAĞDUR:, DAVALI:).
// Matching only these explicit labels -- rather than trying to guess names
// from prose -- is what keeps this conservative: a name is only extracted
// when the document itself labels it.
function extractLabeledNames(
  original: string,
  normalized: string,
  labels: readonly string[]
) {
  const labelPattern = labels.join("|");
  const pattern = new RegExp(
    `(?:${labelPattern})\\s*:\\s*([^\\n,;]+?)(?=\\s*(?:\\n|,|;|$|hakkinda))`,
    "gud"
  );
  const names: string[] = [];

  for (const match of normalized.matchAll(pattern)) {
    const groupRange = match.indices?.[1];
    if (!groupRange) continue;
    const value = original.slice(groupRange[0], groupRange[1]).trim();
    if (value) names.push(value);
  }

  return unique(names);
}

function extractCourtOrAuthority(original: string, normalized: string) {
  const match = normalized.match(
    /t\.?c\.?\s*\n?\s*yargitay[^\n]*\n?[^\n]*(?:ceza|hukuk)\s+dairesi/
  );
  if (match?.index !== undefined) {
    return original
      .slice(match.index, match.index + match[0].length)
      .replace(/\s+/g, " ")
      .trim();
  }

  const genericCourt = normalized.match(/(?:mahkeme|court)[^\n,.;]{0,80}/);
  if (genericCourt?.index !== undefined) {
    return original
      .slice(genericCourt.index, genericCourt.index + genericCourt[0].length)
      .replace(/\s+/g, " ")
      .trim();
  }

  return "";
}

function extractProceedingType(normalized: string) {
  if (/\btemyiz\b/.test(normalized)) {
    return "Temyiz incelemesi (criminal appeal/review)";
  }
  if (/\bistinaf\b/.test(normalized)) {
    return "İstinaf incelemesi (appellate review)";
  }
  return "";
}

function extractCaseSubjectAndOffenses(original: string, normalized: string) {
  const offenses: string[] = [];
  const sucMatch = normalized.match(new RegExp("suç\\s*:\\s*([^\\n]+)", "d"));
  const sucRange = sucMatch?.indices?.[1];
  if (sucRange) offenses.push(original.slice(sucRange[0], sucRange[1]).trim());

  const yardimMatch = normalized.match(
    new RegExp("kasten\\s+öldürmeye\\s+yardim\\s+etmek", "d")
  );
  if (yardimMatch?.index !== undefined) {
    const value = original
      .slice(yardimMatch.index, yardimMatch.index + yardimMatch[0].length)
      .trim();
    if (!offenses.some((item) => item.toLowerCase() === value.toLowerCase())) {
      offenses.push(value);
    }
  }

  const uniqueOffenses = unique(offenses);
  return {
    caseSubject: uniqueOffenses[0] || "",
    allegedOffenses: uniqueOffenses,
  };
}

// Cited statutes: Turkish decisions commonly cite a code name once
// ("5271 sayılı CMK'nin") followed by a comma/"ve"-separated list of
// article numbers before the word "madde(leri)". This captures the code
// name plus that list and expands it into individual "CODE article"
// references, rather than inventing article numbers that are not present.
function extractCitedStatutes(original: string, normalized: string) {
  const statutes: string[] = [];
  const codePattern = new RegExp(
    "(cmk|tck|hmk|tmk|ttk)'?(?:nin|nun|nün)?\\s+((?:\\d+(?:\\/\\d+)?\\s*(?:,|ve)?\\s*)+)\\s*(?:\\.?\\s*)?madde",
    "gd"
  );

  for (const match of normalized.matchAll(codePattern)) {
    const codeRange = match.indices?.[1];
    const articleRange = match.indices?.[2];
    if (!codeRange || !articleRange) continue;

    const code = original.slice(codeRange[0], codeRange[1]).toUpperCase();
    const articleList = original.slice(articleRange[0], articleRange[1]);
    const articles = articleList
      .split(/,|ve/i)
      .map((item) => item.trim())
      .filter((item) => /^\d+(?:\/\d+)?$/.test(item));

    for (const article of articles) {
      statutes.push(`${code} ${article}`);
    }
  }

  return unique(statutes);
}

function extractDecisionsByPerson(
  original: string,
  normalized: string,
  defendants: readonly string[]
) {
  const outcomeKeywords = /\b(beraat|mahkumiyet|hüküm|ceza verilmesine)\b/g;
  const decisions: { person: string; decision: string }[] = [];

  for (const match of normalized.matchAll(outcomeKeywords)) {
    const outcomeIndex = match.index ?? -1;
    if (outcomeIndex === -1) continue;

    // A person is only linked to this outcome when their name appears in
    // the same sentence/clause as the outcome keyword -- a fixed
    // character lookback would also catch an unrelated defendant whose
    // name happens to appear earlier in a different sentence (e.g. a
    // co-defendant listed in a separate "SANIK:" line).
    const decision = sentenceAround(original, normalized, outcomeIndex).slice(0, 300);

    for (const person of defendants) {
      if (!decision.includes(person)) continue;
      if (!decisions.some((item) => item.person === person && item.decision === decision)) {
        decisions.push({ person, decision });
      }
    }
  }

  return decisions;
}

// A decision page that is cut off mid-sentence (a Turkish appellate
// disposition continuing with "ancak;" -- "however;" -- into reasoning
// that is not on the visible page) cannot be read as a complete outcome.
// Detecting this is what keeps requirement 3 (partial documents must say
// so explicitly) honest rather than a fixed disclaimer that is always
// printed regardless of content.
function detectsTruncatedPage(normalized: string) {
  const trimmed = normalized.trim();
  return /,\s*ancak\s*;?\s*$/.test(trimmed) || /[,;:]\s*$/.test(trimmed);
}

// Captures the actual sentence containing an appeal/objection reference
// (rather than a generic paraphrase) so a later layer can tell, from this
// text alone, whether that specific objection was rejected/accepted --
// a paraphrase that only says "an objection exists" would hide whatever
// disposition word (REDDİ, kabul, etc.) the document itself already
// states in the same sentence.
function extractDisputedClaims(original: string, normalized: string) {
  const claims: string[] = [];
  const objectionPattern = /itiraz\p{L}*/gu;

  for (const match of normalized.matchAll(objectionPattern)) {
    const index = match.index ?? -1;
    if (index === -1) continue;
    claims.push(sentenceAround(original, normalized, index));
  }

  return unique(claims);
}

export function createLegalDocumentSummaryFallback({
  assets = [],
}: {
  assets?: readonly DocumentClassificationAsset[];
}): LegalDocumentSummary {
  const original = combinedText(assets);

  if (!original.trim()) {
    return {
      ...emptySummary(),
      sourceLimitations: [
        "No extractable text was found in the uploaded attachment, so no fields could be populated from document content.",
      ],
    };
  }

  const normalized = normalizeForMatch(original);

  const courtOrAuthority = extractCourtOrAuthority(original, normalized);
  const proceedingType = extractProceedingType(normalized);
  const { caseSubject, allegedOffenses } = extractCaseSubjectAndOffenses(original, normalized);
  const defendants = extractLabeledNames(original, normalized, ["sanik"]);
  const complainantsOrParticipants = extractLabeledNames(original, normalized, [
    "müdahil",
    "katilan",
    "mağdur",
  ]);
  const otherParties = extractLabeledNames(original, normalized, ["davaci", "davali"]);
  const parties = unique([...defendants, ...complainantsOrParticipants, ...otherParties]);
  const citedStatutes = extractCitedStatutes(original, normalized);
  const decisionsByPerson = extractDecisionsByPerson(original, normalized, defendants);

  const documentType =
    /yargitay/.test(normalized) && /ceza\s+dairesi/.test(normalized)
      ? "Criminal appeal/review decision"
      : courtOrAuthority
        ? "Legal decision or filing"
        : "";

  const esasMatch = normalized.match(new RegExp("esas\\s*no\\s*:\\s*([^\\n]+)", "d"));
  const kararMatch = normalized.match(new RegExp("karar\\s*no\\s*:\\s*([^\\n]+)", "d"));
  const esasRange = esasMatch?.indices?.[1];
  const kararRange = kararMatch?.indices?.[1];
  const esasValue = esasRange ? original.slice(esasRange[0], esasRange[1]).trim() : "";
  const kararValue = kararRange ? original.slice(kararRange[0], kararRange[1]).trim() : "";

  const confirmedFacts = unique([
    courtOrAuthority ? `Court/authority stated on the document: ${courtOrAuthority}` : "",
    esasValue ? `Case (Esas) number: ${esasValue}` : "",
    kararValue ? `Decision (Karar) number: ${kararValue}` : "",
    defendants.length
      ? `Named defendant(s) on the document: ${defendants.join(", ")}`
      : "",
    caseSubject ? `Stated charge/subject: ${caseSubject}` : "",
    ...decisionsByPerson.map(
      (item) => `Decision text near ${item.person}: "${item.decision}"`
    ),
  ]);

  const disputedClaims = extractDisputedClaims(original, normalized);

  const isTruncated = detectsTruncatedPage(normalized);
  const unresolvedQuestions = unique([
    isTruncated
      ? 'The visible page ends mid-sentence ("REDDİ, ancak;" or an equivalent unterminated clause), so the final outcome for all defendants cannot be concluded from this page alone.'
      : "",
    defendants.length > 1 || (defendants.length === 1 && decisionsByPerson.length === 0)
      ? "Not every named defendant has a decision explicitly linked to them on the visible text."
      : "",
  ]);

  const sourceLimitations = unique([
    "This summary reflects only the text visible in the uploaded attachment; no external case law, docket, or later pages were consulted.",
    assets.some((asset) => (asset.mimeType || "").startsWith("image/"))
      ? "The attachment is an image; the extraction depends on the text that was recognized from it and may omit content that was illegible or outside the captured frame."
      : "",
    isTruncated
      ? "The extracted text appears to end before the sentence/paragraph is complete, indicating the document continues beyond what was provided."
      : "",
  ]);

  return {
    documentType,
    courtOrAuthority,
    proceedingType,
    caseSubject,
    parties,
    defendants,
    complainantsOrParticipants,
    allegedOffenses,
    citedStatutes,
    proceduralStage: proceedingType,
    decisionsByPerson,
    confirmedFacts,
    disputedClaims,
    unresolvedQuestions,
    sourceLimitations,
  };
}
