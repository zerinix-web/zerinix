import type { DomainResearchEvidence } from "./domain-research.ts";
import {
  classifyEvidencePublisher,
  classifyOrganizationEntity,
  type ClassifiedOrganizationEntity,
} from "./commercial-vendor-intelligence.ts";
import {
  calculateEvidenceConfidence,
  classifyMarketConfidence,
  type MarketConfidenceLevel,
} from "./market-research-coverage.ts";
import { getMarketTaxonomyProfile, resolveMarketTaxonomy } from "./market-taxonomy.ts";
import {
  assessMarketRelevance,
  buildVendorDiscoveryLog,
  buildVendorDiscoveryQueryPlan,
  classifyMajorPlayerLabel,
  computeVendorDiscoveryScores,
  extractVendorCandidateMentions,
  deriveCandidateNameFromDomain,
  hostnameOf,
  isImplausibleCompetitorName,
  isOfficialVendorEvidence,
  isQualifyingVendorEvidence,
  isThinDomainOnlyEvidence,
  normalizeVendorKey,
  resolveVendorIdentity,
  validateVendorCandidate,
  type MajorPlayerLabel,
  type VendorDiscoveryLog,
} from "./vendor-discovery.ts";

// Hard, structural fallback for the vendor Category column -- confirmed
// live, a business-idea-style prompt ("...the commercial opportunity of
// launching an AI-powered X...") produced a Category value containing
// that exact prompt fragment even for real, correctly-discovered
// competitors (ServiceNow, IBM). profile.productCategory is a best-effort
// derivation from free-text prompt input for markets with no curated
// taxonomy entry; a smarter regex only shrinks the failure surface, it
// cannot eliminate it for every possible prompt phrasing. This is the
// guarantee: whatever profile.productCategory resolves to, it is validated
// with the same shape check applied to vendor names (rejects
// instruction-verb-led text, "...", markdown/URL artifacts, overly long or
// multi-clause spans) before it is ever allowed into a rendered field, so
// prompt/query text can never reach the report through this column
// regardless of how the extraction upstream behaves.
const uncategorizedVendorLabel = "Not independently classified";

function safeVendorCategory(candidate: string): string {
  return candidate && !isImplausibleCompetitorName(candidate)
    ? candidate
    : uncategorizedVendorLabel;
}

export type VendorMarketPosition =
  | "Market Leader"
  | "Challenger"
  | "Emerging"
  | "Niche";

export type VendorClassification =
  | VendorMarketPosition
  | "Vertical Specialist"
  | "Open Source"
  | "Enterprise"
  | "SMB";

export type VendorPricingModel =
  | "Subscription"
  | "Seat pricing"
  | "Usage pricing"
  | "Enterprise"
  | "Transaction"
  | "Success fee"
  | "Hybrid"
  | "Public list price"
  | "Quote-based"
  | "Per user"
  | "Per company"
  | "Per document"
  | "Services included";

export type VendorIntelligence = {
  name: string;
  canonicalName: string;
  aliases: string[];
  productName: string;
  companyName: string;
  parentCompany: string;
  category: string;
  segment: string;
  aiCapability: string;
  keyUseCases: string[];
  headquarters: string;
  targetCustomer: string;
  website: string;
  evidenceSources: string[];
  evidenceDomains: string[];
  evidenceCount: number;
  mentionCount: number;
  discoveryQueries: string[];
  firstSeen: string;
  lastSeen: string;
  confidence: number;
  confidenceLevel: MarketConfidenceLevel;
  position: VendorMarketPosition;
  majorPlayerLabel: MajorPlayerLabel;
  classifications: VendorClassification[];
  pricingModels: VendorPricingModel[];
  pricingEvidence: string;
  strength: string;
  weakness: string;
  // TASK #33 -- confirmed live (source-provenance audit): strength/
  // weakness/pricingEvidence above are each already selected from ONE
  // specific evidence item (strengthItem/weaknessItem/pricingItem) at
  // build time -- but only their .claim/.value TEXT was ever copied
  // forward, discarding which evidence item actually produced each
  // claim. That meant a vendor's overall existence corroboration
  // (evidenceSources/evidenceCount) was the only per-competitor
  // provenance that survived to the report, silently standing in for
  // attribute-level provenance it was never computed from. Persisting
  // the specific id per attribute (null when no qualifying item existed
  // for that attribute) closes that gap with data already computed here,
  // not a new inference.
  strengthEvidenceId: string | null;
  weaknessEvidenceId: string | null;
  pricingEvidenceId: string | null;
  featureEvidenceCount: number;
  productEvidenceCount: number;
  customerEvidenceCount: number;
  marketMentionCount: number;
  independentEvidenceCount: number;
  officialEvidenceCount: number;
  pricingEvidenceCount: number;
  sourceDiversityScore: number;
  commercialConfidence: number;
  marketRelevanceScore: number;
  overallVendorScore: number;
  marketRelevance: string;
  validationPath: string;
  rankingScore: number;
  eligibleForMajorPlayers: boolean;
};

export type VendorCoverage = {
  vendorCount: number;
  independentProviderSources: number;
  vendorsWithPricingEvidence: number;
  vendorsWithFeatureEvidence: number;
  vendorsWithCustomerEvidence: number;
  competitiveCoverageScore: number;
  sufficient: boolean;
  reason: string;
};

// A candidate that is genuinely relevant to this market (passed
// assessMarketRelevance -- not an implementation partner, marketplace,
// distributor, media company, or advisory firm) and has at least one
// qualifying piece of evidence naming it, but does not clear
// validateVendorCandidate's stricter multi-path independent-corroboration
// bar required for `vendors` (direct, comparable competitors). Distinct
// from a validated vendor -- never eligible for the competitor table or a
// "validated competitor" claim -- and distinct from being dropped
// entirely: real, evidence-named companies operating in or near this
// market must be surfaced honestly as such (see market-intelligence-
// graph.ts's majorPlayers fallback), not silently discarded just because
// they don't meet the direct-competitor bar, and never upgraded to one.
export type AdjacentMarketPlayer = {
  name: string;
  evidenceIds: string[];
  evidenceCount: number;
  confidence: number;
  confidenceLevel: MarketConfidenceLevel;
  reason: string;
};

export type VendorIntelligenceGraph = {
  taxonomy: {
    productCategory: string;
    adjacentCategories: string[];
    industry: string;
    buyerCategories: string[];
    commonTerminology: string[];
    aliases: string[];
  };
  vendors: VendorIntelligence[];
  adjacentPlayers: AdjacentMarketPlayer[];
  entities: ClassifiedOrganizationEntity[];
  marketInfrastructure: ClassifiedOrganizationEntity[];
  evidenceProviders: ClassifiedOrganizationEntity[];
  coverage: VendorCoverage;
  discoveryLog: VendorDiscoveryLog;
};

function evidenceText(item: DomainResearchEvidence) {
  return [
    item.field,
    item.claim,
    item.value,
    item.sourceTitle,
    item.publisher,
    item.url,
    item.sourceType,
    ...item.supportingData,
  ].join(" ");
}

function hostname(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

function unique<T>(values: readonly T[]) {
  return [...new Set(values)];
}

function concise(value: string, maximum = 180) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= maximum
    ? normalized
    : `${normalized.slice(0, maximum - 1).trim()}…`;
}

function extractHeadquarters(values: readonly string[]) {
  for (const value of values) {
    const match = value.match(
      /(?:headquartered|headquarters|based)\s+(?:in|at)\s+([A-Z][A-Za-z .'-]{2,60})(?:[.;,]|$)/
    );
    if (match?.[1]) return match[1].trim();
  }
  return "Not established by validated evidence";
}

function extractTargetCustomer(values: readonly string[]) {
  const joined = values.join(" ");
  const targets = [
    ["Enterprise", /\benterprise|large organizations?|global companies\b/i],
    ["SMB", /\bsmbs?|small (?:and medium |to medium )?business|small firms?\b/i],
    ["Mid-market", /\bmid[- ]market|medium-sized\b/i],
    ["Professional firms", /\blaw firms?|accounting firms?|professional services\b/i],
    ["Healthcare providers", /\bhospitals?|health systems?|clinicians?|providers?\b/i],
    ["Contractors", /\bcontractors?|construction firms?|developers?\b/i],
    ["Security teams", /\bsecurity teams?|soc teams?|security operations\b/i],
  ] as const;
  const matched = targets
    .filter(([, pattern]) => pattern.test(joined))
    .map(([label]) => label);
  return matched.length
    ? matched.join(", ")
    : "Not established by validated evidence";
}

function extractPricingModels(values: readonly string[]) {
  const text = values.join(" ");
  const models: Array<[VendorPricingModel, RegExp]> = [
    ["Subscription", /\bsubscription|monthly plan|annual plan|per month|per year\b/i],
    ["Seat pricing", /\bper (?:user|seat)|seat[- ]based|user[- ]based\b/i],
    ["Usage pricing", /\busage[- ]based|consumption|per token|per request|per gb\b/i],
    ["Enterprise", /\benterprise pricing|custom quote|contact sales\b/i],
    ["Transaction", /\bper transaction|transaction fee|per invoice|per document\b/i],
    ["Success fee", /\bsuccess fee|outcome[- ]based|contingency fee\b/i],
    ["Hybrid", /\bhybrid pricing|base fee plus|subscription plus usage\b/i],
    ["Public list price", /\bpublic (?:list )?pricing|list price|published pricing|starting at \$/i],
    ["Quote-based", /\bquote[- ]based|request a quote|contact sales for pricing|custom quote\b/i],
    ["Per user", /\bper (?:user|seat)\b/i],
    ["Per company", /\bper company|per organization|flat[- ]rate company\b/i],
    ["Per document", /\bper document|per invoice|per filing\b/i],
    ["Services included", /\bservices included|implementation included|onboarding included|managed service included\b/i],
  ];
  return models.filter(([, pattern]) => pattern.test(text)).map(([model]) => model);
}

function choosePosition(
  text: string,
  evidenceCount: number,
  independentDomains: number
): VendorMarketPosition {
  if (/\bemerging|startup|new entrant|early[- ]stage\b/i.test(text)) return "Emerging";
  if (/\bniche|specialist|vertical[- ]specific\b/i.test(text)) return "Niche";
  if (
    /\bmarket leader|category leader|leading platform|largest provider\b/i.test(text) ||
    (evidenceCount >= 4 && independentDomains >= 3)
  ) return "Market Leader";
  return evidenceCount >= 2 ? "Challenger" : "Niche";
}

function classificationsFor(
  text: string,
  position: VendorMarketPosition,
  targetCustomer: string
): VendorClassification[] {
  return unique([
    position,
    ...(/\bvertical|industry[- ]specific|specialist\b/i.test(text)
      ? (["Vertical Specialist"] as const)
      : []),
    ...(/\bopen source|source-available\b/i.test(text)
      ? (["Open Source"] as const)
      : []),
    ...(targetCustomer.includes("Enterprise")
      ? (["Enterprise"] as const)
      : []),
    ...(targetCustomer.includes("SMB") ? (["SMB"] as const) : []),
  ]);
}

function coverageScore(input: Omit<VendorCoverage, "competitiveCoverageScore" | "sufficient" | "reason">) {
  const vendorScore = Math.min(35, input.vendorCount * 2.5);
  const providerScore = Math.min(20, input.independentProviderSources * 4);
  const pricingScore = Math.min(15, input.vendorsWithPricingEvidence * 2.5);
  const featureScore = Math.min(15, input.vendorsWithFeatureEvidence * 2);
  const customerScore = Math.min(15, input.vendorsWithCustomerEvidence * 2.5);
  return Math.round(vendorScore + providerScore + pricingScore + featureScore + customerScore);
}

function vendorRankingScore(input: {
  independentEvidenceCount: number;
  featureEvidenceCount: number;
  pricingEvidenceCount: number;
  customerEvidenceCount: number;
  marketMentionCount: number;
}) {
  return Math.round(
    Math.min(30, input.independentEvidenceCount * 10) +
    Math.min(20, input.featureEvidenceCount * 10) +
    Math.min(20, input.pricingEvidenceCount * 10) +
    Math.min(15, input.customerEvidenceCount * 7.5) +
    Math.min(15, input.marketMentionCount * 5)
  );
}

function mergeEntity(
  entities: Map<string, ClassifiedOrganizationEntity>,
  entity: ClassifiedOrganizationEntity
) {
  const key = entity.name.toLocaleLowerCase("en");
  const current = entities.get(key);
  if (!current) {
    entities.set(key, entity);
    return;
  }
  const evidenceIds = unique([...current.evidenceIds, ...entity.evidenceIds]);
  const rolePriority = {
    regulator: 11,
    government: 10,
    standards_body: 9,
    academic: 8,
    analyst_firm: 7,
    research_provider: 6,
    consultancy: 5,
    open_source: 4,
    community: 3,
    // Ranked above commercial_vendor for the same reason every other
    // non-vendor institutional role above outranks it: if one evidence
    // item calls an entity a customer/adopter or channel partner and
    // another (more weakly) suggests it's a vendor, the disqualifying
    // classification wins the merge, not the vendor one.
    customer_adopter: 3,
    channel_partner: 3,
    commercial_vendor: 2,
    unknown: 1,
  } as const;
  const preferred =
    rolePriority[entity.entityType] > rolePriority[current.entityType] ||
    (rolePriority[entity.entityType] === rolePriority[current.entityType] &&
      entity.confidence > current.confidence)
      ? entity
      : current;
  entities.set(key, {
    ...preferred,
    evidenceIds,
    url: preferred.url || current.url || entity.url,
    confidence: Math.max(current.confidence, entity.confidence),
  });
}

const nonVendorInstitutionalTypes = new Set([
  "government",
  "regulator",
  "standards_body",
  "research_provider",
  "analyst_firm",
  "consultancy",
  "academic",
  "open_source",
  "community",
  // customer_adopter/channel_partner: a real, cited company that the
  // evidence describes as using/piloting/adopting the technology, or as
  // an implementation/channel partner -- neither sells a competing
  // product in this market, so neither may reach Competitive Landscape
  // or Major Players, the same as any other non-vendor institutional
  // role above.
  "customer_adopter",
  "channel_partner",
]);

// P0 PRODUCTION FIX -- confirmed live (Market Intelligence research-
// quality failure), verified by direct instrumentation: candidate.sourceUrls[0]
// is simply the FIRST url among the evidence that happened to MENTION
// this candidate's name -- for a candidate discovered inside a third-
// party market-research report (e.g. IBISWorld's report enumerating
// "CBRE, JLL, ..."), that url is IBISWorld's own domain, not the named
// company's. Passing it straight through to classifyOrganizationEntity
// as "this candidate's url" let the PUBLISHER's own domain (a known
// research-publisher hostname) get misread as the CANDIDATE's own
// hostname, misclassifying CBRE/JLL/etc. themselves as "research_provider"
// and discarding them before validateVendorCandidate or
// assessMarketRelevance ever ran. A url is only passed through when its
// hostname plausibly belongs to the candidate itself (a substring match
// against the candidate's own normalized name, the same normalization
// resolveVendorIdentity already uses for merging) -- otherwise
// classification correctly falls back to text-only signals rather than
// misattributing a third party's domain.
function urlPlausiblyBelongsToCandidate(url: string, canonicalName: string): boolean {
  // Reuses deriveCandidateNameFromDomain -- the EXACT same function that
  // names a domain-fallback candidate in the first place (vendor-
  // discovery.ts) -- rather than an independently-written domain-parsing
  // rule. Confirmed live: an earlier, independent implementation here
  // took the hostname's FIRST label ("vendor-a" from
  // "vendor-a.example.com"), while deriveCandidateNameFromDomain
  // (correctly) takes the label before the public suffix ("example"),
  // treating "vendor-a" as a subdomain -- the mismatch meant a
  // genuinely domain-owned candidate could never match its own url.
  // Reusing the real function guarantees this check can never drift
  // from how domain-fallback candidates are actually named.
  const domain = hostnameOf(url);
  if (!domain) return false;
  const derivedName = deriveCandidateNameFromDomain(domain);
  if (!derivedName) return false;
  const normalizedDerived = normalizeVendorKey(derivedName).replace(/\s+/g, "");
  const normalizedCandidate = normalizeVendorKey(canonicalName).replace(/\s+/g, "");
  if (!normalizedDerived || !normalizedCandidate) return false;
  return normalizedDerived === normalizedCandidate;
}

export function buildVendorIntelligenceGraph(
  evidence: readonly DomainResearchEvidence[],
  prompt: string
): VendorIntelligenceGraph {
  const taxonomy = resolveMarketTaxonomy(prompt, evidence);
  const profile = taxonomy || getMarketTaxonomyProfile(prompt);
  const evidenceById = new Map(evidence.map((item) => [item.id, item] as const));
  const organizationEntities = new Map<string, ClassifiedOrganizationEntity>();

  // Institutional classification is keyed off every evidence item's raw
  // publisher, independent of vendor discovery below, so regulators,
  // government, and analyst/research entities are always captured.
  for (const item of evidence) {
    mergeEntity(organizationEntities, classifyEvidencePublisher(item));
  }

  // Candidate discovery: taxonomy alias/domain matches plus heuristic
  // mentions from vendor-relevant evidence (review/directory sites,
  // vendor-relevant fields and source types) so markets without a hardcoded
  // taxonomy still produce real candidates.
  const mentions = extractVendorCandidateMentions(evidence, taxonomy);
  const aggregatedCandidates = resolveVendorIdentity(mentions);
  const queryPlan = buildVendorDiscoveryQueryPlan(prompt, profile);

  const relevantEvidenceIds = new Set<string>();
  const acceptedEvidenceIds = new Set<string>();
  const adjacentPlayerCandidates: AdjacentMarketPlayer[] = [];

  const vendors = [...aggregatedCandidates.values()]
    .flatMap((candidate) => {
      const allItems = candidate.evidenceIds
        .map((id) => evidenceById.get(id))
        .filter((item): item is DomainResearchEvidence => Boolean(item));
      if (allItems.length === 0) return [];
      for (const item of allItems) relevantEvidenceIds.add(item.id);

      const qualifyingItems = allItems.filter(isQualifyingVendorEvidence);
      const evidenceTextJoined = allItems.map(evidenceText).join(" ");
      // P0 PRODUCTION FIX -- confirmed live (Market Intelligence research-
      // quality failure), verified by direct instrumentation: evidenceText()
      // (used for evidenceTextJoined above, correctly, for
      // assessMarketRelevance's broader relevance check below) includes
      // each item's own `publisher` field -- appropriate when asking
      // "does this text describe a research/analyst organization" about
      // the PUBLISHER itself (classifyEvidencePublisher, used elsewhere),
      // but wrong here: this call classifies the CANDIDATE named in the
      // evidence, not who published it. A real market-research report
      // enumerating several companies by name ("IBISWorld reports the
      // leading commercial real estate services firms are CBRE, JLL,
      // ...") put the publisher "IBISWorld" into every one of those
      // candidates' own classification text, and classifyOrganizationEntity's
      // exact-brand-name research-publisher check then matched the
      // PUBLISHER's name and misclassified CBRE/JLL/etc. themselves as
      // "research_provider" -- discarding real, evidence-backed
      // competitors before validateVendorCandidate or
      // assessMarketRelevance ever got a chance to evaluate them. Only
      // claim/value/sourceTitle (what the evidence actually SAYS) is used
      // here; publisher/url/sourceType/supportingData (which describe the
      // SOURCE, not the subject) are deliberately excluded.
      const candidateDescriptionText = allItems
        .flatMap((item) => [item.claim, item.value, item.sourceTitle])
        .join(" ");

      // Curated taxonomy matches are trusted as commercial by construction
      // (matching prior behavior); everything else runs the full
      // institutional classifier so regulators/analysts/research firms
      // picked up by the heuristic path are never treated as vendors.
      const preliminaryClassification = candidate.matchedByTaxonomy
        ? {
            entityType: "commercial_vendor" as const,
            confidence: 98,
            reason: "Matched to the market taxonomy's commercial vendor catalog.",
          }
        : (() => {
            const candidateOwnUrl = candidate.sourceUrls.find((url) =>
              urlPlausiblyBelongsToCandidate(url, candidate.canonicalName)
            );
            const classification = classifyOrganizationEntity({
              name: candidate.canonicalName,
              url: candidateOwnUrl || "",
              sourceType: allItems[0].sourceType,
              context: candidateDescriptionText,
              knownCommercialVendor: false,
            });
            // P0 FIX #8 -- confirmed live (Competitive Landscape data-flow
            // repair): a candidate discovered via a genuine descriptive
            // heuristic mention (NOT a bare domain-fallback guess) already
            // matched one of extractVendorCandidateMentions' own
            // vendor-signal-verb patterns ("offers"/"provides"/"is a
            // cloud-based"/"is a leading"/...) to be named a candidate at
            // all -- a real, deliberate signal that the evidence describes
            // a commercial product. classifyOrganizationEntity's own
            // "commercial_vendor" bar only recognizes a narrow, exact
            // phrase set ("company website"/"product page"/"software
            // vendor"/...) that ordinary third-party review-site or press
            // coverage describing a real vendor (e.g. "Clio is a
            // cloud-based legal practice management platform rated highly
            // by reviewers on G2") almost never uses verbatim, so a
            // genuinely commercial candidate fell through to the generic
            // "unknown" default and was discarded here -- before
            // validateVendorCandidate (the real, unchanged existence bar)
            // or assessMarketRelevance (the real, unchanged relevance
            // filter) ever got a chance to evaluate it, and before it
            // could even become an honestly-labeled adjacentPlayers entry.
            // Only upgrades the AMBIGUOUS "unknown" default -- every
            // SPECIFIC non-vendor classification (government/regulator/
            // academic/community/customer_adopter/channel_partner/
            // research_provider/...) is still fully respected and excludes
            // the candidate exactly as before; domain-fallback candidates
            // (no descriptive mention at all) are untouched by this branch
            // and still require an explicit commercial_vendor signal.
            if (!candidate.matchedByDomainFallbackOnly && classification.entityType === "unknown") {
              return {
                entityType: "commercial_vendor" as const,
                confidence: classification.confidence,
                reason:
                  "Discovered via a commercial-product-shaped mention (e.g. an \"offers\"/\"provides\"/\"is a cloud-based\" pattern) with no specific non-vendor institutional signal found.",
              };
            }
            // TASK #68A -- CRITICAL FIX, confirmed live against a real
            // report: OpenAI's native web_search tool commonly returns a
            // bare URL citation with the domain itself as the ENTIRE
            // "claim"/"value"/"sourceTitle" text (e.g. claim="niceactimize.com"),
            // which extractVendorCandidateMentions correctly recognizes via
            // Path C (domain-fallback) -- but with no descriptive text at
            // all, classifyOrganizationEntity always falls to the generic
            // "unknown" default here, and the OUTER discard below
            // (matchedByDomainFallbackOnly && entityType !== "commercial_vendor")
            // then dropped the candidate entirely, BEFORE validateVendorCandidate
            // or assessMarketRelevance ever ran -- even though the report's
            // own narrative sections (Threats, Industry Trends, Executive
            // Summary) cited this exact vendor by name from 4 distinct
            // official niceactimize.com sub-pages (overview, PEP-screening,
            // a marketplace listing, a product brochure), each independently
            // tagged sourceType "official company source" by the research
            // pipeline's own, already-computed source classifier -- a real
            // identity signal, not a guess from citation volume alone. This
            // upgrades ONLY the ambiguous "unknown" default, and ONLY when
            // 2+ INDEPENDENT domains among this candidate's own qualifying
            // evidence are already labeled "official company source" --
            // narrower than the heuristic-mention upgrade above (which
            // needs just one non-vendor signal absent), since a domain-
            // fallback name has no descriptive text to corroborate it with
            // at all. A single bare citation, a non-official sourceType, or
            // an institution/academic domain (already excluded upstream by
            // isNonCompetitorSourceDomain/classifyOrganizationEntity's own
            // specific non-vendor types, which this branch never overrides)
            // still cannot pass this bar. This does not touch
            // validateVendorCandidate's own stricter, unmodified
            // corroboration paths below -- a candidate upgraded here still
            // requires official, non-thin evidence to become a fully
            // validated `vendors` entry; thin-only evidence like this can
            // still only ever reach the honestly-labeled adjacentPlayers
            // tier further below.
            if (candidate.matchedByDomainFallbackOnly && classification.entityType === "unknown") {
              const officialSourceDomainCount = new Set(
                qualifyingItems
                  .filter((item) => item.sourceType === "official company source")
                  .map((item) => hostnameOf(item.url))
                  .filter(Boolean)
              ).size;
              if (officialSourceDomainCount >= 2) {
                return {
                  entityType: "commercial_vendor" as const,
                  confidence: classification.confidence,
                  reason:
                    "Discovered via 2+ independent citations from the same company's own domain, each labeled an official company source, though with no descriptive snippet text.",
                };
              }
            }
            return classification;
          })();

      if (nonVendorInstitutionalTypes.has(preliminaryClassification.entityType)) {
        mergeEntity(organizationEntities, {
          name: candidate.canonicalName,
          entityType: preliminaryClassification.entityType,
          url: candidate.sourceUrls[0] || "",
          evidenceIds: candidate.evidenceIds,
          confidence: preliminaryClassification.confidence,
          reason: preliminaryClassification.reason,
        });
        return [];
      }

      // Candidates derived only from domain-fallback (a name/domain lifted
      // straight from a citation's own hostname, with no explicit vendor
      // mention pattern ever matching) carry no positive evidence that the
      // named entity actually sells anything -- validateVendorCandidate's
      // corroboration paths were built to size evidence *volume*, not to
      // confirm commercial *role*, so a domain-fallback candidate whose text
      // never affirmatively reads as a seller (classifyOrganizationEntity
      // fell through to the generic "unknown" default rather than matching
      // the commercial_vendor fallback) must not reach the table on volume
      // alone. This is scoped to domain-fallback specifically: taxonomy and
      // heuristic-mention candidates have a stronger underlying discovery
      // signal already and are left untouched.
      if (candidate.matchedByDomainFallbackOnly && preliminaryClassification.entityType !== "commercial_vendor") {
        mergeEntity(organizationEntities, {
          name: candidate.canonicalName,
          entityType: "unknown",
          url: candidate.sourceUrls[0] || "",
          evidenceIds: candidate.evidenceIds,
          confidence: preliminaryClassification.confidence,
          reason: "Domain-derived candidate with no affirmative evidence that the entity itself sells a competing product or service.",
        });
        return [];
      }

      const validation = validateVendorCandidate(candidate, qualifyingItems);
      const relevance = assessMarketRelevance(candidate, taxonomy, evidenceTextJoined, prompt);
      const isValidatedVendor = validation.validated && relevance.relevant;

      mergeEntity(organizationEntities, {
        name: candidate.canonicalName,
        entityType: isValidatedVendor ? "commercial_vendor" : preliminaryClassification.entityType,
        url: candidate.sourceUrls[0] || "",
        evidenceIds: candidate.evidenceIds,
        confidence: isValidatedVendor
          ? Math.max(preliminaryClassification.confidence, 80)
          : preliminaryClassification.confidence,
        reason: isValidatedVendor
          ? `Validated commercial vendor via ${validation.validationPath.replace(/_/g, " ")}.`
          : preliminaryClassification.reason,
      });
      if (!isValidatedVendor) {
        // Adjacent/relevant-industry-player tier -- genuinely relevant to
        // this market (assessMarketRelevance passed, so not an
        // implementation partner/marketplace/distributor/media/advisory
        // firm) and named in at least one qualifying piece of evidence,
        // but not independently corroborated enough to be a validated,
        // directly comparable competitor (validateVendorCandidate failed).
        // Captured here -- never as a `vendors` entry, never eligible for
        // the competitor table or eligibleForMajorPlayers -- so real
        // evidence about a named player is surfaced honestly instead of
        // being silently discarded merely because Competitive Landscape
        // has no validated direct competitors to show.
        //
        // P0 PRODUCTION FIX -- confirmed live (Market Intelligence
        // research-quality failure): this tier previously required
        // `qualifyingItems.length > 0` -- the exact same label+confidence
        // bar (>=48, "Verified from official/external source") used to
        // validate a full direct competitor -- even though this tier
        // exists specifically to honestly hold companies that do NOT
        // clear that bar. A real production report named CBRE/JLL in
        // "Top Risk"/incumbent-concentration prose (generated from the
        // full evidence corpus with no confidence gate at all) while
        // Major Players said "named competitor information was limited"
        // -- an internal inconsistency, since the SAME evidence that was
        // good enough for risk prose failed this tier's needlessly strict
        // admission bar. This does not touch validateVendorCandidate,
        // assessMarketRelevance, or isQualifyingVendorEvidence -- the
        // strict `vendors`/Competitive Landscape bar is completely
        // unchanged (isValidatedVendor above is still computed purely
        // from the unmodified qualifyingItems). It only widens what
        // counts as sufficient for THIS already-lower, already-explicitly-
        // labeled "not independently validated" tier: real, substantive
        // evidence (not a bare domain-only citation, not a "Missing
        // Information" placeholder) is enough to be named honestly here,
        // even when it falls short of the verified-source/confidence bar.
        // No pricing, market share, positioning, strength, or weakness is
        // ever populated for this tier (AdjacentMarketPlayer has no such
        // fields) -- only the name, evidence count, and an explicit
        // confidence/validation-gap label.
        const substantiveNamedItems = allItems.filter(
          (item) => item.label !== "Unknown" && !isThinDomainOnlyEvidence(item, hostnameOf(item.url))
        );
        const adjacentEvidencePool = qualifyingItems.length > 0 ? qualifyingItems : substantiveNamedItems;
        if (
          preliminaryClassification.entityType === "commercial_vendor" &&
          relevance.relevant &&
          adjacentEvidencePool.length > 0 &&
          !isImplausibleCompetitorName(candidate.canonicalName)
        ) {
          const evidenceIds = unique(adjacentEvidencePool.map((item) => item.id));
          const confidence = Math.round(
            adjacentEvidencePool.reduce((sum, item) => sum + calculateEvidenceConfidence(item), 0) /
              Math.max(1, adjacentEvidencePool.length)
          );
          adjacentPlayerCandidates.push({
            name: candidate.canonicalName,
            evidenceIds,
            evidenceCount: evidenceIds.length,
            confidence,
            confidenceLevel: classifyMarketConfidence(confidence),
            reason:
              qualifyingItems.length > 0
                ? relevance.reason
                : `${relevance.reason} Evidence is directional: named in research without independently verified sourcing.`,
          });
        }
        return [];
      }

      for (const item of qualifyingItems) acceptedEvidenceIds.add(item.id);

      const values = qualifyingItems.map(evidenceText);
      const text = values.join(" ");
      const evidenceDomains = unique(
        qualifyingItems.map((item) => hostname(item.url)).filter(Boolean)
      );
      const pricingModels = extractPricingModels(values);
      const targetCustomer = extractTargetCustomer(values);
      const confidence = Math.round(
        qualifyingItems.reduce(
          (sum, item) => sum + calculateEvidenceConfidence(item),
          0
        ) / Math.max(1, qualifyingItems.length)
      );
      const position = choosePosition(text, qualifyingItems.length, evidenceDomains.length);
      const featureItems = qualifyingItems.filter((item) =>
        /feature|product|integration|deployment|capabilit|workflow/i.test(evidenceText(item))
      );
      const customerItems = qualifyingItems.filter((item) =>
        /customer|buyer|enterprise|smb|firm|hospital|contractor|security team/i.test(evidenceText(item))
      );
      const weaknessItem = qualifyingItems.find((item) =>
        /weakness|limitation|risk|gap|lacks?|constraint|downside/i.test(evidenceText(item))
      );
      const strengthItem = featureItems[0] || qualifyingItems[0];
      const pricingItem = qualifyingItems.find(
        (item) => extractPricingModels([evidenceText(item)]).length > 0
      );
      const marketMentionItems = qualifyingItems.filter((item) =>
        /market|vendor|competitor|competitive|leader|provider|platform/i.test(evidenceText(item))
      );
      const officialWebsite =
        qualifyingItems.find((item) => isOfficialVendorEvidence(item, candidate.sourceDomains))
          ?.url || "";
      const independentEvidenceCount = evidenceDomains.length;
      const rankingScore = vendorRankingScore({
        independentEvidenceCount,
        featureEvidenceCount: featureItems.length,
        pricingEvidenceCount: pricingItem ? 1 : 0,
        customerEvidenceCount: customerItems.length,
        marketMentionCount: marketMentionItems.length,
      });
      const evidenceCount = unique(qualifyingItems.map((item) => item.id)).length;
      const classifications = classificationsFor(text, position, targetCustomer);
      const scores = computeVendorDiscoveryScores(
        validation,
        candidate,
        confidence,
        relevance.relevant
      );
      const majorPlayerLabel = classifyMajorPlayerLabel({
        position,
        classifications,
        independentEvidenceCount,
        customerEvidenceCount: customerItems.length,
        marketMentionCount: marketMentionItems.length,
      });
      const parentCompanyMatch = candidate.canonicalName.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
      const parentCompany = parentCompanyMatch
        ? parentCompanyMatch[1].trim()
        : candidate.canonicalName;
      const productName = parentCompanyMatch
        ? parentCompanyMatch[2].trim()
        : candidate.canonicalName;
      const aiSignal =
        /\bai\b|artificial intelligence|machine learning|automat|copilot|generative|\bllm\b/i.test(
          text
        );

      return [
        {
          name: candidate.canonicalName,
          canonicalName: candidate.canonicalName,
          aliases: candidate.aliases,
          productName,
          companyName: parentCompany,
          parentCompany,
          category: safeVendorCategory(profile.productCategory),
          segment: targetCustomer,
          aiCapability: aiSignal
            ? "AI-enabled (evidence-supported)"
            : "Not established by validated evidence",
          keyUseCases: unique(featureItems.slice(0, 3).map((item) => concise(item.claim, 120))),
          headquarters: extractHeadquarters(values),
          targetCustomer,
          website: officialWebsite,
          evidenceSources: unique(qualifyingItems.map((item) => item.id)),
          evidenceDomains,
          evidenceCount,
          mentionCount: candidate.mentionCount,
          discoveryQueries: candidate.discoveryQueries,
          firstSeen: candidate.firstSeen,
          lastSeen: candidate.lastSeen,
          confidence,
          confidenceLevel: classifyMarketConfidence(confidence),
          position,
          majorPlayerLabel,
          classifications,
          pricingModels,
          pricingEvidence: pricingItem
            ? concise(pricingItem.value || pricingItem.claim)
            : "No validated public pricing evidence",
          strength: strengthItem?.claim
            ? concise(strengthItem.claim)
            : "No validated strength evidence",
          weakness: weaknessItem?.claim
            ? concise(weaknessItem.claim)
            : "No validated weakness evidence",
          strengthEvidenceId: strengthItem?.id ?? null,
          weaknessEvidenceId: weaknessItem?.id ?? null,
          pricingEvidenceId: pricingItem?.id ?? null,
          featureEvidenceCount: featureItems.length,
          productEvidenceCount: featureItems.length,
          customerEvidenceCount: customerItems.length,
          marketMentionCount: marketMentionItems.length,
          independentEvidenceCount,
          officialEvidenceCount: validation.officialEvidenceCount,
          pricingEvidenceCount: validation.pricingEvidenceCount,
          sourceDiversityScore: scores.sourceDiversityScore,
          commercialConfidence: scores.commercialConfidence,
          marketRelevanceScore: scores.marketRelevanceScore,
          overallVendorScore: scores.overallVendorScore,
          marketRelevance: relevance.reason,
          validationPath: validation.validationPath,
          rankingScore,
          eligibleForMajorPlayers:
            evidenceCount >= 2 && independentEvidenceCount >= 2 && rankingScore >= 40,
        } satisfies VendorIntelligence,
      ];
    })
    .sort(
      (left, right) =>
        right.rankingScore - left.rankingScore ||
        right.evidenceCount - left.evidenceCount ||
        right.confidence - left.confidence ||
        left.name.localeCompare(right.name)
    )
    .slice(0, 30);

  const rawCoverage = {
    vendorCount: vendors.length,
    independentProviderSources: new Set(
      vendors.flatMap((vendor) => vendor.evidenceDomains)
    ).size,
    vendorsWithPricingEvidence: vendors.filter(
      (vendor) => vendor.pricingModels.length > 0
    ).length,
    vendorsWithFeatureEvidence: vendors.filter(
      (vendor) => vendor.featureEvidenceCount > 0
    ).length,
    vendorsWithCustomerEvidence: vendors.filter(
      (vendor) => vendor.customerEvidenceCount > 0
    ).length,
  };
  const competitiveCoverageScore = coverageScore(rawCoverage);
  const discoveryLog = buildVendorDiscoveryLog({
    queryPlan,
    candidatesDiscovered: aggregatedCandidates.size,
    vendorsValidated: vendors.length,
    sourcesAccepted: acceptedEvidenceIds.size,
    sourcesRejected: Math.max(0, relevantEvidenceIds.size - acceptedEvidenceIds.size),
    sufficientCoverage: vendors.length >= 5,
  });
  const sufficient =
    rawCoverage.vendorCount >= 5 &&
    rawCoverage.independentProviderSources >= 2 &&
    competitiveCoverageScore >= 35;
  // Internal-facing (English-only, used for logging/diagnostics and as a
  // non-empty fallback) -- market-intelligence-graph.ts is the one place
  // this reaches a report field, and it synthesizes its own localized,
  // business-language sentence from the raw coverage numbers below rather
  // than reusing this string, so this text itself never needs to reach an
  // end user or be translated.
  const reason = sufficient
    ? `${rawCoverage.vendorCount} named competitors independently confirmed across ${rawCoverage.independentProviderSources} independent sources.`
    : rawCoverage.vendorCount === 0
      ? "No named competitors could be independently confirmed from public sources for this market."
      : `Only ${rawCoverage.vendorCount} named competitors independently confirmed across ${rawCoverage.independentProviderSources} independent sources (below the target of 5+).`;

  const entities = [...organizationEntities.values()].sort(
    (left, right) =>
      left.entityType.localeCompare(right.entityType) ||
      left.name.localeCompare(right.name)
  );
  const infrastructureTypes = new Set(["government", "regulator", "standards_body"]);
  const evidenceProviderTypes = new Set([
    "research_provider",
    "analyst_firm",
    "consultancy",
    "academic",
    "community",
  ]);

  return {
    taxonomy: {
      productCategory: profile.productCategory,
      adjacentCategories: profile.adjacentCategories,
      industry: profile.industry,
      buyerCategories: profile.buyerCategories,
      commonTerminology: profile.terminology,
      aliases: profile.aliases,
    },
    vendors,
    adjacentPlayers: adjacentPlayerCandidates
      .sort(
        (left, right) =>
          right.confidence - left.confidence ||
          right.evidenceCount - left.evidenceCount ||
          left.name.localeCompare(right.name)
      )
      .slice(0, 15),
    entities,
    marketInfrastructure: entities.filter((entity) =>
      infrastructureTypes.has(entity.entityType)
    ),
    evidenceProviders: entities.filter((entity) =>
      evidenceProviderTypes.has(entity.entityType)
    ),
    coverage: {
      ...rawCoverage,
      competitiveCoverageScore,
      sufficient,
      reason,
    },
    discoveryLog,
  };
}
