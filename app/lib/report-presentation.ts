import type { ReportInvestmentScore, ReportQualityScore } from "@/app/lib/report-investment-score";
import {
  polishTurkishUserFacingOutput,
  sanitizeInternalRoutingMetadata,
} from "@/app/lib/report-output-sanitization";
import { extractExecutiveDecisionFromText } from "@/app/lib/report-engine/executive-decision-brief";

export type ExecutiveSnapshot = {
  decision: string;
  confidence: string;
  confidenceScore: number | null;
  founderScore: string;
  founderScoreValue: number | null;
  financialQuality: string;
  reportQuality: string;
  mainRisk: string;
  nextAction: string;
  riskLevel: "Low" | "Medium" | "High";
  riskHeatmap: Array<{
    label: string;
    level: "Low" | "Medium" | "High";
  }>;
  confidenceRadar: Array<{
    label: string;
    score: number | null;
  }>;
  why: string[];
  risks: string[];
  actions: string[];
};

export type ReportQualityBreakdownItem = {
  label: string;
  value: string;
};

export type ReportPresentationLabels = {
  executiveSnapshot: string;
  decision: string;
  confidence: string;
  founderScore: string;
  financialQuality: string;
  reportQuality: string;
  mainRisk: string;
  nextAction: string;
  riskLevel: string;
  confidenceGauge: string;
  founderScoreGauge: string;
  riskHeatmap: string;
  confidenceRadar: string;
  why: string;
  mainRisks: string;
  nextActions: string;
  keyTakeaway: string;
  details: string;
};

const ENGLISH_LABELS: ReportPresentationLabels = {
  executiveSnapshot: "Executive Snapshot",
  decision: "Decision",
  confidence: "Confidence",
  founderScore: "Founder Readiness Score",
  financialQuality: "Financial Quality",
  reportQuality: "Report Quality",
  mainRisk: "Main Risk",
  nextAction: "Next Action",
  riskLevel: "Risk Level",
  confidenceGauge: "Confidence Gauge",
  founderScoreGauge: "Founder Readiness Gauge",
  riskHeatmap: "Risk Heatmap",
  confidenceRadar: "Confidence Radar",
  why: "Why",
  mainRisks: "Main Risks",
  nextActions: "Next Actions",
  keyTakeaway: "Key Takeaway",
  details: "Details",
};

const TURKISH_LABELS: ReportPresentationLabels = {
  executiveSnapshot: "Yönetici Özeti",
  decision: "Karar",
  confidence: "Güven",
  founderScore: "Kurucu Hazırlık Skoru",
  financialQuality: "Finansal Kalite",
  reportQuality: "Rapor Kalitesi",
  mainRisk: "Ana Risk",
  nextAction: "Sonraki Aksiyon",
  riskLevel: "Risk Seviyesi",
  confidenceGauge: "Güven Göstergesi",
  founderScoreGauge: "Kurucu Hazırlık Göstergesi",
  riskHeatmap: "Risk Isı Haritası",
  confidenceRadar: "Güven Radarı",
  why: "Neden",
  mainRisks: "Ana Riskler",
  nextActions: "Sonraki Aksiyonlar",
  keyTakeaway: "Temel Çıkarım",
  details: "Detaylar",
};

const TURKISH_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bBusiness Plan\b/g, "İş Planı"],
  [/\bCompleted\b/g, "Tamamlandı"],
  [/\bConfidence\b/g, "Güven"],
  [/\bInvestor Ready\b/g, "Yatırımcı Hazır"],
  [/\bFrom report model\b/g, "Rapor modelinden"],
];

// ö/ü/Ö/Ü are deliberately excluded from this character class -- see the
// matching fix and comment on isTurkishReportText in
// report-output-sanitization.ts: they are ordinary German letters, not
// Turkish-exclusive ones, and this function previously false-triggered on
// any English report whose Sources section cited a German-language
// publisher/title, wrongly relabeling it into Turkish on-screen.
function isTurkishContent(content: string) {
  return /[çğışÇĞİŞ]|\b(?:Karar|Güven|Yönetici|Pazar|Finansal|Kurucu|Kaynaklar|Doğrulama)\b/i.test(
    content
  );
}

function normalizeExecutiveInsightLabels(content: string) {
  return content
    .replace(
      /\b(AI Executive Insight|AI Yönetici İçgörüsü)\s*:\s*(?:\1\s*:)+/gi,
      "$1: "
    )
    .replace(
      /\bAI Yönetici İçgörüsü\s*:\s*AI Executive Insight\s*:/gi,
      "AI Yönetici İçgörüsü:"
    )
    .replace(
      /\bAI Executive Insight\s*:\s*AI Yönetici İçgörüsü\s*:/gi,
      "AI Executive Insight:"
    );
}

function removeAdjacentDuplicateWords(content: string) {
  return content.replace(/\b([\p{L}\p{N}][\p{L}\p{N}'’.-]*)\s+\1\b/giu, "$1");
}

// FINAL PRODUCTION POLISH -- generic template-artifact cleanup. Confirmed
// live across several reports: broken sentence/field concatenation left
// behind literal double periods ("...assumptions.. is validated"),
// duplicated punctuation from adjacent template fragments (",,", "!!",
// "::"), and stray double spaces / trailing whitespace from conditional
// field joins. Language-agnostic (applies to both English and Turkish
// content) and deliberately narrow: a genuine ellipsis ("...") is never
// touched (the lookbehind/lookahead below only match exactly two periods
// with no third adjacent), and nothing here rewrites words or removes
// content -- only stray repeated punctuation and whitespace.
export function cleanupTemplatePresentationArtifacts(content: string) {
  return content
    .replace(/(?<!\.)\.\.(?!\.)/g, ".")
    .replace(/([,;:!?])\1+/g, "$1")
    // Only collapses a run of 2+ spaces/tabs that follows a non-whitespace
    // character -- intentional leading indentation (e.g. the Sources
    // section's "  Publisher: ..." nested under its "• Source Name" bullet)
    // starts a line with nothing before it, so it is never touched.
    .replace(/([^\s])[ \t]{2,}/g, "$1 ")
    .replace(/[ \t]+\n/g, "\n");
}

function removeDuplicateLines(content: string) {
  const seen = new Set<string>();

  return content
    .split("\n")
    .filter((line) => {
      const normalized = line
        .trim()
        .replace(/^[-*•\d.)\s]+/, "")
        .replace(/\s+/g, " ")
        .toLowerCase();

      if (!normalized) {
        return true;
      }

      if (
        normalized.includes("ai executive insight") ||
        normalized.includes("ai yönetici içgörüsü") ||
        normalized.includes("benchmark") ||
        normalized.includes("recommendation") ||
        normalized.includes("tavsiye") ||
        normalized.includes("risk")
      ) {
        if (seen.has(normalized)) {
          return false;
        }

        seen.add(normalized);
      }

      return true;
    })
    .join("\n");
}

export function normalizeReportPresentationText(content: string) {
  let normalized = cleanupTemplatePresentationArtifacts(
    removeDuplicateLines(
      removeAdjacentDuplicateWords(
        normalizeExecutiveInsightLabels(sanitizeInternalRoutingMetadata(content))
      )
    )
  )
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (isTurkishContent(normalized)) {
    for (const [pattern, replacement] of TURKISH_REPLACEMENTS) {
      normalized = normalized.replace(pattern, replacement);
    }
    normalized = polishTurkishUserFacingOutput(normalized);
  }

  return normalized;
}

export function getReportPresentationLabels(content: string): ReportPresentationLabels {
  return isTurkishContent(content) ? TURKISH_LABELS : ENGLISH_LABELS;
}

function stripMarkdown(value: string) {
  return value
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[[^\]]*]\([^)]*\)/g, (match) => match.replace(/\[|\]\([^)]*\)/g, ""))
    .replace(/[#>*_`|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitSentences(content: string) {
  return stripMarkdown(content)
    .split(/(?<=[.!?])\s+|(?:\n|\r)+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 24);
}

function extractLabelValue(content: string, labels: string[]) {
  for (const label of labels) {
    const match = content.match(
      new RegExp(`(?:^|\\n)\\s*(?:[-*•]\\s*)?${label}\\s*[:\\-–—]\\s*([^\\n]+)`, "i")
    );

    if (match?.[1]?.trim()) {
      return stripMarkdown(match[1]).slice(0, 120);
    }
  }

  return "";
}

function extractDecision(content: string, isTurkish = false) {
  const labeled = extractLabelValue(content, [
    "Decision",
    "Karar",
    "Recommendation",
    "Tavsiye",
    "Final decision",
    "Nihai karar",
  ]);
  // Recommendation's own labeled span is often just next-step bullets, not
  // a restatement of the verdict (the executiveSummary prompt puts the
  // actual PASS/HOLD/VALIDATE/REJECT keyword in a separate "Bottom Line"
  // sentence) -- fall back to searching the whole field content for the
  // canonical keyword before ever returning the labeled text verbatim and
  // unbounded, which the cover page renders at 18pt with no wrapping.
  const decisionMatch =
    (labeled && labeled.match(/\b(GO|WAIT|NO-GO|NO GO|HOLD|VALIDATE|PASS|REJECT)\b/i)) ||
    content.match(/\b(GO|WAIT|NO-GO|NO GO|HOLD|VALIDATE|PASS|REJECT)\b/i);

  if (!decisionMatch) {
    return labeled || (isTurkish ? "BEKLE" : "WAIT");
  }

  const value = decisionMatch[1].toUpperCase().replace("NO GO", "NO-GO");
  if (value === "HOLD" || value === "VALIDATE") {
    return isTurkish ? "BEKLE" : "WAIT";
  }
  if (value === "PASS") {
    return "GO";
  }
  if (value === "REJECT") {
    return "NO-GO";
  }

  return value;
}

function extractConfidenceValue(content: string, isTurkish = false) {
  const labeled = extractLabelValue(content, [
    "Decision Confidence",
    "Confidence",
    "Karar Güveni",
    "Güven",
  ]);
  const match = (labeled || content).match(/\b(\d{1,3})\s*%/);

  return match
    ? `${Math.min(100, Number(match[1]))}%`
    : labeled || (isTurkish ? "Kanıt düzeyi açıklanmalı" : "Needs evidence review");
}

function extractPercentScore(content: string, labels: string[]) {
  const labeled = extractLabelValue(content, labels);
  // A bare number is only safe to trust within the labeled span itself
  // (e.g. "Founder Score: 72" with no "%"). Falling back to the same bare
  // match against the *entire* report when no label is found at all (true
  // for every Market Analysis/Strategic Report, which have no Founder
  // Score field) picks up the first unrelated short number anywhere in the
  // text -- e.g. the "5" in "$5.9B" market size -- and displays it as a
  // fabricated score. Require an explicit "%"/"/100" suffix for that
  // unlabeled fallback so it can't misfire on an arbitrary figure.
  const match = labeled
    ? labeled.match(/\b(\d{1,3})\s*(?:%|\/\s*100)?\b/)
    : content.match(/\b(\d{1,3})\s*(?:%|\/\s*100)\b/);

  if (!match) {
    return null;
  }

  return Math.max(0, Math.min(100, Number(match[1])));
}

function formatScore(score: number | null, suffix = "%", isTurkish = false) {
  return score === null
    ? isTurkish
      ? "Hesaplama için yeterli veri yok"
      : "Insufficient data to calculate"
    : `${score}${suffix}`;
}

function readFounderScoreValue(investmentScore?: ReportInvestmentScore) {
  const founderScore = investmentScore?.decisionEngine?.founderScore?.score;

  return typeof founderScore === "number" ? Math.max(0, Math.min(100, Math.round(founderScore))) : null;
}

export function readFounderReadinessScoreValue(investmentScore?: ReportInvestmentScore) {
  return readFounderScoreValue(investmentScore);
}

function readFounderReasoningScore(investmentScore: ReportInvestmentScore | undefined, label: string) {
  const reasoning = investmentScore?.decisionEngine?.founderScore?.reasoning;

  if (!Array.isArray(reasoning)) {
    return null;
  }

  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^\\s*${escapedLabel}\\s*:\\s*(\\d{1,3})\\s*%?`, "i");

  for (const line of reasoning) {
    const match = typeof line === "string" ? line.match(pattern) : null;
    const score = match ? Number(match[1]) : NaN;

    if (Number.isFinite(score)) {
      return Math.max(0, Math.min(100, Math.round(score)));
    }
  }

  return null;
}

export function readFounderReadinessMetrics(investmentScore?: ReportInvestmentScore) {
  const marketAttractiveness = readFounderReasoningScore(investmentScore, "Market attractiveness");

  return {
    founderReadinessScore: readFounderReadinessScoreValue(investmentScore),
    ideaQuality: marketAttractiveness,
    marketAttractiveness,
    businessModelQuality: readFounderReasoningScore(investmentScore, "Business model quality"),
    validationConfidence: readFounderReasoningScore(investmentScore, "Validation confidence"),
    executionComplexity: readFounderReasoningScore(investmentScore, "Execution complexity"),
    evidenceConfidence: readFounderReasoningScore(investmentScore, "Evidence confidence"),
    founderEvidence: readFounderReasoningScore(investmentScore, "Founder evidence"),
  };
}

const FOUNDER_READINESS_TEXT_ALIASES: Record<string, string[]> = {
  "Founder Readiness Score": ["Founder Readiness Score", "Kurucu Hazırlık Skoru", "Overall Score", "Genel Skor"],
  "Idea Quality": ["Idea Quality", "Fikir Kalitesi"],
  "Market Attractiveness": ["Market Attractiveness", "Pazar Çekiciliği"],
  "Business Model Quality": ["Business Model Quality", "İş Modeli Kalitesi"],
  "Validation Confidence": ["Validation Confidence", "Doğrulama Güveni"],
  "Execution Complexity": ["Execution Complexity", "Yürütme Karmaşıklığı", "Uygulama Karmaşıklığı", "Execution Difficulty"],
  "Evidence Confidence": ["Evidence Confidence", "Kanıt Güveni"],
  "Founder Evidence": ["Founder Evidence", "Kurucu Kanıtı"],
};

function readFounderReadinessTextMetric(content: string | undefined, label: string) {
  if (!content) {
    return null;
  }

  for (const alias of FOUNDER_READINESS_TEXT_ALIASES[label] || [label]) {
    const escapedAlias = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Confirmed live (renewable-energy report): buildCanonicalFounderScore
    // always writes one dimension per line, but downstream text processing
    // (filler/duplicate-sentence stripping, cross-section dedup) can merge
    // adjacent dimensions onto a single run-on line with no "\n" between
    // them -- the same shape plan-executor.ts's own
    // extractFounderDimensionExplanation already has to handle. The
    // original anchor here (line-start only) silently failed to match any
    // dimension after the first in that shape, returning null and falling
    // through to the separately-computed investmentScore fallback below --
    // a DIFFERENT extraction path that reads the same underlying data but
    // is not guaranteed to agree number-for-number, producing exactly the
    // card/narrative mismatch this fix exists to close. A sentence-ending
    // boundary (". "/"! "/"? "/"; " followed by whitespace) is added as a
    // third valid anchor, so a mid-paragraph dimension label is found
    // directly from the text -- the single source of truth -- instead of
    // silently deferring to a second, independently-computed source.
    const match = content.match(
      new RegExp(
        `(?:^|\\n|[.!?;]\\s+)\\s*(?:[-*•]\\s*)?(?:\\*\\*)?${escapedAlias}(?:\\*\\*)?\\s*[:\\-–—]\\s*(\\d{1,3})\\s*(?:%|\\/\\s*100)?`,
        "i"
      )
    );
    const score = match ? Number(match[1]) : NaN;

    if (Number.isFinite(score)) {
      return Math.max(0, Math.min(100, Math.round(score)));
    }
  }

  return null;
}

export function readFounderReadinessMetricValue(
  label: string,
  investmentScore?: ReportInvestmentScore,
  content?: string
) {
  // Reproduces a real, confirmed production bug: this used to read
  // investmentScore.decisionEngine.founderScore FIRST (via
  // readFounderReadinessMetrics, an anchored per-array-item regex over
  // founder.reasoning) and only fell back to the report's own rendered
  // text when that lookup came up empty. The report's founderScore
  // section (buildCanonicalFounderScore in plan-executor.ts) is built
  // from that SAME founder.reasoning data but with a different, more
  // permissive extraction (a non-anchored search across the whole joined
  // reasoning string) and a different overall-score formula entirely (a
  // weighted average of the per-dimension scores, not the engine's own
  // top-level founderScore.score) -- so the two paths could, and did,
  // disagree on the exact same dimension for the exact same report. The
  // rendered text is the single, already-consistent, authoritative
  // source every other part of the report (and the reader) sees, so it
  // must win whenever it has a parseable value; investmentScore is now
  // only a defensive fallback for the rare case where no report text is
  // available at all (e.g. a still-loading preview).
  const textValue = readFounderReadinessTextMetric(content, label);

  if (textValue !== null) {
    return textValue;
  }

  const metrics = readFounderReadinessMetrics(investmentScore);
  const values: Record<string, number | null> = {
    "Founder Readiness Score": metrics.founderReadinessScore,
    "Idea Quality": metrics.ideaQuality,
    "Market Attractiveness": metrics.marketAttractiveness,
    "Business Model Quality": metrics.businessModelQuality,
    "Validation Confidence": metrics.validationConfidence,
    "Execution Complexity": metrics.executionComplexity,
    "Evidence Confidence": metrics.evidenceConfidence,
    "Founder Evidence": metrics.founderEvidence,
  };

  return values[label] ?? null;
}

export function normalizeFounderReadinessScoreText(
  content: string,
  founderReadinessScore?: number | null
) {
  if (typeof founderReadinessScore !== "number") {
    return content;
  }

  const canonicalScore = Math.max(0, Math.min(100, Math.round(founderReadinessScore)));
  let hasFounderReadinessLine = false;

  const lines = content.split("\n").flatMap((line) => {
    const match = line.match(
      /^(\s*(?:[-*•]\s*)?(?:\*\*)?)(Founder Readiness Score|Kurucu Hazırlık Skoru|Overall Score|Genel Skor)(?:\*\*)?\s*[:\-–—]\s*\d{1,3}\s*(?:%|\/\s*100)?(.*)$/i
    );

    if (!match) {
      return [line];
    }

    if (hasFounderReadinessLine) {
      return [];
    }

    hasFounderReadinessLine = true;
    const isTurkish = /Kurucu|Genel/i.test(match[2]) || isTurkishContent(content);
    const label = isTurkish ? "Kurucu Hazırlık Skoru" : "Founder Readiness Score";

    return [`${match[1]}${label}: ${canonicalScore}/100${match[3] || ""}`];
  });

  return lines.join("\n");
}

function extractQuality(content: string, labels: string[], fallback: string) {
  return extractLabelValue(content, labels) || fallback;
}

function normalizeFinancialQualityPresentation(value: string, isTurkish: boolean) {
  if (/\bhigh risk\b|yüksek risk/i.test(value)) {
    return isTurkish ? "Doğrulama Gerekli" : "Needs Validation";
  }

  return value;
}

function normalizeExecutiveRiskPresentation(value: string, isTurkish: boolean) {
  const normalized = stripMarkdown(value).replace(/\s+/g, " ").trim();

  if (
    /\b(?:Execution risk|Yürütme Riski):?\s*(?:Execution risk|Yürütme Riski)?\s*is healthier when payback/i.test(
      normalized
    ) ||
    /\bYürütme Riski improves when geri ödeme/i.test(normalized)
  ) {
    return isTurkish
      ? "Yürütme Riski, geri ödeme ve başabaş zamanlaması gerçekçi olduğunda, kanıt seviyesi güçlendiğinde ve operasyonel karmaşıklık azaldığında daha yönetilebilir hale gelir."
      : "Execution risk improves when payback and break-even timing are realistic, evidence is stronger, and operational complexity is lower.";
  }

  if (isTurkish) {
    return normalized
      .replace(/\bExecution risk\b/gi, "Yürütme Riski")
      .replace(/\bpayback\b/gi, "geri ödeme")
      .replace(/\bbreak-even timing\b/gi, "başabaş zamanlaması")
      .replace(/\bvalidation evidence\b/gi, "doğrulama kanıtı");
  }

  return normalized.replace(/\bExecution risk:\s*Execution risk\b/gi, "Execution risk");
}

export function getReportQualityBreakdown(
  reportQuality?: ReportQualityScore,
  isTurkish = false
): ReportQualityBreakdownItem[] {
  if (!reportQuality) {
    return [];
  }

  const labels = isTurkish
    ? {
        totalScore: "Genel Kalite Skoru",
        evidenceQuality: "Kanıt Kalitesi",
        sourceConfidence: "Kaynak Güveni",
        financialConsistency: "Finansal Tutarlılık",
        benchmarkFit: "Benchmark Uyumu",
        validationReadiness: "Doğrulama Hazırlığı",
      }
    : {
        totalScore: "Overall Quality Score",
        evidenceQuality: "Evidence Quality",
        sourceConfidence: "Source Confidence",
        financialConsistency: "Financial Consistency",
        benchmarkFit: "Benchmark Fit",
        validationReadiness: "Validation Readiness",
      };

  return [
    { label: labels.totalScore, value: `${reportQuality.totalScore}/100` },
    { label: labels.evidenceQuality, value: `${reportQuality.dimensions.evidenceQuality}/100` },
    { label: labels.sourceConfidence, value: `${reportQuality.dimensions.sourceConfidence}/100` },
    { label: labels.financialConsistency, value: `${reportQuality.dimensions.financialConsistency}/100` },
    { label: labels.benchmarkFit, value: `${reportQuality.dimensions.benchmarkFit}/100` },
    { label: labels.validationReadiness, value: `${reportQuality.dimensions.validationReadiness}/100` },
  ];
}

function inferRiskLevel(content: string, keywords: string[]): "Low" | "Medium" | "High" {
  const normalized = content.toLowerCase();
  const hasKeyword = keywords.some((keyword) => normalized.includes(keyword.toLowerCase()));

  if (!hasKeyword) {
    return "Low";
  }

  if (/\b(high|critical|major|unresolved|weak|low confidence|yüksek|kritik|zayıf|düşük güven)\b/i.test(normalized)) {
    return "High";
  }

  return "Medium";
}

function buildRiskHeatmap(content: string, isTurkish: boolean) {
  return [
    { label: isTurkish ? "Müşteri doğrulaması" : "Customer validation", keywords: ["customer validation", "müşteri doğrulama", "demand validation", "purchase intent"] },
    { label: isTurkish ? "Müşteri edinim maliyeti" : "CAC", keywords: ["cac", "customer acquisition", "edinim maliyeti"] },
    { label: isTurkish ? "Sermaye verimliliği" : "Capital efficiency", keywords: ["capital efficiency", "sermaye verimliliği", "funding", "yatırım ihtiyacı"] },
    { label: isTurkish ? "Rekabet" : "Competition", keywords: ["competition", "competitor", "rekabet", "rakip"] },
    { label: isTurkish ? "Uygulama" : "Execution", keywords: ["execution", "yürütme", "operational", "operasyon"] },
  ].map((item) => ({
    label: item.label,
    level: inferRiskLevel(content, item.keywords),
  }));
}

function buildConfidenceRadar(
  content: string,
  investmentScore: ReportInvestmentScore | undefined,
  isTurkish: boolean
) {
  // Each dimension first tries the report's own labeled text (the AI
  // occasionally writes a real per-dimension score inline); when that
  // isn't present, it now falls back to a genuinely distinct, independently
  // computed score from investmentScore.decisionEngine/categories --
  // never to one shared blended number. Confirmed live: every dimension
  // previously fell back to the SAME investmentScore.confidence value
  // whenever the AI's prose didn't happen to contain a literal
  // "Market Confidence:"/"Execution Readiness:"-style label (which none of
  // the generation prompts ever ask it to write), collapsing all five
  // boxes to one identical number (e.g. 54/54/54/54/54). A dimension with
  // no real, distinct signal available now shows null (rendered as
  // "Validation Required" by every caller) instead of a fabricated match.
  const dimensions = [
    {
      label: isTurkish ? "Pazar" : "Market",
      aliases: ["Market Confidence", "Market Readiness", "Pazar Güveni", "Pazar Hazırlığı"],
      score: investmentScore?.decisionEngine?.marketScore?.score,
    },
    {
      label: isTurkish ? "Finansal" : "Financial",
      aliases: ["Financial Confidence", "Financial Quality", "Finansal Güven", "Finansal Kalite"],
      score: investmentScore?.decisionEngine?.financialScore?.score,
    },
    {
      label: isTurkish ? "Uygulama" : "Execution",
      aliases: ["Execution Confidence", "Execution Readiness", "Yürütme Güveni", "Yürütme Hazırlığı"],
      score: investmentScore?.decisionEngine?.executionScore?.score,
    },
    {
      label: isTurkish ? "Ürün" : "Product",
      aliases: ["Product Confidence", "Product Readiness", "Ürün Güveni", "Ürün Hazırlığı"],
      score: investmentScore?.decisionEngine?.technologyScore?.score,
    },
    {
      label: isTurkish ? "Kanıt" : "Evidence",
      aliases: ["Competitive Evidence", "Evidence Confidence", "Evidence Strength", "Rekabet Kanıtı", "Kanıt Güveni", "Kanıt Gücü"],
      score: investmentScore?.decisionEngine?.competitionScore?.score,
    },
  ];

  return dimensions.map((dimension) => ({
    label: dimension.label,
    score: extractPercentScore(content, dimension.aliases) ?? dimension.score ?? null,
  }));
}

function collectBullets(content: string, keywords: string[], fallback: string[]) {
  const lines = normalizeReportPresentationText(content)
    .split("\n")
    .map((line) => line.replace(/^[-*•\d.)\s]+/, "").trim())
    .filter((line) => line.length > 18);

  const matches = lines.filter((line) =>
    keywords.some((keyword) => line.toLowerCase().includes(keyword.toLowerCase()))
  );
  const sentences = splitSentences(content).filter((sentence) =>
    keywords.some((keyword) => sentence.toLowerCase().includes(keyword.toLowerCase()))
  );

  return [...matches, ...sentences, ...fallback]
    .map((item) => stripMarkdown(item).replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((item, index, items) => items.findIndex((candidate) => candidate.toLowerCase() === item.toLowerCase()) === index)
    .slice(0, 3);
}

function localizeReportQualityLevel(value: string, isTurkish: boolean) {
  if (!isTurkish) {
    return value === "Moderate Confidence" ? "Medium Confidence" : value;
  }

  if (value === "High Confidence") return "Yüksek Güven";
  if (value === "Low Confidence") return "Düşük Güven";

  return "Orta Güven";
}

export function buildExecutiveSnapshot(
  content: string,
  investmentScore?: ReportInvestmentScore,
  reportQuality?: ReportQualityScore
): ExecutiveSnapshot {
  const normalized = normalizeReportPresentationText(content);
  const isTurkish = isTurkishContent(normalized);
  const confidenceScore =
    typeof investmentScore?.confidence === "number"
      ? investmentScore.confidence
      : extractPercentScore(normalized, [
          "Decision Confidence",
          "Confidence",
          "Karar Güveni",
          "Güven",
        ]);
  const founderScoreValue =
    readFounderScoreValue(investmentScore) ??
    extractPercentScore(normalized, [
      "AI Founder Score",
      "Founder Score",
      "Founder Readiness Score",
      "Kurucu Hazırlık Skoru",
      "AI Kurucu Skoru",
      "Kurucu Skoru",
    ]);
  const riskBullets = collectBullets(
    normalized,
    ["risk", "validation", "doğrulama", "uncertain", "belirsiz", "cac", "funding", "sermaye"],
    isTurkish
      ? ["Ana riskler doğrulama, müşteri edinimi ve sermaye verimliliği etrafında yoğunlaşır."]
      : ["The main risks sit around validation, acquisition, and capital efficiency."]
  );
  const actionBullets = collectBullets(
    normalized,
    ["next", "action", "validate", "doğrula", "test", "interview", "pilot", "roadmap", "yol haritası"],
    isTurkish
      ? ["Öncelik, kritik varsayımları küçük ve ölçülebilir deneylerle doğrulamaktır."]
      : ["The priority is to validate critical assumptions through small measurable tests."]
  );
  const normalizedRiskBullets = riskBullets.map((risk) =>
    normalizeExecutiveRiskPresentation(risk, isTurkish)
  );

  return {
    // Read the same deterministic "Decision: GO (Confidence: 72%)" line
    // the Executive Summary itself was rendered from (locale-agnostic --
    // matches Turkish/German/French/Spanish reports too), before ever
    // falling back to the raw engine value. investmentScore.recommendation
    // is a different, 3-state vocabulary ("GO"/"WAIT"/"PASS") than the
    // Executive Summary's own "GO"/"CONDITIONAL GO"/"NO GO" verdict --
    // reading it first previously let the cover page show "WAIT" next to
    // an Executive Summary that said "CONDITIONAL GO" for the same report.
    decision: polishTurkishUserFacingOutput(
      extractExecutiveDecisionFromText(content)?.token.toUpperCase() ||
        investmentScore?.recommendation ||
        extractDecision(normalized, isTurkish)
    ),
    confidence:
      typeof investmentScore?.confidence === "number"
        ? `${investmentScore.confidence}%`
        : extractConfidenceValue(normalized, isTurkish),
    confidenceScore,
    founderScore: formatScore(founderScoreValue, "/100", isTurkish),
    founderScoreValue,
    financialQuality: normalizeFinancialQualityPresentation(
      extractQuality(
        normalized,
        ["Financial Quality", "Financial Quality:", "Finansal Kalite"],
        isTurkish ? "Doğrulama Gerekli" : "Validation Required"
      ),
      isTurkish
    ),
    reportQuality: reportQuality
      ? localizeReportQualityLevel(reportQuality.confidenceLevel || reportQuality.overallQuality || "Medium Confidence", isTurkish)
      : extractQuality(
          normalized,
          ["Overall Report Quality", "Report Quality", "Rapor Kalitesi", "Genel Rapor Kalitesi"],
          isTurkish ? "Orta Güven" : "Moderate Confidence"
        ),
    mainRisk: normalizeExecutiveRiskPresentation(
      investmentScore?.topRisks?.[0] || normalizedRiskBullets[0],
      isTurkish
    ),
    nextAction: investmentScore?.nextCriticalAction || actionBullets[0],
    riskLevel: inferRiskLevel(normalized, ["risk", "validation", "cac", "funding", "execution", "rekabet", "sermaye"]),
    riskHeatmap: buildRiskHeatmap(normalized, isTurkish),
    confidenceRadar: buildConfidenceRadar(normalized, investmentScore, isTurkish),
    why: collectBullets(
      normalized,
      ["market", "pazar", "opportunity", "fırsat", "model", "margin", "marj", "revenue", "gelir"],
      isTurkish
        ? ["Fırsatın çekiciliği, pazar sinyalleri ve iş modeli varsayımlarına bağlıdır."]
        : ["The opportunity depends on market signals and business model assumptions."]
    ),
    risks: normalizedRiskBullets,
    actions: actionBullets,
  };
}

export function getSectionTakeaway(content: string) {
  const [firstSentence] = splitSentences(normalizeReportPresentationText(content));

  if (!firstSentence) {
    return "";
  }

  return firstSentence.length > 220 ? `${firstSentence.slice(0, 217).trim()}...` : firstSentence;
}

export function isExecutivePresentationSection(section: { field?: string; title: string }) {
  const field = section.field?.toLowerCase() || "";
  const title = section.title.toLowerCase();

  return (
    field === "executivesummary" ||
    field === "executiverecommendation" ||
    title.includes("executive summary") ||
    title.includes("executive recommendation") ||
    title.includes("yönetici özeti") ||
    title.includes("yönetici tavsiyesi")
  );
}

export function compactExecutiveDecisionMemoSections<T extends { field?: string; title: string; content: string }>(
  sections: T[]
) {
  const memoSections = sections.filter((section) => {
    const field = section.field?.toLowerCase() || "";
    const title = section.title.toLowerCase();

    return (
      field === "executiverecommendation" ||
      field === "decisionconfidence" ||
      field === "reportintelligence" ||
      field === "aiconfidencebreakdown" ||
      field === "founderdecisionengine" ||
      title.includes("executive recommendation") ||
      title.includes("yönetici tavsiyesi") ||
      title.includes("ai karar güveni") ||
      title.includes("decision confidence") ||
      title.includes("report intelligence") ||
      title.includes("rapor zekası") ||
      title.includes("ai confidence breakdown") ||
      title.includes("ai güven dağılımı") ||
      title.includes("founder decision engine") ||
      title.includes("kurucu karar motoru")
    );
  });

  if (memoSections.length <= 1) {
    return sections;
  }

  const memoIds = new Set(memoSections);
  const firstMemoIndex = sections.findIndex((section) => memoIds.has(section));

  return sections.flatMap((section, index) => {
    if (!memoIds.has(section)) {
      return [section];
    }

    if (index !== firstMemoIndex) {
      return [];
    }

    return [
      {
        ...section,
        field: "executiveDecisionMemo",
        title: "Executive Decision Memo",
        content: normalizeReportPresentationText(
          memoSections
            .map((memoSection) => `${memoSection.title}\n${memoSection.content}`)
            .join("\n\n")
        ),
      },
    ];
  });
}
