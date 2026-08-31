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
import { scheduleDecisionEngineV2ShadowMode } from "@/app/lib/decision-engine-v2/shadow-mode";
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
  humanizeEvidenceFieldList,
  runDomainAwareResearch,
  validateDomainResearchQuality,
  validateDomainResearchQualitySafely,
} from "@/app/lib/ai/domain-research";
import { MARKET_ONLY_FORBIDDEN_EVIDENCE_FIELDS } from "@/app/lib/ai/dynamic-research-plan";
import {
  conversationResearchIdentityMatches,
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
import { refreshInvestmentNarrativeFromResearchCoverage } from "@/app/lib/ai/investment-score";
import {
  applyMarketResearchCoverageToContext,
  formatMarketResearchCoverageForReport,
  type MarketResearchCoverage,
} from "@/app/lib/ai/market-research-coverage";
import {
  buildMarketEntryRecommendation,
  buildMarketExecutiveDecisionBrief,
  buildMarketFinalVerdictParagraph,
  buildPreGenerationVerdictContext,
  assessMarketEntryConfidence,
  localizeMarketEntryDecision,
  type DecisionCriticalEvidenceState,
} from "@/app/lib/report-engine/market-intelligence-presentation";
import { assertNoDecisionContradiction } from "@/app/lib/report-engine/decision-contradiction-gate";
import { assertReportIsolation } from "@/app/lib/report-engine/report-isolation-validator";
import {
  assertNoOrphanEvidenceReferences,
  assertNoDuplicateCitationSources,
  assertCitationsResolveInBibliography,
  neutralizeUnverifiableEvidenceReferences,
  sanitizeCitationBracketSyntax,
} from "@/app/lib/report-engine/evidence-reference-integrity";
import {
  buildMarketIntelligenceCanonicalState,
  type MarketIntelligenceCanonicalState,
  type MarketIntelligenceCanonicalStateStatus,
} from "@/app/lib/report-engine/market-intelligence-canonical-state";
import {
  assertStrategicRecommendationsNumbering,
  findStrategicRecommendationsStructureIssues,
} from "@/app/lib/report-engine/strategic-recommendations-integrity";
import { flattenMarkdownTables } from "@/app/lib/report-engine/markdown-table-flattening";
import { formatExecutiveDecisionBrief } from "@/app/lib/report-engine/executive-decision-brief";
import {
  extractMarketSizingLayerValue,
  parseMarketSizingMagnitude,
} from "@/app/lib/report-presentation";
import { buildEvidenceSummary } from "@/app/lib/report-engine/evidence-summary";
import { stripFillerAndDuplicateSentences } from "@/app/lib/report-engine/filler-detection";
import {
  assertExecutiveQualityGate,
  runExecutiveQualityGate,
} from "@/app/lib/report-engine/executive-quality-gate";
import { enforceInlineRawUrlLimit, buildSourceLookupByUrl } from "@/app/lib/report-engine/inline-source-url-limit";
import {
  buildMarketIntelligenceBibliography,
  buildMarketIntelligenceGraph,
  extractMarketAmount,
  formatMarketIntelligenceGraphForModel,
  projectMarketIntelligenceGraphToReport,
  sanitizeMarketProseCompetitorClaims,
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
import { stripInternalImplementationTokens } from "@/app/lib/report-output-sanitization";
import {
  applyUserMemoryOperations,
  buildUserMemoryContext,
  extractExplicitMemoryOperations,
  loadUserMemoriesForUser,
} from "@/app/lib/ai/user-memory";
import { dedupeReportParagraphsAcrossSections } from "@/app/lib/report-content-quality.mjs";
import {
  runConsistencyValidationPass,
  type MetricConsistencyTarget,
} from "@/app/lib/report-consistency-validation";
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

// P0 PRODUCTION FIX -- confirmed live (Market Intelligence generation
// timeout incident): executeMarketAnalysisRequest below is only ever
// invoked in-process, via a dynamic import + direct function call from
// app/lib/report-jobs/plan-executor.ts (itself called in-process from
// app/lib/report-jobs/worker.ts), so it always runs under whichever
// maxDuration the CALLING route already declared (300s on every current
// trigger path) -- this export has no effect on that path. It exists
// purely as a defensive backstop: this file also exports its own POST
// handler, making it independently addressable as a Next.js route; if
// anything were ever to call it directly over HTTP, it would otherwise
// silently fall back to a much shorter platform default even though its
// own internal timeout budget below is sized for ~300s.
export const maxDuration = 300;

const reportFields = marketReportFields;
const fieldPrompts = marketPrompts;
const fieldLabelsByLanguage = marketFieldLabels;
const legacySectionToField = legacyMarketSectionToField;
const FULL_REPORT_FIELD = "fullReport";
const MARKET_EVIDENCE_QUALITY_VERSION = "market_evidence_graph_v7";
const MAX_AI_CALLS_PER_MARKET_REPORT = 1;
// P0 PRODUCTION FIX -- confirmed live: this timeout, the research
// phase's own outer cap (domain-research.ts's hardTimeoutMs), and the
// optional entity-extraction step summed to ~312-327s in the NON-
// pathological case -- already exceeding the 300s Vercel maxDuration
// shared by every trigger path for Market Intelligence generation.
// Reduced with margin so the sum comfortably fits; this only shortens
// how long a genuinely slow/stuck synthesis call is waited on before
// failing cleanly (caught by app/lib/report-jobs/worker.ts's own
// top-level deadline and existing retry/failure handling) -- it does
// not change max_output_tokens, the model, the schema, or any evidence-
// integrity requirement the generation itself must satisfy.
const FULL_REPORT_OPENAI_TIMEOUT_MS = 150_000;
const FULL_REPORT_POST_PROCESS_TIMEOUT_MS = 12_000;
// P0 PRODUCTION FIX -- confirmed live: the single-field regeneration
// branch's OpenAI call (reportField !== "fullReport", an individual-
// field refresh, distinct from the primary full-report generation
// above) previously had NO independent deadline at all -- only
// `{ signal: req.signal }`, i.e. whatever the incoming HTTP request's
// own abort behavior happens to be. If the client never disconnects,
// this could run for however long the OpenAI SDK's own default timeout
// allows (10 minutes, unmodified in createOpenAiClient), an indefinite-
// hang risk independent of the full-report timeout work above. A single
// field is a small fraction of a full 18-field report, so a much
// shorter bound is appropriate.
const SINGLE_FIELD_OPENAI_TIMEOUT_MS = 60_000;
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

// Business Idea Validation's financial-model acronyms (ARR, MRR, CAC, LTV)
// have no place in Market Intelligence even when the model is citing a real,
// evidence-backed fact about a market player's own reported scale (e.g. "the
// vendor reported strong ARR growth") -- report-isolation-validator.ts
// correctly rejects the whole report the moment any of these acronyms
// appears anywhere in a Market Intelligence field. Rather than relaxing that
// gate, the underlying concept is rewritten into plain market-research
// language *before* the gate ever runs, so the acronym never reaches it:
// the fact survives, the founder/investment-scoring vocabulary does not.
// Order matters only in that these run first, before the generic label
// rewrites below.
const marketReportFinancialAcronymReplacements: Array<[RegExp, string]> = [
  [/\bARR\b/gi, "annual revenue"],
  [/\bMRR\b/gi, "monthly revenue"],
  [/\bCAC\b/gi, "customer acquisition cost"],
  [/\bLTV\b/gi, "customer lifetime value"],
];

// Same rationale and mechanism as the financial acronyms above: confirmed
// live (4 of 5 real report generations in one QA pass), the model writes
// "Product-Market Fit"/"PMF" -- Business Idea Validation's own vocabulary
// for whether a hypothetical founder's product has real demand -- inside
// a Market Intelligence executive summary discussing a market's general
// demand/adoption evidence. report-isolation-validator.ts's exact
// detection pattern (/\bpmf\b|\bproduct[\s-]market\s+fit\b/i) then
// correctly aborts the entire report. The underlying fact (is there real,
// evidence-backed demand for this category) is legitimate market-research
// content; only the founder/investment-scoring label is forbidden, so it
// is rewritten to plain market-research language before the gate runs,
// exactly like the acronyms above -- "market fit" does not match the
// isolation pattern (no "product" token precedes it).
const marketReportProductMarketFitReplacement: [RegExp, string] = [
  /\bpmf\b|\bproduct[\s-]market\s+fit\b/gi,
  "market fit",
];

const marketReportTermReplacements: Array<[RegExp, string]> = [
  ...marketReportFinancialAcronymReplacements,
  marketReportProductMarketFitReplacement,
  [/\bLow[\s-]+Confidence\b/gi, "Directional"],
  [/\bMedium[\s-]+Confidence\b/gi, "Developing"],
  [/\bHigh[\s-]+Confidence\b/gi, "Verified"],
  [/\bEarly evidence\b/gi, "Directional"],
  [/\bDeveloping evidence\b/gi, "Developing"],
  [/\bStrong evidence\b/gi, "Verified"],
  [/\bSector view\b/gi, "Market view"],
  [/\bIndustry[\s-]+Estimate\b/gi, "Market view"],
  // P0 FIX #8 -- confirmed live (internal/debug token leakage repair):
  // these two rows previously matched "Assumption"/"AI Assumption"
  // ANYWHERE in the text -- including ordinary prose use of the word
  // ("...holds only if this assumption about adoption remains true")
  // -- rewriting it into "Planning inputs" mid-sentence and producing
  // ungrammatical, jarring output. The relabeling is only meaningful
  // when the word is acting as a LABEL: the bracketed evidence tag
  // report-quality-directives.ts instructs the model to emit
  // ("[Assumption] Serviceable share is 25%...") or a section/line
  // header ("Assumptions:", "Critical Assumptions:"). The lookahead
  // scopes the match to that label position only; the same word inside
  // a sentence is left untouched.
  [/\[\s*AI[\s-]+Assumptions?\s*\]/gi, "[Planning inputs]"],
  [/\[\s*Assumptions?\s*\]/gi, "[Planning inputs]"],
  [/\bAI[\s-]+Assumptions?\b(?=\s*\**\s*:)/gi, "Planning inputs"],
  // TASK #27E -- confirmed live (real persisted report, id
  // 4c0b5786-357c-4927-b7ff-3d38664b6495 and every regenerated sibling):
  // this row had the exact same defect P0 FIX #8 above already fixed for
  // "Assumption" -- it matched the ordinary English word "benchmark"/
  // "benchmarks" ANYWHERE in the text, not just as a label, rewriting
  // real prose like "independent accuracy benchmark report" into
  // "independent accuracy Market references report" (then relabeled
  // again by normalizePdfText's own "Market references" -> "Market
  // sources" rule into the final, grammatically corrupted "independent
  // accuracy Market sources report"). Unlike "Assumption", this word has
  // no bracketed-tag or line-heading use in this pipeline at all --
  // report-quality-directives.ts only ever instructs the model to emit
  // [Verified]/[Estimated]/[Assumption] as evidence tags, never
  // "Benchmark" -- so there is no label position left to scope this rule
  // to. The rule is removed entirely rather than narrowed.
  [/\bAssumptions?\b(?=\s*\**\s*:)/gi, "Planning inputs"],
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

// P0 FIX #8 (hardening pass) -- confirmed live: stripInternalImplementationTokens
// (report-output-sanitization.ts) is the ONE shared, schema-independent
// generic sanitizer for internal identifier leaks (sizingGap-class
// tokens) that this function and chat/route.ts's final response
// sanitization both call -- see that function's own comment for the
// full shape-plus-heuristic rationale. Running it here, on the initial
// sanitizeAiResponseText(value) accumulator before the market-report-
// specific term replacements below, means it applies uniformly
// regardless of which downstream replacement rules a given report
// happens to trigger.
function sanitizeMarketReportContent(value: string) {
  const sanitized = marketReportTermReplacements.reduce(
    (content, [pattern, replacement]) => content.replace(pattern, replacement),
    stripInternalImplementationTokens(sanitizeAiResponseText(value))
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

// TASK #23 -- Market Intelligence never previously emitted a
// `reportMetadata` stream chunk at all (unlike Business Plan's own
// serializePlanReportMetadataChunk in plan-executor.ts), so
// worker.ts's readExecutionResponse (which only sets `report.metadata`
// when it sees this exact key) never had anything to persist for this
// report type -- confirmed the root cause of reports.metadata carrying
// zero Market-Intelligence-specific structured data.
//
// TASK #23 (follow-up) -- always emits now, even when canonicalState is
// null: `canonicalStateStatus` records explicitly WHY (generation had no
// graph/evidence to snapshot -- "unavailable_no_graph") rather than
// leaving that report indistinguishable from one persisted before this
// mechanism ever existed (which carries neither field at all). The
// canonical state object itself is still only ever included when real --
// never a fabricated or partially-populated one for the unavailable case.
function serializeMarketReportMetadataChunk(
  canonicalState: MarketIntelligenceCanonicalState | null,
  canonicalStateStatus: MarketIntelligenceCanonicalStateStatus
) {
  return serializeReportStreamChunk({
    reportMetadata: {
      ...(canonicalState ? { marketIntelligenceCanonicalState: canonicalState } : {}),
      marketIntelligenceCanonicalStateStatus: canonicalStateStatus,
    },
  });
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

  // Raw programmer-artifact placeholders (a stringified object, a stray
  // build marker) can never be a legitimate report sentence in any
  // language, unlike "Unknown"/"Not available"/"N/A" -- those are
  // ordinary words that appear correctly inside many well-formed
  // sentences, so they are deliberately left alone here to avoid mangling
  // real prose. This runs for every field (enforceMarketReportLanguage
  // calls this function first), not just Sources.
  // P0 FIX -- confirmed live (source/evidence integrity repair): the
  // English replacement says "Not confirmed", never "Not verified" -- this
  // runs on every field, so the substituted text can end up anywhere in
  // the report, including page.tsx's report-wide `fullContent` blob. The
  // Decision Signal/Decision Confidence KPI cards scan that blob for the
  // bare word "verified" as their sole positive-evidence signal, which
  // does not distinguish "verified" from "NOT verified" -- see
  // insufficientEvidenceFallbackTemplates' own comment for the full
  // mechanism.
  const notVerifiedReplacement = marketText(
    language,
    "Not confirmed",
    "Doğrulanmadı",
    "Nicht verifiziert",
    "Non vérifié",
    "No verificado"
  );

  return normalizeReportSourceSection(content
    .replace(/\bsources(?:\.[a-z0-9_-]+)+\b/gi, cleanReplacement)
    .replace(/\bdeduplicated\.none\.provided\.by\.user\b/gi, cleanReplacement)
    .replace(/\bnone\.provided\.by\.user\b/gi, cleanReplacement)
    .replace(/\[object Object\]/gi, notVerifiedReplacement)
    .replace(/\bundefined\b/gi, notVerifiedReplacement)
    // Bare "null" is deliberately not replaced here -- "null hypothesis"
    // is a legitimate term that can appear in academic/statistical
    // evidence text, and a blind \bnull\b match would corrupt it.
    .replace(/\bTBD\b/g, notVerifiedReplacement)
    .replace(/\bTODO\b/g, notVerifiedReplacement)
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
      // Porter's Five Forces and other stray English label/prose fragments
      // that survive even in an otherwise-Turkish section, because the
      // model's own instructions name them in English (e.g. the CAGR and
      // TAM/SAM/SOM prompts describe an adjacent-benchmark figure as a
      // "stand-in" and a "Planning Estimate") -- fixed upstream in the
      // prompt wording where practical, and backstopped here so a report
      // can never actually ship the English fragment regardless of what
      // the model does with that wording.
      .replace(/\bThreat of Entry\b/gi, "Giriş Tehdidi")
      .replace(/\bThreat of Substitutes\b/gi, "İkame Tehdidi")
      .replace(/\bBuyer [Pp]ower\b/g, "Alıcı Gücü")
      .replace(/\bSupplier [Pp]ower\b/g, "Tedarikçi Gücü")
      .replace(/\bRivalry\b/gi, "Rekabet Yoğunluğu")
      .replace(/\bSubstitutes\b/gi, "İkameler")
      .replace(/\bPlanning Estimate\b/g, "Planlama Tahmini")
      .replace(/\bbuyer context\b/gi, "alıcı bağlamı")
      .replace(/\breasonable stand-in\b/gi, "makul bir karşılaştırma referansı")
      .replace(/\bstand-in\b/gi, "karşılaştırma referansı")
      .replace(/\bMarket sources\b/g, "Pazar kaynakları")
      // The market-safe rewrites of Business Idea Validation's forbidden
      // financial acronyms (marketReportFinancialAcronymReplacements
      // above) intentionally land in English first, since that rewrite
      // has to run before the isolation validator regardless of report
      // language -- these translate that English phrase onward for a
      // Turkish report, the same way every other stray English fragment
      // above is backstopped.
      .replace(/\bcustomer acquisition cost\b/gi, "müşteri edinme maliyeti")
      .replace(/\bcustomer lifetime value\b/gi, "müşteri yaşam boyu değeri")
      .replace(/\bmonthly revenue\b/gi, "aylık gelir")
      .replace(/\bannual revenue\b/gi, "yıllık gelir")
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
      .replace(/\bEvidence\b/g, "Kanıt")
      .replace(/\bevidence\b/g, "kanıt")
      // Additional stray English fragments confirmed live in otherwise-
      // Turkish reports -- same backstop philosophy as the block above:
      // fixed upstream in prompt wording where practical, and never
      // trusted to actually disappear from the model's own output.
      .replace(/\bsupported estimate\b/gi, "desteklenen tahmin")
      .replace(/\brequested market\b/gi, "talep edilen pazar")
      .replace(/\bconfidence level\b/gi, "güven seviyesi")
      .replace(/\bexecutive recommendation\b/gi, "yönetici tavsiyesi")
      .replace(/\bmarket opportunity\b/gi, "pazar fırsatı")
      .replace(/\bhowever\b/gi, "ancak")
      .replace(/\bnot established\b/gi, "bağımsız olarak doğrulanmamış")
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
    .replace(/\bdesteklenen tahmin\b/gi, "supported estimate")
    .replace(/\btalep edilen pazar\b/gi, "requested market")
    .replace(/\bgüven seviyesi\b/gi, "confidence level")
    .replace(/\byönetici tavsiyesi\b/gi, "executive recommendation")
    .replace(/\bpazar fırsatı\b/gi, "market opportunity")
    .replace(/\bbağımsız olarak doğrulanmamış\b/gi, "not established")
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

// CRITICAL FIX -- remove research infrastructure sections from the
// customer-facing report. marketInfrastructure lists government/
// regulator/standards-body entities discovered during research --
// useful internally, but appending it into the customer's own Market
// Overview section under a "Market Infrastructure" heading read as
// leaked research scaffolding, not market analysis. The underlying
// graph.vendorIntelligence.marketInfrastructure data and its
// confidence/discovery role are computed exactly as before (this
// module's own analysis logic is untouched) -- this only stops that
// already-computed content from being appended to a customer-visible
// field. marketInfrastructure is destructured out and discarded rather
// than spread onto the report, since it is not itself a MarketReportField.
// Free-text fields that can plausibly name a competitor with rivalry
// framing, run through sanitizeMarketProseCompetitorClaims (market-
// intelligence-graph.ts) so a company already classified by the graph as
// adjacent-only (or not evidenced at all) can never be asserted as a
// validated direct competitor here, even though these fields are
// otherwise raw, un-gated model prose (unlike competitiveLandscape/
// majorPlayers above, which the graph replaces outright). Deliberately
// excludes fields the graph already fully owns (marketSize, tamSamSom,
// cagr, competitiveLandscape, majorPlayers, sources) -- sanitizing
// already-canonical text would be redundant.
const competitorClaimSensitiveFields: MarketReportField[] = [
  "marketDrivers",
  "barriers",
  "opportunities",
  "threats",
  "portersFiveForces",
  "strategicRecommendations",
];

// P0 FIX -- confirmed live (executive decision integrity repair): the ONE
// place this report's decision-critical evidence pillars are derived from
// the same canonical, evidence-first graph fields P0 FIX #1 and #3 already
// established as authoritative for what the report actually SHOWS a
// reader -- graph.planningEstimate/graph.verifiedMarketSize for market
// sizing (mirrors TAM/SAM/SOM's own resolution logic), graph.vendorIntelligence.
// vendors/adjacentPlayers for competitive evidence (mirrors Competitive
// Landscape's own existence-tier logic). Used at both call sites of
// assessMarketEntryConfidence/buildMarketExecutiveDecisionBrief below (the
// pre-generation verdict shown to the model, and the final post-generation
// banner) so the model is never told a stronger verdict than the final
// report will actually display, and the two can never contradict each
// other. Never derived from `coverage` -- see assessMarketEntryConfidence's
// own comment for why that generic, floor-padded signal is exactly what
// let a false ENTER through in the reported production defect.
// P0 PRODUCTION FIX -- confirmed live (Task #11, decision-vs-evidence
// consistency repair): marketSizingResolved (unchanged below) only ever
// asked "does a trustworthy TOTAL market-size figure exist" -- it never
// inspected the planning estimate's own samMethod/somStatus, so a report
// whose SOM/obtainable-share chain was explicitly left unresolved still
// read as fully sizing-resolved, letting a strong ENTER through right
// next to the report's own "Confidence: Validation Required" statement --
// the exact reported production defect. obtainableShareResolved (see its
// own type-level comment in market-intelligence-presentation.ts) is
// trivially true when no planning-estimate chain was attempted at all --
// only a genuine "we tried to compute SOM and it did not clear the bar"
// state counts as a gap.
//
// P0 PRODUCTION FIX (Task #21, TAM/SAM/SOM decision-integrity audit):
// this used to accept `samMethod !== "blocked"` -- treating
// "evidenceDerived" (a real segment/geography narrowing percentage) and
// "defaultAssumption" (buildPlanningEstimate's own disclosed, un-evidenced
// 25% default -- see its "SAM = TAM × 25% disclosed default
// serviceable-share assumption" comment) as equally resolved, as long as
// SOM's own obtainable-share percentage happened to be evidence-backed.
// That let a report whose SAM was NEVER independently verified (just a
// blind 25% guess) still read as fully sizing-resolved and clear a strong
// ENTER/AVOID decision -- SOM = SAM × (real win-rate%) is only as
// trustworthy as the SAM it was multiplied against, and an assumed SAM
// must not be silently absorbed into an otherwise-evidenced SOM chain.
// Now requires samMethod to be the genuine "evidenceDerived" state, not
// merely "not blocked" -- a defaultAssumption SAM is exactly the kind of
// unsupported sizing assumption this pillar exists to catch.
function resolveDecisionCriticalEvidenceState(
  graph: MarketIntelligenceGraph
): DecisionCriticalEvidenceState {
  return {
    marketSizingResolved:
      graph.planningEstimate !== null || graph.verifiedMarketSize.length > 0,
    competitiveEvidenceResolved:
      graph.vendorIntelligence.vendors.length > 0 ||
      graph.vendorIntelligence.adjacentPlayers.length > 0,
    obtainableShareResolved:
      graph.planningEstimate === null ||
      (graph.planningEstimate.samMethod === "evidenceDerived" &&
        graph.planningEstimate.somStatus === "calculated"),
  };
}

// P0 FIX #6 -- confirmed live (canonical cross-section consistency repair):
// Market Intelligence never wired runConsistencyValidationPass's
// metricTargets (unlike Business Plan's buildPlanFinancialConsistencyTargets,
// plan-executor.ts) -- a stale comment at this function's own call site
// below explained this as "no financial model of a hypothetical company to
// check numbers against," which is true for CAC/LTV/ARR but was never true
// for Market Size/TAM/SAM/SOM/CAGR themselves: graph.planningEstimate/
// graph.verifiedMarketSize/graph.cagr (P0 FIX #1/#2's own canonical fields)
// ARE a real, already-computed source of truth, just never cross-checked
// against every OTHER section's own free-text mentions of the same figures
// (marketOverview, industryTrends, customerSegments, strategicRecommendations,
// etc. can each independently restate "the $X market" or "a CAGR of Y%" in
// their own prose, with no mechanism preventing that restatement from
// silently drifting from the canonical number). Builds the SAME
// MetricConsistencyTarget shape Business Plan already uses, sourced only
// from values that are themselves unambiguous, already-resolved numbers --
// never a placeholder/gap sentence (see the SAM/SOM guards below), so a
// genuinely unresolved layer is never forced into becoming a false
// "canonical" value elsewhere; it stays missing, exactly as P0 FIX #1
// requires.
function buildMarketGraphMetricConsistencyTargets(
  graph: MarketIntelligenceGraph,
  cagrFieldText: string
): MetricConsistencyTarget[] {
  const targets: MetricConsistencyTarget[] = [];

  // Market Size / TAM: the same authoritative figure whenever one exists,
  // whether it came from a fully verified observation (graph.verifiedMarketSize,
  // whose free-text description is parsed back into a clean short token
  // via extractMarketAmount, e.g. "$2.1 billion") or a Planning Estimate
  // (graph.planningEstimate.tam, already a clean pre-formatted range) --
  // projectMarketIntelligenceGraphToReport derives marketSize FROM this
  // exact same value, so this is the single source both fields must agree
  // with, never a second, independently-parsed number.
  const verifiedMarketSizeToken =
    graph.verifiedMarketSize.length > 0
      ? extractMarketAmount(graph.verifiedMarketSize[0].description)?.token || null
      : null;
  const marketSizeCanonical = verifiedMarketSizeToken || graph.planningEstimate?.tam || null;
  if (marketSizeCanonical) {
    targets.push({ labelPattern: "Market Size", canonicalDisplayValue: marketSizeCanonical, type: "market_size_mismatch" });
    targets.push({ labelPattern: "TAM", canonicalDisplayValue: marketSizeCanonical, type: "market_size_mismatch" });
  }

  // SAM/SOM: only enforced when buildPlanningEstimate itself resolved a
  // real numeric range for that layer (samMethod !== "blocked" /
  // somStatus === "calculated") -- otherwise estimate.sam/estimate.som is
  // itself a gap-explanation SENTENCE ("not derived -- TAM confidence did
  // not clear the threshold..."), never a value fit to overwrite another
  // section's own numeric mention with. An unresolved layer must remain
  // missing, never get promoted into a fabricated "canonical" figure.
  if (graph.planningEstimate && graph.planningEstimate.samMethod !== "blocked") {
    targets.push({ labelPattern: "SAM", canonicalDisplayValue: graph.planningEstimate.sam, type: "market_size_mismatch" });
  }
  if (graph.planningEstimate && graph.planningEstimate.somStatus === "calculated") {
    targets.push({ labelPattern: "SOM", canonicalDisplayValue: graph.planningEstimate.som, type: "market_size_mismatch" });
  }

  // CAGR: mirrors extractHeadlineCagrValue's own regex (page.tsx,
  // ReportPdfButton.tsx -- byte-identical between those two, see P0 FIX
  // #2's own parity test) against the SAME already-normalized `cagr` field
  // text those cards read, so the canonical figure other sections get
  // corrected against is the exact number the KPI card will display, not a
  // separately-derived one.
  const cagrMatch = (cagrFieldText || "").match(
    /\d+(?:[.,]\d+)?(?:\s*[-–—]\s*\d+(?:[.,]\d+)?)?\s*%/
  );
  if (cagrMatch) {
    targets.push({ labelPattern: "CAGR", canonicalDisplayValue: cagrMatch[0], type: "growth_rate_mismatch" });
  }

  return targets;
}

// P0 PRODUCTION FIX -- confirmed live (Market Intelligence production
// consistency hardening): a real production report showed a verified
// $131.6B Market Size figure with TAM immediately below it reading
// "Validation Needed" -- the model's own tamSamSom prompt already
// instructs it to build TAM from exactly this kind of verified figure
// when the scope matches, but nothing enforced that deterministically,
// so a report could show a validated total sitting right next to an
// unresolved TAM with no code-level guarantee the two would ever be
// reconciled. This closes that gap WITHOUT touching the validation rule
// itself: eligible only when (1) a verified market-size figure exists,
// (2) its own evidence does not conflict with the requested geography
// (graph.verifiedMarketSizeGeographyConflict, computed once at
// graph-build time from the exact same evidenceConflictsWithRequestedGeography
// rule buildPlanningEstimate already relies on for its own evidence
// admission), and (3) the model's own tamSamSom text has no already-
// resolvable TAM value of its own -- checked via the SAME canonical
// extractMarketSizingLayerValue/parseMarketSizingMagnitude the web
// report and PDF already use to decide whether TAM is "resolved," so
// this can never disagree with what either surface would determine.
// A genuinely resolved TAM the model already derived is NEVER
// overwritten. SAM and SOM are NEVER derived, invented, or estimated
// from this figure -- only TAM, and only as a clearly labeled,
// evidence-sourced addition ahead of the model's own (untouched)
// SAM/SOM discussion.
function propagateVerifiedMarketSizeIntoTam(
  tamSamSomText: string,
  graph: MarketIntelligenceGraph,
  language: ResponseLanguage
): string {
  if (!tamSamSomText || graph.verifiedMarketSize.length === 0) {
    return tamSamSomText;
  }
  if (graph.verifiedMarketSizeGeographyConflict) {
    return tamSamSomText;
  }

  const existingTam = extractMarketSizingLayerValue(tamSamSomText, "TAM");
  if (parseMarketSizingMagnitude(existingTam) !== null) {
    return tamSamSomText;
  }

  const anchor = graph.verifiedMarketSize[0];
  const amount = extractMarketAmount(anchor.description);
  if (!amount) {
    return tamSamSomText;
  }

  const tamLabels: Record<ResponseLanguage, { tam: string; evidence: string }> = {
    English: { tam: "TAM [Evidence-Supported — from Verified Market Size]", evidence: "Evidence" },
    Turkish: { tam: "TAM [Kanıt Destekli — Doğrulanmış Pazar Büyüklüğünden]", evidence: "Kanıt" },
    German: { tam: "TAM [Evidenzgestützt — aus verifizierter Marktgröße]", evidence: "Nachweis" },
    French: { tam: "TAM [Étayé par des preuves — à partir de la taille de marché vérifiée]", evidence: "Preuve" },
    Spanish: { tam: "TAM [Respaldado por evidencia — a partir del tamaño de mercado verificado]", evidence: "Evidencia" },
  };
  const labels = tamLabels[language] || tamLabels.English;
  const tamLine = `${labels.tam}: ${amount.token} | ${labels.evidence}: ${anchor.evidenceIds.map((id) => `[${id}]`).join(", ")}`;

  // The model's own TAM line already established as unresolved above
  // (extractMarketSizingLayerValue found it, but it carried no
  // parseable magnitude) is removed rather than left sitting directly
  // below the new evidence-supported line -- "TAM: $131.6 billion"
  // immediately followed by "TAM: Validation Needed" would itself be
  // exactly the internally-contradictory presentation this fix exists
  // to remove. Only the single line beginning with the TAM label is
  // dropped; SAM, SOM, and every other line the model wrote (method,
  // formula, assumptions) survive completely untouched.
  const withoutUnresolvedTamLine = tamSamSomText
    .split("\n")
    .filter((line) => !/^\s*(?:[-*•]\s*)?TAM\s*(?:\[[^\]]*\]\s*)?[:\-–—]/i.test(line))
    .join("\n");

  return `${tamLine}\n${withoutUnresolvedTamLine}`;
}

function applySharedMarketGraph(
  report: Record<MarketReportField, string>,
  graph: MarketIntelligenceGraph,
  language: ResponseLanguage
) {
  const projection = projectMarketIntelligenceGraphToReport(graph, language);
  const { marketInfrastructure: _marketInfrastructure, ...reportFieldsFromGraph } = projection;
  const merged = {
    ...report,
    ...reportFieldsFromGraph,
  };

  // Runs AFTER the graph-owned fields above are spliced in, and BEFORE
  // buildMarketExecutiveDecisionBrief (ensureMarketReportQuality, below)
  // reads opportunities/threats to build the deterministic Executive
  // Decision banner and final verdict -- so a downgraded competitor claim
  // here also protects that entire downstream executive-decision chain
  // (and, via the earlier consistency fix, ExecutiveSnapshotPanel's Main
  // Risk/Next Action tiles and Executive Highlights) without needing its
  // own separate sanitization pass.
  for (const field of competitorClaimSensitiveFields) {
    if (merged[field]) {
      merged[field] = sanitizeMarketProseCompetitorClaims(merged[field], graph, language);
    }
  }

  if (merged.tamSamSom) {
    merged.tamSamSom = propagateVerifiedMarketSizeIntoTam(merged.tamSamSom, graph, language);
  }

  return merged;
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

// Used only when the executive quality gate (below) flags one specific
// section as too thin/filler-heavy to add decision value -- which is
// exactly the shape an honest "this evidence type was unavailable"
// explanation naturally takes (short, and structurally similar across
// sections). Previously that gate treated any such section as a reason to
// abort the *entire* report; this fallback is what lets that one section
// degrade to a clearly labeled, honest gap instead, while every
// independently evidenced section keeps rendering. Never fabricates a
// number or a source -- it only names, from evidence already gathered,
// which category of evidence this section specifically depends on and
// did not have.
const insufficientEvidenceFallbackTemplates: Record<
  ResponseLanguage,
  (label: string, reason: string) => string
> = {
  // P0 FIX -- confirmed live (source/evidence integrity repair): this
  // fallback text is inserted directly into `fullContent`/`executiveSummary`
  // whenever ANY section degrades, and page.tsx's Decision Signal/Decision
  // Confidence KPI cards (getDashboardMetricEvidence -> inferEvidenceLevel)
  // scan that entire blob for the bare word "verified" as their sole
  // positive-evidence signal. The literal word "verified" -- meant here to
  // say evidence was INSUFFICIENT -- was being read as proof the displayed
  // decision/confidence value itself was confirmed, producing "Data
  // Confirmed" on the one card that should least be able to claim it: a
  // report that just admitted a section could not be completed to
  // standard. "confirmed" carries the identical meaning without colliding
  // with inferEvidenceLevel's keyword scan.
  English: (label, reason) =>
    `${label}: Insufficient confirmed evidence. ${reason} The rest of this report remains based on independently confirmed evidence -- this section alone could not be completed to that standard and should not be treated as a market finding.`,
  Turkish: (label, reason) =>
    `${label}: Yeterli doğrulanmış kanıt bulunamadı. ${reason} Raporun geri kalanı bağımsız olarak doğrulanmış kanıtlara dayanmaya devam ediyor; yalnızca bu bölüm aynı standartta tamamlanamadı ve bir pazar bulgusu olarak değerlendirilmemelidir.`,
  German: (label, reason) =>
    `${label}: Unzureichende validierte Evidenz. ${reason} Der Rest dieses Berichts basiert weiterhin auf unabhängig validierter Evidenz -- nur dieser Abschnitt konnte nicht auf demselben Niveau fertiggestellt werden und sollte nicht als Marktbefund gewertet werden.`,
  French: (label, reason) =>
    `${label} : preuves validées insuffisantes. ${reason} Le reste de ce rapport continue de reposer sur des preuves validées de manière indépendante -- seule cette section n'a pas pu être complétée selon cette norme et ne doit pas être considérée comme un constat de marché.`,
  Spanish: (label, reason) =>
    `${label}: evidencia validada insuficiente. ${reason} El resto de este informe sigue basándose en evidencia validada de forma independiente -- solo esta sección no pudo completarse con ese estándar y no debe considerarse un hallazgo de mercado.`,
};

// P0 FIX -- confirmed live (source/evidence integrity repair): says
// "confirmed", never "verified" -- this reason string is spliced directly
// into report content (via insufficientEvidenceFallbackTemplates above),
// which page.tsx's Decision Signal/Decision Confidence KPI cards scan
// (via fullContent) for the bare word "verified" as their sole
// positive-evidence signal. See insufficientEvidenceFallbackTemplates'
// own comment for the full mechanism.
const missingMarketSizeBenchmarkReason: Record<ResponseLanguage, string> = {
  English:
    "No confirmed local market-size figure and no adjacent regional or global benchmark data were found in this run.",
  Turkish:
    "Bu çalıştırmada ne doğrulanmış bir yerel pazar büyüklüğü rakamı ne de bölgesel veya küresel bir referans veri bulunabildi.",
  German:
    "In diesem Durchlauf wurde weder eine verifizierte lokale Marktgrößenangabe noch ein regionaler oder globaler Vergleichswert gefunden.",
  French:
    "Aucun chiffre de taille de marché local vérifié ni aucune donnée de référence régionale ou mondiale n'a été trouvé lors de cette exécution.",
  Spanish:
    "En esta ejecución no se encontró ninguna cifra de tamaño de mercado local verificada ni datos de referencia regionales o globales.",
};

const missingCompetitorEvidenceReason: Record<ResponseLanguage, string> = {
  English:
    "Independent, publicly available evidence naming and describing commercial competitors in this market was insufficient in this run.",
  Turkish:
    "Bu pazardaki ticari rakipleri bağımsız ve kamuya açık kaynaklarla adlandıran ve tanımlayan kanıtlar bu çalıştırmada yetersiz kaldı.",
  German:
    "Unabhängige, öffentlich verfügbare Belege, die kommerzielle Wettbewerber in diesem Markt benennen und beschreiben, waren in diesem Durchlauf unzureichend.",
  French:
    "Les preuves indépendantes et accessibles au public nommant et décrivant des concurrents commerciaux sur ce marché étaient insuffisantes lors de cette exécution.",
  Spanish:
    "La evidencia independiente y disponible públicamente que nombra y describe a los competidores comerciales en este mercado fue insuficiente en esta ejecución.",
};

const generalInsufficientEvidenceReason: Record<ResponseLanguage, string> = {
  English: "Independent, publicly available evidence for this specific section was insufficient in this run.",
  Turkish: "Bu bölüme özgü bağımsız ve kamuya açık kanıtlar bu çalıştırmada yetersiz kaldı.",
  German: "Unabhängige, öffentlich verfügbare Belege für diesen spezifischen Abschnitt waren in diesem Durchlauf unzureichend.",
  French: "Les preuves indépendantes et accessibles au public pour cette section spécifique étaient insuffisantes lors de cette exécution.",
  Spanish: "La evidencia independiente y disponible públicamente para esta sección específica fue insuficiente en esta ejecución.",
};

const marketSizeBenchmarkDependentFields = new Set<MarketReportField>([
  "marketSize",
  "tamSamSom",
  "regionalAnalysis",
]);
const competitorEvidenceDependentFields = new Set<MarketReportField>([
  "competitiveLandscape",
  "majorPlayers",
]);

// P0 FIX -- confirmed live (CAGR data-preservation repair): cagr used to be
// a member of marketSizeBenchmarkDependentFields above, so a degraded cagr
// section was always explained by "no verified local market-size figure and
// no adjacent benchmark" -- TAM-related signals that say nothing about
// whether CAGR's OWN evidence (graph.cagr, the keyword+percentage
// co-occurrence extraction in market-intelligence-graph.ts) existed. A
// report could have zero CAGR evidence but a perfectly good verified market
// size, or the reverse, and this coupling would still blame the wrong gap.
// cagr now names its own evidence signal.
const missingCagrEvidenceReason: Record<ResponseLanguage, string> = {
  English:
    "No independently verifiable CAGR or compound-growth figure -- and no adjacent-market benchmark growth rate -- was found in this run.",
  Turkish:
    "Bu çalıştırmada ne bağımsız olarak doğrulanabilir bir YBBO/bileşik büyüme rakamı ne de yakın pazar referans büyüme oranı bulunabildi.",
  German:
    "In diesem Durchlauf wurde weder eine unabhängig verifizierbare CAGR-/Wachstumsrate noch ein Wachstums-Benchmark aus einem angrenzenden Markt gefunden.",
  French:
    "Aucun taux de croissance annuel composé vérifiable de manière indépendante -- ni aucun taux de croissance de référence d'un marché adjacent -- n'a été trouvé lors de cette exécution.",
  Spanish:
    "No se encontró ninguna cifra de CAGR/crecimiento compuesto verificable de forma independiente, ni una tasa de crecimiento de referencia de un mercado adyacente, en esta ejecución.",
};

function describeMissingMarketEvidence(
  field: MarketReportField,
  language: ResponseLanguage,
  coverage?: MarketResearchCoverage,
  graph?: MarketIntelligenceGraph
): string {
  if (field === "cagr") {
    const hasCagrEvidence = Boolean(graph?.cagr?.length);
    if (!hasCagrEvidence) {
      return missingCagrEvidenceReason[language];
    }
    return generalInsufficientEvidenceReason[language];
  }
  if (marketSizeBenchmarkDependentFields.has(field)) {
    const hasVerifiedSize = Boolean(coverage?.verifiedMarketSizeAvailable);
    const hasBenchmark = Boolean(graph?.adjacentBenchmarks?.length);
    if (!hasVerifiedSize && !hasBenchmark) {
      return missingMarketSizeBenchmarkReason[language];
    }
  }
  if (competitorEvidenceDependentFields.has(field) && !graph?.competitors?.length) {
    return missingCompetitorEvidenceReason[language];
  }
  return generalInsufficientEvidenceReason[language];
}

function createInsufficientEvidenceFallback(
  field: MarketReportField,
  language: ResponseLanguage,
  coverage?: MarketResearchCoverage,
  graph?: MarketIntelligenceGraph
) {
  const label = marketFieldLabels[language][field];
  const reason = describeMissingMarketEvidence(field, language, coverage, graph);
  return insufficientEvidenceFallbackTemplates[language](label, reason);
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
  // TASK #29 -- confirmed live (decision-confidence pipeline audit): this
  // used to fall back to `undefined` whenever `graph` was unavailable (the
  // acknowledged, real "unavailable_no_graph" degraded generation state --
  // see market-intelligence-canonical-state.ts's own comment on why it is
  // deliberately NOT safe to reconstruct canonical state in that case).
  // But `undefined` here does not mean "we don't know" to
  // assessMarketEntryConfidence/hasDecisionCriticalEvidenceGap/
  // capConfidenceForEvidenceGap downstream -- it means "skip the gate
  // entirely," letting the raw, citation-count-driven coverage blend
  // alone decide confidence and an ENTER/AVOID label, completely
  // ungated, in exactly the state where NO decision-critical evidence
  // (market sizing, competitive landscape, obtainable share) could
  // possibly have been verified. A missing graph is the most severe
  // evidence gap this pipeline can encounter, not a neutral unknown --
  // it must gate at least as strongly as a graph whose own sizing/
  // competitive/SOM fields all independently failed to resolve, so the
  // explicit all-unresolved state (not undefined) is passed through
  // instead. This is the single shared variable both
  // buildMarketExecutiveDecisionBrief and buildMarketEntryRecommendation
  // read below, so both surfaces are gated identically, and it can never
  // be reconstructed as a weaker signal than what a resolved graph would
  // have produced.
  const decisionCriticalEvidence: DecisionCriticalEvidenceState = graph
    ? resolveDecisionCriticalEvidenceState(graph)
    : { marketSizingResolved: false, competitiveEvidenceResolved: false, obtainableShareResolved: false };
  const marketAssessment = coverage
    ? assessMarketEntryConfidence(coverage, decisionCriticalEvidence)
    : undefined;
  // Computed once inside the `if (coverage)` block below and reused for
  // both the opening Executive Decision layer and the closing verdict
  // paragraph, so the two can never diverge or contradict each other.
  let marketExecutiveDecisionBrief: ReturnType<typeof buildMarketExecutiveDecisionBrief> | undefined;

  for (const field of reportFields) {
    // Confirmed live: competitiveLandscape (never told to, but a common
    // LLM habit when comparing several vendors) sometimes writes a raw
    // markdown table -- there is no table-drawing code anywhere in the
    // PDF/browser renderer, so it would otherwise render as unreadable
    // "| a | b | c |" pipe text. Flatten before any other cleanup runs,
    // since it's a no-op on content with no real table in it.
    const sanitized = sanitizeMarketReportContent(flattenMarkdownTables(normalized[field] || ""));
    normalized[field] = field === "sources"
      ? cleanInternalMarketSourceFallbacks(sanitized, language)
      : enforceMarketReportLanguage(sanitized, language, marketAssessment?.confidence);
    // TASK #25 -- confirmed live: the model itself sometimes writes a
    // malformed citation bracket like "[, R12]" (a leading empty entry
    // before a real reference number), which the standard [R#] pattern
    // every citation-integrity check below relies on cannot see at all --
    // not merely a display glitch, a complete blind spot for orphan
    // detection and bibliography linking alike. Normalizing it back to
    // the standard "[R12]" shape here, before any of those checks run,
    // restores it to every existing protection. sanitizeMarketReportContent
    // (above) already applies the same fix via normalizePdfText's own
    // copy of this pattern -- this explicit call is redundant-by-design
    // (a no-op on already-clean text) so this fix stays visible and
    // independently testable in this file rather than relying solely on
    // an implicit side effect of a general-purpose text normalizer.
    normalized[field] = sanitizeCitationBracketSyntax(normalized[field]) || "";
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
    marketExecutiveDecisionBrief = buildMarketExecutiveDecisionBrief(
      normalized,
      language,
      coverage,
      decisionCriticalEvidence
    );
    // CRITICAL FIX -- confirmed live: Market Intelligence's own native
    // decision vocabulary is ENTER/MONITOR/AVOID -- the "market" vocabulary
    // renders this banner's "Decision: TOKEN" line using those tokens
    // instead of the shared GO/CONDITIONAL GO/NO-GO ones Business Plan/
    // Acquisition use, so the raw executiveSummary text a user can see
    // never says "NO-GO" for this report kind.
    normalized.executiveSummary = formatExecutiveDecisionBrief(marketExecutiveDecisionBrief, language, "market");

    if (!normalized.strategicRecommendations.includes(marketEntryHeading)) {
      normalized.strategicRecommendations = `${normalized.strategicRecommendations}\n\n${buildMarketEntryRecommendation(normalized, language, coverage, decisionCriticalEvidence)}`.trim();
    }
  }

  // The final Sources bibliography is built deterministically later in
  // this function (see buildMarketIntelligenceBibliography below), once
  // every other field has gone through its final normalization pass --
  // that is what guarantees it reflects exactly the [R#] citations that
  // survived into the truly-final report body, not an intermediate draft.
  // normalized.sources still holds the model's own raw text here; it is
  // unconditionally replaced before this function returns.

  const deduped = dedupeReportParagraphsAcrossSections(normalized, {
    language,
    sectionLabels: fieldLabelsByLanguage[language],
    // strategicRecommendations is a fixed-count numbered action list (the
    // model is instructed to write an exact number of distinct actions),
    // with the numbering baked into the model's own text ("1. ...", "2.
    // ...") rather than rendered from an array length. Cross-section dedup
    // treats each numbered item as an independent "insight" eligible for
    // removal if it's similar enough to content elsewhere in the report,
    // and a removed item is replaced with a "See <field>" reference
    // appended at the END of the section, not in its original position --
    // confirmed live, this is what turned "1. ... 2. ... 3. ..." into
    // "1. ... 3. ..." with item 2 silently missing from its numbered slot.
    // Same protection this function already gives evidenceFieldPattern
    // (sources/citations/references/evidence), extended here because this
    // field carries the identical guarantee: a fixed, complete set of
    // items that must never be silently pruned.
    //
    // tamSamSom carries the same risk for a different reason: its own
    // prompt requires it to build TAM/SAM/SOM from the same verified
    // market-size figure marketSize already states (a Planning Estimate
    // must cite that figure's benchmark and geography before deriving
    // TAM/SAM/SOM from it), so its opening sentence routinely restates the
    // same underlying number. Confirmed live: cross-section dedup judged
    // that restatement a duplicate "insight" of marketSize's own sentence
    // and replaced the entire section with a bare "See Market Size for the
    // established premise" cross-reference -- discarding the section's
    // real SAM/SOM breakdown and assumptions, and leaving nothing for the
    // PDF's TAM/SAM/SOM chart to parse even when the model had produced a
    // genuine, correctly-labeled estimate.
    //
    // CRITICAL FIX -- confirmed live (root-cause pipeline repair):
    // executiveSummary carries the identical risk. buildMarketExecutiveDecisionBrief
    // builds its own fixed-count "Top Risks" / "What Evidence Is Missing"
    // numbered lists (executive-decision-brief.ts) and splices them into
    // executiveSummary -- the exact same "fixed, complete set of items
    // that must never be silently pruned" shape strategicRecommendations
    // was already protected for. When the top risk sentence (biggestRisk,
    // market-intelligence-presentation.ts) and the TAM/SAM/SOM data-gap
    // sentence (identifyMarketInformationGaps) read as near-duplicate
    // "insights" -- both routinely discuss "market size and competitive
    // positioning" data availability -- cross-section dedup could silently
    // drop the gap sentence entirely, leaving the "What Evidence Is
    // Missing:" heading in the persisted executiveSummary text with no
    // list item under it. That produced a real, live contradiction
    // downstream: the PDF/web executive decision card's own re-extraction
    // of that now-empty section fell back to claiming "no decision-
    // changing data gap was flagged" even though Market Size/CAGR/TAM-SAM-
    // SOM were genuinely unresolved elsewhere in the same report.
    //
    // CRITICAL FIX -- confirmed live (production report on a real market):
    // competitiveLandscape/majorPlayers carry the identical risk.
    // applySharedMarketGraph (above) already writes deterministic,
    // canonically-derived text into both -- e.g. when no direct competitor
    // validated, competitiveLandscape's "direct competitors could not be
    // independently validated... adjacent/platform players... identified"
    // sentence and majorPlayers' adjacent-players intro sentence
    // necessarily share heavy vocabulary overlap by design (they describe
    // the SAME underlying evidence gap). Cross-section dedup judged that
    // overlap a duplicate "insight" and collapsed the entire majorPlayers
    // section into a bare `See "Competitive Landscape" for the established
    // premise.` cross-reference -- discarding the real, evidence-backed
    // adjacent-player list this pass exists to preserve, and reproducing
    // the exact circular "Major Players points back to an empty
    // Competitive Landscape" contradiction this fix must eliminate. Both
    // fields are canonically owned by the graph and must never be silently
    // collapsed into each other.
    //
    // P0 FIX -- confirmed live (CAGR data-preservation repair): cagr carries
    // the identical risk marketSize/tamSamSom already had. cagr sits
    // immediately after marketSize in field order (marketReportFields), and
    // per its own prompt (marketPrompts.cagr) the model is expected to name
    // the SAME growth percentage marketOverview/executiveSummary may already
    // mention in scene-setting prose (e.g. "the market is growing at 12.4%
    // CAGR"). When that percentage is the only number either paragraph
    // contains, cross-section fuzzy-dedup reads cagr's paragraph as a
    // restatement of the earlier section's own "insight" and collapses the
    // entire cagr field into a bare `See "Market Overview" for the
    // established premise.` cross-reference -- a stub with no digits left
    // in it. The web/PDF headline extractor (extractHeadlineCagrValue) then
    // correctly finds no percentage in that stub and renders "Validation
    // Needed", even though the model's original text stated a real,
    // sourced (or honestly [Estimated]) figure. cagr must never be silently
    // collapsed into another section for the exact reason tamSamSom/
    // executiveSummary/competitiveLandscape/majorPlayers already are not.
    excludedFields: [
      "strategicRecommendations",
      "tamSamSom",
      "executiveSummary",
      "competitiveLandscape",
      "majorPlayers",
      "cagr",
    ],
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
    // text, never surfaces a message to the user.
    //
    // P0 FIX #6 -- confirmed live (canonical cross-section consistency
    // repair): metricTargets now cross-checks Market Size/TAM/SAM/SOM/CAGR
    // mentions against buildMarketGraphMetricConsistencyTargets' own
    // graph-sourced canonical values (see that function's own comment) --
    // this was previously omitted entirely (a stale comment here claimed
    // Market Intelligence had "no financial model... to check numbers
    // against," true for CAC/LTV/ARR but never true for its own
    // graph.planningEstimate/graph.verifiedMarketSize/graph.cagr values).
    // metricProtectedFields excludes the three fields these canonical
    // values are themselves deterministically rendered into
    // (marketSize/cagr/tamSamSom) -- correcting those against themselves
    // would be a no-op at best, a formatting risk at worst.
    const consistencyResult = runConsistencyValidationPass({
      sections: deduped,
      fields: reportFields,
      language,
      authoritativeDecision: localizeMarketEntryDecision(marketAssessment.decision, language),
      decisionProtectedFields: ["executiveSummary", "strategicRecommendations", "sources"],
      metricTargets: graph ? buildMarketGraphMetricConsistencyTargets(graph, deduped.cagr) : undefined,
      metricProtectedFields: ["marketSize", "cagr", "tamSamSom"],
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
  //
  // strategicRecommendations is skipped: it is a fixed-count numbered
  // action list with the numbering baked into the model's own text ("1.
  // ...", "2. ...") rather than rendered from an array length.
  // stripFillerAndDuplicateSentences's exact-duplicate-line removal below
  // operates within a single field and, unlike the cross-section dedup
  // above, deletes a matching line outright with no replacement --
  // confirmed live and reproduced directly: when the model restates one
  // action nearly or fully verbatim as a second item (a real, observed
  // model failure mode, not a hypothetical), the second occurrence is
  // silently deleted, turning "1. ... 2. ... 3. ..." into "1. ... 3. ..."
  // with item 2 missing and no trace it ever existed. Same guarantee this
  // field already gets from the cross-section dedup call above, extended
  // to this pass for the identical reason: a field with a fixed, complete
  // item count must never be silently pruned by a generic text-quality
  // pass that has no awareness of that guarantee.
  // sources is also skipped here: it is about to be entirely replaced by
  // the deterministic bibliography below, so running a generic
  // duplicate-line remover on the model's old raw text first is wasted
  // work at best -- and at worst, a false-positive duplicate match
  // between two DIFFERENT bibliography entries that happen to share a
  // short line (e.g. two sources both "Confidence: High") would corrupt
  // the bibliography's field alignment if this ran on it afterward.
  for (const field of reportFields) {
    if (field === "strategicRecommendations" || field === "sources") {
      continue;
    }
    deduped[field] = stripFillerAndDuplicateSentences(deduped[field]);
  }

  // Degrade weak sections to an honest "Insufficient confirmed evidence"
  // fallback BEFORE assertReportIsolation/assertNoDecisionContradiction
  // run below, not after. Those two checks scan whatever raw text the
  // model wrote for a section -- including its own attempt to explain an
  // evidence gap, which this session's own prompt work (market.ts) pushes
  // toward being longer and more elaborate ("never write a bare gap
  // notice", "always build a labeled estimate") specifically so that text
  // gives the reader something to act on. That same elaboration is more
  // surface area for the model to trip an unrelated downstream check while
  // explaining a gap. Running degradation first means isolation and
  // contradiction only ever see this function's own controlled fallback
  // text for a weak section, not the model's raw, unbounded attempt --
  // closing the exact gap where "one missing evidence type aborts the
  // whole report" could still happen through a gate other than the
  // quality gate itself. See the quality-gate block right below (now
  // running twice: once here as a read-only pre-check, once again in its
  // normal position after isolation/contradiction, for real) for why a
  // short/filler-heavy section is exactly the shape an honest gap
  // explanation takes.
  if (marketAssessment) {
    const preliminaryFailures = runExecutiveQualityGate({
      sections: deduped,
      firstField: "executiveSummary",
      sourceFields: ["sources"],
      unboundedSourceFields: ["sources"],
    });
    const degradableFields = new Set(
      preliminaryFailures
        .filter((failure) => failure.check === "every_section_adds_decision_value" && failure.field)
        .map((failure) => failure.field as string)
    );
    for (const field of degradableFields) {
      if (isMarketReportField(field)) {
        deduped[field] = createInsufficientEvidenceFallback(field, language, coverage, graph);
        logOperationalInfo("[api:market-analysis] section degraded to insufficient-evidence fallback", {
          field,
        });
      }
    }
  }

  // Enforce the same one-inline-URL ceiling assertExecutiveQualityGate's
  // no_long_source_lists check is about to require, rather than letting a
  // section that wrote several raw citation URLs inline fail generation
  // outright. Only rewrites additional URLs into bracketed references and
  // moves any without a known record into a running extra-lines list --
  // see inline-source-url-limit.ts for exactly what is (and isn't) done.
  //
  // P0 PRODUCTION FIX -- confirmed live (Market Intelligence citation
  // integrity audit): this used to run AFTER the deterministic bibliography
  // below via enforceInlineRawUrlLimitAcrossSections's own all-in-one
  // sources-field handling. Its "known source" branch rewrites a
  // second-or-later inline URL in any body field into a real, valid [R#]
  // bracket citation (`[${known.evidenceId}]`) -- but the bibliography had
  // already finished scanning `deduped` for [R#] tags by that point, so
  // that newly-introduced, perfectly valid (non-orphan) citation never
  // received its own "Reference: [R#]" entry: it would pass
  // assertNoOrphanEvidenceReferences below (a real, citable id) while
  // remaining permanently absent from the one bibliography a reader --
  // and the deterministic self-consistency check just below -- actually
  // resolves citations against. Rewriting URLs FIRST, then building the
  // bibliography from that output, guarantees every [R#] that survives
  // into the final report body, however it got there, is captured by the
  // same single bibliography pass. Inlined here (rather than keeping the
  // shared enforceInlineRawUrlLimitAcrossSections wrapper, whose own
  // sources-field-folding step assumes it runs last) so the shared,
  // report-type-agnostic module and every other caller of it are
  // untouched.
  const inlineUrlSourceLookup = buildSourceLookupByUrl(graph?.sources);
  const inlineUrlExtraLines: string[] = [];
  for (const field of reportFields) {
    if (field === "sources") continue;
    const { content, extraSourceLines } = enforceInlineRawUrlLimit(
      deduped[field],
      1,
      inlineUrlSourceLookup
    );
    deduped[field] = content;
    inlineUrlExtraLines.push(...extraSourceLines);
  }

  // The final, deterministic Sources bibliography: every [R#] reference
  // actually cited anywhere in the now-fully-normalized report body,
  // resolved to its real record in the verified evidence registry --
  // never the model's own free-form citation prose, never a category+
  // count compression. Built here (after dedup/consistency/filler/
  // degradation/inline-URL-rewriting have all finished mutating the other
  // fields) so it reflects exactly the citations that survived into the
  // truly-final report, not an intermediate draft. Falls back to the
  // previous category+count Evidence Summary only when there is no graph
  // at all (a cached/degraded report with nothing to build a bibliography
  // from), preserving prior behavior for that one edge case.
  deduped.sources = graph
    ? buildMarketIntelligenceBibliography(deduped, graph, language)
    : buildEvidenceSummary(deduped.sources, language);

  if (inlineUrlExtraLines.length > 0) {
    deduped.sources = `${deduped.sources}\n${inlineUrlExtraLines.join("\n")}`.trim();
  }

  // Deterministic closing verdict, built from the exact same brief object
  // as the opening Executive Decision layer -- appended to Sources because
  // ReportPdfButton.tsx's mergePdfSourceSections always forces Sources to
  // the final page regardless of schema field order, guaranteeing this is
  // the last thing a reader sees before closing the PDF.
  if (marketExecutiveDecisionBrief) {
    deduped.sources = `${deduped.sources}\n\n${buildMarketFinalVerdictParagraph(marketExecutiveDecisionBrief, language)}`.trim();
  }

  // Fail fast instead of silently returning a mixed report: throws if any
  // section contains Business Idea Validation's or Strategic Advisory's
  // specific vocabulary (founder readiness, validation gate, runway,
  // EBITDA, PMF, fundraising, PASS/HOLD/VALIDATE/REJECT, ...).
  assertReportIsolation("market_intelligence", deduped);

  // Fail fast instead of shipping a report with an unresolvable [R#]
  // marker: every evidence reference actually rendered anywhere in the
  // report must resolve to a real entry in the verified source registry
  // (graph.sources, built directly from research evidence). Guarded by
  // `graph` for the same reason the other graph-dependent checks are --
  // a cached/degraded report with no graph has nothing to validate
  // references against.
  //
  // P0 PRODUCTION FIX -- confirmed live (Market Intelligence citation
  // integrity audit): the `graph` branch above was previously the ONLY
  // handling for [R#] markers -- when graph is unavailable, nothing ran
  // at all, and the model's freeform [R#] citations (executiveSummary,
  // majorPlayers, competitiveLandscape, strategicRecommendations, ...)
  // shipped to the reader completely unverified, sitting next to a
  // Sources field that had already degraded to a generic category+count
  // summary (buildEvidenceSummary, above) with no relationship to those
  // specific reference numbers. Confirmed against a real persisted report
  // reconstructed from a graph-less cache hit: six distinct [R#] markers
  // ([R3][R4][R5][R6][R12][R39]) appeared across the report body while
  // Sources read "1 verified source used" -- every one was an
  // unresolvable dead end. With no registry to check them against, a
  // [R#] marker in this state cannot be told apart from a hallucinated
  // reference number, so it must not reach the reader looking like a
  // resolvable citation -- see neutralizeUnverifiableEvidenceReferences's
  // own comment for why the number itself is dropped, not preserved.
  if (graph) {
    assertNoOrphanEvidenceReferences(deduped, graph.citableEvidenceIds);

    // Fail fast instead of shipping two separate bibliography entries
    // (two different [R#] numbers) for what is, by exact title and
    // publisher, the same underlying document reached via two different
    // URLs -- see assertNoDuplicateCitationSources's own comment for why
    // this match key can never incorrectly merge genuinely distinct
    // evidence. Detection only: this never merges or mutates
    // graph.sources itself, it only fails generation so the underlying
    // research-pipeline duplicate can be investigated and fixed at its
    // source rather than shipped to a reader as two citations.
    assertNoDuplicateCitationSources(graph.sources);

    // Fail fast instead of shipping a report where a citation is a real,
    // registry-valid evidence id (just proven non-orphan above) but still
    // has no "Reference: [R#]" entry in the actual persisted Sources text
    // -- the one place a reader (and every UI/PDF renderer, which all
    // read this exact persisted string with no numbering logic of their
    // own) can resolve it against. This is the runtime invariant that
    // makes "UI and PDF resolve citation IDs from the same persisted
    // canonical mapping" true by construction: as long as this passes,
    // every current and future renderer that only ever displays this
    // text inherits a complete, self-consistent citation mapping for
    // free, with nothing left for it to independently derive or
    // renumber.
    assertCitationsResolveInBibliography(deduped, deduped.sources);
  } else {
    Object.assign(deduped, neutralizeUnverifiableEvidenceReferences(deduped, language));
  }

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

  // Fail fast on a broken numbered action plan (skipped/duplicated
  // numbering, or a numbered item with no substantive body) -- these are
  // unambiguous regardless of language or market, unlike per-item
  // owner/budget/KPI field presence, which is fuzzy free-text matching
  // and only ever logged, never used to fail generation.
  if (deduped.strategicRecommendations) {
    assertStrategicRecommendationsNumbering(deduped.strategicRecommendations);
    const softIssues = findStrategicRecommendationsStructureIssues(
      deduped.strategicRecommendations
    ).filter((issue) => issue.type === "missing_field");
    if (softIssues.length > 0) {
      console.error("[api:market-analysis] Strategic Recommendations may be missing required fields", {
        issues: softIssues.map((issue) => issue.detail),
      });
    }
  }

  // Quality Gate, for real: fail generation instead of silently returning
  // a report that dumps information rather than helping a decision-maker
  // act. Only enforced when coverage was available -- that's what makes
  // the single Executive Decision layer possible in the first place;
  // without it (e.g. a cached/degraded report with no coverage data), the
  // report falls back to its pre-existing, less-strict shape rather than
  // hard-failing on a check it was never given the inputs to satisfy.
  // Weak sections were already degraded to an honest fallback above, so
  // this is the strict, final check: report-wide problems (opening
  // decision quality, page-one readability, overall filler ceiling) and
  // any section still bad even after the honest rewrite still fail the
  // report for real -- those cases mean there genuinely isn't enough
  // evidence to support the overall decision, the only condition under
  // which this report should still fail outright.
  if (marketAssessment) {
    assertExecutiveQualityGate({
      sections: deduped,
      firstField: "executiveSummary",
      sourceFields: ["sources"],
      unboundedSourceFields: ["sources"],
    });
  }

  // TASK #23 -- persisted canonical-state hardening: only ever built when
  // BOTH a full graph AND a full decision brief were actually computed
  // (the "healthy" generation path) -- a cached/degraded report missing
  // either has nothing genuinely canonical to snapshot, and returning
  // null here (rather than a partially-populated object) is what makes
  // readMarketIntelligenceCanonicalState's version-gated fallback the
  // ONLY path for that report, exactly like a legacy report predating
  // this field entirely.
  //
  // TASK #23 (follow-up) -- confirmed via direct trace of both the fresh-
  // generation and cache-hit-reconstruction call paths: `graph` truthy
  // always implies `marketExecutiveDecisionBrief` truthy in this
  // codebase's actual data flow (coverage is always derived using
  // graph.coverage as its override, and the decision brief only requires
  // coverage) -- so this is really one condition, not two, and it is
  // never partially satisfied. When it's false, there is no evidence, no
  // coverage, and nothing genuinely structured to reconstruct -- only raw
  // model prose -- so canonicalStateStatus records that explicitly
  // (`unavailable_no_graph`) rather than silently returning nothing and
  // leaving this report indistinguishable from one persisted before this
  // mechanism ever existed. See market-intelligence-canonical-state.ts's
  // own comment for the full investigation.
  const marketIntelligenceCanonicalState =
    graph && marketExecutiveDecisionBrief
      ? buildMarketIntelligenceCanonicalState({
          graph,
          // TASK #29 -- decisionCriticalEvidence (ensureMarketReportQuality,
          // above) is now always a real, fully-typed
          // DecisionCriticalEvidenceState -- never undefined, even in the
          // no-graph state -- so the `|| { ...fully unresolved }` fallback
          // this line used to need (duplicating that same all-false shape
          // independently, and only for the PERSISTED copy, leaving the
          // NUMBER already baked into marketExecutiveDecisionBrief above
          // ungated) is no longer reachable and has been removed.
          decisionCriticalEvidence,
          decisionBrief: marketExecutiveDecisionBrief,
        })
      : null;
  const marketIntelligenceCanonicalStateStatus: MarketIntelligenceCanonicalStateStatus =
    marketIntelligenceCanonicalState ? "available" : "unavailable_no_graph";

  return {
    sections: deduped,
    canonicalState: marketIntelligenceCanonicalState,
    canonicalStateStatus: marketIntelligenceCanonicalStateStatus,
  };
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
  canonicalState: MarketIntelligenceCanonicalState | null;
  canonicalStateStatus: MarketIntelligenceCanonicalStateStatus;
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

  const quality = ensureMarketReportQuality(report, coverage, language, graph);

  return {
    report: quality.sections,
    missingFields,
    invalidFields,
    canonicalState: quality.canonicalState,
    canonicalStateStatus: quality.canonicalStateStatus,
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

// The Responses API can split one continuous answer across multiple
// output/content array entries (e.g. text broken around a citation
// annotation, or multiple message items in `output`). Concatenating those
// pieces with no separator is only safe when the API itself left the
// necessary whitespace at the boundary; when a boundary falls between two
// ordinary words with neither piece contributing a space, joining with ""
// silently fuses them into one broken compound (confirmed live in Turkish
// market reports as words like "pazarbüyüklüğü"). A plain space-joined
// concatenation is just as wrong the other way, since it would add a
// stray space before punctuation or a citation marker that is meant to sit
// flush against the preceding text. Inserting a space only when both sides
// of the boundary are alphanumeric -- the one case where no separator can
// ever be correct -- fixes the merge without touching any boundary that
// was already correct.
function joinExtractedTextSegments(segments: string[]): string {
  return segments.reduce((joined, segment) => {
    if (!joined) return segment;
    if (!segment) return joined;

    const boundaryNeedsSpace =
      /[\p{L}\p{N}]$/u.test(joined) && /^[\p{L}\p{N}]/u.test(segment);

    return boundaryNeedsSpace ? `${joined} ${segment}` : `${joined}${segment}`;
  }, "");
}

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
    return joinExtractedTextSegments(
      value.map((item) => extractTextFromValue(item, parentKey, seen)).filter(Boolean)
    );
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

    // P0 PRODUCTION FIX -- confirmed live (Task #12, decision-vs-evidence
    // consistency repair): the single-field path below (reached when a
    // client requests one report field directly, not the full
    // "fullReport" mode) generates and caches its response with NO
    // downstream processing at all -- no ensureMarketReportQuality, no
    // assessMarketEntryConfidence, no canonical "Decision: TOKEN
    // (Confidence: NN%)" banner, since it never builds the domain-research
    // evidence graph the gate needs. Every OTHER report field is safely
    // self-contained (its own prompt, no cross-field decision
    // dependency), but executiveSummary specifically encodes the
    // go/no-go DECISION, which can only be safely computed with the full
    // evidence graph (TAM/SAM/SOM resolution state, competitive evidence
    // state, etc.). Serving/caching a standalone executiveSummary here
    // would let the model's own raw, ungated "Decision: ENTER..."
    // sentence through with zero evidence-gap gating -- exactly the
    // reported incoherence (a definitive ENTER sitting next to an
    // explicit, unresolved SOM caveat). Rather than rebuilding the
    // graph/coverage pipeline inside this narrower, single-field code
    // path (a far larger change than this fix warrants), Market
    // Intelligence's executiveSummary is only ever safely generated as
    // part of a full report, where the gate always runs.
    if (!isFullReportRequest && reportField === "executiveSummary") {
      return NextResponse.json(
        {
          error:
            "Executive Summary reflects a decision computed from the full evidence graph and cannot be regenerated on its own. Request a full report regeneration instead.",
        },
        { status: 400 }
      );
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
      const conversationResearchSnapshot = await getConversationResearchSnapshot({
        supabase,
        userId: user.id,
        conversationId:
          typeof body?.conversationId === "string"
            ? body.conversationId
            : null,
      });
      // CRITICAL FIX -- confirmed live (cache/regeneration safety audit):
      // this snapshot was trusted "authoritative" purely by conversationId
      // match, with no check that it was captured for THIS prompt/topic --
      // see conversationResearchIdentityMatches's own comment. A mismatch
      // (e.g. an earlier chat message in this thread was about a different
      // market) now discards the snapshot here, once, so every downstream
      // consumer of `conversationResearch` (context fingerprint, graph
      // reuse) inherits the same guarantee without its own check.
      const conversationResearch = conversationResearchSnapshot &&
        conversationResearchIdentityMatches(conversationResearchSnapshot.identity, researchIdentity)
        ? conversationResearchSnapshot
        : null;
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
          ? buildMarketIntelligenceGraph(cachedDomainResearch, promptText, responseLanguage)
          : null);
      // P0 PRODUCTION FIX -- confirmed live (Market Intelligence
      // production consistency hardening): this used to gate the ENTIRE
      // coverage computation behind `cachedDomainResearch` being present
      // -- but applyMarketResearchCoverageToContext's `bundle.evidence`
      // argument is only ever read as a fallback (`coverageOverride ||
      // evaluateMarketResearchCoverage(bundle.evidence, prompt)`,
      // market-research-coverage.ts), completely unused whenever a
      // coverageOverride (cachedMarketGraph?.coverage, already computed
      // and cached alongside the report) is supplied. Requiring
      // cachedDomainResearch here was therefore stricter than the
      // function it gates actually needs: a report reconstructed from
      // cache with a cached graph but no separately-cached domain-
      // research bundle (a real, common shape -- confirmed live via
      // getCachedMarketIntelligenceGraphFromReportData's own independent
      // fallback above) always fell through to `coverage: undefined`,
      // which skips the `if (coverage)` banner-embedding block in
      // parseFullMarketReport/ensureMarketReportQuality below entirely --
      // silently dropping the deterministic "Decision: TOKEN (Confidence:
      // NN%)" banner from executiveSummary and leaving the web/PDF
      // Confidence card at "--" even though a real, already-computed
      // confidence value existed the whole time. Falling back to a safe
      // empty-evidence bundle when cachedDomainResearch is absent but a
      // real coverage override IS available lets that already-computed,
      // real value through -- it never fabricates a coverage figure: the
      // override is always either a genuine `MarketResearchCoverage`
      // object or undefined, in which case this still correctly resolves
      // to `null` exactly as before.
      const cachedCoverageResult = cachedDomainResearch || cachedMarketGraph?.coverage
        ? applyMarketResearchCoverageToContext(
            canonicalFinancialAssumptions,
            cachedDomainResearch || { evidence: [] },
            promptText,
            cachedMarketGraph?.coverage
          )
        : null;
      const cachedReportContext = cachedCoverageResult
        ? {
            ...cachedCoverageResult.context,
            investmentScore: {
              ...cachedCoverageResult.context.investmentScore,
              ...refreshInvestmentNarrativeFromResearchCoverage(
                cachedCoverageResult.context.investmentScore,
                cachedCoverageResult.context
              ),
            },
          }
        : canonicalFinancialAssumptions;

      // TASK #29C -- confirmed live (real localhost regeneration, decision-
      // confidence-state audit): `ai_response_cache` (governance.ts,
      // upsert_global_ai_response_cache_entry) has no column at all for a
      // research bundle or MarketIntelligenceGraph -- it only ever stores
      // the response TEXT plus token/cost bookkeeping. So
      // `cachedFullReport?.responseData` (used by
      // getCachedResearchFromReportData/getCachedMarketIntelligenceGraphFromReportData
      // just above) is unconditionally undefined for any cache hit served
      // from that table, and cachedMarketGraph can only ever be non-null
      // via conversationResearch?.marketIntelligenceGraph -- the LIVE,
      // conversation-scoped snapshot, which is absent for a genuinely new
      // conversation reusing an old, cross-session cached response (the
      // exact real case reproduced: a report regenerated days after the
      // original request, same prompt/model/financial-assumptions
      // fingerprint, therefore the same cache key). Serving that cached
      // TEXT without a graph is exactly the state the P0 PRODUCTION FIX a
      // few lines above already hardened against for a PARTIALLY missing
      // cache (graph present, domain-research bundle absent) -- but it
      // still assumed a graph would be present at all. When neither a
      // graph nor a domain-research bundle can be recovered, there is no
      // partial evidence left to degrade gracefully with: coverage,
      // decisionCriticalEvidence, and therefore the entire canonical
      // confidence-factor state, cannot be built at all, permanently
      // stuck at "unavailable_no_graph" every time this exact cache entry
      // is served, no matter how correct the presentation-layer code is.
      // Requiring cachedMarketGraph here falls through to the fresh-
      // generation path below instead (which always builds a real,
      // current MarketIntelligenceGraph -- see marketIntelligenceGraph's
      // own construction further down), so a "regenerate" can always
      // produce a report with genuine, evidence-derived canonical state
      // rather than resurrecting text with none.
      if (
        cachedFullReport &&
        cachedMarketGraph &&
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
        let cachedCanonicalState: MarketIntelligenceCanonicalState | null = null;
        let cachedCanonicalStateStatus: MarketIntelligenceCanonicalStateStatus = "unavailable_no_graph";

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
          cachedCanonicalState = parsedCachePayload.canonicalState;
          cachedCanonicalStateStatus = parsedCachePayload.canonicalStateStatus;
          if (cachedDomainResearch) {
            validateDomainResearchQuality({
              report: parsedCachedReport,
              bundle: cachedDomainResearch,
              expectedDomain: "business",
            });
          }
          // The fresh-generation path below validates every report with
          // assertReportIsolation before it can ever reach a client -- this
          // cache-hit path parsed and returned cachedFullReport.responseText
          // directly without that same check, so a report cached before an
          // isolation-related fix (or from any other source of foreign
          // vocabulary) could be served to users indefinitely, unvalidated,
          // for as long as it kept getting served from cache. Running the
          // same check here, inside this same try block, means a violation
          // is handled exactly like a malformed cache entry below: logged,
          // and the request falls through to a fresh, validated generation
          // instead of ever serving the tainted cached copy again.
          assertReportIsolation("market_intelligence", parsedCachedReport);
        } catch (error) {
          console.error("[api:market-analysis] Ignoring malformed cached full report", {
            reportRequestId: reportRequestId || null,
            cacheKey: fullReportCacheKey,
            failureReason:
              error instanceof Error && error.message ? error.message : "CacheParseFailed",
          });
          // parseFullMarketReport already assigns parsedCachedReport before
          // assertReportIsolation can run, so a thrown isolation violation
          // would otherwise leave the tainted report sitting in this
          // variable -- reset it so the "cache miss, regenerate" branch
          // below is genuinely taken instead of silently serving what this
          // catch block just logged as rejected.
          parsedCachedReport = null;
          cachedCanonicalState = null;
          cachedCanonicalStateStatus = "unavailable_no_graph";
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
              serializeMarketReportChunks(parsedCachedReport) +
              serializeMarketReportMetadataChunk(cachedCanonicalState, cachedCanonicalStateStatus)
          ), {
            headers: {
              "Content-Type": "application/x-ndjson; charset=utf-8",
              "Cache-Control": "no-cache, no-transform",
            },
          });
        }
      }

      if (cachedFullReport && !cachedMarketGraph) {
        // TASK #29C -- distinct from the pre-existing "failed content"
        // log below: the cached text itself is fine, but no research
        // bundle/graph could be recovered for it (see this file's own
        // comment on the cache-hit condition above), so it is skipped in
        // favor of a fresh generation that can build real canonical
        // confidence-factor state.
        console.error("[api:market-analysis] Ignoring cached full report with no recoverable research graph", {
          endpoint: "/api/market-analysis",
          reportField: FULL_REPORT_FIELD,
          cacheKey: fullReportCacheKey,
        });
      } else if (cachedFullReport) {
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
        buildMarketIntelligenceGraph(domainResearch, promptText, responseLanguage);
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
      const reportAnalysisContext = {
        ...marketCoverageResult.context,
        investmentScore: {
          ...marketCoverageResult.context.investmentScore,
          ...refreshInvestmentNarrativeFromResearchCoverage(
            marketCoverageResult.context.investmentScore,
            marketCoverageResult.context
          ),
        },
      };
      // Research is already complete at this point, so the deterministic
      // ENTER/MONITOR/AVOID verdict is fully computable before generation
      // -- telling the model now lets every section (Strategic
      // Recommendations, Opportunities, Market Drivers) self-condition on
      // the real verdict instead of only being checked against it after
      // the fact by assertNoDecisionContradiction.
      //
      // P0 FIX -- confirmed live (executive decision integrity repair):
      // gated by the SAME resolveDecisionCriticalEvidenceState(marketIntelligenceGraph)
      // the final post-generation banner below uses, so the model is never
      // pre-conditioned on a stronger verdict (e.g. told "ENTER" here) than
      // the report will actually display once generation finishes -- the
      // exact mismatch that used to let the model write full-speed growth
      // advice against a verdict the final banner then downgraded.
      const preGenerationVerdictContext = buildPreGenerationVerdictContext(
        assessMarketEntryConfidence(
          marketCoverageResult.coverage,
          resolveDecisionCriticalEvidenceState(marketIntelligenceGraph)
        ),
        responseLanguage,
        marketCoverageResult.coverage.dimensions
      );

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
        // This response reaches the client directly (an HTTP 422 body, not
        // a private prompt-context block) -- the raw evidenceField
        // identifiers (e.g. "regional_benchmark") must never appear here
        // unhumanized, for the same reason they must never appear in the
        // model's own prompt context (see humanizeEvidenceFieldName in
        // domain-research.ts).
        const clarificationUnresolvedLabel =
          humanizeEvidenceFieldList(clarificationUnresolvedFields);
        const clarificationErrorText =
          responseLanguage === "Turkish"
            ? `Araştırma tamamlandı, ancak karar raporu için doğrulanabilir temel kanıt bulunamadı. Gerekli bilgi veya belge: ${clarificationUnresolvedLabel || "karar bağlamı"}.`
            : `Research completed, but no verifiable core evidence was found for a decision report. Required information or document: ${clarificationUnresolvedLabel || "decision context"}.`;
        return NextResponse.json(
          { error: clarificationErrorText },
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

Final validated market intelligence graph (authoritative shared chat/report object -- this JSON's field names such as "sizingGap" or "confidenceClassification" are internal code identifiers for your reference only; never copy a field/key name into the written report, write only natural business language):
${formatMarketIntelligenceGraphForModel(marketIntelligenceGraph)}

${marketEvidenceCoverageContext}

${preGenerationVerdictContext}

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
              canonicalState: freshCanonicalState,
              canonicalStateStatus: freshCanonicalStateStatus,
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

            // Decision Engine V2 -- SHADOW MODE ONLY. Consumes the exact
            // same already-computed, already-normalized report sections,
            // MarketResearchCoverage, and MarketIntelligenceGraph this
            // request already produced -- no new AI/search call, no
            // change to `parsedReport`, no effect on the response sent
            // below. Scheduled (not run inline) so it cannot delay this
            // response: scheduleDecisionEngineV2ShadowMode defers the
            // entire evaluation to setImmediate, strictly after this
            // request's response body has been enqueued below. Disabled
            // by default (see app/lib/decision-engine-v2/ab-readiness.ts);
            // its result is only ever logged for internal comparison
            // (see app/lib/decision-engine-v2/shadow-mode.ts) and is
            // never read by anything on the production response path.
            // parsedReport/coverage/graph are never mutated anywhere
            // later in this file, so the deferred evaluation sees
            // identical data to what a synchronous call would have seen.
            if (!isPartialReport) {
              scheduleDecisionEngineV2ShadowMode({
                decisionInput: {
                  sections: parsedReport,
                  coverage: marketCoverageResult.coverage,
                  graph: marketIntelligenceGraph,
                },
                executiveSummaryText: parsedReport.executiveSummary || "",
                reportRequestId: reportRequestId || null,
                isPartialReport,
              });
            }

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

            enqueue(
              warning +
                serializeMarketReportChunks(parsedReport) +
                serializeMarketReportMetadataChunk(freshCanonicalState, freshCanonicalStateStatus)
            );

            await withReportTimeout(
              (async () => {
                if (!isPartialReport && !isReportGenerationFailureText(responseText)) {
                  await storeCachedAiResponse(supabase, {
                    userId: user.id,
                    cacheKey: fullReportCacheKey,
                    promptHash,
                    endpoint: "/api/market-analysis",
                    reportField: FULL_REPORT_FIELD,
                    language: responseLanguage,
                    model,
                    responseText,
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

    const fieldAbort = createReportAbortSignal(req.signal, SINGLE_FIELD_OPENAI_TIMEOUT_MS);
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
        { signal: fieldAbort.signal })
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
          } finally {
            fieldAbort.cleanup();
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
