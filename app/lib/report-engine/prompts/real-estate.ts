import type { ResponseLanguage } from "@/app/lib/report-engine/schema";
import { repairReportLanguageSections } from "../../report-language.ts";

export const realEstatePrompts = {
  assetIdentification:
    "Identify only the asset and document type. Record identifiers exactly as visible. Never infer a parcel, address, owner, area, or document status.",
  extractedDocumentFacts:
    "List only facts directly visible in uploaded assets. Attach the label 'Verified from uploaded asset' to every item and use 'Unknown' for unreadable or absent facts.",
  ownershipTitleFindings:
    "Assess ownership, shares, encumbrances, annotations, easements, mortgages, and title limitations only when visible. Separate each observed fact from interpretation.",
  location:
    "State the verified location hierarchy and coordinates only when evidenced. Distinguish asset evidence, external-source verification, user input, estimates, and unknowns.",
  zoningLandUseStatus:
    "State zoning, permitted use, plan status, building rights, and official restrictions. Never infer zoning from neighboring development or imagery.",
  accessInfrastructure:
    "Assess legal and physical access, road frontage, utilities, water, sewerage, electricity, telecom, and nearby infrastructure. Mark every unavailable item Unknown.",
  comparableMarketEvidence:
    "Present only recent, geographically relevant comparable listings or transactions found in external sources. Include date, location, asset similarity, area, asking or transaction price, currency, unit price, URL, and limitations. If none are verified, write Unknown.",
  valuationRange:
    "Produce a valuation range only if verified location, parcel size and unit, zoning/use, sufficient recent comparables, currency, and an explicit calculation method are all available. A supported valuation must include evidence-labeled lines for each of those gates. Otherwise use the language-specific preliminary-valuation result, missing-gates heading, and evidence-acquisition-plan heading required by the system instructions, naming the document, source, or provider responsible for every missing gate. Never invent a purchase price or valuation.",
  legalRisks:
    "Identify only material title, ownership, encumbrance, zoning, permit, boundary, access, tenancy, tax, and transaction risks supported by the evidence. Present each material risk as Risk Level, Impact, Likelihood, Mitigation, and Evidence Basis. Use concise investment-committee language, separate observed evidence from legal-review recommendations, and do not provide definitive legal conclusions.",
  environmentalGeotechnicalRisks:
    "Assess only evidenced flood, wildfire, contamination, slope, soil, seismic, erosion, drainage, and geotechnical risks. Present each material risk as Risk Level, Impact, Likelihood, Mitigation, and Evidence Basis. Where a hazard is not verified, state the decision limitation once in professional business language and recommend the appropriate specialist check.",
  liquidity:
    "Assess likely marketability only from supported location, asset type, legal readiness, buyer pool, comparable activity, and market evidence. Do not invent time-on-market or demand statistics.",
  developmentPotential:
    "Assess development potential only from verified zoning, access, infrastructure, geometry, topography, legal constraints, and planning evidence. For every opportunity, explain why it exists, which evidence supports it, and which condition must hold for it to be investable. If zoning is unknown, keep development potential preliminary and never present a vague opportunity as established fact.",
  scenarioAnalysis:
    "Provide three conditional decision paths in the report language. For Turkish use Olumsuz, Temel, and Olumlu senaryo; do not use English scenario labels. Do not assign financial values unless the valuation evidence gate is satisfied. Clearly label assumptions and triggers.",
  investmentScore:
    "Render the weighted Overall Investment Score and component scores supplied by the Decision Intelligence context. Cover Ownership, Zoning, Infrastructure, Market, Liquidity, Environmental Risk, Legal Risk, and Development Potential when those components are supplied; show each as score/100 with its disclosed weight or evidence basis and a concise executive explanation. Do not recalculate, fill, or invent a missing component, weight, confidence percentage, or overall score. If the context contains no scores, state once that no investment score was calculated because the evidence is insufficient.",
  missingInformation:
    "Create one concise critical-information section, prioritized by decision impact and short enough to fit on one page. Group related gaps instead of repeating Unknown in every section. Never expose providers, queries, request status, retries, transport errors, or disabled integrations. State only that external verification was incomplete and name the authoritative record or evidence that would resolve each gap.",
  recommendedDueDiligence:
    "Provide a sequenced due-diligence checklist with the responsible official source or professional, required document, purpose, and decision gate. Keep recommendations specific to the identified asset and jurisdiction.",
  finalRecommendation:
    "Write a premium investment-committee executive dashboard. Begin with one approved recommendation in the report language, then present: Overall Investment Score (only if supplied), Recommendation as BUY / WAIT / AVOID or its fully localized equivalent, Confidence (only if supplied), Top 3 Opportunities with why each exists, Top 3 Risks, Required Due Diligence, and Executive Conclusion. Follow with the headings Decision, Reasoning, What changes the decision, and Required next actions. Avoid robotic validation wording and do not repeat missing-evidence language already covered in Missing Information. If valuation evidence is insufficient, explicitly call this a preliminary due-diligence report in the report language and do not imply a full valuation.",
  sources:
    "List only usable external sources actually used. For every source include, in the report language, its title, the full human-readable institution name (not merely a domain), exact URL, access date, exact evidence label, and one or two concise sentences explaining why that source matters to the supported report claim. Do not include uploaded filenames. Never invent citations or use generic source descriptions.",
} as const;

export type RealEstateReportField = keyof typeof realEstatePrompts;

export const realEstateFields = Object.keys(
  realEstatePrompts
) as RealEstateReportField[];

export const realEstateFieldLabels: Record<
  ResponseLanguage,
  Record<RealEstateReportField, string>
> = {
  English: {
    assetIdentification: "Asset Identification",
    extractedDocumentFacts: "Extracted Document Facts",
    ownershipTitleFindings: "Ownership and Title Findings",
    location: "Location",
    zoningLandUseStatus: "Zoning and Land-Use Status",
    accessInfrastructure: "Access and Infrastructure",
    comparableMarketEvidence: "Comparable Market Evidence",
    valuationRange: "Valuation Range",
    legalRisks: "Legal Risks",
    environmentalGeotechnicalRisks: "Environmental and Geotechnical Risks",
    liquidity: "Liquidity",
    developmentPotential: "Development Potential",
    scenarioAnalysis: "Scenario Analysis",
    investmentScore: "Investment Score",
    missingInformation: "Missing Information",
    recommendedDueDiligence: "Recommended Due Diligence",
    finalRecommendation: "Final Recommendation",
    sources: "Sources",
  },
  Turkish: {
    assetIdentification: "Varlık Tanımlama",
    extractedDocumentFacts: "Taşınmaz Bilgileri",
    ownershipTitleFindings: "Mülkiyet ve Tapu Bulguları",
    location: "Konum",
    zoningLandUseStatus: "İmar ve Arazi Kullanım Durumu",
    accessInfrastructure: "Erişim ve Altyapı",
    comparableMarketEvidence: "Karşılaştırılabilir Pazar Kanıtları",
    valuationRange: "Değerleme Aralığı",
    legalRisks: "Hukuki Riskler",
    environmentalGeotechnicalRisks: "Çevresel ve Jeoteknik Riskler",
    liquidity: "Likidite",
    developmentPotential: "Geliştirme Potansiyeli",
    scenarioAnalysis: "Senaryo Analizi",
    investmentScore: "Yatırım Skoru",
    missingInformation: "Doğrulanamayan Kritik Bilgiler",
    recommendedDueDiligence: "Önerilen Durum Tespiti",
    finalRecommendation: "Nihai Tavsiye",
    sources: "Kaynaklar",
  },
  German: {
    assetIdentification: "Objektidentifikation", extractedDocumentFacts: "Extrahierte Dokumentfakten", ownershipTitleFindings: "Eigentums- und Grundbuchbefunde", location: "Lage", zoningLandUseStatus: "Baurecht und Flächennutzung", accessInfrastructure: "Zugang und Infrastruktur", comparableMarketEvidence: "Vergleichbare Marktnachweise", valuationRange: "Bewertungsspanne", legalRisks: "Rechtliche Risiken", environmentalGeotechnicalRisks: "Umwelt- und geotechnische Risiken", liquidity: "Liquidität", developmentPotential: "Entwicklungspotenzial", scenarioAnalysis: "Szenarioanalyse", investmentScore: "Investitionsbewertung", missingInformation: "Fehlende Informationen", recommendedDueDiligence: "Empfohlene Due Diligence", finalRecommendation: "Abschließende Empfehlung", sources: "Quellen",
  },
  French: {
    assetIdentification: "Identification de l'actif", extractedDocumentFacts: "Faits extraits du document", ownershipTitleFindings: "Propriété et titre", location: "Localisation", zoningLandUseStatus: "Zonage et usage du sol", accessInfrastructure: "Accès et infrastructures", comparableMarketEvidence: "Éléments de marché comparables", valuationRange: "Fourchette de valorisation", legalRisks: "Risques juridiques", environmentalGeotechnicalRisks: "Risques environnementaux et géotechniques", liquidity: "Liquidité", developmentPotential: "Potentiel de développement", scenarioAnalysis: "Analyse des scénarios", investmentScore: "Score d'investissement", missingInformation: "Informations manquantes", recommendedDueDiligence: "Diligences recommandées", finalRecommendation: "Recommandation finale", sources: "Sources",
  },
  Spanish: {
    assetIdentification: "Identificación del activo", extractedDocumentFacts: "Hechos extraídos del documento", ownershipTitleFindings: "Propiedad y título", location: "Ubicación", zoningLandUseStatus: "Zonificación y uso del suelo", accessInfrastructure: "Acceso e infraestructura", comparableMarketEvidence: "Evidencia comparable de mercado", valuationRange: "Rango de valoración", legalRisks: "Riesgos legales", environmentalGeotechnicalRisks: "Riesgos ambientales y geotécnicos", liquidity: "Liquidez", developmentPotential: "Potencial de desarrollo", scenarioAnalysis: "Análisis de escenarios", investmentScore: "Puntuación de inversión", missingInformation: "Información faltante", recommendedDueDiligence: "Diligencia debida recomendada", finalRecommendation: "Recomendación final", sources: "Fuentes",
  },
};

export const REAL_ESTATE_EVIDENCE_LABELS = [
  "Verified from uploaded asset",
  "Verified from official source",
  "Verified from external source",
  "User-provided",
  "Estimate",
  "Unknown",
  "Recommendation",
] as const;

const forbiddenRealEstateAcronyms =
  /\b(?:ARR|MRR|CAC|LTV|TAM|SAM|SOM)\b/;
const forbiddenRealEstatePhrases =
  /\b(?:founder readiness|founder score|customer acquisition|professional services|startup funding|funding need|annual recurring revenue|monthly recurring revenue|lifetime value|startup methodology|capital efficiency|market radar)\b/i;

export function validateRealEstateReport(
  report: Record<RealEstateReportField, string>
) {
  let combined = realEstateFields
    .map((field) => `${field}\n${report[field] || ""}`)
    .join("\n");
  const appearsTurkish =
    (combined.match(/[çğıöşüÇĞİÖŞÜ]/g) || []).length >= 8;
  if (appearsTurkish) {
    const knownLanguageRepairs: Array<[RegExp, string]> = [
      [/Valuation Not Yet Defensible/gi, "Değerleme Henüz Savunulabilir Değil"],
      [/Missing gates/gi, "Eksik doğrulama kapıları"],
      [/Evidence acquisition plan/gi, "Kanıt edinme planı"],
      [/Downside/gi, "Olumsuz senaryo"],
      [/Base scenario/gi, "Temel senaryo"],
      [/Upside/gi, "Olumlu senaryo"],
      [/Uploaded asset filename/gi, "Yüklenen varlık"],
      [/Not used/gi, "Kullanılmadı"],
      [/Source type/gi, "Kaynak türü"],
      [/Access date/gi, "Erişim tarihi"],
      [/Confidence/gi, "Güven"],
      [/official:\s*yes/gi, "resmî: evet"],
      [/official:\s*no/gi, "resmî: hayır"],
    ];
    for (const field of realEstateFields) {
      report[field] = knownLanguageRepairs.reduce(
        (content, [pattern, replacement]) =>
          content.replace(pattern, replacement),
        report[field]
      );
    }
    combined = realEstateFields
      .map((field) => `${field}\n${report[field] || ""}`)
      .join("\n");
  }
  const forbiddenMatch =
    combined.match(forbiddenRealEstateAcronyms) ||
    combined.match(forbiddenRealEstatePhrases);

  if (forbiddenMatch) {
    throw new Error(
      `Real-estate schema validation failed: domain-inappropriate field "${forbiddenMatch[0]}" was generated.`
    );
  }

  const missingFields = realEstateFields.filter(
    (field) => !report[field]?.trim()
  );

  if (missingFields.length > 0) {
    throw new Error(
      `Real-estate schema validation failed: missing fields ${missingFields.join(", ")}.`
    );
  }

  const mixedLanguageMatch =
    appearsTurkish &&
    combined.match(
      /\b(?:Valuation Not Yet Defensible|Missing gates|Evidence acquisition plan|Downside|Base scenario|Upside|Uploaded asset filename|Not used|Source type|Access date|Confidence|official:\s*(?:yes|no))\b/i
    );

  if (mixedLanguageMatch) {
    console.warn("[report-language] non-fatal real-estate language mismatch", {
      expectedLanguage: "Turkish",
      segment: mixedLanguageMatch[0],
    });
  }

  const unlabeledBlocks = realEstateFields.flatMap((field) => {
    if (field === "recommendedDueDiligence" || field === "finalRecommendation") {
      return [];
    }
    if (
      field === "missingInformation" &&
      /^\s*\[(?:Unknown|Recommendation)\]/.test(report[field])
    ) {
      return [];
    }

    return report[field]
      .split(/\n{2,}|\n(?=\s*(?:[-*•]|\d+[.)])\s+)/)
      .map((block) => block.trim())
      .filter(
        (block) =>
          block &&
          !/^#{1,6}\s/.test(block) &&
          !/^\|?(?:\s*:?-+:?\s*\|)+$/.test(block)
      )
      .filter(
        (block) =>
          !REAL_ESTATE_EVIDENCE_LABELS.some((label) =>
            block.includes(label)
          )
      )
      .map((_, index) => `${field}[${index + 1}]`);
  });

  if (unlabeledBlocks.length > 0) {
    throw new Error(
      `Real-estate evidence validation failed: missing evidence labels in ${unlabeledBlocks.join(", ")}.`
    );
  }

  const valuation = report.valuationRange;
  const valuationIsNotDefensible =
    /\bValuation Not Yet Defensible\b/i.test(valuation) ||
    /Değerleme Henüz Savunulabilir Değil/i.test(valuation);

  if (!valuationIsNotDefensible) {
    const requiredEvidence = [
      /\bLocation\b/i,
      /\bParcel size\b/i,
      /\bZoning\/use\b/i,
      /\bComparable(?:s|\s+evidence)?\b/i,
      /\bCurrency\b/i,
      /\bCalculation method\b/i,
    ];

    if (!requiredEvidence.every((pattern) => pattern.test(valuation))) {
      throw new Error(
        "Real-estate valuation validation failed: location, parcel size, zoning/use, comparables, currency, and calculation method are required."
      );
    }
  }

  if (valuationIsNotDefensible) {
    if (
      !/(?:\bMissing gates\b|Eksik doğrulama kapıları)/i.test(valuation) ||
      !/(?:\bEvidence acquisition plan\b|Kanıt edinme planı)/i.test(valuation)
    ) {
      throw new Error(
        "Real-estate valuation validation failed: an indefensible valuation must list Missing gates and an Evidence acquisition plan."
      );
    }
    if (
      !/(?:Preliminary due-diligence report|Ön durum tespiti raporu)/i.test(
        report.finalRecommendation
      )
    ) {
      throw new Error(
        "Real-estate evidence validation failed: insufficient valuation evidence must produce a Preliminary due-diligence report."
      );
    }
  }

  if (
    !/^\s*(?:\[Recommendation\]\s*)?(?:Proceed|Proceed Conditionally|Wait|Avoid|Insufficient Evidence|Devam Et|Koşullu Devam Et|Bekle|Kaçın|Kanıt Yetersiz)\b/i.test(
      report.finalRecommendation
    )
  ) {
    throw new Error(
      "Real-estate recommendation validation failed: recommendation must use the approved decision set."
    );
  }

  return report;
}

const TurkishOutputEnglishSystemPattern =
  /\b(?:Validation Required|Not verified|Verified from uploaded asset|Research attempts|Likely domain|Likely content type|Uploaded asset|Missing gates|Evidence acquisition plan|Preliminary due-diligence report|What is known|What was researched|What remains unknown|Top risks|Top opportunities|Next actions)\b/i;
const EnglishSentenceSignals =
  /\b(?:the|and|this|that|with|from|before|after|should|must|could|would|evidence|report|source|property|investment|zoning|title|verified|requires?)\b/gi;
const TurkishSentenceSignals =
  /\b(?:bu|ve|ile|için|önce|sonra|olarak|gerekiyor|gerektirir|doğrulandı|kaynak|taşınmaz|yatırım|imar|tapu|kanıt)\b/gi;

function stripLanguageValidationMetadata(value: string) {
  return value
    .replace(
      /\[(?:Verified from uploaded asset|Verified from official source|Verified from external source|User-provided|Estimate|Unknown|Recommendation)\]/gi,
      ""
    )
    .replace(/\[(?:Asset|Basis|Required|Method|User)\s*:[^\]]*\]/gi, "")
    .replace(/\[R\d+\]/gi, "")
    .replace(/https?:\/\/\S+/gi, "");
}

export function validateRealEstateReportLanguage(
  report: Record<RealEstateReportField, string>,
  language: ResponseLanguage
) {
  const fieldsToRepair = realEstateFields.filter((field) => field !== "sources");
  const repair = repairReportLanguageSections(
    fieldsToRepair.map((field) => ({
      field,
      title: realEstateFieldLabels[language][field],
      content: report[field],
    })),
    language
  );
  for (const section of repair.sections) {
    report[section.field] = section.content;
  }

  const localizedWarning = {
    English:
      "Some wording in this section could not be translated reliably and was omitted.",
    Turkish:
      "Bu bölümdeki bazı ifadeler güvenilir biçimde çevrilemediği için çıkarıldı.",
    German:
      "Einige Formulierungen in diesem Abschnitt konnten nicht zuverlässig übersetzt werden und wurden ausgelassen.",
    French:
      "Certaines formulations de cette section n’ont pas pu être traduites de façon fiable et ont été omises.",
    Spanish:
      "Algunas expresiones de esta sección no pudieron traducirse de forma fiable y se omitieron.",
  }[language];
  for (const field of fieldsToRepair) {
    let removedLanguageMismatch = false;
    const lines = report[field]
      .split(/\n+/)
      .filter((line) => {
        const analyticalLine = stripLanguageValidationMetadata(line).trim();
        if (!analyticalLine) return true;
        const invalid =
          language === "Turkish"
            ? TurkishOutputEnglishSystemPattern.test(analyticalLine) ||
              (analyticalLine.match(EnglishSentenceSignals) || []).length >= 3
            : /[çğıöşüÇĞİÖŞÜ]/.test(analyticalLine) &&
              (analyticalLine.match(TurkishSentenceSignals) || []).length >= 3;
        if (invalid) removedLanguageMismatch = true;
        return !invalid;
      });
    if (removedLanguageMismatch && !lines.includes(localizedWarning)) {
      lines.push(localizedWarning);
    }
    report[field] = lines.join("\n");
  }

  const analyticalLines = realEstateFields
    .filter((field) => field !== "sources")
    .flatMap((field) => report[field].split(/\n+/))
    .map(stripLanguageValidationMetadata)
    .map((line) => line.trim())
    .filter(Boolean);

  if (language === "Turkish") {
    const systemLeak = analyticalLines.find((line) =>
      TurkishOutputEnglishSystemPattern.test(line)
    );
    const EnglishSentence = analyticalLines.find(
      (line) => (line.match(EnglishSentenceSignals) || []).length >= 3
    );
    const invalidLine = systemLeak || EnglishSentence;

    if (invalidLine) {
      console.warn("[report-language] non-fatal real-estate language mismatch", {
        expectedLanguage: "Turkish",
        segment: invalidLine.slice(0, 120),
      });
    }
  } else {
    const TurkishSentence = analyticalLines.find(
      (line) =>
        /[çğıöşüÇĞİÖŞÜ]/.test(line) &&
        (line.match(TurkishSentenceSignals) || []).length >= 3
    );

    if (TurkishSentence) {
      console.warn("[report-language] non-fatal real-estate language mismatch", {
        expectedLanguage: "English",
        segment: TurkishSentence.slice(0, 120),
      });
    }
  }

  return report;
}

export function buildRealEstateInstructions(language: ResponseLanguage) {
  const valuationRule =
    language === "Turkish"
      ? "Değerleme kanıt kapısı karşılanmıyorsa Değerleme Aralığı 'Değerleme Henüz Savunulabilir Değil' ifadesiyle başlamalı, 'Eksik doğrulama kapıları' ve 'Kanıt edinme planı' başlıklarını içermeli; Nihai Tavsiye çıktıyı 'Ön durum tespiti raporu' olarak adlandırmalıdır."
      : "If that valuation gate is not satisfied, Valuation Range must begin with 'Valuation Not Yet Defensible', list 'Missing gates', include an 'Evidence acquisition plan', and Final Recommendation must call the output a Preliminary due-diligence report.";
  const recommendationRule =
    language === "Turkish"
      ? "Nihai Tavsiye tam olarak şu kararlardan biriyle başlamalıdır: Devam Et, Koşullu Devam Et, Bekle, Kaçın, Kanıt Yetersiz."
      : "Final Recommendation must begin with exactly one of: Proceed, Proceed Conditionally, Wait, Avoid, Insufficient Evidence.";

  return [
    "You are the ZERINIX Real Estate Investment Analysis Engine.",
    `Respond entirely in ${language}, but preserve the seven required evidence labels exactly in English.`,
    "Analyze the real-estate asset, not a startup or operating company.",
    `Every factual bullet or paragraph must begin with exactly one evidence label: ${REAL_ESTATE_EVIDENCE_LABELS.map((label) => `[${label}]`).join(", ")}.`,
    "Every non-empty output line, including headings, valuation gates, scenario names, and list items, must begin with one of those evidence labels. Never emit an unlabeled continuation line.",
    "Keep observed evidence, estimates, assumptions, and recommendations in visibly separate bullets or paragraphs.",
    "Do not repeat one Unknown line for every absent field. Preserve every extracted asset fact, use available evidence for decision-relevant findings, and consolidate unresolved critical items in the Missing Information section.",
    "List province, district, neighborhood/locality, block, parcel, parcel area, and property qualification exactly once, only in Extracted Document Facts. Do not repeat those identity values in any other field; refer to that section without restating them.",
    "When official zoning, title/encumbrance, access, infrastructure, hazard, or regional evidence cannot be verified, record it once as missing evidence and invite the user to upload the relevant official document; never expose it as an unanswered user questionnaire.",
    "Never generate ARR, MRR, CAC, LTV, customer-acquisition, founder-readiness, startup-funding, TAM, SAM, SOM, or professional-services metrics.",
    "Never invent financial values, document facts, addresses, parcel identifiers, zoning status, comparable evidence, citations, or legal conclusions.",
    "A valuation is forbidden unless location, parcel size, zoning/use, recent comparable listings or transactions, currency, and calculation method are all supported.",
    valuationRule,
    recommendationRule,
    "Treat uploaded assets as primary evidence for document facts and external research as the evidence base for zoning, access, infrastructure, hazards, market, liquidity, and development findings.",
    "OCR is only the identity seed. In a full report, at least 80% of decision content by visible text must be grounded in official or external research evidence, including recommendations whose basis cites those research records.",
    "Use Unknown or a validation placeholder for a field only after every configured source strategy for that exact field has been exhausted without usable evidence. If any usable evidence exists for the field, synthesize it and move only the residual limitation to Missing Information.",
    "A source homepage or generic provider page is not evidence. Use a source only when it supports a concrete normalized fact.",
    "Do not claim a source conflict unless two distinct usable sources assert incompatible facts about the same field.",
    "Sources must list only usable external evidence. For each source include its title, institution or site name, exact non-homepage URL, and access date. Never list an uploaded filename as a source.",
    language === "Turkish"
      ? "Evidence labels dışında bütün başlık, açıklama, bulgu, risk, fırsat ve tavsiye metnini doğal Türkçe yaz."
      : "Write all headings, explanations, findings, risks, opportunities, and recommendations in English.",
  ].join("\n");
}
