import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { authorizeStrategicReportAccess } from "@/app/lib/strategic-report-access";
import { createClient } from "@/app/lib/supabase/server";
import {
  checkRateLimit,
  getClientIpFromRequest,
  getRateLimitHeaders,
} from "@/app/lib/security/rate-limit";
import { validateApiRequest } from "@/app/lib/security/request-validation";
import { logServerError } from "@/app/lib/security/errors";
import { logOperationalInfo } from "@/app/lib/security/logging";
import {
  createAiCacheKey,
  estimateAiCostUsd,
  extractTokenUsage,
  getCachedAiResponse,
  recordAiUsage,
  storeCachedAiResponse,
  type TokenUsage,
} from "@/app/lib/ai/governance";
import {
  buildAnalysisAssetContext,
  buildAnalysisAssetEvidenceInstructions,
  buildAnalysisProviderInput,
  createAnalysisAssetFingerprint,
  getAnalysisAssetValidationError,
  normalizeAnalysisAssets,
} from "@/app/lib/ai/analysis-assets";
import {
  formatDomainResearchBundle,
  formatDomainResearchForReportGeneration,
  runDomainAwareResearch,
  validateDomainResearchQuality,
  validateDomainResearchQualitySafely,
} from "@/app/lib/ai/domain-research";
import { MARKET_ONLY_FORBIDDEN_EVIDENCE_FIELDS } from "@/app/lib/ai/dynamic-research-plan";
import {
  createPreResearchReportCacheKey,
  createResearchBundleFingerprint,
  createReportCacheData,
  getConversationResearchSnapshot,
  getCachedMarketIntelligenceGraphFromReportData,
  getCachedResearchFromReportData,
  logSkippedResearchForReportCache,
  resolveDomainResearchWithCache,
  type ResearchCacheIdentity,
} from "@/app/lib/ai/research-cache";
import { checkAiProductionRateLimit } from "@/app/lib/ai/rate-limit";
import { createAiJobDescriptor } from "@/app/lib/ai/queue";
import { createCanonicalFinancialAssumptions } from "@/app/lib/ai/financial-assumptions";
import {
  applyMarketResearchCoverageToContext,
  formatMarketResearchCoverageForReport,
  type MarketResearchCoverage,
} from "@/app/lib/ai/market-research-coverage";
import {
  buildMarketEntryRecommendation,
  buildMarketExecutiveDecisionBrief,
  buildMarketFinalVerdictParagraph,
  assessMarketEntryConfidence,
  localizeMarketEntryDecision,
} from "@/app/lib/report-engine/market-intelligence-presentation";
import { assertNoDecisionContradiction } from "@/app/lib/report-engine/decision-contradiction-gate";
import { assertReportIsolation } from "@/app/lib/report-engine/report-isolation-validator";
import { formatExecutiveDecisionBrief } from "@/app/lib/report-engine/executive-decision-brief";
import { buildEvidenceSummary } from "@/app/lib/report-engine/evidence-summary";
import { stripFillerAndDuplicateSentences } from "@/app/lib/report-engine/filler-detection";
import { assertExecutiveQualityGate } from "@/app/lib/report-engine/executive-quality-gate";
import {
  buildMarketIntelligenceGraph,
  formatMarketIntelligenceGraphForModel,
  projectMarketIntelligenceGraphToReport,
  type MarketIntelligenceGraph,
} from "@/app/lib/ai/market-intelligence-graph";
import {
  compactReportFieldPrompt,
  createAiCostOptimizationMetrics,
  dedupeExactPromptBlocks,
} from "@/app/lib/ai/token-optimization";
import { isReportGenerationFailureText } from "@/app/lib/report-errors";
import {
  createOpenAiClient,
  getAiConfigurationErrorMessage,
  isAiTestMode,
  logAiExecution,
} from "@/app/lib/ai/runtime";
import { sanitizeAiResponseText } from "@/app/lib/ai/response-sanitization";
import {
  applyUserMemoryOperations,
  buildUserMemoryContext,
  extractExplicitMemoryOperations,
  loadUserMemoriesForUser,
} from "@/app/lib/ai/user-memory";
import { dedupeReportParagraphsAcrossSections } from "@/app/lib/report-content-quality.mjs";
import { runConsistencyValidationPass } from "@/app/lib/report-consistency-validation";
import { normalizeReportSourceSection } from "@/app/lib/report-source-normalization.mjs";
import {
  localizePdfPresentationText,
  normalizePdfText,
} from "@/app/lib/pdf-normalization.mjs";
import { serializeReportStreamChunk } from "@/app/lib/report-engine/generation-service";
import {
  createOpenAiRequestId,
  finalizeOpenAiCostResponse,
  runWithOpenAiCostContext,
  setOpenAiCostIdentity,
  withOpenAiCostOperation,
} from "@/app/lib/ai/cost-instrumentation";
import {
  createReportMetadataContext,
  flattenReportMetadataForUsage,
} from "@/app/lib/report-engine/metadata";
import {
  getCompletedReportFields,
  isPartialReportResult,
} from "@/app/lib/report-engine/pipeline";
import {
  buildMarketLanguageInstructions,
  legacyMarketSectionToField,
  marketFieldLabels,
  marketPrompts,
  marketReportFields,
  type MarketReportField,
} from "@/app/lib/report-engine/prompts/market";
import { createFullReportJsonSchema } from "@/app/lib/report-engine/schema";
import type { ResponseLanguage } from "@/app/lib/report-engine/schema";
import { getResponseLanguage, resolveReportLanguage } from "@/app/lib/report-language";

const reportFields = marketReportFields;
const fieldPrompts = marketPrompts;
const fieldLabelsByLanguage = marketFieldLabels;
const legacySectionToField = legacyMarketSectionToField;
const FULL_REPORT_FIELD = "fullReport";
const MARKET_EVIDENCE_QUALITY_VERSION = "market_evidence_graph_v6";
const MAX_AI_CALLS_PER_MARKET_REPORT = 1;
const FULL_REPORT_OPENAI_TIMEOUT_MS = 180_000;
const FULL_REPORT_POST_PROCESS_TIMEOUT_MS = 12_000;
// REGRESSION FIX: 18 fields, 8 of them carrying a full Executive Insight +
// Confidence + Next Actions block (buildExecutivePresentationDirectives),
// routinely need close to the old 6,500-token ceiling just for the model's
// own JSON text -- a real, verified generation for this exact prompt/schema
// completed at ~6,540 output tokens, meaning 6,500 clipped it mid-string on a
// normal run (not an outlier), producing an "Unterminated string in JSON"
// parse failure on every subsequent request. Sized well above the observed
// real requirement instead of right at the edge of it.
const FULL_REPORT_MAX_OUTPUT_TOKENS = 12_000;

type MarketReportChunk = Partial<Record<MarketReportField, string>>;
type MarketReportWarningChunk = {
  warning: string;
  missingFields?: MarketReportField[];
  invalidFields?: MarketReportField[];
  partial?: boolean;
};

function createReportTimeoutError(label: string, timeoutMs: number) {
  return new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)} seconds.`);
}

async function withReportTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string
) {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(createReportTimeoutError(label, timeoutMs)),
          timeoutMs
        );
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function createReportAbortSignal(parentSignal: AbortSignal, timeoutMs: number) {
  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort(createReportTimeoutError("OpenAI report generation", timeoutMs));
  }, timeoutMs);
  const abortFromParent = () => {
    controller.abort(parentSignal.reason);
  };

  if (parentSignal.aborted) {
    abortFromParent();
  } else {
    parentSignal.addEventListener("abort", abortFromParent, { once: true });
  }

  return {
    signal: controller.signal,
    get timedOut() {
      return timedOut;
    },
    cleanup() {
      clearTimeout(timeoutId);
      parentSignal.removeEventListener("abort", abortFromParent);
    },
  };
}

const marketReportTermReplacements: Array<[RegExp, string]> = [
  [/\bLow[\s-]+Confidence\b/gi, "Directional"],
  [/\bMedium[\s-]+Confidence\b/gi, "Developing"],
  [/\bHigh[\s-]+Confidence\b/gi, "Verified"],
  [/\bEarly evidence\b/gi, "Directional"],
  [/\bDeveloping evidence\b/gi, "Developing"],
  [/\bStrong evidence\b/gi, "Verified"],
  [/\bSector view\b/gi, "Market view"],
  [/\bIndustry[\s-]+Estimate\b/gi, "Market view"],
  [/\bAI[\s-]+Assumptions?\b/gi, "Planning inputs"],
  [/\bBenchmarks?\b/gi, "Market references"],
  [/\bAssumptions?\b/gi, "Planning inputs"],
  [/\bSource unavailable\b/gi, ""],
  [/\bConfidence unavailable\b/gi, ""],
  [/\bTBD\b/gi, ""],
  [/\bPlaceholder\b/gi, ""],
  [/\bUnknown\b/gi, ""],
  [/\bUnavailable\b/gi, ""],
  [/Yeni analiz\s+geçişi gerekir\.?/gi, ""],
  [/requires a fresh\s+analysis pass\.?/gi, ""],
  [/Section missing\.?/gi, ""],
  [/\bFailed\b/gi, ""],
];

function sanitizeMarketReportContent(value: string) {
  const sanitized = marketReportTermReplacements.reduce(
    (content, [pattern, replacement]) => content.replace(pattern, replacement),
    sanitizeAiResponseText(value)
  );

  return normalizePdfText(sanitized)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function detectLanguage(value: string): ResponseLanguage {
  const normalized = value.toLowerCase();
  const hasTurkishCharacters = /[çğıöşü]/i.test(normalized);
  const hasTurkishSentencePattern =
    /\b(nasıl|nedir|hangi|neden|nerede|kim|kaç|mı|mi|mu|mü|olur|olabilir|öner|analiz et)\b/i.test(
      normalized
    );
  const hasEnglishStructure =
    /\b(analyze|analyse|analysis|market|business|startup|company|idea|report|strategy|pricing|competitors?|customers?|growth|create|generate|validate|in|for|with|and|the)\b/i.test(
      normalized
    );
  const hasTurkishWords =
    /\b(ve|bir|için|ile|ama|fakat|iş|hedef|müşteri|pazar|gelir|strateji|istiyorum|yap|kurmak|deneme|merhaba|selam|evet|hayır|lutfen|lütfen)\b/i.test(
      normalized
    );

  if (hasTurkishCharacters || hasTurkishSentencePattern) {
    return "Turkish";
  }

  if (hasEnglishStructure) {
    return "English";
  }

  return hasTurkishWords ? "Turkish" : "English";
}

function normalizeLanguage(value: unknown, prompt: string): ResponseLanguage {
  return getResponseLanguage(resolveReportLanguage({
    explicitLanguage: value,
    requestText: prompt,
  }));
}

function isMarketReportField(value: string | undefined): value is MarketReportField {
  return reportFields.includes(value as MarketReportField);
}

function createReportChunk(field: MarketReportField, content: string): MarketReportChunk {
  return { [field]: content };
}

function serializeReportChunk(field: MarketReportField, content: string) {
  return serializeReportStreamChunk(
    createReportChunk(field, sanitizeMarketReportContent(content))
  );
}

function serializeNormalizedReportChunk(
  field: MarketReportField,
  content: string
) {
  const safeContent = normalizePdfText(sanitizeAiResponseText(content))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return serializeReportStreamChunk(createReportChunk(field, safeContent));
}

function serializeWarningChunk(warning: MarketReportWarningChunk) {
  return serializeReportStreamChunk(warning);
}

function serializeMarketReportChunks(report: Record<MarketReportField, string>) {
  return reportFields
    .filter((field) => report[field]?.trim())
    .map((field) => serializeNormalizedReportChunk(field, report[field]))
    .join("");
}

function createMockMarketReport(prompt: string, language: ResponseLanguage) {
  const labels = fieldLabelsByLanguage[language];

  return Object.fromEntries(
    reportFields.map((field, index) => [
      field,
      [
        `${labels[field]} mock output for "${prompt}".`,
        "AI_TEST_MODE is enabled, so this deterministic market section was generated without calling OpenAI or web search.",
        `Mock validation marker: market-analysis-${String(index + 1).padStart(2, "0")}.`,
      ].join(" "),
    ])
  ) as Record<MarketReportField, string>;
}

function marketText(
  language: ResponseLanguage,
  english: string,
  turkish: string,
  german = english,
  french = english,
  spanish = english
) {
  if (language === "Turkish") return turkish;
  if (language === "German") return german;
  if (language === "French") return french;
  if (language === "Spanish") return spanish;
  return english;
}

function marketLanguageLocale(language: ResponseLanguage) {
  if (language === "Turkish") return "tr";
  if (language === "German") return "de";
  if (language === "French") return "fr";
  if (language === "Spanish") return "es";
  return "en";
}

function localizeDeterministicMarketText(content: string, language: ResponseLanguage) {
  return localizePdfPresentationText(content, marketLanguageLocale(language));
}

function normalizeTurkishMarketSourcePhrases(content: string) {
  return content
    .replace(/\bFood & Beverage \/ Specialty Coffee\b/g, "Yiyecek & İçecek / Özel Kahve")
    .replace(/\bD2C Brand \+ Subscription \+ B2B\b/g, "D2C Marka + Abonelik + B2B")
    .replace(
      /\b(?:Revenue|Gelir) expands toward (\$[\d.,]+[kMB]?) with stronger conversion (?:and|ve) retention\.?/gi,
      "Gelir $1 seviyesine çıkar; daha güçlü dönüşüm ve elde tutma ile desteklenir."
    )
    .replace(
      /\binvestment need is (\$[\d.,]+[kMB]?) against (\$[\d.,]+[kMB]?) Year-1 ARR\.?/gi,
      "$1 yatırım ihtiyacına karşılık 1. yıl ARR hedefi $2."
    )
    .replace(/\$30\/month\b/g, "$30/ay");
}

// Market Intelligence's decision vocabulary (ENTER / MONITOR / AVOID) and
// its localization now live in app/lib/report-engine/market-intelligence-presentation.ts,
// isolated from Business Idea Validation's PASS/HOLD/VALIDATE/REJECT
// investment-decision tokens.

function cleanInternalMarketSourceFallbacks(content: string, language: ResponseLanguage) {
  const cleanReplacement = marketText(
    language,
    "Source category: Planning assumption. External citation metadata was not provided.",
    "Kaynak kategorisi: Planlama varsayımı. Harici atıf metadatası sağlanmadı.",
    "Quellenkategorie: Planungsannahme. Externe Zitationsmetadaten wurden nicht bereitgestellt.",
    "Catégorie de source : hypothèse de planification. Les métadonnées de citation externes n'ont pas été fournies.",
    "Categoría de fuente: suposición de planificación. No se proporcionaron metadatos de citación externos."
  );

  return normalizeReportSourceSection(content
    .replace(/\bsources(?:\.[a-z0-9_-]+)+\b/gi, cleanReplacement)
    .replace(/\bdeduplicated\.none\.provided\.by\.user\b/gi, cleanReplacement)
    .replace(/\bnone\.provided\.by\.user\b/gi, cleanReplacement)
    .replace(
      /\bundefined\b/gi,
      marketText(
        language,
        "Not verified",
        "Doğrulanmadı",
        "Nicht verifiziert",
        "Non vérifié",
        "No verificado"
      )
    )
    .replace(/\n{3,}/g, "\n\n")
    .trim(), { language, allowExternalCitations: true });
}

function enforceMarketReportLanguage(
  content: string,
  language: ResponseLanguage,
  marketConfidenceScore?: number
) {
  let normalized = cleanInternalMarketSourceFallbacks(content, language);

  if (typeof marketConfidenceScore === "number") {
    const confidenceValue = `${marketConfidenceScore}%`;
    normalized = normalized
      .replace(/\b(?:Decision Confidence|Karar Güveni)\s*[:\-–—]\s*\d{1,3}%?(?:\s*\([^)]+\))?/gi, () =>
        language === "Turkish"
          ? `Karar Güveni: ${confidenceValue}`
          : `Decision Confidence: ${confidenceValue}`
      )
      .replace(/\b(?:Confidence|Güven)\s*[:\-–—]\s*\d{1,3}%\b/gi, (match) =>
        /decision|karar/i.test(match)
          ? match
          : language === "Turkish"
            ? `Güven: ${confidenceValue}`
            : `Confidence: ${confidenceValue}`
      );
  }

  if (language === "Turkish") {
    return localizeDeterministicMarketText(normalizeTurkishMarketSourcePhrases(normalized), language)
      .replace(/\bAI Executive Insight\b/g, "AI Yönetici İçgörüsü")
      .replace(/\bMarket Opportunity Score\b/g, "Pazar Fırsatı Skoru")
      .replace(/\bAI Confidence Breakdown\b/g, "AI Güven Dağılımı")
      .replace(/\bRisk Matrix\b/g, "Risk Matrisi")
      .replace(/\bCEO (?:Brief|Summary)\b/g, "CEO Özeti")
      .replace(/\bMarket Entry Recommendation\b/g, "Pazara Giriş Tavsiyesi")
      .replace(/\bCommentary\s*:/g, "Yorum:")
      .replace(/\bDecision\s*:/g, "Karar:")
      .replace(/\bMain Risk\s*:/g, "Ana Risk:")
      .replace(/\bNext Action\s*:/g, "Sonraki Aksiyon:")
      .replace(/\bOwner\s*:/g, "Sahip:")
      .replace(/\bTarget\s*:/g, "Hedef:")
      .replace(/\bTrigger\s*:/g, "Tetikleyici:")
      .replace(/\bAction\s*:/g, "Aksiyon:")
      .replace(/\bStatus\s*:/g, "Durum:")
      .replace(/\bAI Analysis\b/g, "AI Analizi")
      .replace(/\bEstimated\b/g, "Tahmini")
      .replace(/\bAssumption\b/g, "Varsayım")
      .replace(/\bVerified\b/g, "Doğrulanmış")
      .replace(/\bValidation Required\b/g, "Doğrulama gerekli")
      .replace(/\bModel target\b/g, "Model hedefi")
      .replace(/\bWatch\b/g, "İzleme")
      .replace(/\bDecision Confidence\b/g, "Karar Güveni")
      .replace(/\bDecision posture\b/g, "Karar duruşu")
      .replace(/\bENTER\b/g, "GİR")
      .replace(/\bMONITOR\b/g, "İZLE")
      .replace(/\bAVOID\b/g, "KAÇIN")
      .trim();
  }

  return localizeDeterministicMarketText(normalized, language)
    .replace(/\bAI Yönetici İçgörüsü\b/g, "AI Executive Insight")
    .replace(/\bPazar Fırsatı Skoru\b/g, "Market Opportunity Score")
    .replace(/\bAI Güven Dağılımı\b/g, "AI Confidence Breakdown")
    .replace(/\bRisk Matrisi\b/g, "Risk Matrix")
    .replace(/\bCEO Özeti\b/g, "CEO Summary")
    .replace(/\bPazara Giriş Tavsiyesi\b/g, "Market Entry Recommendation")
    .replace(/\bYorum\s*:/g, "Commentary:")
    .replace(/\bKarar\s*:/g, "Decision:")
    .replace(/\bKarar Güveni\b/g, "Decision Confidence")
    .replace(/\bAna Risk\s*:/g, "Main Risk:")
    .replace(/\bSonraki Aksiyon\s*:/g, "Next Action:")
    .replace(/\bSahip\s*:/g, "Owner:")
    .replace(/\bHedef\s*:/g, "Target:")
    .replace(/\bTetikleyici\s*:/g, "Trigger:")
    .replace(/\bAksiyon\s*:/g, "Action:")
    .replace(/\bDurum\s*:/g, "Status:")
    .replace(/\bAI Analizi\b/g, "AI Analysis")
    .replace(/\bTahmini\b/g, "Estimated")
    .replace(/\bVarsayım\b/g, "Assumption")
    .replace(/\bDoğrulanmış\b/g, "Verified")
    .replace(/\bDoğrulama gerekli\b/gi, "Validation Required")
    .replace(/\bModel hedefi\b/gi, "Model target")
    .replace(/\bİzleme\b/g, "Watch")
    .replace(/\bGİR\b/g, "ENTER")
    .replace(/\bİZLE\b/g, "MONITOR")
    .replace(/\bKAÇIN\b/g, "AVOID")
    .trim();
}

// The market-safe rewrites of plan-executor.ts's founder/decision-engine
// builders (buildMarketFounderDecisionEngine, buildMarketRiskMatrix,
// buildMarketCeoBrief, etc.) that used to live here were dead code (wrapped
// in `if (false)`) AND still referenced context.investmentScore's founder/
// financial-health categories internally -- removed rather than revived,
// since they were never actually isolated from the founder/investment
// scoring engine. See app/lib/report-engine/market-intelligence-presentation.ts
// for the real, isolated replacement.


// buildMarketExecutiveScorecard / buildMarketCeoSummary used to live here,
// built entirely from context.investmentScore (Business Idea Validation's
// founder/EBITDA/runway/decision-engine scoring model) -- replaced by the
// isolated, market-native buildMarketExecutiveSummary / buildMarketEntryRecommendation
// in app/lib/report-engine/market-intelligence-presentation.ts, which never
// touches investmentScore and never evaluates a founder.

function applySharedMarketGraph(
  report: Record<MarketReportField, string>,
  graph: MarketIntelligenceGraph,
  language: ResponseLanguage
) {
  const projection = projectMarketIntelligenceGraphToReport(graph, language);
  const { marketInfrastructure, ...reportFieldsFromGraph } = projection;
  return {
    ...report,
    ...reportFieldsFromGraph,
    marketOverview: marketInfrastructure
      ? `${report.marketOverview}\n\n${marketInfrastructure}`.trim()
      : report.marketOverview,
  };
}

// Unlike plan-executor.ts's business-report path (createPlanFieldFallback),
// this parser previously left `report[field] = ""` for any field the
// model omitted or returned as failure text -- worker.ts's
// readExecutionResponse treats an empty field exactly like a missing
// one, so a single omitted field could fail the whole run with
// "Report payload is missing required sections". These fallbacks are
// deliberately generic and honest (never a fabricated market fact,
// always framed as a validation gap) so the missing/invalid-field
// tracking below (unchanged, still fully accurate for diagnostics)
// stays meaningful while the report payload itself is always complete.
const marketFieldFallbackTemplates: Record<ResponseLanguage, (label: string) => string> = {
  English: (label) =>
    `[Estimated] ${label}: This section could not be generated with sufficient evidence in this run and requires additional research before a confident assessment can be made. Treat this as a validation gap, not a market finding.`,
  Turkish: (label) =>
    `[Tahmini] ${label}: Bu bölüm bu çalıştırmada yeterli kanıtla oluşturulamadı ve güvenilir bir değerlendirme yapılmadan önce ek araştırma gerektiriyor. Bunu bir pazar bulgusu değil, bir doğrulama boşluğu olarak değerlendirin.`,
  German: (label) =>
    `[Geschätzt] ${label}: Dieser Abschnitt konnte in diesem Durchlauf nicht mit ausreichender Evidenz erstellt werden und erfordert weitere Recherche, bevor eine verlässliche Einschätzung möglich ist. Dies ist eine Validierungslücke, kein Marktbefund.`,
  French: (label) =>
    `[Estimé] ${label} : cette section n'a pas pu être générée avec des preuves suffisantes lors de cette exécution et nécessite des recherches supplémentaires avant qu'une évaluation fiable puisse être établie. Il s'agit d'une lacune de validation, non d'un constat de marché.`,
  Spanish: (label) =>
    `[Estimado] ${label}: esta sección no pudo generarse con evidencia suficiente en esta ejecución y requiere investigación adicional antes de poder realizar una evaluación fiable. Considere esto una brecha de validación, no un hallazgo de mercado.`,
};

function createMarketFieldFallback(field: MarketReportField, language: ResponseLanguage) {
  const label = marketFieldLabels[language][field];
  return marketFieldFallbackTemplates[language](label);
}

// buildMarketFinancialConfidenceAppendix / buildMarketFinancialConsistencyTargets
// used to append CAC/LTV/ARR/Gross-Margin unit-economics metrics (computed by
// a startup financial model, not real market research) onto tamSamSom, and
// then "corrected" the report against those fabricated numbers. Market
// Intelligence has no CAC/LTV/ARR field and no financial model of a
// hypothetical company -- removed rather than isolated, since there is no
// market-native equivalent to build.

function ensureMarketReportQuality(
  report: Record<MarketReportField, string>,
  coverage?: MarketResearchCoverage,
  language: ResponseLanguage = "English",
  graph?: MarketIntelligenceGraph
) {
  const normalized = { ...report };
  const marketAssessment = coverage ? assessMarketEntryConfidence(coverage) : undefined;
  // Computed once inside the `if (coverage)` block below and reused for
  // both the opening Executive Decision layer and the closing verdict
  // paragraph, so the two can never diverge or contradict each other.
  let marketExecutiveDecisionBrief: ReturnType<typeof buildMarketExecutiveDecisionBrief> | undefined;

  for (const field of reportFields) {
    const sanitized = sanitizeMarketReportContent(normalized[field] || "");
    normalized[field] = field === "sources"
      ? cleanInternalMarketSourceFallbacks(sanitized, language)
      : enforceMarketReportLanguage(sanitized, language, marketAssessment?.confidence);
  }

  // Apply the server-owned graph after generic model-output cleanup so its
  // provenance labels, URLs, formulas, and classifications remain lossless.
  if (graph) {
    Object.assign(normalized, applySharedMarketGraph(normalized, graph, language));
  }

  if (coverage) {
    const marketEntryHeading = language === "Turkish" ? "Pazara Giriş Tavsiyesi" : "Market Entry Recommendation";

    // Single Executive Decision layer: Final Decision, Confidence, Why,
    // Biggest Risks, Biggest Opportunity, and the First 90-Day Action
    // Plan -- and nothing else. No second summary, no confidence rollup,
    // and no source-reliability overview may be appended to this field.
    marketExecutiveDecisionBrief = buildMarketExecutiveDecisionBrief(normalized, language, coverage);
    normalized.executiveSummary = formatExecutiveDecisionBrief(marketExecutiveDecisionBrief, language);

    if (!normalized.strategicRecommendations.includes(marketEntryHeading)) {
      normalized.strategicRecommendations = `${normalized.strategicRecommendations}\n\n${buildMarketEntryRecommendation(normalized, language, coverage)}`.trim();
    }
  }

  // Sources become invisible: compress the model's raw citation list to a
  // category+count Evidence Summary. Detailed per-source metadata still
  // reaches report.metadata via its own, independent analysis pipeline.
  normalized.sources = buildEvidenceSummary(normalized.sources, language);

  // Deterministic closing verdict, built from the exact same brief object
  // as the opening Executive Decision layer -- appended to Sources because
  // ReportPdfButton.tsx's mergePdfSourceSections always forces Sources to
  // the final page regardless of schema field order, guaranteeing this is
  // the last thing a reader sees before closing the PDF.
  if (marketExecutiveDecisionBrief) {
    normalized.sources = `${normalized.sources}\n\n${buildMarketFinalVerdictParagraph(marketExecutiveDecisionBrief, language)}`.trim();
  }

  const deduped = dedupeReportParagraphsAcrossSections(normalized, {
    language,
    sectionLabels: fieldLabelsByLanguage[language],
  }) as Record<MarketReportField, string>;

  // Evidence and confidence stay in the background: no per-section
  // "Evidence & Confidence" block is appended to the report body, and no
  // confidence rollup or source-reliability overview is appended to
  // executiveSummary. That field carries exactly one decision and one
  // confidence value and nothing else.

  if (marketAssessment) {
    // Final consistency validation pass, run last so it sees every prior
    // addition. Silently corrects any section that contradicts the
    // report's own canonical market-entry decision -- never adds visible
    // text, never surfaces a message to the user. No metric-consistency
    // targets: Market Intelligence has no financial model of a
    // hypothetical company to check numbers against, only its own
    // AI-researched tamSamSom/cagr text, which is already the source of
    // truth and should not be silently overwritten.
    const consistencyResult = runConsistencyValidationPass({
      sections: deduped,
      fields: reportFields,
      language,
      authoritativeDecision: localizeMarketEntryDecision(marketAssessment.decision, language),
      decisionProtectedFields: ["executiveSummary", "strategicRecommendations", "sources"],
      riskOpportunity: {
        risksField: "threats",
        opportunitiesHostField: "opportunities",
      },
    });
    if (consistencyResult.correctionsApplied.length > 0) {
      logOperationalInfo("[api:market-analysis] consistency validation applied corrections", {
        consistencyScore: consistencyResult.score,
        correctionCount: consistencyResult.correctionsApplied.length,
        correctionTypes: consistencyResult.correctionsApplied.map((correction) => correction.type),
      });
    }
  }

  // Eliminate filler LAST, after dedup and consistency corrections have
  // already rewritten content -- running this earlier only caught filler
  // in the model's own raw draft and missed duplication introduced by the
  // pipeline's own later stages.
  for (const field of reportFields) {
    deduped[field] = stripFillerAndDuplicateSentences(deduped[field]);
  }

  // Fail fast instead of silently returning a mixed report: throws if any
  // section contains Business Idea Validation's or Strategic Advisory's
  // specific vocabulary (founder readiness, validation gate, runway,
  // EBITDA, PMF, fundraising, PASS/HOLD/VALIDATE/REJECT, ...).
  assertReportIsolation("market_intelligence", deduped);

  // Fail generation rather than ship a report whose Executive Decision
  // layer says AVOID while a freeform section still recommends piloting,
  // scaling, or entering the market.
  if (marketExecutiveDecisionBrief) {
    assertNoDecisionContradiction(
      marketExecutiveDecisionBrief.decision,
      deduped,
      ["strategicRecommendations", "opportunities", "marketDrivers"],
      language
    );
  }

  // Quality Gate: fail generation instead of silently returning a report
  // that dumps information rather than helping a decision-maker act. Only
  // enforced when coverage was available -- that's what makes the single
  // Executive Decision layer possible in the first place; without it
  // (e.g. a cached/degraded report with no coverage data), the report
  // falls back to its pre-existing, less-strict shape rather than
  // hard-failing on a check it was never given the inputs to satisfy.
  if (marketAssessment) {
    assertExecutiveQualityGate({
      sections: deduped,
      firstField: "executiveSummary",
      sourceFields: ["sources"],
    });
  }

  return deduped;
}

function parseFullMarketReport(
  value: string,
  coverage?: MarketResearchCoverage,
  language: ResponseLanguage = "English",
  graph?: MarketIntelligenceGraph
): {
  report: Record<MarketReportField, string>;
  missingFields: MarketReportField[];
  invalidFields: MarketReportField[];
} {
  const parsed = JSON.parse(value) as Record<string, unknown>;

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Report generation failed before every section completed.");
  }

  const report = {} as Record<MarketReportField, string>;
  const missingFields: MarketReportField[] = [];
  const invalidFields: MarketReportField[] = [];

  for (const field of reportFields) {
    const content = parsed[field];

    if (typeof content !== "string" || !content.trim()) {
      missingFields.push(field);
      report[field] = createMarketFieldFallback(field, language);
      continue;
    }

    if (isReportGenerationFailureText(content)) {
      invalidFields.push(field);
      report[field] = createMarketFieldFallback(field, language);
      continue;
    }

    report[field] = sanitizeMarketReportContent(content.trim());
  }

  return {
    report: ensureMarketReportQuality(report, coverage, language, graph),
    missingFields,
    invalidFields,
  };
}

async function countAiCallsForReport({
  supabase,
  userId,
  reportRequestId,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  reportRequestId: string;
}) {
  if (!reportRequestId) {
    return 0;
  }

  const { count, error } = await supabase
    .from("ai_usage_events")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("metadata->>report_request_id", reportRequestId)
    .eq("metadata->>actual_ai_call", "true");

  if (error) {
    console.error("[api:market-analysis] Could not verify AI call budget", {
      reportRequestId,
      error: error.message,
    });

    return 0;
  }

  return count ?? 0;
}

const TEXT_LIKE_RESPONSE_FIELD_PATTERN =
  /^(output_text|text|value|content|message|response|answer|summary)$/i;

const NON_CONTENT_RESPONSE_FIELD_PATTERN =
  /^(id|object|type|status|role|model|created|created_at|updated_at|usage|metadata|annotations|finish_reason|index|incomplete_details)$/i;

function extractTextFromValue(
  value: unknown,
  parentKey = "",
  seen: WeakSet<object> = new WeakSet()
): string {
  if (typeof value === "string") {
    return !parentKey || TEXT_LIKE_RESPONSE_FIELD_PATTERN.test(parentKey) ? value : "";
  }

  if (!value || typeof value !== "object") {
    return "";
  }

  if (seen.has(value)) {
    return "";
  }

  seen.add(value);

  if (Array.isArray(value)) {
    return value
      .map((item) => extractTextFromValue(item, parentKey, seen))
      .filter(Boolean)
      .join("");
  }

  const record = value as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type : "";
  const candidateKeys =
    type === "output_text"
      ? ["text", "value", "content", "message"]
      : [
          "output_text",
          "text",
          "value",
          "content",
          "message",
          "response",
          "answer",
          "summary",
        ];

  for (const key of candidateKeys) {
    const extracted = extractTextFromValue(record[key], key, seen);

    if (extracted.trim()) {
      return extracted;
    }
  }

  for (const [key, item] of Object.entries(record)) {
    if (candidateKeys.includes(key) || NON_CONTENT_RESPONSE_FIELD_PATTERN.test(key)) {
      continue;
    }

    const extracted = extractTextFromValue(item, key, seen);

    if (extracted.trim()) {
      return extracted;
    }
  }

  return "";
}

function extractResponseText(response: unknown) {
  if (!response || typeof response !== "object") {
    return "";
  }

  const record = response as Record<string, unknown>;

  if (record.output_parsed) {
    return JSON.stringify(record.output_parsed);
  }

  const directText = extractTextFromValue(record.output_text);

  if (directText.trim()) {
    return directText;
  }

  const outputText = extractTextFromValue(record.output);

  return outputText.trim() ? outputText : "";
}

export type MarketAnalysisExecutionContext = {
  supabase: Awaited<ReturnType<typeof createClient>>;
  user: User;
  ip: string;
};

export async function executeMarketAnalysisRequest(
  req: Request,
  executionContext?: MarketAnalysisExecutionContext
) {
  try {
    if (!executionContext) {
      const requestValidation = validateApiRequest(req, {
        maxBodyBytes: 17_000_000,
      });

      if (!requestValidation.ok) {
        return NextResponse.json(
          { error: requestValidation.message },
          { status: requestValidation.status }
        );
      }
    }

    const ip = executionContext?.ip || getClientIpFromRequest(req);
    if (!executionContext) {
      const ipRateLimit = checkRateLimit(`api:market:ip:${ip}`, {
        limit: 20,
        windowMs: 60_000,
      });

      if (!ipRateLimit.allowed) {
        return NextResponse.json(
          {
            error: "Too many requests. Please wait a moment and try again.",
          },
          {
            status: 429,
            headers: getRateLimitHeaders(ipRateLimit),
          }
        );
      }
    }

    const supabase = executionContext?.supabase || await createClient();
    const authResult = executionContext
      ? { user: executionContext.user, error: null }
      : await supabase.auth.getUser().then(({ data, error }) => ({
          user: data.user,
          error,
        }));
    const { user, error: userError } = authResult;

    if (userError || !user) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }
    setOpenAiCostIdentity({ userId: user.id, reportType: "market_intelligence" });

    const reportAccess = executionContext
      ? { allowed: true }
      : await authorizeStrategicReportAccess({
          request: req,
          account: user,
        });

    if (!reportAccess.allowed) {
      return NextResponse.json(
        { error: "Private beta access only." },
        { status: 403 }
      );
    }

    if (!executionContext) {
      const rateLimit = checkRateLimit(`api:market:${user.id}:${ip}`, {
        limit: 24,
        windowMs: 60_000,
      });

      if (!rateLimit.allowed) {
        return NextResponse.json(
          {
            error: "Too many requests. Please wait a moment and try again.",
          },
          {
            status: 429,
            headers: getRateLimitHeaders(rateLimit),
          }
        );
      }
    }

    const body = await req.json();
    const attachmentValidationError = getAnalysisAssetValidationError(
      body?.attachments
    );

    if (attachmentValidationError) {
      return NextResponse.json(
        { error: attachmentValidationError },
        { status: 400 }
      );
    }

    const {
      prompt,
      field,
      section,
      language,
      reportRequestId: rawReportRequestId,
    } = body;
    const analysisAssets = normalizeAnalysisAssets(body?.attachments);
    const assetContext = buildAnalysisAssetContext(analysisAssets);
    const assetEvidenceInstructions =
      buildAnalysisAssetEvidenceInstructions(analysisAssets);
    const assetFingerprint = createAnalysisAssetFingerprint(analysisAssets);
    const promptText = typeof prompt === "string" ? prompt : "";
    const responseLanguage = normalizeLanguage(language, promptText);
    const reportRequestId =
      typeof rawReportRequestId === "string" ? rawReportRequestId.trim().slice(0, 128) : "";

    const requestedField =
      typeof field === "string"
        ? field
        : typeof section === "string"
          ? legacySectionToField[section]
          : undefined;
    const isFullReportRequest = requestedField === FULL_REPORT_FIELD;
    const reportField = isFullReportRequest ? "executiveSummary" : requestedField;
    const usageReportField = isFullReportRequest ? FULL_REPORT_FIELD : reportField;

    if (!isMarketReportField(reportField)) {
      return NextResponse.json(
        { error: "Invalid report field." },
        { status: 400 }
      );
    }

    const fieldConfig = fieldPrompts[reportField];

    if (isAiTestMode()) {
      logAiExecution({
        endpoint: "/api/market-analysis",
        source: "mock",
        mode: isFullReportRequest ? FULL_REPORT_FIELD : reportField,
      });

      const encoder = new TextEncoder();
      const mockReport = createMockMarketReport(promptText, responseLanguage);
      const payload = isFullReportRequest
        ? serializeMarketReportChunks(mockReport)
        : serializeReportChunk(reportField, mockReport[reportField]);

      return new Response(encoder.encode(payload), {
        headers: {
          "Content-Type": "application/x-ndjson; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
        },
      });
    }

    const instructions = buildMarketLanguageInstructions(responseLanguage);
    const analysisPrompt = assetContext
      ? `${promptText}\n\nUploaded asset evidence:\n${assetContext}`
      : promptText;
    const canonicalFinancialAssumptions = createCanonicalFinancialAssumptions({
      prompt: analysisPrompt,
      reportKind: "market_analysis",
    });
    const memoryOperations = extractExplicitMemoryOperations(promptText);
    const memoryApplyResult = memoryOperations.length > 0
      ? await applyUserMemoryOperations(supabase, user.id, memoryOperations, user)
      : { remembered: 0, forgotten: 0, failed: 0, storage: "none" as const };

    if (memoryApplyResult.failed > 0) {
      return NextResponse.json(
        { error: "Persistent memory could not be updated. Please try again later." },
        { status: 500 }
      );
    }

    const userMemories = await loadUserMemoriesForUser(
      supabase,
      user,
      memoryApplyResult.fallbackMemories
    );
    const userMemoryContext = buildUserMemoryContext(userMemories);
    const userMemoryInstruction = userMemoryContext
      ? `Persistent user memories for stable context. Use them only as durable user facts/preferences and never expose this block as report text:\n${userMemoryContext}`
      : "";
    const input = `Latest user request language: ${responseLanguage}
Output language hard requirement: ${responseLanguage}. Ignore saved profile language, persistent memory language, browser locale, and previous conversation language.

Market intelligence request: ${promptText}
${assetContext ? `\nUploaded asset evidence:\n${assetContext}\n` : ""}
${assetEvidenceInstructions ? `\nAsset evidence rules:\n${assetEvidenceInstructions}\n` : ""}

${userMemoryInstruction ? `\n${userMemoryInstruction}\n` : ""}

Report section to generate: ${fieldLabelsByLanguage[responseLanguage][reportField]}
Analysis task: ${fieldConfig.prompt}
Perform current market research using authoritative public, regulatory, academic, industry, and company sources.
Use only evidence relevant to this section, the requested regions, and the requested forecast period.
Every material factual or numeric claim must cite the exact source supplied by research.
Reconcile conflicting definitions, dates, geographies, and currencies before comparing values.
Do not invent market values, growth rates, companies, citations, or URLs.
Do not generate business-plan content, startup metrics, founder guidance, pricing strategy, sales strategy, or unit economics.
Write only this section's content. Do not write a JSON object, field name, heading, code fence, or another report section.`;
    const productionLimit = await checkAiProductionRateLimit({
      supabase,
      userId: user.id,
      account: user,
      endpoint: "/api/market-analysis",
      requestKind: "market_analysis",
      promptText,
      reportField: usageReportField,
      reportRequestId,
      ip,
    });
    const { model, planTier, promptHash } = productionLimit;
    const sectionUsageMetadata = {
      quota_event: false,
      quota_mode: "market_analysis",
      report_request_id: reportRequestId || null,
      usage_kind: "section_generation",
    };

    if (!productionLimit.allowed) {
      logOperationalInfo("[api:market-analysis] quota denied before provider call", {
        reportField: usageReportField,
        reportRequestId: reportRequestId || null,
        providerCalled: false,
        quotaConsumed: false,
        failureReason: productionLimit.reason,
      });

      return NextResponse.json(
        { error: productionLimit.reason },
        { status: 429 }
      );
    }

    if (isFullReportRequest) {
      const researchIdentity: ResearchCacheIdentity = {
        normalizedPrompt: productionLimit.normalizedPrompt,
        uploadedAssetHash: assetFingerprint,
        analysisMode: "market",
        language: responseLanguage,
        reportFamily: "market_analysis",
      };
      const conversationResearch = await getConversationResearchSnapshot({
        supabase,
        userId: user.id,
        conversationId:
          typeof body?.conversationId === "string"
            ? body.conversationId
            : null,
      });
      const fullReportCacheKey = createPreResearchReportCacheKey({
        endpoint: "/api/market-analysis",
        identity: researchIdentity,
        model,
        reportVariant: `${FULL_REPORT_FIELD}:${MARKET_EVIDENCE_QUALITY_VERSION}:${canonicalFinancialAssumptions.version}:${canonicalFinancialAssumptions.fingerprint}`,
        contextFingerprint: [
          userMemoryContext,
          conversationResearch
            ? createResearchBundleFingerprint(conversationResearch.research)
            : "",
        ].filter(Boolean).join(":"),
      });
      const cachedFullReport = await getCachedAiResponse(
        supabase,
        user.id,
        fullReportCacheKey
      );
      const encoder = new TextEncoder();
      const cachedDomainResearch = getCachedResearchFromReportData(
        cachedFullReport?.responseData
      );
      const cachedMarketGraph =
        conversationResearch?.marketIntelligenceGraph ||
        getCachedMarketIntelligenceGraphFromReportData(
          cachedFullReport?.responseData
        ) ||
        (cachedDomainResearch
          ? buildMarketIntelligenceGraph(cachedDomainResearch, promptText)
          : null);
      const cachedCoverageResult = cachedDomainResearch
        ? applyMarketResearchCoverageToContext(
            canonicalFinancialAssumptions,
            cachedDomainResearch,
            promptText,
            cachedMarketGraph?.coverage
          )
        : null;
      const cachedReportContext =
        cachedCoverageResult?.context || canonicalFinancialAssumptions;

      if (
        cachedFullReport &&
        !isReportGenerationFailureText(cachedFullReport.responseText) &&
        detectLanguage(cachedFullReport.responseText) === responseLanguage
      ) {
        logAiExecution({
          endpoint: "/api/market-analysis",
          source: "cache",
          mode: FULL_REPORT_FIELD,
          model: cachedFullReport.model || model,
          cacheHit: true,
        });

        let parsedCachedReport: Record<MarketReportField, string> | null = null;
        let cachedMissingFields: MarketReportField[] = [];
        let cachedInvalidFields: MarketReportField[] = [];

        try {
          const parsedCachePayload =
            responseLanguage === "English"
              ? parseFullMarketReport(
                  cachedFullReport.responseText,
                  cachedCoverageResult?.coverage,
                  "English",
                  cachedMarketGraph || undefined
                )
              : parseFullMarketReport(
                  cachedFullReport.responseText,
                  cachedCoverageResult?.coverage,
                  responseLanguage,
                  cachedMarketGraph || undefined
                );

          parsedCachedReport = parsedCachePayload.report;
          cachedMissingFields = parsedCachePayload.missingFields;
          cachedInvalidFields = parsedCachePayload.invalidFields;
          if (cachedDomainResearch) {
            validateDomainResearchQuality({
              report: parsedCachedReport,
              bundle: cachedDomainResearch,
              expectedDomain: "business",
            });
          }
        } catch (error) {
          console.error("[api:market-analysis] Ignoring malformed cached full report", {
            reportRequestId: reportRequestId || null,
            cacheKey: fullReportCacheKey,
            failureReason:
              error instanceof Error && error.message ? error.message : "CacheParseFailed",
          });
        }

        if (!parsedCachedReport) {
          logOperationalInfo("[api:market-analysis] cache miss after malformed full report", {
            reportRequestId: reportRequestId || null,
            cacheKey: fullReportCacheKey,
          });
        } else {
          logSkippedResearchForReportCache({
            identity: researchIdentity,
            research: cachedDomainResearch,
          });

          if (cachedMissingFields.length || cachedInvalidFields.length) {
            logOperationalInfo("[api:market-analysis] cached full report partial sections", {
              reportRequestId: reportRequestId || null,
              missingFields: cachedMissingFields,
              invalidFields: cachedInvalidFields,
              source: "cache",
            });
          }
          const cachedReportMetadataContext = createReportMetadataContext({
            prompt: promptText,
            report: parsedCachedReport,
            context: cachedReportContext,
            operationType: "market_report",
            estimatedCostUsd: cachedFullReport.estimatedCostUsd,
          });

          await recordAiUsage(supabase, {
            userId: user.id,
            endpoint: "/api/market-analysis",
            reportField: FULL_REPORT_FIELD,
            promptHash,
            model: cachedFullReport.model || model,
            planTier,
            tokenUsage: {
              promptTokens: cachedFullReport.promptTokens,
              completionTokens: cachedFullReport.completionTokens,
              totalTokens: cachedFullReport.totalTokens,
            },
            estimatedCostUsd: 0,
            cacheHit: true,
            responseTimeMs: 0,
            metadata: {
              quota_event: false,
              quota_mode: "market_analysis",
              quota_consumed: false,
              report_request_id: reportRequestId || null,
              usage_kind: "full_report_cache_hit",
              actual_ai_call: false,
              research_cache_hit: true,
              skipped_gpt_research_calls: true,
              cachedEstimatedCostUsd: cachedFullReport.estimatedCostUsd,
              ...flattenReportMetadataForUsage(cachedReportMetadataContext),
            },
          });

          const cachedWarning =
            cachedMissingFields.length || cachedInvalidFields.length
              ? serializeWarningChunk({
                  warning:
                    "Market analysis returned a partial report. Some areas need additional market validation before they are decision-grade.",
                  missingFields: cachedMissingFields,
                  invalidFields: cachedInvalidFields,
                  partial: true,
                })
              : "";

          return new Response(encoder.encode(
            cachedWarning +
              serializeMarketReportChunks(parsedCachedReport)
          ), {
            headers: {
              "Content-Type": "application/x-ndjson; charset=utf-8",
              "Cache-Control": "no-cache, no-transform",
            },
          });
        }
      }

      if (cachedFullReport) {
        console.error("[api:market-analysis] Ignoring cached failed full report content", {
          endpoint: "/api/market-analysis",
          reportField: FULL_REPORT_FIELD,
          cacheKey: fullReportCacheKey,
        });
      }

      const marketResearchClient = createOpenAiClient();
      const { research: domainResearch } =
        await resolveDomainResearchWithCache({
          supabase,
          userId: user.id,
          identity: researchIdentity,
          conversationId:
            typeof body?.conversationId === "string"
              ? body.conversationId
              : null,
          execute: () => runDomainAwareResearch({
            client: marketResearchClient,
            model,
            prompt: promptText,
            assets: analysisAssets,
            language: responseLanguage,
            signal: req.signal,
            researchUserId: user.id,
            // This endpoint only ever serves Market Intelligence requests.
            // Without this, the shared research pipeline defaults
            // selectedMode to "chat", which skips the market-intent
            // routing/safety-net checks entirely and can misroute
            // finance/accounting-flavored prompts (e.g. "accounting
            // software") into company-specific evidence requirements
            // (company_financials/industry_benchmarks/macro_inputs) that a
            // multi-vendor public market survey can never satisfy.
            selectedMode: "market",
          }),
        });
      const legacyDomainResearchContext = formatDomainResearchBundle(domainResearch);
      const domainResearchContext =
        formatDomainResearchForReportGeneration(domainResearch);
      // The conversation snapshot is authoritative when present. Rebuilding is
      // deterministic and only supports older snapshots that predate the graph.
      const marketIntelligenceGraph =
        conversationResearch?.marketIntelligenceGraph ||
        buildMarketIntelligenceGraph(domainResearch, promptText);
      logOperationalInfo("[api:market-analysis] shared market graph selected", {
        source: conversationResearch?.marketIntelligenceGraph
          ? "conversation_snapshot"
          : "deterministic_projection",
        competitorCount: marketIntelligenceGraph.competitors.length,
        sourceCount: marketIntelligenceGraph.sources.length,
        hasPlanningEstimate: Boolean(marketIntelligenceGraph.planningEstimate),
        verifiedMarketSizeCount:
          marketIntelligenceGraph.verifiedMarketSize.length,
        overallConfidence: marketIntelligenceGraph.coverage.overallConfidence,
        confidenceDimensions: marketIntelligenceGraph.coverage.dimensions,
      });
      const marketCoverageResult = applyMarketResearchCoverageToContext(
        canonicalFinancialAssumptions,
        domainResearch,
        promptText,
        marketIntelligenceGraph.coverage
      );
      const marketEvidenceCoverageContext =
        formatMarketResearchCoverageForReport(marketCoverageResult.coverage);
      const reportAnalysisContext = marketCoverageResult.context;

      if (domainResearch.recommendedOutput === "clarification") {
        // This endpoint only ever serves Market Intelligence requests (a
        // public, multi-vendor survey), which can never be blocked on
        // company-specific strategic-analysis evidence -- there is no
        // single issuer to source filings, benchmarks, or macro
        // assumptions from. Strip those fields from the clarification
        // message here as well, so a misclassified upstream plan (or any
        // future change upstream) can't resurface this exact regression
        // in the user-facing error text.
        const clarificationUnresolvedFields =
          domainResearch.unresolvedFields.filter(
            (field) => !MARKET_ONLY_FORBIDDEN_EVIDENCE_FIELDS.has(field)
          );
        return NextResponse.json(
          {
            error:
              responseLanguage === "Turkish"
                ? `Araştırma tamamlandı, ancak karar raporu için doğrulanabilir temel kanıt bulunamadı. Gerekli bilgi veya belge: ${clarificationUnresolvedFields.join(", ") || "karar bağlamı"}.`
                : `Research completed, but no verifiable core evidence was found for a decision report. Required information or document: ${clarificationUnresolvedFields.join(", ") || "decision context"}.`,
          },
          { status: 422 }
        );
      }

      const existingAiCallCount = await countAiCallsForReport({
        supabase,
        userId: user.id,
        reportRequestId,
      });

      logOperationalInfo("[api:market-analysis] AI call budget", {
        endpoint: "/api/market-analysis",
        reportRequestId: reportRequestId || null,
        existingAiCallCount,
        maxAiCallsPerReport: MAX_AI_CALLS_PER_MARKET_REPORT,
        requestedField: FULL_REPORT_FIELD,
      });

      if (existingAiCallCount >= MAX_AI_CALLS_PER_MARKET_REPORT) {
        return NextResponse.json(
          {
            error:
              "AI call budget exceeded for this report. Please start a new report request.",
          },
          { status: 429 }
        );
      }

      const verboseFieldContracts = reportFields.map((fieldName) => `- ${fieldName}: ${fieldLabelsByLanguage[responseLanguage][fieldName]} — ${fieldPrompts[fieldName].prompt}`).join("\n");
      const compactFieldContracts = reportFields.map((fieldName) => `- ${fieldName}: ${fieldLabelsByLanguage[responseLanguage][fieldName]} — ${compactReportFieldPrompt(fieldPrompts[fieldName].prompt)}`).join("\n");
      const verboseFullReportInput = `Latest user request language: ${responseLanguage}
Output language hard requirement: ${responseLanguage}. Ignore saved profile language, persistent memory language, browser locale, and previous conversation language.

Market intelligence request: ${promptText}
${assetContext ? `\nUploaded asset evidence:\n${assetContext}\n` : ""}
${assetEvidenceInstructions ? `\nAsset evidence rules:\n${assetEvidenceInstructions}\n` : ""}

${userMemoryInstruction ? `\n${userMemoryInstruction}\n` : ""}

Completed domain-aware research (this is the closed evidence registry for the report):
${domainResearchContext}

Final validated market intelligence graph (authoritative shared chat/report object):
${formatMarketIntelligenceGraphForModel(marketIntelligenceGraph)}

${marketEvidenceCoverageContext}

Generate the complete Market Analysis report as one structured JSON object.
Return exactly these JSON keys and no others:
${compactFieldContracts}

Deterministic report contract:
- Return the JSON keys in the exact order listed above.
- Every section must add distinct market intelligence and may not inherit business-plan content.
- Remove repeated claims while retaining the section-specific implication.
- Maintain an internal insight ledger. Explain each claim once; later sections may use a cross-reference of at most 12 words and must add only new section-owned analysis.
- Target at least 20% fewer output tokens than a repetitive draft by removing restatement and filler only; preserve evidence, citations, definitions, calculations, and decisions.

Research is already complete. Synthesize the uploaded evidence and the evidence registry above; do not perform a second research pass.
Every material factual claim must include its evidence label and an inline [R#], [Asset: filename], [User], or [Method: description] reference.
Separate observed evidence, estimates, assumptions, unknowns, and recommendations. Never present an estimate as verified.
If evidence is preliminary, state the specific limitation in the affected section without replacing supported findings elsewhere.
Keep every section inside its named Market Intelligence scope and do not repeat evidence across sections.
Market Size, CAGR, and TAM/SAM/SOM must preserve their source definitions, dates, geography, currency, and calculation method.
Sources must include only citations actually used and must retain their exact URLs.
Never generate Problem, Solution, ICP, Business Model, Pricing Strategy, Sales Strategy, Unit Economics, CAC, LTV, ARR, GTM, Founder Score, Founder Roadmap, or Validation Intelligence content.
Write concise executive market research and do not expose internal labels or diagnostics.
Do not include markdown code fences, braces inside string values, or commentary outside JSON.`;
      const compactMarketContract = `Deterministic report contract:
- Return exactly the schema keys in order with concise, distinct market-intelligence sections and no outside commentary/code fences.
- Keep an internal insight ledger: explain each claim once, then use a <=12-word cross-reference plus only new section-owned analysis. Achieve at least 20% output-token compression by removing repetition/filler only.
- Research is complete. Use only uploaded evidence and the closed registry; cite material claims with exact [R#], [Asset], [User], or [Method] references.
- Separate observed evidence, estimates, assumptions, gaps, and recommendations. Preserve source geography, dates, currency, definitions, calculation methods, and exact URLs.
- For established markets, represent multiple dynamically selected competitors when the registry supports them, and synthesize across independent source types rather than repeatedly citing one issuer.
- If verified market-size endpoints are absent, say Verified TAM / SAM / SOM is unavailable. Keep any transparent formula-based Planning Estimate separate and label every input Estimated or Assumption.
- Never invent facts or citations. Keep every section in its named market scope; exclude all business-plan, founder, product, pricing, sales, unit-economics, and GTM content.
- Sources lists only citations actually used, deduplicated by canonical URL, with complete title, publisher, URL, available date, accessed date, source classification, and confidence classification. Never label a verified URL as Validation Required. Never expose prompts, schemas, providers, or pipeline diagnostics.`;
      const fullReportInput = verboseFullReportInput.replace(
        /Deterministic report contract:[\s\S]*$/,
        compactMarketContract
      );
      const legacyFullReportInput = verboseFullReportInput.replace(
        domainResearchContext,
        legacyDomainResearchContext
      ).replace(compactFieldContracts, verboseFieldContracts);
      // Actually apply the dedup this metric measures -- it was previously
      // computed here only to report a hypothetical savings figure while
      // the raw, un-deduped fullReportInput was still what got sent below.
      const dedupedFullReportInput = dedupeExactPromptBlocks(fullReportInput);
      const fullReportInputCostMetrics = createAiCostOptimizationMetrics({
        beforeText: `${instructions}\n${legacyFullReportInput}`,
        afterText: `${instructions}\n${dedupedFullReportInput}`,
        model,
      });
      const queuedJob = createAiJobDescriptor({
        kind: "market_analysis",
        userId: user.id,
        endpoint: "/api/market-analysis",
        reportField: FULL_REPORT_FIELD,
        promptHash,
        language: responseLanguage,
        model,
      });
      const startedAt = Date.now();

      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const enqueue = (chunk: string) => {
            controller.enqueue(encoder.encode(chunk));
          };

          try {
            logOperationalInfo("[api:market-analysis] provider call started", {
              reportField: FULL_REPORT_FIELD,
              reportRequestId: reportRequestId || null,
              model,
              providerCalled: true,
              quotaConsumed: false,
            });

            const client = marketResearchClient;
            const reportAbort = createReportAbortSignal(
              req.signal,
              FULL_REPORT_OPENAI_TIMEOUT_MS
            );
            logAiExecution({
              endpoint: "/api/market-analysis",
              source: "real_ai",
              mode: FULL_REPORT_FIELD,
              model,
            });
            let response: Awaited<ReturnType<typeof client.responses.create>>;

            try {
              response = await withReportTimeout(
                withOpenAiCostOperation(
                  {
                    operationName: "market_intelligence_report",
                    reportType: "market_intelligence",
                  },
                  () => client.responses.create(
                  {
                    model,
                    instructions,
                    input: buildAnalysisProviderInput(
                      dedupedFullReportInput,
                      analysisAssets
                    ),
                    max_output_tokens: FULL_REPORT_MAX_OUTPUT_TOKENS,
                    reasoning: {
                      effort: "low",
                    },
                    text: {
                      verbosity: "medium",
                      format: createFullReportJsonSchema(
                        "zerinix_market_analysis_report",
                        reportFields
                      ),
                    },
                  },
                  { signal: reportAbort.signal })
                ),
                FULL_REPORT_OPENAI_TIMEOUT_MS,
                "OpenAI report generation"
              );
            } catch (error) {
              if (reportAbort.timedOut) {
                throw createReportTimeoutError(
                  "OpenAI report generation",
                  FULL_REPORT_OPENAI_TIMEOUT_MS
                );
              }

              throw error;
            } finally {
              reportAbort.cleanup();
            }

            const tokenUsage = extractTokenUsage(response);
            const estimatedCostUsd = estimateAiCostUsd(model, tokenUsage);
            const responseTimeMs = Date.now() - startedAt;
            const responseText = extractResponseText(response);
            const {
              report: parsedReport,
              missingFields,
              invalidFields,
            } =
              responseLanguage === "English"
                ? parseFullMarketReport(
                    responseText,
                    marketCoverageResult.coverage,
                    "English",
                    marketIntelligenceGraph
                  )
                : parseFullMarketReport(
                    responseText,
                    marketCoverageResult.coverage,
                    responseLanguage,
                    marketIntelligenceGraph
                  );
            validateDomainResearchQualitySafely({
              report: parsedReport,
              bundle: domainResearch,
              expectedDomain: "business",
            });
            const reportMetadataContext = createReportMetadataContext({
              prompt: promptText,
              report: parsedReport,
              context: reportAnalysisContext,
              operationType: "market_report",
              estimatedCostUsd,
            });
            const cacheResponseText = JSON.stringify(parsedReport);
            const isPartialReport = isPartialReportResult(missingFields, invalidFields);

            logOperationalInfo("[api:market-analysis] full report section validation", {
              reportRequestId: reportRequestId || null,
              model,
              responseTextLength: responseText.length,
              completedFields: getCompletedReportFields(reportFields, missingFields, invalidFields),
              missingFields,
              invalidFields,
              partial: isPartialReport,
            });
            reportFields.forEach((fieldName) => {
              logOperationalInfo("[api:market-analysis] section validation step", {
                reportRequestId: reportRequestId || null,
                reportField: fieldName,
                model,
                status: missingFields.includes(fieldName)
                  ? "missing"
                  : invalidFields.includes(fieldName)
                    ? "invalid"
                    : "completed",
                contentLength: parsedReport[fieldName]?.length || 0,
              });
            });

            const warning =
              isPartialReport
                ? serializeWarningChunk({
                    warning:
                      "Market analysis returned a partial report. Some areas need additional market validation before they are decision-grade.",
                    missingFields,
                    invalidFields,
                    partial: true,
                  })
                : "";

            enqueue(warning + serializeMarketReportChunks(parsedReport));

            await withReportTimeout(
              (async () => {
                if (!isPartialReport && !isReportGenerationFailureText(cacheResponseText)) {
                  await storeCachedAiResponse(supabase, {
                    userId: user.id,
                    cacheKey: fullReportCacheKey,
                    promptHash,
                    endpoint: "/api/market-analysis",
                    reportField: FULL_REPORT_FIELD,
                    language: responseLanguage,
                    model,
                    responseText: cacheResponseText,
                    responseData: createReportCacheData(
                      domainResearch,
                      marketIntelligenceGraph
                    ),
                    tokenUsage,
                    estimatedCostUsd,
                    expiresInDays: 3,
                  });
                } else if (isPartialReport) {
                  logOperationalInfo("[api:market-analysis] skipped cache for partial full report", {
                    reportRequestId: reportRequestId || null,
                    missingFields,
                    invalidFields,
                  });
                }

                await recordAiUsage(supabase, {
                  userId: user.id,
                  endpoint: "/api/market-analysis",
                  reportField: FULL_REPORT_FIELD,
                  promptHash,
                  model,
                  planTier,
                  tokenUsage,
                  estimatedCostUsd,
                  cacheHit: false,
                  responseTimeMs,
                  metadata: {
                    quota_event: !productionLimit.quotaAlreadyCharged,
                    quota_mode: "market_analysis",
                    quota_consumed: !productionLimit.quotaAlreadyCharged,
                    report_request_id: reportRequestId || null,
                    usage_kind: "full_report_generation",
                    actual_ai_call: true,
                    max_ai_calls_per_report: MAX_AI_CALLS_PER_MARKET_REPORT,
                    job: queuedJob,
                    ...fullReportInputCostMetrics,
                    ...flattenReportMetadataForUsage(reportMetadataContext),
                  },
                });
              })(),
              FULL_REPORT_POST_PROCESS_TIMEOUT_MS,
              "Report post-processing"
            ).catch((error) => {
              logServerError("api:market-analysis:full-report-post-process", error);
            });

            logOperationalInfo("[api:market-analysis] provider call completed", {
              reportField: FULL_REPORT_FIELD,
              reportRequestId: reportRequestId || null,
              model,
              providerCalled: true,
              quotaConsumed: !productionLimit.quotaAlreadyCharged,
            });
          } catch (error) {
            const configurationError = getAiConfigurationErrorMessage(error);
            const errorMessage =
              configurationError ||
              (error instanceof Error && error.message ? error.message : "GenerationFailed");

            await withReportTimeout(
              recordAiUsage(supabase, {
                userId: user.id,
                endpoint: "/api/market-analysis",
                reportField: FULL_REPORT_FIELD,
                promptHash,
                model,
                planTier,
                tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
                estimatedCostUsd: 0,
                cacheHit: false,
                status: "failed",
                responseTimeMs: Date.now() - startedAt,
                metadata: {
                  quota_event: false,
                  quota_mode: "market_analysis",
                  quota_consumed: false,
                  report_request_id: reportRequestId || null,
                  usage_kind: "full_report_generation",
                  actual_ai_call: true,
                  max_ai_calls_per_report: MAX_AI_CALLS_PER_MARKET_REPORT,
                  job: queuedJob,
                  ...fullReportInputCostMetrics,
                  failure_reason: errorMessage,
                },
              }),
              FULL_REPORT_POST_PROCESS_TIMEOUT_MS,
              "Failed report usage write"
            ).catch((usageError) => {
              logServerError("api:market-analysis:full-report-failed-usage-write", usageError);
            });
            logOperationalInfo("[api:market-analysis] provider call failed", {
              reportField: FULL_REPORT_FIELD,
              reportRequestId: reportRequestId || null,
              model,
              providerCalled: true,
              quotaConsumed: false,
              failureReason: errorMessage,
            });
            logServerError("api:market-analysis:full-report", error);

            // REGRESSION FIX: this used to synthesize a full placeholder
            // report (every field replaced with the same generic
            // could-not-be-generated fallback copy used for a single
            // missing field) and enqueue it dressed up as a normal
            // "partial report" warning -- so a genuine failure (a provider
            // timeout, a truncated/malformed response, or the isolation/
            // quality gate rejecting bad content) looked to the caller
            // like a successfully generated report, with that fallback
            // copy standing in for every section, hiding the real failure
            // instead of surfacing it. A report may only be returned when
            // it was actually built from the model's real output. Fail
            // loudly instead, matching plan-executor.ts's own
            // serializePlanStreamError convention for the identical
            // failure class.
            enqueue(
              serializeReportStreamChunk({
                error: errorMessage,
                errorStage: "market_report_generation",
                fatal: true,
              })
            );
          } finally {
            controller.close();
          }
        },
      });

      return new Response(stream, {
        status: 200,
        headers: {
          "Content-Type": "application/x-ndjson; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
        },
      });
    }

    const cacheKey = createAiCacheKey({
      endpoint: "/api/market-analysis",
      normalizedPrompt: userMemoryContext
        ? `${productionLimit.normalizedPrompt}\nmemories:${userMemoryContext}\nassets:${assetFingerprint}`
        : `${productionLimit.normalizedPrompt}\nassets:${assetFingerprint}`,
      mode: `market_analysis:${reportField}:${canonicalFinancialAssumptions.version}:${canonicalFinancialAssumptions.fingerprint}`,
      language: responseLanguage,
      model,
    });

    const cachedResponse = await getCachedAiResponse(supabase, user.id, cacheKey);
    const encoder = new TextEncoder();

    if (
      cachedResponse &&
      !isReportGenerationFailureText(cachedResponse.responseText) &&
      detectLanguage(cachedResponse.responseText) === responseLanguage
    ) {
      logAiExecution({
        endpoint: "/api/market-analysis",
        source: "cache",
        mode: reportField,
        model: cachedResponse.model || model,
        cacheHit: true,
      });

      await recordAiUsage(supabase, {
        userId: user.id,
        endpoint: "/api/market-analysis",
        reportField,
        promptHash,
        model: cachedResponse.model || model,
        planTier,
        tokenUsage: {
          promptTokens: cachedResponse.promptTokens,
          completionTokens: cachedResponse.completionTokens,
          totalTokens: cachedResponse.totalTokens,
        },
        estimatedCostUsd: 0,
        cacheHit: true,
        responseTimeMs: 0,
        metadata: {
          ...sectionUsageMetadata,
          quota_consumed: false,
          cachedEstimatedCostUsd: cachedResponse.estimatedCostUsd,
        },
      });

      return new Response(encoder.encode(serializeReportChunk(reportField, cachedResponse.responseText)), {
        headers: {
          "Content-Type": "application/x-ndjson; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
        },
      });
    }

    if (cachedResponse) {
      console.error("[api:market-analysis] Ignoring cached failed report content", {
        endpoint: "/api/market-analysis",
        reportField,
        cacheKey,
      });
    }

    const queuedJob = createAiJobDescriptor({
      kind: "market_analysis",
      userId: user.id,
      endpoint: "/api/market-analysis",
      reportField,
      promptHash,
      language: responseLanguage,
      model,
    });
    const startedAt = Date.now();

    logOperationalInfo("[api:market-analysis] provider call started", {
      reportField,
      reportRequestId: reportRequestId || null,
      model,
      providerCalled: true,
      quotaConsumed: false,
    });

    let client: ReturnType<typeof createOpenAiClient>;

    try {
      client = createOpenAiClient();
    } catch (error) {
      const configurationError = getAiConfigurationErrorMessage(error);

      if (configurationError) {
        return NextResponse.json({ error: configurationError }, { status: 500 });
      }

      throw error;
    }

    logAiExecution({
      endpoint: "/api/market-analysis",
      source: "real_ai",
      mode: reportField,
      model,
    });

    const stream = await withOpenAiCostOperation(
      {
        operationName: `market_intelligence:${reportField}`,
        reportType: "market_intelligence",
      },
      () => client.responses.create(
        {
          model,
          instructions,
          input: buildAnalysisProviderInput(input, analysisAssets),
          max_output_tokens: fieldConfig.maxTokens,
          stream: true,
          reasoning: {
            effort: "low",
          },
          tools: [
            {
              type: "web_search_preview",
              search_context_size: "low",
            },
          ],
          include: ["web_search_call.action.sources"],
          text: {
            verbosity: "medium",
          },
        },
        { signal: req.signal })
      ).catch(async (error) => {
        logOperationalInfo("[api:market-analysis] provider request failed", {
          reportField,
          reportRequestId: reportRequestId || null,
          model,
          providerCalled: true,
          quotaConsumed: false,
          failureReason:
            error instanceof Error && error.message ? error.message : "ProviderError",
        });

        await recordAiUsage(supabase, {
          userId: user.id,
          endpoint: "/api/market-analysis",
          reportField,
          promptHash,
          model,
          planTier,
          tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          estimatedCostUsd: 0,
          cacheHit: false,
          status: "failed",
          responseTimeMs: Date.now() - startedAt,
          metadata: {
            ...sectionUsageMetadata,
            quota_consumed: false,
            job: queuedJob,
            phase: "openai_request",
            failure_reason:
              error instanceof Error && error.message ? error.message : "ProviderError",
          },
        });

        throw error;
      });

    return new Response(
      new ReadableStream({
        async start(controller) {
          let tokenUsage: TokenUsage = {
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
          };

          try {
            let streamedText = "";

            for await (const event of stream) {
              if (event.type === "response.output_text.delta" && event.delta) {
                streamedText += event.delta;
                controller.enqueue(
                  encoder.encode(serializeReportChunk(reportField, event.delta))
                );
              }

              if (event.type === "response.output_text.done" && !streamedText) {
                streamedText = event.text;
                controller.enqueue(
                  encoder.encode(serializeReportChunk(reportField, event.text))
                );
              }

              if (event.type === "response.completed") {
                tokenUsage = extractTokenUsage(event.response);
                const completedText = extractResponseText(event.response);

                if (completedText && !streamedText) {
                  streamedText = completedText;
                  controller.enqueue(
                    encoder.encode(serializeReportChunk(reportField, completedText))
                  );
                }
              }
            }

            const estimatedCostUsd = estimateAiCostUsd(model, tokenUsage);
            const responseTimeMs = Date.now() - startedAt;

            if (streamedText && !isReportGenerationFailureText(streamedText)) {
              await storeCachedAiResponse(supabase, {
                userId: user.id,
                cacheKey,
                promptHash,
                endpoint: "/api/market-analysis",
                reportField,
                language: responseLanguage,
                model,
                responseText: streamedText,
                tokenUsage,
                estimatedCostUsd,
                expiresInDays: 3,
              });
            } else if (streamedText) {
              console.error("[api:market-analysis] Refused to cache failed report content", {
                endpoint: "/api/market-analysis",
                reportField,
                cacheKey,
              });
            }

            await recordAiUsage(supabase, {
              userId: user.id,
              endpoint: "/api/market-analysis",
              reportField,
              promptHash,
              model,
              planTier,
              tokenUsage,
              estimatedCostUsd,
              cacheHit: false,
              responseTimeMs,
              metadata: {
                ...sectionUsageMetadata,
                quota_event: !productionLimit.quotaAlreadyCharged,
                quota_consumed: !productionLimit.quotaAlreadyCharged,
                job: queuedJob,
              },
            });

            logOperationalInfo("[api:market-analysis] provider call completed", {
              reportField,
              reportRequestId: reportRequestId || null,
              model,
              providerCalled: true,
              quotaConsumed: !productionLimit.quotaAlreadyCharged,
            });

            controller.close();
          } catch (error) {
            await recordAiUsage(supabase, {
              userId: user.id,
              endpoint: "/api/market-analysis",
              reportField,
              promptHash,
              model,
              planTier,
              tokenUsage,
              estimatedCostUsd: estimateAiCostUsd(model, tokenUsage),
              cacheHit: false,
              status: "failed",
              responseTimeMs: Date.now() - startedAt,
              metadata: {
                ...sectionUsageMetadata,
                quota_consumed: false,
                job: queuedJob,
                failure_reason:
                  error instanceof Error && error.message ? error.message : "GenerationFailed",
              },
            });
            logServerError("api:market-analysis:stream", error);
            controller.error(error);
          }
        },
      }),
      {
        headers: {
          "Content-Type": "application/x-ndjson; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
        },
      }
    );
  } catch (error) {
    logServerError("api:market-analysis", error);

    return NextResponse.json(
      { error: "Market analysis could not be generated." },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  const requestId = createOpenAiRequestId(req);
  return runWithOpenAiCostContext(
    { requestId, route: "/api/market-analysis", reportType: "market_intelligence" },
    async () => finalizeOpenAiCostResponse(await executeMarketAnalysisRequest(req))
  );
}
