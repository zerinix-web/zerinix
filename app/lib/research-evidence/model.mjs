export const RESEARCH_EVIDENCE_TYPES = Object.freeze([
  "News",
  "Government",
  "Research Paper",
  "Company Website",
  "Financial Filing",
  "Industry Report",
  "AI Generated",
]);

export function clampEvidenceScore(value, fallback = 0) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return Math.max(0, Math.min(100, Math.round(fallback)));
  }

  return Math.max(0, Math.min(100, Math.round(numeric)));
}

export function normalizeEvidenceText(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildEvidenceSearchText(input = {}) {
  return normalizeEvidenceText(
    [
      input.title,
      input.source,
      input.url,
      input.claim,
      input.value,
      ...(Array.isArray(input.supportingData) ? input.supportingData : []),
    ].join(" ")
  ).toLocaleLowerCase("tr");
}

export function resolveResearchTaskReference(input = {}, tasks = []) {
  const taskId = normalizeEvidenceText(input.taskId);
  const field = normalizeEvidenceText(input.field);
  const normalizedField = field
    .toLocaleLowerCase("tr")
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "");

  return (
    tasks.find((task) => normalizeEvidenceText(task?.id) === taskId) ||
    tasks.find((task) => normalizeEvidenceText(task?.field) === field) ||
    tasks.find(
      (task) =>
        normalizeEvidenceText(task?.field)
          .toLocaleLowerCase("tr")
          .replace(/[^\p{L}\p{N}]+/gu, "_")
          .replace(/^_+|_+$/g, "") === normalizedField
    ) ||
    null
  );
}

export function normalizeEvidenceUrl(value) {
  const raw = String(value || "").trim();

  if (!raw) return "";

  try {
    const url = new URL(raw);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return "";
    }

    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|mc_)/i.test(key)) {
        url.searchParams.delete(key);
      }
    }

    url.hostname = url.hostname.toLowerCase();
    url.pathname = url.pathname.replace(/\/{2,}/g, "/").replace(/\/$/, "") || "/";

    return url.toString();
  } catch {
    return "";
  }
}

export function getEvidenceDomain(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

export function canonicalEvidenceKey(evidence) {
  const domain = getEvidenceDomain(evidence.url);
  const title = normalizeEvidenceText(evidence.title)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

  return evidence.url || `${domain}|${title}|${evidence.publishedAt || ""}`;
}
