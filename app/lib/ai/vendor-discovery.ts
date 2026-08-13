import type { DomainResearchEvidence } from "./domain-research.ts";
import {
  isExcludedCompetitorInstitution,
  resolveMarketVendorEntities,
  type MarketTaxonomyProfile,
} from "./market-taxonomy.ts";
import { calculateEvidenceConfidence } from "./market-research-coverage.ts";

// ---------------------------------------------------------------------------
// 1. Dynamic vendor-discovery query expansion
// ---------------------------------------------------------------------------

export type VendorDiscoveryQueryPlan = {
  packedQueries: string[];
  termsConsidered: number;
  termsPacked: number;
  anglesCovered: string[];
};

const discoveryAngles = [
  "top vendors",
  "best software",
  "market leaders",
  "alternatives",
  "competitors",
  "pricing",
  "customer reviews",
  "G2",
  "Capterra",
  "official vendor directory",
  "industry association directory",
] as const;

function uniqueNonEmpty(values: readonly string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.replace(/\s+/g, " ").trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

/**
 * Builds the vendor-discovery query plan for a market. Terms come from the
 * market's own taxonomy (exact name, aliases, adjacent categories, buyer and
 * use-case terminology); angles are the fixed discovery-intent phrases the
 * product spec calls for. The result is packed into at most 3 strings of at
 * most 220 characters each to respect the shared research-task schema
 * (dynamicResearchTaskSchema) without requiring any change to that schema.
 */
export function buildVendorDiscoveryQueryPlan(
  prompt: string,
  taxonomy: MarketTaxonomyProfile,
  maxTermsConsidered = 30,
  maxSlots = 3,
  maxSlotLength = 220
): VendorDiscoveryQueryPlan {
  const marketTerms = uniqueNonEmpty([
    taxonomy.productCategory,
    ...taxonomy.aliases,
    ...taxonomy.adjacentCategories,
    ...taxonomy.buyerCategories,
    ...taxonomy.terminology,
  ]).slice(0, maxTermsConsidered);

  const anglesCovered = [...discoveryAngles];
  const candidates = uniqueNonEmpty(
    marketTerms.flatMap((term) => anglesCovered.map((angle) => `${term} ${angle}`))
  );

  const contextPrefix = prompt.replace(/\s+/g, " ").trim().slice(0, 40);
  const slotBudget = Math.max(20, maxSlotLength - contextPrefix.length - 1);

  const slots: string[] = [];
  let current = "";
  let termsPacked = 0;
  for (const candidate of candidates) {
    if (slots.length >= maxSlots) break;
    const truncated = candidate.length > slotBudget ? candidate.slice(0, slotBudget) : candidate;
    const next = current ? `${current}; ${truncated}` : truncated;
    if (next.length <= slotBudget) {
      current = next;
      termsPacked += 1;
      continue;
    }
    if (current) slots.push(current);
    if (slots.length >= maxSlots) break;
    current = truncated;
    termsPacked += 1;
  }
  if (current && slots.length < maxSlots) slots.push(current);

  const packedQueries = slots
    .map((slot) => `${contextPrefix} ${slot}`.replace(/\s+/g, " ").trim().slice(0, maxSlotLength))
    .filter((query) => query.length >= 3);

  return {
    packedQueries,
    termsConsidered: candidates.length,
    termsPacked,
    anglesCovered,
  };
}

// ---------------------------------------------------------------------------
// 2. Candidate extraction
// ---------------------------------------------------------------------------

export type VendorMentionSource =
  | "taxonomy_alias"
  | "taxonomy_domain"
  | "company_source"
  | "heuristic_mention"
  | "domain_fallback";

export type RawVendorMention = {
  name: string;
  matchedBy: VendorMentionSource;
  evidenceId: string;
  url: string;
  domain: string;
  searchQuery: string;
  publishedDate: string;
  lastChecked: string;
};

const reviewDirectoryDomains = [
  "g2.com",
  "capterra.com",
  "trustradius.com",
  "getapp.com",
  "softwareadvice.com",
  "producthunt.com",
  "gartner.com",
  "peerinsights.gartner.com",
  "sourceforge.net",
  "alternativeto.net",
];

const vendorRelevantFields = new Set([
  "vendor_discovery",
  "competitors",
  "product_evidence",
  "pricing_models",
  "company_evidence",
]);

// classifyMarketResearchSourceType (domain-research.ts) is the actual,
// single source of truth for every external evidence item's .sourceType --
// it always emits one of its own human-readable labels ("official company
// source", "market research", "financial filing", "industry association",
// "credible publication", "government/statistical source", or the raw
// provider id as a last-resort fallback). This set previously listed
// snake_case tokens ("company_source", "credible_market_data",
// "official_filing", "professional_standard") that classifier never
// produces, which silently disabled this whole relevance check for every
// market -- listed here are that same intent, matched against the real
// output vocabulary.
const vendorRelevantSourceTypes = new Set([
  "official company source",
  "market research",
  "credible publication",
  "industry association",
  "financial filing",
]);

const genericMentionStopWords = new Set([
  "the", "this", "that", "these", "those", "our", "their", "its", "software",
  "platform", "platforms", "solution", "solutions", "company", "companies",
  "enterprise", "enterprises", "business", "businesses", "market", "markets",
  "industry", "report", "reports", "according", "source", "sources", "vendor",
  "vendors", "provider", "providers", "product", "products", "service",
  "services", "review", "reviews", "customer", "customers", "leading", "top",
  "best", "alternative", "alternatives", "competitor", "competitors", "pricing",
  "official", "directory", "association", "google", "capterra", "gartner", "g2",
]);

export function hostnameOf(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

export function isReviewOrDirectoryDomain(domain: string) {
  return reviewDirectoryDomains.some(
    (known) => domain === known || domain.endsWith(`.${known}`)
  );
}

const domainSuffixPattern = /\.(?:com|net|org|co|app|io|biz|info|dev|shop)(?:\.[a-z]{2})?$/i;

// True when an evidence item's own descriptive text carries nothing but
// its bare domain -- the shape produced when a web-search provider
// returns a source URL with no real snippet/citation (common for small,
// local, or niche businesses that a broad market query still correctly
// surfaces). Content this thin can never match a taxonomy alias or the
// prose-pattern heuristics below, so without a dedicated fallback, a real
// competitor's own website is indistinguishable from noise and silently
// disappears from vendor discovery.
function isThinDomainOnlyEvidence(item: DomainResearchEvidence, domain: string) {
  if (item.supportingData.length > 0) return false;
  const domainPattern = new RegExp(domain.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
  const remainder = [item.claim, item.value, item.sourceTitle]
    .join(" ")
    .replace(domainPattern, "")
    .replace(/[\s.,:;!?()[\]"'`-]+/g, "")
    .trim();
  return remainder.length < 5;
}

// Derives a presentable candidate name from a bare domain when no richer
// signal exists ("kopurt.com" -> "Kopurt", "quickcarwash.com.tr" ->
// "Quickcarwash"). Imperfect capitalization (no attempt at multi-word
// splitting within the label) is an acceptable trade-off: the alternative
// is the vendor never being discovered at all.
function deriveCandidateNameFromDomain(domain: string): string | null {
  const withoutSuffix = domain.replace(domainSuffixPattern, "");
  const label = withoutSuffix.split(".").pop() || "";
  const cleaned = label.replace(/[-_]+/g, " ").trim();
  if (cleaned.length < 3) return null;
  const name = cleaned
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
  return normalizedMentionCandidate(name, new Set());
}

function isVendorDiscoveryRelevant(item: DomainResearchEvidence, domain: string) {
  return (
    vendorRelevantFields.has(item.field) ||
    vendorRelevantSourceTypes.has(item.sourceType) ||
    isReviewOrDirectoryDomain(domain)
  );
}

function normalizedMentionCandidate(value: string, taxonomyWords: ReadonlySet<string>) {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (trimmed.length < 2 || trimmed.length > 40) return null;
  const lower = trimmed.toLowerCase();
  if (genericMentionStopWords.has(lower)) return null;
  if (lower.split(" ").every((word) => taxonomyWords.has(word))) return null;
  if (isExcludedCompetitorInstitution(trimmed)) return null;
  if (!/[A-Za-z]/.test(trimmed)) return null;
  return trimmed;
}

const mentionPatterns = [
  /\b([A-Z][A-Za-z0-9&.+'-]{1,28}(?:\s+[A-Z][A-Za-z0-9&.+'-]{1,28}){0,2})\s+(?:offers|provides|delivers|specializes in|is an AI-powered|is a leading|is a cloud-based)/g,
  /\b[Aa]lternatives?\s+[Tt]o\s+([A-Z][A-Za-z0-9&.+'-]{1,28}(?:\s+[A-Z][A-Za-z0-9&.+'-]{1,28}){0,2})/g,
  /\b([A-Z][A-Za-z0-9&.+'-]{1,28}(?:\s+[A-Z][A-Za-z0-9&.+'-]{1,28}){0,2})\s+(?:pricing|Pricing|reviews?|Reviews?|vs\.?|Vs\.?)\b/g,
  // Turkish equivalents of the same prose-mention shape above. Confirmed
  // live (Türkiye car-wash market run): evidence text explicitly named
  // real brands in Turkish sentence structure -- "ISTOBAL mümessili",
  // "WashTec ürünlerini ... temsil ettiği" -- and the English-only
  // patterns above matched none of it, so heuristic extraction returned
  // empty for every Turkish-language source. That silently pushed all
  // vendor naming onto the domain-fallback path (meant only for
  // thin/content-less evidence), which then named "vendors" after
  // whatever domain hosted the page -- producing entries like "Wikipedia"
  // and "Istoc" for pages that were *about* WashTec/ISTOBAL, instead of
  // the brand the page actually described.
  // Turkish compound-noun phrasing routinely inserts descriptive words
  // between the brand and the keyword ("WashTec otomatik araç yıkama
  // makineleri" -- confirmed live), unlike the tight English adjacency
  // above -- so this allows a short, bounded gap of lowercase words
  // rather than requiring the keyword immediately after the brand.
  /\b([A-Z][A-Za-z0-9&.+'-]{1,28}(?:\s+[A-Z][A-Za-z0-9&.+'-]{1,28}){0,2})(?:'[a-zışğüöçİĞÜÖÇŞ]{1,3})?\s+(?:[a-zışğüöç]{2,20}\s+){0,3}(?:mümessili|mümessilliği|temsilcisi|yetkili distribütörü|distribütörü|bayisi|ürünleri|ürünlerini|makineleri|makinelerini|sistemleri|sistemlerini|markası)\b/g,
  /\b(?:alternatifleri|rakipleri)\s+(?:olarak\s+)?([A-Z][A-Za-z0-9&.+'-]{1,28}(?:\s+[A-Z][A-Za-z0-9&.+'-]{1,28}){0,2})/g,
];

function extractHeuristicMentions(
  text: string,
  taxonomyWords: ReadonlySet<string>,
  cap = 4
) {
  const found: string[] = [];
  for (const pattern of mentionPatterns) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while (found.length < cap && (match = pattern.exec(text))) {
      const candidate = normalizedMentionCandidate(match[1], taxonomyWords);
      if (candidate) found.push(candidate);
    }
  }
  return uniqueNonEmpty(found).slice(0, cap);
}

/**
 * Extracts vendor-name mentions from evidence. Path A reuses the existing
 * taxonomy alias/domain resolution as-is. Path B is new: for evidence that is
 * clearly vendor-discovery-relevant (review/directory domains, or
 * vendor-relevant fields/source types) but not already covered by a taxonomy
 * match, it extracts capitalized product/company names adjacent to
 * vendor-signal phrasing. This is what lets markets with no hardcoded
 * taxonomy (or vendors missing from the static catalog) still be discovered.
 */
export function extractVendorCandidateMentions(
  evidence: readonly DomainResearchEvidence[],
  taxonomy: MarketTaxonomyProfile | null
): RawVendorMention[] {
  const taxonomyWords = new Set(
    [
      taxonomy?.productCategory,
      ...(taxonomy?.adjacentCategories || []),
      ...(taxonomy?.terminology || []),
      ...(taxonomy?.aliases || []),
      ...(taxonomy?.buyerCategories || []),
    ]
      .filter((value): value is string => Boolean(value))
      .flatMap((value) => value.toLowerCase().split(/\s+/))
  );

  const mentions: RawVendorMention[] = [];
  for (const item of evidence) {
    const domain = hostnameOf(item.url);
    if (!domain) continue;

    const taxonomyResolved = resolveMarketVendorEntities(item, taxonomy);
    for (const resolved of taxonomyResolved) {
      mentions.push({
        name: resolved.name,
        matchedBy:
          resolved.matchedBy === "domain"
            ? "taxonomy_domain"
            : resolved.matchedBy === "company_source"
              ? "company_source"
              : "taxonomy_alias",
        evidenceId: item.id,
        url: item.url,
        domain,
        searchQuery: item.searchQuery || "",
        publishedDate: item.publishedDate,
        lastChecked: item.lastChecked,
      });
    }

    // Once an item is already resolved via the taxonomy/company-source path,
    // skip heuristic extraction on it: the same sentence often contains the
    // vendor name in a slightly different surface form (e.g. "QuickBooks AI"
    // vs. the canonical "Intuit (QuickBooks)"), and re-extracting it would
    // create a lookalike duplicate candidate instead of merging.
    if (taxonomyResolved.length > 0) continue;
    if (!isVendorDiscoveryRelevant(item, domain)) continue;
    const text = [item.claim, item.value, item.sourceTitle].join(" ");
    const heuristicNames = extractHeuristicMentions(text, taxonomyWords);
    for (const name of heuristicNames) {
      mentions.push({
        name,
        matchedBy: "heuristic_mention",
        evidenceId: item.id,
        url: item.url,
        domain,
        searchQuery: item.searchQuery || "",
        publishedDate: item.publishedDate,
        lastChecked: item.lastChecked,
      });
    }

    // Path C: the item is vendor-relevant but has no descriptive prose for
    // the heuristics above to match against (a bare-domain search result,
    // not a taxonomy alias or a rich snippet) -- fall back to the domain
    // itself as the only available name signal, not a taxonomy substitute
    // to avoid, since one was never found.
    if (heuristicNames.length === 0 && isThinDomainOnlyEvidence(item, domain)) {
      const derivedName = deriveCandidateNameFromDomain(domain);
      if (derivedName) {
        mentions.push({
          name: derivedName,
          matchedBy: "domain_fallback",
          evidenceId: item.id,
          url: item.url,
          domain,
          searchQuery: item.searchQuery || "",
          publishedDate: item.publishedDate,
          lastChecked: item.lastChecked,
        });
      }
    }
  }
  return mentions;
}

// ---------------------------------------------------------------------------
// 3. Vendor identity resolution
// ---------------------------------------------------------------------------

export type AggregatedVendorCandidate = {
  canonicalName: string;
  aliases: string[];
  sourceUrls: string[];
  sourceDomains: string[];
  mentionCount: number;
  discoveryQueries: string[];
  firstSeen: string;
  lastSeen: string;
  evidenceIds: string[];
  matchedByTaxonomy: boolean;
};

const legalSuffixPattern =
  /\b(?:incorporated|corporation|company|limited|gmbh|plc|inc|corp|co|llc|ltd)\.?\b/gi;

export function normalizeVendorKey(name: string) {
  return name
    .toLowerCase()
    .replace(legalSuffixPattern, " ")
    .replace(/[.,&'’]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function earlierDate(a: string, b: string) {
  if (!a) return b;
  if (!b) return a;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (!Number.isFinite(ta)) return b;
  if (!Number.isFinite(tb)) return a;
  return ta <= tb ? a : b;
}

function laterDate(a: string, b: string) {
  if (!a) return b;
  if (!b) return a;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (!Number.isFinite(ta)) return b;
  if (!Number.isFinite(tb)) return a;
  return ta >= tb ? a : b;
}

/**
 * Groups raw mentions into canonical vendors. Taxonomy-matched mentions are
 * grouped by the taxonomy's own canonical name (already handles known alias
 * families such as QuickBooks/Intuit Assist -> "Intuit (QuickBooks)" and
 * NetSuite -> "Oracle NetSuite"). Everything else is grouped by a normalized
 * key (case, punctuation, and legal-suffix insensitive) with no fuzzy
 * matching, so unrelated companies are never over-merged.
 */
export function resolveVendorIdentity(
  mentions: readonly RawVendorMention[]
): Map<string, AggregatedVendorCandidate> {
  const aggregated = new Map<string, AggregatedVendorCandidate>();
  for (const mention of mentions) {
    const isTaxonomyMatch =
      mention.matchedBy === "taxonomy_alias" || mention.matchedBy === "taxonomy_domain";
    // Both paths key off the same normalized form so a heuristic mention of
    // a name that also has a taxonomy match (e.g. "Vic.ai" mentioned in a
    // product sentence) always merges with the taxonomy-canonical entry
    // instead of creating a lookalike duplicate.
    const key = normalizeVendorKey(mention.name);
    if (!key) continue;

    const current: AggregatedVendorCandidate =
      aggregated.get(key) || {
        canonicalName: mention.name,
        aliases: [],
        sourceUrls: [],
        sourceDomains: [],
        mentionCount: 0,
        discoveryQueries: [],
        firstSeen: "",
        lastSeen: "",
        evidenceIds: [],
        matchedByTaxonomy: false,
      };

    if (isTaxonomyMatch) current.canonicalName = mention.name;
    current.matchedByTaxonomy = current.matchedByTaxonomy || isTaxonomyMatch;
    if (!current.aliases.some((alias) => alias.toLowerCase() === mention.name.toLowerCase())) {
      current.aliases.push(mention.name);
    }
    if (mention.url && !current.sourceUrls.includes(mention.url)) {
      current.sourceUrls.push(mention.url);
    }
    if (mention.domain && !current.sourceDomains.includes(mention.domain)) {
      current.sourceDomains.push(mention.domain);
    }
    if (mention.searchQuery && !current.discoveryQueries.includes(mention.searchQuery)) {
      current.discoveryQueries.push(mention.searchQuery);
    }
    if (!current.evidenceIds.includes(mention.evidenceId)) {
      current.evidenceIds.push(mention.evidenceId);
    }
    current.mentionCount += 1;
    current.firstSeen = earlierDate(current.firstSeen, mention.publishedDate || mention.lastChecked);
    current.lastSeen = laterDate(current.lastSeen, mention.lastChecked || mention.publishedDate);
    aggregated.set(key, current);
  }
  return aggregated;
}

// ---------------------------------------------------------------------------
// 4. Multi-path vendor validation
// ---------------------------------------------------------------------------

export type VendorValidationResult = {
  validated: boolean;
  validationPath: string;
  reason: string;
  officialEvidenceCount: number;
  independentDomainCount: number;
  reviewEvidenceCount: number;
  pricingEvidenceCount: number;
  filingEvidenceCount: number;
  productEvidenceCount: number;
  customerEvidenceCount: number;
  marketMentionCount: number;
};

const filingSignalPattern =
  /\b(?:sec filing|10-k|10-q|annual report|investor relations|audited financial|prospectus|s-1 filing)\b/i;
const pricingSignalPattern =
  /\b(?:pricing|subscription|per (?:user|seat|month|year|transaction|document|company)|usage[- ]based|quote[- ]based|contact sales|custom quote|list price)\b/i;
const productSignalPattern = /\b(?:feature|product|integration|deployment|capabilit|workflow|module)\b/i;
const customerSignalPattern =
  /\b(?:customer|buyer|enterprise|smb|firm|hospital|contractor|security team|client)\b/i;
const marketMentionPattern = /\b(?:market|vendor|competitor|competitive|leader|provider|platform)\b/i;
// Matches classifyMarketResearchSourceType's (domain-research.ts) actual
// human-readable output ("official company source", not the snake_case
// "company_source" this pattern used to look for) -- that classifier runs
// on every external evidence item and reformats sourceType before it ever
// reaches vendor-discovery.ts, so a pattern written against the internal
// token instead of the real output string can never match, silently
// disabling this whole validation path for every market.
const companyOwnedPattern = /official company source|company website|product page|pricing page/i;

/**
 * An evidence item only counts as corroboration when it independently meets
 * the existing evidence-quality bar (verified label + confidence >= 48).
 * This is the guard against validating a vendor from a single low-quality
 * listicle or an "Estimate"-labeled mention that merely looks official.
 */
export function isQualifyingVendorEvidence(item: DomainResearchEvidence) {
  return (
    (item.label === "Verified from official source" ||
      item.label === "Verified from external source") &&
    calculateEvidenceConfidence(item) >= 48
  );
}

export function isOfficialVendorEvidence(
  item: DomainResearchEvidence,
  candidateDomains: readonly string[]
) {
  const domain = hostnameOf(item.url);
  if (!candidateDomains.includes(domain)) return false;
  let pathSignal = false;
  try {
    pathSignal = /\/products?|\/pricing|\/solutions?|\/features?/i.test(new URL(item.url).pathname);
  } catch {
    pathSignal = false;
  }
  return companyOwnedPattern.test(`${item.sourceType} ${item.sourceTitle}`) || pathSignal;
}

/**
 * Implements the 5-path OR validation rule: a candidate is only a validated
 * commercial vendor when the *qualifying* evidence (see
 * isQualifyingVendorEvidence) supports at least one of: official page + one
 * independent domain; two independent commercial/industry domains; official +
 * review evidence; official + pricing/product documentation; or a public
 * filing/investor material alone.
 */
export function validateVendorCandidate(
  candidate: AggregatedVendorCandidate,
  qualifyingItems: readonly DomainResearchEvidence[]
): VendorValidationResult {
  const officialItems = qualifyingItems.filter((item) =>
    isOfficialVendorEvidence(item, candidate.sourceDomains)
  );
  const reviewItems = qualifyingItems.filter((item) =>
    isReviewOrDirectoryDomain(hostnameOf(item.url))
  );
  const pricingItems = qualifyingItems.filter((item) =>
    pricingSignalPattern.test(`${item.claim} ${item.value}`)
  );
  const filingItems = qualifyingItems.filter((item) =>
    filingSignalPattern.test(`${item.claim} ${item.value} ${item.sourceType}`)
  );
  const productItems = qualifyingItems.filter((item) =>
    productSignalPattern.test(`${item.claim} ${item.value}`)
  );
  const customerItems = qualifyingItems.filter((item) =>
    customerSignalPattern.test(`${item.claim} ${item.value}`)
  );
  const marketMentionItems = qualifyingItems.filter((item) =>
    marketMentionPattern.test(`${item.claim} ${item.value}`)
  );

  const independentDomainCount = new Set(
    qualifyingItems.map((item) => hostnameOf(item.url)).filter(Boolean)
  ).size;
  const officialEvidenceCount = officialItems.length;
  const reviewEvidenceCount = reviewItems.length;
  const pricingEvidenceCount = pricingItems.length;
  const filingEvidenceCount = filingItems.length;
  // Being cited from 2+ distinct hostnames only proves the *name* is
  // corroborated, not that it is a commercial vendor -- a generic
  // reference/encyclopedia/statistics site (Wikipedia, a government
  // agency, a press-release aggregator) is routinely cited from several
  // subdomains or mirrors while carrying zero descriptive content about
  // any product or company (confirmed live: en.wikipedia.org +
  // tr.wikipedia.org, both bare citations with no claim/value text,
  // otherwise validated a "Wikipedia" competitor). Reusing
  // isThinDomainOnlyEvidence here -- language-agnostic, no new keyword
  // list -- requires at least one supporting item to carry real
  // descriptive content before domain-count alone can validate a vendor.
  const hasSubstantiveEvidence = qualifyingItems.some(
    (item) => !isThinDomainOnlyEvidence(item, hostnameOf(item.url))
  );

  const paths: Array<[boolean, string]> = [
    [officialEvidenceCount >= 1 && independentDomainCount >= 2, "official_product_page_plus_independent_source"],
    [officialEvidenceCount >= 1 && reviewEvidenceCount >= 1, "official_page_plus_customer_review_evidence"],
    // A verified, company-owned product/pricing page is itself the "product
    // documentation" the spec refers to, so it is sufficient alone -- this
    // is what lets a single well-formed official page validate a vendor,
    // while a single third-party mention (no official page) still needs the
    // two-independent-sources path below.
    [officialEvidenceCount >= 1, "official_page_plus_product_documentation"],
    [independentDomainCount >= 2 && hasSubstantiveEvidence, "two_independent_commercial_or_industry_sources"],
    [filingEvidenceCount >= 1, "public_filing_or_investor_material"],
  ];
  const passed = paths.find(([ok]) => ok);

  return {
    validated: Boolean(passed),
    validationPath: passed?.[1] || "none",
    reason: passed
      ? `Validated via ${passed[1].replace(/_/g, " ")}.`
      : `Insufficient corroboration: ${independentDomainCount} independent domain(s), ${officialEvidenceCount} official source(s), ${reviewEvidenceCount} review source(s), ${filingEvidenceCount} filing source(s). A single low-quality mention is not sufficient.`,
    officialEvidenceCount,
    independentDomainCount,
    reviewEvidenceCount,
    pricingEvidenceCount,
    filingEvidenceCount,
    productEvidenceCount: productItems.length,
    customerEvidenceCount: customerItems.length,
    marketMentionCount: marketMentionItems.length,
  };
}

// ---------------------------------------------------------------------------
// 5. Scoring, Major Player labeling, market relevance
// ---------------------------------------------------------------------------

export type VendorDiscoveryScores = {
  independentEvidenceCount: number;
  officialEvidenceCount: number;
  pricingEvidenceCount: number;
  productEvidenceCount: number;
  customerEvidenceCount: number;
  marketMentionCount: number;
  sourceDiversityScore: number;
  commercialConfidence: number;
  marketRelevanceScore: number;
  overallVendorScore: number;
};

export function computeVendorDiscoveryScores(
  validation: VendorValidationResult,
  candidate: AggregatedVendorCandidate,
  averageEvidenceConfidence: number,
  marketRelevant: boolean
): VendorDiscoveryScores {
  const sourceDiversityScore = Math.min(
    100,
    candidate.sourceDomains.length * 20 + candidate.mentionCount * 3
  );
  const marketRelevanceScore = marketRelevant
    ? Math.min(100, 60 + validation.marketMentionCount * 8)
    : 0;
  const overallVendorScore = Math.min(
    100,
    Math.round(
      Math.min(24, validation.independentDomainCount * 8) +
        Math.min(24, validation.officialEvidenceCount * 12) +
        Math.min(16, validation.productEvidenceCount * 6) +
        Math.min(16, validation.pricingEvidenceCount * 8) +
        Math.min(12, validation.customerEvidenceCount * 6) +
        Math.min(8, validation.marketMentionCount * 3)
    )
  );
  return {
    independentEvidenceCount: validation.independentDomainCount,
    officialEvidenceCount: validation.officialEvidenceCount,
    pricingEvidenceCount: validation.pricingEvidenceCount,
    productEvidenceCount: validation.productEvidenceCount,
    customerEvidenceCount: validation.customerEvidenceCount,
    marketMentionCount: validation.marketMentionCount,
    sourceDiversityScore,
    commercialConfidence: averageEvidenceConfidence,
    marketRelevanceScore,
    overallVendorScore,
  };
}

export type MajorPlayerLabel =
  | "Market Leader"
  | "Established Challenger"
  | "Emerging Vendor"
  | "Niche Specialist"
  | "Vertical Specialist";

export function classifyMajorPlayerLabel(input: {
  position: string;
  classifications: readonly string[];
  independentEvidenceCount: number;
  customerEvidenceCount: number;
  marketMentionCount: number;
}): MajorPlayerLabel {
  if (input.classifications.includes("Vertical Specialist")) return "Vertical Specialist";
  if (input.position === "Market Leader" && input.independentEvidenceCount >= 3) {
    return "Market Leader";
  }
  if (input.position === "Emerging") return "Emerging Vendor";
  if (input.position === "Niche") return "Niche Specialist";
  if (
    input.independentEvidenceCount >= 2 &&
    (input.customerEvidenceCount >= 1 || input.marketMentionCount >= 1)
  ) {
    return "Established Challenger";
  }
  return "Niche Specialist";
}

export type MarketRelevanceResult = { relevant: boolean; reason: string };

const nonVendorRolePattern =
  /\b(?:implementation partner|systems? integrator|si partner|reseller partner|channel partner|app marketplace|marketplace|app store|outsourced accounting|outsourced bookkeeping|managed bookkeeping service|accounting firm|cpa firm|law firm|consulting firm|consultancy|advisory firm|distributor|distribution partner|wholesale distributor|media (?:company|group|outlet|network)|news (?:outlet|organization|publication|site)|trade (?:press|publication|journal)|publishing (?:company|house)|b2b media|industry (?:media|publication)|events? (?:company|organizer|producer)|conference organizer|trade show organizer|analyst firm|research and advisory firm)\b/i;
const managedServicesAllowancePattern = /\bmanaged (?:service|services|detection|soc|security)\b/i;

/**
 * Excludes implementation partners, marketplaces, systems integrators,
 * outsourced/managed-service providers, media/publishing companies,
 * distributors, event organizers, and advisory/accounting firms from the
 * vendor pool, unless the market itself is about managed services (e.g.
 * Cybersecurity MDR). Always returns a human-readable reason, satisfying the
 * "clear relevance explanation" requirement for validated vendors too.
 */
export function assessMarketRelevance(
  candidate: AggregatedVendorCandidate,
  taxonomy: MarketTaxonomyProfile | null,
  evidenceText: string,
  marketPrompt: string
): MarketRelevanceResult {
  const allowManagedServices = managedServicesAllowancePattern.test(
    `${marketPrompt} ${taxonomy?.productCategory || ""} ${(taxonomy?.adjacentCategories || []).join(" ")}`
  );
  if (!allowManagedServices && nonVendorRolePattern.test(`${candidate.canonicalName} ${evidenceText}`)) {
    return {
      relevant: false,
      reason: `Excluded: evidence identifies ${candidate.canonicalName} as an implementation partner, marketplace, distributor, media/events company, outsourced service provider, or advisory firm rather than a commercial product vendor in this market.`,
    };
  }
  return {
    relevant: true,
    reason: `${candidate.canonicalName} is a commercial product vendor with evidence directly tied to ${taxonomy?.productCategory || "the requested market"}.`,
  };
}

// ---------------------------------------------------------------------------
// 6. Discovery log / research-budget bookkeeping
// ---------------------------------------------------------------------------

export type VendorDiscoveryLog = {
  queriesGenerated: number;
  queriesPacked: number;
  anglesCovered: string[];
  candidatesDiscovered: number;
  vendorsValidated: number;
  sourcesAccepted: number;
  sourcesRejected: number;
  earlyStopReason: string;
};

export function buildVendorDiscoveryLog(input: {
  queryPlan: VendorDiscoveryQueryPlan;
  candidatesDiscovered: number;
  vendorsValidated: number;
  sourcesAccepted: number;
  sourcesRejected: number;
  sufficientCoverage: boolean;
}): VendorDiscoveryLog {
  const earlyStopReason =
    input.vendorsValidated === 0
      ? "No commercial vendor mentions passed validation from the collected evidence."
      : input.sufficientCoverage
        ? `Coverage sufficient after ${input.vendorsValidated} validated vendors; additional discovery queries were not required.`
        : `Only ${input.vendorsValidated} vendor(s) validated from ${input.candidatesDiscovered} candidate(s); remaining candidates lacked independent corroboration.`;
  return {
    queriesGenerated: input.queryPlan.termsConsidered,
    queriesPacked: input.queryPlan.termsPacked,
    anglesCovered: input.queryPlan.anglesCovered,
    candidatesDiscovered: input.candidatesDiscovered,
    vendorsValidated: input.vendorsValidated,
    sourcesAccepted: input.sourcesAccepted,
    sourcesRejected: input.sourcesRejected,
    earlyStopReason,
  };
}
