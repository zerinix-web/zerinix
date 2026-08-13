import type { DomainResearchEvidence } from "./domain-research.ts";

export type MarketVendorEntity = {
  name: string;
  taxonomy: string;
  matchedBy: "alias" | "domain" | "company_source";
};

export type VendorDefinition = {
  name: string;
  aliases: string[];
  domains: string[];
};

export type MarketTaxonomyProfile = {
  id: string;
  productCategory: string;
  adjacentCategories: string[];
  industry: string;
  buyerCategories: string[];
  terminology: string[];
  aliases: string[];
  signals: RegExp;
  vendors: VendorDefinition[];
};

const accountingSoftwareTaxonomy: MarketTaxonomyProfile = {
  id: "accounting_software",
  productCategory: "AI accounting software",
  adjacentCategories: [
    "accounting software",
    "bookkeeping automation",
    "ERP accounting",
    "AP automation",
    "AR automation",
    "financial close software",
    "audit automation",
  ],
  industry: "Accounting and finance software",
  buyerCategories: ["SMBs", "enterprises", "accounting firms", "finance teams"],
  terminology: ["AI bookkeeping", "accounting copilot", "finance automation"],
  aliases: ["AI accounting", "automated bookkeeping", "intelligent accounting"],
  signals:
    /accounting software|bookkeeping|financial close|accounts payable|accounts receivable|general ledger|erp accounting|muhasebe yazılım/i,
  vendors: [
    { name: "Intuit (QuickBooks)", aliases: ["quickbooks", "quickbooks ai", "intuit", "intuit quickbooks", "intuit assist", "intuit accounting ai"], domains: ["quickbooks.intuit.com", "intuit.com"] },
    { name: "Xero", aliases: ["xero"], domains: ["xero.com"] },
    { name: "Sage", aliases: ["sage accounting", "sage intacct", "sage"], domains: ["sage.com"] },
    { name: "Oracle NetSuite", aliases: ["oracle netsuite", "netsuite"], domains: ["netsuite.com", "oracle.com"] },
    { name: "Microsoft Dynamics 365", aliases: ["dynamics 365", "microsoft dynamics"], domains: ["dynamics.microsoft.com"] },
    { name: "Zoho Books", aliases: ["zoho books"], domains: ["zoho.com"] },
    { name: "FreshBooks", aliases: ["freshbooks"], domains: ["freshbooks.com"] },
    { name: "BlackLine", aliases: ["blackline"], domains: ["blackline.com"] },
    { name: "FloQast", aliases: ["floqast"], domains: ["floqast.com"] },
    { name: "Vic.ai", aliases: ["vic.ai", "vic ai"], domains: ["vic.ai"] },
    { name: "Numeric", aliases: ["numeric accounting", "numeric close"], domains: ["numeric.io"] },
    { name: "Puzzle", aliases: ["puzzle accounting", "puzzle financial"], domains: ["puzzle.io"] },
    { name: "Botkeeper", aliases: ["botkeeper"], domains: ["botkeeper.com"] },
    { name: "Dext", aliases: ["dext"], domains: ["dext.com"] },
    { name: "AutoEntry", aliases: ["autoentry", "auto entry"], domains: ["autoentry.com"] },
  ],
};

const softwareTaxonomies: MarketTaxonomyProfile[] = [
  accountingSoftwareTaxonomy,
  {
    id: "legal_ai",
    productCategory: "AI legal software",
    adjacentCategories: ["legal research AI", "contract AI", "legal drafting", "e-discovery", "CLM", "legal copilot"],
    industry: "Legal technology",
    buyerCategories: ["law firms", "in-house legal teams", "compliance teams"],
    terminology: ["legal AI", "lawyer copilot", "contract intelligence"],
    aliases: ["AI for lawyers", "generative AI legal", "legal automation"],
    signals: /legal ai|ai legal|lawyer copilot|legal software|contract ai|legal research ai/i,
    vendors: [
      { name: "Harvey", aliases: ["harvey ai", "harvey"], domains: ["harvey.ai"] },
      { name: "Thomson Reuters CoCounsel", aliases: ["cocounsel", "westlaw precision ai"], domains: ["thomsonreuters.com"] },
      { name: "Lexis+ AI", aliases: ["lexis+ ai", "lexis ai"], domains: ["lexisnexis.com"] },
      { name: "vLex Vincent AI", aliases: ["vincent ai", "vlex"], domains: ["vlex.com"] },
      { name: "Spellbook", aliases: ["spellbook legal", "spellbook"], domains: ["spellbook.legal"] },
      { name: "Luminance", aliases: ["luminance"], domains: ["luminance.com"] },
      { name: "Ironclad", aliases: ["ironclad"], domains: ["ironcladapp.com"] },
      { name: "Evisort", aliases: ["evisort"], domains: ["evisort.com"] },
      { name: "Robin AI", aliases: ["robin ai"], domains: ["robinai.com"] },
      { name: "Paxton AI", aliases: ["paxton ai"], domains: ["paxton.ai"] },
    ],
  },
  {
    id: "construction_erp",
    productCategory: "Construction ERP",
    adjacentCategories: ["construction management software", "project controls", "construction accounting", "BIM collaboration", "field management"],
    industry: "Construction technology",
    buyerCategories: ["general contractors", "specialty contractors", "developers", "owners"],
    terminology: ["construction ERP", "contractor ERP", "project management platform"],
    aliases: ["construction enterprise software", "construction operations platform"],
    signals: /construction erp|contractor erp|construction management software|construction operations platform/i,
    vendors: [
      { name: "Procore", aliases: ["procore"], domains: ["procore.com"] },
      { name: "Autodesk Construction Cloud", aliases: ["autodesk construction cloud", "autodesk build"], domains: ["autodesk.com"] },
      { name: "Oracle Primavera", aliases: ["oracle primavera", "primavera p6"], domains: ["oracle.com"] },
      { name: "Sage Construction", aliases: ["sage construction", "sage 300 construction"], domains: ["sage.com"] },
      { name: "Trimble Viewpoint", aliases: ["viewpoint vista", "trimble viewpoint"], domains: ["viewpoint.com", "trimble.com"] },
      { name: "CMiC", aliases: ["cmic"], domains: ["cmicglobal.com"] },
      { name: "Acumatica Construction Edition", aliases: ["acumatica construction"], domains: ["acumatica.com"] },
      { name: "Buildertrend", aliases: ["buildertrend"], domains: ["buildertrend.com"] },
      { name: "Jonas Construction", aliases: ["jonas construction"], domains: ["jonasconstruction.com"] },
      { name: "Foundation Software", aliases: ["foundation software", "foundation construction accounting"], domains: ["foundationsoft.com"] },
    ],
  },
  {
    id: "crm_platforms",
    productCategory: "CRM platforms",
    adjacentCategories: ["sales force automation", "customer engagement", "revenue operations", "marketing automation", "customer service CRM"],
    industry: "Enterprise applications",
    buyerCategories: ["SMBs", "mid-market companies", "enterprises", "sales teams"],
    terminology: ["CRM", "sales CRM", "customer platform"],
    aliases: ["customer relationship management", "sales platform"],
    signals: /crm platforms?|customer relationship management|sales crm|customer platform/i,
    vendors: [
      { name: "Salesforce", aliases: ["salesforce"], domains: ["salesforce.com"] },
      { name: "HubSpot", aliases: ["hubspot"], domains: ["hubspot.com"] },
      { name: "Microsoft Dynamics 365", aliases: ["dynamics 365 sales", "microsoft dynamics crm"], domains: ["microsoft.com"] },
      { name: "Zoho CRM", aliases: ["zoho crm"], domains: ["zoho.com"] },
      { name: "Pipedrive", aliases: ["pipedrive"], domains: ["pipedrive.com"] },
      { name: "Freshsales", aliases: ["freshsales", "freshworks crm"], domains: ["freshworks.com"] },
      { name: "SugarCRM", aliases: ["sugarcrm"], domains: ["sugarcrm.com"] },
      { name: "SAP Sales Cloud", aliases: ["sap sales cloud", "sap crm"], domains: ["sap.com"] },
      { name: "Oracle CX Sales", aliases: ["oracle cx sales", "oracle sales"], domains: ["oracle.com"] },
      { name: "Creatio", aliases: ["creatio crm", "creatio"], domains: ["creatio.com"] },
    ],
  },
  {
    id: "cybersecurity_mdr",
    productCategory: "Cybersecurity MDR",
    adjacentCategories: ["managed detection and response", "managed XDR", "SOC as a service", "endpoint detection and response", "threat hunting"],
    industry: "Cybersecurity services",
    buyerCategories: ["SMBs", "mid-market companies", "enterprises", "security teams"],
    terminology: ["MDR", "MXDR", "managed SOC"],
    aliases: ["managed threat detection", "24/7 security monitoring"],
    signals: /cybersecurity mdr|managed detection and response|\bmdr\b|managed xdr|soc as a service/i,
    vendors: [
      { name: "CrowdStrike Falcon Complete", aliases: ["falcon complete", "crowdstrike mdr"], domains: ["crowdstrike.com"] },
      { name: "Microsoft Defender Experts", aliases: ["defender experts for xdr", "microsoft mdr"], domains: ["microsoft.com"] },
      { name: "Palo Alto Unit 42 MDR", aliases: ["unit 42 mdr", "palo alto mdr"], domains: ["paloaltonetworks.com"] },
      { name: "SentinelOne Vigilance", aliases: ["vigilance mdr", "sentinelone mdr"], domains: ["sentinelone.com"] },
      { name: "Sophos MDR", aliases: ["sophos mdr"], domains: ["sophos.com"] },
      { name: "Arctic Wolf", aliases: ["arctic wolf"], domains: ["arcticwolf.com"] },
      { name: "Rapid7 MDR", aliases: ["rapid7 mdr"], domains: ["rapid7.com"] },
      { name: "Expel", aliases: ["expel mdr", "expel"], domains: ["expel.com"] },
      { name: "Red Canary", aliases: ["red canary"], domains: ["redcanary.com"] },
      { name: "eSentire", aliases: ["esentire"], domains: ["esentire.com"] },
      { name: "Huntress", aliases: ["huntress mdr", "huntress"], domains: ["huntress.com"] },
    ],
  },
  {
    id: "healthcare_ai",
    productCategory: "Healthcare AI",
    adjacentCategories: ["clinical AI", "medical imaging AI", "ambient clinical intelligence", "healthcare workflow automation", "precision medicine AI"],
    industry: "Healthcare technology",
    buyerCategories: ["health systems", "hospitals", "clinicians", "life-sciences companies", "payers"],
    terminology: ["clinical decision support AI", "ambient scribe", "diagnostic AI"],
    aliases: ["AI in healthcare", "medical AI", "health AI"],
    signals: /healthcare ai|ai healthcare|medical ai|clinical ai|diagnostic ai|ambient clinical/i,
    vendors: [
      { name: "Aidoc", aliases: ["aidoc"], domains: ["aidoc.com"] },
      { name: "Viz.ai", aliases: ["viz.ai", "viz ai"], domains: ["viz.ai"] },
      { name: "Tempus AI", aliases: ["tempus ai", "tempus"], domains: ["tempus.com"] },
      { name: "PathAI", aliases: ["pathai"], domains: ["pathai.com"] },
      { name: "Abridge", aliases: ["abridge"], domains: ["abridge.com"] },
      { name: "Nuance DAX", aliases: ["nuance dax", "dax copilot"], domains: ["nuance.com", "microsoft.com"] },
      { name: "Suki", aliases: ["suki ai", "suki"], domains: ["suki.ai"] },
      { name: "Nabla", aliases: ["nabla copilot", "nabla"], domains: ["nabla.com"] },
      { name: "Qure.ai", aliases: ["qure.ai", "qure ai"], domains: ["qure.ai"] },
      { name: "Owkin", aliases: ["owkin"], domains: ["owkin.com"] },
    ],
  },
];

const excludedInstitutionPattern =
  /(?:census|government|department|ministry|bureau|regulator|commission|sec\b|federal reserve|association|institute|council|university|journal|reuters|bloomberg|forbes|gartner|forrester|statista|grand ?view ?research|mordor ?intelligence|research ?and ?markets|ibisworld|fortune ?business ?insights|market research|data provider|benchmark|emergenresearch|asdreports|reportsanddata|reportsandmarkets|marketsandmarkets|alliedmarketresearch|verifiedmarketresearch|verifiedmarketreports|htfmarketreport|precedenceresearch|futuremarketinsights|coherentmarketinsights|straitsresearch|6wresearch|consultanc(?:y|ies)|messefrankfurt)/i;
const genericPublisherPattern =
  /^(?:unknown|n\/?a|source|website|publisher|market research|industry report|research|company|validation required|not provided)$/i;
const invalidMetadataPattern =
  /(?:validation required|placeholder|unknown source|no source|not provided|untitled|missing publisher)/i;

function validPublicUrl(value: string) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.replace(/^www\./i, "").toLowerCase();
    if (
      !["http:", "https:"].includes(url.protocol) ||
      !hostname.includes(".") ||
      /(?:^|\.)(?:localhost|local|invalid|test)$/.test(hostname) ||
      /(?:^|\.)example\.(?:com|org|net)$/.test(hostname)
    ) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

function normalizedHost(value: string) {
  return validPublicUrl(value)?.hostname.replace(/^www\./i, "").toLowerCase() || "";
}

function containsAlias(text: string, alias: string) {
  const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, "i").test(text);
}

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

export function resolveMarketTaxonomy(
  prompt: string,
  evidence: readonly DomainResearchEvidence[]
) {
  const text = `${prompt} ${evidence.map(evidenceText).join(" ")}`;
  return softwareTaxonomies.find((taxonomy) => taxonomy.signals.test(text)) || null;
}

// No hardcoded taxonomy matched this prompt's market, so a short category
// label has to be derived from the raw text instead. Stripping a handful
// of English words and slicing to 120 chars assumed the prompt already
// read like a category name ("Analyze the AI legal software market") --
// for any non-software market, and for any non-English prompt (the
// stopwords are English-only), that left almost the entire raw prompt --
// budget, location, target-customer detail included -- sitting in the
// "Category" column of every competitor row (confirmed live: a Turkish
// car-wash business-idea prompt produced its own investment budget and
// target customer as the category). This instead keeps only the text
// before the first clause break, where narrative elaboration (budget,
// location, target customer) almost always starts, strips embedded
// currency amounts by pattern rather than by language, and caps the
// result far shorter -- a category is a few words, not a paragraph.
function extractDynamicProductCategory(prompt: string) {
  const firstClause =
    prompt.split(/[,;:.!?\n]/)[0]?.replace(/\s+/g, " ").trim() || "";
  const withoutAmounts = firstClause
    .replace(/[$€₺£]\s*\d[\d.,]*\s*[a-z]*\b/gi, "")
    .replace(/\b\d[\d.,]*\s*(?:tl|try|usd|eur|gbp|k|bin|milyon|million|thousand)\b/gi, "")
    .replace(/\b(?:analyze|analyse|market|industry|landscape|platforms?|software)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  const candidate = withoutAmounts || firstClause;
  return candidate.length <= 60
    ? candidate
    : candidate.slice(0, 60).replace(/\s+\S*$/, "").trim();
}

export function getMarketTaxonomyProfile(prompt: string) {
  const known = softwareTaxonomies.find((taxonomy) => taxonomy.signals.test(prompt));
  if (known) return known;
  const productCategory = extractDynamicProductCategory(prompt) || "requested market";
  return {
    id: "dynamic_market",
    productCategory,
    adjacentCategories: [
      `${productCategory} software`,
      `${productCategory} automation`,
      `${productCategory} platforms`,
      `${productCategory} services`,
    ],
    industry: productCategory,
    buyerCategories: ["SMBs", "mid-market organizations", "enterprises", "specialist operators"],
    terminology: [productCategory, `${productCategory} solutions`, `${productCategory} technology`],
    aliases: [`${productCategory} tools`, `${productCategory} vendors`],
    signals: /(?:)/,
    vendors: [],
  } satisfies MarketTaxonomyProfile;
}

export function expandMarketTaxonomyTerms(prompt: string) {
  const taxonomy = getMarketTaxonomyProfile(prompt);
  return [
    taxonomy.productCategory,
    ...taxonomy.adjacentCategories,
    ...taxonomy.terminology,
    ...taxonomy.aliases,
  ].filter((value, index, values) =>
    value && values.findIndex((candidate) => candidate.toLowerCase() === value.toLowerCase()) === index
  );
}

export function isExcludedCompetitorInstitution(value: string) {
  return excludedInstitutionPattern.test(value);
}

export function resolveMarketVendorEntities(
  item: DomainResearchEvidence,
  taxonomy: MarketTaxonomyProfile | null
): MarketVendorEntity[] {
  const text = evidenceText(item);
  const host = normalizedHost(item.url);
  const entities = new Map<string, MarketVendorEntity>();

  for (const vendor of taxonomy?.vendors || []) {
    const aliasMatch = vendor.aliases.some((alias) => containsAlias(text, alias));
    const domainMatch = vendor.domains.some(
      (domain) => host === domain || host.endsWith(`.${domain}`)
    );
    if (!aliasMatch && !domainMatch) continue;
    entities.set(vendor.name.toLowerCase(), {
      name: vendor.name,
      taxonomy: taxonomy!.id,
      matchedBy: domainMatch ? "domain" : "alias",
    });
  }

  const publisher = item.publisher.trim();
  // Note: this intentionally does NOT match the real "official company
  // source" classifier string (unlike the equivalent check in
  // vendor-discovery.ts). For native-fallback evidence, item.publisher is a
  // bare hostname, not a display name -- matching sourceType here would
  // surface raw domains as vendor names and bypass the academic/news-agency
  // filtering that isExcludedCompetitorInstitution doesn't cover (confirmed
  // via a live run pulling in akademik.adu.edu.tr and aa.com.tr as
  // "vendors"). The URL-path signal below is unaffected by this and remains
  // the real detector for this path; official-source detection for prose
  // evidence is handled correctly downstream by vendor-discovery.ts.
  const companyOwnedSource =
    /company website|product page|pricing page/i.test(
      `${item.sourceType} ${item.sourceTitle}`
    ) || /\/products?|\/pricing|\/solutions?|\/features?/i.test(validPublicUrl(item.url)?.pathname || "");
  if (
    companyOwnedSource &&
    entities.size === 0 &&
    publisher &&
    !genericPublisherPattern.test(publisher) &&
    !isExcludedCompetitorInstitution(publisher)
  ) {
    entities.set(publisher.toLowerCase(), {
      name: publisher,
      taxonomy: taxonomy?.id || "dynamic_software_vendor",
      matchedBy: "company_source",
    });
  }

  return [...entities.values()];
}

export function sanitizeResearchPublisher(input: {
  publisher: string;
  title: string;
  url: string;
}) {
  const url = validPublicUrl(input.url);
  if (!url) return null;
  const title = input.title.replace(/\s+/g, " ").trim();
  if (
    !title ||
    genericPublisherPattern.test(title) ||
    invalidMetadataPattern.test(title)
  ) return null;

  let publisher = input.publisher.replace(/\s+/g, " ").trim();
  if (
    !publisher ||
    genericPublisherPattern.test(publisher) ||
    invalidMetadataPattern.test(publisher)
  ) {
    const domainParts = url.hostname.replace(/^www\./i, "").split(".");
    const domainLabel = (domainParts.at(-2) || domainParts[0])
      .replace(/[-_]+/g, " ");
    publisher = domainLabel.replace(/\b\w/g, (letter) => letter.toUpperCase());
  }
  if (
    !publisher ||
    genericPublisherPattern.test(publisher) ||
    invalidMetadataPattern.test(publisher)
  ) return null;

  return {
    publisher,
    title,
    url,
  };
}
