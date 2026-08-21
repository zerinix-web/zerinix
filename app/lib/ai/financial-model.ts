import crypto from "node:crypto";
import {
  getIndustryBenchmarks,
  type BenchmarkConfidence,
  type BenchmarkRange,
  type IndustryBenchmark,
  type IndustryKey,
} from "@/app/lib/ai/industry-benchmarks";

export type FinancialModelInput = {
  prompt: string;
  reportKind: "business_plan" | "market_analysis";
};

export type FinancialModelingInputs = {
  industry: string;
  industryKey: IndustryKey;
  businessModel: string;
  targetCustomer: string;
  geography: string;
  pricingModel: string;
};

export type FinancialMetricModel = {
  label: string;
  value: number;
  displayValue: string;
  unit: "usd" | "percent" | "months";
  confidence: BenchmarkConfidence;
  formula: string;
  assumptions: string[];
  benchmarkComparison: string;
};

export type FinancialConsistencyWarningCode =
  | "arr_mrr_mismatch"
  | "ltv_below_cac"
  | "weak_ltv_cac"
  | "payback_mismatch"
  | "low_gross_margin"
  | "runway_burn_mismatch"
  | "capital_efficiency"
  | "break_even_timing";

export type FinancialQuality = "Healthy" | "Needs Validation" | "High Risk";

export type FinancialConsistencyWarning = {
  code: FinancialConsistencyWarningCode;
  severity: "warning" | "critical";
  message: string;
  evidenceType: "User Provided Data" | "Benchmark Assumption" | "AI Planning Assumption";
};

export type FinancialConsistencyCheck = {
  quality: FinancialQuality;
  warnings: FinancialConsistencyWarning[];
  sources: {
    userProvidedData: string[];
    benchmarkAssumptions: string[];
    aiPlanningAssumptions: string[];
  };
};

export type BenchmarkFitLevel = "Strong Fit" | "Moderate Fit" | "Needs Validation";

export type BenchmarkFit = {
  version: "benchmark_fit_v1";
  industryKey: IndustryKey;
  industry: string;
  businessModel: string;
  benchmarkBasis: string;
  confidence: BenchmarkConfidence;
  fit: BenchmarkFitLevel;
  matchedSignals: string[];
  validationGaps: string[];
  rationale: string;
};

export type RevenueForecastYear = {
  year: string;
  customers: number;
  mrr: number;
  arr: number;
  revenue: number;
  marketPenetration: number;
};

export type FinancialModel = {
  version: "financial_model_engine_v1";
  fingerprint: string;
  reportKind: FinancialModelInput["reportKind"];
  normalizedBusinessIdea: string;
  inputs: FinancialModelingInputs;
  benchmark: {
    label: string;
    basis: string;
    ranges: IndustryBenchmark["ranges"];
  };
  benchmarkFit: BenchmarkFit;
  metrics: {
    tam: FinancialMetricModel;
    sam: FinancialMetricModel;
    som: FinancialMetricModel;
    arpa: FinancialMetricModel;
    cac: FinancialMetricModel;
    ltv: FinancialMetricModel;
    grossMargin: FinancialMetricModel;
    cacPayback: FinancialMetricModel;
    monthlyBurn: FinancialMetricModel;
    runway: FinancialMetricModel;
    arr: FinancialMetricModel;
    revenueGrowth: FinancialMetricModel;
    mrr: FinancialMetricModel;
    ebitda: FinancialMetricModel;
    breakEvenMonth: FinancialMetricModel;
    investmentNeeded: FinancialMetricModel;
    roi: FinancialMetricModel;
  };
  revenueForecast: RevenueForecastYear[];
};

function hashValue(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function normalizePrompt(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function firstMatching<T>(matches: Array<[RegExp, T]>, fallback: T, value: string) {
  return matches.find(([pattern]) => pattern.test(value))?.[1] ?? fallback;
}

export function inferIndustryKey(value: string): IndustryKey {
  const normalized = normalizePrompt(value);

  return firstMatching(
    [
      [/\b(kahve|kahveci|kafe|cafe|coffee|espresso|roastery|specialty coffee|speciality coffee|tea|beverage|içecek|icecek)\b/, "luxuryCoffee"],
      [/\b(ev charging|charging station|charge point|charger network|electric charging)\b/, "evCharging"],
      [/\b(scooter|scooters|scooter rental|micromobility|micro mobility|bike sharing|bikeshare|ride sharing|urban mobility|shared mobility)\b/, "mobility"],
      // Confirmed live: a freelance graphic-design marketplace ("milestone-
      // based payments" between clients and designers) was classified as
      // FinTech, because the bare word "payments" alone matched here --
      // "payments" is a checkout/billing FEATURE almost every marketplace,
      // e-commerce, or subscription SaaS prompt mentions, not a reliable
      // signal that the business itself IS a financial-services company.
      // Same reasoning applies to "wallet" and "insurance" (a marketplace
      // can casually mention "insurance for freelancers" as a feature
      // without being an insurtech company). Requiring the more specific
      // compound phrase below (the business's own core offering, not an
      // incidental feature mention) keeps genuine fintech/payments/
      // insurtech companies matching while no longer catching every
      // platform that merely processes payments as part of its own,
      // different core business.
      [/\b(fintech|banking|lending|neobank|insurtech|payment processing|payments? platform|payments? company|payments? gateway|payments? infrastructure|digital wallet|e-wallet|crypto wallet|money transfer|remittance|buy now pay later|\bbnpl\b|robo-advisor|insurance company|insurance platform|insurance marketplace)\b/, "fintech"],
      [/\b(ecommerce|e-commerce|online store|shopify|retail marketplace|dtc|d2c|direct to consumer|direct-to-consumer|online satış|e-ticaret)\b/, "ecommerce"],
      [/\b(marketplace|two-sided|two sided|platform marketplace)\b/, "marketplace"],
      [/\b(restaurant|food service|foodservice|fast casual|fine dining|qsr|restoran|lokanta|yemek)\b/, "restaurant"],
      // Confirmed live: a commercial shipping/fleet-operations AI platform
      // ("...automates voyage planning, monitors regulatory compliance,
      // and integrates with existing maritime ERP systems...") was
      // misclassified as Cybersecurity, contaminating its Benchmark
      // Intelligence, Financial Assumptions, and SWOT with Cybersecurity
      // terminology -- because "compliance" alone matched the
      // cybersecurity pattern below, and this logistics/maritime pattern
      // was positioned AFTER it (and after the generic "ai"/"saas"
      // catches), so firstMatching's first-match-wins order never reached
      // it. Same class of bug as the "payments" fix above: "compliance"
      // is a feature almost every regulated industry (maritime, medical,
      // financial, food safety, ...) mentions, not a reliable signal the
      // business itself IS a cybersecurity company. Moved ahead of the
      // generic catches and enriched with maritime-specific vocabulary so
      // a shipping/fleet-operations business is never shadowed by a later,
      // broader match.
      //
      // Confirmed live (round 2): an AI-native maritime logistics
      // intelligence platform for governments, ports, shipping companies,
      // and defense organizations was classified as "Drone technology /
      // autonomous systems" -- contaminating Financial Assumptions,
      // Benchmark Intelligence, SWOT, and the roadmap with drone-hardware
      // terminology -- because the prompt described drone imagery as ONE
      // of several intelligence input sources (alongside satellite
      // imagery, AIS vessel tracking, and customs data), and the "drone"
      // pattern below matched that single supporting-technology mention
      // before this logistics/maritime pattern -- positioned after it --
      // ever got a chance to match the prompt's own primary business
      // vocabulary ("maritime", "logistics", "shipping"). Same class of
      // bug as every fix in this function: a supporting input/technology a
      // platform ingests or analyzes is not the same signal as what the
      // business itself sells. Moved this pattern ahead of "drone" (and
      // enriched with maritime-intelligence-specific vocabulary: AIS
      // tracking, customs, port authority/intelligence, maritime security/
      // defense) so a maritime intelligence platform is never shadowed by
      // a later,
      // narrower match on one of its input sources -- while a genuine
      // drone manufacturer or drone-software company (no maritime/
      // logistics vocabulary anywhere in its prompt) still falls through
      // to the drone pattern below correctly.
      // "satellite imagery" is deliberately NOT included as a standalone
      // trigger here (unlike the other maritime-qualified phrases below):
      // confirmed it would otherwise misclassify unrelated agriculture,
      // insurance, and urban-planning geospatial-imagery businesses as
      // "logistics" purely because they also analyze satellite imagery --
      // the exact same false-positive shape this whole fix exists to
      // eliminate. A maritime intelligence prompt is already caught by its
      // own maritime-specific vocabulary (maritime/shipping/vessel/AIS/
      // port/customs) without needing this ambiguous, cross-industry term.
      [/\b(logistics|freight|supply chain|warehouse|delivery|shipping|maritime|vessel|vessels|fleet operations?|voyage planning|port operations|port authority|seaport|cargo|ais tracking|automatic identification system|customs clearance|customs screening|customs authority|maritime security|maritime defense|maritime intelligence|maritime analytics|maritime domain awareness|port intelligence)\b/, "logistics"],
      [/\b(drone|drones|uav|autonomous aerial|aerial robotics)\b/, "drone"],
      // Confirmed live: an AI-powered procurement platform "for global
      // automotive manufacturers" (integrating with SAP/Oracle/Dynamics,
      // predicting supplier risk, monitoring ESG compliance) was
      // classified as generic "ai" -- because "AI-powered"/"automatically"
      // matched the generic ai/automation catch below, and this
      // manufacturing pattern (which "automotive manufacturers" itself
      // matches, twice) was positioned AFTER it, so firstMatching's
      // first-match-wins order never reached it, same as the logistics/
      // cybersecurity bug above. Every genuinely specific industry pattern
      // below (healthcare/hospitality/luxuryGoods/manufacturing/fitness/
      // agriculture) is moved ahead of the generic ai/saas/cybersecurity
      // catches for the same reason: a prompt naming its own specific
      // industry almost always ALSO mentions "AI", "platform", or
      // "automation" as a feature, and the more specific signal must win.
      [/\b(hospital|clinic|healthcare|medical|patient|doctor)\b/, "healthcare"],
      [/\b(hotel|resort|hospitality|travel)\b/, "hospitality"],
      [/\b(yacht|marine|boat|ship|luxury goods|jewelry|watch)\b/, "luxuryGoods"],
      // Confirmed live: an AI-powered renewable energy portfolio
      // optimization platform for utilities was classified as "Advanced
      // manufacturing" -- contaminating Financial Assumptions, Benchmark
      // Intelligence, SWOT, and the roadmap with industrial-manufacturing
      // terminology -- because it described managing "battery storage"
      // assets, and the manufacturing pattern below matches the bare word
      // "battery" alone (a physical PRODUCT signal, not a reliable signal
      // that the business itself manufactures anything). Same class of bug
      // as the "payments"/"compliance"/"vendor" false positives fixed
      // above: an energy SOFTWARE/optimization/trading platform routinely
      // mentions batteries, grids, and utilities as the ASSETS it manages,
      // not as evidence it builds physical hardware. Moved ahead of the
      // manufacturing pattern so a genuine energy/utility/grid software
      // business is never shadowed by that later, broader match -- a
      // prompt that instead says "battery manufacturer" or "EV factory"
      // still correctly falls through to manufacturing below, since none
      // of this pattern's compound phrases match a bare manufacturing
      // claim.
      [/\b(renewable energy|clean energy|clean[\s-]?tech|solar (?:power|energy|farm|panel|asset)|\bsolar\b|wind (?:power|energy|farm|turbine)|energy grid|power grid|smart grid|grid technology|grid infrastructure|grid modernization|grid storage|energy infrastructure|energy trading|power trading|electricity trading|energy management platform|energy optimization|renewable portfolio|energy portfolio|distributed energy|microgrid|virtual power plant|demand response|battery storage|energy storage|utility company|utilities sector|energy utility|utility grid|power utility|electric utility|for utilities)\b/, "energy"],
      [/\b(battery|ev|electric vehicle|manufacturing|manufacturer|factory|industrial|automotive)\b/, "manufacturing"],
      [/\b(gym|fitness|franchise|pilates|wellness club)\b/, "fitness"],
      [/\b(farming|agriculture|vertical farm|food production|greenhouse)\b/, "agriculture"],
      // "compliance"/"security"/"threat"/"fraud" alone are features
      // countless non-cybersecurity industries mention (maritime
      // regulatory compliance, food safety compliance, port security,
      // fraud prevention for e-commerce checkout, ...) -- narrowed to the
      // specific compound phrases that actually signal the business
      // itself is a cybersecurity/InfoSec company, following the same
      // precedent as the "payments" fix above.
      [/\b(cybersecurity|cyber security|infosec|information security|network security|endpoint security|threat detection|threat intelligence|threat hunting|fraud detection|fraud prevention|security operations center|\bsoc\b|managed detection and response|\bmdr\b|penetration testing|vulnerability management|security compliance platform|compliance automation platform)\b/, "cybersecurity"],
      [/\b(ai|artificial intelligence|automation|agent|assistant|llm)\b/, "ai"],
      [/\b(saas|crm|software|platform)\b/, "saas"],
      [/\b(agency|consulting|service|studio)\b/, "services"],
    ],
    "services",
    normalized
  );
}

// Most prompts never name a country explicitly, so geography fell back to
// the same "global / unspecified" default regardless of business context.
// A large share of this product's real traffic is Turkish-language
// prompts describing a clearly Turkey-market business without ever
// spelling out "Turkey" -- detected here via Turkish-specific characters,
// which never occur in English/other-language prompts, so this is a safe,
// unambiguous signal rather than a guess.
function looksLikeTurkishPrompt(prompt: string) {
  return /[çğıöşüÇĞİÖŞÜ]/.test(prompt);
}

// "global / unspecified" reads as a raw internal placeholder wherever it
// gets interpolated -- as a labeled "Geography: global / unspecified"
// bullet in Financial Assumptions, and, un-labeled, directly inside
// narrative sentences ("...scale beyond the beachhead only after those
// proof gates hold in global / unspecified."). "global markets" is the
// same honest default (no specific region was named) phrased as a plain
// noun phrase, so it reads naturally in both places without needing a
// separate rewrite at every interpolation site.
const UNSPECIFIED_GEOGRAPHY = "global markets";

export function inferFinancialModelingInputs(prompt: string): FinancialModelingInputs {
  const normalized = normalizePrompt(prompt);
  const industryKey = inferIndustryKey(prompt);
  const benchmark = getIndustryBenchmarks(industryKey);

  return {
    industry: benchmark.label,
    industryKey,
    businessModel: firstMatching(
      [
        [/\b(kahve|coffee|espresso|roastery|specialty coffee|speciality coffee|premium kahve)\b/, "D2C Brand + Subscription + B2B"],
        // Confirmed live: "AI-powered strategic procurement intelligence
        // for large manufacturing and energy companies" (analyzes
        // supplier contracts, ERP data; integrates with SAP/Oracle/Coupa)
        // classified as "asset-heavy manufacturing" -- the only signal
        // present was the industry it SERVES ("manufacturing"), not any
        // word describing what the business itself sells, and the
        // manufacturer pattern below has no way to distinguish "a company
        // that manufactures things" from "a SaaS company selling software
        // to manufacturers". An AI-powered intelligence/analytics product
        // is reliably a software business regardless of which industry's
        // data it analyzes, so this is checked before any
        // customer-industry pattern (manufacturer/consulting/etc. below)
        // can misread the customer's industry as the vendor's own model.
        [/\b(saas|subscription|platform|software|crm|cybersecurity|ai-powered|ai powered|artificial intelligence|machine learning platform|intelligence platform|intelligence software)\b/, "subscription software"],
        [/\b(dtc|d2c|direct to consumer|direct-to-consumer|consumer brand|ecommerce|e-commerce|online store|e-ticaret|online satış)\b/, "D2C Brand / E-commerce"],
        [/\b(marketplace|two-sided|two sided)\b/, "marketplace"],
        [/\b(scooter|scooters|micromobility|micro mobility|bike sharing|bikeshare|shared mobility)\b/, "asset-heavy rental / utilization model"],
        [/\b(franchise|chain)\b/, "multi-location / franchise"],
        [/\b(restaurant|food service|foodservice|fast casual|fine dining|qsr|restoran|lokanta|yemek)\b/, "location-based food service"],
        [/\b(drone|drones|uav|autonomous aerial|aerial robotics)\b/, "hardware plus service contracts"],
        [/\b(manufacturer|manufacturing|factory|battery|yacht)\b/, "asset-heavy manufacturing"],
        [/\b(hotel|hospital|clinic|gym)\b/, "asset-heavy operating company"],
        [/\b(consulting|agency|service|studio)\b/, "services"],
      ],
      benchmark.label,
      normalized
    ),
    targetCustomer: firstMatching(
      [
        [/\b(kahve|coffee|espresso|roastery|specialty coffee|speciality coffee|premium kahve)\b/, "premium coffee consumers, office buyers, boutique HoReCa accounts"],
        [/\b(hospital|clinic|doctor|patient|healthcare)\b/, "healthcare buyers / operators"],
        [/\b(enterprise|b2b|company|companies|business)\b/, "B2B / enterprise customers"],
        [/\b(luxury|premium|affluent|private|yacht|hotel)\b/, "premium consumer / high-net-worth customers"],
        [/\b(founder|startup|smb|small business)\b/, "startups and SMBs"],
        [/\b(government|public sector|municipal)\b/, "public-sector buyers"],
        [/\b(commuter|commuters|student|students|urban|city|tourist|tourists|rider|riders)\b/, "urban riders / commuters"],
      ],
      "inferred early adopters",
      normalized
    ),
    // Confirmed live: a prompt naming "North America + Europe" was
    // silently collapsed to just "United States" -- firstMatching only
    // ever returns its first match, and the bare "america" alternative
    // below matched inside "North America" before the "europe" pattern
    // was ever considered, discarding the region the user actually
    // named (and the second region entirely). Every distinct region
    // mentioned is now collected and joined, instead of picking exactly
    // one and dropping the rest.
    geography: (() => {
      const hasNorthAmerica = /\bnorth america\b/.test(normalized);
      // Confirmed live: a maritime/shipping fleet-operations prompt naming
      // "Singapore, Greece, Norway, and the United Arab Emirates" fell
      // back to the unspecified-geography default -- none of those four
      // countries were in this list at all (Greece/Norway had no Europe-
      // adjacent entry, Singapore had no region of its own, and UAE only
      // matched its own three-letter abbreviation, not the full country
      // name the prompt actually used). Matches this list's existing
      // country-to-region granularity (e.g. Germany/France/Italy/Spain all
      // already map to the single "Europe" value).
      // Confirmed live: an automotive-procurement prompt naming "Germany,
      // Japan, South Korea, Mexico, and the United States" resolved to
      // "United States + Europe + global" -- Japan/South Korea/Mexico had
      // no entry at all (silently dropped), and "global" was treated as a
      // co-equal region signal alongside the named countries purely
      // because the prompt's own "for global automotive manufacturers"
      // used the word as an ambition descriptor, not a "no specific
      // region" signal -- so it was incorrectly added on top of, rather
      // than instead of, the five real countries actually named.
      const regionPatterns: Array<[RegExp, string]> = [
        [/\b(us|usa|united states)\b/, "United States"],
        [/\b(uk|united kingdom|london)\b/, "United Kingdom"],
        // Confirmed live: a procurement-intelligence prompt explicitly
        // naming "Germany, ... France, Netherlands, ... Saudi Arabia,
        // United Arab Emirates, ..." had Germany/France/Netherlands
        // silently collapsed into a single "Europe" token (Netherlands had
        // no entry at all) and Saudi Arabia collapsed into "GCC / Middle
        // East" -- the exact class of bug already fixed for UAE/Switzerland
        // below: an explicitly named country must never be collapsed into
        // a region label. "Europe"/"EU" is kept only as a fallback for
        // genuinely generic mentions that name no specific country.
        [/\b(europe|eu)\b/, "Europe"],
        [/\b(germany|deutschland)\b/, "Germany"],
        [/\bfrance\b/, "France"],
        [/\bitaly\b/, "Italy"],
        [/\bspain\b/, "Spain"],
        [/\bgreece\b/, "Greece"],
        [/\bnorway\b/, "Norway"],
        [/\b(netherlands|holland)\b/, "Netherlands"],
        [/\b(turkey|turkiye|tuerkiye|istanbul|türkiye)\b/, "Turkey"],
        [/\bsingapore\b/, "Singapore"],
        // Confirmed live: an AML/Fraud compliance prompt explicitly naming
        // "United States, United Kingdom, Singapore, United Arab Emirates,
        // and Switzerland" had the UAE silently replaced with the broader
        // "GCC / Middle East" region label, and Switzerland was dropped
        // entirely (no entry existed for it at all). An explicitly named
        // country must never be collapsed into a region label -- "GCC /
        // Middle East" is kept only for the broader Gulf signals (Dubai,
        // Abu Dhabi, or the bare "GCC" acronym) that were never a specific
        // country name to begin with.
        [/\b(uae|united arab emirates)\b/, "United Arab Emirates"],
        [/\b(saudi arabia|saudi)\b/, "Saudi Arabia"],
        [/\bqatar\b/, "Qatar"],
        [/\b(gcc|dubai|abu dhabi)\b/, "GCC / Middle East"],
        [/\b(switzerland|swiss|zurich|zürich|geneva)\b/, "Switzerland"],
        [/\b(japan|tokyo|japanese)\b/, "Japan"],
        [/\b(south korea|korea|seoul|korean)\b/, "South Korea"],
        [/\b(mexico|mexico city|mexican)\b/, "Mexico"],
        // Confirmed live: "Germany, Japan, South Korea, United States, and
        // Canada" silently dropped Canada entirely -- no entry existed for
        // it at all, the same class of gap already fixed for Netherlands/
        // Switzerland/Qatar above.
        [/\b(canada|canadian|toronto|vancouver)\b/, "Canada"],
      ];
      const matchedRegions = new Set(
        regionPatterns
          .filter(([pattern]) => pattern.test(normalized))
          .map(([, value]) => value)
      );

      if (hasNorthAmerica) {
        matchedRegions.add("North America");
      } else if (/\bamerica\b/.test(normalized)) {
        matchedRegions.add("United States");
      }

      if (matchedRegions.size > 0) {
        return [...matchedRegions].join(" + ");
      }

      // "global"/"worldwide"/"international" only means anything as a
      // geography signal when NO specific country was named at all --
      // once any real region matched above, a prompt's own unrelated use
      // of "global" (e.g. describing ambition, not geography) must never
      // be added alongside it.
      if (/\b(global|worldwide|international)\b/.test(normalized)) {
        return "global";
      }

      return looksLikeTurkishPrompt(prompt) ? "Turkey" : UNSPECIFIED_GEOGRAPHY;
    })(),
    pricingModel: firstMatching(
      [
        [/\b(kahve|coffee|espresso|roastery|specialty coffee|speciality coffee|premium kahve)\b/, "D2C unit sales, recurring subscriptions, and B2B wholesale accounts"],
        // Confirmed live: "we take a percentage commission from each
        // booking instead of charging a monthly fee" matched "monthly"
        // below (checked next) before ever reaching this pattern, purely
        // because "monthly"/"annual" are generic time-period words that
        // can appear anywhere, including inside the exact clause
        // explaining what the business does NOT charge. "take rate" and
        // "commission" are the internal industry TERMS for a revenue-
        // share model, but a founder describing it in plain language
        // says "percentage of", "cut of", "share of", "revenue share",
        // or "royalty" instead of ever using those terms literally.
        // Checked first -- these are direct, specific descriptions of
        // the pricing mechanism itself, not incidental words that can
        // show up while describing a different or explicitly-rejected
        // model.
        [/\b(take rate|commission|marketplace|revenue share|revenue-share|royalty|royalties|percentage of (?:revenue|sales|royalties|funds)|take a (?:cut|percentage|share)|share of (?:funds|revenue|sales))\b/, "take-rate / commission"],
        // Same reasoning as the businessModel classifier above: an
        // AI-powered intelligence/analytics product is reliably sold as
        // software (subscription pricing) regardless of which industry's
        // data it analyzes -- checked before the manufacturer/drone
        // patterns below can misread the customer's industry as the
        // vendor's own pricing mechanism.
        [/\b(subscription|monthly|annual|saas|software|cybersecurity|ai-powered|ai powered|artificial intelligence|machine learning platform|intelligence platform|intelligence software)\b/, "subscription"],
        [/\b(dtc|d2c|direct to consumer|direct-to-consumer|consumer brand|ecommerce|e-commerce|e-ticaret|online satış)\b/, "online unit sales plus repeat purchase frequency"],
        [/\b(usage|per use|consumption)\b/, "usage-based"],
        [/\b(scooter|scooters|micromobility|bike sharing|bikeshare|ride sharing|rental)\b/, "per-ride rental plus passes"],
        [/\b(franchise)\b/, "franchise fee plus royalties"],
        [/\b(coffee|cafe|hotel|yacht|hospital|clinic|gym|luxury|premium)\b/, "premium ticket / membership / service package"],
        [/\b(restaurant|food service|foodservice|fast casual|fine dining|qsr)\b/, "ticket size plus repeat purchase frequency"],
        [/\b(drone|drones|uav|autonomous aerial|aerial robotics)\b/, "hardware sale plus recurring software/service"],
        [/\b(manufacturer|manufacturing|battery|factory)\b/, "unit sales plus service contracts"],
      ],
      // "inferred pricing model" read as a raw internal placeholder
      // wherever it was interpolated -- as a labeled "Pricing model:
      // inferred pricing model" bullet, and, un-labeled, directly inside
      // narrative sentences ("test the inferred pricing model offer with
      // inferred early adopters"). Same fix as UNSPECIFIED_GEOGRAPHY
      // above: "not-yet-validated" is the same honest default (no
      // specific pricing structure was named or inferable) phrased as a
      // plain adjective, so it reads naturally in both places without
      // needing a separate rewrite at every interpolation site.
      "not-yet-validated",
      normalized
    ),
  };
}

function geographyMultiplier(geography: string) {
  if (geography === "United States") return 0.38;
  if (geography === "Europe") return 0.3;
  if (geography === "United Kingdom") return 0.08;
  if (geography === "Turkey") return 0.035;
  if (geography === "GCC / Middle East") return 0.06;
  // United Arab Emirates now resolves to its own explicit country label
  // instead of being collapsed into "GCC / Middle East" (see the geography
  // resolver above) -- kept at the same multiplier it already had under
  // that label, since financial-calculation behavior is unrelated to this
  // display/label fix and must not change.
  if (geography === "United Arab Emirates") return 0.06;
  // Germany/France/Italy/Spain/Greece/Norway/Netherlands now resolve to
  // their own explicit country label instead of being collapsed into
  // "Europe" (see the geography resolver above) -- kept at the same
  // multiplier "Europe" already had, since financial-calculation behavior
  // is unrelated to this display/label fix and must not change.
  if (
    geography === "Germany" ||
    geography === "France" ||
    geography === "Italy" ||
    geography === "Spain" ||
    geography === "Greece" ||
    geography === "Norway" ||
    geography === "Netherlands"
  ) {
    return 0.3;
  }
  // Saudi Arabia/Qatar now resolve to their own explicit country label
  // instead of being collapsed into "GCC / Middle East" -- same reasoning,
  // same preserved multiplier.
  if (geography === "Saudi Arabia" || geography === "Qatar") return 0.06;
  return 1;
}

function ideaScopeMultiplier(prompt: string) {
  const normalized = normalizePrompt(prompt);
  let multiplier = 1;

  if (/\b(luxury|premium|enterprise|private|hospital|global)\b/.test(normalized)) {
    multiplier *= 1.35;
  }

  if (/\b(local|small|solo|single location|neighborhood)\b/.test(normalized)) {
    multiplier *= 0.55;
  }

  if (/\b(manufacturer|factory|battery|yacht|hotel|hospital)\b/.test(normalized)) {
    multiplier *= 1.2;
  }

  return multiplier;
}

// Root cause of the flat-benchmark regression: geographyMultiplier and
// ideaScopeMultiplier only move away from their neutral value of 1 when
// the prompt names an explicit country or hits one of a handful of
// luxury/local/manufacturing keywords. Most real prompts do neither, so
// both multipliers resolve to 1 for the large majority of businesses --
// meaning two different businesses that land in the same broad
// industryKey bucket (e.g. two unrelated "saas" ideas) received the
// exact same tamUsd/arpaMonthly/cacUsd/monthlyBurnUsd straight from
// industry-benchmarks.ts with nothing left to differentiate them. Keying
// this purely off the structured businessModel/targetCustomer/
// pricingModel fields was not enough on its own -- those fields also
// collapse to the same small set of fallback values (e.g. "subscription
// software" / "inferred early adopters" / "subscription") whenever a
// prompt doesn't hit one of their own narrow keyword lists, so two
// genuinely unrelated SaaS businesses could still land on an identical
// signature. Including the full normalized business idea guarantees a
// distinct, deterministic value per distinct prompt, while the
// structured fields keep it grounded in the same detected business
// context used everywhere else. Independent salts keep market size,
// pricing, acquisition cost, and burn from moving in lockstep, matching
// how these actually vary independently between real businesses.
function contextMultiplier(
  normalizedBusinessIdea: string,
  inputs: FinancialModelingInputs,
  salt: string,
  min: number,
  span: number
) {
  const signature = [
    salt,
    normalizedBusinessIdea,
    inputs.businessModel,
    inputs.targetCustomer,
    inputs.pricingModel,
  ].join("|");
  const normalized = parseInt(hashValue(signature).slice(0, 8), 16) / 0xffffffff;

  return min + normalized * span;
}

function isD2cFoodOrFmcg(input: FinancialModelingInputs) {
  return (
    input.industryKey === "luxuryCoffee" ||
    input.businessModel.toLowerCase().includes("d2c") ||
    input.pricingModel.toLowerCase().includes("repeat purchase")
  );
}

// Confirmed live: a prompt explicitly disclaiming evidence ("I have no
// customers, no revenue, no funding, no prototype, and no validated
// scientific evidence") was misread as CLAIMING it, purely because
// "customers" and "revenue" literally appear inside the negated clause.
// This function's result unconditionally gates whether the Financial
// Assumptions narrative says "Validation evidence: present in prompt"
// (financial-assumptions-adjacent code below), whether the Sources block
// claims "User supplied validation evidence in the request" instead of
// "No direct operating data was supplied", and -- with no industry
// gating at all -- whether Benchmark Intelligence's own validationGaps
// array includes or SUPPRESSES the disclosure "No direct customer,
// revenue, retention, or acquisition evidence was provided in the
// request." A founder explicitly saying they have none of these things
// must never have that exact disclosure silently withheld. Negated
// occurrences (no/not/zero/without/never had/don't have/lack of/... plus
// up to a few intervening descriptive words, e.g. "no validated
// scientific evidence") are stripped before the positive-evidence scan
// runs, so "no revenue" no longer counts as "has revenue evidence" while
// a genuine claim like "we have 200 customers on a waitlist" is
// untouched (nothing before "customers" matches a negation trigger).
const negatedEvidenceClaimPattern =
  /\b(?:no|not|zero|without|never (?:had|have|has)|don'?t have|doesn'?t have|do not have|does not have|haven'?t(?:\s+(?:got|had))?|have not(?:\s+(?:got|had))?|hasn'?t(?:\s+(?:got|had))?|has not(?:\s+(?:got|had))?|lack(?:s|ing)? of|no direct|not yet)\s+(?:\w+\s+){0,3}?(?:revenue|sales|customers?|subscribers?|pre[-\s]?orders?|waitlist|loi|pilot|retention|repeat purchase|churn|conversion|cohort|traction|mrr|arr|gelir|satış|satis|müşteri|musteri|abon[eelik]*|ön sipariş|on siparis|bekleme listesi)\b/gi;

function hasValidationEvidence(prompt: string) {
  const normalized = normalizePrompt(prompt);
  const withoutNegatedClaims = normalized.replace(negatedEvidenceClaimPattern, " ");

  return /\b(revenue|sales|customers?|subscribers?|pre[-\s]?orders?|waitlist|loi|pilot|retention|repeat purchase|churn|conversion|cohort|traction|mrr|arr|gelir|satış|satis|müşteri|musteri|abon[eelik]*|ön sipariş|on siparis|bekleme listesi)\b/.test(
    withoutNegatedClaims
  );
}

// Confirmed live: a prompt stating a real, current "$18,000 MRR" was
// still shown in the report as a benchmark-formula-derived MRR figure --
// hasValidationEvidence above only ever answers "does SOME evidence
// exist" as a boolean; nothing anywhere extracted the user's own literal
// number and used it. Every metric below was a pure multiplier chain off
// industry-benchmark modeling data, with no path for a real, explicitly-
// stated figure to ever become the metric's actual value. This extracts
// the small set of financial facts a founder is most likely to state
// directly (current MRR, current ARR, current paying-customer count) so
// createFinancialModel can use them as the authoritative value instead of
// silently overwriting them with a benchmark estimate.
function parseUsdAmount(rawValue: string, rawSuffix: string): number | null {
  const value = Number(rawValue.replace(/,/g, ""));
  if (!Number.isFinite(value)) return null;

  const suffix = rawSuffix.toLowerCase();
  if (suffix === "k" || suffix === "thousand") return value * 1_000;
  if (suffix === "m" || suffix === "million") return value * 1_000_000;

  return value;
}

const usdAmountGroup = "\\$?\\s*([\\d][\\d,]*(?:\\.\\d+)?)\\s*(k|thousand|m|million)?";

// Same negation vocabulary as negatedEvidenceClaimPattern above, applied
// to the ~30 characters immediately before a matched figure -- "we don't
// have $18,000 in MRR yet" must never be read as a real $18,000 MRR
// figure.
function hasNearbyNegation(prompt: string, index: number) {
  const precedingContext = prompt.slice(Math.max(0, index - 30), index);

  return /\b(?:no|not|zero|without|never (?:had|have|has)|don'?t have|doesn'?t have|do not have|does not have|haven'?t|have not|hasn'?t|has not|lack(?:s|ing)? of)\s*$/i.test(
    precedingContext
  );
}

function extractLabeledUsdAmount(prompt: string, labelPattern: string): number | null {
  const valueThenLabel = new RegExp(
    `${usdAmountGroup}\\s*(?:in\\s+|of\\s+)?(?:${labelPattern})\\b`,
    "i"
  );
  const labelThenValue = new RegExp(
    `\\b(?:${labelPattern})\\b\\s*(?:of|is|at|was|reached|[:=-])?\\s*${usdAmountGroup}`,
    "i"
  );

  const match = prompt.match(valueThenLabel) || prompt.match(labelThenValue);
  if (!match || typeof match.index !== "number") return null;
  if (hasNearbyNegation(prompt, match.index)) return null;

  return parseUsdAmount(match[1], match[2] || "");
}

// Deliberately excludes bare "users" (freemium/signup counts are not the
// same claim as paying customers) and any figure immediately qualified as
// a market-size estimate ("potential"/"target"/"addressable"/"projected"
// customers describes an opportunity, not a real, current customer base).
function extractUserStatedCustomerCount(prompt: string): number | null {
  const match = prompt.match(/\b([\d][\d,]*)\s*(?:paying\s+|active\s+|current\s+)?customers?\b/i);
  if (!match || typeof match.index !== "number") return null;
  if (hasNearbyNegation(prompt, match.index)) return null;

  const precedingContext = prompt.slice(Math.max(0, match.index - 40), match.index).toLowerCase();
  if (/\b(?:potential|target|addressable|total addressable|estimated|projected|expected|future)\s*$/.test(precedingContext)) {
    return null;
  }

  return Number(match[1].replace(/,/g, ""));
}

function extractUserStatedFinancials(prompt: string): {
  mrr: number | null;
  arr: number | null;
  customers: number | null;
} {
  return {
    mrr: extractLabeledUsdAmount(prompt, "MRR|monthly recurring revenue"),
    arr: extractLabeledUsdAmount(prompt, "ARR|annual recurring revenue"),
    customers: extractUserStatedCustomerCount(prompt),
  };
}

function customerRampMultiplier(input: FinancialModelingInputs, prompt: string) {
  if (!isD2cFoodOrFmcg(input)) {
    return 1;
  }

  return hasValidationEvidence(prompt) ? 0.72 : 0.38;
}

function acquisitionCostMultiplier(input: FinancialModelingInputs, prompt: string) {
  if (!isD2cFoodOrFmcg(input)) {
    return 1;
  }

  return hasValidationEvidence(prompt) ? 1.15 : 1.45;
}

function growthCurveMultiplier(input: FinancialModelingInputs, year: number, baseGrowthRate: number) {
  if (!isD2cFoodOrFmcg(input)) {
    return Math.pow(1 + baseGrowthRate, year - 1);
  }

  if (year === 1) {
    return 1;
  }

  const postLaunchGrowthRates = [baseGrowthRate * 0.55, baseGrowthRate * 0.7];

  return postLaunchGrowthRates
    .slice(0, year - 1)
    .reduce((multiplier, growthRate) => multiplier * (1 + growthRate), 1);
}

function confidenceFor(input: {
  base: BenchmarkConfidence;
  prompt: string;
  metric: string;
  industryKey: IndustryKey;
}) {
  const normalized = normalizePrompt(input.prompt);
  const hasSpecificity = /\b(us|usa|uk|europe|turkey|gcc|b2b|enterprise|premium|luxury|subscription|franchise|monthly|annual)\b/.test(
    normalized
  );
  const hardToEstimate =
    input.industryKey === "manufacturing" ||
    input.industryKey === "energy" ||
    input.industryKey === "healthcare" ||
    input.industryKey === "hospitality" ||
    input.industryKey === "luxuryGoods" ||
    input.industryKey === "evCharging" ||
    input.industryKey === "drone" ||
	    input.industryKey === "mobility" ||
	    input.industryKey === "fintech" ||
	    input.industryKey === "agriculture";
  const evidenceSensitive =
    input.industryKey === "luxuryCoffee" || input.industryKey === "ecommerce";
  const hasEvidence = hasValidationEvidence(input.prompt);
  const validationSensitiveMetrics = [
    "TAM",
    "SAM",
    "SOM",
    "ARPA",
    "CAC",
    "LTV",
    "CAC Payback",
    "Revenue Growth",
    "MRR",
    "ARR",
    "EBITDA",
    "Break-even Month",
    "ROI",
  ];

  if (hardToEstimate && ["TAM", "SAM", "SOM", "EBITDA", "Break-even Month"].includes(input.metric)) {
    return "Low";
  }

  if (evidenceSensitive && !hasEvidence && validationSensitiveMetrics.includes(input.metric)) {
    return "Low";
  }

  if (hasSpecificity && input.base !== "Low") {
    return "High";
  }

  return input.base;
}

function createBenchmarkFit(input: {
  prompt: string;
  inputs: FinancialModelingInputs;
  benchmark: IndustryBenchmark;
}): BenchmarkFit {
  const normalized = normalizePrompt(input.prompt);
  const matchedSignals = [
    input.inputs.industry,
    input.inputs.businessModel,
    input.inputs.targetCustomer,
    input.inputs.geography,
    input.inputs.pricingModel,
  ].filter(Boolean);
  const hasBusinessSpecificSignal =
    input.inputs.industryKey !== "services" ||
    /\b(b2b|b2c|d2c|dtc|subscription|marketplace|ecommerce|e-commerce|retail|kahve|coffee|saas|software|manufacturing|restaurant|mobility|fintech)\b/.test(
      normalized
    );
  const hasValidation = hasValidationEvidence(input.prompt);
  const validationGaps = [
    ...(hasValidation ? [] : ["No direct customer, revenue, retention, or acquisition evidence was provided in the request."]),
    ...(input.benchmark.confidence === "Low"
      ? ["Benchmark confidence is low for this business model and requires primary validation."]
      : []),
    ...(hasBusinessSpecificSignal ? [] : ["Business model signal is broad, so benchmark selection may need refinement."]),
  ];
  const fit: BenchmarkFitLevel =
    input.benchmark.confidence === "High" && hasBusinessSpecificSignal
      ? "Strong Fit"
      : input.benchmark.confidence === "Low" || !hasBusinessSpecificSignal
        ? "Needs Validation"
        : "Moderate Fit";

  return {
    version: "benchmark_fit_v1",
    industryKey: input.inputs.industryKey,
    industry: input.inputs.industry,
    businessModel: input.inputs.businessModel,
    benchmarkBasis: input.benchmark.benchmarkBasis,
    confidence: input.benchmark.confidence,
    fit,
    matchedSignals,
    validationGaps,
    rationale: `Benchmark fit is based on detected industry, business model, geography, pricing model, and whether the prompt includes validation evidence. It does not change financial calculations or scoring.`,
  };
}

function formatUsd(value: number) {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";

  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${Math.round(abs / 1_000)}k`;

  return `${sign}$${Math.round(abs).toLocaleString("en-US")}`;
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function approximatelyEqual(left: number, right: number, tolerance = 0.03) {
  return Math.abs(left - right) <= Math.max(1, Math.abs(right)) * tolerance;
}

function createFinancialConsistencyCheck(input: {
  prompt: string;
  metrics: FinancialModel["metrics"];
  benchmark: {
    basis: string;
    ranges: IndustryBenchmark["ranges"];
  };
  targetRunwayMonths: number;
  startupCapexUsd: number;
}): FinancialConsistencyCheck {
  const { prompt, metrics, benchmark, targetRunwayMonths, startupCapexUsd } = input;
  const warnings: FinancialConsistencyWarning[] = [];
  const ltvCacRatio = metrics.ltv.value / Math.max(1, metrics.cac.value);
  const expectedPayback = metrics.cac.value / Math.max(1, metrics.arpa.value * metrics.grossMargin.value);
  const expectedRunway = metrics.investmentNeeded.value / Math.max(1, metrics.monthlyBurn.value);
  const capitalEfficiencyRatio = metrics.investmentNeeded.value / Math.max(1, metrics.arr.value);

  const addWarning = (
    code: FinancialConsistencyWarningCode,
    severity: FinancialConsistencyWarning["severity"],
    message: string,
    evidenceType: FinancialConsistencyWarning["evidenceType"] = "AI Planning Assumption"
  ) => {
    warnings.push({ code, severity, message, evidenceType });
  };

  if (!approximatelyEqual(metrics.arr.value, metrics.mrr.value * 12)) {
    addWarning("arr_mrr_mismatch", "critical", "Financial assumptions are inconsistent.");
  }

  if (metrics.ltv.value < metrics.cac.value) {
    addWarning("ltv_below_cac", "critical", "Customer acquisition economics require validation.");
  } else if (ltvCacRatio < 2) {
    addWarning("weak_ltv_cac", "warning", "Customer acquisition economics require validation.");
  }

  if (!approximatelyEqual(metrics.cacPayback.value, expectedPayback, 0.08)) {
    addWarning("payback_mismatch", "warning", "CAC payback assumptions require validation.");
  }

  if (metrics.grossMargin.value < benchmark.ranges.grossMargin.low) {
    addWarning("low_gross_margin", "warning", "Gross margin may not support the current acquisition and burn assumptions.", "Benchmark Assumption");
  }

  if (!approximatelyEqual(metrics.runway.value, expectedRunway, 0.05)) {
    addWarning("runway_burn_mismatch", "critical", "Financial assumptions are inconsistent.");
  }

  if (capitalEfficiencyRatio > 4) {
    addWarning("capital_efficiency", "critical", "Capital efficiency requires validation.");
  } else if (capitalEfficiencyRatio > 2) {
    addWarning("capital_efficiency", "warning", "Capital efficiency requires validation.");
  }

  if (metrics.breakEvenMonth.value > Math.max(48, targetRunwayMonths * 2)) {
    addWarning("break_even_timing", "warning", "Break-even timing requires validation.");
  }

  const quality: FinancialQuality = warnings.some((warning) => warning.severity === "critical")
    ? "High Risk"
    : warnings.length > 0
      ? "Needs Validation"
      : "Healthy";

  return {
    quality,
    warnings,
    sources: {
      userProvidedData: hasValidationEvidence(prompt)
        ? ["User supplied validation evidence in the request."]
        : ["No direct operating data was supplied by the user."],
      benchmarkAssumptions: [
        benchmark.basis,
        `Gross margin benchmark range: ${formatPercent(benchmark.ranges.grossMargin.low)}-${formatPercent(benchmark.ranges.grossMargin.high)}`,
        `CAC benchmark range: ${formatUsd(benchmark.ranges.cac.low)}-${formatUsd(benchmark.ranges.cac.high)}`,
        `LTV benchmark range: ${formatUsd(benchmark.ranges.ltv.low)}-${formatUsd(benchmark.ranges.ltv.high)}`,
      ],
      aiPlanningAssumptions: [
        `Target runway: ${targetRunwayMonths} months`,
        `Startup capex: ${formatUsd(startupCapexUsd)}`,
        `Funding need vs ARR ratio: ${capitalEfficiencyRatio.toFixed(1)}x`,
      ],
    },
  };
}

function formatMonths(value: number) {
  return `${value.toLocaleString("en-US", { maximumFractionDigits: 1 })} months`;
}

function formatBenchmarkRange(range: BenchmarkRange) {
  if (range.unit === "percent") {
    return `${formatPercent(range.low)}-${formatPercent(range.high)}`;
  }

  if (range.unit === "usd") {
    return `${formatUsd(range.low)}-${formatUsd(range.high)}`;
  }

  if (range.unit === "months") {
    return `${range.low}-${range.high} months`;
  }

  return `${range.low}x-${range.high}x`;
}

function compareToBenchmark(value: number, range: BenchmarkRange) {
  const formattedRange = formatBenchmarkRange(range);

  if (value < range.low) {
    return `Below benchmark range (${formattedRange})`;
  }

  if (value > range.high) {
    return `Above benchmark range (${formattedRange})`;
  }

  return `Within benchmark range (${formattedRange})`;
}

function metric(input: Omit<FinancialMetricModel, "displayValue"> & { displayValue?: string }) {
  return {
    ...input,
    displayValue:
      input.displayValue ??
      (input.unit === "usd"
        ? formatUsd(input.value)
        : input.unit === "percent"
          ? formatPercent(input.value)
          : formatMonths(input.value)),
  };
}

export function createFinancialModel(input: FinancialModelInput): FinancialModel {
  const normalizedBusinessIdea = normalizePrompt(input.prompt);
  const inputs = inferFinancialModelingInputs(input.prompt);
  const benchmark = getIndustryBenchmarks(inputs.industryKey);
  const modeling = benchmark.modeling;
  const geoMultiplier = geographyMultiplier(inputs.geography);
  const scopeMultiplier = ideaScopeMultiplier(input.prompt);
  const rampMultiplier = customerRampMultiplier(inputs, input.prompt);
  const cacMultiplier = acquisitionCostMultiplier(inputs, input.prompt);
  const marketMultiplier = contextMultiplier(normalizedBusinessIdea, inputs, "market", 0.55, 1.0);
  const pricingMultiplier = contextMultiplier(normalizedBusinessIdea, inputs, "pricing", 0.6, 0.9);
  const acquisitionContextMultiplier = contextMultiplier(normalizedBusinessIdea, inputs, "acquisition", 0.65, 0.85);
  const burnMultiplier = contextMultiplier(normalizedBusinessIdea, inputs, "burn", 0.7, 0.75);
  const tam = modeling.tamUsd * geoMultiplier * scopeMultiplier * marketMultiplier;
  const sam = tam * modeling.samRate;
  const som = sam * modeling.somRate;
  const arpa = modeling.arpaMonthly * scopeMultiplier * pricingMultiplier;
  const userStated = extractUserStatedFinancials(input.prompt);
  const month12Customers =
    userStated.customers ?? Math.max(1, Math.round(modeling.month12Customers * scopeMultiplier * rampMultiplier));
  // A real, current MRR/ARR the user stated is the authoritative value --
  // never overwritten by the benchmark formula below. ARR still derives
  // from MRR (mrr x 12) when only MRR was stated, keeping the two
  // internally consistent rather than mixing one real and one modeled
  // figure.
  const mrr = userStated.mrr ?? (userStated.arr ? userStated.arr / 12 : month12Customers * arpa);
  const arr = userStated.arr ?? mrr * 12;
  const cac = modeling.cacUsd * (scopeMultiplier > 1 ? 1.18 : 1) * cacMultiplier * acquisitionContextMultiplier;
  const grossMargin = modeling.grossMarginRate;
  const ltv = arpa * grossMargin * modeling.lifetimeMonths;
  const cacPayback = cac / Math.max(1, arpa * grossMargin);
  const monthlyBurn = modeling.monthlyBurnUsd * scopeMultiplier * burnMultiplier;
  const investmentNeeded = monthlyBurn * modeling.targetRunwayMonths + modeling.startupCapexUsd;
  const runway = investmentNeeded / monthlyBurn;
  const annualOpex = monthlyBurn * 12;
  const ebitda = arr * grossMargin - annualOpex;
  const monthlyContribution = mrr * grossMargin;
  const breakEvenMonth =
    monthlyContribution > monthlyBurn
      ? Math.max(1, Math.ceil(modeling.startupCapexUsd / (monthlyContribution - monthlyBurn)))
      : 36 + Math.ceil((monthlyBurn - monthlyContribution) / Math.max(1, monthlyContribution)) * 3;
  const year3Revenue = arr * Math.pow(1 + modeling.customerGrowthRate, 2);
  const year3Ebitda = year3Revenue * grossMargin - annualOpex * 1.35;
  const roi = (year3Ebitda - investmentNeeded) / Math.max(1, investmentNeeded);
  const revenueForecast: RevenueForecastYear[] = [1, 2, 3].map((year) => {
    const customers = Math.round(
      month12Customers * growthCurveMultiplier(inputs, year, modeling.customerGrowthRate)
    );
    const yearMrr = customers * arpa;
    const yearArr = yearMrr * 12;

    return {
      year: `Year ${year}`,
      customers,
      mrr: yearMrr,
      arr: yearArr,
      revenue: yearArr,
      marketPenetration: yearArr / Math.max(1, som),
    };
  });
  const confidence = (metricName: string) =>
    confidenceFor({
      base: benchmark.confidence,
      prompt: input.prompt,
      metric: metricName,
      industryKey: inputs.industryKey,
    });
  const isMobility = inputs.industryKey === "mobility";
  const customerUnit = isMobility ? "active riders" : "customers";
  const arpaLabel = isMobility ? "Monthly Revenue per Active Rider" : "ARPA";
  const mrrLabel = isMobility ? "Monthly Revenue" : "MRR";
  const arrLabel = isMobility ? "Yearly Revenue" : "ARR";
  const cacLabel = isMobility ? "Rider CAC" : "CAC";
  const ltvLabel = isMobility ? "Rider LTV" : "LTV";
  const arpaFormula = isMobility
    ? "monthly ride revenue per active rider x idea scope multiplier"
    : "benchmark monthly ARPA x idea scope multiplier";
  const mrrFormula = isMobility
    ? "Month-12 active riders x monthly revenue per active rider"
    : "Month-12 customers x ARPA";
  const arrFormula = isMobility ? "Monthly Revenue x 12" : "MRR x 12";
  const sharedAssumptions = [
    `Industry benchmark: ${benchmark.label}`,
    `Business model: ${inputs.businessModel}`,
    `Target customer: ${inputs.targetCustomer}`,
    `Geography: ${inputs.geography}`,
    `Pricing model: ${inputs.pricingModel}`,
    `Validation evidence: ${hasValidationEvidence(input.prompt) ? "present in prompt" : "not yet supplied; planning assumptions require validation"}`,
    `Customer ramp multiplier: ${rampMultiplier}`,
  ];
  const benchmarkFit = createBenchmarkFit({
    prompt: input.prompt,
    inputs,
    benchmark,
  });

  return {
    version: "financial_model_engine_v1",
    fingerprint: hashValue(
      JSON.stringify({
        version: "financial_model_engine_v1",
        prompt: normalizedBusinessIdea,
        reportKind: input.reportKind,
        inputs,
        benchmark,
      })
    ).slice(0, 16),
    reportKind: input.reportKind,
    normalizedBusinessIdea,
    inputs,
    benchmark: {
      label: benchmark.label,
      basis: benchmark.benchmarkBasis,
      ranges: benchmark.ranges,
    },
    benchmarkFit,
    metrics: {
      tam: metric({
        label: "TAM",
        value: tam,
        unit: "usd",
        confidence: confidence("TAM"),
        formula: "industry TAM x geography multiplier x idea scope multiplier",
        assumptions: [...sharedAssumptions, `Geography multiplier: ${geoMultiplier}`, `Idea scope multiplier: ${scopeMultiplier}`],
        benchmarkComparison: "Derived from benchmark market scope rather than compared to operating range.",
      }),
      sam: metric({
        label: "SAM",
        value: sam,
        unit: "usd",
        confidence: confidence("SAM"),
        formula: "TAM x serviceable market rate",
        assumptions: [...sharedAssumptions, `Serviceable market rate: ${formatPercent(modeling.samRate)}`],
        benchmarkComparison: "Derived from benchmark serviceable-market rate.",
      }),
      som: metric({
        label: "SOM",
        value: som,
        unit: "usd",
        confidence: confidence("SOM"),
        formula: "SAM x obtainable share rate",
        assumptions: [...sharedAssumptions, `Obtainable share rate: ${formatPercent(modeling.somRate)}`],
        benchmarkComparison: "Derived from benchmark obtainable-share rate.",
      }),
      arpa: metric({
        label: arpaLabel,
        value: arpa,
        unit: "usd",
	        displayValue: `${formatUsd(arpa)}/month`,
	        confidence: confidence(arpaLabel),
	        formula: arpaFormula,
	        assumptions: [...sharedAssumptions, `Month-12 ${customerUnit}: ${month12Customers}`],
        benchmarkComparison: isMobility
          ? "Uses mobility revenue-per-active-rider benchmark as the base case."
          : "Uses industry benchmark ARPA as the base case.",
      }),
      cac: metric({
        label: cacLabel,
        value: cac,
	        unit: "usd",
	        confidence: confidence(cacLabel),
	        formula: "benchmark CAC x complexity multiplier",
	        assumptions: [...sharedAssumptions, `Complexity multiplier: ${scopeMultiplier > 1 ? 1.18 : 1}`, `Acquisition uncertainty multiplier: ${cacMultiplier}`],
        benchmarkComparison: compareToBenchmark(cac, benchmark.ranges.cac),
      }),
      ltv: metric({
        label: ltvLabel,
        value: ltv,
        unit: "usd",
        confidence: confidence(ltvLabel),
        formula: `${arpaLabel} x Gross Margin x lifetime months`,
        assumptions: [...sharedAssumptions, `Lifetime: ${modeling.lifetimeMonths} months`],
        benchmarkComparison: compareToBenchmark(ltv, benchmark.ranges.ltv),
      }),
      grossMargin: metric({
        label: "Gross Margin",
        value: grossMargin,
        unit: "percent",
        confidence: confidence("Gross Margin"),
        formula: "industry gross margin benchmark",
        assumptions: [...sharedAssumptions, "Gross margin is benchmark-derived until validated by actual COGS."],
        benchmarkComparison: compareToBenchmark(grossMargin, benchmark.ranges.grossMargin),
      }),
      cacPayback: metric({
        label: "CAC Payback",
        value: cacPayback,
        unit: "months",
        confidence: confidence("CAC Payback"),
        formula: "CAC / monthly gross profit per customer",
        assumptions: [...sharedAssumptions, `Monthly gross profit per customer: ${formatUsd(arpa * grossMargin)}`],
        benchmarkComparison: compareToBenchmark(cacPayback, benchmark.ranges.cacPayback),
      }),
      monthlyBurn: metric({
        label: "Monthly Burn",
        value: monthlyBurn,
        unit: "usd",
        displayValue: `${formatUsd(monthlyBurn)}/month`,
        confidence: confidence("Monthly Burn"),
        formula: "benchmark monthly burn x idea scope multiplier",
        assumptions: [...sharedAssumptions, "Includes team, operating overhead, infrastructure, and go-to-market load."],
        benchmarkComparison: "Operating-burn benchmark is industry-specific and adjusted for idea scope.",
      }),
      runway: metric({
        label: "Runway",
        value: runway,
        unit: "months",
        confidence: confidence("Runway"),
        formula: "Investment Needed / Monthly Burn",
        assumptions: [...sharedAssumptions, `Investment needed: ${formatUsd(investmentNeeded)}`],
        benchmarkComparison: "Runway is calculated from financing need and monthly burn.",
      }),
      arr: metric({
        label: arrLabel,
        value: arr,
        unit: "usd",
        // Three distinct provenance tiers, never conflated (PRODUCTION
        // DATA PROVENANCE POLISH): a user-stated ARR is Verified; an ARR
        // calculated only from a user-stated MRR (mrr x 12) is real and
        // trustworthy but was never itself supplied, so it is Derived,
        // not Verified; anything else is the ordinary benchmark formula.
        // The wording below is what inferEvidenceLevel (report-
        // evidence.ts) actually classifies from -- "derived from the
        // verified..." is checked ahead of the bare "verified" keyword
        // there specifically so this phrasing resolves to Derived.
        confidence: userStated.arr || userStated.mrr ? "High" : confidence(arrLabel),
        formula: userStated.arr
          ? "User-provided (stated directly in the request)"
          : userStated.mrr
            ? `Derived from the verified ${mrrLabel} (x 12)`
            : arrFormula,
        assumptions: userStated.arr
          ? [`Actual, user-provided ${arrLabel}: ${formatUsd(arr)}`]
          : userStated.mrr
            ? [`Derived value: ${arrLabel} calculated from the verified ${mrrLabel} of ${formatUsd(mrr)}.`]
            : [...sharedAssumptions, `${mrrLabel}: ${formatUsd(mrr)}`, `Month-12 ${customerUnit}: ${month12Customers}`],
        benchmarkComparison: userStated.arr
          ? `${arrLabel} reflects the actual figure supplied in the request, not a benchmark estimate.`
          : userStated.mrr
            ? `${arrLabel} is derived directly from the verified ${mrrLabel}, not a benchmark estimate.`
            : `${arrLabel} is calculated from ${customerUnit} and pricing assumptions.`,
      }),
      revenueGrowth: metric({
        label: "Revenue Growth",
        value: modeling.customerGrowthRate,
        unit: "percent",
        confidence: confidence("Revenue Growth"),
        formula: "industry customer growth benchmark",
        assumptions: [...sharedAssumptions, "Growth rate is applied to customer count in the 3-year forecast."],
        benchmarkComparison: compareToBenchmark(modeling.customerGrowthRate, benchmark.ranges.arrGrowth),
      }),
      mrr: metric({
        label: mrrLabel,
        value: mrr,
        unit: "usd",
        // Same three-tier logic as ARR above, mirrored: a user-stated
        // MRR is Verified; an MRR calculated only from a user-stated ARR
        // (arr / 12) is Derived, not Verified.
        confidence: userStated.mrr || userStated.arr ? "High" : confidence(mrrLabel),
        formula: userStated.mrr
          ? "User-provided (stated directly in the request)"
          : userStated.arr
            ? `Derived from the verified ${arrLabel} (/ 12)`
            : mrrFormula,
        assumptions: userStated.mrr
          ? [`Actual, user-provided ${mrrLabel}: ${formatUsd(mrr)}`]
          : userStated.arr
            ? [`Derived value: ${mrrLabel} calculated from the verified ${arrLabel} of ${formatUsd(arr)}.`]
            : [...sharedAssumptions, `Month-12 ${customerUnit}: ${month12Customers}`, `${arpaLabel}: ${formatUsd(arpa)}/month`],
        benchmarkComparison: userStated.mrr
          ? `${mrrLabel} reflects the actual figure supplied in the request, not a benchmark estimate.`
          : userStated.arr
            ? `${mrrLabel} is derived directly from the verified ${arrLabel}, not a benchmark estimate.`
            : `${mrrLabel} is calculated from ${customerUnit} and pricing assumptions.`,
      }),
      ebitda: metric({
        label: "EBITDA",
        value: ebitda,
        unit: "usd",
        confidence: confidence("EBITDA"),
        formula: `${arrLabel} x Gross Margin - annualized operating expense`,
        assumptions: [...sharedAssumptions, `Annualized operating expense: ${formatUsd(annualOpex)}`],
        benchmarkComparison: compareToBenchmark(ebitda / Math.max(1, arr), benchmark.ranges.ebitdaMargin),
      }),
      breakEvenMonth: metric({
        label: "Break-even Month",
        value: Math.max(1, Math.round(breakEvenMonth)),
        unit: "months",
        displayValue: `Month ${Math.max(1, Math.round(breakEvenMonth))}`,
        confidence: confidence("Break-even Month"),
        formula: "Startup capex / monthly contribution above burn",
        assumptions: [...sharedAssumptions, `Startup capex: ${formatUsd(modeling.startupCapexUsd)}`],
        benchmarkComparison: "Break-even is derived from contribution margin and burn, not a standalone benchmark.",
      }),
      investmentNeeded: metric({
        label: "Investment Needed",
        value: investmentNeeded,
        unit: "usd",
        confidence: confidence("Investment Needed"),
        formula: "Monthly Burn x target runway + startup capex",
        assumptions: [...sharedAssumptions, `Target runway: ${modeling.targetRunwayMonths} months`],
        benchmarkComparison: "Investment need is calculated from runway and capex assumptions.",
      }),
      roi: metric({
        label: "ROI",
        value: roi,
        unit: "percent",
        displayValue: `${Math.round(roi * 100)}% by Year 3`,
        confidence: confidence("ROI"),
        formula: "(Year-3 EBITDA - Investment Needed) / Investment Needed",
        assumptions: [...sharedAssumptions, `Year-3 revenue: ${formatUsd(year3Revenue)}`],
        benchmarkComparison: "ROI is calculated from the same forecast, margin, burn, and investment assumptions.",
      }),
    },
    revenueForecast,
  };
}

export function formatFinancialModelValue(metric: FinancialMetricModel) {
  return metric.displayValue;
}

export function validateFinancialConsistency(model: FinancialModel): FinancialConsistencyCheck {
  const targetRunwayAssumption = model.metrics.investmentNeeded.assumptions.find((assumption) =>
    /target runway/i.test(assumption)
  );
  const startupCapexAssumption = model.metrics.breakEvenMonth.assumptions.find((assumption) =>
    /startup capex/i.test(assumption)
  );
  const targetRunwayMonths = Number(targetRunwayAssumption?.match(/\d+(?:\.\d+)?/)?.[0]) || model.metrics.runway.value;
  const startupCapexUsd =
    Number(startupCapexAssumption?.match(/\$?([\d,.]+)\s*k/i)?.[1]?.replace(/,/g, "")) * 1_000 ||
    Number(startupCapexAssumption?.match(/\$?([\d,.]+)\s*m/i)?.[1]?.replace(/,/g, "")) * 1_000_000 ||
    0;

  return createFinancialConsistencyCheck({
    prompt: model.normalizedBusinessIdea,
    metrics: model.metrics,
    benchmark: model.benchmark,
    targetRunwayMonths,
    startupCapexUsd,
  });
}
