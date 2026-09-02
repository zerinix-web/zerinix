import type { ReportInvestmentScore, ReportQualityScore } from "@/app/lib/report-investment-score";
import {
  polishTurkishUserFacingOutput,
  sanitizeInternalRoutingMetadata,
} from "@/app/lib/report-output-sanitization";
import { extractExecutiveDecisionFromText } from "@/app/lib/report-engine/executive-decision-brief";
import { type EvidenceLevel, inferEvidenceLevel } from "@/app/lib/report-evidence";

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
// TASK #26 -- exported (was module-private) so callers outside this file
// that need to recognize the SAME "this period is not a real sentence/line
// boundary" abbreviations -- without re-implementing splitSentences' own
// stripMarkdown + length>24 filtering, which is tuned specifically for
// takeaway extraction -- can reuse this single list rather than
// maintaining a second, driftable copy. See extractRecommendationItems
// below (TASK #29J -- now defined once in this file, consumed by
// page.tsx/Planner.tsx/ReportPdfButton.tsx) for the confirmed real-world
// case this unblocked: a model-wrapped line break landing right after
// "U.S." (e.g. "Owner: Head of Sales (U.S.\nmid-market)...") was being
// treated as a genuine recommendation-item boundary.
export const SENTENCE_ABBREVIATIONS = [
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

  // P0 PRODUCTION FIX -- confirmed live (Market Intelligence confidence-
  // scoring hardening): extractPercentScore's own unlabeled fallback (used
  // whenever no exact "Label: value" line exists) scans the ENTIRE content
  // for the FIRST bare "NN%"/"NN/100" pattern, with no tie to which
  // dimension is asking. Every dimension here passes the SAME `content`
  // string, so for any report where none of the alias labels appear
  // verbatim (true for every Market Intelligence report -- its generation
  // prompts never write "Market Confidence:"/"Financial Quality:"/etc, and
  // investmentScore is never populated for this report type) all 5
  // dimensions collapsed onto the SAME unrelated percentage -- in
  // production, almost always the Executive Decision banner's own overall
  // confidence figure (frequently capped at exactly 50 by
  // capConfidenceForEvidenceGap when a decision-critical evidence gap
  // exists), producing the reported "uniform ~50/51 across every
  // dimension" symptom. requireNearbyLabelWord (already the established
  // safe pattern for buildExecutiveSnapshot's own confidenceScore, a few
  // lines below) requires the dimension's OWN alias word within 20 chars
  // of the percentage, so a report that never mentions that dimension by
  // name correctly falls through to null ("Validation Required", the
  // existing convention for "no defensible dimension-specific value")
  // instead of fabricating a shared, unrelated number.
  return dimensions.map((dimension) => ({
    label: dimension.label,
    score:
      extractPercentScore(content, dimension.aliases, { requireNearbyLabelWord: true }) ??
      dimension.score ??
      null,
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

// TASK #26 -- confirmed live (real persisted report, Opportunities
// section): a blind `slice(0, 217)` cut wherever the 217th character
// happened to fall, with no regard for word boundaries -- when a word
// (observed live: the "(unverified)" epistemic marker Task #25C
// introduced, but this could just as easily land mid-word on any other
// token) straddled that exact position, the result was a fragment like
// "(unverifi..." reaching the reader as a visibly broken word.
//
// TASK #26B -- confirmed live AGAIN: word-boundary-safe truncation still
// truncates -- a real Key Takeaway card for the same Opportunities
// section was still cut off mid-sentence ("...mid-sized firms..."),
// which is a real, user-visible loss of content, not a cosmetic wording
// choice. The length cap itself was the remaining root cause, not just
// where it cut. Removed entirely: this now always returns the complete
// first sentence, however long. Callers that draw this inside a visual
// (the PDF Key Takeaway box) already derive their box height from the
// actual wrapped line count returned by wrapping THIS value (see
// ReportPdfButton.tsx/Planner.tsx's own getVisualHeight/drawSectionVisual
// pdfKeyTakeawayCardFields branches), so a longer sentence safely grows
// the box instead of being cut -- the same "let it grow, height already
// tracks it" fix already applied to Strategic Recommendations.
export function getSectionTakeaway(content: string) {
  const [firstSentence] = splitSentences(normalizeReportPresentationText(content));

  return firstSentence || "";
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

// TASK #32 -- Market Size / CAGR evidence-classification audit.
//
// PROBLEM (confirmed via full audit): page.tsx's own line-isolation
// helper (extractEvidenceLineForValue) fell back to the field's ENTIRE
// content whenever no line contained the exact displayed value verbatim
// -- reopening the exact whole-content "bare \bverified\b regex" hazard
// this line-isolation was built to prevent (a section merely containing
// the sentence "the SAM figure has not been independently verified"
// could flip an unrelated, completely unsupported CAGR/Market Size
// number to "Data Confirmed"). Separately, Planner.tsx never had this
// line-isolation at all -- it scanned section.content directly
// (components/Planner.tsx's own Market Size/CAGR card), a genuine web/
// web drift independent of the over-confidence risk.
//
// FIX: one canonical function, reused by both page.tsx and Planner.tsx.
// A displayed figure with no isolated evidence line of its own -- found
// by CAGR/Market Size's bare numeric-pattern scan with nothing tying it
// to a citation, an explanatory sentence, or an [Estimated]/[Verified]
// tag -- is classified "planningAssumption" directly, never the whole-
// content re-scan, and never inferEvidenceLevel's own generic
// "benchmarkDerived" fallback (which would read "Estimated"/"Market
// Support", implying some real benchmark backs it -- too confident for a
// figure with literally zero supporting text). A figure that DOES have
// its own evidence line is classified from that isolated line alone, via
// the existing inferEvidenceLevel, exactly as before.
export function extractEvidenceLineForMetricValue(content: string, value: string): string {
  if (!value) return "";
  const lines = (content || "").split("\n");
  const matchingLine = lines.find((line) => line.includes(value));
  return matchingLine ?? "";
}

export function deriveMarketSizeMetricEvidenceLevel(
  label: string,
  value: string,
  content: string
): EvidenceLevel {
  if (!value) return "validationRequired";

  const evidenceLine = extractEvidenceLineForMetricValue(content, value);
  if (!evidenceLine) {
    return "planningAssumption";
  }

  return inferEvidenceLevel({ label, value, context: evidenceLine });
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
// CRITICAL FIX (Task #21) -- see page.tsx's own identical parseMonetaryMagnitude
// for the full rationale: a trailing citation tag ("[R12]") or bare year
// is itself an unmarked number that the prior "always take the LAST
// match" rule could mistake for the actual monetary figure. Preferring
// the last match that carries an explicit scale unit -- falling back to
// the last bare number only when none exists -- keeps the established
// range-upper-bound behavior (e.g. "$2.1-2.8 billion") intact while no
// longer picking up a citation tag or year as the value itself. A
// trailing \b on every unit token (including the single-letter
// shortcuts) additionally prevents a bare number immediately followed by
// an unrelated word from being misread through that word's own first
// letter (e.g. "2024 baseline" must never parse as "2024 billion").
export function parseMarketSizingMagnitude(value: string): number | null {
  const matches = [
    ...(value || "").matchAll(/([\d.,]+)\s*(thousand\b|million\b|billion\b|trillion\b|[kKmMbBtT]\b)?/gi),
  ].filter((candidate) => candidate[1] && Number.isFinite(parseFloat(candidate[1].replace(/,/g, ""))));
  const unitMatches = matches.filter((candidate) => candidate[2]);
  const last = unitMatches.length > 0 ? unitMatches.at(-1) : matches.at(-1);

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

// =============================================================================
// TASK #29J -- Strategic Recommendations extraction/grouping, consolidated.
//
// Before this task, the 5 functions/constants below existed as byte-for-
// byte (modulo comments) IDENTICAL copies in THREE separate files
// (ReportPdfButton.tsx, Planner.tsx, page.tsx) -- the exact "duplicated
// logic, fixed in one surface but not the others" pattern that caused
// real UI/PDF drift bugs across Tasks #29E-#29I (each of those tasks had
// to apply its fix three times, by hand, to keep all three in sync).
// This is now the SINGLE source of truth: recommendation action
// extraction, Owner/Budget/Budget-ceiling/KPI/Success-criterion/
// Timeline/Activity/Evidence-tie metadata grouping, rationale/context/
// evidence-disclaimer filtering, and the legacy marker-free prose
// fallback. All three consumers import these directly instead of
// maintaining their own copies -- a future fix now only needs to be
// written once, and UI/PDF cannot drift apart on this logic again.
//
// Semantics are UNCHANGED from the pre-consolidation copies (verified via
// byte-for-byte, comment-stripped diff across all three original copies
// before this move) -- this is a pure relocation, not a rewrite.
// =============================================================================

// CRITICAL FIX -- confirmed live: a real Market Intelligence report's
// strategicRecommendations content began with "Recommendation: Enter
// (evidence supports entering...)" -- Business Plan/Acquisition
// vocabulary the Market Intelligence prompt never uses for its OWN
// decision, but which this generic extractor treated as an ordinary
// bulleted action line and rendered as this section's own first
// numbered "Action" card -- reproducing the exact reported
// contradiction (this section's own "Action #1" literally read
// "Recommendation: Enter" while Executive Summary's canonical decision
// was MONITOR). These are Executive-Summary-owned verdict language, not
// action items, regardless of which decision they happen to state --
// excluded here unconditionally, the same way the deterministic heading
// strings above already are.
export function isRecommendationHeadingLine(item: string) {
  if (/:$/.test(item)) return true;
  if (/^(?:first\s+90\s*-?\s*days?|market entry recommendation|why entry is not recommended now)\b/i.test(item)) {
    return true;
  }
  if (/^(?:recommendation|conviction|trade-?offs?)\s*:/i.test(item)) {
    return true;
  }
  // TASK #29F -- confirmed live (real persisted report): "Market Entry
  // Recommendation" (already excluded above as a heading) is always
  // followed by its own fixed 4-line Why/Where/When/How recap template --
  // rationale, geographic scope, timing, and a restatement of the
  // Decision line, never a genuine First-90-Days action (those are
  // labeled Owner/Budget ceiling/KPI/Success criterion, per that field's
  // own generation contract, never bare "Why:"/"Where:"/"When:"/"How:").
  // Left unfiltered, whichever of these 4 lines happened to fall within
  // the numbered-card display cap rendered as a spurious duplicate
  // "ACTION" restating context already shown by the Decision/Rationale
  // cards. Excluding all 4 here (not just the heading) keeps the real
  // numbered actions and their order completely unaffected.
  if (/^(?:why|where|when|how)\s*:/i.test(item)) {
    return true;
  }

  return false;
}

// CRITICAL FIX (Task #18) -- every Market Intelligence field prompt ends
// with "Max N words," which the model often echoes back as a trailing
// self-check footnote ("(174 words)", "(Total 136 words)") that would
// otherwise be rendered as a malformed, content-free "Action" card.
// Anchored start-to-end so a real sentence mentioning a word count
// mid-thought is never rejected.
export function isMetadataOnlyRecommendationLine(item: string) {
  return /^\(?\s*(?:total\s+)?\d+\s*words?\s*\)?\.?\s*$/i.test(item);
}

// TASK #27C -- confirmed live (real persisted report): a deterministic,
// codebase-generated evidence-quality disclaimer sentence -- emitted by
// report-output-sanitization.ts (sanitizeInternalResearchDiagnostics,
// generation time) when a field's own research degraded, and separately
// relabeled into its investor-facing wording by a Market-Intelligence-only
// presentation pass -- can end up as the LAST physical line of
// strategicRecommendations' own content. It has no bullet/numbered
// marker and passes every other check here, so it was being rendered as
// a fake, content-free "Action" card. This is meta-commentary about the
// REPORT's evidence quality as a whole, never an actionable
// recommendation -- it must never be treated as one, regardless of
// which of the known trailing-clause variants or the relabeled
// canonical form actually appears, and regardless of which language the
// report is in. Kept as its own, separately-named function (rather than
// folded into isRecommendationHeadingLine) so evidence-status metadata
// stays a clearly distinct concern from recommendation-heading
// detection, matching how the two are separately generated.
export function isEvidenceStatusDisclaimerLine(item: string): boolean {
  return (
    /^Some external sources could not be verified,?\s*so\b/i.test(item) ||
    /^Some assumptions require additional validation before a final conclusion\.?$/i.test(item) ||
    /^Bazı dış kaynaklar doğrulanamadığı için\b/i.test(item) ||
    /^Bazı varsayımlar nihai bir sonuca varılmadan önce ek doğrulama gerektiriyor\.?$/i.test(item) ||
    // TASK #28 -- the consolidated section-level evidence-status
    // disclosure (pdf-normalization.mjs's consolidateRepeatedEvidenceStatusLabels)
    // is appended as the LAST line of a field, exactly where the older
    // disclaimers above already were -- it needs the same exclusion so it
    // is never mistaken for a real, actionable Strategic Recommendation.
    // TASK #28B shortened the note's wording for new/re-rendered output
    // (see pdf-normalization.mjs); both the old and new wording are
    // matched here since an already-persisted report may still carry the
    // longer Task #28 text verbatim until it is regenerated.
    /^Evidence status: several claims\b/i.test(item) ||
    /^Kanıt durumu: Bu bölümdeki bazı iddialar\b/i.test(item) ||
    /^Evidenzstatus: Mehrere Aussagen\b/i.test(item) ||
    /^État des preuves : plusieurs affirmations\b/i.test(item) ||
    /^Estado de la evidencia: varias afirmaciones\b/i.test(item) ||
    /^Evidence note: Some claims require independent validation\.?$/i.test(item) ||
    /^Kanıt notu: Bazı iddialar bağımsız doğrulama gerektirir\.?$/i.test(item) ||
    /^Evidenzhinweis: Einige Aussagen erfordern eine unabhängige Prüfung\.?$/i.test(item) ||
    /^Note sur les preuves : certaines affirmations nécessitent une validation indépendante\.?$/i.test(item) ||
    /^Nota sobre la evidencia: algunas afirmaciones requieren validación independiente\.?$/i.test(item) ||
    // TASK #29E -- confirmed live (real persisted report): the model
    // sometimes appends a standalone "Evidence cited: [R21][R3][R4]..."
    // line after its real numbered actions -- a citation-listing footer
    // for the whole recommendation set, not an action itself. It has no
    // bullet/numbered marker and passed every other check here, so it
    // was rendered as a fake, near-empty "Action" card once its own
    // citation brackets were separately stripped for display elsewhere
    // in the pipeline (leaving just "Evidence cited:."). Anchored to
    // BOTH ends so it only ever matches a line that is nothing but this
    // label plus citation brackets -- a genuine action that happens to
    // mention "evidence cited" mid-sentence is never affected.
    /^Evidence (?:cited|collected)\s*:\s*(?:\[R\d+\]\s*)*\.?\s*$/i.test(item) ||
    // TASK #29G -- confirmed live (real persisted report): a competitor/
    // evidence-validation disclaimer ("Specific named rivals could not be
    // independently validated within available evidence; competitive
    // intensity is inferred from category-level signals.") matched none
    // of the exact-sentence disclaimer templates above and was promoted
    // to its own numbered "ACTION" card -- evidence/validation context
    // about the report's own research, never an executable step. Rather
    // than adding yet another hardcoded sentence, this is a general
    // structural pattern for the whole semantic family ("X could not be
    // independently validated/verified/confirmed", in any tense/subject),
    // so a future report phrasing this caveat differently is still
    // caught. A genuine action never asserts that something COULD NOT be
    // validated/verified/confirmed -- it states owners, budgets, KPIs,
    // and success criteria -- so this can't misfire on real content.
    /\b(?:could not|cannot|couldn't|can't|is not|isn't|are not|aren't|was not|wasn't|were not|weren't|has not|hasn't|have not|haven't)\s+(?:be\s+|been\s+)?(?:independently\s+)?(?:validated|verified|confirmed|corroborated)\b/i.test(item)
  );
}

// Strategic Recommendations is inherently a list -- each real recommendation
// line is rendered as its own card, rather than one long paragraph block.
// Falls back to sentence-splitting when the content has no bullet/numbered
// markers.
export function extractRecommendationItems(content: string) {
  const source = content || "";
  // CRITICAL FIX (Task #18) -- a heading ("First 90 Days (three concrete
  // actions):") can share one physical line with its own first numbered
  // action, which the line-level heading check then discards entirely.
  // Inserting a real line break before any numbered marker that follows
  // a ":"/"." boundary lets the heading and the action be evaluated
  // separately, without risking a false split on decimals or citation
  // parentheticals (the marker must be preceded by list/sentence
  // punctuation, not just any digit).
  const normalizedSource = source.replace(/([:.])\s+(\d{1,2}[.)]\s+)/g, "$1\n$2");
  // TASK #26 -- confirmed live (real persisted report): the model's own
  // generated prose sometimes wraps a physical line mid-sentence -- seen
  // twice in the SAME report, both immediately after "U.S." (e.g. "Owner:
  // Head of Sales (U.S.\nmid-market)..."), which is not a real
  // recommendation boundary. A blind per-line split treated the wrapped
  // continuation as its own separate "action", cutting the real
  // recommendation short (ending at "...(U.S.") and fabricating an
  // incomplete second one from whatever text was left after the wrap. A
  // line only starts a genuinely NEW recommendation when it begins with a
  // bullet/numbered marker; a marker-less line is rejoined onto whichever
  // item is already open -- but ONLY when that item's text so far ends in
  // a known abbreviation (SENTENCE_ABBREVIATIONS, the same list
  // splitSentences/getSectionTakeaway already trust for this exact "not a
  // real sentence end" signal), so a genuinely separate closing/summary
  // sentence that just happens to lack its own bullet marker (which ends
  // in ordinary terminal punctuation, not an abbreviation) is never
  // incorrectly merged into the preceding action.
  const itemStartPattern = /^(?:[-*•]|\d{1,2}[.)])\s+/;
  // TASK #29G -- confirmed live (real persisted report): the model
  // sometimes attaches a per-action rationale as its own bracketed aside
  // ON ITS OWN PHYSICAL LINE -- e.g. "[Why: establishes achievable
  // outreach-to-win ratios and closes SOM gap]." right after the action
  // it explains. It has no bullet/numbered marker and its previous line
  // doesn't end in a SENTENCE_ABBREVIATIONS entry, so the abbreviation-
  // only merge rule above never caught it, and it was promoted to its
  // own numbered "ACTION" card -- rationale/context rendered as if it
  // were an executable step, incrementing the action count. A line that
  // is ENTIRELY a bracketed clause is, by this pipeline's own consistent
  // convention (the same "[Estimated]"/"[R12]" inline-annotation shape
  // used throughout every Market Intelligence field), always a qualifier
  // on the thought immediately before it, never a new standalone thought
  // -- so it is rejoined onto whichever action is already open instead of
  // starting a new one. This generalizes to ANY bracketed label ("[Why:
  // ...]", "[Rationale: ...]", "[Note: ...]", ...), not a hardcoded match
  // on the word "Why" -- future generated wording in this exact shape is
  // handled without further changes. A line that is NOT fully bracketed
  // (e.g. the pre-existing "If all three succeed, ..." closing sentence)
  // is completely unaffected and keeps its own established behavior.
  const isBracketedAnnotationLine = (line: string) => /^\[.+\]\.?$/.test(line);
  // TASK #29H -- confirmed live (real persisted report structure): a
  // recommendation's own metadata (Owner, Budget/Budget cap/Budget
  // ceiling, Activity, Success criterion, Evidence tie/to collect) is
  // sometimes written by the model as its OWN bulleted sub-line under a
  // numbered action heading, e.g. "1) Market-size & SOM validation\n-
  // Owner: Head of Market Research\n- Budget cap: $50,000\n..." -- rather
  // than folded inline into one sentence (the OTHER, equally valid shape
  // this same prompt sometimes produces, e.g. "Account Validation Sprint
  // -- Owner: Head of Sales; Budget ceiling: $75,000; ..."). Because a
  // bulleted sub-field line has its OWN "-" marker, it always matched
  // itemStartPattern and was treated as a brand-new top-level
  // recommendation -- flattening one real recommendation's 5 metadata
  // fields into 5 separate fake "ACTION" cards. A line -- regardless of
  // whether it happens to carry a bullet marker -- whose content (after
  // stripping that marker) IS ENTIRELY one of this field's own recognized
  // metadata labels is structurally a sub-field of whichever
  // recommendation is already open, never a new recommendation: a
  // genuine recommendation's own title is a noun phrase/action name, not
  // a bare "Label:" line. Joined with "; " to match the SAME inline
  // separator the one-sentence format already uses, so
  // extractRecommendationSignals below reads both shapes identically --
  // this is the single structural fix that lets UI and PDF render one
  // grouped card with its own Owner/Budget/Activity/Success Criterion/
  // Evidence Tie fields, instead of one card per fragment, regardless of
  // which of the two shapes a given generation happens to use.
  // TASK #29I -- confirmed live (real persisted report): the label
  // family only covered "Evidence tie:"/"Evidence to collect:"/"Evidence
  // link:" -- a BARE "Evidence: ..." line (and "Evidence basis:"/
  // "Supporting evidence:", the same semantic field under other real
  // wordings) fell through unrecognized and was promoted to its own
  // numbered "ACTION" card. Extended to the whole "Evidence" family
  // generically (any single word after "Evidence", or none at all,
  // before the colon) plus "Supporting evidence:" -- never the separate,
  // already-excluded "Evidence cited:"/"Evidence collected:" citation
  // footer shape (Task #29E), which has no colon directly after
  // "Evidence" or one of these specific suffixes and is handled by
  // isEvidenceStatusDisclaimerLine instead.
  const recommendationFieldLabelPattern =
    /^(?:Owner|Owned by|Budget(?:\s+cap|\s+ceiling)?|Spend(?:\s+cap|\s+ceiling)?|Activity|Action|Scope|Success criterion|Success metric|KPI|Evidence(?:\s+tie|\s+to\s+collect|\s+link|\s+basis)?|Supporting evidence|Target|Geography(?:\/segment)?|Segment|Timeline)\s*:/i;
  const rawLines = normalizedSource.split("\n").map((line) => line.trim());
  const mergedLines: string[] = [];
  for (const line of rawLines) {
    const previous = mergedLines[mergedLines.length - 1];
    const strippedForFieldCheck = line.replace(/^[-*•]\s+/, "").replace(/^\d+[.)]\s+/, "");
    const isFieldLabelLine = previous !== undefined && recommendationFieldLabelPattern.test(strippedForFieldCheck);
    const isSpuriousWrap =
      previous !== undefined &&
      !itemStartPattern.test(line) &&
      (SENTENCE_ABBREVIATIONS.some((abbreviation) => previous.endsWith(abbreviation)) ||
        isBracketedAnnotationLine(line));

    if (isFieldLabelLine) {
      mergedLines[mergedLines.length - 1] = `${previous}; ${strippedForFieldCheck}`;
    } else if (isSpuriousWrap) {
      mergedLines[mergedLines.length - 1] = `${previous} ${line}`;
    } else {
      mergedLines.push(line);
    }
  }
  const bulletLines = mergedLines
    .map((line) =>
      line
        .replace(/^[-*•]\s+/, "")
        .replace(/^\d+[.)]\s+/, "")
        .replace(/\*\*/g, "")
        .trim()
    )
    .filter(
      (line) =>
        line.length > 8 &&
        !isRecommendationHeadingLine(line) &&
        !isMetadataOnlyRecommendationLine(line) &&
        !isEvidenceStatusDisclaimerLine(line)
    );

  if (bulletLines.length > 0) {
    return bulletLines.slice(0, 8);
  }

  // TASK #26 -- same abbreviation-protection as the bullet-line path above
  // (see its own comment), applied here too since this fallback also
  // splits on sentence-ending punctuation and would otherwise cut a
  // sentence short right after "U.S."/"Inc."/etc.
  const abbreviationSentinel = "\x00";
  const protectedSource = SENTENCE_ABBREVIATIONS.reduce(
    (acc, abbreviation) =>
      acc.split(abbreviation).join(abbreviation.replace(/\./g, abbreviationSentinel)),
    source.replace(/\*\*/g, "")
  );

  return protectedSource
    .split(/(?<=[.!?])\s+/)
    .map((line) => line.split(abbreviationSentinel).join(".").trim())
    .filter((line) => line.length > 8 && !isMetadataOnlyRecommendationLine(line) && !isEvidenceStatusDisclaimerLine(line))
    .slice(0, 4);
}

// Best-effort inline signal extraction for a single recommendation line --
// strategicRecommendations' own prompt requires each First-90-Days action
// to name owners, a KPI, a success criterion, and a budget/spend ceiling
// as prose, not as machine-parseable "Owner: X" labels, so this surfaces
// only the signals that can be confidently read back out of that prose,
// never fabricating a value when the line does not genuinely contain one.
export const recommendationOwnerRolePattern =
  "(?:CEO|CMO|CFO|COO|CTO|CPO|VP of \\w+|Head of \\w+|(?:regional|country|global) (?:GM|general manager)|product (?:lead|manager|owner)|growth (?:lead|manager)|sales (?:lead|manager)|marketing (?:lead|manager)|founder)";

export function extractRecommendationSignals(line: string) {
  const timeframe = line.match(
    /\b\d+[\s-](?:day|days|week|weeks|month|months|gün|hafta|ay)\b|\bQ[1-4]\b|\b(?:this|next)\s+quarter\b/i
  )?.[0];
  // TASK #43A -- confirmed live against the real Download PDF path:
  // "Owner: Head of BD (U.S. mid-market); Budget cap: ..." was
  // rendering as "Head of BD (U.S" -- the `\.\s` terminator below (a
  // period followed by whitespace) matches EVERY period-space pair,
  // including the one inside "U.S." itself, with no concept that
  // "U.S." is a known abbreviation rather than this field's own end.
  // protectSentenceAbbreviations is this file's own established fix
  // for the identical problem in splitSentences (see its comment
  // above) -- it swaps each known abbreviation's periods for a
  // sentinel character before these regexes run, so "U.S. " can never
  // satisfy `\.\s` here; restoreSentenceAbbreviations converts the
  // sentinel back to a real "." in the extracted value only. Applied
  // to every label-based field below (Budget/Success Metric/Owner/
  // Activity/Evidence Tie) since all five share this exact terminator
  // shape.
  const abbreviationProtectedLine = protectSentenceAbbreviations(line);
  const extractProtectedLabelValue = (regex: RegExp) => {
    const match = abbreviationProtectedLine.match(regex)?.[1];
    return match ? restoreSentenceAbbreviations(match).trim() : undefined;
  };
  // TASK #43B -- confirmed live against the real Download PDF path:
  // "U.S. Mid-Market Pilot (Owner: Head of Partnerships) -- Budget
  // ceiling USD 75,000 (Assumption)." resolved Owner to "Head of
  // Partnerships) -- Budget ceiling USD 75,000 (Assumption)" instead of
  // just "Head of Partnerships". Root cause: the OLD terminator (see
  // Task #43A's own comment above) only ever recognized `;` or a real
  // sentence-ending period as "this field's own end" -- it had no
  // concept of a closing parenthesis (the common "(Owner: X) -- ..."
  // shape), an em/en dash introducing the next clause, or simply
  // running straight into the NEXT recognized label with no
  // punctuation between them at all. With none of those present, the
  // lazy capture kept growing until the very end of the sentence,
  // absorbing every field written after it.
  //
  // recommendationFieldBoundaryPattern is a single, shared "stop here"
  // rule reused by every one of these 5 label-based fields (Owner/
  // Budget/Success Metric/Activity/Evidence Tie), so one field can
  // never absorb a neighboring one no matter which of these it is:
  //   - `;` and a genuine (non-decimal) period -- unchanged from
  //     before, reusing the exact decimal-safe period check from Task
  //     #42A's sentenceTerminatorPattern so a real figure like "$1.5M"
  //     is never cut at its own decimal point.
  //   - a closing parenthesis, and an em dash or en dash -- the two
  //     real reported shapes.
  //   - the START of any of these 5 fields' own label keyword -- so
  //     even with NO punctuation at all between two fields, one can
  //     never run into the next. This is what makes the fix
  //     structural rather than a punctuation whitelist: any field
  //     written back-to-back with no separator is still safely
  //     bounded.
  // A `(...)` pair that is fully closed WITHIN the value itself (e.g.
  // "Head of BD (U.S. mid-market)", Task #43A's own real fixture) is
  // matched as one atomic unit before the bare-`)` stop condition is
  // ever consulted, so a legitimate parenthetical descriptor that is
  // part of the value survives intact -- only a closing paren with no
  // matching open WITHIN the value (i.e. one that closes a group
  // wrapping the field from OUTSIDE) ends the match. Implemented as a
  // repeated negative lookahead ("consume any character, or one
  // balanced parenthetical, as long as a boundary does not start
  // here") -- the same class of technique as Task #42/#42A's
  // sentenceSafeSegmentPattern, generalized to multiple stop
  // conditions instead of just one.
  //
  // TASK #44 -- confirmed live: an em/en dash is ALSO the conventional
  // separator inside a compact numeric RANGE written without spaces
  // ("$50,000--$75,000", "USD 2.1--2.8M") -- the bare `[—–]` stop above
  // would cut such a range in half, exactly the "numeric values
  // containing... ranges" case this ticket requires protecting. A
  // clause-separating dash (the real reported shape) always carries
  // whitespace on both sides in normal prose ("Head of Revenue -- Budget
  // cap: ..."); a range-separating dash never does. Gating the dash stop
  // on adjacent whitespace lets a field only stop at a genuine clause
  // break, never at a compact range's own internal separator.
  const recommendationFieldLabelAlternation =
    "(?:Owner|Owned by|Budget(?:\\s+cap|\\s+ceiling)?|Spend(?:\\s+cap|\\s+ceiling)?|Success\\s+(?:criterion|metric)|Activity|Action|Scope|Evidence(?:\\s+(?:tie|to\\s+collect|link|basis))?|Supporting evidence)\\s*:";
  const recommendationFieldClauseDashStop = "(?:(?<=\\s)[—–]|[—–](?=\\s))";
  const recommendationFieldBoundaryStop = `;|\\)|${recommendationFieldClauseDashStop}|(?:(?<!\\d)\\.|\\.(?!\\d))|\\b${recommendationFieldLabelAlternation}`;
  const recommendationFieldBoundaryPattern = `(?:(?!${recommendationFieldBoundaryStop})(?:\\([^()]*\\)|[\\s\\S]))*`;
  // TASK #29H -- prefer an explicit "Budget cap:"/"Budget ceiling:"/
  // "Spend cap:" label's own value first (this pipeline's real
  // generation contract already names the field this way) -- falls back
  // to the old bare currency-amount scan unchanged for content that
  // doesn't use the label, so a report that just writes "$75,000"
  // inline still resolves exactly as before.
  // TASK #43B -- the label's own colon is now optional, requiring
  // instead (via lookahead, so it is never consumed into the value)
  // that whatever follows actually looks like a monetary figure
  // (a currency symbol, a common currency code, or a bare digit) --
  // the real reported shape, "Budget ceiling USD 75,000", never uses a
  // colon at all. This still refuses to match ordinary prose that
  // merely contains the word "budget" (e.g. "the pilot's Budget is a
  // concern"), since "is" satisfies neither the colon nor the
  // lookahead.
  const explicitBudget = extractProtectedLabelValue(
    new RegExp(
      `\\b(?:Budget(?:\\s+cap|\\s+ceiling)?|Spend(?:\\s+cap|\\s+ceiling)?)\\b\\s*:?\\s*(?=[€$₺]|USD|EUR|GBP|TRY|\\d)(${recommendationFieldBoundaryPattern})`,
      "i"
    )
  );
  const budget = explicitBudget || line.match(/[€$₺]\s*\d+(?:[.,]\d+)*(?:\s*[kKmMbB])?/)?.[0];
  // TASK #29H -- prefer an explicit "Success criterion:"/"Success
  // metric:" label's own value first -- the old bare percentage/count
  // scan below only ever caught a narrow set of phrasings and missed
  // real success criteria stated in other terms (e.g. "at least one
  // comparable public price schedule secured").
  const explicitSuccessCriterion = extractProtectedLabelValue(
    new RegExp(`\\bSuccess\\s+(?:criterion|metric)\\s*:\\s*(${recommendationFieldBoundaryPattern})`, "i")
  );
  const metric =
    explicitSuccessCriterion ||
    line.match(/\d+(?:[.,]\d+)?\s*%/)?.[0] ||
    line.match(/\b\d+\s+(?:paying\s+)?(?:pilots?|customers?|interviews?|conversions?|sign-?ups?|users?|leads?|deals?)\b/i)?.[0];
  // TASK #29H -- prefer an explicit "Owner:"/"Owned by:" label's own
  // value verbatim first -- the old role-keyword match below only ever
  // recognized a fixed, narrow list of role titles (Head of X, VP of X,
  // ...) and silently dropped a real owner name/role stated in any other
  // words (e.g. "Pilot Lead"). Falls back to the role-keyword scan
  // unchanged for content with no explicit label at all.
  const explicitOwner = extractProtectedLabelValue(
    new RegExp(`\\b(?:Owner|Owned by)\\s*:\\s*(${recommendationFieldBoundaryPattern})`, "i")
  );
  const owner =
    explicitOwner ||
    line.match(new RegExp(`\\b(?:owned by|led by|driven by|owner:)\\s+(?:the\\s+)?(${recommendationOwnerRolePattern})\\b`, "i"))?.[1] ||
    line.match(new RegExp(`\\b(${recommendationOwnerRolePattern})\\b`, "i"))?.[1];
  // TASK #42 -- confirmed live: `[^.]*` stopped at the FIRST period
  // found, with no concept of a decimal point, so a gate sentence naming
  // a real figure ("before committing further budget beyond $1.5M in
  // this cycle.") was silently cut at the decimal point ("before
  // committing further budget beyond $1"). The inline alternative
  // `(?<=\d)\.(?=\d)` treats a period as "safe to continue past" only
  // when it sits between two digits (a genuine decimal point) -- a real
  // sentence-ending period (never preceded-and-followed by digits) still
  // stops the match exactly as before.
  const gate = line.match(
    /\bbefore\s+(?:committing\s+(?:further\s+)?(?:budget|spend)|scaling(?:\s+further)?|the\s+next\s+decision|proceeding|expanding|the\s+next\s+phase)\b(?:[^.]|(?<=\d)\.(?=\d))*/i
  )?.[0];
  // TASK #29H -- the ticket's own "conceptual structure" (title/action,
  // owner, budget, activity, successCriterion, evidenceTie) explicitly
  // wants Activity and Evidence Tie surfaced as their own fields, not
  // left buried in the flowing action paragraph now that the merge fix
  // above (recommendationFieldLabelPattern) keeps them attached to the
  // right recommendation. Explicit-label-only (no guess fallback) since,
  // unlike owner/budget, there is no reliable keyword-free way to infer
  // these two from free prose without risking fabrication.
  const activity = extractProtectedLabelValue(
    new RegExp(`\\b(?:Activity|Action|Scope)\\s*:\\s*(${recommendationFieldBoundaryPattern})`, "i")
  );
  // TASK #29I -- extended from "Evidence tie:"/"Evidence to collect:"/
  // "Evidence link:" to also recognize a BARE "Evidence:" label and
  // "Evidence basis:"/"Supporting evidence:" (the same semantic field
  // under other real wordings). The optional suffix group only ever
  // matches "tie"/"to collect"/"link"/"basis" -- "Evidence cited:"/
  // "Evidence collected:" (Task #29E's citation-footer shape) can never
  // satisfy either that suffix or the bare "Evidence:" form (there is
  // always a non-whitespace word between "Evidence" and the colon in
  // that shape), so this can never re-capture what #29E already excludes.
  const evidenceTie = extractProtectedLabelValue(
    new RegExp(
      `\\b(?:Evidence(?:\\s+(?:tie|to\\s+collect|link|basis))?|Supporting evidence)\\s*:\\s*(${recommendationFieldBoundaryPattern})`,
      "i"
    )
  );

  return {
    timeframe: timeframe?.trim() || "",
    metric: metric?.trim() || "",
    budget: budget?.trim() || "",
    owner: owner?.trim() || "",
    gate: gate?.trim() || "",
    activity: activity?.trim() || "",
    evidenceTie: evidenceTie?.trim() || "",
  };
}

export type RecommendationSignals = ReturnType<typeof extractRecommendationSignals>;
