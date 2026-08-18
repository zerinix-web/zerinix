// Same fix as ReportPdfButton.tsx's identical formatMetricCardValue (the
// PDF export's own separate copy of this function): the report's own
// generation prompt requires every numeric claim to be tagged Verified/
// Estimated/Assumption/AI Analysis (or the Turkish equivalent), and the
// model sometimes writes that tag directly after the value with no
// colon/dash/pipe separator at all ("CAC: $51 AI Analysis"), which none
// of the delimiter-based splits below catch (they all require a
// punctuation separator before the matched word). Confirmed live
// (e-commerce inventory SaaS report): this left the raw tag word
// concatenated straight onto the on-screen dashboard card's value.
// Stripped as a trailing suffix, with or without parens/a leading dash,
// since the tag only ever appears at the end of an otherwise-clean value
// here.
const evidenceTagSuffixPattern =
  /\s*[-–—]?\s*\(?\b(?:Verified|Estimated|Assumption|Planning assumption|AI Analysis|Model estimate|Model-derived estimate|Approximate|Doğrulanmış|Tahmini|Yaklaşık|Varsayım|Planlama varsayımı|AI Analizi|Model çıkarımı|Model tahmini)\b\)?\s*$/i;

export function formatMetricCardValue(value: string) {
  const cleanValue = value.trim().replace(/\*\*/g, "");

  if (!cleanValue) {
    return "";
  }

  return cleanValue
    .split(/\b(?:formula|assumptions?|varsayımlar|confidence|güven|evidence|validation evidence|validation needed|metadata|referans|benchmark(?: source| comparison)?|raw benchmark context|explanation|justification|source)\b\s*[:\-–—=]/i)[0]
    .split(/\s+(?:based on|using|assuming|calculated from|derived from)\s+/i)[0]
    .split(/\s*[;|]\s*/)[0]
    .replace(evidenceTagSuffixPattern, "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/(\d)\.\s+(\d)(\s*[kKmMbB%])?/g, "$1.$2$3")
    .replace(/(\d),\s+(\d{3})/g, "$1,$2")
    .trim();
}

export function cleanEvidenceMetadataForDisplay(content: string) {
  return content
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();

      return !/^(?:[-*•]\s*)?(?:formula|assumptions?|varsayımlar|confidence|güven|evidence|validation evidence|validation needed|metadata|referans|raw validation context|raw benchmark context|internal evidence keys?|benchmark(?:source| source| comparison)?)\s*[:=]/i.test(trimmed);
    })
    .map((line) =>
      line
        .replace(/\s*\|\s*(?:formula|assumptions?|varsayımlar|confidence|güven|evidence|validation evidence|validation needed|metadata|referans|raw validation context|raw benchmark context|internal evidence keys?|benchmark(?:source| source| comparison)?)\s*[:=][^|\n]+/gi, "")
        .replace(/\b(?:formula|assumptions?|varsayımlar|confidence|güven|evidence|validation evidence|validation needed|metadata|referans|raw validation context|raw benchmark context|internal evidence keys?|benchmarkSource|benchmark)\s*=\s*[^|;\n]+/gi, "")
        .replace(/\bplanning assumptions require validation\b[.;]?/gi, "")
        .trimEnd()
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function cleanExecutiveText(
  value: string,
  maxLength = 180,
  normalizeText: (content: string) => string = (content) => content
) {
  const cleaned = normalizeText(value)
    .replace(/^[-*•]\s+/, "")
    .replace(/^\d+[.)]\s+/, "")
    .replace(/^#+\s*/, "")
    .replace(/\*\*/g, "")
    .replace(/\s*\|\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (cleaned.length <= maxLength) {
    return cleaned;
  }

  const truncated = cleaned.slice(0, maxLength).replace(/\s+\S*$/, "");

  return `${truncated || cleaned.slice(0, maxLength)}…`;
}

export function extractMeaningfulBullets(
  content: string,
  limit = 4,
  options: {
    normalizeText?: (content: string) => string;
    isOrphanBulletText?: (value: string) => boolean;
  } = {}
) {
  const normalizeText = options.normalizeText || ((value: string) => value);
  const isOrphanText = options.isOrphanBulletText || (() => false);
  const normalized = normalizeText(content);
  const bulletLines = normalized
    .split("\n")
    .map((line) => line.trim())
    .map((line) =>
      line
        .trim()
        .replace(/^[-*•]\s+/, "")
        .replace(/^\d+[.)]\s+/, "")
        .replace(/\*\*/g, "")
        .trim()
    )
    .filter((line) => line.length > 16 && !isOrphanText(line));

  if (bulletLines.length) {
    return bulletLines.slice(0, limit).map((line) => cleanExecutiveText(line, 150, normalizeText));
  }

  return normalized
    .replace(/\*\*/g, "")
    .split(/(?<=[.!?])\s+/)
    .map((line) => cleanExecutiveText(line, 150, normalizeText))
    .filter((line) => line.length > 16 && !isOrphanText(line))
    .slice(0, limit);
}
