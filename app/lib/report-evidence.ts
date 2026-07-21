export type EvidenceLevel =
  | "verified"
  | "benchmarkDerived"
  | "planningAssumption"
  | "validationRequired";

export type EvidenceLocale = "English" | "Turkish";

export const evidenceLabels: Record<EvidenceLocale, Record<EvidenceLevel, string>> = {
  English: {
    verified: "Verified",
    benchmarkDerived: "Benchmark Derived",
    planningAssumption: "Planning Assumption",
    validationRequired: "Validation Required",
  },
  Turkish: {
    verified: "Doğrulanmış",
    benchmarkDerived: "Benchmark Kaynaklı",
    planningAssumption: "Planlama Varsayımı",
    validationRequired: "Doğrulama Gerekli",
  },
};

export function getEvidenceLabel(level: EvidenceLevel, locale: EvidenceLocale = "English") {
  return evidenceLabels[locale][level];
}

export function normalizeEvidenceLevel(value: string): EvidenceLevel {
  const normalized = value.trim().toLowerCase();

  if (/\b(verified|actual|audited|invoice|bookkeeping|accounting|bank|stripe|doğrulanmış)\b/i.test(normalized)) {
    return "verified";
  }

  if (/\b(validation required|needs validation|validate|required|doğrulama gerekli|doğrula|low confidence)\b/i.test(normalized)) {
    return "validationRequired";
  }

  if (/\b(planning assumption|assumption|planning input|manual input|founder input|planlama varsayımı)\b/i.test(normalized)) {
    return "planningAssumption";
  }

  if (/\b(benchmark derived|benchmark-derived|benchmark|market reference|industry reference|market-derived|model-derived|model estimate|model based|benchmark kaynaklı)\b/i.test(normalized)) {
    return "benchmarkDerived";
  }

  return "planningAssumption";
}

export function inferEvidenceLevel(input: {
  label?: string;
  value?: string;
  context?: string;
}) {
  const evidenceContext = `${input.label || ""}\n${input.value || ""}\n${input.context || ""}`;

  if (!input.value || /\b(no data|not available|validation required|needs validation|validate|low confidence)\b/i.test(evidenceContext)) {
    return "validationRequired";
  }

  if (/\b(verified|actual|audited|invoice|bookkeeping|accounting|bank|stripe)\b/i.test(evidenceContext)) {
    return "verified";
  }

  if (/\b(cac|customer acquisition cost|ltv|lifetime value|payback)\b/i.test(evidenceContext)) {
    return "validationRequired";
  }

  if (/\b(burn|runway|break[\s-]?even|investment needed|planning input|assumption|manual input|founder input|target|threshold|warning)\b/i.test(evidenceContext)) {
    return "planningAssumption";
  }

  return "benchmarkDerived";
}

export function getEvidenceValidationNeed(level: EvidenceLevel) {
  if (level === "verified") return "Monitor actuals";
  if (level === "benchmarkDerived") return "Validate with operating data";
  if (level === "planningAssumption") return "Confirm planning input";

  return "Validation Required";
}

export function getEvidenceBadgeClass(level: EvidenceLevel) {
  if (level === "benchmarkDerived") {
    return "bg-teal-200 text-black";
  }

  if (level === "validationRequired") {
    return "bg-amber-300/15 text-amber-200";
  }

  if (level === "planningAssumption") {
    return "bg-sky-300/10 text-sky-200";
  }

  return "bg-white/10 text-zinc-300";
}

export function sourceTypeToEvidenceLevel(value: string, hasUrl = false): EvidenceLevel {
  if (/\b(planning assumption|assumption|planning input|model assumption)\b/i.test(value)) {
    return "planningAssumption";
  }

  if (/\b(industry|market report|research|benchmark|government|statistics|reference)\b/i.test(value)) {
    return "benchmarkDerived";
  }

  if (hasUrl) {
    return "verified";
  }

  return "validationRequired";
}
