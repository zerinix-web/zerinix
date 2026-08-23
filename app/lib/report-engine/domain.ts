export type ReportDomain =
  | "business"
  | "real_estate"
  | "legal"
  | "finance"
  | "accounting"
  | "operations"
  | "procurement"
  | "acquisition";

type ReportDomainAsset = {
  name?: string;
  type?: string;
  textContent?: string;
};

// CRITICAL PRODUCTION FIX -- acquisition due diligence routing. Confirmed
// live: an M&A due-diligence prompt ("we are evaluating an acquisition
// target... assess valuation, purchase price, financing structure,
// integration risk") routinely also contains ordinary legal vocabulary
// (contracts the target holds, regulatory/compliance considerations,
// liability, indemnity) and finance vocabulary (valuation, revenue,
// leverage) -- both of specializedDomainSignals' own "legal" and "finance"
// entries below would otherwise claim it first, producing a generic Legal
// Assessment or Business Validation report full of startup-pitch
// vocabulary (burn rate, runway, CAC, execution scoring) that has no
// place in an acquisition of an already-operating company. This must be
// checked before every other specialized-domain signal.
//
// Deliberately requires an unambiguous, compound M&A-specific phrase --
// never a bare generic word like "integration", "leverage", "synergies",
// or "valuation" alone, each of which is ordinary vocabulary in ordinary
// business/finance prompts having nothing to do with acquiring a company
// (a startup's own "how do we leverage our data" or "what's our
// valuation" pitch must never be misrouted here). "purchase price" and
// "enterprise value"/"EV/ARR" are kept as standalone triggers since they
// are not ordinarily used outside a company-sale context.
//
// CRITICAL BUG FIX -- Business Plan prompts were being routed to
// Acquisition. Confirmed live: a Business Idea Validation prompt
// launching a new B2B AI cybersecurity platform, once it went on to
// describe its own funding plans ("...our financing structure includes
// $2M in seed funding and some debt financing"), matched "financing
// structure"/"debt financing" below -- both are ordinary startup-pitch
// capital-planning vocabulary, not unambiguous M&A signals (a
// pre-revenue venture routinely discusses its own financing structure
// with zero relation to acquiring another company) -- and was
// misclassified as an acquisition report. Both removed as standalone
// triggers; "purchase price" and "enterprise value"/"EV/ARR" above stay,
// since (unlike "financing structure") they are not ordinarily used
// outside a company-sale context.
//
// Separately, confirmed live: "acquire a cybersecurity SaaS company" (an
// entirely ordinary, unambiguous way to state acquisition intent) did
// NOT match the "acquire ... company" pattern at all, because it required
// the company-type noun to sit immediately after "a"/"the" with no
// descriptive words in between -- real prompts almost always have some
// (sector, size, or quality descriptors) before the noun. The pattern
// now tolerates up to six descriptive words between the article and the
// noun, and the same "buy"/"purchase a [company]" and "merge with"
// phrasings named in the acquisition-intent requirement are added
// alongside "acquire", all scoped to the same company-type-noun
// requirement so a bare "buy"/"purchase" (ordinary e-commerce/pricing
// vocabulary in any business prompt) never triggers on its own.
// Each descriptive word may carry trailing punctuation ("well-established,
// profitable AI-powered ... company") without breaking the match -- a
// modifier list separated by commas is completely ordinary English.
const acquisitionCompanyNounPattern = "(?:[\\w-]+[,]?\\s+){0,6}(?:company|business|firm|startup|target)";
const acquisitionSignals = new RegExp(
  "\\b(?:acquisitions?|acquiring" +
    `|acquire\\s+(?:a\\s+|the\\s+)?${acquisitionCompanyNounPattern}` +
    `|buy(?:ing)?\\s+(?:a\\s+|the\\s+)?${acquisitionCompanyNounPattern}` +
    `|purchas(?:e|ing)\\s+(?:a\\s+|the\\s+)?${acquisitionCompanyNounPattern}` +
    "|merg(?:e|er|ing)\\s+with" +
    "|corporate acquisition|acquisition target|target company|mergers?|m\\s?&\\s?a\\b|m\\s+and\\s+a\\b" +
    "|due diligence|buy[\\s-]?outs?|post[\\s-]?merger|enterprise value|ev\\s*\\/\\s*arr|purchase price" +
    "|comparable transactions?|şirket satın alma|satın alma hedefi|birleşme|devralma|hedef şirket)\\b",
  "i"
);

const realEstateSignals =
  /(?:\b(?:real[\s-]?estate|property|properties|land|parcel|plot|title deed|deed|land registry|registry document|cadastral|cadastre|zoning|land use|planning permission|development potential|comparable sale|comparable listing|mortgage|easement|right of way|freehold|leasehold)\b|tapu(?:ya|yu|nun|da|dan)?|tapu senedi|arsa(?:ya|yı|nın|da|dan)?|arazi(?:ye|yi|nin|de|den)?|parsel(?:e|i|in|de|den)?|pafta|\bada\b|gayrimenkul(?:e|ü|ün|de|den)?|taşınmaz(?:a|ı|ın|da|dan)?|imar(?:ı|ın|da|dan)?|kadastro|emlak|kira|konut|daire|bina(?:sı|yı|nın|da|dan)?|ofis(?:i|in|te|ten)?|ofis binası|ticari bina|iş merkezi|plaza|mülkiyet|irtifak|şerh|ipotek)/i;

const directAssetInvestmentSignals =
  /(?:\b(?:invest|investment|buy|purchase|acquire|sell|valuation|value|worth|due diligence|risk|return|yield|develop)\b|yatırım|satın al(?:mak|mayı|ma|ım|mayı düşünüyorum)?|almak|değer|değerleme|eder|risk|getiri|kira geliri|kapitalizasyon oranı|geliştir|incele|analiz)/i;

const operatingBusinessSignals =
  /\b(startup|saas|software|platform|marketplace|subscription|customers?|customer acquisition|pricing model|revenue model|business plan|company|venture|founder|girişim|yazılım|platform|abonelik|müşteri edinimi|fiyatlandırma modeli|gelir modeli|iş planı|şirket|kurucu)\b/i;

const explicitBusinessReportSignals =
  /\b(business plan|startup plan|venture plan|iş planı|girişim planı)\b/i;

// The bigram-only Turkish forms below ("kurmak istiyorum", "platform kur")
// missed common paraphrases of the same venture-evaluation intent --
// confirmed live: "...SaaS platformu KURMAK MANTIKLI MI?" and "...sağlık
// SaaS platformu kurmak mantıklı mı?" both failed to match, so a bare
// sector word elsewhere in the prompt ("hastane", "sağlık") fell straight
// through to specializedDomainSignals below and misclassified the
// venture as "operations" instead of "business". This adds the general
// grammatical pattern -- a venture-starting verb (kurmak/açmak/
// başlatmak) followed by any common desire/evaluation ending -- which is
// a structural sentence pattern, not a sector-vocabulary word list, so it
// does not need updating per industry.
const ventureCreationSignals =
  /\b(startup|new venture|launch (?:a |the )?(?:business|company|app|application|platform)|build (?:a |the )?(?:business|company|app|application|platform)|is it (?:worth|sensible to)\s+(?:starting|building|launching)|should i (?:start|build|launch)|does it make sense to (?:start|build|launch)|founder|iş fikri|girişim|kurmak istiyorum|şirket kur|uygulama kur|platform kur)\b|\b(?:kurmak|açmak|başlatmak|kurmayı|açmayı|başlatmayı)\s+(?:istiyorum|düşünüyorum|planlıyorum|mantıklı\s*mı|kârlı\s*mı|karlı\s*mı|iyi\s*(?:bir\s*)?fikir\s*mi|mantıklı\s*olur\s*mu)/i;

// CRITICAL BUG FIX -- Market Intelligence prompts routed to Business
// Plan. Confirmed live: "I want to evaluate the European AI
// cybersecurity market before launching a new B2B security product...
// Create a Market Intelligence Report." unambiguously asks to evaluate
// a market's attractiveness, not to build/price/launch a company --
// used by applyPromptIntentModeOverride below. Requires a specific verb
// (evaluate/assess/research/analyze/understand) paired with a
// market/industry noun, "competitor(s) analysis"/"analyze competitors",
// "market opportunity"/"attractiveness"/etc, or the user literally
// naming the report they want, so a prompt that merely mentions
// "market" in passing (e.g. "a startup targeting the healthcare
// market") never matches -- the same unambiguous-compound-phrase
// philosophy as acquisitionSignals above.
//
// CRITICAL FIX -- Market Intelligence intent must win priority over
// generic launch/build/product-idea language elsewhere in the same
// prompt. Confirmed live: "I want to evaluate the European AI
// cybersecurity market before launching a new B2B security product."
// still misrouted to Business Plan even after this signal was added,
// because the countersignal check below used to reuse the broad,
// general-purpose ventureCreationSignals/explicitBusinessReportSignals
// (which match on bare "startup"/"founder"/"launch a business" words) --
// any incidental mention of one of those words anywhere in an otherwise
// clearly market-research-focused prompt silently blocked the override.
// The countersignal below is now scoped to only the specific,
// unambiguous execution-planning phrases that actually signal Business
// Plan intent, so a bare "launching"/"building"/"product idea"/"before
// entering" elsewhere in the prompt can never block a genuine Market
// Intelligence signal.
const marketIntelligenceIntentSignals =
  /\b(?:evaluate|assess|research|analyz(?:e|ing|es)|understand(?:ing)?)\s+(?:the\s+|this\s+|a\s+|our\s+|whether\s+)?(?:[a-z][\w-]*\s+){0,4}(?:market|industry)\b|\bmarket\s+(?:opportunity|attractiveness|sizing|research|analysis|entry)\b|\bcompetitors?\s+analysis\b|\banalyz(?:e|ing|es)\s+(?:the\s+|our\s+|potential\s+)?competitors?\b|\bbefore\s+entering\s+(?:the\s+|a\s+|this\s+)?market\b|\bmarket\s+intelligence\s+report\b|\bmarket\s+research\s+report\b/i;

// Countersignal: an unambiguous Business Plan EXECUTION-intent phrase
// (create a business plan / build company strategy / operating plan /
// financial forecast / GTM execution roadmap / startup execution), not
// a generic venture-launch word. A prompt that genuinely mixes both
// intents ("evaluate the market, then create a business plan") is left
// exactly as the user selected rather than guessed at; a prompt that
// merely mentions "launching"/"building"/a "product idea" alongside
// real Market Intelligence intent is not blocked by this check, per the
// fix above.
const businessPlanExecutionIntentSignals =
  /\bcreate\s+(?:a\s+|the\s+|my\s+|our\s+)?business\s+plan\b|\bbuild(?:ing)?\s+(?:a\s+|the\s+|my\s+|our\s+)?company\s+strategy\b|\boperating\s+plan\b|\bfinancial\s+forecast(?:s|ing)?\b|\b(?:gtm|go[\s-]to[\s-]market)\s+execution\s+roadmap\b|\bstartup\s+execution\b|\bbusiness\s+plan\s+report\b|\bbusiness\s+idea\s+validation\s+report\b/i;

// CRITICAL FIX -- Market Intelligence prompts routed to Legal Assessment.
// A superset of marketIntelligenceIntentSignals above, used only by
// classifyReportDomain's own legal-priority guard below (never by
// applyPromptIntentModeOverride, whose existing "plan" -> "market" mode
// behavior is deliberately left untouched by this fix). Confirmed live:
// "I want a Market Intelligence analysis, not a legal analysis." did not
// match marketIntelligenceIntentSignals at all (it requires "market
// intelligence REPORT", not "analysis"), so this adds a bare "market
// intelligence" alternative plus the report's own named triggers
// (TAM/SAM/SOM, entry strategy) -- still never a bare "market"/"industry"
// word alone.
const marketIntelligenceLegalPriorityPattern = new RegExp(
  marketIntelligenceIntentSignals.source +
    "|\\bmarket\\s+intelligence\\b|\\btam\\s*\\/\\s*sam\\s*\\/\\s*som\\b|\\bentry\\s+strategy\\b",
  "i"
);

const specializedDomainSignals: Array<[Exclude<ReportDomain, "business" | "real_estate">, RegExp]> = [
  ["legal", /\b(contract|agreement|clause|legal|compliance|liability|indemnity|termination|governing law|sözleşme|hukuk|uyum|sorumluluk|tazminat|fesih)\b/i],
  ["accounting", /\b(accounting|invoice|ledger|trial balance|tax|vat|ifrs|gaap|muhasebe|fatura|vergi|kdv|defter)\b/i],
  // Confirmed live: an event-planning SaaS ("manage vendor bookings,
  // guest RSVPs, and on-site logistics") was classified into the
  // procurement domain purely because it mentioned "vendor" -- a word
  // any marketplace, events, or coordination platform uses routinely
  // for the caterers/venues/suppliers it works with, not a reliable
  // signal that the business itself IS a procurement/supply-chain
  // company. Same reasoning as the fintech "payments" false positive
  // fixed earlier in financial-model.ts's inferIndustryKey: bare
  // "vendor"/"supplier"/"tender"/"sourcing"/"rfp" are checked in
  // specializedDomainSignals BEFORE operatingBusinessSignals ever gets a
  // chance to recognize an ordinary SaaS/platform/marketplace prompt, so
  // a single incidental mention of any of these words could hijack the
  // whole domain classification. Requiring the more specific compound
  // phrase below (the business's own core offering, not an incidental
  // feature mention) keeps genuine procurement/sourcing platforms
  // matching while no longer catching every business that merely works
  // with vendors/suppliers as part of a different core business.
  ["procurement", /\b(procurement|e-procurement|vendor management|vendor sourcing|vendor onboarding|supplier management|supplier onboarding|supplier sourcing|rfp management|request for proposal|purchase order (?:system|management|platform)|tender process|sourcing platform|tedarik zinciri|tedarikçi yönetimi|ihale süreci|satın alma platformu)\b/i],
  ["operations", /\b(operations|workflow|capacity|inventory|warehouse|logistics|manufacturing|quality control|retail|store|branch|sku|product sales|healthcare|hospital|clinic|patient flow|operasyon|iş akışı|kapasite|stok|depo|lojistik|üretim|perakende|market zinciri|mağaza|şube|ürün satış|sağlık|hastane|klinik|hasta akışı)\b/i],
  ["finance", /\b(finance|financial|investment|portfolio|cash flow|forecast|valuation|revenue|margin|balance sheet|finans|nakit akışı|değerleme|gelir|bilanço)\b/i],
];

export function classifyReportDomain(
  prompt: string,
  assets: readonly ReportDomainAsset[] = []
): ReportDomain {
  const assetContext = assets
    .map((asset) => `${asset.name || ""}\n${asset.type || ""}\n${asset.textContent || ""}`)
    .join("\n");
  const combined = `${prompt}\n${assetContext}`;
  const hasRealEstateSignal = realEstateSignals.test(combined);

  if (!hasRealEstateSignal) {
    // Checked ahead of every other branch, including the explicit
    // business-report/venture-creation check: an acquisition/M&A
    // due-diligence request is never a venture-launch request, even when
    // it names the target as a "startup" or "company" being bought, and
    // must never fall through to Business Validation, Legal Assessment,
    // or the generic Finance domain analysis.
    if (acquisitionSignals.test(combined)) {
      return "acquisition";
    }

    if (
      explicitBusinessReportSignals.test(prompt) ||
      ventureCreationSignals.test(prompt)
    ) {
      return "business";
    }

    // CRITICAL FIX -- Market Intelligence prompts routed to Legal
    // Assessment. Confirmed live: "I want a Market Intelligence analysis,
    // not a legal analysis." and "Evaluate AI legal compliance software
    // market for SMEs" both contain the bare word "legal" and neither
    // matched explicitBusinessReportSignals/ventureCreationSignals above,
    // so specializedDomainSignals' unconditional "legal" entry claimed
    // them before classifyReportDomain had any concept of Market
    // Intelligence intent at all. Checked at the same priority position
    // as the business-report/venture-creation check immediately above
    // (ahead of every specializedDomainSignals entry, including finance).
    // See marketIntelligenceLegalPriorityPattern's own comment for why
    // this uses a superset of marketIntelligenceIntentSignals rather than
    // that pattern directly.
    if (marketIntelligenceLegalPriorityPattern.test(prompt)) {
      return "business";
    }

    const specialized = specializedDomainSignals.find(
      ([domain, signal]) => domain !== "finance" && signal.test(combined)
    )?.[0];

    if (specialized) return specialized;
    if (operatingBusinessSignals.test(combined)) return "business";
    return specializedDomainSignals.find(
      ([domain, signal]) => domain === "finance" && signal.test(combined)
    )?.[0] || "business";
  }

  const promptDescribesOperatingBusiness = operatingBusinessSignals.test(prompt);
  const promptDescribesAssetDecision = directAssetInvestmentSignals.test(prompt);
  const assetLooksLikePropertyEvidence =
    /\b(tapu|deed|parcel|parsel|kadastro|cadastral|zoning|imar|land registry|property|gayrimenkul|taşınmaz)\b/i.test(
      assetContext
    );

  if (promptDescribesOperatingBusiness && !promptDescribesAssetDecision && !assetLooksLikePropertyEvidence) {
    return "business";
  }

  return "real_estate";
}

const supportedStrategicDomains = new Set<ReportDomain>([
  "real_estate",
  "legal",
  "finance",
  "accounting",
  "operations",
  "procurement",
  "acquisition",
]);

/**
 * The selected card owns the top-level workflow. Strategic Advisory may use a
 * specialized internal domain, but that domain must come from the resolved
 * expertise profile rather than a second classifier overriding the selection.
 *
 * "plan" (Business Idea Validation) and "market" (Market Intelligence) are
 * products the user explicitly selected -- there is no separate "real
 * estate"/"legal"/etc. product reachable from either, so a real_estate (or
 * any other specialized) signal at this point can only ever be an upstream
 * misclassification, never an explicit user choice. Confirmed live: a
 * Business Idea Validation prompt describing an AI SaaS platform for
 * commercial-building energy costs was routed to the real-estate
 * investment-analysis report (zoning/parcel/title/cadastral content)
 * because an upstream domain signal (independent of this function --
 * either expertise-profile.ts's own keyword fallback or a client-supplied
 * reportReadiness value) resolved to "real_estate", and this function used
 * to let that override the "plan" selection. Both branches below now
 * unconditionally return "business", the same way "market" already did,
 * so this class of misrouting is structurally impossible regardless of
 * what any upstream classifier -- current or future -- infers.
 *
 * "acquisition" is a deliberate, explicit exception to that boundary under
 * "plan" specifically (confirmed product decision, not a routing bug):
 * there is no dedicated M&A/acquisition-due-diligence product card, so a
 * real user evaluating an acquisition most naturally clicks the first,
 * most prominent card -- "Business Idea Validation" -- since nothing
 * about the three visible options signals which one fits "should I buy
 * this company." Unlike real_estate/legal/finance/etc above, this is not
 * "an upstream misclassification of an otherwise-ambiguous prompt" -- an
 * acquisition/M&A prompt is never ambiguous with a genuine business-idea
 * request (acquisitionSignals in this file requires an unambiguous,
 * compound M&A phrase, never a bare generic word), so honoring it here
 * cannot misroute a real Business Idea Validation request. "market" is
 * deliberately NOT given the same exception: Market Intelligence is
 * market research, not a decision-analysis report, and its own pipeline
 * (executeMarketAnalysisRequest) never consults this function's return
 * value for routing in the first place.
 */
export function resolveReportDomainForSelectedMode({
  selectedMode,
  inferredDomain,
  expertiseDomain,
}: {
  selectedMode: unknown;
  inferredDomain: ReportDomain;
  expertiseDomain?: unknown;
}): ReportDomain {
  if (selectedMode === "plan") {
    return inferredDomain === "acquisition" ? "acquisition" : "business";
  }

  if (selectedMode === "market") {
    return "business";
  }

  if (selectedMode !== "chat" || typeof expertiseDomain !== "string") {
    return inferredDomain;
  }

  const normalizedExpertiseDomain = expertiseDomain.trim().toLowerCase();

  if (supportedStrategicDomains.has(normalizedExpertiseDomain as ReportDomain)) {
    return normalizedExpertiseDomain as ReportDomain;
  }

  return "business";
}

// Local copy of app/lib/ai/expertise-profile.ts's mode type/normalizer,
// duplicated rather than imported so this file keeps its existing
// guarantee of carrying no runtime "@/" imports of its own -- several
// existing tests import domain.ts directly (no alias-resolution step)
// relying on exactly that. Kept intentionally tiny (3 literal values,
// covered by a drift-check test against the real definition) so it
// cannot silently diverge unnoticed.
const localSelectedAnalysisModeValues = ["plan", "market", "chat"] as const;
type LocalSelectedAnalysisMode = (typeof localSelectedAnalysisModeValues)[number];
function normalizeLocalSelectedAnalysisMode(value: unknown): LocalSelectedAnalysisMode {
  return localSelectedAnalysisModeValues.includes(value as LocalSelectedAnalysisMode)
    ? (value as LocalSelectedAnalysisMode)
    : "chat";
}

export type PromptIntentModeOverrideResult = {
  selectedMode: LocalSelectedAnalysisMode;
  overridden: boolean;
};

// CRITICAL BUG FIX -- Market Intelligence prompts routed to Business
// Plan. Market Intelligence ("market") and Business Idea Validation
// ("plan") are two separate, explicitly user-selected cards with no
// free-text classification between them anywhere in the request
// pipeline -- every downstream function (resolveReportDomainForSelectedMode
// above, expertise-profile.ts, understanding.ts) simply trusts whatever
// selectedMode it is handed. This is the one place that corrects an
// unambiguous mismatch before anything downstream reads analysisMode,
// mirroring applyDocumentAwareModeOverride's own document-based
// correction (app/lib/ai/document-intelligence.ts) -- same design, text
// intent instead of an attachment category.
//
// Deliberately conservative, matching acquisitionSignals' own
// philosophy: only overrides when Market Intelligence intent is
// unambiguous (a specific verb+market/industry/competitor phrase, an
// explicit "before entering a market" framing, or the user literally
// naming the report they want), and never when an acquisition signal or
// a genuine Business Plan EXECUTION-intent signal is also present -- a
// prompt that mixes both intents is left exactly as selected rather
// than guessed at. Market Intelligence intent takes priority over
// generic launch/build/product-idea language elsewhere in the prompt --
// the countersignal check deliberately does NOT reuse the broad,
// general-purpose ventureCreationSignals/explicitBusinessReportSignals
// (which match on bare "startup"/"founder"/"launch a business" words)
// for exactly that reason; see businessPlanExecutionIntentSignals'
// own comment. Only ever corrects "plan" -> "market"; "market" and
// "chat" selections are always returned unchanged, and this can never
// affect Acquisition routing (excluded outright) or the Business Plan
// pipeline's own logic (report generation itself is untouched).
export function applyPromptIntentModeOverride({
  selectedMode,
  prompt,
}: {
  selectedMode: unknown;
  prompt: string;
}): PromptIntentModeOverrideResult {
  const normalizedMode = normalizeLocalSelectedAnalysisMode(selectedMode);

  if (normalizedMode !== "plan") {
    return { selectedMode: normalizedMode, overridden: false };
  }

  if (acquisitionSignals.test(prompt)) {
    return { selectedMode: normalizedMode, overridden: false };
  }

  if (!marketIntelligenceIntentSignals.test(prompt)) {
    return { selectedMode: normalizedMode, overridden: false };
  }

  if (businessPlanExecutionIntentSignals.test(prompt)) {
    return { selectedMode: normalizedMode, overridden: false };
  }

  return { selectedMode: "market", overridden: true };
}
