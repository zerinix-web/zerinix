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
import {
  createPreResearchReportCacheKey,
  createReportCacheData,
  getCachedResearchFromReportData,
  logSkippedResearchForReportCache,
  resolveDomainResearchWithCache,
  type ResearchCacheIdentity,
} from "@/app/lib/ai/research-cache";
import { checkAiProductionRateLimit } from "@/app/lib/ai/rate-limit";
import { createAiJobDescriptor } from "@/app/lib/ai/queue";
import {
  createCanonicalFinancialAssumptions,
  formatDecisionConfidenceReport,
  formatReportIntelligenceSummary,
  type AiFinancialModelContext,
} from "@/app/lib/ai/financial-assumptions";
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
import { normalizeReportSourceSection } from "@/app/lib/report-source-normalization.mjs";
import {
  localizePdfPresentationLabel,
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
const MAX_AI_CALLS_PER_MARKET_REPORT = 1;
const FULL_REPORT_OPENAI_TIMEOUT_MS = 180_000;
const FULL_REPORT_POST_PROCESS_TIMEOUT_MS = 12_000;

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
  [/\bWAIT\b/g, "Hold for validation"],
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

function serializeWarningChunk(warning: MarketReportWarningChunk) {
  return serializeReportStreamChunk(warning);
}

function serializeMarketReportChunks(report: Record<MarketReportField, string>) {
  return reportFields
    .filter((field) => report[field]?.trim())
    .map((field) => serializeReportChunk(field, report[field]))
    .join("");
}

function createFallbackMarketReport() {
  return Object.fromEntries(
    reportFields.map((field) => [field, ""])
  ) as Record<MarketReportField, string>;
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

function marketText(language: ResponseLanguage, english: string, turkish: string) {
  return language === "Turkish" ? turkish : english;
}

function marketLabel(language: ResponseLanguage, english: string, turkish: string) {
  return language === "Turkish"
    ? localizePdfPresentationLabel(turkish || english, "tr")
    : localizePdfPresentationLabel(english, "en");
}

function localizeDeterministicMarketText(content: string, language: ResponseLanguage) {
  return localizePdfPresentationText(content, language === "Turkish" ? "tr" : "en");
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

function localizeMarketDecision(decision: string, language: ResponseLanguage) {
  if (language !== "Turkish") return decision;

  const normalized = decision.toUpperCase();
  if (normalized === "PASS") return "GEÇ";
  if (normalized === "HOLD") return "BEKLE";
  if (normalized === "VALIDATE") return "DOĞRULA";
  if (normalized === "REJECT") return "REDDET";

  return decision;
}

function cleanInternalMarketSourceFallbacks(content: string, language: ResponseLanguage) {
  const cleanReplacement = marketText(
    language,
    "Source category: Planning assumption. External citation metadata was not provided.",
    "Kaynak kategorisi: Planlama varsayımı. Harici atıf metadatası sağlanmadı."
  );

  return normalizeReportSourceSection(content
    .replace(/\bsources(?:\.[a-z0-9_-]+)+\b/gi, cleanReplacement)
    .replace(/\bdeduplicated\.none\.provided\.by\.user\b/gi, cleanReplacement)
    .replace(/\bnone\.provided\.by\.user\b/gi, cleanReplacement)
    .replace(/\bundefined\b/gi, marketText(language, "Not verified", "Doğrulanmadı"))
    .replace(/\n{3,}/g, "\n\n")
    .trim(), { language, allowExternalCitations: true });
}

function enforceMarketReportLanguage(
  content: string,
  language: ResponseLanguage,
  context?: AiFinancialModelContext
) {
  let normalized = cleanInternalMarketSourceFallbacks(content, language);

  if (context) {
    const confidenceValue = `${context.reportIntelligence.totalScore}%`;
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
      .replace(/\bFounder Decision Engine\b/g, "Kurucu Karar Motoru")
      .replace(/\bRisk Matrix\b/g, "Risk Matrisi")
      .replace(/\bCEO (?:Brief|Summary)\b/g, "CEO Özeti")
      .replace(/\bCommentary\s*:/g, "Yorum:")
      .replace(/\bDecision\s*:/g, "Karar:")
      .replace(/\bInvestment Recommendation\s*:/g, "Yatırım Tavsiyesi:")
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
      .replace(/\bPASS\b/g, "GEÇ")
      .replace(/\bHOLD\b/g, "BEKLE")
      .replace(/\bVALIDATE\b/g, "DOĞRULA")
      .replace(/\bREJECT\b/g, "REDDET")
      .trim();
  }

  return localizeDeterministicMarketText(normalized, language)
    .replace(/\bAI Yönetici İçgörüsü\b/g, "AI Executive Insight")
    .replace(/\bPazar Fırsatı Skoru\b/g, "Market Opportunity Score")
    .replace(/\bAI Güven Dağılımı\b/g, "AI Confidence Breakdown")
    .replace(/\bKurucu Karar Motoru\b/g, "Founder Decision Engine")
    .replace(/\bRisk Matrisi\b/g, "Risk Matrix")
    .replace(/\bCEO Özeti\b/g, "CEO Summary")
    .replace(/\bYorum\s*:/g, "Commentary:")
    .replace(/\bKarar\s*:/g, "Decision:")
    .replace(/\bKarar Güveni\b/g, "Decision Confidence")
    .replace(/\bYatırım Tavsiyesi\s*:/g, "Investment Recommendation:")
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
    .replace(/\bGEÇ\b/g, "PASS")
    .replace(/\bBEKLE\b/g, "HOLD")
    .replace(/\bDOĞRULA\b/g, "VALIDATE")
    .replace(/\bREDDET\b/g, "REJECT")
    .trim();
}

if (false) {
function scorePercent(score: number, maximumScore: number) {
  return maximumScore > 0 ? Math.round((score / maximumScore) * 100) : 0;
}

function buildMarketExecutiveInsight(
  context: AiFinancialModelContext,
  focus: string,
  language: ResponseLanguage
) {
  return marketText(
    language,
    `AI Executive Insight: ${focus} matters because the founder should validate ${context.investmentScore.nextCriticalAction.toLowerCase()} before committing spend against the beachhead demand signal and ${context.metrics.cacPayback.displayValue} payback assumption.`,
    `AI Yönetici İçgörüsü: ${focus}, kurucunun başlangıç pazar talebi ve ${context.metrics.cacPayback.displayValue} geri ödeme varsayımına karşı harcama yapmadan önce ${context.investmentScore.nextCriticalAction.toLowerCase()} konusunu doğrulaması gerektiği için önemlidir.`
  );
}

function cleanTamSamSomCommentary(content: string) {
  return content
    .replace(/\b(?:AI\s+)?Executive Insight\s*[:\-–—][\s\S]*$/i, "")
    .replace(/\b(?:yorum|interpretation|commentary)\s*[:\-–—][\s\S]*$/i, "")
    .replace(/\b(?:TAM|SAM|SOM)\s*[:\-–—][\s\S]*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTamSamSomCommentary(content: string) {
  const line = sanitizeMarketReportContent(content)
    .split("\n")
    .map((item) => item.trim().replace(/^[-*•]\s*/, ""))
    .find((item) => /^(yorum|interpretation|commentary)\s*[:\-–—]/i.test(item));

  return line
    ? cleanTamSamSomCommentary(
        line.replace(/^(yorum|interpretation|commentary)\s*[:\-–—]\s*/i, "")
      )
    : "";
}

function buildCanonicalMarketTamSamSomSection(
  context: AiFinancialModelContext,
  sourceContent = "",
  language: ResponseLanguage
) {
  const { tam, sam, som } = context.metrics;
  const commentary =
    extractTamSamSomCommentary(sourceContent) ||
    marketText(
      language,
      "Treat the sizing as a directional market-entry model until category boundaries, serviceable segment, and obtainable wedge are validated with current market evidence.",
      "Kategori sınırları, hizmet verilebilir segment ve elde edilebilir giriş kaması güncel pazar kanıtıyla doğrulanana kadar bu büyüklükleme yön gösteren bir pazara giriş modeli olarak ele alınmalıdır."
    );

  return sanitizeMarketReportContent(
    [
      `TAM: ${tam.displayValue}`,
      `SAM: ${sam.displayValue}`,
      `SOM: ${som.displayValue}`,
      `${marketLabel(language, "Commentary", "Yorum")}: ${commentary}`,
      buildMarketExecutiveInsight(context, marketText(language, "Market sizing", "Pazar büyüklüğü"), language),
    ].join("\n")
  );
}

function buildMarketOpportunityScore(context: AiFinancialModelContext, language: ResponseLanguage) {
  const engine = context.investmentScore.decisionEngine;
  const demand = scorePercent(engine.marketScore.score, engine.marketScore.maximumScore);
  const competition = scorePercent(engine.competitionScore.score, engine.competitionScore.maximumScore);
  const timing = Math.round((demand + scorePercent(engine.technologyScore.score, engine.technologyScore.maximumScore)) / 2);
  const executionDifficulty = 100 - scorePercent(engine.executionScore.score, engine.executionScore.maximumScore);
  const revenuePotential = scorePercent(engine.financialScore.score, engine.financialScore.maximumScore);
  const overall = Math.round(
    demand * 0.25 +
      competition * 0.15 +
      timing * 0.2 +
      (100 - executionDifficulty) * 0.2 +
      revenuePotential * 0.2
  );

  return [
    marketText(language, `- Demand Score: ${demand}/100`, `- Talep Skoru: ${demand}/100`),
    marketText(language, `- Competition Score: ${competition}/100`, `- Rekabet Skoru: ${competition}/100`),
    marketText(language, `- Timing Score: ${timing}/100`, `- Zamanlama Skoru: ${timing}/100`),
    marketText(language, `- Execution Difficulty: ${executionDifficulty}/100`, `- Yürütme Zorluğu: ${executionDifficulty}/100`),
    marketText(language, `- Revenue Potential: ${revenuePotential}/100`, `- Gelir Potansiyeli: ${revenuePotential}/100`),
    marketText(language, `- Overall Opportunity Score: ${overall}/100 — strongest when demand, timing, execution feasibility, and revenue potential reinforce the same entry thesis.`, `- Genel Fırsat Skoru: ${overall}/100 — talep, zamanlama, yürütülebilirlik ve gelir potansiyeli aynı giriş tezini desteklediğinde güçlenir.`),
  ];
}

function buildMarketConfidenceBreakdown(context: AiFinancialModelContext, language: ResponseLanguage) {
  const engine = context.investmentScore.decisionEngine;
  const investmentConfidence = context.investmentScore.confidence;
  const market = scorePercent(engine.marketScore.score, engine.marketScore.maximumScore);
  const competition = scorePercent(engine.competitionScore.score, engine.competitionScore.maximumScore);
  const financial = scorePercent(engine.financialScore.score, engine.financialScore.maximumScore);
  const execution = scorePercent(engine.executionScore.score, engine.executionScore.maximumScore);
  const product = scorePercent(engine.technologyScore.score, engine.technologyScore.maximumScore);
  return [
    marketText(language, `- Investment Confidence: ${investmentConfidence}%`, `- Yatırım Güveni: ${investmentConfidence}%`),
    marketText(language, `- Decision Confidence: ${context.reportIntelligence.totalScore}% — derived from evidence quality, source coverage, financial certainty, benchmark fit, and validation readiness.`, `- Karar Güveni: ${context.reportIntelligence.totalScore}% — kanıt kalitesi, kaynak kapsamı, finansal kesinlik, benchmark uyumu ve doğrulama hazırlığından türetilmiştir.`),
    marketText(language, `- Market Confidence: ${market}% — ${engine.marketScore.explanation}`, `- Pazar Güveni: ${market}% — ${engine.marketScore.explanation}`),
    marketText(language, `- Competition Confidence: ${competition}% — ${engine.competitionScore.explanation}`, `- Rekabet Güveni: ${competition}% — ${engine.competitionScore.explanation}`),
    marketText(language, `- Financial Confidence: ${financial}% — ${engine.financialScore.explanation}`, `- Finansal Güven: ${financial}% — ${engine.financialScore.explanation}`),
    marketText(language, `- Execution Confidence: ${execution}% — ${engine.executionScore.explanation}`, `- Yürütme Güveni: ${execution}% — ${engine.executionScore.explanation}`),
    marketText(language, `- Product Confidence: ${product}% — technology/product readiness affects differentiation and defensibility.`, `- Ürün Güveni: ${product}% — teknoloji/ürün hazırlığı farklılaşmayı ve savunulabilirliği etkiler.`),
    marketText(language, "- Decision confidence is driven most by market proof, capital efficiency, execution realism, and validation evidence.", "- Karar güveni en çok pazar kanıtı, sermaye verimliliği, yürütme gerçekçiliği ve doğrulama kanıtından etkilenir."),
  ];
}

function buildMarketRiskMatrix(context: AiFinancialModelContext, language: ResponseLanguage) {
  const risks = context.investmentScore.topRisks.length
    ? context.investmentScore.topRisks
    : language === "Turkish"
      ? ["Talep doğrulama riski", "Rekabet tepkisi riski", "CAC ve geri ödeme riski"]
      : ["Demand validation risk", "Competitive response risk", "CAC and payback risk"];

  return risks.slice(0, 4).map((risk, index) => {
    const probability = index === 0 ? marketText(language, "High", "Yüksek") : marketText(language, "Medium", "Orta");
    const impact = index <= 1 ? marketText(language, "High", "Yüksek") : marketText(language, "Medium", "Orta");
    const severity = index === 0 ? marketText(language, "Critical", "Kritik") : marketText(language, "Material", "Önemli");
    const isEconomicRisk = /\b(cac|payback|capital|fund|margin|price|sermaye|geri ödeme|marj|fiyat)\b/i.test(risk);
    const isCompetitiveRisk = /\b(compet|substitut|incumbent|rekabet|rakip|ikame)\b/i.test(risk);
    const mitigation = isEconomicRisk
      ? marketText(language, `cap entry spend until ${context.metrics.cacPayback.displayValue} payback is observed`, `${context.metrics.cacPayback.displayValue} geri ödeme gözlenene kadar giriş harcamasını sınırla`)
      : isCompetitiveRisk
        ? marketText(language, `prove a measurable switching benefit for ${context.inputs.targetCustomer} before broad positioning spend`, `geniş konumlandırma harcamasından önce ${context.inputs.targetCustomer} için ölçülebilir geçiş faydasını kanıtla`)
        : marketText(language, `test the ${context.inputs.pricingModel} offer with ${context.inputs.targetCustomer} before expanding the entry wedge`, `giriş kamasını genişletmeden önce ${context.inputs.pricingModel} teklifini ${context.inputs.targetCustomer} ile test et`);
    const earlyWarning = isEconomicRisk
      ? marketText(language, `CAC exceeds ${context.metrics.cac.displayValue} or payback exceeds ${context.metrics.cacPayback.displayValue}`, `CAC ${context.metrics.cac.displayValue} üzerine çıkar veya geri ödeme ${context.metrics.cacPayback.displayValue} değerini aşar`)
      : isCompetitiveRisk
        ? marketText(language, "qualified buyers prefer the incumbent workflow after a direct offer comparison", "nitelikli alıcılar doğrudan teklif karşılaştırmasından sonra mevcut çözümü tercih eder")
        : marketText(language, `qualified demand does not convert at the ${context.metrics.arpa.displayValue} planning input`, `nitelikli talep ${context.metrics.arpa.displayValue} planlama girdisinde dönüşmez`);

    return marketText(
      language,
      `- ${risk} | Probability: ${probability} | Impact: ${impact} | Severity: ${severity} | Mitigation: ${mitigation} | Early Warning Signal: ${earlyWarning}.`,
      `- ${risk} | Olasılık: ${probability} | Etki: ${impact} | Şiddet: ${severity} | Azaltım: ${mitigation} | Erken Uyarı Sinyali: ${earlyWarning}.`
    );
  });
}

function buildMarketFounderDecisionEngine(context: AiFinancialModelContext, language: ResponseLanguage) {
  return [
    marketText(language, `- If I were the founder: I would first validate ${context.investmentScore.nextCriticalAction.toLowerCase()}.`, `- Kurucu olsaydım: Önce ${context.investmentScore.nextCriticalAction.toLowerCase()} konusunu doğrulardım.`),
    marketText(language, `- What to postpone: expansion beyond ${context.inputs.geography} and multi-channel acquisition until ${context.inputs.targetCustomer} conversion is repeatable.`, `- Ertelenecekler: ${context.inputs.targetCustomer} dönüşümü tekrarlanabilir olana kadar ${context.inputs.geography} ötesine genişleme ve çok kanallı edinim.`),
    marketText(language, `- Where to spend money: ${context.inputs.targetCustomer} interviews, ${context.inputs.pricingModel} pricing tests, competitor-switching proof, and the smallest ${context.inputs.industry} launch asset.`, `- Para harcanacak alan: ${context.inputs.targetCustomer} görüşmeleri, ${context.inputs.pricingModel} fiyat testleri, rakipten geçiş kanıtı ve en küçük ${context.inputs.industry} lansman varlığı.`),
    marketText(language, `- What to avoid: treating category growth as obtainable revenue before ${context.metrics.arpa.displayValue} willingness-to-pay evidence exists.`, `- Kaçınılacaklar: ${context.metrics.arpa.displayValue} ödeme isteği kanıtı oluşmadan kategori büyümesini elde edilebilir gelir saymak.`),
  ];
}

function buildCanonicalMarketKpiDashboard(context: AiFinancialModelContext, language: ResponseLanguage) {
  const { metrics, revenueForecast } = context;
  const yearOne = revenueForecast[0];
  const customerLabel =
    context.inputs.industryKey === "mobility"
      ? marketText(language, "active riders", "aktif kullanıcı")
      : marketText(language, "customers", "müşteri");

  return [
    marketText(language, `Acquisition: ${yearOne.customers.toLocaleString("en-US")} ${customerLabel} by Month 12 | Target: ${Math.ceil(yearOne.customers / 12).toLocaleString("en-US")} net new ${customerLabel}/month | Status: Model target`, `Edinim: 12. ayda ${yearOne.customers.toLocaleString("en-US")} ${customerLabel} | Hedef: ayda ${Math.ceil(yearOne.customers / 12).toLocaleString("en-US")} net yeni ${customerLabel} | Durum: Model hedefi`),
    marketText(language, "Activation: Validation Required | Target: prove first paid activation from qualified demand before scaling | Status: Validation required", "Aktivasyon: Doğrulama gerekli | Hedef: ölçeklemeden önce nitelikli talepten ilk ücretli aktivasyonu kanıtla | Durum: Doğrulama gerekli"),
    marketText(language, "Retention: Validation Required | Target: validate repeat purchase or renewal behavior before increasing acquisition spend | Status: Validation required", "Elde Tutma: Doğrulama gerekli | Hedef: edinim harcamasını artırmadan önce tekrar satın alma veya yenileme davranışını doğrula | Durum: Doğrulama gerekli"),
    marketText(language, `Revenue: ${metrics.mrr.displayValue} monthly / ${metrics.arr.displayValue} yearly | Target: Base-case forecast | Status: Model target`, `Gelir: aylık ${metrics.mrr.displayValue} / yıllık ${metrics.arr.displayValue} | Hedef: Baz senaryo tahmini | Durum: Model hedefi`),
    marketText(language, `CAC: ${metrics.cac.displayValue} | Target: maintain CAC within benchmark payback range | Status: Watch`, `CAC: ${metrics.cac.displayValue} | Hedef: CAC değerini referans geri ödeme aralığında tut | Durum: İzleme`),
    marketText(language, `WTP: ${metrics.arpa.displayValue} | Target: validate willingness to pay with paid demand evidence | Status: Validation required`, `Ödeme İsteği: ${metrics.arpa.displayValue} | Hedef: ödeme isteğini ücretli talep kanıtıyla doğrula | Durum: Doğrulama gerekli`),
    marketText(language, "Sales cycle: Validation Required | Target: measure time from qualified lead to first paid conversion | Status: Validation required", "Satış Döngüsü: Doğrulama gerekli | Hedef: nitelikli adaydan ilk ücretli dönüşüme kadar geçen süreyi ölç | Durum: Doğrulama gerekli"),
    marketText(language, "Conversion: Validation Required | Target: prove repeatable conversion before scaling spend | Status: Validation required", "Dönüşüm: Doğrulama gerekli | Hedef: harcamayı ölçeklemeden önce tekrarlanabilir dönüşümü kanıtla | Durum: Doğrulama gerekli"),
  ].join("\n");
}

function getVisibleDecision(context: AiFinancialModelContext) {
  const score = context.investmentScore;

  if (score.recommendation === "GO") return "VALIDATE";
  if (score.recommendation === "PASS" && score.confidence < 35) return "PASS";

  return "HOLD";
}

function buildCanonicalMarketExecutiveRecommendation(
  context: AiFinancialModelContext,
  language: ResponseLanguage
) {
  const confidence = context.reportIntelligence.totalScore;
  const confidenceLabel =
    confidence >= 75
      ? marketText(language, "High", "Yüksek")
      : confidence >= 55
        ? marketText(language, "Medium", "Orta")
        : marketText(language, "Low", "Düşük");
  const decision = localizeMarketDecision(getVisibleDecision(context), language);
  const recommendation =
    decision === localizeMarketDecision("VALIDATE", language)
      ? marketText(language, "Validate market demand with controlled entry spend", "Kontrollü giriş harcamasıyla pazar talebini doğrula")
      : decision === localizeMarketDecision("PASS", language)
        ? marketText(language, "Pass until market access or economics improve", "Pazar erişimi veya ekonomi iyileşene kadar geç")
        : marketText(language, "Hold for validation before scaling entry spend", "Giriş harcamasını ölçeklemeden önce doğrulama için bekle");
  const reportQualityConfidence =
    context.reportIntelligence.confidenceLevel === "High Confidence"
      ? marketText(language, "High Confidence", "Yüksek Güven")
      : context.reportIntelligence.confidenceLevel === "Low Confidence"
        ? marketText(language, "Low Confidence", "Düşük Güven")
        : marketText(language, "Medium Confidence", "Orta Güven");
  const benchmarkActions = context.benchmarkScore.actions.slice(0, 2).join("; ");
  const benchmarkActionsTr = [
    context.benchmarkScore.dimensions.pricingFit < 65 ? "fiyatlandırmayı doğrula" : "",
    context.benchmarkScore.deviations.some((deviation) => deviation.metric === "CAC" && deviation.status !== "Within Benchmark")
      ? "edinim kanallarını test et"
      : "",
    context.benchmarkScore.dimensions.financialBenchmarkFit < 65 ? "ilk sermaye riskini azalt" : "",
  ].filter(Boolean).join("; ") || "benchmark varsayımlarını operasyon verisiyle izle";

  return [
    marketText(language, `Decision: ${decision}`, `Karar: ${decision}`),
    marketText(language, `Decision Confidence: ${confidence}% (${confidenceLabel})`, `Karar Güveni: ${confidence}% (${confidenceLabel})`),
    marketText(language, `Report Quality Confidence: ${reportQualityConfidence} (${context.reportIntelligence.totalScore}/100)`, `Rapor Kalitesi Güveni: ${reportQualityConfidence} (${context.reportIntelligence.totalScore}/100)`),
    marketText(
      language,
      `Validation Intelligence: ${context.validationIntelligenceV2.overallScore}/100 (${context.validationIntelligenceV2.confidenceLevel}). Priority: ${context.validationIntelligenceV2.recommendedSequence[0] || "Validate customer demand"}`,
      `Doğrulama Zekası: ${context.validationIntelligenceV2.overallScore}/100 (${context.validationIntelligenceV2.confidenceLevel === "High" ? "Yüksek" : context.validationIntelligenceV2.confidenceLevel === "Medium" ? "Orta" : "Düşük"}). Öncelik: ${context.validationIntelligenceV2.recommendedSequence[0] === "Validate customer demand" ? "Müşteri talebini doğrula" : context.validationIntelligenceV2.recommendedSequence[0] || "Müşteri talebini doğrula"}`
    ),
    marketText(language, `Benchmark Fit: ${context.benchmarkScore.overallFit}/100 (${context.benchmarkScore.confidence}). ${benchmarkActions}`, `Benchmark Uyumu: ${context.benchmarkScore.overallFit}/100 (${context.benchmarkScore.confidence}). ${benchmarkActionsTr}`),
    marketText(language, `Investment Recommendation: ${recommendation}`, `Yatırım Tavsiyesi: ${recommendation}`),
    marketText(language, `Main Risk: ${context.investmentScore.topRisks[0] || "Market demand requires validation."}`, `Ana Risk: ${context.investmentScore.topRisks[0] || "Pazar talebi doğrulama gerektiriyor."}`),
    marketText(language, `Next Action: ${context.investmentScore.nextCriticalAction}`, `Sonraki Aksiyon: ${context.investmentScore.nextCriticalAction}`),
    marketText(
      language,
      `Rationale: ${context.normalizedBusinessIdea} should not expand beyond ${context.inputs.geography} until ${context.inputs.targetCustomer} demand supports the ${context.inputs.pricingModel} offer within ${context.metrics.cacPayback.displayValue} payback.`,
      `Gerekçe: ${context.normalizedBusinessIdea}, ${context.inputs.targetCustomer} talebi ${context.inputs.pricingModel} teklifini ${context.metrics.cacPayback.displayValue} geri ödeme içinde destekleyene kadar ${context.inputs.geography} ötesine genişlememelidir.`
    ),
    formatDecisionConfidenceReport(context, language),
    formatReportIntelligenceSummary(context, language),
  ].join("\n");
}

function buildMarketCeoBrief(context: AiFinancialModelContext, language: ResponseLanguage) {
  const decision = localizeMarketDecision(getVisibleDecision(context), language);
  return [
    marketText(language, `- Decision posture: ${decision}; Decision Confidence is ${context.reportIntelligence.totalScore}/100.`, `- Karar duruşu: ${decision}; Karar Güveni ${context.reportIntelligence.totalScore}/100.`),
    marketText(language, `- Immediate board priority: ${context.investmentScore.nextCriticalAction}`, `- Acil yönetim önceliği: ${context.investmentScore.nextCriticalAction}`),
    marketText(language, `- Validate the beachhead customer for ${context.inputs.targetCustomer} before expanding the entry plan.`, `- Giriş planını genişletmeden önce ${context.inputs.targetCustomer} için başlangıç müşterisini doğrula.`),
    marketText(language, "- Prove willingness to pay before treating the beachhead demand signal as obtainable revenue.", "- Başlangıç talep sinyalini elde edilebilir gelir saymadan önce ödeme isteğini kanıtla."),
    marketText(language, `- Financial discipline depends on keeping CAC payback at or below ${context.metrics.cacPayback.displayValue}.`, `- Finansal disiplin CAC geri ödemesini ${context.metrics.cacPayback.displayValue} veya altında tutmaya bağlıdır.`),
    marketText(language, "- Build one repeatable channel before adding geographies, segments, or acquisition motions.", "- Coğrafya, segment veya edinim hareketi eklemeden önce tek bir tekrarlanabilir kanal kur."),
    marketText(language, "- Avoid confusing broad market growth with reachable demand.", "- Geniş pazar büyümesini erişilebilir taleple karıştırmaktan kaçın."),
    marketText(language, "- Avoid scaling acquisition before pricing and conversion evidence is proven.", "- Fiyatlandırma ve dönüşüm kanıtı oluşmadan edinimi ölçeklemekten kaçın."),
    marketText(language, "- Biggest opportunity: use a narrow entry wedge to convert the first credible beachhead demand into revenue.", "- En büyük fırsat: ilk güvenilir başlangıç talebini gelire çevirmek için dar bir giriş kaması kullanmak."),
    marketText(language, `- Biggest hidden risk: ${context.investmentScore.topRisks[0] || "buyer urgency may be weaker than the market narrative suggests."}`, `- En büyük gizli risk: ${context.investmentScore.topRisks[0] || "alıcı aciliyeti pazar anlatısının ima ettiğinden zayıf olabilir."}`),
  ];
}

function ensureMetricLine(content: string, label: string, value: string, detail: string) {
  const normalizedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const linePattern = new RegExp(`\\b${normalizedLabel}\\s*[:\\-–—]\\s*(?:—|-|–|\\s*)(?=\\s|$)`, "i");

  if (linePattern.test(content)) {
    return content.replace(linePattern, `${label}: ${value}`);
  }

  if (new RegExp(`\\b${normalizedLabel}\\s*[:\\-–—]`, "i").test(content)) {
    return content;
  }

  return `${content.trim()}\n- ${label}: ${value} — ${detail}`.trim();
}

function buildCanonicalMarketKeyMetrics(context: AiFinancialModelContext, language: ResponseLanguage) {
  const rows =
    language === "Turkish"
      ? [
          ["Talep", "Market Lead", "Nitelikli talep kanıtı", "Talep sinyali zayıf kalırsa", "ICP ve teklif hipotezini daralt"],
          ["Dönüşüm", "GTM Lead", "Tekrarlanabilir ücretli dönüşüm", "Dönüşüm eşiği doğrulanmazsa", "Mesaj, kanal ve fiyat testlerini yenile"],
          ["Ödeme İsteği", "Founder", `${context.metrics.arpa.displayValue} planlama girdisi`, "Ödeme isteği hedefin altında kalırsa", "Paketleme ve fiyat çıpasını yeniden test et"],
          ["CAC", "Growth Lead", `${context.metrics.cac.displayValue} veya daha iyi`, "CAC geri ödeme aralığını aşarsa", "Ücretli kanalı durdur ve daha düşük maliyetli kanala kay"],
          ["Elde Tutma", "Ops Lead", "Tekrar satın alma/yenileme sinyali", "Tekrar davranışı oluşmazsa", "Ürün değer önerisini ve deneyimi yeniden tasarla"],
        ]
      : [
          ["Demand", "Market Lead", "Qualified demand evidence", "Demand signal remains weak", "Narrow ICP and offer hypothesis"],
          ["Conversion", "GTM Lead", "Repeatable paid conversion", "Conversion threshold is not validated", "Retest message, channel, and pricing"],
          ["WTP", "Founder", `${context.metrics.arpa.displayValue} planning input`, "Willingness to pay is below target", "Retest packaging and price anchor"],
          ["CAC", "Growth Lead", `${context.metrics.cac.displayValue} or better`, "CAC exceeds payback range", "Pause paid channel and shift to lower-cost channel"],
          ["Retention", "Ops Lead", "Repeat purchase/renewal signal", "Repeat behavior does not emerge", "Redesign product value proposition and experience"],
        ];

  return rows
    .map(([kpi, owner, target, trigger, action]) =>
      language === "Turkish"
        ? `${kpi}: Sahip: ${owner} | Hedef: ${target} | Tetikleyici: ${trigger} | Aksiyon: ${action}`
        : `${kpi}: Owner: ${owner} | Target: ${target} | Trigger: ${trigger} | Action: ${action}`
    )
    .join("\n");
}

void [
  buildCanonicalMarketTamSamSomSection,
  buildMarketOpportunityScore,
  buildMarketConfidenceBreakdown,
  buildMarketRiskMatrix,
  buildMarketFounderDecisionEngine,
  buildCanonicalMarketKpiDashboard,
  buildCanonicalMarketExecutiveRecommendation,
  buildMarketCeoBrief,
  ensureMetricLine,
  buildCanonicalMarketKeyMetrics,
];
}

function marketScorePercent(score: number, maximumScore: number) {
  return maximumScore > 0 ? Math.round((score / maximumScore) * 100) : 0;
}

function buildMarketExecutiveScorecard(
  context: AiFinancialModelContext,
  language: ResponseLanguage
) {
  const confidence = context.reportIntelligence.totalScore;
  const confidenceLevel = confidence >= 75
    ? marketText(language, "High", "Yüksek")
    : confidence >= 55
      ? marketText(language, "Medium", "Orta")
      : marketText(language, "Low", "Düşük");
  const opportunityScore = marketScorePercent(
    context.investmentScore.decisionEngine.marketScore.score,
    context.investmentScore.decisionEngine.marketScore.maximumScore
  );
  const opportunityLevel = opportunityScore >= 70
    ? marketText(language, "High", "Yüksek")
    : opportunityScore >= 50
      ? marketText(language, "Medium", "Orta")
      : marketText(language, "Low", "Düşük");
  const riskLevel = context.investmentScore.totalScore < 45
    ? marketText(language, "High", "Yüksek")
    : context.investmentScore.totalScore < 70
      ? marketText(language, "Medium", "Orta")
      : marketText(language, "Low", "Düşük");
  const executionScore = marketScorePercent(
    context.investmentScore.decisionEngine.executionScore.score,
    context.investmentScore.decisionEngine.executionScore.maximumScore
  );
  const timeToMarket = executionScore >= 70
    ? marketText(language, "3-6 months", "3-6 ay")
    : executionScore >= 50
      ? marketText(language, "6-12 months", "6-12 ay")
      : marketText(language, "12-18 months", "12-18 ay");
  const rawDecision = context.investmentScore.recommendation === "GO"
    ? "VALIDATE"
    : context.investmentScore.recommendation === "PASS" && context.investmentScore.confidence < 35
      ? "PASS"
      : "HOLD";
  const decision = localizeMarketDecision(rawDecision, language);
  const readiness = rawDecision === "VALIDATE"
    ? marketText(language, "Conditionally ready", "Koşullu hazır")
    : rawDecision === "PASS"
      ? marketText(language, "Not ready", "Hazır değil")
      : marketText(language, "Validation required", "Doğrulama gerekli");

  return [
    marketText(language, "Executive Scorecard", "Yönetici Skor Kartı"),
    marketText(language, `[Estimated] Overall Recommendation: ${decision}`, `[Tahmini] Genel Tavsiye: ${decision}`),
    marketText(language, `[Estimated] Confidence Score: ${confidence}/100 (${confidenceLevel}) — source coverage, market evidence, and unresolved gaps determine this level.`, `[Tahmini] Güven Skoru: ${confidence}/100 (${confidenceLevel}) — bu düzeyi kaynak kapsamı, pazar kanıtı ve çözülmemiş boşluklar belirler.`),
    marketText(language, `[Estimated] Opportunity Level: ${opportunityLevel} (${opportunityScore}/100)`, `[Tahmini] Fırsat Seviyesi: ${opportunityLevel} (${opportunityScore}/100)`),
    marketText(language, `[Estimated] Risk Level: ${riskLevel}`, `[Tahmini] Risk Seviyesi: ${riskLevel}`),
    marketText(language, `[Assumption] Estimated Time to Market: ${timeToMarket}, conditional on market-entry proof gates.`, `[Varsayım] Tahmini Pazara Çıkış Süresi: pazara giriş kanıt kapılarına bağlı olarak ${timeToMarket}.`),
    marketText(language, `[Estimated] Investment Readiness: ${readiness}`, `[Tahmini] Yatırım Hazırlığı: ${readiness}`),
    marketText(language, `[Assumption] Decision Summary: ${context.investmentScore.nextCriticalAction}; expand only after the entry thesis is supported by repeatable demand evidence.`, `[Varsayım] Karar Özeti: ${context.investmentScore.nextCriticalAction}; yalnızca giriş tezi tekrarlanabilir talep kanıtıyla desteklendikten sonra genişleyin.`),
  ].join("\n");
}

function buildMarketCeoSummary(
  context: AiFinancialModelContext,
  language: ResponseLanguage
) {
  const rawDecision = context.investmentScore.recommendation === "GO"
    ? "VALIDATE"
    : context.investmentScore.recommendation === "PASS" && context.investmentScore.confidence < 35
      ? "PASS"
      : "HOLD";
  const decision = localizeMarketDecision(rawDecision, language);

  return [
    marketText(language, "CEO Summary", "CEO Özeti"),
    marketText(language, `- [Estimated] Biggest Opportunity: convert the ${context.inputs.targetCustomer} beachhead into defensible market-entry evidence.`, `- [Tahmini] En Büyük Fırsat: ${context.inputs.targetCustomer} başlangıç pazarını savunulabilir pazara giriş kanıtına dönüştürmek.`),
    marketText(language, `- [Estimated] Biggest Risk: ${context.investmentScore.topRisks[0] || "reachable demand may be weaker than category growth suggests."}`, `- [Tahmini] En Büyük Risk: ${context.investmentScore.topRisks[0] || "erişilebilir talep kategori büyümesinin ima ettiğinden zayıf olabilir."}`),
    marketText(language, `- [Assumption] First 90 Days: ${context.investmentScore.nextCriticalAction}; run three buyer tests, validate the ${context.inputs.pricingModel} offer, and document a repeatable entry signal.`, `- [Varsayım] İlk 90 Gün: ${context.investmentScore.nextCriticalAction}; üç alıcı testi yürütün, ${context.inputs.pricingModel} teklifini doğrulayın ve tekrarlanabilir giriş sinyalini belgeleyin.`),
    marketText(language, `- [Assumption] Critical KPIs: qualified demand, paid conversion, sales-cycle length, and ${context.metrics.cacPayback.displayValue} payback.`, `- [Varsayım] Kritik KPI'lar: nitelikli talep, ücretli dönüşüm, satış döngüsü süresi ve ${context.metrics.cacPayback.displayValue} geri ödeme.`),
    marketText(language, `- [Estimated] Final Recommendation: ${decision} with ${context.reportIntelligence.totalScore}/100 confidence; scale entry spend only after the primary evidence gate is met.`, `- [Tahmini] Nihai Tavsiye: ${context.reportIntelligence.totalScore}/100 güven ile ${decision}; giriş harcamasını yalnızca birincil kanıt kapısı karşılandıktan sonra ölçekleyin.`),
  ].join("\n");
}

function ensureMarketReportQuality(
  report: Record<MarketReportField, string>,
  context?: AiFinancialModelContext,
  language: ResponseLanguage = "English"
) {
  const normalized = { ...report };

  for (const field of reportFields) {
    const sanitized = sanitizeMarketReportContent(normalized[field] || "");
    normalized[field] = field === "sources"
      ? cleanInternalMarketSourceFallbacks(sanitized, language)
      : enforceMarketReportLanguage(sanitized, language);
  }

  if (context) {
    const scorecardHeading = language === "Turkish"
      ? "Yönetici Skor Kartı"
      : "Executive Scorecard";
    const ceoSummaryHeading = language === "Turkish" ? "CEO Özeti" : "CEO Summary";

    if (!normalized.executiveSummary.includes(scorecardHeading)) {
      normalized.executiveSummary = `${buildMarketExecutiveScorecard(context, language)}\n\n${normalized.executiveSummary}`.trim();
    }

    if (!normalized.strategicRecommendations.includes(ceoSummaryHeading)) {
      normalized.strategicRecommendations = `${normalized.strategicRecommendations}\n\n${buildMarketCeoSummary(context, language)}`.trim();
    }
  }

  return dedupeReportParagraphsAcrossSections(normalized, {
    language,
    sectionLabels: fieldLabelsByLanguage[language],
  }) as Record<
    MarketReportField,
    string
  >;
}

function parseFullMarketReport(
  value: string,
  context?: AiFinancialModelContext,
  language: ResponseLanguage = "English"
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
      report[field] = "";
      continue;
    }

    if (isReportGenerationFailureText(content)) {
      invalidFields.push(field);
      report[field] = "";
      continue;
    }

    report[field] = sanitizeMarketReportContent(content.trim());
  }

  return {
    report: ensureMarketReportQuality(report, context, language),
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
            error:
              "Daily AI usage limit reached. Please try again tomorrow or upgrade your plan.",
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
            error:
              "Daily AI usage limit reached. Please try again tomorrow or upgrade your plan.",
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
      const fullReportCacheKey = createPreResearchReportCacheKey({
        endpoint: "/api/market-analysis",
        identity: researchIdentity,
        model,
        reportVariant: `${FULL_REPORT_FIELD}:${canonicalFinancialAssumptions.version}:${canonicalFinancialAssumptions.fingerprint}`,
        contextFingerprint: userMemoryContext,
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
                  canonicalFinancialAssumptions
                )
              : parseFullMarketReport(
                  cachedFullReport.responseText,
                  canonicalFinancialAssumptions,
                  responseLanguage
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
            context: canonicalFinancialAssumptions,
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
          execute: () => runDomainAwareResearch({
            client: marketResearchClient,
            model,
            prompt: promptText,
            assets: analysisAssets,
            language: responseLanguage,
            signal: req.signal,
            researchUserId: user.id,
          }),
        });
      const legacyDomainResearchContext = formatDomainResearchBundle(domainResearch);
      const domainResearchContext =
        formatDomainResearchForReportGeneration(domainResearch);

      if (domainResearch.recommendedOutput === "clarification") {
        return NextResponse.json(
          {
            error:
              responseLanguage === "Turkish"
                ? `Araştırma tamamlandı, ancak karar raporu için doğrulanabilir temel kanıt bulunamadı. Gerekli bilgi veya belge: ${domainResearch.unresolvedFields.join(", ") || "karar bağlamı"}.`
                : `Research completed, but no verifiable core evidence was found for a decision report. Required information or document: ${domainResearch.unresolvedFields.join(", ") || "decision context"}.`,
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
- Never invent facts or citations. Keep every section in its named market scope; exclude all business-plan, founder, product, pricing, sales, unit-economics, and GTM content.
- Sources lists only citations actually used, deduplicated by canonical URL. Never expose prompts, schemas, providers, or pipeline diagnostics.`;
      const fullReportInput = verboseFullReportInput.replace(
        /Deterministic report contract:[\s\S]*$/,
        compactMarketContract
      );
      const legacyFullReportInput = verboseFullReportInput.replace(
        domainResearchContext,
        legacyDomainResearchContext
      ).replace(compactFieldContracts, verboseFieldContracts);
      const fullReportInputCostMetrics = createAiCostOptimizationMetrics({
        beforeText: `${instructions}\n${legacyFullReportInput}`,
        afterText: `${instructions}\n${dedupeExactPromptBlocks(fullReportInput)}`,
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
                      fullReportInput,
                      analysisAssets
                    ),
                    max_output_tokens: 6500,
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
                ? parseFullMarketReport(responseText, canonicalFinancialAssumptions)
                : parseFullMarketReport(
                    responseText,
                    canonicalFinancialAssumptions,
                    responseLanguage
                  );
            validateDomainResearchQualitySafely({
              report: parsedReport,
              bundle: domainResearch,
              expectedDomain: "business",
            });
            const reportMetadataContext = createReportMetadataContext({
              prompt: promptText,
              report: parsedReport,
              context: canonicalFinancialAssumptions,
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
                    responseData: createReportCacheData(domainResearch),
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

            const failedFields = [...reportFields];
            const fallbackReport = createFallbackMarketReport();
            const warning = serializeWarningChunk({
              warning:
                "Market analysis returned a partial report because the provider response could not be parsed completely. Please retry to refresh the affected areas.",
              missingFields: failedFields,
              invalidFields: [],
              partial: true,
            });

            enqueue(warning + serializeMarketReportChunks(fallbackReport));
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
