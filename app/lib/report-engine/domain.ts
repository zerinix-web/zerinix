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
