import type { ReportInvestmentScore } from "@/app/lib/report-investment-score";

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

function isTurkishContent(content: string) {
  return /[çğıöşüÇĞİÖŞÜ]|\b(?:Karar|Güven|Yönetici|Pazar|Finansal|Kurucu|Kaynaklar|Doğrulama)\b/i.test(
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
  let normalized = removeDuplicateLines(
    removeAdjacentDuplicateWords(normalizeExecutiveInsightLabels(content))
  )
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (isTurkishContent(normalized)) {
    for (const [pattern, replacement] of TURKISH_REPLACEMENTS) {
      normalized = normalized.replace(pattern, replacement);
    }
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

function extractDecision(content: string) {
  const labeled = extractLabelValue(content, [
    "Decision",
    "Karar",
    "Recommendation",
    "Tavsiye",
    "Final decision",
    "Nihai karar",
  ]);
  const decisionMatch = (labeled || content).match(/\b(GO|WAIT|NO-GO|NO GO|HOLD|VALIDATE|PASS|REJECT)\b/i);

  if (!decisionMatch) {
    return labeled || "WAIT";
  }

  const value = decisionMatch[1].toUpperCase().replace("NO GO", "NO-GO");
  if (value === "HOLD" || value === "VALIDATE") {
    return "WAIT";
  }
  if (value === "PASS") {
    return "GO";
  }
  if (value === "REJECT") {
    return "NO-GO";
  }

  return value;
}

function extractConfidenceValue(content: string) {
  const labeled = extractLabelValue(content, [
    "Decision Confidence",
    "Confidence",
    "Karar Güveni",
    "Güven",
  ]);
  const match = (labeled || content).match(/\b(\d{1,3})\s*%/);

  return match ? `${Math.min(100, Number(match[1]))}%` : labeled || "Validation Required";
}

function extractPercentScore(content: string, labels: string[]) {
  const labeled = extractLabelValue(content, labels);
  const match = (labeled || content).match(/\b(\d{1,3})\s*(?:%|\/\s*100)?\b/);

  if (!match) {
    return null;
  }

  return Math.max(0, Math.min(100, Number(match[1])));
}

function formatScore(score: number | null, suffix = "%") {
  return score === null ? "Validation Required" : `${score}${suffix}`;
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
    const match = content.match(
      new RegExp(
        `(?:^|\\n)\\s*(?:[-*•]\\s*)?(?:\\*\\*)?${escapedAlias}(?:\\*\\*)?\\s*[:\\-–—]\\s*(\\d{1,3})\\s*(?:%|\\/\\s*100)?`,
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

  return values[label] ?? readFounderReadinessTextMetric(content, label);
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

function buildRiskHeatmap(content: string) {
  return [
    { label: "Customer validation", keywords: ["customer validation", "müşteri doğrulama", "demand validation", "purchase intent"] },
    { label: "CAC", keywords: ["cac", "customer acquisition", "edinim maliyeti"] },
    { label: "Capital efficiency", keywords: ["capital efficiency", "sermaye verimliliği", "funding", "yatırım ihtiyacı"] },
    { label: "Competition", keywords: ["competition", "competitor", "rekabet", "rakip"] },
    { label: "Execution", keywords: ["execution", "yürütme", "operational", "operasyon"] },
  ].map((item) => ({
    label: item.label,
    level: inferRiskLevel(content, item.keywords),
  }));
}

function buildConfidenceRadar(content: string, fallbackScore: number | null) {
  const dimensions = [
    { label: "Market", aliases: ["Market Confidence", "Market Readiness", "Pazar Güveni", "Pazar Hazırlığı"] },
    { label: "Financial", aliases: ["Financial Confidence", "Financial Quality", "Finansal Güven", "Finansal Kalite"] },
    { label: "Execution", aliases: ["Execution Confidence", "Execution Readiness", "Yürütme Güveni", "Yürütme Hazırlığı"] },
    { label: "Product", aliases: ["Product Confidence", "Product Readiness", "Ürün Güveni", "Ürün Hazırlığı"] },
    { label: "Evidence", aliases: ["Evidence Confidence", "Evidence Strength", "Kanıt Güveni", "Kanıt Gücü"] },
  ];

  return dimensions.map((dimension) => ({
    label: dimension.label,
    score: extractPercentScore(content, dimension.aliases) ?? fallbackScore,
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

export function buildExecutiveSnapshot(
  content: string,
  investmentScore?: ReportInvestmentScore
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

  return {
    decision: investmentScore?.recommendation || extractDecision(normalized),
    confidence:
      typeof investmentScore?.confidence === "number"
        ? `${investmentScore.confidence}%`
        : extractConfidenceValue(normalized),
    confidenceScore,
    founderScore: formatScore(founderScoreValue, "/100"),
    founderScoreValue,
    financialQuality: normalizeFinancialQualityPresentation(
      extractQuality(
        normalized,
        ["Financial Quality", "Financial Quality:", "Finansal Kalite"],
        isTurkish ? "Doğrulama Gerekli" : "Validation Required"
      ),
      isTurkish
    ),
    reportQuality: extractQuality(
      normalized,
      ["Overall Report Quality", "Report Quality", "Rapor Kalitesi", "Genel Rapor Kalitesi"],
      isTurkish ? "Orta Güven" : "Moderate Confidence"
    ),
    mainRisk: investmentScore?.topRisks?.[0] || riskBullets[0],
    nextAction: investmentScore?.nextCriticalAction || actionBullets[0],
    riskLevel: inferRiskLevel(normalized, ["risk", "validation", "cac", "funding", "execution", "rekabet", "sermaye"]),
    riskHeatmap: buildRiskHeatmap(normalized),
    confidenceRadar: buildConfidenceRadar(normalized, confidenceScore),
    why: collectBullets(
      normalized,
      ["market", "pazar", "opportunity", "fırsat", "model", "margin", "marj", "revenue", "gelir"],
      isTurkish
        ? ["Fırsatın çekiciliği, pazar sinyalleri ve iş modeli varsayımlarına bağlıdır."]
        : ["The opportunity depends on market signals and business model assumptions."]
    ),
    risks: riskBullets,
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
