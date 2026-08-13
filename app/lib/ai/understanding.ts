import { z } from "zod";
import {
  createDecisionInputPolicy,
  expressDecisionInputFields,
} from "../decision-intelligence/input-policy.mjs";
import {
  createExpertiseProfileFallback,
  createExpertiseProfileObjectJsonSchema,
  expertiseProfileSchema,
  normalizeSelectedAnalysisMode,
  resolveExpertiseProfile,
  type ExpertiseProfile,
  type SelectedAnalysisMode,
} from "./expertise-profile.ts";
import {
  createDynamicReportPlanFallback,
  createDynamicReportPlanObjectJsonSchema,
  dynamicReportPlanSchema,
  resolveDynamicReportPlan,
  type DynamicReportPlan,
} from "./dynamic-report-plan.ts";
import {
  createDynamicResearchPlanFallback,
  createDynamicResearchPlanObjectJsonSchema,
  dynamicResearchPlanSchema,
  resolveDynamicResearchPlan,
  type DynamicResearchPlan,
} from "./dynamic-research-plan.ts";

export const detectedIndustryValues = [
  "legal",
  "accounting",
  "retail",
  "real_estate",
  "logistics",
  "manufacturing",
  "healthcare",
  "startup",
  "marketing",
  "technology",
  "general",
] as const;

export const detectedContentTypeValues = [
  "contract",
  "financial_statement",
  "spreadsheet",
  "property_document",
  "image",
  "url",
  "business_idea",
  "general_document",
] as const;

export const clarificationQuestionSchema = z.object({
  id: z.string().trim().min(1).max(80),
  question: z.string().trim().min(1).max(240),
  placeholder: z.string().trim().max(160),
  options: z.array(z.string().trim().min(1).max(100)).max(6),
  required: z.boolean(),
});

export const extractedAssetFactSchema = z.object({
  field: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(120),
  value: z.string().trim().min(1).max(240),
  source: z.string().trim().min(1).max(180),
});

const universalUnderstandingBaseSchema = z.object({
  detectedIndustry: z.enum(detectedIndustryValues),
  detectedContentType: z.enum(detectedContentTypeValues),
  detectedIntent: z.string().trim().min(1).max(240),
  confidence: z.number().min(0).max(1),
  missingCriticalInformation: z.array(z.string().trim().min(1).max(120)).max(5),
  suggestedReportTypes: z.array(z.string().trim().min(1).max(120)).min(1).max(8),
  extractedAssetFacts: z.array(extractedAssetFactSchema).max(12).default([]),
  clarificationQuestions: z.array(clarificationQuestionSchema).max(4),
  canGenerateReport: z.boolean(),
  recommendedAction: z.enum(["chat", "report", "clarify"]),
});

export const universalUnderstandingSchema =
  universalUnderstandingBaseSchema.extend({
    expertiseProfile: expertiseProfileSchema,
    reportPlan: dynamicReportPlanSchema,
    researchPlan: dynamicResearchPlanSchema,
  });

type UniversalUnderstandingBase = z.infer<
  typeof universalUnderstandingBaseSchema
>;

export type UniversalUnderstanding = z.infer<
  typeof universalUnderstandingSchema
>;
export type ClarificationQuestion = z.infer<
  typeof clarificationQuestionSchema
>;
export type UniversalReportReadiness = {
  version: 1;
  detectedIndustry: UniversalUnderstanding["detectedIndustry"];
  requiredQuestionIds: string[];
  answers: Record<string, string>;
  expertiseProfile: ExpertiseProfile;
  reportPlan: DynamicReportPlan;
  researchPlan: DynamicResearchPlan;
  extractedAssetFacts: UniversalUnderstanding["extractedAssetFacts"];
  confirmed: true;
};

export type UnderstandingAsset = {
  name: string;
  size: number;
  mimeType?: string;
  textContent?: string;
  dataUrl?: string;
};

export function createUniversalReportReadiness(
  understanding: UniversalUnderstanding,
  clarificationAnswers: Record<string, string>
): UniversalReportReadiness | null {
  const requiredQuestionIds = understanding.clarificationQuestions
    .filter((question) => question.required)
    .map((question) => question.id);
  const allowedQuestionIds = new Set(
    understanding.clarificationQuestions.map((question) => question.id)
  );
  const answers = Object.fromEntries(
    Object.entries(clarificationAnswers)
      .filter(
        ([id, answer]) =>
          allowedQuestionIds.has(id) && Boolean(answer?.trim())
      )
      .map(([id, answer]) => [id, answer.trim().slice(0, 2_000)])
  );

  if (requiredQuestionIds.some((id) => !answers[id])) {
    return null;
  }

  return {
    version: 1,
    detectedIndustry: understanding.detectedIndustry,
    requiredQuestionIds,
    answers,
    expertiseProfile: understanding.expertiseProfile,
    reportPlan: understanding.reportPlan,
    researchPlan: understanding.researchPlan,
    extractedAssetFacts: understanding.extractedAssetFacts,
    confirmed: true,
  };
}

export function createDirectReportReadiness(
  understanding: UniversalUnderstanding
): UniversalReportReadiness {
  return {
    version: 1,
    detectedIndustry: understanding.detectedIndustry,
    requiredQuestionIds: [],
    answers: {},
    expertiseProfile: understanding.expertiseProfile,
    reportPlan: understanding.reportPlan,
    researchPlan: understanding.researchPlan,
    extractedAssetFacts: understanding.extractedAssetFacts,
    confirmed: true,
  };
}

export function getUniversalReportReadinessError(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "Complete the content summary and required questions before starting research.";
  }

  const readiness = value as Record<string, unknown>;
  const requiredQuestionIds = Array.isArray(readiness.requiredQuestionIds)
    ? readiness.requiredQuestionIds.filter(
        (item): item is string =>
          typeof item === "string" && Boolean(item.trim())
      )
    : [];
  const answers =
    readiness.answers &&
    typeof readiness.answers === "object" &&
    !Array.isArray(readiness.answers)
      ? (readiness.answers as Record<string, unknown>)
      : {};
  const hasInvalidQuestionIds =
    requiredQuestionIds.length > 4 ||
    new Set(requiredQuestionIds).size !== requiredQuestionIds.length;
  const hasMissingAnswer = requiredQuestionIds.some((id) => {
    const answer = answers[id];
    return (
      typeof answer !== "string" ||
      !answer.trim() ||
      answer.trim().length > 2_000
    );
  });

  if (
    readiness.version !== 1 ||
    readiness.confirmed !== true ||
    typeof readiness.detectedIndustry !== "string" ||
    !readiness.detectedIndustry.trim() ||
    hasInvalidQuestionIds ||
    hasMissingAnswer
  ) {
    return "Answer every required question before starting research.";
  }

  return "";
}

const URL_PATTERN = /\b(?:https?:\/\/|www\.)\S+/i;
const CURRENCY_PATTERN =
  /(?:[$€£₺¥]\s*\d|\b(?:TRY|TL|USD|EUR|GBP|JPY)\b)/i;
const PERIOD_PATTERN =
  /\b(?:20\d{2}|Q[1-4]|FY\s*20\d{2}|month|quarter|year|ay|çeyrek|yıl|dönem)\b/i;
const JURISDICTION_PATTERN =
  /\b(?:governing law|jurisdiction|laws? of|mahkemeleri|hukuku|yetkili mahkeme|Türkiye|Turkey|England|Germany|Almanya|United States|USA|EU)\b/i;
const PRICE_PATTERN =
  /(?:[$€£₺¥]\s*[\d.,]+|\b(?:fiyat|price|asking price|satış bedeli|purchase price)\b\s*[:\-]?\s*[\d.,]+)/i;
const GEOGRAPHY_PATTERN =
  /\b(?:Türkiye|Turkey|Almanya|Germany|İstanbul|Ankara|İzmir|Europe|European Union|EU|United Kingdom|UK|USA|United States|city|country|region|şehir|ülke|bölge|il|ilçe|mahalle|pazar)\b/i;
const TIMEFRAME_PATTERN =
  /\b(?:today|week|month|quarter|year|deadline|timeline|holding period|gün|hafta|ay|çeyrek|yıl|dönem|vade|takvim|süre|20\d{2})\b/i;
const LEGAL_WORKFLOW_PATTERN =
  /(?:\b(?:contract|agreement|nda|lease|terms|legal|law|lawsuit|litigation|employment law|wrongful dismissal|unfair dismissal|unpaid wages|severance|notice pay|reinstatement|mediation|limitation period)\b|sözleşme|anlaşma|kira|fesih|taraflar|hukuk|hukuki|mevzuat|dava|iş hukuku|işten çıkar|işveren|işçi|çalışan|kıdem|ihbar|ödenmeyen ücret|ödenmemiş maaş|yıllık izin|işe iade|arabuluculuk|zamanaşımı|savunma alınma|yazılı uyarı)/i;
const CONTRACT_WORKFLOW_PATTERN =
  /(?:\b(?:contract|agreement|nda|lease|terms)\b|sözleşme|anlaşma|kira sözleşmesi)/i;
const REAL_ESTATE_WORKFLOW_PATTERN =
  /(?:\b(?:property|real estate|land|parcel|title deed|zoning|property listing|office building|commercial building)\b|tapu(?:su|da|dan|nun)?|arsa(?:ya|yı|nın|da|dan)?|arazi(?:ye|yi|nin|de|den)?|parsel(?:e|i|in|de|den)?|pafta|\bada\b|imar|taşınmaz|gayrimenkul|emlak|kira|bina|konut|ofis binası|ticari bina|iş merkezi|plaza)/i;
const EXPLICIT_REAL_ESTATE_LEGAL_REVIEW_PATTERN =
  /(?:\b(?:legal review|legal analysis|contract review|contract analysis|review (?:the )?(?:contract|agreement|lease))\b|hukuki(?: açıdan)? (?:incele|inceleme|değerlendir|değerlendirme|analiz|görüş)|(?:sözleşme|kontrat|kira sözleşmesi)(?:yi|ni|nin|nın|nu|nü)?\s+(?:incele|değerlendir|analiz et))/i;
const FINANCE_WORKFLOW_PATTERN =
  /(?:\b(?:finance|financial|accounting|balance sheet|income statement|cash flow|trial balance|ledger|invoice|profitability|budget|forecast|audit|tax)\b|finans|finansal|muhasebe|bilanço|gelir tablosu|nakit akış|mizan|defter|fatura|kârlılık|karlılık|bütçe|tahmin|denetim|vergi)/i;
const MARKETING_WORKFLOW_PATTERN =
  /\b(?:marketing|campaign|conversion|brand|audience|pazarlama|kampanya|dönüşüm|marka|hedef kitle)\b/i;
// The bigram-only forms below ("kurmak istiyorum", "şirket kur") missed
// extremely common paraphrases of the exact same venture-evaluation
// intent -- confirmed live: "...SaaS platformu KURMAK MANTIKLI MI?" (is
// it sensible to build...) and "...işletmesi AÇMAK istiyorum" (I want to
// OPEN...) neither matched, because the verb ("kurmak"/"açmak") wasn't
// immediately followed by the one exact phrase "istiyorum". This adds
// the general grammatical pattern -- a venture-starting verb (kurmak/
// açmak/başlatmak, "found/open/start") followed by any of the common
// desire/evaluation endings a Turkish speaker uses after it -- which is
// a structural sentence pattern, not a sector-vocabulary word list, so
// it does not need updating per industry.
const BUSINESS_WORKFLOW_PATTERN =
  /\b(?:business idea|startup|launch|founder|build a|start a business|is it (?:worth|sensible to)\s+(?:starting|building|launching)|should i (?:start|build|launch)|does it make sense to (?:start|build|launch)|iş fikri|girişim|kurmak istiyorum|şirket kur)\b|\b(?:kurmak|açmak|başlatmak|kurmayı|açmayı|başlatmayı)\s+(?:istiyorum|düşünüyorum|planlıyorum|mantıklı\s*mı|kârlı\s*mı|karlı\s*mı|iyi\s*(?:bir\s*)?fikir\s*mi|mantıklı\s*olur\s*mu)/i;
const LEGAL_DEADLINE_PATTERN =
  /(?:\b(?:deadline|filing date|hearing date|mediation date|limitation deadline|signing date)\b|son tarih|dava açma süresi|başvuru süresi|duruşma tarihi|arabuluculuk tarihi|zamanaşımı tarihi|imza tarihi)/i;
const LEGAL_PERSPECTIVE_PATTERN =
  /(?:\b(?:on behalf of|represent(?:ing)?|my employer|my employee|i was dismissed|i was terminated|i dismissed|i terminated)\b|adına|temsil ediyorum|işten çıkarıldım|işime son verildi|işverenim|çalışanım|müvekkilim)/i;
const LEGAL_EVIDENCE_PATTERN =
  /(?:\b(?:evidence|document|contract|payroll|bank record|dismissal notice|termination notice|performance review|messages?|emails?|court filing)\b|delil|belge|sözleşme|bordro|banka kaydı|sgk kaydı|fesih bildirimi|işten çıkarma bildirimi|performans değerlendirmesi|mesaj|e-posta|dava dosyası)/i;

export type AnalysisWorkflow =
  | "legal"
  | "real_estate"
  | "business"
  | "finance"
  | "marketing"
  | "generic";

export function selectAnalysisWorkflow({
  prompt,
  assets = [],
}: {
  prompt: string;
  assets?: UnderstandingAsset[];
}): AnalysisWorkflow {
  const combined = `${prompt}\n${normalizedAssetContext(assets)}`;
  const isRealEstate = REAL_ESTATE_WORKFLOW_PATTERN.test(combined);

  if (
    isRealEstate &&
    EXPLICIT_REAL_ESTATE_LEGAL_REVIEW_PATTERN.test(combined)
  ) {
    return "legal";
  }
  if (isRealEstate) return "real_estate";

  // A prompt whose dominant signal is evaluating or launching a venture
  // (any sector) is a business-evaluation request, even when it names a
  // regulated/specialized sector as the venture's own subject matter (a
  // "legal-tech SaaS", a "fintech platform"...) -- the sector's own name
  // is not evidence the user has an actual legal matter, financial
  // statement, or campaign at hand to review. Confirmed live: "Türkiye'de
  // yapay zeka destekli hukuki belge inceleme SaaS platformu kurmak
  // mantıklı mı?" matched LEGAL_WORKFLOW_PATTERN on the bare word
  // "hukuki" and was routed to the legal case-review workflow, which then
  // produced a near-empty report because the prompt has no actual legal
  // case for that workflow to extract. Only let a specialized workflow
  // win over a detected venture-evaluation intent when the prompt also
  // carries a concrete in-hand-case signal (a real deadline or a stated
  // first-person legal position) -- this guard sits ahead of every
  // specialized check, not just legal, so a future sector keyword added
  // to any pattern below inherits the same protection.
  const isVentureEvaluation = BUSINESS_WORKFLOW_PATTERN.test(prompt);
  const hasLegalCaseInHandSignal =
    LEGAL_DEADLINE_PATTERN.test(combined) || LEGAL_PERSPECTIVE_PATTERN.test(combined);

  if (isVentureEvaluation && !hasLegalCaseInHandSignal) {
    return "business";
  }

  if (LEGAL_WORKFLOW_PATTERN.test(combined)) return "legal";
  if (isVentureEvaluation) return "business";
  if (FINANCE_WORKFLOW_PATTERN.test(combined)) return "finance";
  if (MARKETING_WORKFLOW_PATTERN.test(combined)) return "marketing";
  return "generic";
}

function normalizedAssetContext(assets: UnderstandingAsset[]) {
  return assets
    .map(
      (asset) =>
        `${asset.name} ${asset.mimeType || ""} ${(asset.textContent || "").slice(0, 4_000)}`
    )
    .join("\n");
}

function hasSpreadsheet(assets: UnderstandingAsset[]) {
  return assets.some(
    (asset) =>
      /(?:spreadsheet|excel|csv)/i.test(asset.mimeType || "") ||
      /\.(?:xlsx?|csv|tsv)$/i.test(asset.name)
  );
}

function hasImage(assets: UnderstandingAsset[]) {
  return assets.some(
    (asset) =>
      (asset.mimeType || "").startsWith("image/") ||
      /\.(?:png|jpe?g|webp|gif|heic|avif)$/i.test(asset.name)
  );
}

function hasDocument(assets: UnderstandingAsset[]) {
  return assets.some((asset) =>
    /\.(?:pdf|docx?|txt|md)$/i.test(asset.name)
  );
}

function question(
  id: string,
  questionText: string,
  placeholder: string,
  options: string[] = []
): ClarificationQuestion {
  return {
    id,
    question: questionText,
    placeholder,
    options,
    required: true,
  };
}

function optionalQuestion(
  id: string,
  questionText: string,
  placeholder: string,
  options: string[] = []
): ClarificationQuestion {
  return {
    ...question(id, questionText, placeholder, options),
    required: false,
  };
}

function isTurkish(value: string) {
  return (
    /[çğıöşüÇĞİÖŞÜ]/.test(value) ||
    /\b(?:bu|bir|için|istiyorum|analiz|sözleşme|arsa|tapu|bilanço|satış)\b/i.test(
      value
    )
  );
}

function hasAnalysisObjective(value: string) {
  return /\b(?:analy[sz]e|assess|evaluate|review|compare|decide|optimi[sz]e|forecast|report|risk|invest|buy|sell|launch|expand|incele|analiz|değerlendir|karşılaştır|karar|optimize|tahmin|rapor|risk|yatırım|satın al|sat|kur(?:mak|mayı)?|büyüt(?:mek)?)\b/i.test(
    value
  );
}

function createDomainReadinessQuestions({
  industry,
  prompt,
  combined,
  Turkish,
}: {
  industry: (typeof detectedIndustryValues)[number];
  prompt: string;
  combined: string;
  Turkish: boolean;
}) {
  const questions: ClarificationQuestion[] = [];
  const add = (item: ClarificationQuestion) => {
    if (!questions.some((candidate) => candidate.id === item.id)) {
      questions.push(item);
    }
  };

  if (industry !== "legal" && !hasAnalysisObjective(prompt)) {
    add(
      question(
        "analysis_objective",
        Turkish
          ? "Bu analiz hangi kararı desteklemeli?"
          : "What decision should this analysis support?",
        Turkish ? "Vermek istediğiniz kararı kısaca yazın" : "Briefly describe the decision"
      )
    );
  }

  if (industry === "startup") {
    if (
      !/\b(?:customer|buyer|user|audience|segment|müşteri|alıcı|kullanıcı|hedef kitle|segment)\b/i.test(
        combined
      )
    ) {
      add(
        question(
          "target_customer",
          Turkish ? "Hedef müşteri kim?" : "Who is the target customer?",
          Turkish ? "Müşteri segmentini ve temel ihtiyacını yazın" : "Describe the segment and core need"
        )
      );
    }
    if (!GEOGRAPHY_PATTERN.test(combined)) {
      add(
        question(
          "target_market",
          Turkish ? "Hangi coğrafi pazarı hedefliyorsunuz?" : "Which geographic market are you targeting?",
          Turkish ? "Ülke, bölge veya şehir" : "Country, region, or city"
        )
      );
    }
    if (
      !/\b(?:idea stage|prototype|mvp|pilot|revenue|customers?|launched|fikir aşaması|prototip|pilot|gelir|müşteri|faaliyette)\b/i.test(
        combined
      )
    ) {
      add(
        question(
          "venture_stage",
          Turkish ? "Girişim şu anda hangi aşamada?" : "What stage is the venture at?",
          "",
          Turkish
            ? ["Fikir", "Prototip", "MVP", "Pilot", "Gelir üretiyor"]
            : ["Idea", "Prototype", "MVP", "Pilot", "Revenue-generating"]
        )
      );
    }
  }

  if (industry === "legal") {
    if (!JURISDICTION_PATTERN.test(combined)) {
      add(
        question(
          "governing_jurisdiction",
          Turkish
            ? "Analiz hangi ülkenin hukukuna göre yapılmalı?"
            : "Which jurisdiction should the review use?",
          Turkish ? "Örn. Türkiye" : "e.g. England and Wales"
        )
      );
    }
    if (
      !LEGAL_PERSPECTIVE_PATTERN.test(prompt)
    ) {
      add(
        question(
          "review_perspective",
          Turkish ? "Hangi taraf açısından inceleme yapmalıyım?" : "Which party's perspective should the review use?",
          Turkish ? "Rolünüzü veya temsil ettiğiniz tarafı yazın" : "State your role or represented party"
        )
      );
    }
    if (!LEGAL_DEADLINE_PATTERN.test(combined)) {
      add(
        question(
          "decision_deadline",
          Turkish ? "Karar veya imza için son tarih nedir?" : "What is the decision or signing deadline?",
          Turkish ? "Tarih veya yaklaşık süre" : "Date or approximate timeframe"
        )
      );
    }
    if (!LEGAL_EVIDENCE_PATTERN.test(combined)) {
      add(
        question(
          "available_evidence",
          Turkish
            ? "Hangi belge veya deliller mevcut?"
            : "What documents or evidence are available?",
          Turkish
            ? "Sözleşme, bildirim, kayıt veya yazışmaları belirtin"
            : "List relevant contracts, notices, records, or correspondence"
        )
      );
    }
  }

  if (industry === "accounting" || industry === "retail") {
    if (!PERIOD_PATTERN.test(combined)) {
      add(
        question(
          "financial_period",
          Turkish ? "Veriler hangi döneme ait?" : "Which period do the records cover?",
          Turkish ? "Örn. Ocak-Aralık 2025" : "e.g. January-December 2025"
        )
      );
    }
    if (!CURRENCY_PATTERN.test(combined)) {
      add(
        question(
          "currency",
          Turkish ? "Raporlama para birimi nedir?" : "What is the reporting currency?",
          Turkish ? "Örn. TRY" : "e.g. EUR"
        )
      );
    }
    if (
      !/\b(?:company|entity|business|store|branch|şirket|işletme|mağaza|şube|ünvan|unvan)\b/i.test(
        combined
      )
    ) {
      add(
        question(
          "reporting_scope",
          Turkish ? "Analiz hangi işletme veya birimleri kapsıyor?" : "Which entity or business units are in scope?",
          Turkish ? "Şirket, şube veya birim adı" : "Entity, branch, or unit"
        )
      );
    }
  }

  if (industry === "healthcare") {
    if (
      !/\b(?:patient|population|cohort|clinic|hospital|service line|hasta|nüfus|grup|klinik|hastane|hizmet)\b/i.test(
        combined
      )
    ) {
      add(
        question(
          "healthcare_scope",
          Turkish ? "Hangi hasta grubu, kurum veya sağlık hizmeti kapsamda?" : "Which patient group, organization, or health service is in scope?",
          Turkish ? "Kişisel veri paylaşmadan kapsamı yazın" : "Describe the scope without personal data"
        )
      );
    }
    if (!GEOGRAPHY_PATTERN.test(combined)) {
      add(
        question(
          "healthcare_jurisdiction",
          Turkish ? "Hangi ülke veya sağlık sistemi esas alınmalı?" : "Which country or health system applies?",
          Turkish ? "Ülke veya bölge" : "Country or region"
        )
      );
    }
    if (!TIMEFRAME_PATTERN.test(combined)) {
      add(
        question(
          "healthcare_timeframe",
          Turkish ? "Değerlendirme hangi dönemi kapsamalı?" : "What timeframe should the assessment cover?",
          Turkish ? "Tarih aralığı veya planlama dönemi" : "Date range or planning period"
        )
      );
    }
  }

  if (industry === "logistics") {
    if (!GEOGRAPHY_PATTERN.test(combined)) {
      add(
        question(
          "logistics_geography",
          Turkish ? "Hangi rota, bölge veya tesisler kapsamda?" : "Which routes, regions, or facilities are in scope?",
          Turkish ? "Başlangıç/varış noktaları veya tesisler" : "Origins, destinations, or facilities"
        )
      );
    }
    if (
      !/\b(?:volume|orders?|shipments?|pallet|ton|kg|vehicles?|capacity|hacim|sipariş|sevkiyat|palet|ton|araç|kapasite)\b/i.test(
        combined
      )
    ) {
      add(
        question(
          "logistics_volume",
          Turkish ? "Mevcut veya beklenen operasyon hacmi nedir?" : "What is the current or expected operating volume?",
          Turkish ? "Sipariş, sevkiyat, tonaj veya araç sayısı" : "Orders, shipments, tonnage, or vehicles"
        )
      );
    }
    if (
      !/\b(?:cost|service level|delivery time|otif|sla|maliyet|hizmet seviyesi|teslimat süresi)\b/i.test(
        combined
      )
    ) {
      add(
        question(
          "logistics_target",
          Turkish ? "Öncelikli hedef veya hizmet seviyesi nedir?" : "What is the priority target or service level?",
          Turkish ? "Maliyet, süre, kapasite veya teslimat hedefi" : "Cost, time, capacity, or delivery target"
        )
      );
    }
  }

  if (
    industry === "manufacturing" ||
    industry === "marketing" ||
    industry === "technology"
  ) {
    if (!TIMEFRAME_PATTERN.test(combined)) {
      add(
        question(
          "analysis_timeframe",
          Turkish ? "Analiz hangi dönemi kapsamalı?" : "What timeframe should the analysis cover?",
          Turkish ? "Tarih aralığı veya hedef süre" : "Date range or target period"
        )
      );
    }
    if (
      !/\b(?:baseline|current|today|existing|mevcut|bugün|başlangıç|baz değer)\b/i.test(
        combined
      )
    ) {
      add(
        question(
          "current_baseline",
          Turkish ? "Mevcut durum veya başlangıç ölçümü nedir?" : "What is the current baseline?",
          Turkish ? "Mevcut performansı veya aşamayı kısaca yazın" : "Briefly describe current performance or stage"
        )
      );
    }
    if (
      !/\b(?:target|success|kpi|goal|hedef|başarı|ölçüt)\b/i.test(combined)
    ) {
      add(
        question(
          "success_criteria",
          Turkish ? "Başarı hangi ölçütle değerlendirilmeli?" : "How should success be measured?",
          Turkish ? "Hedef KPI veya karar ölçütü" : "Target KPI or decision criterion"
        )
      );
    }
  }

  return questions.slice(0, 4);
}

function createUnderstandingFallbackBase({
  prompt,
  assets = [],
}: {
  prompt: string;
  assets?: UnderstandingAsset[];
}): UniversalUnderstandingBase {
  const assetContext = normalizedAssetContext(assets);
  const combined = `${prompt}\n${assetContext}`;
  const Turkish = isTurkish(combined);
  const spreadsheet = hasSpreadsheet(assets);
  const image = hasImage(assets);
  const document = hasDocument(assets);
  const hasUrl = URL_PATTERN.test(prompt);
  const selectedWorkflow = selectAnalysisWorkflow({ prompt, assets });
  const contract = selectedWorkflow === "legal";
  const contractDocument = CONTRACT_WORKFLOW_PATTERN.test(combined);
  const property = selectedWorkflow === "real_estate";
  const accounting = selectedWorkflow === "finance";
  const retail =
    spreadsheet &&
    /\b(?:branch|store|sku|product sales|inventory turnover|retail|şube|mağaza|ürün satış|stok devir|market zinciri)\b/i.test(
      combined
    );
  const logistics =
    /\b(?:logistics|warehouse|fleet|delivery|route|shipment|lojistik|depo|filo|teslimat|sevkiyat|rota)\b/i.test(
      combined
    );
  const manufacturing =
    /\b(?:manufacturing|production line|oee|scrap|factory|üretim|fabrika|hurda|kalite kontrol)\b/i.test(
      combined
    );
  const healthcare =
    /\b(?:healthcare|hospital|clinic|patient|medical|sağlık|hastane|klinik|hasta|tıbbi)\b/i.test(
      combined
    );
  const marketing = selectedWorkflow === "marketing";
  const technology =
    /\b(?:software|technology|platform|api|app|yazılım|teknoloji|uygulama|platform)\b/i.test(
      combined
    );
  const businessIdea = selectedWorkflow === "business";

  if (businessIdea && assets.length === 0) {
    const questions = createDomainReadinessQuestions({
      industry: "startup",
      prompt,
      combined,
      Turkish,
    });
    return {
      detectedIndustry: "startup",
      detectedContentType: "business_idea",
      detectedIntent: Turkish
        ? "İş fikrinin pazar ve uygulanabilirlik potansiyelini değerlendirmek"
        : "Assess the business idea's market and execution potential",
      confidence: 0.9,
      missingCriticalInformation: questions.map((item) => item.id),
      suggestedReportTypes: Turkish
        ? ["Pazar Analizi", "Hedef Müşteri", "Rakipler", "İş Modeli", "Fiyatlandırma", "90 Günlük Plan"]
        : ["Market Analysis", "Target Customer", "Competitors", "Business Model", "Pricing", "90-Day Plan"],
      extractedAssetFacts: [],
      clarificationQuestions: questions,
      canGenerateReport: questions.length === 0,
      recommendedAction: questions.length ? "clarify" : "report",
    };
  }

  if (contract) {
    const hasIntent =
      /\b(?:summary|summarize|risk|review|missing clause|obligation|negotia|özet|risk|incele|eksik madde|yükümlülük|müzakere)\b/i.test(
        prompt
      );
    const hasJurisdiction = JURISDICTION_PATTERN.test(combined);
    const questions: ClarificationQuestion[] = [];

    if (contractDocument && !hasIntent) {
      questions.push(
        question(
          "contract_objective",
          Turkish
            ? "Bu sözleşmeyle ne yapmak istiyorsunuz?"
            : "What would you like to do with this contract?",
          "",
          Turkish
            ? ["Risk incelemesi", "Özet", "Eksik maddeler", "Yükümlülükler", "Müzakere önerileri"]
            : ["Risk review", "Summary", "Missing clauses", "Obligations", "Negotiation recommendations"]
        )
      );
    }

    if (!hasJurisdiction) {
      questions.push(
        question(
          "governing_jurisdiction",
          Turkish
            ? "Analiz hangi ülkenin hukukuna göre yapılmalı?"
            : "Which jurisdiction should the review use?",
          Turkish ? "Örn. Türkiye" : "e.g. England and Wales"
        )
      );
    }
    for (const item of createDomainReadinessQuestions({
      industry: "legal",
      prompt,
      combined,
      Turkish,
    })) {
      if (!questions.some((candidate) => candidate.id === item.id)) {
        questions.push(item);
      }
    }

    return {
      detectedIndustry: "legal",
      detectedContentType: contractDocument ? "contract" : "general_document",
      detectedIntent: contractDocument
        ? hasIntent
          ? Turkish
            ? "Sözleşmenin hukuki ve ticari risklerini değerlendirmek"
            : "Assess the contract's legal and commercial risks"
          : Turkish
            ? "Sözleşme inceleme amacını netleştirmek"
            : "Clarify the contract review objective"
        : Turkish
          ? "Hukuki durumu, hakları, riskleri ve gerekli adımları değerlendirmek"
          : "Assess the legal position, rights, risks, and required actions",
      confidence: 0.94,
      missingCriticalInformation: questions.map((item) => item.id),
      suggestedReportTypes: contractDocument
        ? Turkish
          ? ["Sözleşme Özeti", "Riskli Maddeler", "Yükümlülükler", "Müzakere Önerileri"]
          : ["Contract Summary", "Clause Risk Review", "Obligations", "Negotiation Recommendations"]
        : Turkish
          ? ["Hukuki Değerlendirme", "Delil Analizi", "Usul ve Süre Riskleri", "Sonraki Adımlar"]
          : ["Legal Assessment", "Evidence Review", "Procedural and Deadline Risks", "Next Actions"],
      extractedAssetFacts: [],
      clarificationQuestions: questions.slice(0, 4),
      canGenerateReport: questions.length === 0,
      recommendedAction: questions.length ? "clarify" : "report",
    };
  }

  if (property) {
    const investmentIntent =
      /\b(?:invest|investment|buy|valuation|return|yatırım|satın al|değerleme|getiri)\b/i.test(
        prompt
      );
    const questions: ClarificationQuestion[] = [];

    if (investmentIntent && !PRICE_PATTERN.test(combined)) {
      questions.push(
        optionalQuestion(
          "purchase_price",
          Turkish
            ? "Varsa talep edilen satış fiyatı ve para birimi nedir?"
            : "If available, what is the asking price and currency?",
          Turkish ? "Örn. 12.500.000 TRY" : "e.g. EUR 750,000"
        )
      );
    }

    const requiredQuestions = questions.filter((item) => item.required);

    return {
      detectedIndustry: "real_estate",
      detectedContentType: hasUrl && !assets.length ? "url" : "property_document",
      detectedIntent: investmentIntent
        ? Turkish
          ? "Genel yatırım ve değer artışı potansiyelini değerlendirmek"
          : "Assess general investment and value-appreciation potential"
        : Turkish
          ? "Gayrimenkul analiz amacını netleştirmek"
          : "Clarify the real-estate analysis objective",
      confidence: 0.93,
      missingCriticalInformation: requiredQuestions.map((item) => item.id),
      suggestedReportTypes: Turkish
        ? ["Yatırım Analizi", "Lokasyon Analizi", "Hukuki Risk", "İmar ve Geliştirme"]
        : ["Investment Analysis", "Location Analysis", "Legal Risk", "Zoning and Development"],
      extractedAssetFacts: [],
      clarificationQuestions: questions.slice(0, 4),
      canGenerateReport: requiredQuestions.length === 0,
      recommendedAction: requiredQuestions.length ? "clarify" : "report",
    };
  }

  if (retail) {
    const questions = createDomainReadinessQuestions({
      industry: "retail",
      prompt,
      combined,
      Turkish,
    });
    return {
      detectedIndustry: "retail",
      detectedContentType: "spreadsheet",
      detectedIntent: Turkish
        ? "Şube, ürün, kârlılık ve stok performansını değerlendirmek"
        : "Assess branch, product, profitability, and inventory performance",
      confidence: 0.91,
      missingCriticalInformation: questions.map((item) => item.id),
      suggestedReportTypes: Turkish
        ? ["Şube Performansı", "Ürün Satışları", "Kârlılık", "Stok Devir Hızı", "Aksiyon Planı"]
        : ["Branch Performance", "Product Sales", "Profitability", "Inventory Turnover", "Action Plan"],
      extractedAssetFacts: [],
      clarificationQuestions: questions,
      canGenerateReport: questions.length === 0,
      recommendedAction: questions.length ? "clarify" : "report",
    };
  }

  if (accounting || (spreadsheet && /\b(?:revenue|expense|profit|cash|gelir|gider|kâr|nakit)\b/i.test(combined))) {
    const questions = createDomainReadinessQuestions({
      industry: "accounting",
      prompt,
      combined,
      Turkish,
    });

    return {
      detectedIndustry: "accounting",
      detectedContentType: accounting ? "financial_statement" : "spreadsheet",
      detectedIntent: Turkish
        ? "Finansal sağlık, nakit akışı, kârlılık ve riskleri değerlendirmek"
        : "Assess financial health, cash flow, profitability, and risk",
      confidence: 0.92,
      missingCriticalInformation: questions.map((item) => item.id),
      suggestedReportTypes: Turkish
        ? ["Finansal Sağlık", "Nakit Akışı", "Kârlılık", "Gider ve Risk Analizi"]
        : ["Financial Health", "Cash Flow", "Profitability", "Expense and Risk Review"],
      extractedAssetFacts: [],
      clarificationQuestions: questions,
      canGenerateReport: questions.length === 0,
      recommendedAction: questions.length ? "clarify" : "report",
    };
  }

  const specializedIndustry = logistics
    ? "logistics"
    : manufacturing
      ? "manufacturing"
      : healthcare
        ? "healthcare"
        : marketing
          ? "marketing"
          : technology
            ? "technology"
            : businessIdea
              ? "startup"
              : "general";

  if (businessIdea) {
    const questions = createDomainReadinessQuestions({
      industry: "startup",
      prompt,
      combined,
      Turkish,
    });
    return {
      detectedIndustry: "startup",
      detectedContentType: "business_idea",
      detectedIntent: Turkish
        ? "İş fikrinin pazar ve uygulanabilirlik potansiyelini değerlendirmek"
        : "Assess the business idea's market and execution potential",
      confidence: 0.9,
      missingCriticalInformation: questions.map((item) => item.id),
      suggestedReportTypes: Turkish
        ? ["Pazar Analizi", "Hedef Müşteri", "Rakipler", "İş Modeli", "Fiyatlandırma", "90 Günlük Plan"]
        : ["Market Analysis", "Target Customer", "Competitors", "Business Model", "Pricing", "90-Day Plan"],
      extractedAssetFacts: [],
      clarificationQuestions: questions,
      canGenerateReport: questions.length === 0,
      recommendedAction: questions.length ? "clarify" : "report",
    };
  }

  if (spreadsheet || document || image || hasUrl) {
    const questions = createDomainReadinessQuestions({
      industry: specializedIndustry,
      prompt,
      combined,
      Turkish,
    });

    return {
      detectedIndustry: specializedIndustry,
      detectedContentType: spreadsheet
        ? "spreadsheet"
        : hasUrl
          ? "url"
          : image
            ? "image"
            : "general_document",
      detectedIntent: prompt.trim()
        ? prompt.trim().slice(0, 240)
        : Turkish
          ? "Analiz amacını netleştirmek"
          : "Clarify the analysis objective",
      confidence: prompt.trim() ? 0.79 : 0.68,
      missingCriticalInformation: questions.map((item) => item.id),
      suggestedReportTypes: Turkish
        ? ["Temel Bulgular", "Riskler", "Fırsatlar", "Öncelikli Aksiyon Planı"]
        : ["Key Findings", "Risks", "Opportunities", "Prioritized Action Plan"],
      extractedAssetFacts: [],
      clarificationQuestions: questions,
      canGenerateReport: questions.length === 0,
      recommendedAction: questions.length ? "clarify" : "report",
    };
  }

  if (specializedIndustry !== "general") {
    const questions = createDomainReadinessQuestions({
      industry: specializedIndustry,
      prompt,
      combined,
      Turkish,
    });

    return {
      detectedIndustry: specializedIndustry,
      detectedContentType:
        specializedIndustry === "startup"
          ? "business_idea"
          : "general_document",
      detectedIntent: prompt.trim().slice(0, 240),
      confidence: 0.82,
      missingCriticalInformation: questions.map((item) => item.id),
      suggestedReportTypes: Turkish
        ? ["İçerik Özeti", "Kanıt Analizi", "Riskler", "Önerilen Aksiyonlar"]
        : ["Content Summary", "Evidence Analysis", "Risks", "Recommended Actions"],
      extractedAssetFacts: [],
      clarificationQuestions: questions,
      canGenerateReport: questions.length === 0,
      recommendedAction: questions.length ? "clarify" : "report",
    };
  }

  const informationalQuestion =
    /\?$/.test(prompt.trim()) ||
    /^(?:what|how|why|when|where|who|can|could|is|are|do|does|nedir|nasıl|neden|ne zaman|nerede|kim|kaç)\b/i.test(
      prompt.trim()
    );
  const genericQuestions = informationalQuestion
    ? []
    : [
        question(
          "analysis_objective",
          Turkish
            ? "Bu analiz hangi kararı desteklemeli?"
            : "What decision should this analysis support?",
          Turkish
            ? "Vermek istediğiniz kararı kısaca yazın"
            : "Briefly describe the decision"
        ),
      ];

  return {
    detectedIndustry: specializedIndustry,
    detectedContentType: "general_document",
    detectedIntent: prompt.trim() || (Turkish ? "Genel danışmanlık" : "General advisory"),
    confidence: prompt.trim().split(/\s+/).length >= 5 ? 0.82 : 0.72,
    missingCriticalInformation: genericQuestions.map((item) => item.id),
    suggestedReportTypes: Turkish
      ? ["Stratejik Yanıt", "Seçenekler", "Sonraki Adımlar"]
      : ["Strategic Response", "Options", "Next Steps"],
    extractedAssetFacts: [],
    clarificationQuestions: genericQuestions,
    canGenerateReport: false,
    recommendedAction: genericQuestions.length ? "clarify" : "chat",
  };
}

export function createUnderstandingFallback({
  prompt,
  assets = [],
  selectedMode,
}: {
  prompt: string;
  assets?: UnderstandingAsset[];
  selectedMode?: SelectedAnalysisMode;
}): UniversalUnderstanding {
  const selectedAnalysisMode = normalizeSelectedAnalysisMode(selectedMode);
  const baseUnderstanding = createUnderstandingFallbackBase({ prompt, assets });
  const understanding =
    selectedMode === undefined
      ? baseUnderstanding
      : selectedAnalysisMode === "plan"
      ? createBusinessValidationUnderstanding(prompt, assets, baseUnderstanding)
      : selectedAnalysisMode === "market"
        ? createMarketIntelligenceUnderstanding(prompt, baseUnderstanding)
        : createStrategicAdvisoryUnderstanding(prompt, assets, baseUnderstanding);
  const expertiseProfile = createExpertiseProfileFallback({
    prompt,
    assets,
    selectedMode: selectedAnalysisMode,
    detectedDomain: understanding.detectedIndustry,
  });

  const reportPlan = createDynamicReportPlanFallback({
    expertiseProfile,
    selectedMode: selectedAnalysisMode,
    prompt,
    extractedFacts: understanding.extractedAssetFacts,
  });

  return {
    ...understanding,
    expertiseProfile,
    reportPlan,
    researchPlan: createDynamicResearchPlanFallback({
      expertiseProfile,
      reportPlan,
      selectedMode: selectedAnalysisMode,
      prompt,
      extractedFacts: understanding.extractedAssetFacts,
    }),
  };
}

function createBusinessValidationUnderstanding(
  prompt: string,
  assets: UnderstandingAsset[],
  fallback: UniversalUnderstandingBase
): UniversalUnderstandingBase {
  if (fallback.detectedIndustry === "real_estate") {
    return fallback;
  }

  const combined = `${prompt}\n${normalizedAssetContext(assets)}`;
  const Turkish = isTurkish(combined);
  const questions = createDomainReadinessQuestions({
    industry: "startup",
    prompt,
    combined,
    Turkish,
  });

  return {
    detectedIndustry: "startup",
    detectedContentType: "business_idea",
    detectedIntent: Turkish
      ? "Sunulan bilgileri iş fikri doğrulama kararı olarak değerlendirmek"
      : "Evaluate the supplied information as a business-idea validation decision",
    confidence: 0.95,
    missingCriticalInformation: questions
      .filter((item) => item.required)
      .map((item) => item.id),
    suggestedReportTypes: Turkish
      ? ["İş Fikri Doğrulama", "Müşteri Kanıtı", "Pazar Uygunluğu", "İş Modeli", "Doğrulama Planı"]
      : ["Business Idea Validation", "Customer Evidence", "Market Fit", "Business Model", "Validation Plan"],
    extractedAssetFacts: [],
    clarificationQuestions: questions,
    canGenerateReport: questions.every((item) => !item.required),
    recommendedAction: questions.some((item) => item.required)
      ? "clarify"
      : "report",
  };
}

function createStrategicAdvisoryUnderstanding(
  prompt: string,
  assets: UnderstandingAsset[],
  fallback: UniversalUnderstandingBase
): UniversalUnderstandingBase {
  if (fallback.detectedIndustry === "real_estate") {
    return fallback;
  }

  const combined = `${prompt}\n${normalizedAssetContext(assets)}`;
  const Turkish = isTurkish(combined);
  const hasGoal = prompt.trim().length > 0;
  const questions = hasGoal
    ? []
    : [
        question(
          "analysis_objective",
          Turkish
            ? "Bu danışmanlık hangi kararı desteklemeli?"
            : "What decision should this advisory support?",
          Turkish
            ? "Vermek istediğiniz kararı kısaca yazın"
            : "Briefly describe the decision"
        ),
      ];

  return {
    detectedIndustry: "general",
    detectedContentType: URL_PATTERN.test(prompt) ? "url" : "general_document",
    detectedIntent: prompt.trim().slice(0, 240) ||
      (Turkish ? "Stratejik danışmanlık amacını netleştirmek" : "Clarify the strategic advisory objective"),
    confidence: hasGoal ? 0.88 : 0.72,
    missingCriticalInformation: questions.map((item) => item.id),
    suggestedReportTypes: Turkish
      ? ["Stratejik Değerlendirme", "Seçenekler", "Riskler", "Sonraki Adımlar"]
      : ["Strategic Assessment", "Options", "Risks", "Next Steps"],
    extractedAssetFacts: fallback.extractedAssetFacts,
    clarificationQuestions: questions,
    canGenerateReport: false,
    recommendedAction: questions.length ? "clarify" : "chat",
  };
}

function createMarketIntelligenceUnderstanding(
  prompt: string,
  fallback: UniversalUnderstandingBase
): UniversalUnderstandingBase {
  const Turkish = isTurkish(prompt);
  const hasMarketSubject =
    /(?:\b(?:market|industry|sector|platform|category|segment)\b|pazar|sektör|platform|kategori|segment)/i.test(
      prompt
    ) && prompt.trim().split(/\s+/).length >= 5;
  const hasMarketGeography =
    /(?:\b(?:Europe|European Union|EU|United States|USA|US|UK|Germany|France|Spain|Turkey|Türkiye|global|worldwide|Asia|MENA)\b|Avrupa|ABD|Amerika Birleşik Devletleri|Almanya|Fransa|İspanya|küresel|dünya)/i.test(
      prompt
    );
  const questions: ClarificationQuestion[] = [];

  if (!hasMarketSubject) {
    questions.push(
      question(
        "industry_scope",
        Turkish
          ? "Hangi sektör, ürün kategorisi veya pazar incelenmeli?"
          : "Which industry, product category, or market should be analyzed?",
        Turkish ? "Sektör veya pazar kapsamı" : "Industry or market scope"
      )
    );
  }
  if (!hasMarketGeography) {
    questions.push(
      question(
        "market_geography",
        Turkish
          ? "Hangi ülke veya bölgeler karşılaştırılmalı?"
          : "Which countries or regions should be compared?",
        Turkish ? "Ülke veya bölgeler" : "Countries or regions"
      )
    );
  }

  return {
    ...fallback,
    detectedIndustry: "marketing",
    detectedContentType:
      fallback.detectedContentType === "url" ? "url" : "general_document",
    detectedIntent: Turkish
      ? "Pazar büyüklüğü, büyüme, rekabet, talep ve giriş koşullarını değerlendirmek"
      : "Assess market size, growth, competition, demand, and entry conditions",
    missingCriticalInformation: questions.map((item) => item.id),
    suggestedReportTypes: Turkish
      ? ["Pazar Büyüklüğü", "Büyüme ve Trendler", "Rekabet", "Talep", "Giriş Engelleri"]
      : ["Market Size", "Growth and Trends", "Competition", "Demand", "Entry Barriers"],
    clarificationQuestions: questions,
    canGenerateReport: questions.length === 0,
    recommendedAction: questions.length ? "clarify" : "report",
  };
}

export function enforceUnderstandingPolicy(
  value: unknown,
  fallback: UniversalUnderstanding
) {
  const backwardCompatibleValue =
    value && typeof value === "object" && !Array.isArray(value)
      ? {
          ...value,
          expertiseProfile:
            "expertiseProfile" in value
              ? value.expertiseProfile
              : fallback.expertiseProfile,
          reportPlan:
            "reportPlan" in value ? value.reportPlan : fallback.reportPlan,
          researchPlan:
            "researchPlan" in value
              ? value.researchPlan
              : fallback.researchPlan,
        }
      : value;
  const parsed = universalUnderstandingSchema.safeParse(backwardCompatibleValue);

  if (!parsed.success) {
    return fallback;
  }

  const candidate = parsed.data;
  const questions = candidate.clarificationQuestions
    .filter(
      (item, index, values) =>
        values.findIndex((candidateItem) => candidateItem.id === item.id) === index
    )
    .slice(0, 4);
  const effectiveCandidate = {
    ...candidate,
    detectedIndustry: fallback.detectedIndustry,
    detectedContentType: fallback.detectedContentType,
    detectedIntent: fallback.detectedIntent,
    suggestedReportTypes: fallback.suggestedReportTypes,
  };
  const expertiseProfile = resolveExpertiseProfile(
    effectiveCandidate.expertiseProfile,
    fallback.expertiseProfile,
    fallback.reportPlan.selectedMode
  );
  const reportPlan = resolveDynamicReportPlan({
    value: effectiveCandidate.reportPlan,
    fallback: fallback.reportPlan,
    expertiseProfile,
    selectedMode: fallback.reportPlan.selectedMode,
  });
  const researchPlan = resolveDynamicResearchPlan({
    value: effectiveCandidate.researchPlan,
    fallback: fallback.researchPlan,
    expertiseProfile,
    reportPlan,
    selectedMode: fallback.reportPlan.selectedMode,
    prompt: effectiveCandidate.detectedIntent,
    extractedFacts: effectiveCandidate.extractedAssetFacts,
  });
  const decisionInputPolicy = createDecisionInputPolicy({
    domain: effectiveCandidate.detectedIndustry,
    fields: fallback.clarificationQuestions,
  });
  const effectiveQuestions = expressDecisionInputFields({
    policy: decisionInputPolicy,
    llmPhrasings: questions,
  }).slice(0, 4);
  const blockingQuestions = effectiveQuestions.filter(
    (question) => question.required
  );
  const requiresClarification = blockingQuestions.length > 0;
  const isOrdinaryChat =
    fallback.recommendedAction === "chat" &&
    effectiveCandidate.recommendedAction === "chat";

  if (isOrdinaryChat) {
    return {
      ...effectiveCandidate,
      expertiseProfile,
      reportPlan,
      researchPlan,
      missingCriticalInformation: [],
      clarificationQuestions: [],
      canGenerateReport: false,
      recommendedAction: "chat" as const,
    };
  }

  return {
    ...effectiveCandidate,
    expertiseProfile,
    reportPlan,
    researchPlan,
    confidence: Math.min(0.99, Math.max(0.05, effectiveCandidate.confidence)),
    missingCriticalInformation: blockingQuestions.map(
      (question) => question.id
    ),
    clarificationQuestions: effectiveQuestions,
    canGenerateReport: !requiresClarification,
    recommendedAction: requiresClarification
      ? ("clarify" as const)
      : ("report" as const),
  };
}

export function createUnderstandingJsonSchema() {
  return {
    type: "json_schema" as const,
    name: "zerinix_universal_understanding",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        detectedIndustry: {
          type: "string",
          enum: [...detectedIndustryValues],
        },
        detectedContentType: {
          type: "string",
          enum: [...detectedContentTypeValues],
        },
        detectedIntent: { type: "string" },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        missingCriticalInformation: {
          type: "array",
          maxItems: 5,
          items: { type: "string" },
        },
        suggestedReportTypes: {
          type: "array",
          minItems: 1,
          maxItems: 8,
          items: { type: "string" },
        },
        extractedAssetFacts: {
          type: "array",
          maxItems: 12,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              field: { type: "string" },
              label: { type: "string" },
              value: { type: "string" },
              source: { type: "string" },
            },
            required: ["field", "label", "value", "source"],
          },
        },
        clarificationQuestions: {
          type: "array",
          maxItems: 4,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              id: { type: "string" },
              question: { type: "string" },
              placeholder: { type: "string" },
              options: {
                type: "array",
                maxItems: 6,
                items: { type: "string" },
              },
              required: { type: "boolean" },
            },
            required: ["id", "question", "placeholder", "options", "required"],
          },
        },
        canGenerateReport: { type: "boolean" },
        recommendedAction: {
          type: "string",
          enum: ["chat", "report", "clarify"],
        },
        expertiseProfile: createExpertiseProfileObjectJsonSchema(),
        reportPlan: createDynamicReportPlanObjectJsonSchema(),
        researchPlan: createDynamicResearchPlanObjectJsonSchema(),
      },
      required: [
        "detectedIndustry",
        "detectedContentType",
        "detectedIntent",
        "confidence",
        "missingCriticalInformation",
        "suggestedReportTypes",
        "extractedAssetFacts",
        "clarificationQuestions",
        "canGenerateReport",
        "recommendedAction",
        "expertiseProfile",
        "reportPlan",
        "researchPlan",
      ],
    },
  };
}
