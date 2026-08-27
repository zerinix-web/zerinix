import type {
  DomainResearchBundle,
  DomainResearchEvidence,
} from "./domain-research.ts";
import {
  calculateEvidenceConfidence,
  calculateMarketOverallConfidence,
  calculatePlanningEstimateConfidence,
  classifyMarketConfidence,
  classifyMarketEvidenceSource,
  evaluateMarketResearchCoverage,
  freshness,
  type MarketConfidenceLevel,
  type MarketResearchCoverage,
  type MarketSourceClass,
} from "./market-research-coverage.ts";
import {
  sanitizeResearchPublisher,
} from "./market-taxonomy.ts";
import {
  buildVendorIntelligenceGraph,
  type VendorIntelligenceGraph,
} from "./vendor-intelligence.ts";
import { isImplausibleCompetitorName } from "./vendor-discovery.ts";

export const MARKET_INTELLIGENCE_GRAPH_VERSION =
  "market-intelligence-graph-v6" as const;

export type MarketIntelligenceSource = {
  evidenceId: string;
  title: string;
  publisher: string;
  url: string;
  publishedDate: string;
  accessedAt: string;
  sourceType: string;
  confidenceClassification: "Verified" | "Estimated" | "Assumption";
  confidenceScore: number;
  confidenceLevel: MarketConfidenceLevel;
  claim: string;
};

export type MarketIntelligenceCompetitor = {
  name: string;
  positioning: string;
  pricingEvidence: string;
  confidenceClassification: "Verified" | "Estimated";
  confidenceScore: number;
  confidenceLevel: MarketConfidenceLevel;
  evidenceIds: string[];
};

// How the TAM figure was actually produced -- retained for calculation
// traceability and so the rendered report can name its own method rather
// than presenting every estimate as if it used the same approach.
// "adjacentProxy": no direct or bottom-up figure existed for the exact
// requested market, but a broader/parent-category benchmark plus a real,
// evidence-derived narrowing ratio (never an invented scaling factor)
// produced a bounded estimate -- see findAdjacentProxyTopDown below.
export type MarketSizingMethod =
  | "topDown"
  | "bottomUp"
  | "triangulated"
  | "adjacentProxy";

// SUPPORTED ESTIMATE: multiple hierarchy-ranked evidence items agree (a
// single high-authority source, or top-down/bottom-up triangulation that
// converged). DIRECTIONAL: only one thin/lower-authority evidence item
// was available, the underlying methods materially disagreed, or the
// figure depends on adjacent/proxy evidence rather than a direct
// measurement of the requested market. Never "Verified" -- that tier is
// reserved for graph.verifiedMarketSize, which this estimate type is
// never blended with (see the buildMarketIntelligenceGraph comment).
export type MarketSizingEvidenceTier = "supportedEstimate" | "directional";

// User-facing confidence vocabulary (REQUIRED: TAM CONFIDENCE MODEL) --
// a descriptive label layered on top of the existing 0-100 confidence
// score and MarketConfidenceLevel (High/Medium/Low), not a separate or
// more precise measurement. "verified" is intentionally absent here: a
// verified headline figure is graph.verifiedMarketSize, a structurally
// different, stricter array this estimate type never produces.
export type MarketSizingConfidenceState =
  | "highConfidence"
  | "moderateConfidence"
  | "directional";

// Canonical market definition (REQUIRED: DEFINE THE MARKET BEFORE
// SIZING) -- constructed once per request from the prompt and the
// evidence actually anchoring the estimate, then used both to label the
// report and to reject evidence describing a materially different
// market (see evidenceMatchesRequestedGeography). Deliberately a
// lightweight, regex/heuristic construction (consistent with this
// file's existing extractGeographyLabel/promptReadiness-style
// approach), not a claimed precise NLP extraction -- every field falls
// back to an honest "Not specified in request" rather than guessing.
export type MarketDefinition = {
  geography: string;
  buyerSegment: string;
  companySize: string;
  category: string;
  useCase: string;
  spendUnit: string;
  year: string;
  inclusions: string[];
  exclusions: string[];
};

export type MarketPlanningEstimate = {
  classification: "Estimated";
  tam: string;
  sam: string;
  som: string;
  formula: string;
  assumptions: string[];
  evidenceIds: string[];
  confidence: number;
  confidenceLevel: MarketConfidenceLevel;
  basis: "source_based";
  // Calculation traceability (REQUIRED RESEARCH HIERARCHY / CALCULATION
  // TRACEABILITY) -- additive fields so a JSON round-trip of an older
  // cached graph still satisfies this type structurally; consumers that
  // only read tam/sam/som/formula/confidence are unaffected.
  method: MarketSizingMethod;
  tier: MarketSizingEvidenceTier;
  confidenceState: MarketSizingConfidenceState;
  geography: string;
  year: string;
  marketDefinition: string;
  definition: MarketDefinition;
  // Set when top-down and bottom-up estimates were both computable but
  // diverged materially -- the rendered range already reflects this, but
  // the flag/note let callers (tests, future report-engine consumers)
  // detect and surface the disagreement explicitly rather than silently
  // averaging it away.
  conflicting: boolean;
  conflictNote: string;
  // Whether the serviceable-share (TAM -> SAM) ratio came from real
  // evidence about this market's addressable segment, or is the
  // disclosed default assumption used when no such evidence exists.
  samMethod: "evidenceDerived" | "defaultAssumption" | "blocked";
  // SOM must never be an invented percentage of SAM (see SOM section of
  // the ticket). When no defensible bottom-up obtainable-share inputs
  // exist, som holds a non-numeric "pending" explanation instead of a
  // fabricated figure, and somStatus records that honestly.
  somStatus: "calculated" | "pending";
  // Whether the per-unit spend figure behind this estimate came directly
  // from evidence about the exact requested category ("direct"), or from
  // a comparable/adjacent product used as an explicitly disclosed proxy
  // ("proxy") -- see findProxyPricingCandidate. "none" only when the
  // estimate's method never needed a per-unit spend figure at all.
  pricingSource: "direct" | "proxy" | "none";
  // Populated only when pricingSource === "proxy" or method ===
  // "adjacentProxy": what the proxy represents, why it is relevant, how
  // it differs from the requested market, and the uncertainty this
  // introduces (REQUIRED: every proxy must explicitly explain all four).
  proxyDisclosure: string;
  // True when the evidence backing the TAM figure is, on average, more
  // than 3 years old (see the shared freshness() bands in
  // market-research-coverage.ts) -- the rendered estimate must label its
  // year and avoid implying the figure is current.
  stale: boolean;
};

// Returned instead of a bare null when no defensible TAM could be built,
// so the report can explain SPECIFICALLY what was found and what is
// still missing (REQUIRED: USER-FACING REPORT QUALITY / RESEARCH
// RECOVERY LOOP) rather than a generic "insufficient evidence" notice.
export type MarketSizingGap = {
  attemptedTopDown: boolean;
  attemptedBottomUp: boolean;
  attemptedAdjacentProxy: boolean;
  // The single most useful real quantity the research DID establish, if
  // any -- e.g. a genuine buyer-population count -- so the explanation
  // can cite it by name instead of just saying "nothing was found".
  partialQuantity: { amount: number; description: string; evidenceId: string } | null;
  missingIngredient: "pricing" | "buyerPopulation" | "topDownFigure" | "everything";
  explanation: string;
};

export type MarketIntelligenceGraph = {
  version: typeof MARKET_INTELLIGENCE_GRAPH_VERSION;
  competitors: MarketIntelligenceCompetitor[];
  pricingModels: Array<{
    description: string;
    evidenceIds: string[];
    confidenceClassification: "Verified" | "Estimated";
    confidenceScore: number;
    confidenceLevel: MarketConfidenceLevel;
  }>;
  verifiedMarketSize: Array<{
    description: string;
    evidenceIds: string[];
    confidenceClassification: "Verified";
    confidenceScore: number;
    confidenceLevel: MarketConfidenceLevel;
  }>;
  planningEstimate: MarketPlanningEstimate | null;
  // Populated only when planningEstimate is null -- explains specifically
  // what evidence WAS found and what is still missing, so the report
  // never falls back to a bare "Validation Needed" when something more
  // useful can be said. See buildPlanningEstimate's recovery-loop comment
  // for the exact order of attempts this reflects.
  sizingGap: MarketSizingGap | null;
  // Regional/global market data (Europe, OECD, neighboring countries) is
  // never the requested geography's own verified figure, so it is kept
  // separate from verifiedMarketSize rather than blended into it -- this
  // is the raw material the model needs to build a transparent, clearly
  // labeled estimate (per marketPrompts.marketSize/cagr/tamSamSom) instead
  // of defaulting to "insufficient evidence" whenever local-only data does
  // not exist.
  adjacentBenchmarks: Array<{
    description: string;
    geography: string;
    evidenceIds: string[];
    confidenceClassification: "Estimated";
    confidenceScore: number;
    confidenceLevel: MarketConfidenceLevel;
  }>;
  cagr: Array<{
    description: string;
    evidenceIds: string[];
    confidenceClassification: "Verified" | "Estimated";
    confidenceScore: number;
    confidenceLevel: MarketConfidenceLevel;
  }>;
  sources: MarketIntelligenceSource[];
  // Every evidence ID backed by a real, valid-URL source -- see the
  // build-time comment in buildMarketIntelligenceGraph. A superset of
  // `sources.map(s => s.evidenceId)`: also includes IDs that were merged
  // away by the display-level canonical-URL dedup but are still real,
  // citable evidence.
  citableEvidenceIds: Set<string>;
  // Every citable evidence ID mapped to its representative (post-dedup)
  // source record -- see the build-time comment in
  // buildMarketIntelligenceGraph. Used to build the deterministic Sources
  // bibliography from the exact [R#] references actually used in the
  // final report.
  sourceRecordByEvidenceId: Record<string, MarketIntelligenceSource>;
  vendorIntelligence: VendorIntelligenceGraph;
  coverage: MarketResearchCoverage;
};

export type MarketIntelligenceReportProjection = {
  marketInfrastructure?: string;
  competitiveLandscape?: string;
  majorPlayers?: string;
  marketSize?: string;
  cagr?: string;
  tamSamSom?: string;
  sources?: string;
};

function validUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function canonicalUrl(value: string) {
  const url = validUrl(value);
  if (!url) return "";
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (/^(?:utm_|fbclid|gclid)/i.test(key)) url.searchParams.delete(key);
  }
  return url.toString().replace(/\/$/, "");
}

function isVerified(item: DomainResearchEvidence) {
  return (
    (item.label === "Verified from official source" ||
      item.label === "Verified from external source") &&
    Boolean(validUrl(item.url))
  );
}

function confidenceClassification(item: DomainResearchEvidence) {
  if (/forecast|estimate|estimated|projected|projection|assumption/i.test(
    evidenceText(item)
  )) return "Estimated" as const;
  if (isVerified(item)) return "Verified" as const;
  if (item.label === "Estimate") return "Estimated" as const;
  return "Assumption" as const;
}

function evidenceText(item: DomainResearchEvidence) {
  return [
    item.field,
    item.claim,
    item.value,
    item.sourceTitle,
    item.publisher,
    item.sourceType,
    ...item.supportingData,
  ].join(" ");
}

function isAuthoritativeObservedMarketSize(item: DomainResearchEvidence) {
  const text = evidenceText(item);
  return (
    isVerified(item) &&
    (item.authorityLevel === "primary" ||
      /official_statistics|official_filing|government/i.test(item.sourceType)) &&
    !/forecast|estimate|projected|projection|planning/i.test(text)
  );
}

function concise(value: string, maximum = 240) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maximum) return normalized;
  return `${normalized.slice(0, maximum - 1).trim()}…`;
}

// CRITICAL FIX -- confirmed live: the prior single-group pattern
// (`\d+(?:[.,]\d+)?`) both mis-parsed and truncated real thousands-
// grouped figures. "40,000 addressable buyers" matched digits="40" +
// one optional "[.,]\d+" group=",000", then blindly replaced the FIRST
// comma with a decimal point -- "40,000" became "40.000" = 40, not
// 40000, silently shrinking a bottom-up TAM calculation by a factor of
// 1000. A three-group figure like "1,234,567" was truncated even worse:
// the single optional group could only ever capture one ",NNN" segment,
// leaving ",567" outside the match entirely. The thousands-grouped
// alternative below is tried first and, when it matches, every comma is
// stripped (never reinterpreted as a decimal); the plain alternative
// (unchanged from before) still exists for a lone value with no
// thousands grouping, including the rarer single-comma-as-decimal case
// (e.g. "2,5" in some non-US evidence text).
const NUMBER_PATTERN_SOURCE =
  "([$€£₺])?\\s*(\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:[.,]\\d+)?)\\s*(thousand|million|billion|trillion|[kmbt])?\\b";

function parseNumberMatch(match: RegExpMatchArray) {
  const rawDigits = match[2];
  const isThousandsGrouped = /^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(rawDigits);
  const raw = isThousandsGrouped ? rawDigits.replace(/,/g, "") : rawDigits.replace(",", ".");
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) return null;
  const unit = (match[3] || "").toLowerCase();
  const multiplier = unit.startsWith("t")
    ? unit === "thousand" || unit === "k"
      ? 1_000
      : 1_000_000_000_000
    : unit.startsWith("b")
      ? 1_000_000_000
      : unit.startsWith("m")
        ? 1_000_000
        : 1;
  return {
    amount: numeric * multiplier,
    currency: match[1] || "",
    token: match[0].trim(),
  };
}

function extractNumber(value: string) {
  const match = value.match(new RegExp(NUMBER_PATTERN_SOURCE, "i"));
  return match ? parseNumberMatch(match) : null;
}

// Exported (P0 FIX #6 -- cross-section canonical consistency): route.ts's
// buildMarketGraphMetricConsistencyTargets reuses this exact parser to read a
// clean, short numeric token (`.token`, e.g. "$2.1 billion") back out of
// graph.verifiedMarketSize's own free-text description -- the same
// authoritative figure the market's headline Market Size/TAM value is
// already built from -- rather than re-deriving a possibly-different
// number from rendered prose.
export function extractMarketAmount(value: string) {
  const parsed = extractNumber(value);
  if (!parsed) return null;
  return /[$€£₺]|\b(?:million|billion|trillion|[mbt])\b/i.test(parsed.token)
    ? parsed
    : null;
}

// CRITICAL FIX -- confirmed live: extractNumber always takes the FIRST
// bare digit sequence in the combined claim+value text. Real research
// prose about a buyer/establishment population very often ALSO mentions
// a classification code earlier in the same sentence ("NAICS 23611:
// 212,178 establishments", "CBP tables ... (sector 23) ... (NAICS 236
// series)"), so the first digit sequence encountered is frequently the
// code, not the count. Tried first: a number sitting directly next to a
// population noun (establishments/businesses/buyers/companies/firms/
// customers/contractors), which is a far more reliable signal of "this
// is the actual count" than raw position in the sentence. Falls back to
// plain extractNumber only when no such adjacency exists, in which case
// isPlausibleBusinessPopulationClaim's minimum-amount and code-context
// guards are the only remaining defense against a stray code/section
// number being mistaken for a population figure.
const POPULATION_NEAR_NOUN_PATTERN = `${NUMBER_PATTERN_SOURCE}\\s+(?:employer\\s+)?(?:establishments?|businesses?|buyers?|companies|firms|customers?|contractors?)\\b`;

function matchPopulationNearNoun(text: string) {
  return text.match(new RegExp(POPULATION_NEAR_NOUN_PATTERN, "i"));
}

function extractPopulationCount(item: DomainResearchEvidence) {
  const text = `${item.claim} ${item.value}`;
  const nearNounMatch = matchPopulationNearNoun(text);
  if (nearNounMatch) {
    const parsed = parseNumberMatch(nearNounMatch);
    if (parsed) return parsed;
  }
  return extractNumber(text);
}

function formatAmount(amount: number, currency: string) {
  const absolute = Math.abs(amount);
  const divisor = absolute >= 1_000_000_000
    ? 1_000_000_000
    : absolute >= 1_000_000
      ? 1_000_000
      : absolute >= 1_000
        ? 1_000
        : 1;
  const suffix = divisor === 1_000_000_000
    ? "B"
    : divisor === 1_000_000
      ? "M"
      : divisor === 1_000
        ? "K"
        : "";
  const scaled = amount / divisor;
  return `${currency}${scaled.toLocaleString("en-US", {
    maximumFractionDigits: scaled < 10 ? 2 : 1,
  })}${suffix}`;
}

const geographyLabelPatterns: Array<[RegExp, string]> = [
  [/\boecd\b/i, "OECD"],
  [/\beuropean union\b|\beu\b/i, "European Union"],
  [/\beurope\b/i, "Europe"],
  [/\bglobal\b|\bworldwide\b|\binternational\b/i, "Global"],
];

function extractGeographyLabel(text: string) {
  for (const [pattern, label] of geographyLabelPatterns) {
    if (pattern.test(text)) return label;
  }
  return "Regional";
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

// Ranks each MarketSourceClass against the REQUIRED RESEARCH HIERARCHY
// (official government/statistical, regulatory/financial filings,
// industry associations, credible market research, company primary
// disclosures, general credible publications). Lower rank = stronger
// authority. Used only to pick the BEST candidate among several that all
// independently support a usable figure -- it never lowers the bar for
// what counts as usable evidence in the first place (every candidate
// considered here already passed isVerified + the confidence floor).
const sourceAuthorityRank: Record<MarketSourceClass, number> = {
  government_statistics: 1,
  financial_filing: 2,
  industry_association: 3,
  market_research: 4,
  company_primary: 5,
  credible_publication: 6,
  other: 7,
};

function isHighAuthoritySource(item: DomainResearchEvidence) {
  const authorityClass = classifyMarketEvidenceSource(item);
  return sourceAuthorityRank[authorityClass] <= 4;
}

// Best-first ordering across the hierarchy: strongest source class first,
// then higher confidence, then fresher. Never reorders on amount/size --
// picking "the biggest number" would be exactly the fabrication risk this
// engine exists to avoid.
function rankEvidenceCandidates(candidates: readonly DomainResearchEvidence[]) {
  return [...candidates].sort((left, right) => {
    const authorityDelta =
      sourceAuthorityRank[classifyMarketEvidenceSource(left)] -
      sourceAuthorityRank[classifyMarketEvidenceSource(right)];
    if (authorityDelta !== 0) return authorityDelta;
    const confidenceDelta =
      calculateEvidenceConfidence(right) - calculateEvidenceConfidence(left);
    if (confidenceDelta !== 0) return confidenceDelta;
    return freshness(right) - freshness(left);
  });
}

function extractEvidenceYear(item: DomainResearchEvidence) {
  const published = Date.parse(item.publishedDate || "");
  if (Number.isFinite(published)) {
    const year = new Date(published).getUTCFullYear();
    if (year >= 2000 && year <= new Date().getUTCFullYear() + 1) {
      return String(year);
    }
  }
  const match = evidenceText(item).match(/\b(20[0-3]\d)\b/);
  return match ? match[1] : "Not stated in evidence";
}

// A percentage claim that describes what SHARE of a broader figure is
// actually serviceable/addressable for this specific product, geography,
// or customer segment -- e.g. "the cloud-based segment represents 38% of
// the total market" or "SMBs account for approximately 30% of buyers".
// Deliberately distinct from a growth-rate percentage (cagr already owns
// that pattern) and from a generic market-share-of-a-named-competitor
// claim (vendor-intelligence.ts owns that).
function extractServiceableSharePercent(item: DomainResearchEvidence) {
  const text = evidenceText(item);
  if (!/segment|serviceable|addressable|sub-?market|vertical|niche|smb|enterprise|mid-?market/i.test(text)) {
    return null;
  }
  const match = text.match(/(\d{1,2}(?:\.\d+)?)\s*%/);
  if (!match) return null;
  const percent = Number(match[1]);
  return Number.isFinite(percent) && percent > 0 && percent < 100 ? percent / 100 : null;
}

// A percentage or share claim that describes a REALISTIC obtainable/
// penetration/win rate within a planning horizon -- e.g. "new entrants
// typically capture 1-3% of the serviceable market in their first three
// years" or "average vendor win rate in competitive RFPs is 8%". This is
// deliberately a high bar: most general market research never states
// this for a specific business, which is exactly why SOM defaults to
// "pending" rather than a fabricated percentage when it is absent.
function extractObtainableSharePercent(item: DomainResearchEvidence) {
  const text = evidenceText(item);
  if (
    !/obtainable|penetration.rate|win.rate|conversion.rate|capture.rate|market.share.(?:gain|capture)|first.year.share|adoption.rate/i.test(
      text
    )
  ) {
    return null;
  }
  const match = text.match(/(\d{1,2}(?:\.\d+)?)\s*%/);
  if (!match) return null;
  const percent = Number(match[1]);
  return Number.isFinite(percent) && percent > 0 && percent < 50 ? percent / 100 : null;
}

// CRITICAL FIX -- confirmed live: a research item can legitimately match
// the buyer-population keyword pattern (mentions "establishments") while
// its claim is actually a METHODOLOGY note describing WHERE such data
// lives, not the data point itself -- e.g. "CBP tables provide number of
// employer establishments by NAICS for construction (sector 23) and
// specific 4-6 digit codes (including NAICS 236 series)." extractNumber
// then grabs the first bare digit sequence it finds ("23", from "sector
// 23"), which is a NAICS SECTOR CODE, not a population count, producing
// a real-looking but wrong "23 buyers" TAM input. Two independent,
// deliberately simple guards: (1) the extracted amount must clear a
// minimum plausibility floor -- a real addressable-business-population
// figure for a country/regional market is essentially never below 50,
// so a smaller number is far more likely to be a stray code/index/sector
// fragment than a genuine count; (2) the digits actually used must not
// sit immediately next to a code/classification word (NAICS, sector,
// code, digit, table, figure, column, row) that marks them as a
// classification reference rather than a quantity. Both must pass --
// this never accepts a number that either looks too small to be real or
// reads as a classification reference in its own sentence.
const populationCodeContextPattern =
  /\b(?:naics|sic|sector|code|digit|table|figure|column|row|appendix|chapter|section)\b\s*[:#]?\s*\d[\d,]*|\d[\d,]*\s*\b(?:digit|series)\b/i;

function isPlausibleBusinessPopulationClaim(item: DomainResearchEvidence) {
  const combinedText = `${item.claim} ${item.value}`;
  const nearNounMatch = matchPopulationNearNoun(combinedText);
  if (nearNounMatch) {
    // A number sitting directly next to a population noun is trusted on
    // its own -- the adjacency itself is the plausibility signal, so a
    // classification code appearing elsewhere in the same sentence (e.g.
    // a NAICS code cited for context alongside the real count) does not
    // veto it.
    const parsed = parseNumberMatch(nearNounMatch);
    return Boolean(parsed && parsed.amount >= 50);
  }
  // No number found directly adjacent to a population noun -- the
  // fallback plain extraction (first bare digit sequence in the
  // sentence) is much more likely to have grabbed a classification code,
  // section reference, or table index, so both guards apply here.
  const parsed = extractNumber(combinedText);
  if (!parsed || parsed.amount < 50) return false;
  return !populationCodeContextPattern.test(evidenceText(item));
}

// A short, closed list of specific geographies -- deliberately not
// exhaustive. Used two ways: (1) to state the requested geography in the
// canonical market definition, and (2) to reject a candidate figure that
// explicitly names a DIFFERENT specific geography from the one requested
// (REQUIRED: market-definition mismatch guard). A prompt/evidence item
// naming none of these is never treated as a conflict either way -- this
// only catches explicit, named disagreements, never penalizes evidence
// for silence.
const specificGeographyPatterns: Array<[RegExp, string]> = [
  [/\bunited states\b|\bu\.s\.a?\.?\b(?!\w)|\bamerican\b/i, "United States"],
  [/\bunited kingdom\b|\bu\.k\.\b(?!\w)|\bbritain\b/i, "United Kingdom"],
  [/\bgermany\b|\bgerman\b/i, "Germany"],
  [/\bfrance\b|\bfrench\b/i, "France"],
  [/\bspain\b|\bspanish\b/i, "Spain"],
  [/\bturkey\b|\bt[üu]rkiye\b/i, "Turkey"],
  [/\bcanada\b|\bcanadian\b/i, "Canada"],
  [/\baustralia\b/i, "Australia"],
  [/\bindia\b/i, "India"],
  [/\bjapan\b/i, "Japan"],
  [/\bchina\b/i, "China"],
];

function extractRequestedGeography(text: string) {
  for (const [pattern, label] of specificGeographyPatterns) {
    if (pattern.test(text)) return label;
  }
  return "";
}

// REQUIRED: market-definition mismatch guard. Only ever excludes a
// candidate for an EXPLICIT, named conflict (e.g. a figure whose own
// text is about "the UK market" when the request is about the United
// States) -- it never demotes evidence merely for not repeating the
// requested geography verbatim, since most real evidence about a
// national market states its scope through domain/publisher context
// (e.g. a .gov.uk source) rather than the word itself.
function evidenceConflictsWithRequestedGeography(
  item: DomainResearchEvidence,
  requestedGeography: string
) {
  if (!requestedGeography) return false;
  const mentioned = extractRequestedGeography(evidenceText(item));
  return Boolean(mentioned) && mentioned !== requestedGeography;
}

const companySizePatterns: Array<[RegExp, string]> = [
  [/\bsmall and mid-?sized\b|\bsmb\b|\bsme\b|\bsmall business(?:es)?\b/i, "Small and mid-sized businesses (SMB/SME)"],
  [/\benterprise\b/i, "Enterprise"],
  [/\bmid-?market\b/i, "Mid-market"],
  [/\bstartups?\b/i, "Startups"],
];

function extractCompanySize(text: string) {
  for (const [pattern, label] of companySizePatterns) {
    if (pattern.test(text)) return label;
  }
  return "Not specified in request";
}

// Lightweight, regex-based extraction of "launching/offering/selling
// <category> for <buyer>" -- the shape most market-sizing requests use.
// Deliberately narrow: this is not a claimed general-purpose NLP parser,
// so a prompt that does not match this shape simply falls back to "Not
// specified in request" downstream rather than guessing.
function extractMarketCategoryAndBuyer(prompt: string) {
  const match = prompt.match(
    /\b(?:launching|offering|selling|building)\s+(.+?)\s+for\s+(.+?)(?:\s+is\s+(?:commercially|strategically)|\?|\.|$)/i
  );
  if (!match) return { category: "", buyerSegment: "" };
  return { category: concise(match[1], 140), buyerSegment: concise(match[2], 140) };
}

// REQUIRED: DEFINE THE MARKET BEFORE SIZING. Built once per request from
// the prompt (for what was asked) and the anchor evidence actually
// backing the estimate (for what the number covers) -- every field is an
// honest "Not specified" rather than a guess when the input does not
// clearly state it. spendUnit is filled in by the caller once the
// bottom-up unit (if any) is known.
function buildCanonicalMarketDefinition(
  prompt: string,
  anchorEvidence: DomainResearchEvidence | null,
  spendUnit: string
): MarketDefinition {
  const { category, buyerSegment } = extractMarketCategoryAndBuyer(prompt);
  const requestedGeography = extractRequestedGeography(prompt);
  const geography =
    requestedGeography ||
    (anchorEvidence ? extractGeographyLabel(evidenceText(anchorEvidence)) : "") ||
    "Not specified in request";
  const companySize = extractCompanySize(prompt);
  const currentYear = String(new Date().getUTCFullYear());
  const yearMatch = prompt.match(/\b(20[2-3]\d)\b/);

  return {
    geography,
    buyerSegment: buyerSegment || "Not specified in request",
    companySize,
    category: category || concise(prompt, 140),
    useCase: category || concise(prompt, 140),
    spendUnit,
    year: yearMatch ? yearMatch[1] : currentYear,
    inclusions: [
      category ? `${category} providers` : "Providers in the requested category",
      buyerSegment ? `Buyers matching: ${buyerSegment}` : "Buyers as described in the request",
    ],
    exclusions: [
      "Adjacent or broader categories not explicitly evidenced as this exact market",
      geography !== "Not specified in request"
        ? `Geographies outside ${geography} unless explicitly used as a disclosed adjacent-market proxy`
        : "No specific geography was requested, so no geography exclusion could be established",
    ],
  };
}

function describeConfidenceState(
  tier: MarketSizingEvidenceTier,
  confidenceLevel: MarketConfidenceLevel
): MarketSizingConfidenceState {
  if (tier === "directional") return "directional";
  return confidenceLevel === "High" ? "highConfidence" : "moderateConfidence";
}

// REQUIRED: ADJACENT-MARKET RECOVERY (pricing ingredient). Tried only
// after the strict, direct pricing search (annualPricingCandidates)
// finds nothing -- broadens both the vocabulary (cost/spend/budget/
// contract value/deal size/ACV/licensing, not just "pricing/
// subscription") and drops the requirement that the evidence be about
// the exact requested category, since by definition a proxy is allowed
// to come from a comparable/adjacent product. Never used silently: every
// caller that accepts this candidate must attach proxyDisclosure.
function findProxyPricingCandidate(sourceBacked: readonly DomainResearchEvidence[]) {
  const candidates = rankEvidenceCandidates(
    sourceBacked.filter(
      (item) =>
        /cost|spend|budget|contract value|deal size|\bacv\b|licensing fee|price point|average.*(?:price|contract)/i.test(
          evidenceText(item)
        ) && extractNumber(`${item.claim} ${item.value}`)
    )
  );
  return candidates[0] || null;
}

// REQUIRED: ADJACENT-MARKET RECOVERY (top-down path). When no direct or
// bottom-up figure exists, checks whether a broader/parent-category
// benchmark (the same regional_benchmark/global_benchmark evidence
// adjacentBenchmarks is built from) can be narrowed down using a REAL,
// evidence-derived ratio -- never an invented scaling factor. The ratio
// comes from two independently-sourced population/establishment-count
// figures at different specificity (e.g. all construction employer
// establishments vs. this exact NAICS sub-code) -- the smaller count is
// treated as the narrower target, the larger as the broader parent it is
// implicitly a subset of. Returns null (no proxy) whenever that ratio
// cannot be built from real evidence, rather than assuming a default
// share.
function findAdjacentProxyTopDown(
  evidence: readonly DomainResearchEvidence[],
  sourceBacked: readonly DomainResearchEvidence[],
  populationCandidates: readonly DomainResearchEvidence[]
) {
  const benchmarkCandidates = rankEvidenceCandidates(
    evidence.filter(
      (item) =>
        (item.field === "global_benchmark" || item.field === "regional_benchmark") &&
        isVerified(item) &&
        calculateEvidenceConfidence(item) >= 40 &&
        Boolean(extractMarketAmount(`${item.claim} ${item.value}`))
    )
  );
  const benchmark = benchmarkCandidates[0] || null;
  if (!benchmark) return null;

  const benchmarkAmount = extractMarketAmount(`${benchmark.claim} ${benchmark.value}`);
  if (!benchmarkAmount) return null;

  if (populationCandidates.length < 2) return null;
  const populationAmounts = populationCandidates
    .map((item) => ({ item, parsed: extractPopulationCount(item) }))
    .filter((entry): entry is { item: DomainResearchEvidence; parsed: NonNullable<ReturnType<typeof extractNumber>> } =>
      Boolean(entry.parsed)
    )
    .sort((left, right) => right.parsed.amount - left.parsed.amount);
  if (populationAmounts.length < 2) return null;

  const broader = populationAmounts[0];
  const narrower = populationAmounts[populationAmounts.length - 1];
  if (broader.parsed.amount <= 0 || narrower.item.id === broader.item.id) return null;
  const narrowingRatio = narrower.parsed.amount / broader.parsed.amount;
  if (!Number.isFinite(narrowingRatio) || narrowingRatio <= 0 || narrowingRatio >= 1) return null;

  return {
    amount: benchmarkAmount.amount * narrowingRatio,
    currency: benchmarkAmount.currency || "$",
    benchmark,
    benchmarkAmount,
    narrower: narrower.item,
    broader: broader.item,
    narrowingRatio,
  };
}

function buildPlanningEstimate(
  evidence: readonly DomainResearchEvidence[],
  prompt: string
): { estimate: MarketPlanningEstimate | null; gap: MarketSizingGap | null } {
  const requestedGeography = extractRequestedGeography(prompt);
  const sourceBacked = evidence.filter(
    (item) =>
      isVerified(item) &&
      calculateEvidenceConfidence(item) >= 48 &&
      item.claim.trim() &&
      item.value.trim()
  );

  // --- Step 1: direct top-down -- every candidate market-size figure for
  // this exact target that does not explicitly conflict with the
  // requested geography (not just the first one encountered), ranked by
  // the required research hierarchy so a government/regulatory/
  // association figure is preferred over a lower-authority one when
  // several exist.
  const topDownCandidates = rankEvidenceCandidates(
    sourceBacked.filter(
      (item) =>
        /market.size|tam|addressable.market|market.value/i.test(evidenceText(item)) &&
        extractMarketAmount(`${item.claim} ${item.value}`) &&
        !evidenceConflictsWithRequestedGeography(item, requestedGeography)
    )
  );
  const topDownBest = topDownCandidates[0] || null;
  const topDownAmount = topDownBest
    ? extractMarketAmount(`${topDownBest.claim} ${topDownBest.value}`)
    : null;

  // --- Step 2: buyer-count research -- every candidate addressable-
  // buyer/establishment count, geography-consistent, ranked by
  // authority.
  const buyerPopulationCandidates = rankEvidenceCandidates(
    sourceBacked.filter(
      (item) =>
        /business.population|buyer.population|addressable.customer|number.of.business|establishment|small.business/i.test(
          evidenceText(item)
        ) &&
        isPlausibleBusinessPopulationClaim(item) &&
        !evidenceConflictsWithRequestedGeography(item, requestedGeography)
    )
  );
  // --- Step 3: pricing/spend research -- direct evidence first; only
  // when that finds nothing does the adjacent/proxy search below run
  // (REQUIRED: ADJACENT-MARKET RECOVERY). Geography-consistency is not
  // enforced on the proxy tier since a proxy is, by definition, allowed
  // to come from a comparable product/market -- the disclosure makes
  // that explicit instead of hiding it.
  const directPricingCandidates = rankEvidenceCandidates(
    sourceBacked.filter(
      (item) =>
        /pricing|subscription|per.month|per.year|annual.price|monthly.price/i.test(
          evidenceText(item)
        ) && extractNumber(`${item.claim} ${item.value}`)
    )
  );
  const buyerPopulation = buyerPopulationCandidates[0] || null;
  let annualPricing = directPricingCandidates[0] || null;
  let pricingSource: "direct" | "proxy" | "none" = annualPricing ? "direct" : "none";
  let pricingProxyDisclosure = "";
  if (!annualPricing) {
    const proxyCandidate = findProxyPricingCandidate(sourceBacked);
    if (proxyCandidate) {
      annualPricing = proxyCandidate;
      pricingSource = "proxy";
      pricingProxyDisclosure = `Uses a per-unit cost/spend figure from [${proxyCandidate.id}] (${classifyMarketEvidenceSource(proxyCandidate).replace(/_/g, " ")}) as a proxy for this exact category's own pricing, since no direct pricing evidence was found. This figure describes a comparable product/spend context, not a confirmed price for this specific category, which introduces meaningful uncertainty into the resulting TAM.`;
    }
  }

  // --- Step 4: bottom-up construction.
  const bottomUpInputs =
    buyerPopulation && annualPricing
      ? {
          buyers: extractPopulationCount(buyerPopulation),
          pricing: extractNumber(`${annualPricing.claim} ${annualPricing.value}`),
        }
      : null;
  const bottomUpAmount =
    bottomUpInputs?.buyers && bottomUpInputs.pricing
      ? bottomUpInputs.buyers.amount *
        (/per.month|monthly/i.test(evidenceText(annualPricing!))
          ? bottomUpInputs.pricing.amount * 12
          : bottomUpInputs.pricing.amount)
      : null;

  // --- Step 5: independent top-down construction already computed above
  // (topDownAmount). Step 6: adjacent-market recovery for top-down, only
  // attempted when neither direct top-down nor bottom-up succeeded --
  // tried here so its cost (extra ranking/filtering over already-fetched
  // evidence, no new research calls) is only paid when actually needed.
  const hasDirectTopDown = Boolean(topDownAmount && topDownAmount.amount > 0);
  const hasBottomUp = Boolean(bottomUpAmount && bottomUpAmount > 0);
  const adjacentProxyTopDown =
    !hasDirectTopDown && !hasBottomUp
      ? findAdjacentProxyTopDown(evidence, sourceBacked, buyerPopulationCandidates)
      : null;

  if (!hasDirectTopDown && !hasBottomUp && !adjacentProxyTopDown) {
    // Recovery loop exhausted: direct top-down, buyer-count + pricing
    // (direct and proxy), and adjacent-benchmark narrowing all failed.
    // Build a specific explanation instead of a bare null (REQUIRED:
    // USER-FACING REPORT QUALITY / RESEARCH RECOVERY LOOP).
    const bestPopulation = buyerPopulationCandidates[0] || null;
    const populationAmount = bestPopulation ? extractPopulationCount(bestPopulation) : null;
    const partialQuantity =
      bestPopulation && populationAmount
        ? {
            amount: populationAmount.amount,
            description: concise(bestPopulation.claim || bestPopulation.value, 200),
            evidenceId: bestPopulation.id,
          }
        : null;
    // pricingIsAvailable mirrors the exact ingredients bottom-up already
    // tried (direct pricing candidates, then the proxy search) -- used
    // only to make the gap explanation specific, never to compute
    // anything, since without a population count there is nothing to
    // multiply a price by regardless of how good the pricing evidence is.
    const pricingIsAvailable =
      directPricingCandidates.length > 0 || Boolean(findProxyPricingCandidate(sourceBacked));
    const missingIngredient: MarketSizingGap["missingIngredient"] = partialQuantity
      ? "pricing"
      : pricingIsAvailable
        ? "buyerPopulation"
        : topDownCandidates.length === 0
          ? "everything"
          : "topDownFigure";
    const explanation = partialQuantity
      ? `ZERINIX identified approximately ${Math.round(partialQuantity.amount).toLocaleString("en-US")} qualifying buyers/establishments from [${partialQuantity.evidenceId}] (${partialQuantity.description}), but could not establish a sufficiently reliable annual spend, subscription, or contract-value benchmark for this product category -- no vendor pricing, comparable-product cost, or procurement disclosure was found even after searching adjacent/comparable evidence. A monetary TAM is therefore withheld pending pricing validation, rather than assuming a spend figure with no evidential basis.`
      : missingIngredient === "buyerPopulation"
        ? "ZERINIX found credible pricing/spend evidence for this category, but no addressable buyer or establishment population count that met the confidence and geography-consistency bar required to anchor a bottom-up calculation. A monetary TAM is therefore withheld pending buyer-population validation -- a real price without a real population to apply it to cannot become a market size."
        : missingIngredient === "topDownFigure"
          ? "ZERINIX found a candidate market-size figure, but it did not clear the confidence, geography-consistency, or amount-extraction bar required to anchor a TAM, and no bottom-up or adjacent-market alternative was available either. A monetary TAM is therefore withheld pending a more reliable market-size disclosure."
          : "ZERINIX searched for a direct market-size figure, an addressable buyer population, and comparable adjacent-market benchmarks for this exact request, but found no verifiable numeric evidence for any of them. A monetary TAM is therefore withheld until at least one of these evidence types becomes available.";

    return {
      estimate: null,
      gap: {
        attemptedTopDown: true,
        attemptedBottomUp: true,
        attemptedAdjacentProxy: true,
        partialQuantity,
        missingIngredient,
        explanation,
      },
    };
  }

  const currency =
    (hasDirectTopDown ? topDownAmount!.currency : "") ||
    (hasBottomUp ? bottomUpInputs!.pricing!.currency : "") ||
    (adjacentProxyTopDown ? adjacentProxyTopDown.currency : "") ||
    "$";

  let tamLow: number;
  let tamHigh: number;
  let method: MarketSizingMethod;
  let tier: MarketSizingEvidenceTier;
  let conflicting = false;
  let conflictNote = "";
  let basis = "";
  let proxyDisclosure = pricingSource === "proxy" ? pricingProxyDisclosure : "";
  const evidenceIds: string[] = [];
  let anchorEvidence: DomainResearchEvidence;

  if (hasDirectTopDown && hasBottomUp) {
    const low = Math.min(topDownAmount!.amount, bottomUpAmount!);
    const high = Math.max(topDownAmount!.amount, bottomUpAmount!);
    const ratio = high / Math.max(low, 1);
    tamLow = low;
    tamHigh = high;
    method = "triangulated";
    conflicting = ratio > 2.5;
    tier = conflicting || pricingSource === "proxy" ? "directional" : "supportedEstimate";
    basis = `Top-down figure ${formatAmount(topDownAmount!.amount, currency)} from [${topDownBest!.id}] triangulated against bottom-up estimate ${formatAmount(bottomUpAmount!, currency)} (addressable buyers [${buyerPopulation!.id}] × annualized price [${annualPricing!.id}]${pricingSource === "proxy" ? ", proxy pricing" : ""}).`;
    conflictNote = conflicting
      ? `Top-down and bottom-up methods diverge by ${ratio.toFixed(1)}x (${formatAmount(topDownAmount!.amount, currency)} vs ${formatAmount(bottomUpAmount!, currency)}); the range below spans both rather than silently choosing one. Possible reasons include a different market definition, geography, reference year, or buyer-population scope between the two methods -- neither figure was discarded to force agreement.`
      : "";
    evidenceIds.push(topDownBest!.id, buyerPopulation!.id, annualPricing!.id);
    anchorEvidence = topDownBest!;
  } else if (hasDirectTopDown) {
    tamLow = topDownAmount!.amount;
    tamHigh = topDownAmount!.amount;
    method = "topDown";
    tier = isHighAuthoritySource(topDownBest!) ? "supportedEstimate" : "directional";
    basis = `TAM planning baseline uses ${topDownAmount!.token} from [${topDownBest!.id}] (${classifyMarketEvidenceSource(topDownBest!).replace(/_/g, " ")}).`;
    evidenceIds.push(topDownBest!.id);
    anchorEvidence = topDownBest!;
  } else if (hasBottomUp) {
    tamLow = bottomUpAmount!;
    tamHigh = bottomUpAmount!;
    method = "bottomUp";
    tier =
      pricingSource === "proxy" || !isHighAuthoritySource(buyerPopulation!)
        ? "directional"
        : "supportedEstimate";
    basis = `TAM = addressable buyers from [${buyerPopulation!.id}] (${classifyMarketEvidenceSource(buyerPopulation!).replace(/_/g, " ")}) × annualized price from [${annualPricing!.id}]${pricingSource === "proxy" ? " (proxy)" : ""}.`;
    evidenceIds.push(buyerPopulation!.id, annualPricing!.id);
    anchorEvidence = buyerPopulation!;
  } else {
    // adjacentProxyTopDown (REQUIRED: ADJACENT-MARKET RECOVERY, top-down
    // path) -- always directional, regardless of the benchmark's own
    // authority, since the figure depends on a scaling ratio rather than
    // a direct measurement of the requested market.
    const proxy = adjacentProxyTopDown!;
    tamLow = proxy.amount;
    tamHigh = proxy.amount;
    method = "adjacentProxy";
    tier = "directional";
    basis = `TAM = broader-category benchmark ${formatAmount(proxy.benchmarkAmount.amount, currency)} from [${proxy.benchmark.id}] (${classifyMarketEvidenceSource(proxy.benchmark).replace(/_/g, " ")}) × ${(proxy.narrowingRatio * 100).toFixed(1)}% narrowing ratio (${narrowingRatioLabel(proxy)}).`;
    proxyDisclosure = `Uses [${proxy.benchmark.id}]'s broader/parent-category market figure as a proxy, scaled down by the real, evidence-derived ratio between [${proxy.narrower.id}] and [${proxy.broader.id}] (narrower/broader buyer-population counts), since no direct market-size or complete bottom-up figure exists for this exact category. This proxy assumes the narrower category's revenue share is proportional to its population share, which may not hold if pricing, adoption, or competitive intensity differ materially between the broader and narrower categories -- treat this as a bounded, directional estimate, not a measured figure.`;
    evidenceIds.push(proxy.benchmark.id, proxy.narrower.id, proxy.broader.id);
    anchorEvidence = proxy.narrower;
  }

  const tamSupporting = sourceBacked.filter((item) => evidenceIds.includes(item.id));
  const staleAverageFreshness =
    tamSupporting.reduce((sum, item) => sum + freshness(item), 0) /
    Math.max(1, tamSupporting.length);
  const stale = staleAverageFreshness <= 58;

  // --- SAM: evidence-derived serviceable share when the research surfaced
  // a real segment/geography narrowing percentage; otherwise the disclosed
  // default, never silently presented as if it were evidence-based.
  const serviceableShareEvidence = rankEvidenceCandidates(sourceBacked).find((item) =>
    extractServiceableSharePercent(item) !== null
  );
  const serviceableSharePercent = serviceableShareEvidence
    ? extractServiceableSharePercent(serviceableShareEvidence)!
    : 0.25;
  const samMethod: "evidenceDerived" | "defaultAssumption" = serviceableShareEvidence
    ? "evidenceDerived"
    : "defaultAssumption";
  const samLow = tamLow * serviceableSharePercent;
  const samHigh = tamHigh * serviceableSharePercent;
  if (serviceableShareEvidence) evidenceIds.push(serviceableShareEvidence.id);

  // --- SOM: only ever a real figure when the evidence itself states a
  // defensible obtainable/penetration/win-rate percentage. No fallback
  // percentage is invented -- an undefended SOM stays honestly pending,
  // which the existing TAM/SAM/SOM cascade (page.tsx/Planner.tsx) already
  // renders as "Validation Needed" for that layer alone once its value
  // text carries no parseable number.
  const obtainableShareEvidence = rankEvidenceCandidates(sourceBacked).find((item) =>
    extractObtainableSharePercent(item) !== null
  );
  const obtainableSharePercent = obtainableShareEvidence
    ? extractObtainableSharePercent(obtainableShareEvidence)!
    : null;
  const somStatus: "calculated" | "pending" = obtainableSharePercent ? "calculated" : "pending";
  if (obtainableShareEvidence) evidenceIds.push(obtainableShareEvidence.id);

  const baseConfidence = calculatePlanningEstimateConfidence(tamSupporting, false);
  let confidence = baseConfidence;
  if (method === "triangulated" && !conflicting) confidence += 8;
  if (conflicting) confidence -= 15;
  if (stale) confidence -= 10;
  if (samMethod === "defaultAssumption") confidence -= 6;
  if (pricingSource === "proxy") confidence -= 12;
  if (method === "adjacentProxy") confidence -= 18;
  confidence = clampScore(confidence);

  // REQUIRED: TAM -> SAM GATING. TAM existing is necessary but not
  // sufficient to unlock SAM -- "allow a sufficiently defensible DERIVED
  // TAM to unlock SAM when its evidence/confidence threshold is
  // satisfied" means a TAM that survived the recovery loop but stacked
  // enough uncertainty penalties (e.g. an adjacent-market proxy that is
  // also stale and also conflicting) must not silently produce a SAM/SOM
  // that looks just as solid as a well-evidenced one. 20 is a low bar
  // deliberately -- most real, single-penalty estimates clear it easily;
  // only a TAM compounding multiple uncertainty penalties gets blocked.
  const MINIMUM_CONFIDENCE_TO_UNLOCK_SAM = 20;
  const samUnlocked = confidence >= MINIMUM_CONFIDENCE_TO_UNLOCK_SAM;

  // A TAM whose confidence did not clear the unlock threshold blocks SAM
  // (and therefore SOM) entirely, regardless of what the serviceable-
  // share/obtainable-share searches above found -- the dependency chain
  // must hold even when SAM's own inputs would otherwise look fine.
  const effectiveSomStatus: "calculated" | "pending" = samUnlocked ? somStatus : "pending";

  const range = (low: number, high: number) =>
    low === high
      ? formatAmount(low, currency)
      : `${formatAmount(low, currency)}–${formatAmount(high, currency)}`;

  const formulaParts = [basis];
  if (!samUnlocked) {
    formulaParts.push(
      `SAM withheld: TAM confidence (${confidence}/100) did not clear the ${MINIMUM_CONFIDENCE_TO_UNLOCK_SAM}/100 threshold required to derive a serviceable market from this estimate -- narrowing an already-uncertain TAM would compound speculation rather than add precision.`
    );
  } else if (samMethod === "evidenceDerived") {
    formulaParts.push(
      `SAM = TAM × ${Math.round(serviceableSharePercent * 100)}% serviceable-share evidence from [${serviceableShareEvidence!.id}].`
    );
  } else {
    formulaParts.push("SAM = TAM × 25% disclosed default serviceable-share assumption (no segment-narrowing evidence found).");
  }
  if (!samUnlocked) {
    formulaParts.push("SOM left pending: blocked by SAM, not independently evaluated.");
  } else if (effectiveSomStatus === "calculated") {
    formulaParts.push(
      `SOM = SAM × ${Math.round(obtainableSharePercent! * 100)}% obtainable-share evidence from [${obtainableShareEvidence!.id}].`
    );
  } else {
    formulaParts.push(
      "SOM left pending: no defensible obtainable-share, penetration-rate, or win-rate evidence was found for this market -- an invented percentage was not substituted."
    );
  }
  if (conflictNote) formulaParts.push(conflictNote);
  if (stale) {
    formulaParts.push(
      `Evidence backing this estimate is dated ${extractEvidenceYear(anchorEvidence)} or earlier; treat the figure as a historical baseline, not current market size.`
    );
  }

  const assumptions = [
    !samUnlocked
      ? `[Gap] SAM requires a TAM confidence of at least ${MINIMUM_CONFIDENCE_TO_UNLOCK_SAM}/100; this estimate scored ${confidence}/100, so SAM is reported as pending rather than derived from an insufficiently defensible TAM.`
      : samMethod === "evidenceDerived"
        ? `[Evidence] Serviceable share of ${Math.round(serviceableSharePercent * 100)}% is based on segment/geography evidence, not a default.`
        : "[Assumption] Serviceable share is 25% until segment and geography data are validated.",
  ];
  if (samUnlocked) {
    if (effectiveSomStatus === "pending") {
      assumptions.push(
        "[Gap] Obtainable share (SOM) requires evidence of realistic penetration rate, win rate, or reachable-account capacity -- none was found, so SOM is reported as pending rather than assumed."
      );
    } else {
      assumptions.push(
        `[Evidence] Obtainable share of ${Math.round(obtainableSharePercent! * 100)}% is based on penetration/win-rate evidence, not a default.`
      );
    }
  }

  const confidenceLevel = classifyMarketConfidence(confidence);
  const spendUnitLabel =
    method === "adjacentProxy"
      ? "Not applicable — scaled from a broader-category benchmark"
      : method === "bottomUp" || (method === "triangulated" && hasBottomUp)
        ? "Annual per-buyer spend (USD)"
        : "Not applicable — top-down category figure";
  const geography = extractGeographyLabel(evidenceText(anchorEvidence));
  const definition = buildCanonicalMarketDefinition(prompt, anchorEvidence, spendUnitLabel);

  return {
    estimate: {
      classification: "Estimated",
      tam: range(tamLow, tamHigh),
      sam: samUnlocked
        ? range(samLow, samHigh)
        : "not derived — TAM confidence did not clear the threshold required to unlock a serviceable-market estimate (see confidence and formula below).",
      som:
        effectiveSomStatus === "calculated"
          ? range(samLow * obtainableSharePercent!, samHigh * obtainableSharePercent!)
          : samUnlocked
            ? "realistic obtainable-share evidence (penetration rate, win rate, or reachable-account capacity) was not found for this market."
            : "blocked — SAM was not derived, so no obtainable-market estimate can be built.",
      formula: formulaParts.join(" "),
      assumptions,
      evidenceIds: [...new Set(evidenceIds)],
      confidence,
      confidenceLevel,
      basis: "source_based",
      method,
      tier,
      confidenceState: describeConfidenceState(tier, confidenceLevel),
      geography,
      year: extractEvidenceYear(anchorEvidence),
      marketDefinition: concise(anchorEvidence.claim || anchorEvidence.value, 160),
      definition,
      conflicting,
      conflictNote,
      samMethod: samUnlocked ? samMethod : "blocked",
      somStatus: effectiveSomStatus,
      pricingSource: method === "topDown" || method === "adjacentProxy" ? "none" : pricingSource,
      proxyDisclosure,
      stale,
    },
    gap: null,
  };
}

function narrowingRatioLabel(proxy: {
  narrower: DomainResearchEvidence;
  broader: DomainResearchEvidence;
  narrowingRatio: number;
}) {
  return `${concise(proxy.narrower.claim || proxy.narrower.value, 80)} is ${(proxy.narrowingRatio * 100).toFixed(1)}% of ${concise(proxy.broader.claim || proxy.broader.value, 80)}`;
}

export function buildMarketIntelligenceGraph(
  bundle: Pick<DomainResearchBundle, "evidence">,
  prompt = ""
): MarketIntelligenceGraph {
  const evidence = bundle.evidence;
  const vendorIntelligence = buildVendorIntelligenceGraph(evidence, prompt);
  const sanitizedSources = evidence
    .map((item) => {
      const sanitized = sanitizeResearchPublisher({
        publisher: item.publisher,
        title: item.sourceTitle,
        url: item.url,
      });
      if (!sanitized) return null;
      const confidenceScore = calculateEvidenceConfidence(item);
      return {
        evidenceId: item.id,
        title: sanitized.title,
        publisher: sanitized.publisher,
        url: canonicalUrl(sanitized.url.toString()),
        publishedDate: item.publishedDate,
        accessedAt: item.lastChecked,
        sourceType: item.sourceType,
        confidenceClassification: confidenceClassification(item),
        confidenceScore,
        confidenceLevel: classifyMarketConfidence(confidenceScore),
        claim: concise(item.claim),
      } satisfies MarketIntelligenceSource;
    })
    .filter((item): item is MarketIntelligenceSource => Boolean(item));

  // Every evidence ID that produced a real, valid-URL sanitized source --
  // BEFORE the canonical-URL dedup below collapses same-URL duplicates
  // down to one representative row. Two evidence items can legitimately
  // point at the same canonical URL (re-fetched, or discovered via two
  // different search queries); the dedup keeps only one row to display,
  // but the model was given every original ID and may correctly cite
  // whichever one it saw. Confirmed live: a citation to a real, gathered
  // source (not a hallucination) was rejected as an "orphan" purely
  // because its specific ID lost the dedup coin-flip to another ID
  // pointing at the same URL. This is the authoritative "was this ID ever
  // a real, gathered, valid-URL source" set -- the rendered `sources`
  // list below is a presentation dedup on top of it, not a narrower
  // definition of what counts as real.
  const citableEvidenceIds = new Set(sanitizedSources.map((item) => item.evidenceId));

  const sources = sanitizedSources.filter(
    (item, index, items) =>
      items.findIndex(
        (candidate) => canonicalUrl(candidate.url) === canonicalUrl(item.url)
      ) === index
  );

  // Maps EVERY citable evidence ID -- not just the ones that survived the
  // canonical-URL dedup above as their own row -- to the one representative
  // MarketIntelligenceSource record a reader should see for it. Two
  // evidence IDs pointing at the same canonical URL both resolve to the
  // SAME record here, which is what lets the bibliography merge them into
  // a single reference entry (tagged with every ID that cites it) instead
  // of either duplicating the entry or losing the citation. Plain object,
  // not a Map, so this survives a JSON round-trip (report-cache snapshots
  // store this graph as JSON).
  const sourceRecordByEvidenceId: Record<string, MarketIntelligenceSource> = {};
  for (const item of sanitizedSources) {
    const representative =
      sources.find((candidate) => canonicalUrl(candidate.url) === canonicalUrl(item.url)) ||
      item;
    sourceRecordByEvidenceId[item.evidenceId] = representative;
  }

  const competitorMap = new Map<string, MarketIntelligenceCompetitor>();
  for (const vendor of vendorIntelligence.vendors) {
    competitorMap.set(vendor.name.toLocaleLowerCase("en"), {
      name: vendor.name,
      positioning: `${vendor.classifications.join(", ")}; target: ${vendor.targetCustomer}`,
      pricingEvidence:
        vendor.pricingModels.length > 0 ? vendor.pricingEvidence : "",
      confidenceClassification:
        vendor.confidence >= 48 ? "Verified" : "Estimated",
      confidenceScore: vendor.confidence,
      confidenceLevel: vendor.confidenceLevel,
      evidenceIds: vendor.evidenceSources,
    });
  }

  const commercialEvidenceIds = new Set(
    vendorIntelligence.vendors.flatMap((vendor) => vendor.evidenceSources)
  );

  const pricingModels = evidence
    .filter(
      (item) =>
        commercialEvidenceIds.has(item.id) &&
        isVerified(item) &&
        calculateEvidenceConfidence(item) >= 48 &&
        /pricing|subscription|per.month|per.year|usage.based|seat.based/i.test(
          evidenceText(item)
        )
    )
    .map((item) => {
      const confidenceScore = calculateEvidenceConfidence(item);
      return {
        description: concise(item.value || item.claim),
        evidenceIds: [item.id],
        confidenceClassification:
          confidenceClassification(item) === "Verified"
            ? ("Verified" as const)
            : ("Estimated" as const),
        confidenceScore,
        confidenceLevel: classifyMarketConfidence(confidenceScore),
      };
    });

  const verifiedMarketSize = evidence
    .filter(
      (item) =>
        isAuthoritativeObservedMarketSize(item) &&
        /market.size|tam|sam|som|addressable.market/i.test(evidenceText(item)) &&
        Boolean(extractMarketAmount(`${item.claim} ${item.value}`))
    )
    .map((item) => {
      const confidenceScore = calculateEvidenceConfidence(item);
      return {
        description: concise(item.value || item.claim),
        evidenceIds: [item.id],
        confidenceClassification: "Verified" as const,
        confidenceScore,
        confidenceLevel: classifyMarketConfidence(confidenceScore),
      };
    });

  const cagr = evidence
    .filter(
      (item) =>
        isVerified(item) &&
        calculateEvidenceConfidence(item) >= 48 &&
        /cagr|compound annual|growth rate|forecast growth/i.test(
          evidenceText(item)
        ) && /\d+(?:\.\d+)?\s*%/.test(evidenceText(item))
    )
    .map((item) => {
      const confidenceScore = calculateEvidenceConfidence(item);
      return {
        description: concise(item.value || item.claim),
        evidenceIds: [item.id],
        confidenceClassification:
          confidenceClassification(item) === "Verified"
            ? ("Verified" as const)
            : ("Estimated" as const),
        confidenceScore,
        confidenceLevel: classifyMarketConfidence(confidenceScore),
      };
    });

  const adjacentBenchmarks = evidence
    .filter(
      (item) =>
        (item.field === "global_benchmark" || item.field === "regional_benchmark") &&
        isVerified(item) &&
        calculateEvidenceConfidence(item) >= 40 &&
        Boolean(extractNumber(`${item.claim} ${item.value}`))
    )
    .map((item) => {
      const confidenceScore = calculateEvidenceConfidence(item);
      return {
        description: concise(item.value || item.claim),
        geography: extractGeographyLabel(evidenceText(item)),
        evidenceIds: [item.id],
        confidenceClassification: "Estimated" as const,
        confidenceScore,
        confidenceLevel: classifyMarketConfidence(confidenceScore),
      };
    });

  const baseCoverage = evaluateMarketResearchCoverage(evidence, prompt);
  const competitorBreadth = competitorMap.size;
  const { estimate: planningEstimate, gap: sizingGap } = buildPlanningEstimate(evidence, prompt);
  const competitiveEvidence = Math.max(
    baseCoverage.dimensions.competitiveEvidence,
    vendorIntelligence.coverage.competitiveCoverageScore,
    Math.min(100, competitorBreadth * 13 + baseCoverage.averageQuality * 0.15)
  );
  const financialEvidence = Math.max(
    baseCoverage.dimensions.financialEvidence,
    planningEstimate ? Math.min(62, 30 + planningEstimate.confidence * 0.3) : 0,
    // No verified local market-size figure and no source-based planning
    // estimate is not the same as no financial signal at all -- a real
    // Europe/OECD/regional benchmark is still concrete evidence the model
    // can reason from, just never presented as the requested geography's
    // own verified number (adjacentBenchmarks stays a separate array from
    // verifiedMarketSize/planningEstimate for exactly that reason).
    adjacentBenchmarks.length > 0 ? Math.min(40, 18 + adjacentBenchmarks.length * 6) : 0
  );
  const dimensions = {
    ...baseCoverage.dimensions,
    competitiveEvidence: Math.round(competitiveEvidence),
    financialEvidence: Math.round(financialEvidence),
  };
  const overallConfidence = calculateMarketOverallConfidence(dimensions);
  const coverage: MarketResearchCoverage = {
    ...baseCoverage,
    competitorBreadth,
    dimensions,
    overallConfidence,
  };

  return {
    version: MARKET_INTELLIGENCE_GRAPH_VERSION,
    competitors: [...competitorMap.values()],
    pricingModels,
    verifiedMarketSize,
    planningEstimate,
    sizingGap,
    adjacentBenchmarks,
    cagr,
    sources,
    citableEvidenceIds,
    sourceRecordByEvidenceId,
    vendorIntelligence,
    coverage,
  };
}

// Drops `version` (a static constant, identical on every call, carries zero
// information for the model) and `null`-valued keys (a JSON `null` costs
// tokens to encode and parse for the same "no data" meaning an omitted key
// already conveys) before serializing. No information available to the
// model is removed -- every non-null field/array is sent exactly as before.
export function formatMarketIntelligenceGraphForModel(
  graph: MarketIntelligenceGraph
) {
  const { version, ...rest } = graph;
  void version;
  return JSON.stringify(rest, (_key, value) => (value === null ? undefined : value));
}

type MarketGraphLanguage = "English" | "Turkish" | "German" | "French" | "Spanish";

type MarketGraphCopyKey =
  | "marketInfrastructureTitle"
  | "pricingEvidenceLabel"
  | "competitorComparisonTitle"
  | "majorPlayersTitle"
  | "insufficientMajorPlayers"
  | "verifiedMarketSizeTitle"
  | "marketSizeBaselineLabel"
  | "marketSizeBaselineExplanation"
  | "planningEstimateTitle"
  | "formulaLabel"
  | "confidenceLabel"
  | "tamSamSomUnavailable"
  | "marketSizeUnavailable"
  | "marketSizePlanningEstimateLine"
  | "adjacentPlayersTitle"
  | "adjacentPlayersIntro"
  | "adjacentPlayerValidationGapLabel"
  | "tableHeader"
  | "notEstablished"
  | "notPubliclyValidated"
  | "notProvided"
  | "publisherLabel"
  | "publishedLabel"
  | "accessedLabel"
  | "sourceTypeLabel"
  | "classificationLabel"
  | "claimLinkageLabel"
  | "basisLabel"
  | "evidenceLabel"
  | "assumptionOnlyScenario"
  | "verifiedTag"
  | "estimatedTag"
  | "assumptionTag"
  | "noValidatedPricingEvidence"
  | "noValidatedStrengthEvidence"
  | "noValidatedWeaknessEvidence"
  | "commercialVendorReasonTemplate"
  | "excludedVendorReasonTemplate"
  | "entityTypeGovernment"
  | "entityTypeRegulator"
  | "entityTypeStandardsBody"
  | "reasonRegulator"
  | "reasonGovernment"
  | "reasonStandardsBody"
  | "targetCustomerLabel"
  | "rankingLabel"
  | "overallScoreLabel"
  | "sourcesTitle"
  | "noVerifiableSourcesText"
  | "competitorClaimAdjacentReframeTemplate"
  | "competitorClaimUnsupportedReplacement";

const marketGraphCopy: Record<MarketGraphLanguage, Record<MarketGraphCopyKey, string>> = {
  English: {
    marketInfrastructureTitle: "Market Infrastructure",
    pricingEvidenceLabel: "Pricing evidence",
    competitorComparisonTitle: "Validated competitor comparison",
    majorPlayersTitle: "Evidence-supported major players",
    insufficientMajorPlayers:
      "Insufficient independent evidence for Major Players ranking; validated commercial vendors remain available in the Competitive Landscape.",
    verifiedMarketSizeTitle: "Verified market-size evidence",
    marketSizeBaselineLabel: "Market / Industry Baseline — Not Yet Validated as TAM for This Business",
    marketSizeBaselineExplanation:
      "This is a verified total for the broader industry or services category, not an automatically validated Total Addressable Market (TAM) for the specific business scope requested in this report. Promoting a broader baseline to TAM requires independently confirming that the requested geography, customer segment, and product/service definition are actually covered by this evidence. See TAM / SAM / SOM below for that determination.",
    // P0 FIX -- confirmed live (source/evidence integrity repair):
    // planningEstimateTitle/tamSamSomUnavailable/marketSizeUnavailable
    // deliberately say "confirmed", never "verified" -- these three
    // strings ride into tamSamSom/marketSize field content that
    // page.tsx's report-wide `fullContent` blob concatenates every section
    // into, and the Decision Signal/Decision Confidence KPI cards
    // (getDashboardMetricEvidence -> inferEvidenceLevel) scan that entire
    // blob for the bare word "verified" as their sole positive-evidence
    // signal. planningEstimateTitle in particular renders on EVERY report
    // that uses a Planning Estimate (the common case, not just full
    // unavailability), so its prior "not externally verified" wording
    // alone was enough to make an unrelated KPI card read as "Data
    // Confirmed" on a normal, correctly-labeled [Estimated] report.
    // verifiedMarketSizeTitle above is deliberately left untouched: that
    // branch only ever renders when the market size genuinely IS verified,
    // so the word is accurate there, not a false-positive trigger.
    planningEstimateTitle: "Planning Estimate — not externally confirmed market size",
    formulaLabel: "Formula",
    confidenceLabel: "Confidence",
    tamSamSomUnavailable:
      "A confirmed market-size figure (TAM / SAM / SOM) could not be established for this market. No comparable local, regional, or global benchmark was available to build a labeled estimate from, and the available data on buyer population and pricing was not sufficient together to construct one either. This gap reflects a lack of published data for this specific scope, not the size of the opportunity. The number of vendors identified was not used on its own to fabricate a market-size figure.",
    marketSizeUnavailable:
      "A defensible aggregate market-size figure could not be established for this market. No confirmed local figure, comparable benchmark, or sufficient buyer-population-and-pricing data was available to build one. Per-customer figures such as pricing, ARPA, ACV, or willingness-to-pay evidence found during research describe an individual buyer's spend, not the total market, and were never substituted here as a market-size figure.",
    marketSizePlanningEstimateLine: "Market Size",
    adjacentPlayersTitle: "Relevant Industry Players — Not Independently Validated as Direct Competitors",
    adjacentPlayersIntro:
      "These companies are named in available evidence as active in or adjacent to this market, but current evidence does not independently corroborate them as directly comparable competitors. See Competitive Landscape for direct-competitor validation status.",
    adjacentPlayerValidationGapLabel: "Not independently validated as a direct competitor from current evidence",
    // CRITICAL FIX -- the prior column header named a raw internal audit
    // metric on a customer-facing competitor comparison table; the new
    // header states the same fact (how many independent sources back
    // this row) in executive language. The underlying count itself is
    // unchanged -- only the column header text.
    tableHeader:
      "| Vendor | Parent Company | Category | Segment | AI Capability | Key Use Cases | Pricing Model | Strengths | Weaknesses | Validation Count | Confidence | Market Relevance |",
    notEstablished: "Not disclosed in public sources",
    notPubliclyValidated: "Not independently confirmed",
    notProvided: "Not disclosed",
    publisherLabel: "Publisher",
    publishedLabel: "Published",
    accessedLabel: "Accessed",
    sourceTypeLabel: "Source type",
    classificationLabel: "Classification",
    claimLinkageLabel: "Claim linkage",
    sourcesTitle: "Sources",
    noVerifiableSourcesText:
      "No independently verifiable sources were used in this report.",
    competitorClaimAdjacentReframeTemplate:
      "%NAMES%: tracked as an adjacent/platform presence in this market, not independently validated as a direct, head-to-head competitor with current evidence.",
    competitorClaimUnsupportedReplacement:
      "Specific named rivals could not be independently validated with current evidence; any competitive pressure discussed here reflects general market structure, not a confirmed competitor claim.",
    basisLabel: "Basis",
    evidenceLabel: "Evidence",
    assumptionOnlyScenario: "assumption-only scenario",
    verifiedTag: "Verified",
    estimatedTag: "Estimated",
    assumptionTag: "Assumption",
    noValidatedPricingEvidence: "Pricing not publicly disclosed",
    noValidatedStrengthEvidence: "No distinct strength identified in public sources",
    noValidatedWeaknessEvidence: "No distinct weakness identified in public sources",
    commercialVendorReasonTemplate: "%NAME% is a commercial product vendor with evidence directly tied to %CATEGORY%.",
    excludedVendorReasonTemplate: "%NAME% is identified by the evidence as an implementation partner, marketplace, outsourced service provider, or advisory firm rather than a commercial product vendor in this market.",
    entityTypeGovernment: "government",
    entityTypeRegulator: "regulator",
    entityTypeStandardsBody: "standards body",
    reasonRegulator: "Regulatory authority, filing platform, or disclosure system.",
    reasonGovernment: "Government entity or official government domain.",
    reasonStandardsBody: "Trade association, exhibition organizer, or professional/technical standards body.",
    targetCustomerLabel: "Target",
    rankingLabel: "Ranking",
    overallScoreLabel: "Overall score",
  },
  Turkish: {
    marketInfrastructureTitle: "Pazar Altyapısı",
    pricingEvidenceLabel: "Fiyatlandırma kanıtı",
    competitorComparisonTitle: "Doğrulanmış rakip karşılaştırması",
    majorPlayersTitle: "Kanıt destekli başlıca oyuncular",
    insufficientMajorPlayers:
      "Başlıca Oyuncular sıralaması için bağımsız kanıt yetersiz; doğrulanmış ticari satıcılar Rekabet Ortamı bölümünde yer almaya devam ediyor.",
    verifiedMarketSizeTitle: "Doğrulanmış pazar büyüklüğü kanıtı",
    marketSizeBaselineLabel: "Pazar / Sektör Temel Değeri — Bu İş İçin Henüz TAM Olarak Doğrulanmadı",
    marketSizeBaselineExplanation:
      "Bu rakam, daha geniş sektör veya hizmet kategorisi için doğrulanmış bir toplamdır; bu raporda talep edilen özel iş kapsamı için otomatik olarak doğrulanmış bir Toplam Adreslenebilir Pazar (TAM) değeri değildir. Daha geniş bir temel değerin TAM'a yükseltilmesi, talep edilen coğrafya, müşteri segmenti ve ürün/hizmet tanımının bu kanıt tarafından gerçekten kapsandığının bağımsız olarak doğrulanmasını gerektirir. Bu belirleme için aşağıdaki TAM / SAM / SOM bölümüne bakın.",
    planningEstimateTitle: "Planlama Tahmini — dış kaynakla doğrulanmış pazar büyüklüğü değildir",
    formulaLabel: "Formül",
    confidenceLabel: "Güven",
    tamSamSomUnavailable:
      "Bu pazar için doğrulanmış bir TAM / SAM / SOM rakamı belirlenemedi. Etiketli bir tahmin oluşturmak için karşılaştırılabilir yerel, bölgesel veya küresel bir referans veri bulunamadı; alıcı nüfusu ve fiyatlandırmaya dair mevcut veriler de birlikte yeterli değildi. Bu boşluk, fırsatın büyüklüğünü değil, bu kapsam için yayımlanmış veri eksikliğini yansıtır. Tespit edilen tedarikçi sayısı tek başına bir pazar büyüklüğü rakamı üretmek için kullanılmamıştır.",
    marketSizeUnavailable:
      "Bu pazar için savunulabilir bir toplam pazar büyüklüğü rakamı belirlenemedi. Doğrulanmış bir yerel rakam, karşılaştırılabilir bir referans veri veya yeterli alıcı nüfusu ve fiyatlandırma verisi bulunamadı. Araştırma sırasında bulunan fiyatlandırma, ARPA, yıllık sözleşme değeri veya ödeme isteği gibi müşteri başına rakamlar, tek bir alıcının harcamasını yansıtır, toplam pazarı değil; burada pazar büyüklüğü rakamı olarak asla yerine konmamıştır.",
    marketSizePlanningEstimateLine: "Pazar Büyüklüğü",
    adjacentPlayersTitle: "İlgili Sektör Oyuncuları — Doğrudan Rakip Olarak Bağımsız Şekilde Doğrulanmamıştır",
    adjacentPlayersIntro:
      "Bu şirketler mevcut kanıtlarda bu pazarda veya bu pazara yakın alanlarda faaliyet gösterdiği belirtilen şirketlerdir; ancak mevcut kanıtlar bunları doğrudan karşılaştırılabilir rakipler olarak bağımsız şekilde doğrulamamaktadır. Doğrudan rakip doğrulama durumu için Rekabet Ortamı bölümüne bakın.",
    adjacentPlayerValidationGapLabel: "Mevcut kanıtlarla doğrudan bir rakip olarak bağımsız şekilde doğrulanmamıştır",
    tableHeader:
      "| Tedarikçi | Ana Şirket | Kategori | Segment | Yapay Zeka Yeteneği | Temel Kullanım Alanları | Fiyatlandırma Modeli | Güçlü Yönler | Zayıf Yönler | Doğrulama Sayısı | Güven | Pazar Uygunluğu |",
    notEstablished: "Kamuya açık kaynaklarda belirtilmemiş",
    notPubliclyValidated: "Bağımsız olarak teyit edilmemiş",
    notProvided: "Belirtilmemiş",
    publisherLabel: "Yayıncı",
    publishedLabel: "Yayın tarihi",
    accessedLabel: "Erişim tarihi",
    sourceTypeLabel: "Kaynak türü",
    classificationLabel: "Sınıflandırma",
    claimLinkageLabel: "İddia bağlantısı",
    sourcesTitle: "Kaynaklar",
    noVerifiableSourcesText:
      "Bu raporda bağımsız olarak doğrulanabilir bir kaynak kullanılmadı.",
    competitorClaimAdjacentReframeTemplate:
      "%NAMES% bu pazarda ilgili/platform oyuncuları olarak izlenmektedir; mevcut kanıtlar bunları doğrudan, birebir rakip olarak bağımsız şekilde doğrulamamaktadır.",
    competitorClaimUnsupportedReplacement:
      "Belirli isimli rakipler mevcut kanıtlarla bağımsız şekilde doğrulanamadı; burada tartışılan rekabet baskısı genel pazar yapısını yansıtır, doğrulanmış bir rakip iddiasını değil.",
    basisLabel: "Temel",
    evidenceLabel: "Kanıt",
    assumptionOnlyScenario: "sadece varsayıma dayalı senaryo",
    verifiedTag: "Doğrulanmış",
    estimatedTag: "Tahmini",
    assumptionTag: "Varsayım",
    noValidatedPricingEvidence: "Fiyatlandırma bilgisi kamuya açık değil",
    noValidatedStrengthEvidence: "Kamuya açık kaynaklarda belirgin bir güçlü yön bulunmuyor",
    noValidatedWeaknessEvidence: "Kamuya açık kaynaklarda belirgin bir zayıf yön bulunmuyor",
    commercialVendorReasonTemplate: "%NAME%, %CATEGORY% ile doğrudan ilişkili kanıtlara sahip ticari bir ürün tedarikçisidir.",
    excludedVendorReasonTemplate: "Kanıtlar %NAME%'i bu pazarda ticari bir ürün tedarikçisi değil; bir uygulama ortağı, pazaryeri, dış kaynaklı hizmet sağlayıcısı veya danışmanlık firması olarak tanımlıyor.",
    entityTypeGovernment: "kamu kurumu",
    entityTypeRegulator: "düzenleyici kurum",
    entityTypeStandardsBody: "standart/birlik kuruluşu",
    reasonRegulator: "Düzenleyici kurum, başvuru platformu veya kamuyu aydınlatma sistemi.",
    reasonGovernment: "Kamu kurumu veya resmi devlet alan adı.",
    reasonStandardsBody: "Ticaret birliği, fuar organizatörü veya mesleki/teknik standart kuruluşu.",
    targetCustomerLabel: "Hedef müşteri",
    rankingLabel: "Sıralama",
    overallScoreLabel: "Genel skor",
  },
  German: {
    marketInfrastructureTitle: "Marktinfrastruktur",
    pricingEvidenceLabel: "Preisnachweis",
    competitorComparisonTitle: "Validierter Wettbewerbervergleich",
    majorPlayersTitle: "Durch Nachweise gestützte Hauptakteure",
    insufficientMajorPlayers:
      "Unzureichende unabhängige Nachweise für die Rangliste der Hauptakteure; validierte kommerzielle Anbieter sind weiterhin in der Wettbewerbslandschaft verfügbar.",
    verifiedMarketSizeTitle: "Verifizierter Nachweis zur Marktgröße",
    marketSizeBaselineLabel: "Markt-/Branchenbasiswert — Noch nicht als TAM für dieses Geschäft validiert",
    marketSizeBaselineExplanation:
      "Dies ist ein verifizierter Gesamtwert für die breitere Branche oder Dienstleistungskategorie, kein automatisch validierter Total Addressable Market (TAM) für den in diesem Bericht angeforderten spezifischen Geschäftsumfang. Die Hochstufung eines breiteren Basiswerts zu TAM erfordert die unabhängige Bestätigung, dass die angeforderte Geografie, das Kundensegment und die Produkt-/Dienstleistungsdefinition tatsächlich von diesem Nachweis abgedeckt werden. Siehe TAM / SAM / SOM unten für diese Feststellung.",
    planningEstimateTitle: "Planungsschätzung — keine extern verifizierte Marktgröße",
    formulaLabel: "Formel",
    confidenceLabel: "Konfidenz",
    tamSamSomUnavailable:
      "Für diesen Markt konnte kein verifizierter TAM-/SAM-/SOM-Wert ermittelt werden. Es lag weder ein vergleichbarer lokaler, regionaler oder globaler Referenzwert vor, um daraus eine gekennzeichnete Schätzung abzuleiten, noch reichten die verfügbaren Daten zu Käuferpopulation und Preisgestaltung gemeinsam aus, um eine eigene Schätzung zu erstellen. Diese Lücke spiegelt das Fehlen veröffentlichter Daten für diesen konkreten Rahmen wider, nicht die Größe der Chance. Die Anzahl der identifizierten Anbieter allein wurde nicht verwendet, um eine Marktgröße zu erfinden.",
    marketSizeUnavailable:
      "Für diesen Markt konnte keine belastbare aggregierte Marktgröße ermittelt werden. Es lag weder ein verifizierter lokaler Wert noch ein vergleichbarer Referenzwert oder ausreichende Daten zu Käuferpopulation und Preisgestaltung vor. Kennzahlen pro Kunde wie Preisgestaltung, ARPA, Vertragswert oder Zahlungsbereitschaft aus der Recherche spiegeln die Ausgaben eines einzelnen Käufers wider, nicht den Gesamtmarkt, und wurden hier nie als Marktgröße eingesetzt.",
    marketSizePlanningEstimateLine: "Marktgröße",
    adjacentPlayersTitle: "Relevante Branchenakteure — nicht unabhängig als direkte Wettbewerber validiert",
    adjacentPlayersIntro:
      "Diese Unternehmen werden in den verfügbaren Nachweisen als in diesem Markt oder angrenzend daran aktiv genannt, aber die verfügbaren Nachweise bestätigen sie nicht unabhängig als direkt vergleichbare Wettbewerber. Den Validierungsstatus direkter Wettbewerber finden Sie unter Wettbewerbsumfeld.",
    adjacentPlayerValidationGapLabel: "Mit den aktuellen Nachweisen nicht unabhängig als direkter Wettbewerber validiert",
    tableHeader:
      "| Anbieter | Muttergesellschaft | Kategorie | Segment | KI-Fähigkeit | Wichtigste Anwendungsfälle | Preismodell | Stärken | Schwächen | Validierungsanzahl | Konfidenz | Marktrelevanz |",
    notEstablished: "In öffentlichen Quellen nicht angegeben",
    notPubliclyValidated: "Nicht unabhängig bestätigt",
    notProvided: "Nicht angegeben",
    publisherLabel: "Herausgeber",
    publishedLabel: "Veröffentlicht",
    accessedLabel: "Zugegriffen",
    sourceTypeLabel: "Quellentyp",
    classificationLabel: "Klassifizierung",
    claimLinkageLabel: "Aussagenbezug",
    sourcesTitle: "Quellen",
    noVerifiableSourcesText:
      "In diesem Bericht wurden keine unabhängig überprüfbaren Quellen verwendet.",
    competitorClaimAdjacentReframeTemplate:
      "%NAMES%: in diesem Markt als angrenzende Plattformpräsenz geführt, mit aktuellen Nachweisen nicht unabhängig als direkter Wettbewerber bestätigt.",
    competitorClaimUnsupportedReplacement:
      "Konkret genannte Konkurrenten konnten mit aktuellen Nachweisen nicht unabhängig bestätigt werden; hier beschriebener Wettbewerbsdruck spiegelt die allgemeine Marktstruktur wider, keine bestätigte Wettbewerberaussage.",
    basisLabel: "Grundlage",
    evidenceLabel: "Nachweis",
    assumptionOnlyScenario: "reines Annahmenszenario",
    verifiedTag: "Verifiziert",
    estimatedTag: "Geschätzt",
    assumptionTag: "Annahme",
    noValidatedPricingEvidence: "Preisinformationen nicht öffentlich verfügbar",
    noValidatedStrengthEvidence: "Keine erkennbare Stärke in öffentlichen Quellen",
    noValidatedWeaknessEvidence: "Keine erkennbare Schwäche in öffentlichen Quellen",
    commercialVendorReasonTemplate: "%NAME% ist ein kommerzieller Produktanbieter mit Nachweisen, die direkt mit %CATEGORY% verbunden sind.",
    excludedVendorReasonTemplate: "%NAME% wird durch die Nachweise als Implementierungspartner, Marktplatz, ausgelagerter Dienstleister oder Beratungsunternehmen identifiziert, nicht als kommerzieller Produktanbieter in diesem Markt.",
    entityTypeGovernment: "Regierungsbehörde",
    entityTypeRegulator: "Aufsichtsbehörde",
    entityTypeStandardsBody: "Normungsorganisation",
    reasonRegulator: "Aufsichtsbehörde, Meldeplattform oder Offenlegungssystem.",
    reasonGovernment: "Regierungsbehörde oder offizielle Regierungsdomain.",
    reasonStandardsBody: "Handelsverband, Messeveranstalter oder fachliche/technische Normungsorganisation.",
    targetCustomerLabel: "Zielkunde",
    rankingLabel: "Rang",
    overallScoreLabel: "Gesamtbewertung",
  },
  French: {
    marketInfrastructureTitle: "Infrastructure du marché",
    pricingEvidenceLabel: "Preuve tarifaire",
    competitorComparisonTitle: "Comparaison validée des concurrents",
    majorPlayersTitle: "Principaux acteurs étayés par des preuves",
    insufficientMajorPlayers:
      "Preuves indépendantes insuffisantes pour le classement des principaux acteurs ; les fournisseurs commerciaux validés restent disponibles dans le paysage concurrentiel.",
    verifiedMarketSizeTitle: "Preuve vérifiée de la taille du marché",
    marketSizeBaselineLabel: "Référence marché/secteur — Pas encore validée comme TAM pour cette activité",
    marketSizeBaselineExplanation:
      "Il s'agit d'un total vérifié pour la catégorie industrielle ou de services au sens large, et non d'un marché total adressable (TAM) automatiquement validé pour le périmètre commercial spécifique demandé dans ce rapport. La promotion d'une référence plus large en TAM nécessite de confirmer indépendamment que la géographie, le segment de clientèle et la définition du produit/service demandés sont bien couverts par ces preuves. Voir TAM / SAM / SOM ci-dessous pour cette détermination.",
    planningEstimateTitle: "Estimation de planification — taille de marché non vérifiée en externe",
    formulaLabel: "Formule",
    confidenceLabel: "Confiance",
    tamSamSomUnavailable:
      "Aucun chiffre TAM / SAM / SOM vérifié n'a pu être établi pour ce marché. Aucune référence locale, régionale ou mondiale comparable n'était disponible pour construire une estimation clairement indiquée, et les données disponibles sur la population d'acheteurs et la tarification n'étaient pas non plus suffisantes ensemble pour en construire une. Cet écart reflète l'absence de données publiées pour ce périmètre précis, et non la taille de l'opportunité. Le nombre de fournisseurs identifiés seul n'a pas été utilisé pour fabriquer un chiffre de taille de marché.",
    marketSizeUnavailable:
      "Aucun chiffre de taille de marché agrégé et défendable n'a pu être établi pour ce marché. Aucun chiffre local vérifié, référence comparable, ou données suffisantes sur la population d'acheteurs et la tarification n'étaient disponibles. Les chiffres par client tels que la tarification, l'ARPA, la valeur contractuelle annuelle ou la disposition à payer identifiés durant la recherche reflètent la dépense d'un seul acheteur, pas le marché total, et n'ont jamais été substitués ici comme taille de marché.",
    marketSizePlanningEstimateLine: "Taille du marché",
    adjacentPlayersTitle: "Acteurs sectoriels pertinents — non validés indépendamment comme concurrents directs",
    adjacentPlayersIntro:
      "Ces entreprises sont citées dans les preuves disponibles comme actives dans ce marché ou à proximité, mais les preuves disponibles ne les corroborent pas de manière indépendante comme des concurrents directement comparables. Consultez la section Paysage concurrentiel pour le statut de validation des concurrents directs.",
    adjacentPlayerValidationGapLabel: "Non validé de manière indépendante comme concurrent direct avec les preuves actuelles",
    tableHeader:
      "| Fournisseur | Société mère | Catégorie | Segment | Capacité IA | Cas d'usage clés | Modèle tarifaire | Forces | Faiblesses | Nombre de validations | Confiance | Pertinence pour le marché |",
    notEstablished: "Non indiqué dans les sources publiques",
    notPubliclyValidated: "Non confirmé de manière indépendante",
    notProvided: "Non indiqué",
    publisherLabel: "Éditeur",
    publishedLabel: "Publié",
    accessedLabel: "Consulté",
    sourceTypeLabel: "Type de source",
    classificationLabel: "Classification",
    claimLinkageLabel: "Lien avec l'affirmation",
    sourcesTitle: "Sources",
    noVerifiableSourcesText:
      "Aucune source vérifiable de manière indépendante n'a été utilisée dans ce rapport.",
    competitorClaimAdjacentReframeTemplate:
      "%NAMES% : suivi(s) comme acteur(s) adjacent(s)/de plateforme sur ce marché, non validé(s) de manière indépendante comme concurrent(s) direct(s) avec les preuves actuelles.",
    competitorClaimUnsupportedReplacement:
      "Des concurrents nommément désignés n'ont pas pu être validés de manière indépendante avec les preuves actuelles ; la pression concurrentielle évoquée ici reflète la structure générale du marché, non une allégation de concurrent confirmée.",
    basisLabel: "Base",
    evidenceLabel: "Preuve",
    assumptionOnlyScenario: "scénario basé uniquement sur des hypothèses",
    verifiedTag: "Vérifié",
    estimatedTag: "Estimé",
    assumptionTag: "Hypothèse",
    noValidatedPricingEvidence: "Tarification non communiquée publiquement",
    noValidatedStrengthEvidence: "Aucun point fort identifiable dans les sources publiques",
    noValidatedWeaknessEvidence: "Aucun point faible identifiable dans les sources publiques",
    commercialVendorReasonTemplate: "%NAME% est un fournisseur de produits commerciaux avec des preuves directement liées à %CATEGORY%.",
    excludedVendorReasonTemplate: "%NAME% est identifié par les preuves comme un partenaire de mise en œuvre, une place de marché, un prestataire de services externalisé ou un cabinet de conseil plutôt qu'un fournisseur de produits commerciaux sur ce marché.",
    entityTypeGovernment: "organisme public",
    entityTypeRegulator: "organisme de régulation",
    entityTypeStandardsBody: "organisme de normalisation",
    reasonRegulator: "Autorité de régulation, plateforme de dépôt ou système de divulgation.",
    reasonGovernment: "Entité gouvernementale ou domaine gouvernemental officiel.",
    reasonStandardsBody: "Association professionnelle, organisateur de salons ou organisme de normalisation technique.",
    targetCustomerLabel: "Cible",
    rankingLabel: "Classement",
    overallScoreLabel: "Score global",
  },
  Spanish: {
    marketInfrastructureTitle: "Infraestructura del mercado",
    pricingEvidenceLabel: "Evidencia de precios",
    competitorComparisonTitle: "Comparación validada de competidores",
    majorPlayersTitle: "Principales actores respaldados por evidencia",
    insufficientMajorPlayers:
      "Evidencia independiente insuficiente para la clasificación de los principales actores; los proveedores comerciales validados siguen disponibles en el panorama competitivo.",
    verifiedMarketSizeTitle: "Evidencia verificada del tamaño del mercado",
    marketSizeBaselineLabel: "Referencia de mercado/industria — Aún no validada como TAM para este negocio",
    marketSizeBaselineExplanation:
      "Esta cifra es un total verificado para la categoría industrial o de servicios más amplia, no un Mercado Total Direccionable (TAM) validado automáticamente para el alcance de negocio específico solicitado en este informe. Promover una referencia más amplia a TAM requiere confirmar de forma independiente que la geografía, el segmento de clientes y la definición de producto/servicio solicitados están realmente cubiertos por esta evidencia. Consulte TAM / SAM / SOM más abajo para esa determinación.",
    planningEstimateTitle: "Estimación de planificación — tamaño de mercado no verificado externamente",
    formulaLabel: "Fórmula",
    confidenceLabel: "Confianza",
    tamSamSomUnavailable:
      "No se pudo establecer una cifra verificada de TAM / SAM / SOM para este mercado. No había una referencia local, regional o global comparable para construir una estimación claramente etiquetada, y los datos disponibles sobre población de compradores y precios tampoco fueron suficientes en conjunto para construir una. Esta brecha refleja la falta de datos publicados para este alcance específico, no el tamaño de la oportunidad. El número de proveedores identificados por sí solo no se utilizó para fabricar una cifra de tamaño de mercado.",
    marketSizeUnavailable:
      "No se pudo establecer una cifra de tamaño de mercado agregada y defendible para este mercado. No había una cifra local verificada, una referencia comparable, ni datos suficientes sobre población de compradores y precios. Las cifras por cliente como precios, ARPA, valor de contrato anual o disposición a pagar encontradas durante la investigación reflejan el gasto de un solo comprador, no el mercado total, y nunca se sustituyeron aquí como tamaño de mercado.",
    marketSizePlanningEstimateLine: "Tamaño del mercado",
    adjacentPlayersTitle: "Actores del sector relevantes — no validados de forma independiente como competidores directos",
    adjacentPlayersIntro:
      "Estas empresas se mencionan en la evidencia disponible como activas en este mercado o cerca de él, pero la evidencia disponible no las corrobora de forma independiente como competidores directamente comparables. Consulte la sección Panorama competitivo para conocer el estado de validación de los competidores directos.",
    adjacentPlayerValidationGapLabel: "No validado de forma independiente como competidor directo con la evidencia actual",
    tableHeader:
      "| Proveedor | Empresa matriz | Categoría | Segmento | Capacidad de IA | Casos de uso clave | Modelo de precios | Fortalezas | Debilidades | Cantidad de validación | Confianza | Relevancia para el mercado |",
    notEstablished: "No indicado en fuentes públicas",
    notPubliclyValidated: "No confirmado de forma independiente",
    notProvided: "No indicado",
    publisherLabel: "Editor",
    publishedLabel: "Publicado",
    accessedLabel: "Consultado",
    sourceTypeLabel: "Tipo de fuente",
    classificationLabel: "Clasificación",
    claimLinkageLabel: "Vínculo con la afirmación",
    sourcesTitle: "Fuentes",
    noVerifiableSourcesText:
      "No se utilizaron fuentes verificables de forma independiente en este informe.",
    competitorClaimAdjacentReframeTemplate:
      "%NAMES%: registrado(s) como presencia adyacente/de plataforma en este mercado, no validado(s) de forma independiente como competidor(es) directo(s) con la evidencia actual.",
    competitorClaimUnsupportedReplacement:
      "No se pudieron validar de forma independiente competidores específicos con la evidencia actual; la presión competitiva mencionada aquí refleja la estructura general del mercado, no una afirmación de competidor confirmada.",
    basisLabel: "Base",
    evidenceLabel: "Evidencia",
    assumptionOnlyScenario: "escenario basado únicamente en suposiciones",
    verifiedTag: "Verificado",
    estimatedTag: "Estimado",
    assumptionTag: "Suposición",
    noValidatedPricingEvidence: "Precios no disponibles públicamente",
    noValidatedStrengthEvidence: "Sin fortaleza distintiva identificada en fuentes públicas",
    noValidatedWeaknessEvidence: "Sin debilidad distintiva identificada en fuentes públicas",
    commercialVendorReasonTemplate: "%NAME% es un proveedor de productos comerciales con evidencia directamente vinculada a %CATEGORY%.",
    excludedVendorReasonTemplate: "La evidencia identifica a %NAME% como un socio de implementación, mercado, proveedor de servicios subcontratado o firma consultora, no como un proveedor de productos comerciales en este mercado.",
    entityTypeGovernment: "entidad gubernamental",
    entityTypeRegulator: "organismo regulador",
    entityTypeStandardsBody: "organismo de normalización",
    reasonRegulator: "Autoridad reguladora, plataforma de presentación o sistema de divulgación.",
    reasonGovernment: "Entidad gubernamental o dominio gubernamental oficial.",
    reasonStandardsBody: "Asociación comercial, organizador de ferias u organismo de normalización profesional/técnica.",
    targetCustomerLabel: "Cliente objetivo",
    rankingLabel: "Clasificación",
    overallScoreLabel: "Puntuación general",
  },
};

function copyLanguage(language: string): MarketGraphLanguage {
  return language in marketGraphCopy ? (language as MarketGraphLanguage) : "English";
}

function classificationTag(language: string, classification: "Verified" | "Estimated" | "Assumption") {
  const copy = marketGraphCopy[copyLanguage(language)];
  if (classification === "Verified") return copy.verifiedTag;
  if (classification === "Estimated") return copy.estimatedTag;
  return copy.assumptionTag;
}

function marketTableCell(value: string) {
  return value.replace(/\|/g, "/").replace(/\s+/g, " ").trim();
}

// Natural-language, localized explanation of competitive-evidence coverage
// -- replaces a raw internal-diagnostics dump (candidate counts, packed
// discovery queries, "no vendor mentions passed validation") that used to
// be spliced directly into competitiveLandscape/majorPlayers. Built here
// (not in vendor-intelligence.ts) because this is the one place both the
// report's target language and the raw coverage numbers are in scope.
function describeCompetitiveCoverage(
  language: MarketGraphLanguage,
  coverage: { vendorCount: number; independentProviderSources: number; sufficient: boolean },
  adjacentPlayerCount = 0
): string {
  const { vendorCount, independentProviderSources, sufficient } = coverage;

  // CRITICAL FIX -- confirmed live: when no direct competitor validated
  // but adjacent/platform players ARE evidenced (vendor-intelligence.ts's
  // adjacentPlayers), the generic "information was limited" text below
  // read as a flat "nothing was found" -- true for direct competitors,
  // but misleading given real, evidence-supported adjacent players exist
  // and are named in Major Players immediately below this section. States
  // the distinction explicitly instead of leaving the reader to notice
  // the contradiction between this section's tone and Major Players'
  // actual content.
  // P0 PRODUCTION FIX -- confirmed live (Market Intelligence production
  // consistency hardening): this branch already avoided the flat "no
  // competitor data could be validated" claim, but its wording framed
  // the gap as competitor IDENTITY being unvalidated -- misleading when
  // the incumbents themselves are evidence-supported (named in Major
  // Players below) and the actual gap is that there isn't enough
  // STRUCTURED positioning/comparison data (category, strengths,
  // weaknesses, market-share, pricing) to build a defensible
  // competitor-vs-competitor landscape or market map. Reworded to state
  // that distinction explicitly -- never manufactures the missing
  // positioning data itself, which stays absent from the table exactly
  // as before.
  if (vendorCount === 0 && adjacentPlayerCount > 0) {
    return {
      English:
        "Major incumbents in this market are evidence-supported -- see Major Players below -- but insufficient structured positioning data (category, strengths, weaknesses, market share, or pricing) is available to build a defensible direct-competitor landscape or market map here.",
      Turkish:
        "Bu pazardaki başlıca yerleşik oyuncular kanıt destekli -- aşağıdaki Önemli Oyuncular bölümüne bakın -- ancak burada savunulabilir bir doğrudan rakip haritası veya pazar haritası oluşturmak için yeterli yapılandırılmış konumlandırma verisi (kategori, güçlü/zayıf yönler, pazar payı veya fiyatlandırma) bulunmuyor.",
      German:
        "Die wichtigsten etablierten Akteure in diesem Markt sind evidenzgestützt -- siehe Wichtige Akteure unten -- es liegen jedoch nicht genügend strukturierte Positionierungsdaten (Kategorie, Stärken, Schwächen, Marktanteil oder Preisgestaltung) vor, um hier eine belastbare direkte Wettbewerbslandschaft oder Marktkarte zu erstellen.",
      French:
        "Les principaux acteurs historiques de ce marché sont étayés par des preuves -- voir Acteurs majeurs ci-dessous -- mais les données de positionnement structurées (catégorie, forces, faiblesses, part de marché ou tarification) sont insuffisantes pour établir ici un paysage concurrentiel direct ou une carte de marché défendable.",
      Spanish:
        "Los principales actores establecidos en este mercado cuentan con respaldo de evidencia -- consulte Actores principales a continuación -- pero no hay suficientes datos de posicionamiento estructurados (categoría, fortalezas, debilidades, cuota de mercado o precios) disponibles para construir aquí un panorama competitivo directo o un mapa de mercado defendible.",
    }[language];
  }

  if (sufficient) {
    return {
      English: `Confirmed by independent, publicly available sources covering ${vendorCount} named competitors across ${independentProviderSources} independent sources.`,
      Turkish: `${vendorCount} isimli rakip, ${independentProviderSources} bağımsız kaynak genelinde bağımsız ve kamuya açık kaynaklarla doğrulanmıştır.`,
      German: `Bestätigt durch unabhängige, öffentlich verfügbare Quellen zu ${vendorCount} namentlich genannten Wettbewerbern über ${independentProviderSources} unabhängige Quellen.`,
      French: `Confirmé par des sources indépendantes et publiquement disponibles couvrant ${vendorCount} concurrents nommés sur ${independentProviderSources} sources indépendantes.`,
      Spanish: `Confirmado por fuentes independientes y disponibles públicamente que cubren ${vendorCount} competidores nombrados en ${independentProviderSources} fuentes independientes.`,
    }[language];
  }

  if (vendorCount === 0) {
    return {
      English:
        "Independent, publicly available information on named competitors in this market was limited during research. Competitive intensity below is inferred from category-level and structural evidence rather than confirmed vendor profiles -- this narrows confidence in company-specific claims but does not indicate an absence of competition.",
      Turkish:
        "Yeterli doğrulanmış ticari rakip bulunamadı. Bu pazardaki isimli rakiplere ilişkin bağımsız ve kamuya açık bilgi, araştırma sırasında sınırlı kalmıştır. Aşağıdaki rekabet yoğunluğu, doğrulanmış rakip profillerinden ziyade kategori düzeyindeki yapısal kanıtlardan çıkarılmıştır; bu durum şirkete özgü iddialara olan güveni azaltır, ancak rekabetin yokluğu anlamına gelmez.",
      German:
        "Unabhängige, öffentlich verfügbare Informationen zu namentlich genannten Wettbewerbern in diesem Markt waren während der Recherche begrenzt. Die untenstehende Wettbewerbsintensität wird aus kategorieweiter, struktureller Evidenz abgeleitet und nicht aus bestätigten Anbieterprofilen -- dies verringert das Vertrauen in unternehmensspezifische Aussagen, bedeutet aber nicht das Fehlen von Wettbewerb.",
      French:
        "Les informations indépendantes et accessibles au public sur les concurrents nommés de ce marché étaient limitées durant la recherche. L'intensité concurrentielle ci-dessous est déduite de preuves structurelles au niveau de la catégorie plutôt que de profils de fournisseurs confirmés -- cela réduit la confiance dans les affirmations propres à l'entreprise sans indiquer une absence de concurrence.",
      Spanish:
        "La información independiente y disponible públicamente sobre competidores nombrados en este mercado fue limitada durante la investigación. La intensidad competitiva a continuación se infiere de evidencia estructural a nivel de categoría en lugar de perfiles de proveedores confirmados; esto reduce la confianza en afirmaciones específicas de la empresa, pero no indica ausencia de competencia.",
    }[language];
  }

  return {
    English: `Only ${vendorCount} named competitors could be independently confirmed from public sources (target: 5+), across ${independentProviderSources} independent sources. Competitive intensity is directionally reliable, but company-specific detail below should be read with that limitation in mind.`,
    Turkish: `Kamuya açık kaynaklardan bağımsız olarak yalnızca ${vendorCount} isimli rakip doğrulanabilmiştir (hedef: 5+), ${independentProviderSources} bağımsız kaynak genelinde. Rekabet yoğunluğu yönü itibarıyla güvenilirdir, ancak aşağıdaki şirkete özgü detaylar bu sınırlama göz önünde bulundurularak okunmalıdır.`,
    German: `Aus öffentlichen Quellen konnten unabhängig nur ${vendorCount} namentlich genannte Wettbewerber bestätigt werden (Ziel: 5+), über ${independentProviderSources} unabhängige Quellen. Die Wettbewerbsintensität ist richtungsweisend verlässlich, die unternehmensspezifischen Details unten sollten jedoch unter Berücksichtigung dieser Einschränkung gelesen werden.`,
    French: `Seuls ${vendorCount} concurrents nommés ont pu être confirmés indépendamment à partir de sources publiques (objectif : 5+), sur ${independentProviderSources} sources indépendantes. L'intensité concurrentielle est directionnellement fiable, mais les détails spécifiques à l'entreprise ci-dessous doivent être lus en tenant compte de cette limite.`,
    Spanish: `Solo se pudieron confirmar de forma independiente ${vendorCount} competidores nombrados a partir de fuentes públicas (objetivo: 5+), en ${independentProviderSources} fuentes independientes. La intensidad competitiva es direccionalmente confiable, pero el detalle específico de la empresa a continuación debe leerse teniendo en cuenta esa limitación.`,
  }[language];
}

// vendor-intelligence.ts's field builders have no concept of report
// language (they run before language is known) and fall back to fixed
// English sentinel strings when evidence is missing -- confirmed live in
// a Turkish report as "Not established by validated evidence" and "No
// validated weakness evidence" rendered verbatim inside an otherwise
// Turkish competitor table. Translating the known sentinel values here,
// at the one place the target language and the raw graph are both in
// scope, is cheaper and lower-risk than threading a language parameter
// through the whole vendor-discovery pipeline for values that never
// carry real information beyond "this wasn't found."
function localizeVendorFallbackText(
  value: string,
  copy: Record<MarketGraphCopyKey, string>
): string {
  if (value === "Not established by validated evidence") return copy.notEstablished;
  if (value === "No validated public pricing evidence") return copy.noValidatedPricingEvidence;
  if (value === "No validated strength evidence") return copy.noValidatedStrengthEvidence;
  if (value === "No validated weakness evidence") return copy.noValidatedWeaknessEvidence;
  return value;
}

const commercialVendorReasonPattern =
  /^(.+?) is a commercial product vendor with evidence directly tied to (.+?)\.$/;
const excludedVendorReasonPattern =
  /^Excluded: evidence identifies (.+?) as an implementation partner, marketplace, outsourced service provider, or advisory firm rather than a commercial product vendor in this market\.$/;

// assessMarketRelevance (vendor-discovery.ts) builds vendor.marketRelevance
// as an English sentence with the vendor name and category interpolated,
// for the same no-language-context reason as above -- confirmed live as
// the literal phrase "commercial product vendor" appearing in a Turkish
// competitor table's last column. Both known sentence shapes are
// reconstructed here from their own interpolated pieces rather than
// translated word-for-word, since the vendor name and category must stay
// exactly as evidence identified them.
function localizeMarketRelevanceReason(
  reason: string,
  copy: Record<MarketGraphCopyKey, string>
): string {
  const relevantMatch = reason.match(commercialVendorReasonPattern);
  if (relevantMatch) {
    return copy.commercialVendorReasonTemplate
      .replace("%NAME%", relevantMatch[1])
      .replace("%CATEGORY%", relevantMatch[2]);
  }

  const excludedMatch = reason.match(excludedVendorReasonPattern);
  if (excludedMatch) {
    return copy.excludedVendorReasonTemplate.replace("%NAME%", excludedMatch[1]);
  }

  return reason;
}

// vendor-intelligence.ts's pricing-model classifier (extractPricingModels)
// and its AI-capability tag are, like its other field builders, computed
// with no concept of report language and hardcode fixed English labels
// (VendorPricingModel's 13 literal values, plus the AI-capability tag) --
// rendered verbatim into the competitor table (vendor.pricingModels.join,
// vendor.aiCapability) with no localization call at all, unlike
// strength/weakness/marketRelevance which already route through
// localizeVendorFallbackText/localizeMarketRelevanceReason. A standalone
// per-language lookup, not routed through MarketGraphCopyKey, since these
// ~13 short tags are a closed set specific to this one rendering site.
const vendorPricingModelLabels: Record<MarketGraphLanguage, Record<string, string>> = {
  English: {
    Subscription: "Subscription",
    "Seat pricing": "Seat pricing",
    "Usage pricing": "Usage-based pricing",
    Enterprise: "Enterprise pricing",
    Transaction: "Transaction-based pricing",
    "Success fee": "Success fee",
    Hybrid: "Hybrid pricing",
    "Public list price": "Public list price",
    "Quote-based": "Quote-based pricing",
    "Per user": "Per-user pricing",
    "Per company": "Per-company pricing",
    "Per document": "Per-document pricing",
    "Services included": "Services included",
  },
  Turkish: {
    Subscription: "Abonelik",
    "Seat pricing": "Kullanıcı başına fiyatlandırma",
    "Usage pricing": "Kullanım bazlı fiyatlandırma",
    Enterprise: "Kurumsal fiyatlandırma",
    Transaction: "İşlem bazlı fiyatlandırma",
    "Success fee": "Başarı ücreti",
    Hybrid: "Hibrit fiyatlandırma",
    "Public list price": "Kamuya açık liste fiyatı",
    "Quote-based": "Teklife dayalı fiyatlandırma",
    "Per user": "Kullanıcı başına",
    "Per company": "Şirket başına",
    "Per document": "Belge başına",
    "Services included": "Hizmetler dahil",
  },
  German: {
    Subscription: "Abonnement",
    "Seat pricing": "Preise pro Nutzer",
    "Usage pricing": "Nutzungsbasierte Preise",
    Enterprise: "Unternehmenspreise",
    Transaction: "Transaktionsbasierte Preise",
    "Success fee": "Erfolgshonorar",
    Hybrid: "Hybride Preisgestaltung",
    "Public list price": "Öffentlicher Listenpreis",
    "Quote-based": "Angebotsbasierte Preise",
    "Per user": "Pro Nutzer",
    "Per company": "Pro Unternehmen",
    "Per document": "Pro Dokument",
    "Services included": "Leistungen inbegriffen",
  },
  French: {
    Subscription: "Abonnement",
    "Seat pricing": "Tarification par utilisateur",
    "Usage pricing": "Tarification à l'usage",
    Enterprise: "Tarification entreprise",
    Transaction: "Tarification par transaction",
    "Success fee": "Commission au succès",
    Hybrid: "Tarification hybride",
    "Public list price": "Prix catalogue public",
    "Quote-based": "Tarification sur devis",
    "Per user": "Par utilisateur",
    "Per company": "Par entreprise",
    "Per document": "Par document",
    "Services included": "Services inclus",
  },
  Spanish: {
    Subscription: "Suscripción",
    "Seat pricing": "Precio por usuario",
    "Usage pricing": "Precio basado en el uso",
    Enterprise: "Precio empresarial",
    Transaction: "Precio por transacción",
    "Success fee": "Tarifa de éxito",
    Hybrid: "Precio híbrido",
    "Public list price": "Precio de lista público",
    "Quote-based": "Precio bajo cotización",
    "Per user": "Por usuario",
    "Per company": "Por empresa",
    "Per document": "Por documento",
    "Services included": "Servicios incluidos",
  },
};

function localizeVendorPricingModel(model: string, language: MarketGraphLanguage): string {
  return vendorPricingModelLabels[language][model] || model;
}

function localizeVendorPricingModelList(
  models: readonly string[],
  language: MarketGraphLanguage
): string {
  return models.map((model) => localizeVendorPricingModel(model, language)).join(", ");
}

const vendorAiCapabilityEnabledLabel: Record<MarketGraphLanguage, string> = {
  English: "AI-enabled (evidence-supported)",
  Turkish: "Yapay zeka destekli (kanıtla desteklenmiş)",
  German: "KI-gestützt (evidenzbasiert)",
  French: "Doté d'IA (étayé par des preuves)",
  Spanish: "Con IA (respaldado por evidencia)",
};

function localizeVendorAiCapability(
  value: string,
  language: MarketGraphLanguage,
  copy: Record<MarketGraphCopyKey, string>
): string {
  if (value === "AI-enabled (evidence-supported)") {
    return vendorAiCapabilityEnabledLabel[language];
  }
  return localizeVendorFallbackText(value, copy);
}

const institutionalEntityLabels: Record<string, MarketGraphCopyKey> = {
  government: "entityTypeGovernment",
  regulator: "entityTypeRegulator",
  standards_body: "entityTypeStandardsBody",
};

const institutionalEntityReasons: Record<string, MarketGraphCopyKey> = {
  "Regulatory authority, filing platform, or disclosure system.": "reasonRegulator",
  "Government entity or official government domain.": "reasonGovernment",
  "Trade association, exhibition organizer, or professional/technical standards body.":
    "reasonStandardsBody",
};

// Market Infrastructure only ever holds government/regulator/standards_body
// entities (commercial-vendor-intelligence.ts), each with one of exactly
// three fixed reason sentences -- a plain lookup, not a template, since
// none of them interpolate the entity's own name.
function localizeInstitutionalEntity(
  entityType: string,
  reason: string,
  copy: Record<MarketGraphCopyKey, string>
): { label: string; reason: string } {
  const labelKey = institutionalEntityLabels[entityType];
  const reasonKey = institutionalEntityReasons[reason];

  return {
    label: labelKey ? copy[labelKey] : entityType.replace(/_/g, " "),
    reason: reasonKey ? copy[reasonKey] : reason,
  };
}

/**
 * Produces the report fields that must remain identical to the final validated
 * graph. Model prose may enrich other sections, but it cannot replace these
 * evidence-owned competitors, calculations, classifications, or citations.
 */
export function projectMarketIntelligenceGraphToReport(
  graph: MarketIntelligenceGraph,
  language = "English"
): MarketIntelligenceReportProjection {
  const projection: MarketIntelligenceReportProjection = {};
  const vendorCoverage = graph.vendorIntelligence.coverage;

  const copy = marketGraphCopy[copyLanguage(language)];

  if (graph.vendorIntelligence.marketInfrastructure.length > 0) {
    projection.marketInfrastructure = [
      copy.marketInfrastructureTitle,
      ...graph.vendorIntelligence.marketInfrastructure.map((entity) => {
        const localized = localizeInstitutionalEntity(entity.entityType, entity.reason, copy);

        return `- ${entity.name} — ${localized.label} (${localized.reason}; ${entity.evidenceIds.map((id) => `[${id}]`).join(", ")})`;
      }),
    ].join("\n");
  }

  // Final, rendering-time gate: independent of every upstream discovery/
  // validation step above, no vendor whose name fails a basic real-company-
  // name shape check is ever allowed into the table or Major Players list --
  // confirmed live, this is what previously let prompt/instruction
  // fragments and evidence-provider domain labels reach the PDF even though
  // they had already passed discovery. If filtering drops every candidate,
  // this falls through to the same honest "insufficient evidence" copy as
  // having found zero competitors at all -- never a fabricated stand-in.
  const renderableVendors = graph.vendorIntelligence.vendors.filter(
    (vendor) => !isImplausibleCompetitorName(vendor.name)
  );

  if (renderableVendors.length > 0) {
    const competitorLines = renderableVendors.map(
      (vendor) =>
        `| ${marketTableCell(vendor.name)} | ${marketTableCell(vendor.parentCompany === vendor.name ? "-" : vendor.parentCompany)} | ${marketTableCell(vendor.category)} | ${marketTableCell(vendor.segment)} | ${marketTableCell(localizeVendorAiCapability(vendor.aiCapability, copyLanguage(language), copy))} | ${marketTableCell(vendor.keyUseCases.join("; ") || copy.notEstablished)} | ${marketTableCell(vendor.pricingModels.length ? localizeVendorPricingModelList(vendor.pricingModels, copyLanguage(language)) : copy.notPubliclyValidated)} | ${marketTableCell(localizeVendorFallbackText(vendor.strength, copy))} | ${marketTableCell(localizeVendorFallbackText(vendor.weakness, copy))} | ${vendor.evidenceCount} | ${vendor.confidence}/100 (${vendor.confidenceLevel}) | ${marketTableCell(localizeMarketRelevanceReason(vendor.marketRelevance, copy))} |`
    );
    const pricingLines = graph.pricingModels.map(
      (pricing) =>
        `- ${copy.pricingEvidenceLabel}: ${pricing.description} (${classificationTag(language, pricing.confidenceClassification)}; ${copy.confidenceLabel.toLowerCase()} ${pricing.confidenceScore}/100 ${pricing.confidenceLevel}; ${pricing.evidenceIds.map((id) => `[${id}]`).join(", ")})`
    );
    // P0 FIX -- confirmed live (COMPETITOR EXISTENCE vs MAJOR PLAYER
    // RANKING repair): graph.vendorIntelligence.adjacentPlayers used to be
    // read ONLY in the `else` branch below (zero validated direct
    // competitors). The moment even ONE candidate cleared the stricter
    // direct-competitor bar, every other real, evidence-named, relevant
    // company that didn't clear that same bar was silently discarded from
    // the ENTIRE report -- not shown in Competitive Landscape, not shown in
    // Major Players, not shown anywhere -- even though the underlying
    // evidence (same discovery pass, never a lower bar invented after the
    // fact) was identical to what the `else` branch already surfaces
    // honestly when it is the ONLY evidence available. Competitive
    // Landscape is the correct home for this tier: existence + relevance is
    // sufficient to appear here (see the type's own doc comment on
    // AdjacentMarketPlayer), it is never promoted into majorPlayers (which
    // stays exclusively eligibleForMajorPlayers-gated, unchanged below) and
    // never merged into the validated competitor table -- it is appended as
    // its own explicitly, honestly labeled tier so a reader can never read
    // it as a validated direct competitor.
    const adjacentPlayersAlongsideValidatedVendors = graph.vendorIntelligence.adjacentPlayers.filter(
      (player) => !isImplausibleCompetitorName(player.name)
    );
    projection.competitiveLandscape = [
      copy.competitorComparisonTitle,
      describeCompetitiveCoverage(copyLanguage(language), vendorCoverage),
      copy.tableHeader,
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- | ---: | --- | --- |",
      ...competitorLines,
      ...pricingLines,
      ...(adjacentPlayersAlongsideValidatedVendors.length > 0
        ? [
            "",
            copy.adjacentPlayersTitle,
            copy.adjacentPlayersIntro,
            ...adjacentPlayersAlongsideValidatedVendors.map(
              (player) =>
                `- ${player.name}: ${localizeMarketRelevanceReason(player.reason, copy)} (${copy.confidenceLabel.toLowerCase()}: ${player.confidence}/100 ${player.confidenceLevel}) — ${copy.adjacentPlayerValidationGapLabel}.`
            ),
          ]
        : []),
    ].join("\n");
    // CRITICAL FIX -- confirmed live (root-cause pipeline repair): this
    // sentence used to bake rankingScore/overallVendorScore -- internal
    // research-ranking metadata used only for sorting/eligibility
    // elsewhere in this file, never a metric a reader asked for -- directly
    // into customer-facing prose ("ranking 73/100", "overall score
    // 32/100"). Confidence LEVEL stays (it is already the same
    // intentional, customer-facing "how well-evidenced is this" signal
    // every other list in this file shows), but rankingScore/
    // overallVendorScore are now internal-only: still computed and still
    // used for `eligibleForMajorPlayers`/sorting above, just never
    // interpolated into this displayed sentence. The raw [R#] evidence-id
    // citation tags are also no longer written into this sentence at all
    // -- they were never meant to survive to the customer (the render-
    // time sanitizer's own citationBracketTagPattern explicitly targets
    // `R\d+` for removal, same as every other internal reference tag),
    // but stripping them individually by regex left a stray "; ,)"
    // wherever a bracket ended up alone on its side of that pass -- the
    // literal "Medium;,," garble. Never writing internal-only reference
    // IDs into the customer sentence in the first place is the structural
    // fix; it does not depend on a downstream regex being perfect.
    projection.majorPlayers = [
      copy.majorPlayersTitle,
      ...renderableVendors
        .filter((vendor) => vendor.eligibleForMajorPlayers)
        .map(
          (vendor) =>
            `- ${vendor.name} (${vendor.majorPlayerLabel}): ${vendor.classifications.join(", ")}; ${copy.targetCustomerLabel.toLowerCase()}: ${localizeVendorFallbackText(vendor.targetCustomer, copy)} (${copy.confidenceLabel.toLowerCase()}: ${vendor.confidence}/100 ${vendor.confidenceLevel})`
        ),
    ].join("\n");
    if (!renderableVendors.some((vendor) => vendor.eligibleForMajorPlayers)) {
      projection.majorPlayers = copy.insufficientMajorPlayers;
    }
  } else {
    const adjacentPlayers = graph.vendorIntelligence.adjacentPlayers.filter(
      (player) => !isImplausibleCompetitorName(player.name)
    );
    const coverageDescription = describeCompetitiveCoverage(
      copyLanguage(language),
      vendorCoverage,
      adjacentPlayers.length
    );
    // CRITICAL FIX -- confirmed live (root-cause repair): with no
    // validated *direct* competitor, this branch used to force
    // majorPlayers to the exact same "no competitor data validated" text
    // as competitiveLandscape -- discarding any real evidence about
    // companies genuinely relevant to this market that simply didn't
    // clear the stricter multi-source direct-competitor bar (see
    // vendor-intelligence.ts's adjacentPlayers -- captured from the same
    // discovery pass, never a lower evidence bar invented after the
    // fact). Competitive Landscape correctly stays "Validation Needed"
    // (no direct competitor was validated), but Major Players now
    // honestly labels and lists these adjacent/relevant players instead
    // of either fabricating direct-competitor status for them or
    // silently dropping real evidence just to avoid the contradiction.
    // Never upgrades an adjacent player into a direct competitor: this
    // list is built from graph.vendorIntelligence.adjacentPlayers only,
    // the exact same set (and exclusions) computed once during discovery.
    // describeCompetitiveCoverage itself now states explicitly, when
    // adjacentPlayers exist, that direct competition specifically is
    // unestablished while adjacent players are evidenced -- never the
    // flat "no competitor data" phrasing the exact reported contradiction
    // used.
    projection.competitiveLandscape = coverageDescription;

    projection.majorPlayers =
      adjacentPlayers.length > 0
        ? [
            copy.adjacentPlayersTitle,
            copy.adjacentPlayersIntro,
            // Raw [R#] evidence-id citation tags are deliberately not
            // interpolated into this prose line -- the render-time
            // sanitizer strips them from customer-facing sentences (see
            // the majorPlayers vendor bullet's own comment above), which
            // would otherwise leave a dangling ", ," garble. Confidence
            // and the same evidence-based relevance reason already used
            // for validated vendors are the customer-facing signal here.
            ...adjacentPlayers.map(
              (player) =>
                `- ${player.name}: ${localizeMarketRelevanceReason(player.reason, copy)} (${copy.confidenceLabel.toLowerCase()}: ${player.confidence}/100 ${player.confidenceLevel}) — ${copy.adjacentPlayerValidationGapLabel}.`
            ),
          ].join("\n")
        : coverageDescription;
  }

  if (graph.verifiedMarketSize.length > 0) {
    // P0 PRODUCTION FIX -- confirmed live (Market Intelligence production
    // consistency hardening): a validated market-size figure rendered
    // here with no qualification read as internally contradictory
    // sitting next to an unresolved TAM below -- a reader had no way to
    // tell that "verified" here means "this industry/services total is
    // real, sourced evidence," not "this has been confirmed as the
    // addressable market for the specific business scope requested."
    // This never changes the TAM/SAM/SOM validation rule itself (still
    // computed independently below, still capable of staying
    // "Validation Needed" when the requested scope isn't supported) --
    // it only adds a generic, always-present explanation of WHY a
    // broader verified baseline does not automatically become TAM,
    // mirroring the same "broader/adjacent vs. exact-scope" distinction
    // already made explicit for competitors (adjacentPlayersTitle/
    // adjacentPlayersIntro above: validated direct competitor vs.
    // relevant-but-not-independently-validated player). Purely additive
    // presentation text -- no number, evidence item, or confidence score
    // is altered, invented, or suppressed.
    const sizing = [
      copy.verifiedMarketSizeTitle,
      ...graph.verifiedMarketSize.map(
        (item) =>
          `- [${copy.verifiedTag}] ${item.description} | ${copy.confidenceLabel}: ${item.confidenceScore}/100 (${item.confidenceLevel}) | ${copy.evidenceLabel}: ${item.evidenceIds.map((id) => `[${id}]`).join(", ")}`
      ),
      "",
      copy.marketSizeBaselineLabel,
      copy.marketSizeBaselineExplanation,
    ].join("\n");
    projection.marketSize = sizing;
    // tamSamSom is deliberately left untouched here, not overwritten with
    // this same raw sizing line -- a verified market-size figure is a
    // single headline number, not a TAM/SAM/SOM breakdown (TAM/SAM/SOM
    // must still be nested, TAM >= SAM >= SOM, with an explicit
    // serviceable/obtainable derivation). marketPrompts.tamSamSom already
    // instructs the model to build exactly that breakdown FROM whichever
    // verified or benchmark figure is available. Confirmed live:
    // overwriting tamSamSom here discarded the model's own real
    // TAM/SAM/SOM derivation and replaced it with a bare copy of the
    // marketSize line, which the PDF's TAM/SAM/SOM chart then correctly
    // couldn't parse as three nested figures -- rendering "Could not be
    // calculated" despite the model having verified evidence to derive
    // from. Same principle already applied to the adjacentBenchmarks
    // branch below (see its own comment): never replace the model's real,
    // evidence-grounded analysis with a deterministic stand-in when it had
    // real material to build from.
  } else if (graph.planningEstimate) {
    const estimate = graph.planningEstimate;
    // Method/tier/scope descriptor -- additive, English-only free text
    // matching the existing precedent already set by formula/basis/
    // assumptions below (none of which have ever been localized, since
    // they are calculation traceability for a specific report, not fixed
    // UI copy). Lets a reader see HOW the figure was produced (top-down,
    // bottom-up, or triangulated), how strongly evidenced it is
    // (Supported Estimate vs Directional / Proxy), and its year/geography
    // without opening a separate disclosure.
    const methodLabel =
      estimate.method === "triangulated"
        ? "Triangulated (top-down + bottom-up)"
        : estimate.method === "topDown"
          ? "Top-down"
          : estimate.method === "adjacentProxy"
            ? "Adjacent-market proxy (parent-category, scaled)"
            : "Bottom-up";
    const tierLabel =
      estimate.tier === "supportedEstimate" ? "Supported Estimate" : "Directional / Proxy";
    const confidenceStateLabel =
      estimate.confidenceState === "highConfidence"
        ? "High Confidence"
        : estimate.confidenceState === "moderateConfidence"
          ? "Moderate Confidence"
          : "Directional";
    const samTag = estimate.samMethod === "blocked" ? "Validation Needed" : copy.estimatedTag;
    const somTag = estimate.somStatus === "calculated" ? copy.estimatedTag : "Validation Needed";
    projection.tamSamSom = [
      copy.planningEstimateTitle,
      `Method: ${methodLabel} | Tier: ${tierLabel} (${confidenceStateLabel}) | Geography: ${estimate.geography} | Year: ${estimate.year} | Scope: ${estimate.marketDefinition}`,
      `TAM [${copy.estimatedTag}]: ${estimate.tam}`,
      `SAM [${samTag}]: ${estimate.sam}`,
      `SOM [${somTag}]: ${estimate.som}`,
      `${copy.formulaLabel}: ${estimate.formula}`,
      ...estimate.assumptions,
      ...(estimate.proxyDisclosure ? [`Proxy disclosure: ${estimate.proxyDisclosure}`] : []),
      `${copy.confidenceLabel}: ${estimate.confidence}/100 (${estimate.confidenceLevel}) | ${copy.basisLabel}: ${estimate.basis} | ${copy.evidenceLabel}: ${estimate.evidenceIds.map((id) => `[${id}]`).join(", ") || copy.assumptionOnlyScenario}`,
    ].join("\n");
    // CRITICAL FIX -- confirmed live (root-cause repair): marketSize was
    // NEVER set in this branch, so it silently kept whatever raw,
    // unstructured prose the model wrote for the marketSize field --
    // including, in the reported live defect, a per-buyer annual
    // pricing/ARPA figure the model mentioned as a planning reference,
    // rendered verbatim as if it were the total market size. estimate.tam
    // is always a genuine AGGREGATE figure here (buildPlanningEstimate
    // only ever sets it from an explicit sourced market-size claim, or
    // from addressable-buyer-population multiplied by annualized pricing
    // -- never a bare per-buyer price on its own), so deriving marketSize
    // from it deterministically is safe and can never leak a per-customer
    // figure as-is. Mirrors tamSamSom's own [Estimated] tagging exactly.
    projection.marketSize = [
      copy.planningEstimateTitle,
      `- [${copy.estimatedTag}] ${copy.marketSizePlanningEstimateLine}: ${estimate.tam} | Method: ${methodLabel} (${tierLabel}) | Geography: ${estimate.geography} | Year: ${estimate.year} | ${copy.basisLabel}: ${estimate.basis} | ${copy.confidenceLabel}: ${estimate.confidence}/100 (${estimate.confidenceLevel}) | ${copy.evidenceLabel}: ${estimate.evidenceIds.map((id) => `[${id}]`).join(", ") || copy.assumptionOnlyScenario}`,
    ].join("\n");
  } else if (graph.adjacentBenchmarks.length === 0) {
    // Only forced to an "unavailable" notice when there is truly nothing
    // to reason from -- no verified local figure, no source-based
    // planning estimate, AND no regional/global benchmark either. When a
    // benchmark exists, the model has real, sourced material and explicit
    // instructions (marketPrompts.tamSamSom) to build its own transparent,
    // clearly labeled estimate from it -- overwriting that with a generic
    // string, as this branch used to do unconditionally, is exactly the
    // "insufficient evidence instead of the strongest available analysis"
    // failure mode this exists to prevent.
    //
    // REQUIRED: USER-FACING REPORT QUALITY / RESEARCH RECOVERY LOOP --
    // buildPlanningEstimate always returns a sizingGap alongside a null
    // estimate, naming specifically what evidence WAS found (e.g. a real
    // buyer-population count) and what is still missing, instead of the
    // flat, non-specific notice this branch used to always show. The
    // fully generic copy is now only a defensive fallback for the
    // structurally-impossible case where sizingGap is itself missing.
    projection.tamSamSom = graph.sizingGap?.explanation || copy.tamSamSomUnavailable;
    // CRITICAL FIX -- confirmed live (root-cause repair): same principle
    // applied to marketSize -- when there is truly nothing to build a
    // defensible aggregate figure from, the headline Market Size value
    // must be a deterministic notice, never whatever raw prose the model
    // happened to write (which, per the ticket's own reported defect, can
    // describe a per-buyer pricing/ARPA figure without ever stating a
    // real market-size total). This is what guarantees Market Size can
    // never disagree with TAM/SAM/SOM's own validation state for the
    // exact same underlying evidence gap, and structurally rules out an
    // ARPA/ACV/WTP figure ever reaching the Market Size field again.
    projection.marketSize = graph.sizingGap?.explanation || copy.marketSizeUnavailable;
  }

  if (graph.cagr.length > 0) {
    projection.cagr = graph.cagr
      .map(
        (item) =>
          `- [${classificationTag(language, item.confidenceClassification)}] ${item.description} | ${copy.confidenceLabel}: ${item.confidenceScore}/100 (${item.confidenceLevel}) | ${copy.evidenceLabel}: ${item.evidenceIds.map((id) => `[${id}]`).join(", ")}`
      )
      .join("\n");
  }

  if (graph.sources.length > 0) {
    projection.sources = graph.sources
      .map(
        (source) =>
          `- [${source.evidenceId}] ${source.title} | ${copy.publisherLabel}: ${source.publisher} | URL: ${source.url} | ${copy.publishedLabel}: ${source.publishedDate || copy.notProvided} | ${copy.accessedLabel}: ${source.accessedAt || copy.notProvided} | ${copy.sourceTypeLabel}: ${source.sourceType} | ${copy.classificationLabel}: ${classificationTag(language, source.confidenceClassification)} | ${copy.confidenceLabel}: ${source.confidenceScore}/100 (${source.confidenceLevel}) | ${copy.claimLinkageLabel}: ${source.claim}`
      )
      .join("\n");
  }

  return projection;
}

// Same list-introducing shape reused by page.tsx/Planner.tsx/
// ReportPdfButton.tsx's own extractMarketIntelligenceCompetitorNamesOnly
// prose-list fallback -- kept in sync deliberately (never fabricates a
// new pattern), so a "competitors include X, Y, and Z" clause is
// recognized identically everywhere a claim like it can appear.
const competitorListIntroducerPattern =
  /\b(?:include|includes|including|such as|like|named)\s+((?:[A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*){0,3})(?:\s*,\s*(?:and\s+)?[A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*){0,3})*(?:\s+and\s+[A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*){0,3})?)/;
// A sentence asserting head-to-head rivalry against a SPECIFIC named
// entity, without necessarily using the "include/such as" list shape
// above (e.g. "Competition from Procore is intense."). Deliberately
// narrow -- this only ever fires in combination with a name already on
// the graph's own known adjacent-player list (see
// sanitizeMarketProseCompetitorClaims), never a generic proper-noun scan,
// so it can never flag or invent a name the graph hasn't already
// evidenced.
const competitorRivalryFramingPattern =
  /\b(?:competitors?|rivals?|competition from|compete[s]?\s+(?:with|against)|competing\s+(?:directly|head-on)|head-to-head)\b/i;

function splitIntoSentenceSegments(line: string): string[] {
  return line.split(/(?<=[.!?])\s+(?=[A-ZÇĞİÖŞÜ0-9])/);
}

function extractPlausibleNameCandidates(listText: string): string[] {
  return listText
    .split(/\s*,\s*|\s+and\s+/)
    .map((candidate) => candidate.replace(/^and\s+/i, "").trim())
    .filter((candidate) => candidate && !isImplausibleCompetitorName(`${candidate}:`));
}

type CompetitorClaimClassification = "direct" | "adjacent" | "unknown";

function classifyCompetitorClaimNames(
  names: readonly string[],
  directNames: ReadonlySet<string>,
  adjacentNames: ReadonlySet<string>
): CompetitorClaimClassification[] {
  return names.map((name) =>
    directNames.has(name) ? "direct" : adjacentNames.has(name) ? "adjacent" : "unknown"
  );
}

// CRITICAL FIX -- root-cause repair: named-vendor evidence is validated
// once, in the canonical vendor-discovery graph (vendors = direct
// competitors, vendorIntelligence.adjacentPlayers = relevant-but-not-
// independently-validated players) -- but the model's own free-flowing
// prose for opportunities/threats/portersFiveForces/marketDrivers/
// barriers/strategicRecommendations is generated independently and can
// still assert "Competition from Procore and Autodesk is intense" (an
// adjacent player described as a validated direct rival) or "Leading
// competitors include X, Y, and Z" (names with no graph evidence at all)
// -- the exact reported failure mode: the report structurally establishes
// one competitive reality (Competitive Landscape/Major Players, via
// projectMarketIntelligenceGraphToReport above) while free-form prose
// elsewhere communicates a contradictory, stronger one. Deliberately
// narrow and deterministic rather than a general-purpose sentence parser:
// it only ever acts on (a) the same "include/such as/like/named" list
// shape already established and tested for Major Players' own prose-list
// fallback, or (b) bare rivalry language co-occurring with a name already
// on the graph's own KNOWN adjacent-player list -- never a generic
// proper-noun scan that could misfire on ordinary prose or invent a name
// to flag. A sentence naming ONLY validated direct competitors is left
// completely untouched (that claim is genuinely supported); a sentence
// that mixes a real direct competitor with an adjacent/unknown one is
// ALSO left untouched -- a surgical partial edit inside a mixed claim
// risks producing broken grammar or silently over-correcting a sentence
// that is partly true, so this only ever replaces a sentence whose
// competitive claim rests entirely on non-direct names. Only the
// offending sentence is replaced; every other sentence in the field is
// preserved verbatim, per "apply the smallest deterministic correction,
// never destroy useful prose unnecessarily."
export function sanitizeMarketProseCompetitorClaims(
  content: string,
  graph: MarketIntelligenceGraph,
  language: string
): string {
  if (!content) {
    return content;
  }

  const directNames = new Set(
    graph.vendorIntelligence.vendors
      .filter((vendor) => !isImplausibleCompetitorName(vendor.name))
      .map((vendor) => vendor.name)
  );
  const adjacentNames = new Set(
    graph.vendorIntelligence.adjacentPlayers
      .filter((player) => !isImplausibleCompetitorName(player.name))
      .map((player) => player.name)
  );

  const copy = marketGraphCopy[copyLanguage(language)];

  const resolveReplacement = (classifications: CompetitorClaimClassification[]) => {
    if (classifications.length === 0) return null;
    if (classifications.every((value) => value === "direct")) return null;
    if (classifications.some((value) => value === "direct")) return null;
    if (classifications.every((value) => value === "adjacent")) {
      return "adjacent" as const;
    }
    return "unsupported" as const;
  };

  const sanitizeSentence = (sentence: string): string => {
    const listMatch = sentence.match(competitorListIntroducerPattern);
    if (listMatch?.[1]) {
      const candidates = extractPlausibleNameCandidates(listMatch[1]);
      if (candidates.length > 0) {
        const classifications = classifyCompetitorClaimNames(candidates, directNames, adjacentNames);
        const outcome = resolveReplacement(classifications);
        if (outcome === "adjacent") {
          const adjacentCandidates = candidates.filter((name) => adjacentNames.has(name));
          return copy.competitorClaimAdjacentReframeTemplate.replace(
            "%NAMES%",
            adjacentCandidates.join(", ")
          );
        }
        if (outcome === "unsupported") {
          return copy.competitorClaimUnsupportedReplacement;
        }
      }
    }

    if (competitorRivalryFramingPattern.test(sentence)) {
      const mentionedDirect = [...directNames].some((name) => sentence.includes(name));
      if (!mentionedDirect) {
        const mentionedAdjacent = [...adjacentNames].filter((name) => sentence.includes(name));
        if (mentionedAdjacent.length > 0) {
          return copy.competitorClaimAdjacentReframeTemplate.replace(
            "%NAMES%",
            mentionedAdjacent.join(", ")
          );
        }
      }
    }

    return sentence;
  };

  return content
    .split("\n")
    .map((line) =>
      splitIntoSentenceSegments(line)
        .map((sentence) => sanitizeSentence(sentence))
        .join(" ")
    )
    .join("\n");
}

const bibliographyReferencePattern = /\[R(\d+)\]/g;

/**
 * Builds the final, deterministic Sources bibliography: every [R#]
 * reference actually cited anywhere in the report body (never the model's
 * own free-form sources text, never a category+count compression), each
 * resolved to its real verified evidence record. Order matches first
 * citation appearance across sections; two IDs that resolve to the same
 * canonical document merge into one entry tagged with every ID that cites
 * it. The per-entry field labels below ("Title:", "Publisher:", ...) are
 * intentionally hardcoded in English regardless of `language` -- they are
 * parsing keys for ReportPdfButton.tsx's parseCitations, not user-facing
 * prose (matching that renderer's own existing English-only field labels,
 * e.g. "Source type:"/"Confidence:", which are not localized either).
 */
export function buildMarketIntelligenceBibliography(
  sections: Record<string, string | undefined>,
  graph: MarketIntelligenceGraph,
  language: string = "English"
): string {
  const copy = marketGraphCopy[copyLanguage(language)];

  const orderedIds: string[] = [];
  const seenIds = new Set<string>();
  for (const [field, content] of Object.entries(sections)) {
    if (field === "sources" || !content) continue;
    bibliographyReferencePattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = bibliographyReferencePattern.exec(content))) {
      const id = `R${match[1]}`;
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      orderedIds.push(id);
    }
  }

  if (orderedIds.length === 0) {
    return [copy.sourcesTitle, copy.noVerifiableSourcesText].join("\n");
  }

  const entryOrder: MarketIntelligenceSource[] = [];
  const tagsByRecord = new Map<MarketIntelligenceSource, string[]>();
  for (const id of orderedIds) {
    const record = graph.sourceRecordByEvidenceId[id];
    // Defensive only: assertNoOrphanEvidenceReferences already fails
    // generation before this function is ever reached if any cited ID
    // has no record, so this branch should be unreachable in practice.
    if (!record) continue;
    if (!tagsByRecord.has(record)) {
      tagsByRecord.set(record, []);
      entryOrder.push(record);
    }
    tagsByRecord.get(record)!.push(id);
  }

  // Every interpolated field is forced to a single line here, defensively,
  // regardless of whether sanitizeResearchPublisher already cleaned it
  // upstream. Confirmed live: a publisher string reached this function
  // still carrying an embedded line break ("U.S.\nCensus Bureau"), which
  // split one "Publisher:" line's value into two lines with no
  // recognizable "Label:" prefix on the second -- ReportPdfButton.tsx's
  // line-based parseCitations then read the orphaned second line as the
  // start of a new, fabricated citation card with no URL/type/confidence
  // of its own, AND shifted every subsequent entry's field associations
  // out of alignment. This single-line guarantee is what parseCitations'
  // whole "Label: value" line format depends on, so it belongs here, at
  // the one place that builds every line of the bibliography, rather than
  // trusting every upstream field to already be clean.
  const singleLine = (value: string) => value.replace(/\s+/g, " ").trim();

  const entries = entryOrder.map((record) => {
    const tags = (tagsByRecord.get(record) || []).map((id) => `[${id}]`).join("");
    const year = record.publishedDate.match(/\b(19|20)\d{2}\b/)?.[0];
    // A full ISO timestamp ("2026-08-15T00:00:00.000Z") reads worse than
    // a plain date in a citation card, and its "." trips the PDF
    // parser's own prose-rejection guard (built to reject a value like
    // "the gap in verified evidence." -- a real timestamp's decimal
    // point is an unrelated false positive against that same check), so
    // the field silently disappeared even when accessedAt was present.
    // Reducing to the plain YYYY-MM-DD date fixes both at once.
    const accessDate = record.accessedAt.match(/^\d{4}-\d{2}-\d{2}/)?.[0] || record.accessedAt;
    return [
      `Reference: ${tags}`,
      `Title: ${singleLine(record.title)}`,
      `Publisher: ${singleLine(record.publisher)}`,
      `URL: ${singleLine(record.url)}`,
      ...(year ? [`Year: ${year}`] : []),
      ...(accessDate ? [`Accessed: ${accessDate}`] : []),
      `Type: ${singleLine(record.sourceType)}`,
      `Confidence: ${singleLine(record.confidenceLevel)}`,
    ].join("\n");
  });

  return [copy.sourcesTitle, "", ...entries].join("\n\n").trim();
}
