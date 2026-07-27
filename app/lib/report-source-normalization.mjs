const placeholderDomains = new Set([
  "example.com",
  "example.org",
  "example.net",
  "localhost",
]);

function extractUrl(line) {
  return line.match(/https?:\/\/[^\s),\]]+/i)?.[0]?.replace(/[.,;:]+$/, "") || "";
}

function getDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function normalizeEvidenceLabels(value, language) {
  if (language === "Turkish") {
    return value
      .replace(/\bBenchmark Kaynaklı\b/gi, "Tahmini")
      .replace(/\bPlanlama Varsayımı\b/gi, "Varsayım")
      .replace(/\bDoğrulama Gerekli\b/gi, "AI Analizi");
  }

  return value
    .replace(/\bBenchmark Derived\b/gi, "Estimated")
    .replace(/\bPlanning Assumption\b/gi, "Assumption")
    .replace(/\bValidation Required\b/gi, "AI Analysis");
}

/**
 * Normalizes source-section text without changing the report shape. It removes
 * exact duplicates, collapses repeated domains to their richest entry, rejects
 * placeholder/unavailable citations, and uses the public evidence taxonomy.
 */
export function normalizeReportSourceSection(
  content,
  { language = "English", allowExternalCitations = false } = {}
) {
  const fallback =
    language === "Turkish"
      ? "AI tarafından türetilen analiz (harici olarak doğrulanmadı)"
      : "AI-derived analysis (not externally verified)";
  const rawLines = normalizeEvidenceLabels(String(content || ""), language).split("\n");
  const preferredByDomain = new Map();

  for (const [index, line] of rawLines.entries()) {
    const url = extractUrl(line);
    const domain = getDomain(url);

    if (!domain) continue;

    const current = preferredByDomain.get(domain);
    if (!current || line.trim().length > current.line.trim().length) {
      preferredByDomain.set(domain, { index, line });
    }
  }

  const seenLines = new Set();
  const emittedDomains = new Set();
  let emittedFallback = false;
  const output = [];

  for (const [index, rawLine] of rawLines.entries()) {
    const line = rawLine.trimEnd();
    const normalizedLine = line.trim().replace(/\s+/g, " ").toLowerCase();
    const url = extractUrl(line);
    const domain = getDomain(url);
    const citationIsUnavailable =
      Boolean(url) &&
      (!allowExternalCitations ||
        !domain ||
        placeholderDomains.has(domain) ||
        domain.endsWith(".invalid") ||
        domain.endsWith(".local"));

    if (
      citationIsUnavailable ||
      /\b(?:fake|fabricated|invented)\s+(?:source|citation|url)\b/i.test(line)
    ) {
      if (!emittedFallback) {
        output.push(fallback);
        emittedFallback = true;
      }
      continue;
    }

    if (domain) {
      if (preferredByDomain.get(domain)?.index !== index || emittedDomains.has(domain)) {
        continue;
      }
      emittedDomains.add(domain);
    }

    if (normalizedLine && seenLines.has(normalizedLine)) {
      continue;
    }

    if (normalizedLine) {
      seenLines.add(normalizedLine);
    }
    output.push(line);
  }

  return output.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

