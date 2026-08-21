// "derived" is a distinct provenance tier from "verified": a value the
// user stated directly (e.g. MRR) is verified; a value mathematically
// calculated from that verified value (e.g. ARR = MRR x 12) is real and
// trustworthy but was never itself provided, so it must never display as
// "Verified" -- see PRODUCTION DATA PROVENANCE POLISH. Detection for it
// is checked ahead of "verified" below specifically because its own
// wording ("derived from the verified MRR figure") legitimately contains
// the substring "verified" as a modifier, not as a claim that this exact
// value was itself supplied.
export type EvidenceLevel =
  | "verified"
  | "derived"
  | "benchmarkDerived"
  | "planningAssumption"
  | "validationRequired";

export type EvidenceLocale = import("@/app/lib/report-language").ResponseLanguage;

export const evidenceLabels: Record<EvidenceLocale, Record<EvidenceLevel, string>> = {
  English: {
    verified: "Verified",
    derived: "Derived",
    benchmarkDerived: "Estimated",
    planningAssumption: "Assumption",
    validationRequired: "AI Analysis",
  },
  Turkish: {
    verified: "Doğrulanmış",
    derived: "Türetilmiş",
    benchmarkDerived: "Tahmini",
    planningAssumption: "Varsayım",
    validationRequired: "AI Analizi",
  },
  German: { verified: "Verifiziert", derived: "Abgeleitet", benchmarkDerived: "Geschätzt", planningAssumption: "Annahme", validationRequired: "KI-Analyse" },
  French: { verified: "Vérifié", derived: "Dérivé", benchmarkDerived: "Estimé", planningAssumption: "Hypothèse", validationRequired: "Analyse IA" },
  Spanish: { verified: "Verificado", derived: "Derivado", benchmarkDerived: "Estimado", planningAssumption: "Supuesto", validationRequired: "Análisis de IA" },
};

export function getEvidenceLabel(level: EvidenceLevel, locale: EvidenceLocale = "English") {
  return evidenceLabels[locale][level];
}

export function normalizeEvidenceLevel(value: string): EvidenceLevel {
  const normalized = value.trim().toLowerCase();

  // Checked before "verified" below: "derived from the verified MRR
  // figure" legitimately contains the word "verified" as a modifier on
  // the SOURCE value, not a claim that this figure was itself supplied.
  if (/\b(derived from|derived value|calculated from the (?:verified|user[\s-]?provided)|türetilmiş|abgeleitet|dérivé|derivado)\b/i.test(normalized)) {
    return "derived";
  }

  if (/\b(verified|actual|audited|invoice|bookkeeping|accounting|bank|stripe|doğrulanmış)\b/i.test(normalized)) {
    return "verified";
  }

  if (/\b(ai analysis|ai-derived analysis|validation required|needs validation|validate|required|ai analizi|doğrulama gerekli|doğrula|low confidence)\b/i.test(normalized)) {
    return "validationRequired";
  }

  if (/\b(planning assumption|assumption|planning input|manual input|founder input|varsayım|planlama varsayımı)\b/i.test(normalized)) {
    return "planningAssumption";
  }

  if (/\b(estimated|estimate|benchmark derived|benchmark-derived|benchmark|market reference|industry reference|market-derived|model-derived|model estimate|model based|tahmini|benchmark kaynaklı)\b/i.test(normalized)) {
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

  // Checked before "verified" below -- see the EvidenceLevel comment
  // above for why "derived from the verified MRR figure" must resolve to
  // "derived", not "verified".
  if (/\b(derived from|derived value|calculated from the (?:verified|user[\s-]?provided))\b/i.test(evidenceContext)) {
    return "derived";
  }

  if (/\b(verified|actual|audited|invoice|bookkeeping|accounting|bank|stripe)\b/i.test(evidenceContext)) {
    return "verified";
  }

  // Confirmed live (freelance graphic-design marketplace report): this
  // used to unconditionally return "validationRequired" (displayed as
  // "AI Analysis") for ANY metric whose label or context mentioned "cac"/
  // "ltv"/"payback" -- but `evidenceContext` always includes the metric's
  // own label, so a CAC card ALWAYS matched this on its label alone,
  // regardless of what its own evidence text actually said (e.g. "CAC:
  // $9k (Planning assumption), confidence=High" was still forced to "AI
  // Analysis", contradicting the report's own Financial Assumptions
  // section, which correctly showed the same metric as a planning
  // assumption). CAC/LTV/Payback are computed metrics like any other in
  // this engine, not inherently less trustworthy -- they now fall
  // through to the same assumption/benchmark classification every other
  // metric already uses, based on their own actual evidence text instead
  // of their label.
  if (/\b(burn|runway|break[\s-]?even|investment needed|planning input|assumption|manual input|founder input|target|threshold|warning)\b/i.test(evidenceContext)) {
    return "planningAssumption";
  }

  return "benchmarkDerived";
}

export function getEvidenceValidationNeed(level: EvidenceLevel) {
  if (level === "verified") return "Monitor actuals";
  if (level === "derived") return "Recheck if the source figure changes";
  if (level === "benchmarkDerived") return "Validate with operating data";
  if (level === "planningAssumption") return "Confirm planning input";

  return "Validation Required";
}

export function getEvidenceBadgeClass(level: EvidenceLevel) {
  if (level === "derived") {
    return "bg-violet-300/10 text-violet-200";
  }

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
  if (/\b(user provided|user input|actual operating data)\b/i.test(value)) {
    return "verified";
  }

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
