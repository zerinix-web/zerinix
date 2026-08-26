import type { DomainResearchEvidence } from "./domain-research.ts";
import {
  isExcludedCompetitorInstitution,
  resolveMarketVendorEntities,
  type MarketTaxonomyProfile,
} from "./market-taxonomy.ts";
import { calculateEvidenceConfidence } from "./market-research-coverage.ts";
import { academicPublisherHostPattern } from "./commercial-vendor-intelligence.ts";

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

// Domain shapes that can never represent the organization actually being
// discussed -- a CDN edge node, a documentation subdomain, a GitHub
// repository, a blog platform, a recruiting site, or a support portal is
// never itself the vendor, regardless of which real company's content it
// happens to host. This only gates the domain-fallback name-derivation
// path below (deriveCandidateNameFromDomain, used when there is no
// descriptive text at all to name a vendor from) -- it never touches
// Path A (taxonomy) or Path B (heuristic text-mention extraction) above,
// so a genuine mention of one of these same platforms as an actual
// competitor (e.g. a claim that literally says "Zendesk offers...") is
// completely unaffected. Only inventing a vendor purely from a bare,
// content-less URL on one of these domain shapes is excluded.
const nonCompetitorDomainPattern =
  /(?:^|\.)(?:jsdelivr\.net|unpkg\.com|cloudflare\.com|cloudflareinsights\.com|cloudfront\.net|akamaized\.net|akamai\.net|fastly\.net|amazonaws\.com|imgur\.com|unsplash\.com|cloudinary\.com|imgix\.net|staticflickr\.com|flickr\.com|readthedocs\.(?:io|org)|gitbook\.io|github\.com|githubusercontent\.com|github\.io|gitlab\.io|gitlab\.com|bitbucket\.org|medium\.com|substack\.com|blogspot\.com|wordpress\.com|hashnode\.dev|dev\.to|tumblr\.com|indeed\.com|linkedin\.com|glassdoor\.com|ziprecruiter\.com|greenhouse\.io|lever\.co|workable\.com|ashbyhq\.com|zendesk\.com|freshdesk\.com|helpscout\.com|helpscout\.net|intercom\.help|atlassian\.net|crunchbase\.com|youtube\.com|youtu\.be|vimeo\.com|facebook\.com|instagram\.com|tiktok\.com|twitter\.com|x\.com|pinterest\.com|soundcloud\.com|twitch\.tv|threads\.net)$/i;
const nonCompetitorSubdomainPattern =
  /^(?:docs?|documentation|developer|developers|api-?docs|support|helpdesk|help|jobs|careers|blog|cdn|static|assets|img|images|media)\./i;

function isNonCompetitorSourceDomain(domain: string) {
  return (
    nonCompetitorDomainPattern.test(domain) ||
    nonCompetitorSubdomainPattern.test(domain) ||
    // Confirmed live: bare citations to academic-paper publishers (e.g.
    // mdpi.com, sciencedirect.com) were reaching deriveCandidateNameFromDomain
    // below and being rendered as "competitors" (e.g. "Mdpi",
    // "Sciencedirect") -- these domains carry evidence *about* a market,
    // never a commercial vendor *in* it. Reusing the same hostname pattern
    // classifyOrganizationEntity uses for its "academic" entity type keeps
    // this single list authoritative instead of maintaining two.
    academicPublisherHostPattern.test(domain)
  );
}

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

function compactAlnum(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

// A domain-fallback name is only ever a last-resort guess at a real
// company's identity from a bare URL with no descriptive text at all. When
// the domain's own label is essentially the market's own category
// description with the spaces removed -- a common shape for programmatic/
// content-mill market-report domains (e.g. "tradecompliancesoftware.com"
// for a "trade compliance software" market) -- it names the CATEGORY, not
// a specific company. Confirmed live as the shape behind
// "Tradecompliancesoftware" reaching the competitor table. Compared with
// separators stripped from both sides since a domain label has no word
// boundaries for a normal token-set comparison.
function isGenericMarketCategoryDomainLabel(
  domainLabel: string,
  taxonomy: MarketTaxonomyProfile | null
): boolean {
  if (!taxonomy) return false;
  const compactLabel = compactAlnum(domainLabel);
  if (compactLabel.length < 6) return false;
  const categoryTerms = [taxonomy.productCategory, ...taxonomy.aliases, ...taxonomy.adjacentCategories]
    .filter(Boolean)
    .map(compactAlnum)
    .filter((term) => term.length >= 6);
  return categoryTerms.some(
    (term) => term === compactLabel || compactLabel.includes(term)
  );
}

// Last-line-of-defense shape check, applied independently of *why* a string
// became a candidate (domain fallback, heuristic mention, or any future
// extraction path) and independent of domain classification -- confirmed
// live, a Market Intelligence competitor table showed prompt/instruction
// fragments ("Conduct a comprehensive Intelligence analysis for...") and
// concatenated evidence-provider domain labels ("viewpointanalysis",
// "iaiest") alongside real competitors. A real company/product name is
// short, has no sentence punctuation, and never carries markdown, URL, or
// object-literal syntax -- this rejects anything that fails that shape
// instead of trying to enumerate every bad source, so it also covers
// domains not yet known to isNonCompetitorSourceDomain/
// classifyOrganizationEntity.
const instructionLeadingVerbPattern =
  /^(?:conduct|analyz[e]?|generate|write|provide|summarize|summarise|explain|list|identify|assess|evaluate|create|perform|produce|research|describe|compare|review|investigate|determine|prepare|draft|compile|outline)\b/i;
const markdownOrParserArtifactPattern = /[[\]{}`|]|https?:\/\/|www\.|\.(?:com|org|net|edu|gov|io)\b/i;

export function isImplausibleCompetitorName(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return true;
  if (trimmed.length > 60) return true;
  if (trimmed.includes("...") || trimmed.includes("…")) return true;
  if (markdownOrParserArtifactPattern.test(trimmed)) return true;
  if (instructionLeadingVerbPattern.test(trimmed)) return true;
  if (trimmed.split(/\s+/).length > 6) return true;
  return false;
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
    const heuristicNames = extractHeuristicMentions(text, taxonomyWords).filter(
      (name) => !isImplausibleCompetitorName(name)
    );
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

    // Path C: the item is vendor-relevant but the heuristics above found no
    // name in it -- fall back to the domain itself as the only available
    // name signal, not a taxonomy substitute to avoid, since one was never
    // found. Originally gated to isThinDomainOnlyEvidence (bare-domain
    // search results only), on the assumption that any evidence with real
    // prose would already be caught by the heuristic patterns above.
    // Confirmed live: that assumption doesn't hold for a company's own
    // press release or product brochure ("Autonomous drones meet LEA
    // Reply: Real-time inventory at LogiMAT 2026 | Reply", a full page
    // hosted on reply.com) -- substantial, not thin, but its phrasing
    // doesn't match any of mentionPatterns' narrow sentence shapes ("X
    // offers...", "X is a leading...", "Alternatives to X", "X
    // pricing/reviews"), so it produced zero candidates.
    //
    // Widening this to every non-thin, vendor-relevant item went too far,
    // though: also confirmed live, it let a third-party trade-publication
    // domain merely reporting on the market (an article on
    // inboundlogistics.com mentioning several companies) and a customer
    // company named only as an adopter/pilot site (a 3PL's own domain,
    // cited for adopting drones, not selling them) both through as
    // "vendors". Neither is thin, and both are otherwise vendor-relevant
    // evidence -- the missing distinction is whether the evidence is the
    // domain's OWN self-published content (a real corroboration signal)
    // versus third-party coverage that merely mentions other companies (no
    // signal about the domain itself). looksLikeSelfPublishedVendorContent
    // requires that distinction; every downstream step
    // (isImplausibleCompetitorName, isGenericMarketCategoryDomainLabel,
    // and validateVendorCandidate's full corroboration check) still
    // applies unchanged on top of it.
    if (
      heuristicNames.length === 0 &&
      !isNonCompetitorSourceDomain(domain) &&
      (isThinDomainOnlyEvidence(item, domain) || looksLikeSelfPublishedVendorContent(item))
    ) {
      const derivedName = deriveCandidateNameFromDomain(domain);
      if (
        derivedName &&
        !isImplausibleCompetitorName(derivedName) &&
        !isGenericMarketCategoryDomainLabel(domain, taxonomy)
      ) {
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
  // True only when every single mention that built this candidate came from
  // the domain-fallback path (Path C) -- i.e. no real descriptive text ever
  // backed this name, only a capitalized URL label. Confirmed live as the
  // shape behind unrecognized evidence-provider/academic domains reaching
  // the competitor table ("Viewpointanalysis", "Iaiest") that a fixed
  // domain list can't fully enumerate. Used to require independent,
  // official-page corroboration before such a name can ever be trusted as a
  // real vendor, since "we capitalized a bare URL" is not itself evidence.
  matchedByDomainFallbackOnly: boolean;
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
        matchedByDomainFallbackOnly: true,
      };

    if (isTaxonomyMatch) current.canonicalName = mention.name;
    current.matchedByTaxonomy = current.matchedByTaxonomy || isTaxonomyMatch;
    current.matchedByDomainFallbackOnly =
      current.matchedByDomainFallbackOnly && mention.matchedBy === "domain_fallback";
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

// Distinguishes a domain's own self-published content (a real signal that
// THIS domain belongs to a vendor) from third-party coverage that merely
// mentions other companies, or a customer/adopter's own domain (neither is
// a signal about the domain being a vendor). Used only by Path C's
// domain-fallback naming above -- reuses companyOwnedPattern's sourceType/
// title check, plus a narrow, specifically self-referential URL-path
// signal ("newsroom"/"press release", the shape a company's own PR page
// takes -- confirmed live as Reply's own evidence shape -- deliberately
// not the generic "/news/" or "/about/" many third-party media sites also
// use for their own unrelated content).
function looksLikeSelfPublishedVendorContent(item: DomainResearchEvidence) {
  if (companyOwnedPattern.test(`${item.sourceType} ${item.sourceTitle}`)) return true;
  try {
    return /\/(?:newsroom|press-release|press-releases)\//i.test(new URL(item.url).pathname);
  } catch {
    return false;
  }
}

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
    // Also recognizes a company's own newsroom/press-release page, the
    // same signal looksLikeSelfPublishedVendorContent uses above --
    // without it, a vendor whose only corroborating evidence is its own
    // press release (confirmed live: Reply's LogiMAT 2026 announcement,
    // hosted at reply.com/en/newsroom/...) could be discovered by Path C
    // but then fail validation here for the same reason it was missed
    // upstream, since neither check recognized the page as official.
    pathSignal = /\/products?|\/pricing|\/solutions?|\/features?|\/newsroom|\/press-releases?/i.test(
      new URL(item.url).pathname
    );
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
  // isOfficialVendorEvidence alone only checks the URL's domain/path shape
  // and the classifier's sourceType label -- neither requires the item to
  // carry any actual descriptive content. Confirmed live: a bare citation
  // to a candidate's own domain, with an empty/near-empty claim (the exact
  // shape isThinDomainOnlyEvidence exists to catch), was auto-labeled
  // "official company source" by the upstream classifier purely because
  // the evidence's URL happened to be on that same domain -- and that one
  // content-less item alone was then sufficient, on its own, to validate a
  // full "commercial vendor" table row (review sites, a training
  // institute, and marketing agencies all reached the competitor table
  // this way, each backed by exactly one bare-domain citation). Domain
  // existence must never be sufficient evidence by itself -- requiring the
  // "official" item to carry real descriptive content is what makes that
  // guarantee actually hold for the single-official-page validation path
  // below, not just the multi-source paths.
  const officialItems = qualifyingItems.filter(
    (item) =>
      isOfficialVendorEvidence(item, candidate.sourceDomains) &&
      !isThinDomainOnlyEvidence(item, hostnameOf(item.url))
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

  // "Substantive" text alone (real prose, not a bare domain-only citation)
  // still proves nothing about whether the candidate SELLS anything --
  // being cited by name across multiple articles as the SOURCE of a market
  // statistic ("According to Dataintelo, the market will reach $X by...")
  // produces exactly this shape: real prose, 2+ independent domains, no
  // explicit vendor-role designation anywhere in the text. Confirmed live
  // as the mechanism behind market-research/data firms ("Dataintelo",
  // "Gingercontrol") reaching the competitor table purely by citation
  // frequency. Product/pricing/customer detail is one way a source
  // establishes that -- but a legitimate directory/analyst listing that
  // simply NAMES a real company as a "vendor"/"provider"/"competitor" in
  // the market (e.g. "Gartner names QuickBooks, Xero, Sage, and NetSuite
  // as accounting software vendors") is an equally valid, and common,
  // shape for real vendor corroboration that carries no product-feature or
  // pricing detail of its own. Requiring either keeps the
  // two-independent-sources path scoped to what it was meant to validate
  // (a real vendor independently described as participating in the
  // market) without narrowing it to only product/pricing-detailed
  // mentions.
  const vendorRoleDesignationPattern =
    /\b(?:vendor|vendors|provider|providers|solution provider|software provider|competitor|competitors|company|companies|player|players)\b/i;
  const vendorRoleItems = qualifyingItems.filter((item) =>
    vendorRoleDesignationPattern.test(`${item.claim} ${item.value}`)
  );
  const hasCommercialProductSignal =
    productItems.length > 0 ||
    pricingItems.length > 0 ||
    customerItems.length > 0 ||
    vendorRoleItems.length > 0;

  // A name that only ever came from the domain-fallback path (Path C -- a
  // capitalized URL label, never real descriptive text) is not itself
  // evidence of anything: it needs an actual official product/pricing page
  // to be trusted as a real vendor. Without this guard, an evidence-provider
  // or academic domain that a fixed exclusion list doesn't yet recognize can
  // still validate purely by being cited as a bare URL from two mirrors, or
  // by incidentally sharing a candidate merge with unrelated filing
  // evidence -- confirmed live as the shape behind unrecognized domains
  // ("Viewpointanalysis", "Iaiest") reaching the competitor table.
  const paths: Array<[boolean, string]> = candidate.matchedByDomainFallbackOnly
    ? [
        [officialEvidenceCount >= 1 && independentDomainCount >= 2, "official_product_page_plus_independent_source"],
        [officialEvidenceCount >= 1 && reviewEvidenceCount >= 1, "official_page_plus_customer_review_evidence"],
        [officialEvidenceCount >= 1, "official_page_plus_product_documentation"],
      ]
    : [
        [officialEvidenceCount >= 1 && independentDomainCount >= 2, "official_product_page_plus_independent_source"],
        [officialEvidenceCount >= 1 && reviewEvidenceCount >= 1, "official_page_plus_customer_review_evidence"],
        // A verified, company-owned product/pricing page is itself the
        // "product documentation" the spec refers to, so it is sufficient
        // alone -- this is what lets a single well-formed official page
        // validate a vendor, while a single third-party mention (no
        // official page) still needs the two-independent-sources path
        // below.
        [officialEvidenceCount >= 1, "official_page_plus_product_documentation"],
        [
          independentDomainCount >= 2 && hasSubstantiveEvidence && hasCommercialProductSignal,
          "two_independent_commercial_or_industry_sources",
        ],
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
  /\b(?:implementation partner|systems? integrator|si partner|reseller partner|channel partner|app marketplace|marketplace|app store|outsourced accounting|outsourced bookkeeping|managed bookkeeping service|distributor|distribution partner|wholesale distributor|media (?:company|group|outlet|network)|news (?:outlet|organization|publication|site)|trade (?:press|publication|journal)|publishing (?:company|house)|b2b media|industry (?:media|publication)|events? (?:company|organizer|producer)|conference organizer|trade show organizer|analyst firm|research and advisory firm|market research (?:firm|company|provider|group|agency|publisher)|market intelligence (?:firm|provider|company)|industry research (?:firm|company|provider)|data (?:and|&) analytics (?:firm|company|provider))\b/i;
const managedServicesAllowancePattern = /\bmanaged (?:service|services|detection|soc|security)\b/i;

// P0 FIX -- confirmed live (LegalTech/professional-services market):
// "law firm"/"accounting firm"/"cpa firm"/"consulting firm"/"advisory
// firm"/"consultancy" are a DIFFERENT risk than the hard-exclusion terms
// above -- they are also extremely common CUSTOMER-SEGMENT descriptors for
// a B2B SaaS vendor that SELLS TO that profession. A LegalTech vendor's own
// evidence routinely reads "practice management software for law firms" or
// "AI-assisted bookkeeping services to accounting firms" -- the profession
// names WHO BUYS the product, not what the candidate itself is. A real,
// independently corroborated vendor (Clio/MyCase-shaped) was excluded
// outright as though it WERE a law firm, purely because its own evidence
// text legitimately described its target customer using this phrase -- the
// candidate never reached `vendors` OR `adjacentPlayers`, since
// assessMarketRelevance rejects a candidate before either tier can see it.
// Scoped narrowly: only suppresses the exclusion when EVERY occurrence of
// the profession term is immediately preceded by an explicit customer-
// targeting preposition ("for"/"to" + up to 4 filler words). A genuine
// self-description ("is a boutique law firm", "operates as a consultancy")
// never takes that shape, so it is still excluded -- and if even one
// occurrence reads as self-description, the exclusion still applies.
const professionalServicesFirmPattern =
  /\b(?:law firms?|accounting firms?|cpa firms?|consulting firms?|advisory firms?|consultanc(?:y|ies))\b/gi;
const customerFramingBeforeProfessionalServicesFirmPattern =
  /\b(?:for|to|serving|serves|served|used by|trusted by|built for|designed for|marketed to|offered to|sold to|sells? to|caters? to|available to)\s+(?:\S+\s+){0,4}$/i;
// P0 FIX #8 -- confirmed live (Competitive Landscape data-flow repair): a
// SECOND, equally common customer-framing shape names the profession as a
// MODIFIER of the AUDIENCE, not the candidate itself -- "rated highly by
// law firm reviewers on G2", "trusted by law firm staff", "law firm
// clients report..." -- the profession term is immediately followed by a
// role-noun describing WHO is reviewing/using/buying, never a claim about
// what the candidate is. The preceding-preposition check above only looks
// BEFORE the term and would miss this shape entirely (e.g. "rated highly
// by " does not match "used by"/"trusted by" verbatim), which is exactly
// what let a genuinely corroborated vendor (the Clio-shaped case) fail
// assessMarketRelevance purely because review-site evidence happened to
// describe its reviewers this way.
const customerFramingAfterProfessionalServicesFirmPattern =
  /^\s*(?:reviewers?|users?|customers?|clients?|buyers?|practitioners?|staff|teams?|professionals?|employees?|partners?|subscribers?)\b/i;

function matchesNonVendorRole(text: string): boolean {
  if (nonVendorRolePattern.test(text)) return true;

  const matches = [...text.matchAll(professionalServicesFirmPattern)];
  if (matches.length === 0) return false;

  return matches.some((match) => {
    if (typeof match.index !== "number") return true;
    const precedingText = text.slice(0, match.index);
    const followingText = text.slice(match.index + match[0].length);
    const readsAsCustomerFraming =
      customerFramingBeforeProfessionalServicesFirmPattern.test(precedingText) ||
      customerFramingAfterProfessionalServicesFirmPattern.test(followingText);
    return !readsAsCustomerFraming;
  });
}

/**
 * Excludes implementation partners, marketplaces, systems integrators,
 * outsourced/managed-service providers, media/publishing companies,
 * distributors, event organizers, and advisory/accounting/law firms (when
 * genuinely self-described as one, not merely named as the vendor's own
 * customer segment -- see matchesNonVendorRole above) from the vendor pool,
 * unless the market itself is about managed services (e.g. Cybersecurity
 * MDR). Always returns a human-readable reason, satisfying the "clear
 * relevance explanation" requirement for validated vendors too.
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
  if (!allowManagedServices && matchesNonVendorRole(`${candidate.canonicalName} ${evidenceText}`)) {
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
