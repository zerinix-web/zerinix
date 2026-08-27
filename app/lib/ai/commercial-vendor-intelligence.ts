import type { DomainResearchEvidence } from "./domain-research.ts";

export type OrganizationEntityType =
  | "commercial_vendor"
  | "customer_adopter"
  | "channel_partner"
  | "government"
  | "regulator"
  | "standards_body"
  | "research_provider"
  | "analyst_firm"
  | "consultancy"
  | "academic"
  | "open_source"
  | "community"
  | "unknown";

// The 7 explicit roles Competitive Landscape eligibility is judged
// against. OrganizationEntityType stays more granular (it distinguishes,
// e.g., a regulator from a standards body) for everything else that reads
// it; this is a presentation-layer grouping onto exactly the categories a
// competitor-role review needs, used for reporting/testing and by the
// eligibility gate below -- it does not change classifyOrganizationEntity's
// own detection logic.
export type CompetitorRoleCategory =
  | "commercial_vendor"
  | "customer_adopter"
  | "channel_partner"
  | "research_publication_source"
  | "government_regulator"
  | "industry_association"
  | "unknown_insufficient_evidence";

export function toCompetitorRoleCategory(
  entityType: OrganizationEntityType
): CompetitorRoleCategory {
  switch (entityType) {
    case "commercial_vendor":
      return "commercial_vendor";
    case "customer_adopter":
      return "customer_adopter";
    case "channel_partner":
      return "channel_partner";
    case "government":
    case "regulator":
      return "government_regulator";
    case "standards_body":
      return "industry_association";
    case "research_provider":
    case "analyst_firm":
    case "consultancy":
    case "academic":
    case "open_source":
    case "community":
      return "research_publication_source";
    default:
      return "unknown_insufficient_evidence";
  }
}

// Only a confirmed commercial vendor may enter Competitive Landscape or
// Major Players. Every other role -- including "unknown_insufficient_evidence"
// -- is excluded: role must be affirmatively confirmed, not merely
// unproven-otherwise, matching the same "never fabricate, default to
// insufficient evidence" posture already used throughout this pipeline.
export function isEligibleCompetitorRole(role: CompetitorRoleCategory): boolean {
  return role === "commercial_vendor";
}

export type ClassifiedOrganizationEntity = {
  name: string;
  entityType: OrganizationEntityType;
  url: string;
  evidenceIds: string[];
  confidence: number;
  reason: string;
};

type EntityClassificationInput = {
  name: string;
  url?: string;
  sourceType?: string;
  context?: string;
  knownCommercialVendor?: boolean;
};

function host(value = "") {
  try {
    return new URL(value).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

function matches(value: string, pattern: RegExp) {
  return pattern.test(value.replace(/[._-]+/g, " "));
}

// Major academic-paper publishers/repositories on commercial-looking TLDs
// (.com/.net/.org), confirmed live to leak into the competitor table:
// evidence citing a market statistic to an MDPI- or ScienceDirect-hosted
// paper has no ".edu" domain and rarely spells out "university"/"academic"
// in its title, so the generic keyword check above never caught it -- the
// bare hostname "mdpi.com"/"sciencedirect.com" then survived
// classifyOrganizationEntity as "unknown" and was free to become a vendor
// candidate through the domain-name fallback path in vendor-discovery.ts.
// Matched by hostname alone, independent of any surrounding text.
export const academicPublisherHostPattern =
  /(?:^|\.)(?:mdpi\.com|sciencedirect\.com|springer\.com|springerlink\.com|nature\.com|wiley\.com|onlinelibrary\.wiley\.com|tandfonline\.com|jstor\.org|ieee\.org|ieeexplore\.ieee\.org|plos\.org|frontiersin\.org|biorxiv\.org|medrxiv\.org|semanticscholar\.org|researchgate\.net|ncbi\.nlm\.nih\.gov|pubmed\.ncbi\.nlm\.nih\.gov|doi\.org|sagepub\.com|degruyter\.com|cambridge\.org|oup\.com|academic\.oup\.com|elsevier\.com|hindawi\.com|emerald\.com|arxiv\.org|ssrn\.com|researchsquare\.com|preprints\.org|scholar\.google\.com)$/i;

/**
 * Classifies an organization into one mutually exclusive role. Institutional
 * roles are resolved before commercial status so that an official or research
 * publisher can never become a competitor merely because it has a website.
 */
export function classifyOrganizationEntity(
  input: EntityClassificationInput
): Pick<ClassifiedOrganizationEntity, "entityType" | "confidence" | "reason"> {
  const hostname = host(input.url);
  const text = `${input.name} ${hostname} ${input.sourceType || ""} ${input.context || ""}`;

  // A taxonomy match classifies the subject of the evidence. It intentionally
  // precedes publisher-role detection because an analyst page may mention a
  // real vendor without turning that vendor into an analyst firm.
  if (input.knownCommercialVendor) {
    return { entityType: "commercial_vendor", confidence: 98, reason: "Matched to the market taxonomy's commercial vendor catalog." };
  }
  if (
    hostname === "kap.org.tr" ||
    hostname.endsWith(".kap.org.tr") ||
    matches(
      text,
      /\b(?:sec|securities and exchange commission|irs|internal revenue service|finra|federal trade commission|ftc|fda|edgar|regulator|regulatory authority|regulatory organization|kamuyu aydinlatma|kamuyu aydınlatma|public disclosure platform)\b/i
    )
  ) {
    return { entityType: "regulator", confidence: 98, reason: "Regulatory authority, filing platform, or disclosure system." };
  }
  if (
    // ".gov" alone only covers US federal domains -- national and
    // supranational governments publish from many other official TLD/
    // domain shapes (UK/AU/international ".gov.xx", Canada's ".gc.ca",
    // France's ".gouv.fr", Japan's ".go.jp", Latin America's ".gob.xx",
    // multilateral-treaty bodies' ".int", and the EU institutions' shared
    // "europa.eu" domain, e.g. ec.europa.eu, europarl.europa.eu). Matching
    // the general shape instead of one country's suffix is what makes this
    // generalize, rather than adding country-specific domains one at a
    // time as each one is found leaking into a competitor table.
    /\.gov$|\.gov\.[a-z]{2,3}$|\.gc\.ca$|\.gouv\.fr$|\.go\.jp$|\.gob\.[a-z]{2,3}$|\.int$|(?:^|\.)europa\.eu$/i.test(
      hostname
    ) ||
    matches(text, /\b(?:bea|bureau of economic analysis|bls|bureau of labor statistics|gsa|general services administration|library of congress|government agency|department of|ministry of|census bureau|european commission|european parliament|council of the european union)\b/i) ||
    // Major intergovernmental/multilateral organizations, matched by their
    // long, unambiguous full names against the whole evidence-context blob.
    // Confirmed live, OECD (oecd.org, a plain ".org" domain -- not ".int"/
    // ".gov" and no country suffix) was classified "unknown" and then
    // validated as a "commercial product vendor" purely because it had a
    // website. These are cited constantly in market research for
    // statistics/benchmarks but are never a commercial competitor in any
    // market.
    matches(
      text,
      /\b(?:organisation for economic co-?operation and development|international monetary fund|world bank|world trade organization|world health organization|united nations conference on trade and development|united nations industrial development organization|world economic forum|world intellectual property organization|international labour organization)\b/i
    ) ||
    // Short acronyms for the same organizations (oecd, imf, who, wto, ilo,
    // wipo, unctad, unido) are real words/common abbreviations elsewhere in
    // English prose ("who" above all), so -- following this file's existing
    // "bare RAND" precedent just below -- they are checked only against the
    // candidate's own name/hostname, never the full evidence-context blob,
    // to rule out a stray false-positive match inside unrelated claim text.
    /\b(?:oecd|imf|wto|who|ilo|wipo|unctad|unido)\b/i.test(`${input.name} ${hostname}`)
  ) {
    return { entityType: "government", confidence: 98, reason: "Government entity or official government domain." };
  }
  if (
    hostname === "uib.org.tr" ||
    hostname.endsWith(".uib.org.tr") ||
    /messefrankfurt/i.test(text) ||
    matches(
      text,
      /\b(?:fasb|financial accounting standards board|aicpa|iso|iec|standards body|standards organization|messe frankfurt|trade fair|exhibition organizer|ihracatcilar birligi|ihracatçılar birliği|chamber of commerce|trade association|industry association)\b/i
    )
  ) {
    return { entityType: "standards_body", confidence: 94, reason: "Trade association, exhibition organizer, or professional/technical standards body." };
  }
  if (
    matches(text, /\b(?:gartner|idc|forrester|cb insights|rand corporation)\b/i) ||
    // Bare "RAND" (the think tank) is checked against the candidate's own
    // name/hostname only, not the full context blob -- "rand" is short
    // enough that matching it against a long evidence excerpt risks a
    // stray false positive that matching it against just a name does not.
    /\brand\b/i.test(`${input.name} ${hostname}`)
  ) {
    return { entityType: "analyst_firm", confidence: 97, reason: "Market analyst firm used as an evidence source." };
  }
  if (
    matches(text, /\b(?:mckinsey|boston ?consulting ?group|bcg|bain|deloitte|pwc|pricewaterhousecoopers|kpmg|ernst ?and ?young|accenture|consulting ?firm)\b/i) ||
    // Hostnames concatenate words with no separator ("exactitudeconsultancy.com"),
    // so a plain substring check catches compounds that \b-anchored phrases miss.
    /consultanc(?:y|ies)/i.test(text)
  ) {
    return { entityType: "consultancy", confidence: 96, reason: "Consulting organization used as an evidence source." };
  }
  if (
    matches(
      text,
      /\b(?:pitchbook|crunchbase|statista|grand ?view ?research|mordor ?intelligence|ibisworld|research ?and ?markets|fortune ?business ?insights|research ?repository|data ?provider|benchmark ?resource|market ?research ?database)\b/i
    ) ||
    // Generic, brand-agnostic role phrase: evidence describing the
    // candidate itself as this kind of organization ("Dataintelo is a
    // market research and consulting firm...", "a market intelligence
    // provider covering...") is a structural role statement, not a
    // specific company's name -- matching the phrase shape, not any
    // enumerated brand, is what lets a never-before-seen market-research
    // publisher (confirmed live: "Dataintelo", cited only as the source of
    // a market-size statistic, with no product/pricing/customer evidence
    // of its own) be classified correctly without adding its name to a
    // list.
    matches(
      text,
      /\b(?:market research (?:firm|company|provider|group|agency|publisher)|market intelligence (?:firm|provider|company)|research (?:and|&) (?:consulting|advisory) (?:firm|company)|industry research (?:firm|company|provider)|data (?:and|&) analytics (?:firm|company|provider))\b/i
    ) ||
    // Same concatenated-hostname issue as above (e.g. "emergenresearch.com",
    // "asdreports.com") — matched as bare substrings since these are
    // known market-research-report publisher domains, not prose keywords.
    /emergenresearch|asdreports|reportsanddata|reportsandmarkets|marketsandmarkets|alliedmarketresearch|verifiedmarketresearch|verifiedmarketreports|htfmarketreport|globenewswire|prnewswire|businesswire|indexbox|precedenceresearch|futuremarketinsights|coherentmarketinsights|straitsresearch|6wresearch/i.test(
      text
    ) ||
    // Generalizes the above beyond an enumerated brand list: any
    // organization whose own hostname is a compound built from a generic
    // research/analyst/media-publisher noun ("expertinsights.com",
    // "giiresearch.com", "techcontentwave.com") is classified by what kind
    // of entity it structurally is, not by name -- this is what catches a
    // never-before-seen analyst or content site without adding it to any
    // list. A bare substring test (matching the established technique
    // above, since compound hostnames have no word separator for \b to
    // anchor to) against the hostname specifically, not the full evidence
    // text, so a genuine vendor whose evidence prose happens to mention
    // "market research" is unaffected.
    (hostname && /research|insights?|reports?|newswire|contentwave|mediawave|newsdigest|marketwatch/i.test(hostname)) ||
    // Well-known B2B tech-trade-press domains: general industry news and
    // analysis outlets, not commercial vendors, and their names carry none
    // of the generic "research"/"insights" words above to be caught by
    // that structural rule (e.g. "computing.co.uk", "techtarget.com").
    /techtarget|computerworld|computerweekly|informationweek|zdnet\.com|^(?:www\.)?computing\.co\.uk$/i.test(
      hostname
    )
  ) {
    return { entityType: "research_provider", confidence: 96, reason: "Research, benchmark, or company-data provider." };
  }
  if (
    hostname.endsWith(".edu") ||
    academicPublisherHostPattern.test(hostname) ||
    matches(text, /\b(?:university|college|academic|research paper repository|arxiv|ssrn)\b/i)
  ) {
    return { entityType: "academic", confidence: 95, reason: "Academic institution, publisher, or research repository." };
  }
  if (matches(text, /\b(?:open source|open-source|apache software foundation|linux foundation)\b/i)) {
    return { entityType: "open_source", confidence: 94, reason: "Open-source project or foundation." };
  }
  if (
    matches(text, /\b(?:community|forum|user group|reddit|stack overflow|github repository)\b/i) ||
    // Wikipedia/Wikimedia: a community-maintained encyclopedia, routinely
    // cited as a bare, low-content reference by web search regardless of
    // the market being researched -- never a commercial vendor in any
    // market, so classified by hostname rather than requiring specific
    // prose context.
    /(?:^|\.)wikipedia\.org$|(?:^|\.)wikimedia\.org$/i.test(hostname)
  ) {
    return { entityType: "community", confidence: 90, reason: "Community-maintained resource." };
  }
  // Checked before the weak generic commercial_vendor fallback below so a
  // customer/adopter or channel-partner signal always wins over a nearby,
  // weaker vendor-shaped phrase (e.g. a case study that also happens to
  // mention "software" or "platform"). Confirmed live: a 3PL logistics
  // company (DSV) cited only for adopting inventory drones as a customer
  // reached the competitor table -- classifyOrganizationEntity had no
  // category for "real company, but not the seller of this product" and it
  // fell through to the unexcluded "unknown" default. Deliberately excludes
  // bare "pilot"/"piloting" alone: that word is directionally ambiguous (a
  // VENDOR routinely runs its own pilot program WITH customers), so only
  // the phrases below that name the subject as the technology's user/
  // deployer are matched. A broader "improves/enhances its own operations
  // with X" shape was deliberately NOT added here: it cannot distinguish a
  // customer describing its own deployment from a vendor's own marketing
  // copy describing what its product does for customers (both use the same
  // "improves warehouse operations with drones" phrasing), so it would
  // misclassify real vendors. That gap in this pattern is covered instead
  // by vendor-intelligence.ts's domain-fallback role gate, which requires
  // an affirmative commercial_vendor signal for domain-derived candidates
  // and rejects "unknown" rather than defaulting it to allowed.
  if (
    matches(
      text,
      /\b(?:adopts?|adopting|adopted|adoption of|early adopter of|case stud(?:y|ies)|deployed by|customer of|client of|end[\s-]?user of|uses? (?:the|this|a|an)? ?(?:technology|solution|system|platform|service|drones?) (?:to|for|in)|using (?:the|this|a|an)? ?(?:technology|solution|system|platform|service|drones?) (?:to|for|in)|relies on|utilizes|implements? (?:the|this|a|an)? ?(?:technology|solution|system) for its own|for internal use|in-house use|testimonial)\b/i
    )
  ) {
    return { entityType: "customer_adopter", confidence: 80, reason: "Evidence describes this entity using, piloting, or adopting the technology as a customer, not selling it." };
  }
  if (
    matches(
      text,
      /\b(?:implementation partner|systems? integrator|si partner|reseller(?:\s+partner)?|channel partner|distribution partner|distributor|value[\s-]added reseller|\bvar\b|managed service provider|\bmsp\b|integration partner)\b/i
    )
  ) {
    return { entityType: "channel_partner", confidence: 78, reason: "Evidence describes this entity as an implementation, integration, reseller, or channel partner rather than the vendor selling its own competing product." };
  }
  if (
    matches(
      text,
      /\b(?:trade (?:press|publication|journal)|news (?:outlet|organization|publication|site)|media (?:company|group|outlet|network)|magazine|editorial|according to|reports? that|article (?:by|from|in)|published (?:by|in)|industry publication|credible publication)\b/i
    )
  ) {
    return { entityType: "research_provider", confidence: 75, reason: "Evidence identifies this entity as a media/trade-publication source reporting on the market, not a commercial participant in it." };
  }
  // A URL path shape (its own /products, /pricing, /solutions, /features,
  // /newsroom, or /press-release page) is treated as an equally valid
  // affirmative signal alongside the text-phrase check below -- mirrors
  // isOfficialVendorEvidence's pathSignal in vendor-discovery.ts so a
  // vendor whose only evidence is its own newsroom/press-release page
  // (confirmed live: Reply's LogiMAT 2026 announcement) is not classified
  // "unknown" here only to be excluded by the domain-fallback role gate in
  // vendor-intelligence.ts. Deliberately narrower than that mirrored
  // regex's sourceType-label check: the raw sourceType classifyMarketResearchSourceType
  // produces, "official company source", is assigned purely from which
  // domain a citation happens to be on -- confirmed live, a customer's
  // press release (DSV) and a trade publication's article (Inbound
  // Logistics) both carry that exact label despite selling nothing, so
  // label text alone must never be sufficient here even though it is
  // allowed to count elsewhere as one signal among several.
  let officialPathSignal = false;
  try {
    // P0 PRODUCTION FIX -- confirmed live (Market Intelligence research-
    // quality failure): the original path list is entirely SaaS-site-
    // shaped (/products, /pricing, /solutions, /features are software
    // marketing-site conventions). A traditional services company
    // (a real-estate brokerage, a consultancy, a logistics provider)
    // essentially never has a "/pricing" page, so its own official
    // site could never clear this bar -- an ordinary about/investor-
    // relations page is the services-industry equivalent of a SaaS
    // site's product/pricing page, and is added here as the same kind
    // of affirmative, industry-agnostic signal, not a CRE-specific one.
    const pathname = new URL(input.url || "").pathname;
    officialPathSignal =
      /\/products?|\/pricing|\/solutions?|\/features?|\/newsroom|\/press-releases?/i.test(pathname) ||
      // The 4 new segments are anchored to a full path SEGMENT (bounded
      // by "/" or end-of-string on both sides) -- confirmed live: an
      // unanchored "/about" substring-matched inside "/about-dsv/press/
      // news/..." (DSV's own "About DSV" section used here only as a
      // parent path for an unrelated press release), incorrectly
      // treating a customer's press coverage as if it were the
      // company's own official profile page.
      /\/(?:about(?:-us)?|company|who-we-are|investor-relations?|investors?)(?:\/|$)/i.test(pathname);
  } catch {
    officialPathSignal = false;
  }
  // P0 PRODUCTION FIX -- confirmed live: a stock-ticker adjacency
  // ("CBRE Group, Inc. (NYSE:CBRE)") is an industry-agnostic, hard-to-
  // fake signal that the subject is a real, substantial, publicly
  // traded operating company -- as strong a signal as "software
  // vendor" is for a SaaS company, applicable to any industry, not
  // specific to any one company or market.
  const tickerSignal = /\((?:NYSE|NASDAQ|NYSE American|LSE|TSX|ASX)\s*:\s*[A-Z]{1,6}\)/.test(text);
  if (
    hostname &&
    (matches(text, /\b(?:company website|product page|pricing page|commercial software|software vendor)\b/i) ||
      officialPathSignal ||
      tickerSignal)
  ) {
    return { entityType: "commercial_vendor", confidence: 82, reason: "Validated company-owned product, pricing, about/investor, or newsroom/press-release source." };
  }
  return { entityType: "unknown", confidence: 35, reason: "Insufficient evidence to assign a commercial or institutional role." };
}

export function classifyEvidencePublisher(
  item: DomainResearchEvidence
): ClassifiedOrganizationEntity {
  const classification = classifyOrganizationEntity({
    name: item.publisher,
    url: item.url,
    sourceType: item.sourceType,
    context: `${item.sourceTitle} ${item.field}`,
  });
  return {
    name: item.publisher.trim() || "Unknown publisher",
    url: item.url,
    evidenceIds: [item.id],
    ...classification,
  };
}

export function isCommercialVendorEntity(entity: {
  entityType: OrganizationEntityType;
}) {
  return entity.entityType === "commercial_vendor";
}

// P0 PRODUCTION FIX -- confirmed live (Market Intelligence research-
// quality failure): domain-research.ts's scoreResearchEvidence and
// market-research-coverage.ts's classifyMarketEvidenceSource each had
// their OWN narrow, domain-suffix-only or keyword-only authority
// classifier, with no recognition of named market-research publishers
// (IBISWorld, Grand View Research, Statista, Mordor Intelligence, ...)
// or the generic "market research firm"/"industry research provider"
// role phrases -- even though classifyOrganizationEntity above already
// recognizes exactly this class of source (entityType "research_provider"),
// just for a DIFFERENT purpose (excluding it from the competitor table).
// A citation from a real market-research publisher was scoring LOWER
// than a random blog for market-sizing purposes purely because that
// recognition never reached the authority-scoring call sites. This is
// the single shared answer to "is this evidence item's source
// authoritative for market-sizing/industry-structure claims" that both
// call sites now use, so the two systems can never diverge again.
const authoritativeMarketEvidenceEntityTypes = new Set<OrganizationEntityType>([
  "government",
  "regulator",
  "standards_body",
  "research_provider",
  "analyst_firm",
  "consultancy",
  "academic",
]);

export function isAuthoritativeMarketEvidenceSource(
  item: Pick<DomainResearchEvidence, "publisher" | "url" | "sourceType" | "sourceTitle" | "field">
): boolean {
  const classification = classifyOrganizationEntity({
    name: item.publisher,
    url: item.url,
    sourceType: item.sourceType,
    context: `${item.sourceTitle} ${item.field}`,
  });
  return authoritativeMarketEvidenceEntityTypes.has(classification.entityType);
}
