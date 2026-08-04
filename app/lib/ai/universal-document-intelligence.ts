import { z } from "zod";

// Layer 4 of ZERINIX Intelligence: a universal Decision Intelligence
// layer for ANY uploaded document, independent of and unrelated to the
// legal-specific layers 1-3 (document-intelligence.ts,
// legal-document-understanding.ts, legal-case-analysis.ts). This module
// never assumes a legal document; it classifies into a broad domain set
// and extracts the same generic fields regardless of that domain. Like
// every earlier layer, it is a deterministic, pattern-based derivation
// (not a model call) so every field stays traceable to text that is
// actually present in the attachment.

export const documentDomainValues = [
  "Legal",
  "Financial",
  "Business",
  "Medical",
  "Technical",
  "Engineering",
  "Real Estate",
  "HR",
  "Government",
  "Academic",
  "Contract",
  "Spreadsheet",
  "Unknown",
] as const;

export type DocumentDomain = (typeof documentDomainValues)[number];

export type UniversalDocumentAsset = {
  name?: string;
  mimeType?: string;
  textContent?: string;
};

const shortString = (max: number) => z.string().trim().min(1).max(max);

export const universalDocumentIntelligenceSchema = z
  .object({
    documentDomain: z.enum(documentDomainValues),
    domainConfidence: z.number().min(0).max(1),
    documentPurpose: z.string().trim().max(400),
    documentStructure: z
      .object({
        headings: z.array(shortString(200)).max(40),
        hasTabularData: z.boolean(),
      })
      .strict(),
    entities: z
      .object({
        people: z.array(shortString(200)).max(30),
        organizations: z.array(shortString(200)).max(30),
        dates: z.array(shortString(60)).max(30),
        numbers: z.array(shortString(60)).max(40),
        locations: z.array(shortString(200)).max(30),
      })
      .strict(),
    risks: z.array(shortString(400)).max(30),
    decisions: z.array(shortString(400)).max(30),
    obligations: z.array(shortString(400)).max(30),
    evidence: z.array(shortString(400)).max(30),
    importantSections: z.array(shortString(200)).max(20),
    missingInformation: z.array(shortString(300)).max(20),
  })
  .strict();

export type UniversalDocumentIntelligence = z.infer<
  typeof universalDocumentIntelligenceSchema
>;

const MIN_CONFIDENT_DOMAIN_CONFIDENCE = 0.65;

function emptyDocumentIntelligence(): UniversalDocumentIntelligence {
  return {
    documentDomain: "Unknown",
    domainConfidence: 0,
    documentPurpose: "",
    documentStructure: { headings: [], hasTabularData: false },
    entities: { people: [], organizations: [], dates: [], numbers: [], locations: [] },
    risks: [],
    decisions: [],
    obligations: [],
    evidence: [],
    importantSections: [],
    missingInformation: [],
  };
}

function combinedText(assets: readonly UniversalDocumentAsset[]) {
  return assets.map((asset) => asset.textContent || "").join("\n\n");
}

function unique(values: readonly string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function isSpreadsheetAsset(asset: UniversalDocumentAsset) {
  return (
    /(?:spreadsheet|excel|csv)/i.test(asset.mimeType || "") ||
    /\.(?:xlsx?|csv|tsv)$/i.test(asset.name || "")
  );
}

// Domain classification: each domain has a small set of vocabulary that is
// reasonably distinctive of it. "Contract" is kept separate from "Legal"
// (contract boilerplate vs. litigation/court language) and separate from
// "Real Estate" (a lease is a contract; a title deed reference is real
// estate), matching the category list this layer was asked to produce.
const domainSignals: Record<Exclude<DocumentDomain, "Unknown">, RegExp> = {
  Legal:
    /\b(court|judge|plaintiff|defendant|statute|litigation|lawsuit|appeal|verdict|ruling|testimony|jurisdiction|attorney|counsel|prosecutor)\b/gi,
  Financial:
    /\b(balance sheet|income statement|cash flow|revenue|profit and loss|invoice|audit|tax return|budget|financial statement|accounts payable|accounts receivable|ledger|general ledger)\b/gi,
  Business:
    /\b(business plan|business proposal|market analysis|stakeholder|key performance indicator|\bkpi\b|business model|executive summary|quarterly report|swot analysis|go[- ]to[- ]market)\b/gi,
  Medical:
    /\b(diagnosis|patient|treatment plan|prescription|physician|clinical|symptom|medical record|hospital|therapy|dosage|pathology|discharge summary)\b/gi,
  Technical:
    /\b(technical specification|system architecture|\bapi\b|software requirements|algorithm|system design|protocol|configuration|deployment|codebase)\b/gi,
  Engineering:
    /\b(blueprint|structural analysis|load capacity|tolerance|schematic|mechanical design|civil engineering|construction drawing|materials specification|safety factor|as-built)\b/gi,
  "Real Estate":
    /\b(title deed|lease agreement|mortgage|zoning|appraisal|property listing|square footage|parcel number|landlord|tenant|cadastral)\b/gi,
  HR:
    /\b(employee handbook|payroll|performance review|recruitment|onboarding|job description|resignation letter|termination notice|employee benefits|hr policy)\b/gi,
  Government:
    /\b(ministry|government agency|public notice|federal register|municipal ordinance|regulatory filing|official gazette|permit application|government regulation)\b/gi,
  Academic:
    /\b(abstract|thesis|dissertation|research methodology|literature review|peer[- ]reviewed|hypothesis|academic journal|citation|research findings)\b/gi,
  Contract:
    /\b(hereinafter|the parties|terms and conditions|termination clause|governing law|indemnification|whereas,|effective date|this agreement|force majeure)\b/gi,
  Spreadsheet: /\b(worksheet|pivot table|spreadsheet|\bcsv\b)\b/gi,
};

const domainTieBreakOrder: Exclude<DocumentDomain, "Unknown">[] = [
  "Legal",
  "Contract",
  "Financial",
  "Medical",
  "Engineering",
  "Technical",
  "Real Estate",
  "HR",
  "Government",
  "Academic",
  "Business",
  "Spreadsheet",
];

function confidenceFromMatches(matches: readonly string[]) {
  const uniqueHits = new Set(matches.map((value) => value.toLowerCase())).size;
  return Math.min(0.55 + uniqueHits * 0.15, 0.97);
}

function classifyDocumentDomain(
  assets: readonly UniversalDocumentAsset[],
  text: string
): { domain: DocumentDomain; confidence: number } {
  if (assets.some(isSpreadsheetAsset)) {
    return { domain: "Spreadsheet", confidence: 0.95 };
  }

  let best: { domain: DocumentDomain; confidence: number } = {
    domain: "Unknown",
    confidence: 0,
  };

  for (const domain of domainTieBreakOrder) {
    const matches = text.match(domainSignals[domain]) || [];
    if (matches.length === 0) continue;
    const confidence = confidenceFromMatches(matches);
    if (confidence > best.confidence) {
      best = { domain, confidence };
    }
  }

  if (best.confidence < MIN_CONFIDENT_DOMAIN_CONFIDENCE) {
    return { domain: "Unknown", confidence: best.confidence };
  }
  return best;
}

// Headings: a short, standalone line that looks structural rather than
// prose -- ALL CAPS, markdown "#", or a numbered/labeled heading ("1.",
// "Section 2", "Article 3"). This is a heuristic, not a layout parser; it
// only reports lines that look confidently like a heading rather than
// guessing at arbitrary short lines.
function extractHeadings(text: string) {
  const headings: string[] = [];
  const lines = text.split("\n").map((line) => line.trim());

  for (const line of lines) {
    if (!line || line.length > 100) continue;
    const looksAllCaps = /^[A-ZÇĞİÖŞÜ0-9][A-ZÇĞİÖŞÜ0-9\s.,:'&()/-]{2,}$/.test(line) &&
      /[A-ZÇĞİÖŞÜ]{2,}/.test(line);
    const looksNumberedOrLabeled =
      /^(?:#{1,6}\s+\S|(?:\d+[.)]\s+\S)|(?:section|article|chapter|part)\s+[\divxlcm]+\b)/i.test(
        line
      );

    if (looksAllCaps || looksNumberedOrLabeled) {
      headings.push(line.replace(/^#{1,6}\s+/, ""));
    }
  }

  return unique(headings).slice(0, 40);
}

function detectsTabularData(assets: readonly UniversalDocumentAsset[], text: string) {
  if (assets.some(isSpreadsheetAsset)) return true;
  const lines = text.split("\n").filter((line) => line.trim());
  if (lines.length < 3) return false;
  const delimitedLines = lines.filter(
    (line) => line.split(",").length >= 3 || line.split("\t").length >= 3
  );
  return delimitedLines.length / lines.length > 0.4;
}

// A period after a common abbreviation ("Dr.", "Inc.", "vs.") is not a
// sentence boundary. Scanning forward and skipping those false boundaries
// avoids truncating the purpose statement after "Patient: Jane Doe
// Physician: Dr." instead of the actual first sentence.
const SENTENCE_END_ABBREVIATIONS = new Set([
  "dr", "mr", "mrs", "ms", "prof", "inc", "corp", "ltd", "vs", "etc",
  "no", "st", "jr", "sr", "co", "vol", "art", "sec", "fig",
]);

function findFirstSentence(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();
  const boundaryPattern = /[.!?](?=\s|$)/g;
  let match: RegExpExecArray | null;

  while ((match = boundaryPattern.exec(normalized))) {
    const endIndex = match.index;
    const before = normalized.slice(0, endIndex);
    const lastWord = before.match(/([A-Za-z]+)$/)?.[1]?.toLowerCase() || "";
    if (SENTENCE_END_ABBREVIATIONS.has(lastWord)) continue;

    const candidate = normalized.slice(0, endIndex + 1).trim();
    if (candidate.length >= 10) return candidate.slice(0, 400);
  }

  return "";
}

function extractPurpose(text: string) {
  const labeled = text.match(/\b(?:subject|purpose|re|title)\s*:\s*([^\n]+)/i);
  if (labeled?.[1]) return labeled[1].trim().slice(0, 400);

  return findFirstSentence(text);
}

const NAME_STOPWORDS =
  /\b(?:United States|United Kingdom|New York|Los Angeles|San Francisco|Hong Kong|European Union|Middle East|North America|South America|January|February|March|April|May|June|July|August|September|October|November|December|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/;

// A Title Case phrase whose every word is a common role/document-section
// word (e.g. "Chief Financial Officer", "Financial Statement Review") is
// a title or heading, not a person's name -- filtering these out is what
// keeps "people" from absorbing job titles and section headings, which
// are common false positives for a plain capitalized-word-sequence
// heuristic.
const ROLE_OR_SECTION_WORDS = new Set([
  "chief", "financial", "executive", "officer", "director", "president",
  "manager", "secretary", "committee", "department", "statement",
  "review", "summary", "report", "vice", "senior", "assistant", "head",
  "board", "chairman", "chairwoman", "chairperson", "treasurer",
  "controller", "counsel", "auditor", "administrator", "coordinator",
]);

function looksLikeRoleOrSectionPhrase(candidate: string) {
  return candidate
    .split(/\s+/)
    .every((word) => ROLE_OR_SECTION_WORDS.has(word.toLowerCase()));
}

const ORG_SUFFIX_PATTERN =
  /\b([A-Z][\w&.,'-]*(?:[ \t]+[A-Z][\w&.,'-]*){0,4}[ \t]+(?:Inc\.?|LLC|L\.L\.C\.|Ltd\.?|Corp\.?|Corporation|Company|Co\.?|GmbH|PLC|LLP|Group|Holdings|University|Hospital|Ministry|Department|Agency|Bank|Foundation))\b/g;

const PERSON_NAME_PATTERN = /\b([A-Z][a-z]+(?:[ \t]+[A-Z][a-z]+){1,2})\b/g;

function extractPeopleAndOrganizations(text: string) {
  const organizations = unique(
    [...text.matchAll(ORG_SUFFIX_PATTERN)].map((match) => match[1])
  );
  const organizationText = organizations.join("\n");

  const people = unique(
    [...text.matchAll(PERSON_NAME_PATTERN)]
      .map((match) => match[1])
      .filter(
        (candidate) =>
          !NAME_STOPWORDS.test(candidate) &&
          !organizationText.includes(candidate) &&
          !looksLikeRoleOrSectionPhrase(candidate)
      )
  );

  return { people: people.slice(0, 30), organizations: organizations.slice(0, 30) };
}

const DATE_PATTERN =
  /\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}[./]\d{1,2}[./]\d{2,4}|(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}|\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})\b/gi;

const NUMBER_PATTERN =
  /(?:[$€£₺]\s?\d[\d,.]*\d|\d[\d,.]*\d\s?(?:USD|EUR|GBP|TRY))|\b\d+(?:[.,]\d+)?\s?%|\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b/g;

function extractDatesAndNumbers(text: string) {
  const dates = unique([...text.matchAll(DATE_PATTERN)].map((match) => match[0]));
  const numbers = unique([...text.matchAll(NUMBER_PATTERN)].map((match) => match[0]));
  return { dates: dates.slice(0, 30), numbers: numbers.slice(0, 40) };
}

function extractLocations(text: string) {
  const labeled = [...text.matchAll(/\b(?:location|address|city|country)\s*:\s*([^\n,;]+)/gi)].map(
    (match) => match[1].trim()
  );
  return unique(labeled).slice(0, 30);
}

const SENTENCE_SPLIT = /(?<=[.!?])\s+(?=[A-ZÇĞİÖŞÜ0-9])/;

function sentencesMatching(text: string, pattern: RegExp) {
  const sentences = text.split(SENTENCE_SPLIT);
  return unique(sentences.filter((sentence) => pattern.test(sentence)).map((s) => s.trim()));
}

const RISK_PATTERN =
  /\b(?:risk|liability|penalty|breach|violation|non-compliance|exposure|hazard|warning|threat)\b/i;
const DECISION_PATTERN =
  /\b(?:decided|resolved|ruling|determination|approved|rejected|denied|granted|awarded|concluded)\b/i;
const OBLIGATION_PATTERN =
  /\b(?:shall|must|is required to|is obligated to|agrees to|undertakes to|responsible for)\b/i;
const EVIDENCE_PATTERN =
  /\b(?:evidence|exhibit|attached|documented|proof|witness|testimony|records show|according to)\b/i;
const IMPORTANT_PATTERN = /\b(?:important|critical|key|note:|please note)\b/i;

export function createUniversalDocumentIntelligenceFallback({
  assets = [],
}: {
  assets?: readonly UniversalDocumentAsset[];
}): UniversalDocumentIntelligence {
  const text = combinedText(assets);

  if (!assets.length || !text.trim()) {
    return {
      ...emptyDocumentIntelligence(),
      missingInformation: assets.length
        ? ["No extractable text was found in the uploaded attachment."]
        : ["No attachment was provided."],
    };
  }

  const { domain, confidence } = classifyDocumentDomain(assets, text);
  const headings = extractHeadings(text);
  const hasTabularData = detectsTabularData(assets, text);
  const documentPurpose = extractPurpose(text);
  const { people, organizations } = extractPeopleAndOrganizations(text);
  const { dates, numbers } = extractDatesAndNumbers(text);
  const locations = extractLocations(text);
  const risks = sentencesMatching(text, RISK_PATTERN).slice(0, 30);
  const decisions = sentencesMatching(text, DECISION_PATTERN).slice(0, 30);
  const obligations = sentencesMatching(text, OBLIGATION_PATTERN).slice(0, 30);
  const evidence = sentencesMatching(text, EVIDENCE_PATTERN).slice(0, 30);
  const importantSections = unique([
    ...headings,
    ...sentencesMatching(text, IMPORTANT_PATTERN),
  ]).slice(0, 20);

  const missingInformation = unique([
    dates.length === 0 ? "No dates were identified in the visible text." : "",
    people.length === 0 && organizations.length === 0
      ? "No named people or organizations were identified in the visible text."
      : "",
    documentPurpose ? "" : "No clear statement of purpose was identified in the visible text.",
    domain === "Unknown"
      ? "The document domain could not be confidently classified from the visible text."
      : "",
  ]);

  return {
    documentDomain: domain,
    domainConfidence: confidence,
    documentPurpose,
    documentStructure: { headings, hasTabularData },
    entities: { people, organizations, dates, numbers, locations },
    risks,
    decisions,
    obligations,
    evidence,
    importantSections,
    missingInformation,
  };
}
