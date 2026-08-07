// Deterministic, content-derived Evidence & Confidence assessment.
//
// This does not invent a judgment about a section -- it reads the
// evidence tags the report-generation prompts already require the
// model to attach to every important claim ("Classify every important
// numeric claim as Verified, Estimated, Assumption, or AI Analysis" --
// see report-evidence.ts's evidenceLabels, reused below) and
// aggregates them into the label set this feature requires. A section
// with no tags at all is treated as low-confidence, not silently
// upgraded, per "never present assumptions as verified facts."
import { evidenceLabels } from "./report-evidence.ts";
import type { ResponseLanguage } from "./report-language.ts";

export const evidenceTypeLabels = [
  "User Provided",
  "Verified Source",
  "Benchmark Data",
  "Planning Assumption",
  "Model Derived",
  "Validation Required",
] as const;

export type EvidenceTypeLabel = (typeof evidenceTypeLabels)[number];

export type EvidenceQuality = "High" | "Medium" | "Low";

export type SectionEvidenceAssessment = {
  evidenceQuality: EvidenceQuality;
  confidenceScore: number;
  primaryEvidenceTypes: EvidenceTypeLabel[];
  dominantType: EvidenceTypeLabel | null;
  isMixedEvidence: boolean;
  missingEvidence: string[];
  unsupportedNumericClaimCount: number;
};

// Confidence weight per label -- deliberately ordered so that a
// section leaning on assumptions/model inference/unverified claims
// can never average out to a "High" score, satisfying "if a section
// depends mostly on assumptions, automatically reduce confidence."
const evidenceTypeWeight: Record<EvidenceTypeLabel, number> = {
  "Verified Source": 95,
  "User Provided": 88,
  "Benchmark Data": 65,
  "Planning Assumption": 45,
  "Model Derived": 40,
  "Validation Required": 20,
};

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildBracketTagPattern(labelsByLocale: string[]) {
  const alternation = labelsByLocale.map((label) => escapeRegExp(label)).join("|");
  return new RegExp(`\\[(?:${alternation})\\]`, "gi");
}

const allLocales: ResponseLanguage[] = ["English", "Turkish", "German", "French", "Spanish"];

// The existing report-wide tagging vocabulary (English/Turkish/German/
// French/Spanish), reused verbatim so this module recognizes exactly
// what the prompts already ask the model to write -- no new tag
// vocabulary is introduced into the generation prompts.
const verifiedTagPattern = buildBracketTagPattern(allLocales.map((locale) => evidenceLabels[locale].verified));
const benchmarkTagPattern = buildBracketTagPattern(allLocales.map((locale) => evidenceLabels[locale].benchmarkDerived));
const assumptionTagPattern = buildBracketTagPattern(allLocales.map((locale) => evidenceLabels[locale].planningAssumption));
const modelDerivedTagPattern = buildBracketTagPattern(allLocales.map((locale) => evidenceLabels[locale].validationRequired));

const userProvidedContextPattern = /\b(user|founder|submitted|you provided|kullanıcı|founder[\s-]?reported|self[\s-]?reported)\b/i;
const verifiedSourceContextPattern = /\[r\d+\]|https?:\/\/|\bsource\b|\bstudy\b|\breport\b|\bkaynak\b/i;
const validationRequiredPattern = /\bvalidation required\b|\bnot (?:yet )?verified\b|\bunverified\b|\bdoğrulama gerek(?:li|iyor)\b|\bdoğrulanmamış\b|\bnicht verifiziert\b|\bnon vérifié\b|\bno verificado\b/i;
const numericClaimPattern = /(?:\$|€|£|₺)?\d[\d.,]*\s*(?:%|k|m|b|mm|months?|days?|ay\b)?/gi;

function splitIntoClauses(content: string) {
  return content
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .map((clause) => clause.trim())
    .filter(Boolean);
}

function classifyClause(clause: string): EvidenceTypeLabel | null {
  if (validationRequiredPattern.test(clause)) {
    return "Validation Required";
  }

  if (verifiedTagPattern.test(clause)) {
    return userProvidedContextPattern.test(clause) || !verifiedSourceContextPattern.test(clause)
      ? "User Provided"
      : "Verified Source";
  }

  if (verifiedSourceContextPattern.test(clause) && /\[r\d+\]|https?:\/\//i.test(clause)) {
    return "Verified Source";
  }

  if (benchmarkTagPattern.test(clause)) {
    return "Benchmark Data";
  }

  if (assumptionTagPattern.test(clause)) {
    return "Planning Assumption";
  }

  if (modelDerivedTagPattern.test(clause)) {
    return "Model Derived";
  }

  return null;
}

export function assessSectionEvidenceConfidence(content: string): SectionEvidenceAssessment {
  const clauses = splitIntoClauses(content);
  const counts: Record<EvidenceTypeLabel, number> = {
    "User Provided": 0,
    "Verified Source": 0,
    "Benchmark Data": 0,
    "Planning Assumption": 0,
    "Model Derived": 0,
    "Validation Required": 0,
  };
  let unsupportedNumericClaimCount = 0;

  for (const clause of clauses) {
    const label = classifyClause(clause);

    if (label) {
      counts[label] += 1;
    } else if (numericClaimPattern.test(clause) && /\d/.test(clause)) {
      unsupportedNumericClaimCount += 1;
    }
  }

  const totalTags = evidenceTypeLabels.reduce((sum, label) => sum + counts[label], 0);

  if (totalTags === 0) {
    return {
      evidenceQuality: "Low",
      confidenceScore: unsupportedNumericClaimCount > 0 ? 30 : 40,
      primaryEvidenceTypes: ["Validation Required"],
      dominantType: "Validation Required",
      isMixedEvidence: false,
      missingEvidence: [
        "No classified evidence (User Provided, Verified Source, Benchmark Data, Planning Assumption, or Model Derived) was found in this section.",
      ],
      unsupportedNumericClaimCount,
    };
  }

  const weightedSum = evidenceTypeLabels.reduce(
    (sum, label) => sum + counts[label] * evidenceTypeWeight[label],
    0
  );
  let confidenceScore = Math.round(weightedSum / totalTags);

  const lowQualityShare =
    (counts["Planning Assumption"] + counts["Model Derived"] + counts["Validation Required"]) / totalTags;

  // Explicit, visible penalty (on top of the weighting above) when a
  // section depends mostly on assumptions/model inference/unverified
  // claims -- requirement 3, made intentional rather than incidental.
  if (lowQualityShare > 0.6) {
    confidenceScore = Math.max(10, confidenceScore - 10);
  }

  if (unsupportedNumericClaimCount > 0) {
    confidenceScore = Math.max(10, confidenceScore - Math.min(15, unsupportedNumericClaimCount * 3));
  }

  confidenceScore = Math.min(97, Math.max(10, confidenceScore));

  const rankedTypes = evidenceTypeLabels
    .filter((label) => counts[label] > 0)
    .sort((a, b) => counts[b] - counts[a]);
  const dominantType = rankedTypes[0] ?? null;
  const runnerUp = rankedTypes[1];
  const isMixedEvidence = Boolean(
    dominantType && runnerUp && counts[runnerUp] >= counts[dominantType] * 0.6
  );
  const primaryEvidenceTypes = isMixedEvidence && dominantType && runnerUp
    ? [dominantType, runnerUp]
    : dominantType
      ? [dominantType]
      : [];

  const evidenceQuality: EvidenceQuality =
    confidenceScore >= 75 ? "High" : confidenceScore >= 50 ? "Medium" : "Low";

  const missingEvidence: string[] = [];
  if (unsupportedNumericClaimCount > 0) {
    missingEvidence.push(
      `${unsupportedNumericClaimCount} numeric claim(s) in this section carry no evidence label and should be treated as Validation Required until confirmed.`
    );
  }
  if (counts["Validation Required"] > 0) {
    missingEvidence.push(
      "This section explicitly flags claims that still require validation."
    );
  }

  return {
    evidenceQuality,
    confidenceScore,
    primaryEvidenceTypes,
    dominantType,
    isMixedEvidence,
    missingEvidence,
    unsupportedNumericClaimCount,
  };
}

const evidenceTypeTranslations: Record<ResponseLanguage, Record<EvidenceTypeLabel, string>> = {
  English: {
    "User Provided": "User Provided",
    "Verified Source": "Verified Source",
    "Benchmark Data": "Benchmark Data",
    "Planning Assumption": "Planning Assumption",
    "Model Derived": "Model Derived",
    "Validation Required": "Validation Required",
  },
  Turkish: {
    "User Provided": "Kullanıcı Tarafından Sağlandı",
    "Verified Source": "Doğrulanmış Kaynak",
    "Benchmark Data": "Referans Verisi",
    "Planning Assumption": "Planlama Varsayımı",
    "Model Derived": "Modelden Türetildi",
    "Validation Required": "Doğrulama Gerekli",
  },
  German: {
    "User Provided": "Vom Nutzer angegeben",
    "Verified Source": "Verifizierte Quelle",
    "Benchmark Data": "Benchmark-Daten",
    "Planning Assumption": "Planungsannahme",
    "Model Derived": "Modellabgeleitet",
    "Validation Required": "Validierung erforderlich",
  },
  French: {
    "User Provided": "Fourni par l'utilisateur",
    "Verified Source": "Source vérifiée",
    "Benchmark Data": "Données de référence",
    "Planning Assumption": "Hypothèse de planification",
    "Model Derived": "Dérivé du modèle",
    "Validation Required": "Validation requise",
  },
  Spanish: {
    "User Provided": "Proporcionado por el usuario",
    "Verified Source": "Fuente verificada",
    "Benchmark Data": "Datos de referencia",
    "Planning Assumption": "Supuesto de planificación",
    "Model Derived": "Derivado del modelo",
    "Validation Required": "Validación requerida",
  },
};

const evidenceQualityTranslations: Record<ResponseLanguage, Record<EvidenceQuality, string>> = {
  English: { High: "High", Medium: "Medium", Low: "Low" },
  Turkish: { High: "Yüksek", Medium: "Orta", Low: "Düşük" },
  German: { High: "Hoch", Medium: "Mittel", Low: "Niedrig" },
  French: { High: "Élevée", Medium: "Moyenne", Low: "Faible" },
  Spanish: { High: "Alta", Medium: "Media", Low: "Baja" },
};

const blockCopy: Record<
  ResponseLanguage,
  {
    heading: string;
    evidenceQuality: string;
    confidenceScore: string;
    primaryEvidenceType: string;
    dominantSingle: (type: string) => string;
    dominantMixed: (dominant: string, secondary: string) => string;
    missingEvidence: string;
    recommendValidation: string;
  }
> = {
  English: {
    heading: "Evidence & Confidence",
    evidenceQuality: "Evidence Quality",
    confidenceScore: "Confidence Score",
    primaryEvidenceType: "Primary Evidence Type(s)",
    dominantSingle: (type) => `This section's conclusion relies primarily on ${type}.`,
    dominantMixed: (dominant, secondary) =>
      `This section combines multiple evidence types; ${dominant} dominates the conclusion, with ${secondary} as a secondary basis.`,
    missingEvidence: "Missing Evidence",
    recommendValidation: "Recommendation: validate this section's claims with primary evidence before relying on it for decisions.",
  },
  Turkish: {
    heading: "Kanıt ve Güven",
    evidenceQuality: "Kanıt Kalitesi",
    confidenceScore: "Güven Skoru",
    primaryEvidenceType: "Birincil Kanıt Türü/Türleri",
    dominantSingle: (type) => `Bu bölümün sonucu öncelikle ${type} temeline dayanmaktadır.`,
    dominantMixed: (dominant, secondary) =>
      `Bu bölüm birden fazla kanıt türünü birleştirir; sonuca ${dominant} egemendir, ${secondary} ise ikincil temeldir.`,
    missingEvidence: "Eksik Kanıt",
    recommendValidation: "Öneri: kararlar için kullanmadan önce bu bölümdeki iddiaları birincil kanıtla doğrulayın.",
  },
  German: {
    heading: "Evidenz & Konfidenz",
    evidenceQuality: "Evidenzqualität",
    confidenceScore: "Konfidenzwert",
    primaryEvidenceType: "Primäre Evidenzart(en)",
    dominantSingle: (type) => `Die Schlussfolgerung dieses Abschnitts stützt sich hauptsächlich auf ${type}.`,
    dominantMixed: (dominant, secondary) =>
      `Dieser Abschnitt kombiniert mehrere Evidenzarten; ${dominant} dominiert die Schlussfolgerung, ${secondary} dient als sekundäre Grundlage.`,
    missingEvidence: "Fehlende Evidenz",
    recommendValidation: "Empfehlung: Die Aussagen dieses Abschnitts vor einer Entscheidungsgrundlage mit Primärevidenz validieren.",
  },
  French: {
    heading: "Preuves et confiance",
    evidenceQuality: "Qualité des preuves",
    confidenceScore: "Indice de confiance",
    primaryEvidenceType: "Type(s) de preuve principal(aux)",
    dominantSingle: (type) => `La conclusion de cette section repose principalement sur ${type}.`,
    dominantMixed: (dominant, secondary) =>
      `Cette section combine plusieurs types de preuves ; ${dominant} domine la conclusion, avec ${secondary} comme base secondaire.`,
    missingEvidence: "Preuves manquantes",
    recommendValidation: "Recommandation : valider les affirmations de cette section avec des preuves primaires avant de s'y fier pour une décision.",
  },
  Spanish: {
    heading: "Evidencia y confianza",
    evidenceQuality: "Calidad de la evidencia",
    confidenceScore: "Índice de confianza",
    primaryEvidenceType: "Tipo(s) de evidencia principal(es)",
    dominantSingle: (type) => `La conclusión de esta sección se basa principalmente en ${type}.`,
    dominantMixed: (dominant, secondary) =>
      `Esta sección combina varios tipos de evidencia; ${dominant} domina la conclusión, con ${secondary} como base secundaria.`,
    missingEvidence: "Evidencia faltante",
    recommendValidation: "Recomendación: valide las afirmaciones de esta sección con evidencia primaria antes de usarla para decisiones.",
  },
};

export function formatEvidenceConfidenceBlock(
  assessment: SectionEvidenceAssessment,
  language: ResponseLanguage = "English"
) {
  const copy = blockCopy[language];
  const localizedQuality = evidenceQualityTranslations[language][assessment.evidenceQuality];
  const localizedTypes = assessment.primaryEvidenceTypes.map(
    (type) => evidenceTypeTranslations[language][type]
  );
  const lines = [
    copy.heading,
    `- ${copy.evidenceQuality}: ${localizedQuality}`,
    `- ${copy.confidenceScore}: ${assessment.confidenceScore}/100`,
    localizedTypes.length
      ? `- ${copy.primaryEvidenceType}: ${localizedTypes.join(", ")}`
      : "",
  ];

  if (assessment.isMixedEvidence && localizedTypes.length === 2) {
    lines.push(`- ${copy.dominantMixed(localizedTypes[0], localizedTypes[1])}`);
  } else if (localizedTypes.length === 1) {
    lines.push(`- ${copy.dominantSingle(localizedTypes[0])}`);
  }

  if (assessment.missingEvidence.length) {
    lines.push(`- ${copy.missingEvidence}: ${assessment.missingEvidence.join(" ")}`);
  }

  if (assessment.evidenceQuality === "Low") {
    lines.push(`- ${copy.recommendValidation}`);
  }

  return lines.filter(Boolean).join("\n");
}

export function appendEvidenceConfidenceBlock(content: string, language: ResponseLanguage = "English") {
  const trimmed = content.trim();

  if (!trimmed) {
    return content;
  }

  const assessment = assessSectionEvidenceConfidence(trimmed);
  return `${trimmed}\n\n${formatEvidenceConfidenceBlock(assessment, language)}`;
}
