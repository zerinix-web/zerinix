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

// Sentence-boundary splitting must not treat a period inside a common
// abbreviation as an end-of-sentence marker -- confirmed live: content like
// "Evidence-supported major players relevant to the U.S. legal AI software
// market include Thomson Reuters/CoCounsel..." was being cut right after
// "U.S." because the split regex has no abbreviation awareness, silently
// truncating the takeaway (and, transitively, the PDF Key Takeaway box) to
// a fragment ending mid-thought. Protect known abbreviations' periods with
// a sentinel before splitting, then restore them afterward.
const SENTENCE_ABBREVIATIONS = [
  "U.S.", "U.K.", "U.N.", "E.U.", "U.A.E.",
  "e.g.", "i.e.", "etc.", "vs.", "cf.",
  "Inc.", "Corp.", "Ltd.", "Co.", "LLC.",
  "Dr.", "Mr.", "Mrs.", "Ms.", "Jr.", "Sr.", "St.", "Prof.", "Ph.D.",
  "a.m.", "p.m.", "No.", "approx.",
];

function protectSentenceAbbreviations(value: string) {
  return SENTENCE_ABBREVIATIONS.reduce((acc, abbreviation) => {
    const escaped = abbreviation.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return acc.replace(new RegExp(escaped, "g"), abbreviation.replace(/\./g, "\u0000"));
  }, value);
}

function restoreSentenceAbbreviations(value: string) {
  return value.replace(/\u0000/g, ".");
}

// P0 PRODUCTION FIX -- confirmed live (Market Intelligence production
// consistency hardening): the `(?:\n|\r)+` alternative below looks like
// it splits on real line breaks, but it is dead code -- stripMarkdown
// (called first, on the WHOLE string) already collapses every newline
// into a single space via its own `\s+` -> " " pass, so by the time the
// split regex runs, no `\n`/`\r` characters survive anywhere in the
// string for that alternative to ever match. The practical effect:
// a bulleted/numbered list with no terminal punctuation ending EACH
// item before the list's own last period ("- CBRE (Market Leader):
// Global scale...\n- JLL (Established Challenger): Broad advisory...")
// gets treated as ONE continuous run-on "sentence" spanning every list
// item, since the only real sentence-boundary left to split on is
// whichever period happens to occur latest in the whole flattened
// string. getSectionTakeaway then extracts that entire multi-item blob
// as "the takeaway" -- which duplicates the ENTIRE section's content in
// the highlighted box, with the (unchanged) body repeating it all again
// below. Splitting on real newlines FIRST -- before stripMarkdown ever
// runs -- then sentence-splitting WITHIN each resulting line
// independently, guarantees a bulleted/numbered item can never be fused
// with a neighboring line, matching how a reader actually perceives list
// structure.
function splitSentences(content: string) {
  return content
    .split(/\r?\n/)
    .flatMap((line) => protectSentenceAbbreviations(stripMarkdown(line)).split(/(?<=[.!?])\s+/))
    .map((sentence) => restoreSentenceAbbreviations(sentence).trim())
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
    "Executive recommendation",
    "Yönetici tavsiyesi",
  ]);

  // CRITICAL FIX -- Acquisition Due Diligence reports state their own
  // three-tier executive call (Proceed with Conditions / Pause Pending
  // Review / Reject) instead of the Business Plan GO/WAIT/NO-GO
  // vocabulary the scan below recognizes. Confirmed live: neither
  // "Proceed" nor "Pause" matches any keyword below, so every acquisition
  // report fell through to the hardcoded "WAIT" default regardless of
  // what its own Final Investment Recommendation actually said -- exactly
  // the "overly conservative generic signal" this fix removes. Checked
  // first (the two multi-word phrases are distinctive enough to scan the
  // whole content safely, unlike a bare "Proceed"/"Pause" which could be
  // an ordinary English word elsewhere in the report) and returned
  // verbatim, never collapsed into WAIT.
  const acquisitionMatch =
    (labeled && labeled.match(/\b(Proceed with Conditions|Pause Pending Review)\b/i)) ||
    content.match(/\b(Proceed with Conditions|Pause Pending Review)\b/i);

  if (acquisitionMatch) {
    return acquisitionMatch[1].toLowerCase() === "proceed with conditions"
      ? isTurkish
        ? "KOŞULLU İLERLE"
        : "PROCEED WITH CONDITIONS"
      : isTurkish
        ? "İNCELEME BEKLİYOR"
        : "PAUSE PENDING REVIEW";
  }

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
    // Shown verbatim, matching the acquisition report's own vocabulary
    // (Proceed with Conditions / Pause Pending Review / Reject), rather
    // than collapsed into the Business Plan "NO-GO" token -- the model's
    // own stated word is more transparent than a forced remap.
    return isTurkish ? "REDDET" : "REJECT";
  }

  return value;
}

// CRITICAL FIX -- upgrade Executive Decision Center output. Confirmed
// live: an unlabeled confidence scan against the *entire* report (any
// report with real dollar-denominated deal facts -- financing splits,
// EV/ARR-adjacent percentages -- has several legitimate, unrelated "N%"
// figures in it) was picking up the first bare percentage anywhere in the
// document and displaying it as "the" confidence score, regardless of
// whether it had anything to do with confidence at all -- e.g. a 5%
// figure from an unrelated sentence rendered as "Confidence: 5%" next to
// a report that never stated a confidence level. Requiring the match to
// sit within a short window of the word "confidence" itself (covering the
// common "Decision: GO (Confidence: 72%)" mid-line shape) keeps every
// genuine confidence figure working exactly as before while refusing to
// fabricate one from an unrelated percentage.
function findNearbyLabeledPercent(content: string, labels: string[]) {
  const labelAlternation = labels
    .map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const match = content.match(
    new RegExp(`\\b(?:${labelAlternation})\\b[^%\\n]{0,20}?(\\d{1,3})\\s*%`, "i")
  );

  return match ? Math.max(0, Math.min(100, Number(match[1]))) : null;
}

// Domain-neutral proxy for "available inputs / missing inputs / analysis
// completeness" (the exact three signals the Confidence Score and
// Financial Quality cards are meant to reflect): counts concrete
// dollar-denominated figures already stated in the report against
// explicit gap phrases ("not yet verified", "still pending", etc.) --
// never a new financial calculation, purely a presence/absence read of
// text the report already contains.
function assessInputCompleteness(content: string): "high" | "moderate" | "limited" {
  const concreteFigureCount = (
    content.match(/\$\d[\d,.]*\s*(?:k|m|bn|thousand|million|billion)?\b/gi) || []
  ).length;
  const gapPhraseCount = (
    content.match(
      /\b(?:not yet verified|not yet provided|not yet available|still (?:missing|pending|needed|awaiting)|cannot be (?:determined|calculated|fully determined)|has not been verified)\b/gi
    ) || []
  ).length;

  if (concreteFigureCount >= 3 && gapPhraseCount <= 2) {
    return "high";
  }
  if (concreteFigureCount >= 1) {
    return "moderate";
  }

  return "limited";
}

function buildConfidenceCompletenessFallback(content: string, isTurkish: boolean) {
  const completeness = assessInputCompleteness(content);

  if (completeness === "high") {
    return isTurkish
      ? "Orta-Yüksek -- temel rakamlar mevcut, tam doğrulama sürüyor"
      : "Moderate-to-High -- key figures are available, full verification is still in progress";
  }
  if (completeness === "moderate") {
    return isTurkish
      ? "Mevcut işlem girdilerine dayalı orta düzey güven; ek mali ve elde tutma verileri gereklidir."
      : "Moderate confidence based on available transaction inputs; additional financial and retention data required.";
  }

  return isTurkish
    ? "Erken Aşama -- temel girdiler henüz sağlanmadı"
    : "Early-Stage -- core inputs have not yet been provided";
}

// CRITICAL FIX -- upgrade Executive Decision Center output. "Validation
// Required" was a blanket default for every report whose text never
// literally contains a "Financial Quality:" labeled line (true of every
// Acquisition Due Diligence report, which has no such field) -- the same
// completeness signal used for the Confidence Score fallback above gives
// a genuinely useful executive read instead of one static, generic phrase
// for every report regardless of how much financial detail it actually
// contains.
function buildFinancialQualityFallback(content: string, isTurkish: boolean) {
  const completeness = assessInputCompleteness(content);

  if (completeness === "high") {
    return isTurkish
      ? "Ön Değerlendirme -- Tam Denetim Sürüyor"
      : "Preliminary -- Full Audit In Progress";
  }
  if (completeness === "moderate") {
    return isTurkish
      ? "Kısmi -- Ek Mali Bilgi Gerekli"
      : "Partial -- Additional Financials Needed";
  }

  return isTurkish
    ? "Erken Aşama -- Mali Tablolar Bekleniyor"
    : "Early-Stage -- Financial Statements Pending";
}

function extractConfidenceValue(content: string, isTurkish = false) {
  const labels = ["Decision Confidence", "Confidence", "Karar Güveni", "Güven"];
  const labeled = extractLabelValue(content, labels);
  const labeledMatch = labeled.match(/\b(\d{1,3})\s*%/);

  if (labeledMatch) {
    return `${Math.min(100, Number(labeledMatch[1]))}%`;
  }

  const nearbyScore = findNearbyLabeledPercent(content, labels);
  if (nearbyScore !== null) {
    return `${nearbyScore}%`;
  }

  return labeled || buildConfidenceCompletenessFallback(content, isTurkish);
}

function extractPercentScore(
  content: string,
  labels: string[],
  options: { requireNearbyLabelWord?: boolean } = {}
) {
  const labeled = extractLabelValue(content, labels);

  if (labeled) {
    const match = labeled.match(/\b(\d{1,3})\s*(?:%|\/\s*100)?\b/);
    return match ? Math.max(0, Math.min(100, Number(match[1]))) : null;
  }

  if (options.requireNearbyLabelWord) {
    return findNearbyLabeledPercent(content, labels);
  }

  // A bare number is only safe to trust within the labeled span itself
  // (e.g. "Founder Score: 72" with no "%"). Falling back to the same bare
  // match against the *entire* report when no label is found at all (true
  // for every Market Analysis/Strategic Report, which have no Founder
  // Score field) picks up the first unrelated short number anywhere in the
  // text -- e.g. the "5" in "$5.9B" market size -- and displays it as a
  // fabricated score. Require an explicit "%"/"/100" suffix for that
  // unlabeled fallback so it can't misfire on an arbitrary figure.
  const match = content.match(/\b(\d{1,3})\s*(?:%|\/\s*100)\b/);

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

  // CRITICAL FIX -- remove internal system language from user-facing
  // Business Plan output. "Evidence Quality"/"Source Confidence" (and
  // this label's own prior replacements, "Analysis Rigor"/"Data
  // Reliability") all still read as an internal audit-tool's own
  // scoring dimensions, not something a board-level report would label
  // a metric card. Replaced with the natural executive equivalent of
  // what each dimension actually measures: how complete the underlying
  // data is, and how much confidence the plan as a whole supports given
  // what has and hasn't been validated.
  const labels = isTurkish
    ? {
        totalScore: "Genel Kalite Skoru",
        evidenceQuality: "Veri Bütünlüğü",
        sourceConfidence: "Planlama Güveni",
        financialConsistency: "Finansal Tutarlılık",
        benchmarkFit: "Benchmark Uyumu",
        validationReadiness: "Doğrulama Hazırlığı",
      }
    : {
        totalScore: "Overall Quality Score",
        evidenceQuality: "Data Completeness",
        sourceConfidence: "Planning Confidence",
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

// CRITICAL FIX -- upgrade Executive Decision Center output. Confirmed
// live: plain substring .includes() let the "action" keyword match
// inside the word "Transaction" -- so an Acquisition Due Diligence
// report's very first paragraph ("Transaction overview: ...") always
// won the Next Action slot ahead of any real action-shaped sentence
// later in the report, regardless of keyword relevance. Unicode-aware
// word-boundary matching (via lookaround, so it works for Turkish
// letters too, unlike ASCII \b) fixes this generically for every report
// type and every keyword, not just this one collision -- a keyword can
// still match as part of a longer PHRASE ("further review is
// recommended"), just never as a fragment inside an unrelated word.
function containsKeyword(text: string, keyword: string): boolean {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "iu").test(text);
}

function collectBullets(content: string, keywords: string[], fallback: string[]) {
  const lines = normalizeReportPresentationText(content)
    .split("\n")
    .map((line) => line.replace(/^[-*•\d.)\s]+/, "").trim())
    .filter((line) => line.length > 18);

  const matches = lines.filter((line) =>
    keywords.some((keyword) => containsKeyword(line, keyword))
  );
  const sentences = splitSentences(content).filter((sentence) =>
    keywords.some((keyword) => containsKeyword(sentence, keyword))
  );

  return [...matches, ...sentences, ...fallback]
    .map((item) => stripMarkdown(item).replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((item, index, items) => items.findIndex((candidate) => candidate.toLowerCase() === item.toLowerCase()) === index)
    .slice(0, 3);
}

// CRITICAL FIX -- "Low Confidence" reads as a bare internal-scoring
// verdict, not something a board-level report would say. Replaced with
// executive language that names what the reader should actually do next
// -- validate the report's key assumptions -- rather than a flat rating
// with no action attached. "High"/"Moderate/Medium Confidence" are left
// unchanged; they were not flagged as internal-sounding.
function localizeReportQualityLevel(value: string, isTurkish: boolean) {
  if (!isTurkish) {
    if (value === "Moderate Confidence") return "Medium Confidence";
    if (value === "Low Confidence") return "Preliminary -- Key Assumptions Need Validation";
    return value;
  }

  if (value === "High Confidence") return "Yüksek Güven";
  if (value === "Low Confidence") return "Ön Değerlendirme -- Temel Varsayımlar Doğrulanmalı";

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
      : extractPercentScore(
          normalized,
          ["Decision Confidence", "Confidence", "Karar Güveni", "Güven"],
          { requireNearbyLabelWord: true }
        );
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
    // CRITICAL FIX -- upgrade Executive Decision Center output. The
    // original keyword set was Business-Plan-shaped (validation/CAC/
    // funding) and recognized none of an acquisition report's own risk
    // vocabulary, so Main Risk always fell through to a generic
    // startup-flavored fallback for every acquisition report regardless
    // of what its real Integration Risks/Deal Risks sections said.
    // Additive only -- every keyword already recognized keeps matching
    // exactly as before for every other report type.
    [
      "risk", "validation", "doğrulama", "uncertain", "belirsiz", "cac", "funding", "sermaye",
      "integration", "entegrasyon", "leverage", "kaldıraç", "retention risk", "elde tutma riski",
      "financial verification", "mali doğrulama", "security architecture", "güvenlik mimarisi",
      "customer concentration", "müşteri yoğunlaşması",
    ],
    isTurkish
      ? ["Ana riskler doğrulama, müşteri edinimi ve sermaye verimliliği etrafında yoğunlaşır."]
      : ["The main risks sit around validation, acquisition, and capital efficiency."]
  );
  const actionBullets = collectBullets(
    normalized,
    // Same fix, for Next Action: the original keywords were startup-
    // validation language ("validate", "test", "pilot") that never
    // matches an acquisition report's own due-diligence action phrasing
    // ("Further review is recommended for...", "Management should
    // validate... before...", "...before closing"). Additive only.
    [
      "next", "action", "validate", "doğrula", "test", "interview", "pilot", "roadmap", "yol haritası",
      "further review is recommended", "further review", "management should validate",
      "management should review", "before final approval", "security assessment",
      "güvenlik değerlendirmesi",
    ],
    isTurkish
      ? ["Öncelik, kritik varsayımları küçük ve ölçülebilir deneylerle doğrulamaktır."]
      : ["The priority is to validate critical assumptions through small measurable tests."]
  );
  const normalizedRiskBullets = riskBullets.map((risk) =>
    normalizeExecutiveRiskPresentation(risk, isTurkish)
  );
  // Acquisition Due Diligence's Executive Summary always ends with a
  // labeled "Conditions before closing" part naming the specific items
  // still to review -- a far more reliable Next Action than a keyword
  // scan across the whole summary, which can just as easily land on an
  // earlier, less specific "management should validate..." aside inside
  // the Main opportunity paragraph.
  const conditionsBeforeClosing = extractLabelValue(normalized, [
    "Conditions before closing",
    "Kapanıştan önce koşullar",
  ]);

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
        buildFinancialQualityFallback(normalized, isTurkish)
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
    nextAction: investmentScore?.nextCriticalAction || conditionsBeforeClosing || actionBullets[0],
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

// P0 FIX #8 -- confirmed live (Key Takeaway / body duplication repair):
// page.tsx's Key-Takeaway-card fields already avoid restating the takeaway
// in the body via extractSectionMainExplanation (index-based sentence
// skip, robust to getSectionTakeaway's own separate normalization) -- but
// ReportPdfButton.tsx never had an equivalent: its "Key Takeaway box above
// + full body prose below" design (deliberately never shortening the
// report) drew the SAME leading sentence/bulleted item twice, once in the
// highlighted box and once as the first line of the body. This is the ONE
// canonical function both the PDF and any future caller use to remove
// JUST that duplicate -- never a section-specific hardcoded string, never
// a blanket truncation. Extremely conservative by design: it only ever
// touches the FIRST non-empty line of `content`, and only removes
// anything at all when that line's own text (normalized the exact same
// way getSectionTakeaway itself normalizes) genuinely matches `takeaway`;
// any uncertainty (no takeaway, no sentence boundary found, no match)
// returns `content` completely unchanged. Two shapes are handled
// distinctly:
//   - A bulleted/numbered first line ("1) Integration-first add-on
//     products...", the exact reported production shape) is an
//     indivisible whole item -- if it duplicates the takeaway, the ENTIRE
//     line is removed, never a partial cut that would leave a dangling
//     "1)" marker with no text after it.
//   - Flowing prose removes only the FIRST SENTENCE of the first line,
//     using the same abbreviation-protected sentence boundary
//     splitSentences relies on (protectSentenceAbbreviations/
//     restoreSentenceAbbreviations below), so "U.S."/"Inc."/etc. can never
//     be mistaken for a sentence end -- every other sentence, every later
//     line, every bullet further down, and all formatting survive
//     completely untouched.
export function stripLeadingTakeawaySentence(content: string, takeaway: string): string {
  const raw = content || "";
  // getSectionTakeaway extracts the takeaway from whatever the first
  // sentence literally is -- when the first line is bulleted/numbered
  // ("1) Integration-first add-on products...", the exact reported
  // production shape), the takeaway text keeps that marker verbatim. The
  // bullet branch below compares against the first line with its OWN
  // marker already stripped, so the takeaway's marker must be stripped
  // here too, or an identical line is never recognized as a duplicate.
  const normalizedTakeaway = takeaway
    .replace(/\.{3}$/, "")
    .trim()
    .replace(/^(?:[-*•]|\d+[.)])\s+/, "")
    .toLocaleLowerCase();
  if (!normalizedTakeaway || !raw.trim()) {
    return raw;
  }

  // P0 PRODUCTION FIX -- confirmed live (Market Intelligence research-
  // quality failure): takeaway comes from getSectionTakeaway, which
  // strips markdown (including "**" bold markers) via its own internal
  // stripMarkdown call before this function ever sees it. Candidate
  // text here was normalized only by normalizeReportPresentationText,
  // which does NOT strip markdown -- so a bold-led lead sentence
  // ("**Integration-first bundling:** Vendors are bundling...") kept
  // its "**" on the candidate side while the takeaway had none,
  // guaranteeing a mismatch and silently preserving the exact
  // duplicate this function exists to remove. stripMarkdown is applied
  // to the candidate here so both sides are normalized the same way,
  // regardless of which markdown the model happened to use.
  const isDuplicateOfTakeaway = (candidate: string) => {
    const normalizedCandidate = stripMarkdown(normalizeReportPresentationText(candidate))
      .trim()
      .toLocaleLowerCase();
    if (!normalizedCandidate) return false;
    return (
      normalizedCandidate === normalizedTakeaway ||
      (normalizedTakeaway.length > 40 && normalizedCandidate.startsWith(normalizedTakeaway))
    );
  };

  const lines = raw.split("\n");
  const firstContentIndex = lines.findIndex((line) => line.trim().length > 0);
  if (firstContentIndex === -1) {
    return raw;
  }

  const trimmedFirstLine = lines[firstContentIndex].trim();
  const bulletMarkerMatch = trimmedFirstLine.match(/^(?:[-*•]|\d+[.)])\s+/);
  const marker = bulletMarkerMatch ? bulletMarkerMatch[0] : "";
  const bodyAfterMarker = bulletMarkerMatch ? trimmedFirstLine.slice(marker.length) : trimmedFirstLine;
  // A sentence-ending mark is often immediately followed by a markdown
  // bold/italic closer before the actual whitespace ("**Regulatory
  // tailwinds.**" -- the period sits right before "**", not a space) --
  // the closer is included in the matched boundary itself (never just
  // the bare punctuation) so a cut here never leaves a dangling,
  // unclosed "**"/"_" behind in the preserved text on either side.
  const sentenceBoundaryPattern = /[.!?](?:\*\*|__|\*|_)?(?=\s|$)/;
  const hasOwnSentenceBoundary = sentenceBoundaryPattern.test(protectSentenceAbbreviations(bodyAfterMarker));

  // P0 PRODUCTION FIX -- confirmed live (Market Intelligence production
  // consistency hardening): getSectionTakeaway's own sentence source
  // (splitSentences) filters out any sentence of length <= 24 after
  // markdown-stripping -- a short, punchy opening verdict the report's
  // own style guidance explicitly instructs the model to write first
  // ("Open the section with that answer in the first sentence",
  // report-quality-directives.ts) is routinely exactly this short. That
  // means the takeaway can legitimately be the SECOND (or later) real
  // sentence, still sitting on the very same first physical line/bullet
  // ("1. **Regulatory tailwinds.** Rising demand for compliance
  // automation..." -- "Regulatory tailwinds." is 21 characters, filtered
  // out; the takeaway is "Rising demand..."). Every prior version of
  // this function only ever tested ONE candidate span (the whole
  // bulleted line, or the line's first sentence) against the takeaway,
  // so it could never recognize this case and silently left the real
  // duplicate untouched. Scanning every successive sentence boundary
  // within the search window (not just the first) and removing
  // whichever one actually matches -- while preserving every sentence
  // before and after it -- is what makes this generic: it no longer
  // matters WHICH sentence position getSectionTakeaway happened to pick.
  //
  // The search window is the first line's own content, extended by
  // exactly one following non-empty, non-bulleted line ONLY when that
  // first line has no sentence boundary of its own at all (a bare label
  // like "**Answer:**") -- mirrors the earlier "label line + continuation"
  // fix. A bulleted line is never extended past its own line: the next
  // line begins its own separate list item.
  let windowLines = [bodyAfterMarker];
  let secondConsumedIndex = -1;
  if (!marker && !hasOwnSentenceBoundary) {
    const nextContentIndex = lines.findIndex(
      (line, index) => index > firstContentIndex && line.trim().length > 0
    );
    if (nextContentIndex !== -1 && !/^(?:[-*•]|\d+[.)])\s+/.test(lines[nextContentIndex].trim())) {
      windowLines = [bodyAfterMarker, lines[nextContentIndex].trim()];
      secondConsumedIndex = nextContentIndex;
    }
  }

  const windowText = windowLines.join(" ");
  const protectedWindow = protectSentenceAbbreviations(windowText);
  const boundaryRegex = new RegExp(sentenceBoundaryPattern, "g");
  const boundaries: number[] = [];
  let boundaryMatch: RegExpExecArray | null;
  while ((boundaryMatch = boundaryRegex.exec(protectedWindow))) {
    boundaries.push(boundaryMatch.index + boundaryMatch[0].length);
  }

  // P0 PRODUCTION FIX -- confirmed live (Market Intelligence production
  // consistency hardening): when the window was extended to a second
  // line (the "bare label + continuation" case), the two lines are
  // joined into one string before boundary-scanning -- but if the FIRST
  // line has no punctuation of its own ("**Answer:**"), there is no
  // boundary separating it from the second line's text, so the whole
  // joined blob was tested as ONE candidate. getSectionTakeaway, by
  // contrast, now sentence-splits per LINE first (see splitSentences'
  // own fix), so it never fuses these two lines together at all -- it
  // simply drops the short first line as too-short-to-count and returns
  // the second line's own sentence as the takeaway, with no "Answer:"
  // prefix. Without a matching boundary at the line join, this
  // function's candidate ("Answer: Vendors are bundling...") could
  // never equal or start-with the takeaway's own text ("Vendors are
  // bundling..."), so it silently returned the content unchanged.
  // Recording the join position as its own boundary lets the scan loop
  // below test the second line's text on its own -- exactly mirroring
  // how splitSentences treats it as a separate, independent candidate.
  const joinBoundary = bodyAfterMarker.length + 1;
  if (secondConsumedIndex !== -1) {
    boundaries.push(joinBoundary);
    boundaries.sort((a, b) => a - b);
  }

  let matchStart = -1;
  let matchEnd = -1;
  let previousBoundary = 0;
  for (const boundary of boundaries) {
    const candidate = restoreSentenceAbbreviations(protectedWindow.slice(previousBoundary, boundary)).trim();
    if (isDuplicateOfTakeaway(candidate)) {
      matchStart = previousBoundary;
      matchEnd = boundary;
      break;
    }
    previousBoundary = boundary;
  }

  // P0 PRODUCTION FIX -- confirmed live (Market Intelligence production
  // consistency hardening): this previously required `marker` (a
  // bulleted/numbered line) to try the whole window as one indivisible
  // candidate -- but a genuinely PLAIN heading/title line with no
  // internal punctuation at all ("Evidence-supported major players", a
  // deterministic section title with no bullet marker) is just as
  // eligible to BE the entire takeaway on its own (splitSentences now
  // treats every line independently, so a title line long enough to
  // clear the length filter becomes its own standalone "sentence").
  // Dropping the `marker` requirement lets this whole-window fallback
  // apply to both shapes uniformly; boundaries.length === 0 alone
  // already guarantees this only fires when nothing else could be
  // found, exactly as conservative as before.
  if (matchStart === -1 && boundaries.length === 0) {
    const wholeCandidate = restoreSentenceAbbreviations(protectedWindow).trim();
    if (isDuplicateOfTakeaway(wholeCandidate)) {
      matchStart = 0;
      matchEnd = protectedWindow.length;
    }
  }

  if (matchStart === -1) {
    return raw;
  }

  // When the match starts EXACTLY at the label/continuation join point,
  // "before" is precisely the original bare label line ("**Answer:**")
  // and nothing more -- a label that introduced content now entirely
  // removed serves no purpose on its own and would otherwise be left as
  // a dangling, orphaned heading with nothing following it. Discarded
  // only in that exact case; if any of the SECOND line's own real text
  // precedes the match (matchStart > joinBoundary), "before" legitimately
  // contains real, non-duplicate content and is fully preserved.
  const discardBeforeAsBareLabel = secondConsumedIndex !== -1 && matchStart === joinBoundary;
  const before = discardBeforeAsBareLabel
    ? ""
    : restoreSentenceAbbreviations(protectedWindow.slice(0, matchStart)).trim();
  const after = restoreSentenceAbbreviations(protectedWindow.slice(matchEnd)).trim();
  const remainder = [before, after].filter(Boolean).join(" ");

  const nextLines = lines.slice();
  if (secondConsumedIndex !== -1) {
    // The label line carried no sentence content of its own and is fully
    // consumed by the takeaway; whatever remains (from either side of
    // the matched span) becomes the second line's own new content.
    nextLines.splice(firstContentIndex, 1);
    const adjustedSecondIndex = secondConsumedIndex - 1;
    if (remainder) {
      nextLines[adjustedSecondIndex] = remainder;
    } else {
      nextLines.splice(adjustedSecondIndex, 1);
    }
  } else if (remainder) {
    nextLines[firstContentIndex] = `${marker}${remainder}`;
  } else {
    nextLines.splice(firstContentIndex, 1);
  }

  return nextLines.join("\n").replace(/^\n+/, "").trim();
}

// P0 PRODUCTION FIX -- confirmed live (Market Intelligence report
// presentation, round 2): page.tsx and Planner.tsx each kept their own
// independent copy of this function, and both joined every non-bulleted
// LINE with a single space BEFORE splitting into sentences -- the exact
// run-on-fusion bug splitSentences (above) was already fixed to avoid for
// getSectionTakeaway. A bare label line with no terminal punctuation
// ("Segmentasyon (kanıt destekli):") has no sentence boundary of its own,
// so joining it to whatever prose line followed (often unrelated, several
// lines away once bulleted items are filtered out) fused them into one
// blob before splitting -- disagreeing with getSectionTakeaway's own
// per-line-first sentence boundaries, so the index-based
// `sentences.slice(startIndex)` skip below no longer reliably excluded
// the same text getSectionTakeaway had already used as the takeaway,
// leaving the label visible a second time in this "explanation"
// paragraph. Splitting per LINE first (mirroring splitSentences exactly,
// reusing its own abbreviation-protected boundary and markdown-stripping)
// before ever joining anything guarantees a label line can only ever
// become its OWN candidate sentence, in full agreement with
// getSectionTakeaway -- never fused with unrelated prose several lines
// away. Moved here (was duplicated verbatim in page.tsx and
// Planner.tsx) so both surfaces share one implementation instead of two
// that can silently drift apart again.
export function extractSectionMainExplanation(content: string, takeaway: string) {
  const cleaned = normalizeReportPresentationText(content || "").replace(/^#{1,6}\s+.*$/gm, "");
  const sentences = cleaned
    .split(/\r?\n/)
    .filter((line) => !/^\s*(?:[-*•]|\d+[.)])\s+/.test(line))
    .flatMap((line) => protectSentenceAbbreviations(stripMarkdown(line)).split(/(?<=[.!?])\s+/))
    .map((sentence) => restoreSentenceAbbreviations(sentence).trim().replace(/^[-*•]\s+/, ""))
    .filter((sentence) => sentence.length > 20);
  const startIndex = takeaway ? 1 : 0;

  return sentences.slice(startIndex).join(" ");
}

export type CagrHeadlinePresentation = {
  // The exact string the KPI card/headline should display -- either the
  // single figure (unchanged from today's behavior) or a "low%–high%"
  // range when the underlying evidence disagrees. Empty when no
  // percentage was found at all (the existing "Validation Needed" state).
  displayValue: string;
  // True only when the underlying evidence genuinely states more than one
  // DISTINCT growth-rate figure (rounded to 1 decimal place, the
  // precision every current CAGR figure in this pipeline is already
  // formatted to) -- never true merely because the same number is cited
  // twice by different sources.
  isMultiEstimate: boolean;
};

// P0 FIX #8 -- confirmed live (CAGR scope/KPI semantics repair): a real
// production report's `cagr` field legitimately named TWO independently
// sourced, materially different growth estimates for what the report
// presented as one requested market (7.0% on a ~$7.3B->$13.1B base, 9.8%
// on a ~$25.5B->$65.3B base) -- graph.cagr is already an array (each
// qualifying evidence item contributes its own line), so the field's own
// body text already discloses both, but extractHeadlineCagrValue's simple
// regex (page.tsx/ReportPdfButton.tsx, unchanged by this fix) always
// picks the FIRST percentage found -- research-discovery order, not
// evidence quality or scope alignment -- and promotes it to the headline
// KPI as if ZERINIX had established one authoritative figure for the
// exact requested market. This function does not attempt to infer or
// fabricate WHY the two figures differ (no per-item geography/segment/
// period metadata exists to reason from, and inventing a scope
// explanation the evidence never stated would itself be fabrication) --
// it only detects that they genuinely differ and, when they do, reports a
// transparent range instead of silently picking one. A single figure
// restated by multiple sources (the common, non-conflicting case)
// continues to display exactly as before.
export function resolveCagrHeadlinePresentation(content: string): CagrHeadlinePresentation {
  const matches = [...(content || "").matchAll(/\d+(?:[.,]\d+)?(?:\s*[-–—]\s*\d+(?:[.,]\d+)?)?\s*%/g)];
  if (matches.length === 0) {
    return { displayValue: "", isMultiEstimate: false };
  }

  const firstValue = matches[0][0].replace(/\s+/g, " ").trim();
  const distinctValues = new Set(
    matches
      .map((match) => Number.parseFloat(match[0].replace(",", ".")))
      .filter((value) => Number.isFinite(value))
      .map((value) => value.toFixed(1))
  );

  if (distinctValues.size <= 1) {
    return { displayValue: firstValue, isMultiEstimate: false };
  }

  const sortedValues = [...distinctValues].map(Number).sort((left, right) => left - right);
  const lowValue = sortedValues[0];
  const highValue = sortedValues[sortedValues.length - 1];
  return {
    displayValue: `${lowValue.toFixed(1)}%–${highValue.toFixed(1)}%`,
    isMultiEstimate: true,
  };
}

// P0 PRODUCTION FIX -- confirmed live (Market Intelligence research-
// quality failure): the web report showed TAM = $131.6B, SAM = $32.9B,
// SOM = Validation Needed -- a genuinely partial, correctly-nested
// result -- while the exported PDF for the SAME report collapsed the
// whole section to "Additional market validation is required," losing
// the valid TAM and SAM. Root cause: page.tsx and ReportPdfButton.tsx
// each hand-rolled their OWN regex pair for pulling a TAM/SAM/SOM
// layer's raw value text out of the shared tamSamSom content string --
// page.tsx's grab was a permissive, boundary-aware capture (stop at the
// next field/keyword boundary), while ReportPdfButton.tsx's was a
// stricter, self-anchored value-SHAPE pattern. The production TAM
// line's phrasing matched the web's parser but not the PDF's, so
// tamResolved was true on the web and false in the PDF for the exact
// same TAM figure -- which then cascaded (by the correct, unchanged
// TAM-first nesting rule below) to mark SAM unresolved in the PDF too,
// even though SAM's own text independently parsed fine.
//
// extractMarketSizingLayerValue and parseMarketSizingMagnitude are now
// the single canonical implementation for turning that content string
// into raw value text and a comparable magnitude -- both the web report
// and the PDF export call these directly instead of maintaining their
// own copies, so the two surfaces can no longer independently disagree
// about what a layer's own text says. This mirrors the two-step
// strategy already proven correct in production on the web (a
// boundary-aware "LABEL: value" grab first, since a report section
// often lists several labeled fields on adjacent lines or separated by
// narration like "formula"/"planning input"/"confidence"; then a
// fallback that additionally tolerates a "[Estimated]"/"(Total
// Addressable Market)" classification tag sitting between the label
// and its value, the shape market-intelligence-graph.ts's own
// deterministic Planning Estimate backend and natural model prose both
// produce). Extraction only ever reads text that is already present in
// the report's own content -- it never derives, infers, or fabricates a
// value for a layer the upstream evidence-first market-sizing engine
// did not already produce.
export function extractMarketSizingLayerValue(
  content: string,
  label: "TAM" | "SAM" | "SOM"
): string {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Separator class includes "≈"/"~" alongside ":"/"-"/"–"/"—" -- a
  // Planning Estimate paragraph legitimately writes "TAM (...) ≈
  // €200-800 million" (an approximation symbol, not a colon/dash) as its
  // separator between the label and its value; this was previously only
  // tolerated by ReportPdfButton.tsx's own separate fallback regex, never
  // by page.tsx's, so consolidating on page.tsx's exact separator class
  // alone would have silently regressed an already-shipped PDF fix.
  const separator = "[:\\-–—≈~]";

  const boundaryAware = content.match(
    new RegExp(
      `\\b${escapedLabel}\\b\\s*${separator}\\s*([\\s\\S]*?)(?=\\s*(?:\\||[,;]\\s*[A-Z][A-Za-z /-]{1,32}\\s*${separator}|\\bformula\\b|\\bplanning input\\b|\\bevidence\\b|\\breference\\b|\\bconfidence\\b|\\n\\s*[A-Z][A-Za-z /-]{1,32}\\s*${separator}|$))`,
      "i"
    )
  );
  const direct = boundaryAware?.[1]?.trim().replace(/\*\*/g, "");
  if (direct) {
    return direct;
  }

  const normalized = content.replace(/\*\*/g, "");
  const withTag = normalized.match(
    new RegExp(
      `\\b${escapedLabel}\\b\\s*(?:\\([^)\\n]{0,80}\\)\\s*)?(?:\\[[^\\]\\n]{0,40}\\]\\s*)?${separator}\\s*([^\\n]*)`,
      "i"
    )
  );
  return withTag?.[1]?.trim().replace(/\*\*/g, "") || "";
}

// Canonical magnitude parser for a TAM/SAM/SOM layer's raw value text --
// see extractMarketSizingLayerValue's comment above for why a single
// shared implementation is required. Ranges ("$2.1-2.8 billion") take
// the LAST number+unit found, which correctly resolves a trailing unit
// shared across both bounds; the full unit word is tried before the
// single-letter abbreviation so "thousand"/"trillion" (both starting
// with "t") can never collide.
export function parseMarketSizingMagnitude(value: string): number | null {
  const matches = [
    ...(value || "").matchAll(/([\d.,]+)\s*(thousand|million|billion|trillion|[kKmMbBtT])?/gi),
  ];
  const last = matches
    .filter((candidate) => candidate[1] && Number.isFinite(parseFloat(candidate[1].replace(/,/g, ""))))
    .at(-1);

  if (!last) {
    return null;
  }

  const num = parseFloat(last[1].replace(/,/g, ""));
  if (!Number.isFinite(num) || num <= 0) {
    return null;
  }

  const unit = (last[2] || "").toLowerCase();
  const multiplier =
    unit === "k" || unit === "thousand"
      ? 1e3
      : unit === "m" || unit === "million"
        ? 1e6
        : unit === "b" || unit === "billion"
          ? 1e9
          : unit === "t" || unit === "trillion"
            ? 1e12
            : 1;

  return num * multiplier;
}

export type MarketSizingCascadeResolution = {
  tamResolved: boolean;
  samResolved: boolean;
  somResolved: boolean;
  allResolved: boolean;
};

// CANONICAL TAM/SAM/SOM cascade rule -- the single source of truth for
// "which of these three layers can be trusted and displayed," shared by
// the web report (app/dashboard/[id]/page.tsx) and the PDF export
// (ReportPdfButton.tsx) so the two can never disagree. Each caller does
// its own text extraction (the two renderers have legitimately
// different parsing/measurement needs), then hands the three already-
// parsed magnitudes here for the actual resolution decision.
//
// A layer counts as resolved only when it has its own parseable
// magnitude AND every layer above it in the TAM >= SAM >= SOM hierarchy
// is ALSO resolved and correctly nested beneath it (a value that is
// present but exceeds its parent is a genuine data inconsistency, e.g.
// a SAM larger than its own TAM -- not merely a missing figure -- and
// must not be treated as valid). This is a strictly PER-LAYER decision:
// SOM being unresolved must never affect whether TAM/SAM are reported
// as resolved, and a missing/unresolved TAM must continue to withhold
// SAM/SOM exactly as the evidence-first market-sizing engine
// (market-intelligence-graph.ts) already requires upstream -- this
// function only decides what to DISPLAY, it never derives or fabricates
// a value the upstream engine did not already produce.
export function resolveMarketSizingCascade(
  magnitudes: readonly [number | null, number | null, number | null]
): MarketSizingCascadeResolution {
  const [tamMagnitude, samMagnitude, somMagnitude] = magnitudes;
  const tamResolved = tamMagnitude !== null;
  const samResolved = tamResolved && samMagnitude !== null && samMagnitude <= (tamMagnitude as number);
  const somResolved = samResolved && somMagnitude !== null && somMagnitude <= (samMagnitude as number);
  const allResolved = tamResolved && samResolved && somResolved;

  return { tamResolved, samResolved, somResolved, allResolved };
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
