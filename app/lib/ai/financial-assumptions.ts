import {
  createFinancialModel,
  formatFinancialModelValue,
  validateFinancialConsistency,
  type FinancialConsistencyCheck,
  type FinancialMetricModel,
  type FinancialModel,
} from "@/app/lib/ai/financial-model";
import {
  createDecisionConfidenceModel,
  type DecisionConfidenceModel,
} from "@/app/lib/ai/decision-confidence";
import {
  createBenchmarkIntelligenceScore,
  type BenchmarkScore,
} from "@/app/lib/ai/benchmark-intelligence";
import {
  createReportIntelligenceModel,
  type ReportIntelligenceModel,
} from "@/app/lib/ai/report-intelligence";
import {
  createSourceIntelligenceModel,
  type SourceConfidenceLevel,
  type SourceIntelligenceItem,
  type SourceIntelligenceModel,
  type SourceIntelligenceType,
} from "@/app/lib/ai/source-intelligence";
import {
  createValidationIntelligenceModel,
  type ValidationExperiment,
  type ValidationIntelligenceModel,
  type ValidationScore,
  type ValidationType,
} from "@/app/lib/ai/validation-intelligence";
import {
  createInvestmentScore,
  formatInvestmentScore,
  type InvestmentScore,
} from "@/app/lib/ai/investment-score";
import { localizePdfPresentationLabel } from "@/app/lib/pdf-normalization.mjs";
import { getEvidenceLabel, inferEvidenceLevel } from "@/app/lib/report-evidence";

export type ReportKind = "business_plan" | "market_analysis";
export type AiFinancialModelContext = FinancialModel & {
  investmentScore: InvestmentScore;
  financialConsistency: FinancialConsistencyCheck;
  decisionConfidence: DecisionConfidenceModel;
  benchmarkScore: BenchmarkScore;
  reportIntelligence: ReportIntelligenceModel;
  sourceIntelligence: SourceIntelligenceModel;
  validationIntelligence: ValidationIntelligenceModel;
};

function localizeReportLabel(value: string, language: "English" | "Turkish") {
  return localizePdfPresentationLabel(value, language === "Turkish" ? "tr" : "en");
}

export function createCanonicalFinancialAssumptions(input: {
  prompt: string;
  reportKind: ReportKind;
}): AiFinancialModelContext {
  const financialModel = createFinancialModel(input);
  const investmentScore = createInvestmentScore({
    prompt: input.prompt,
    financialModel,
  });
  const financialConsistency = validateFinancialConsistency(financialModel);
  const benchmarkScore = createBenchmarkIntelligenceScore(financialModel);

  const contextWithoutReportIntelligence = {
    ...financialModel,
    investmentScore,
    financialConsistency,
    benchmarkScore,
    decisionConfidence: createDecisionConfidenceModel({
      financialModel,
      investmentScore,
      financialConsistency,
    }),
    sourceIntelligence: createSourceIntelligenceModel({
      financialModel,
      financialConsistency,
    }),
  };
  const validationIntelligence = createValidationIntelligenceModel({
    financialModel,
    financialConsistency,
    sourceIntelligence: contextWithoutReportIntelligence.sourceIntelligence,
    decisionConfidence: contextWithoutReportIntelligence.decisionConfidence,
  });

  return {
    ...contextWithoutReportIntelligence,
    validationIntelligence,
    reportIntelligence: createReportIntelligenceModel({
      ...contextWithoutReportIntelligence,
      validationIntelligence,
    }),
  };
}

function formatMetricRow(metric: FinancialMetricModel, benchmarkSource: string) {
  const formattedValue = formatFinancialModelValue(metric);
  const evidence = getEvidenceLabel(
    inferEvidenceLevel({
      label: metric.label,
      value: formattedValue,
      context: `${metric.formula}; ${metric.assumptions.join("; ")}; ${metric.benchmarkComparison}; confidence=${metric.confidence}`,
    })
  );

  return [
    `- ${metric.label}: ${formattedValue}`,
    `evidence=${evidence}`,
    `formula=${metric.formula}`,
    `assumptions=${metric.assumptions.join("; ")}`,
    `benchmark=${metric.benchmarkComparison}`,
    `benchmarkSource=${benchmarkSource}`,
    `confidence=${metric.confidence}`,
  ].join(" | ");
}

function formatUsd(value: number) {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";

  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${Math.round(abs / 1_000)}k`;

  return `${sign}$${Math.round(abs).toLocaleString("en-US")}`;
}

export function formatCanonicalFinancialAssumptions(
  context: AiFinancialModelContext
) {
  const isMobility = context.inputs.industryKey === "mobility";
  const customerLabel = isMobility ? "active riders" : "customers";
  const monthlyRevenueLabel = isMobility ? "Monthly Revenue" : "MRR";
  const yearlyRevenueLabel = isMobility ? "Yearly Revenue" : "ARR";
  const metricRows = Object.values(context.metrics)
    .map((metric) => formatMetricRow(metric, context.benchmark.basis))
    .join("\n");
  const forecastRows = context.revenueForecast
    .map(
      (year) =>
        `- ${year.year}: ${customerLabel}=${year.customers}, ${monthlyRevenueLabel}=${formatUsd(year.mrr)}, ${yearlyRevenueLabel}=${formatUsd(year.arr)}, revenue=${formatUsd(year.revenue)}, SOM penetration=${Math.round(year.marketPenetration * 100)}%`
    )
    .join("\n");
  const investmentScoreContext = formatInvestmentScore(context.investmentScore);
  const consistency = context.financialConsistency;
  const warningRows = consistency.warnings.length > 0
    ? consistency.warnings.map((warning) => `- ${warning.message} (${warning.evidenceType})`).join("\n")
    : "- No contradictions detected in ARR/MRR, LTV/CAC, payback, burn/runway, funding, or break-even relationships.";

  return `Data-Driven Financial Analysis Engine (${context.version}, ${context.fingerprint})
Business idea fingerprint: ${context.normalizedBusinessIdea}
Detected modeling inputs:
- Industry: ${context.inputs.industry}
- Business model: ${context.inputs.businessModel}
- Target customer: ${context.inputs.targetCustomer}
- Geography: ${context.inputs.geography}
- Pricing model: ${context.inputs.pricingModel}
- Benchmark basis: ${context.benchmark.basis}

Structured financial model:
${metricRows}

Revenue forecast:
${forecastRows}

Financial Quality:
- Status: ${consistency.quality}
- User provided data: ${consistency.sources.userProvidedData.join("; ")}
- Benchmark assumptions: ${consistency.sources.benchmarkAssumptions.join("; ")}
- AI generated planning assumptions: ${consistency.sources.aiPlanningAssumptions.join("; ")}
${warningRows}

	Evidence model:
	- Verified: user-provided facts only, including the submitted idea context (${context.normalizedBusinessIdea}) and any explicit facts stated by the user.
	- Benchmark Derived: industry benchmark ranges, market sizing, growth, margin, CAC, LTV, payback, EBITDA, revenue multiple, and operating assumptions from the selected benchmark basis.
	- Planning Assumption: geography multiplier, serviceable market rate, obtainable share rate, customer count, pricing model, burn rate, runway target, startup capex, and break-even timing where direct user data is absent.
	- Validation Required: metrics or claims that require primary research, customer interviews, pricing tests, cohort data, or real operating data before investment decisions.

${investmentScoreContext}

Financial modeling rules:
- Use the structured financial model above as the single source of truth for all financial metrics.
- Do not replace these values with generic ranges, generic templates, or unrelated benchmarks.
- Explain every major number with its formula, assumptions, benchmark comparison, and evidence label from the canonical set.
- If evidence is Validation Required, explicitly warn that the estimate needs validation instead of presenting it as precise.
- Financial Dashboard, Unit Economics, Scenario Analysis, Executive Summary, Executive Recommendation, KPI Dashboard, and Financial Assumptions must reuse these same values.
- Scenario Analysis may vary these values for worst/base/best cases, but Base Case must match this calculated model exactly.
- Use the Investment Scoring Engine as the source of truth for Total Investment Score, confidence, strengths, weaknesses, Founder Score, and investment recommendation logic.
- Do not invent static investment scores or category scores; reuse the calculated score and category reasoning above.
- Executive Summary and Executive Recommendation must use the calculated Recommendation, Estimated Valuation, Funding Stage, Top Risks, and Next Critical Action from the Investment Scoring Engine.
- For recurring software models, ARR and MRR are appropriate. For mobility, retail, hospitality, manufacturing, and other non-subscription models, use business-model-specific revenue labels from the structured model instead of SaaS labels.
- For revenue, CAC, LTV, Gross Margin, Burn, Runway, EBITDA, and Break-even, show value, formula, assumptions, evidence label, and benchmark source when the section is responsible for financial explanation.
	- Financial Assumptions must be written as a Key Assumptions section that lists every calculation assumption and classifies each as Verified, Benchmark Derived, Planning Assumption, or Validation Required.
	- Tag important claims with one concise evidence label only when useful: Verified, Benchmark Derived, Planning Assumption, or Validation Required. Do not create fake citations.`;
}

export function formatFinancialConsistencyReport(
  context: AiFinancialModelContext,
  language: "English" | "Turkish" = "English"
) {
  const qualityLabel =
    language === "Turkish"
      ? {
          Healthy: "Sağlıklı",
          "Needs Validation": "Doğrulama Gerekli",
          "High Risk": "Yüksek Risk",
        }
      : {
          Healthy: "Healthy",
          "Needs Validation": "Needs Validation",
          "High Risk": "High Risk",
        };
  const warningText = (message: string) => {
    if (language !== "Turkish") {
      return message;
    }

    if (message === "Customer acquisition economics require validation.") {
      return "Müşteri edinme ekonomisi doğrulama gerektiriyor.";
    }

    if (message === "Capital efficiency requires validation.") {
      return "Sermaye verimliliği doğrulama gerektiriyor.";
    }

    if (message === "Financial assumptions are inconsistent.") {
      return "Finansal varsayımlar tutarsız görünüyor.";
    }

    if (message === "CAC payback assumptions require validation.") {
      return "CAC geri ödeme varsayımları doğrulama gerektiriyor.";
    }

    if (message === "Gross margin may not support the current acquisition and burn assumptions.") {
      return "Brüt marj mevcut edinim ve nakit yakımı varsayımlarını desteklemeyebilir.";
    }

    if (message === "Break-even timing requires validation.") {
      return "Başabaş zamanlaması doğrulama gerektiriyor.";
    }

    return message;
  };
  const evidenceTypeText = (type: string) => {
    if (language !== "Turkish") {
      return type;
    }

    if (type === "User Provided Data") return "Kullanıcı Verisi";
    if (type === "Benchmark Assumption") return "Benchmark Varsayımı";

    return "AI Planlama Varsayımı";
  };
  const warnings =
    context.financialConsistency.warnings.length > 0
      ? context.financialConsistency.warnings.map((warning) =>
          `- ${warningText(warning.message)} (${evidenceTypeText(warning.evidenceType)})`
        )
      : [
          language === "Turkish"
            ? "- ARR/MRR, LTV/CAC, geri ödeme, nakit yakımı/finansal pist, fonlama ve başabaş ilişkilerinde çelişki tespit edilmedi."
            : "- No contradictions detected in ARR/MRR, LTV/CAC, payback, burn/runway, funding, or break-even relationships.",
        ];

  return [
    language === "Turkish" ? "Finansal Kalite:" : "Financial Quality:",
    `- ${language === "Turkish" ? "Durum" : "Status"}: ${qualityLabel[context.financialConsistency.quality]}`,
    language === "Turkish" ? "Finansal Uyarılar:" : "Financial Warnings:",
    ...warnings,
    language === "Turkish"
      ? "- Veri ayrımı: kullanıcı verisi, benchmark varsayımları ve AI planlama varsayımları ayrı değerlendirilmiştir."
      : "- Data separation: user provided data, benchmark assumptions, and AI generated planning assumptions are evaluated separately.",
  ].join("\n");
}

export function formatDecisionConfidenceReport(
  context: AiFinancialModelContext,
  language: "English" | "Turkish" = "English"
) {
  const decision = context.decisionConfidence;
  const positiveTitle = language === "Turkish" ? "Pozitif sinyaller:" : "Positive signals:";
  const riskTitle = language === "Turkish" ? "Risk sinyalleri:" : "Risk signals:";
  const translateFactor = (factor: string) => {
    if (language !== "Turkish") {
      return factor;
    }

    if (factor === "Market opportunity is attractive enough to justify validation.") {
      return "Pazar fırsatı doğrulamayı hak edecek kadar cazip.";
    }

    if (factor === "Subscription model creates recurring revenue potential.") {
      return "Abonelik modeli tekrar eden gelir potansiyeli yaratıyor.";
    }

    if (factor === "Business model strength is directionally positive.") {
      return "İş modeli gücü yön olarak olumlu.";
    }

    if (factor === "Gross margin opportunity is attractive.") {
      return "Brüt marj fırsatı cazip.";
    }

    if (factor === "Revenue diversity can reduce single-channel dependence.") {
      return "Gelir çeşitliliği tek kanala bağımlılığı azaltabilir.";
    }

    if (factor === "Validation signals are strong enough to increase decision confidence.") {
      return "Doğrulama sinyalleri karar güvenini artıracak kadar güçlü.";
    }

    if (factor === "Customer validation gaps remain unresolved.") {
      return "Müşteri doğrulama boşlukları devam ediyor.";
    }

    if (factor === "CAC uncertainty remains a material risk.") {
      return "CAC belirsizliği önemli bir risk olmaya devam ediyor.";
    }

    if (factor === "Capital efficiency risk requires validation.") {
      return "Sermaye verimliliği riski doğrulama gerektiriyor.";
    }

    if (factor === "Competitive risk needs stronger proof of defensibility.") {
      return "Rekabet riski daha güçlü savunulabilirlik kanıtı gerektiriyor.";
    }

    if (factor === "Execution complexity could slow the path to proof.") {
      return "Yürütme karmaşıklığı kanıta ulaşma hızını yavaşlatabilir.";
    }

    return factor;
  };

  return [
    `${localizeReportLabel("AI Decision Confidence", language)}:`,
    `${localizeReportLabel("Decision", language)}: ${decision.decision}`,
    `${localizeReportLabel("Confidence", language)}: ${decision.confidenceScore}%`,
    positiveTitle,
    ...(decision.positiveFactors.length > 0
      ? decision.positiveFactors.map((factor) => `- ${translateFactor(factor)}`)
      : [language === "Turkish" ? "- Pozitif sinyal doğrulama gerektiriyor." : "- Positive signals require validation."]),
    riskTitle,
    ...(decision.negativeFactors.length > 0
      ? decision.negativeFactors.map((factor) => `- ${translateFactor(factor)}`)
      : [language === "Turkish" ? "- Belirgin risk sinyali tespit edilmedi." : "- No material risk signal detected."]),
  ].join("\n");
}

export function formatReportIntelligenceSummary(
  context: AiFinancialModelContext,
  language: "English" | "Turkish" = "English"
) {
  const intelligence = context.reportIntelligence;
  const qualityLabel =
    language === "Turkish"
      ? {
          "High Confidence": "Yüksek Güven",
          "Medium Confidence": "Orta Güven",
          "Moderate Confidence": "Orta Güven",
          "Low Confidence": "Düşük Güven",
        }
      : {
          "High Confidence": "High Confidence",
          "Medium Confidence": "Medium Confidence",
          "Moderate Confidence": "Moderate Confidence",
          "Low Confidence": "Low Confidence",
        };
  const translate = (value: string) => {
    if (language !== "Turkish") {
      return value;
    }

    const dictionary: Record<string, string> = {
      "Clear business model": "Net iş modeli",
      "Attractive margin potential": "Cazip marj potansiyeli",
      "Meaningful market opportunity": "Anlamlı pazar fırsatı",
      "Limited customer validation": "Sınırlı müşteri doğrulaması",
      "Financial assumptions require testing": "Finansal varsayımlar test gerektiriyor",
      "Execution readiness needs stronger proof": "Yürütme hazırlığı daha güçlü kanıt gerektiriyor",
      "Decision vs Risk: aggressive recommendation conflicts with unresolved risk signals.":
        "Karar ve risk uyumsuzluğu: agresif tavsiye çözülmemiş risk sinyalleriyle çelişiyor.",
      "Financial vs Recommendation: high funding need and weak validation require caution.":
        "Finansal durum ve tavsiye uyumsuzluğu: yüksek fonlama ihtiyacı ve zayıf doğrulama dikkat gerektiriyor.",
      "Score vs Decision: low confidence does not support an aggressive recommendation.":
        "Skor ve karar uyumsuzluğu: düşük güven agresif tavsiyeyi desteklemiyor.",
      "Report findings are directionally reliable, with limited consistency issues.":
        "Rapor bulguları yön olarak güvenilir ve sınırlı tutarlılık sorunu içeriyor.",
      "Report findings are useful for decision planning, but validation gaps remain.":
        "Rapor bulguları karar planlaması için yararlı, ancak doğrulama boşlukları devam ediyor.",
      "Report findings should be treated as early-stage planning input until evidence improves.":
        "Kanıt seviyesi güçlenene kadar rapor bulguları erken aşama planlama girdisi olarak ele alınmalı.",
      "Evidence base supports directional planning": "Kanıt tabanı yön gösterici planlamayı destekliyor",
      "Source confidence is sufficient for planning": "Kaynak güveni planlama için yeterli",
      "Benchmark fit supports the modeled assumptions": "Benchmark uyumu modellenen varsayımları destekliyor",
      "Source confidence requires stronger validation": "Kaynak güveni daha güçlü doğrulama gerektiriyor",
      "Benchmark fit needs refinement": "Benchmark uyumu netleştirme gerektiriyor",
      "Validation roadmap has unresolved experiments": "Doğrulama yol haritasında tamamlanmamış deneyler var",
      "Collect customer, revenue, retention, or pilot evidence.": "Müşteri, gelir, elde tutma veya pilot kanıtı toplayın.",
      "Attach verified market sources and benchmark references.": "Doğrulanmış pazar kaynakları ve benchmark referansları ekleyin.",
      "Validate CAC, LTV, payback, burn, and runway assumptions.": "CAC, LTV, geri ödeme, nakit yakımı ve finansal pist varsayımlarını doğrulayın.",
      "Refine benchmark selection by industry, model, and geography.": "Benchmark seçimini sektör, model ve coğrafyaya göre netleştirin.",
      "Run the highest-priority validation experiments before scaling.": "Ölçeklemeden önce en yüksek öncelikli doğrulama deneylerini yürütün.",
    };

    return dictionary[value] || value;
  };
  const dimensionLabels =
    language === "Turkish"
      ? {
          evidenceQuality: "Kanıt Kalitesi",
          sourceConfidence: "Kaynak Güveni",
          financialConsistency: "Finansal Tutarlılık",
          benchmarkFit: "Benchmark Uyumu",
          validationReadiness: "Doğrulama Hazırlığı",
        }
      : {
          evidenceQuality: "Evidence Quality",
          sourceConfidence: "Source Confidence",
          financialConsistency: "Financial Consistency",
          benchmarkFit: "Benchmark Fit",
          validationReadiness: "Validation Readiness",
        };

  return [
    `${localizeReportLabel("Report Intelligence", language)}:`,
    `${localizeReportLabel("Report Quality", language)}: ${qualityLabel[intelligence.overallQuality]}`,
    `${localizeReportLabel("Confidence", language)}: ${qualityLabel[intelligence.confidenceLevel]}`,
    `${localizeReportLabel("Quality Score", language)}: ${intelligence.totalScore}/100`,
    `${language === "Turkish" ? "Kalite Boyutları" : "Quality Dimensions"}:`,
    `- ${dimensionLabels.evidenceQuality}: ${intelligence.dimensions.evidenceQuality}/100`,
    `- ${dimensionLabels.sourceConfidence}: ${intelligence.dimensions.sourceConfidence}/100`,
    `- ${dimensionLabels.financialConsistency}: ${intelligence.dimensions.financialConsistency}/100`,
    `- ${dimensionLabels.benchmarkFit}: ${intelligence.dimensions.benchmarkFit}/100`,
    `- ${dimensionLabels.validationReadiness}: ${intelligence.dimensions.validationReadiness}/100`,
    `${localizeReportLabel("Strengths", language)}:`,
    ...(intelligence.strengths.length > 0
      ? intelligence.strengths.map((strength) => `- ${translate(strength)}`)
      : [language === "Turkish" ? "- Güçlü sinyaller doğrulama gerektiriyor." : "- Strengths require validation."]),
    `${localizeReportLabel("Weaknesses", language)}:`,
    ...(intelligence.weaknesses.length > 0
      ? intelligence.weaknesses.map((risk) => `- ${translate(risk)}`)
      : [language === "Turkish" ? "- Kritik kalite riski tespit edilmedi." : "- No critical quality risk detected."]),
    `${language === "Turkish" ? "İyileştirme Aksiyonları" : "Improvement Actions"}:`,
    ...(intelligence.improvementActions.length > 0
      ? intelligence.improvementActions.map((action) => `- ${translate(action)}`)
      : [language === "Turkish" ? "- Ek kalite aksiyonu gerekmiyor." : "- No additional quality action required."]),
    `${localizeReportLabel("Consistency Warnings", language)}:`,
    ...(intelligence.warnings.length > 0
      ? intelligence.warnings.map((warning) => `- ${translate(warning)}`)
      : [language === "Turkish" ? "- Çelişki tespit edilmedi." : "- No contradictions detected."]),
    `${localizeReportLabel("Confidence Summary", language)}: ${translate(intelligence.confidenceSummary)}`,
  ].join("\n");
}

function localizeSourceConfidence(level: SourceConfidenceLevel, language: "English" | "Turkish") {
  if (language !== "Turkish") {
    return level;
  }

  if (level === "High Confidence") return "Yüksek Güven";
  if (level === "Medium Confidence") return "Orta Güven";

  return "Düşük Güven";
}

function localizeSourceType(type: SourceIntelligenceType, language: "English" | "Turkish") {
  if (language !== "Turkish") {
    return type;
  }

  const labels: Record<SourceIntelligenceType, string> = {
    "User Provided": "Kullanıcı Sağladı",
    "Industry Benchmark": "Sektör Benchmarkı",
    "Market Research": "Pazar Araştırması",
    "Competitor Data": "Rakip Verisi",
    "AI Planning Assumption": "AI Planlama Varsayımı",
    "Requires Validation": "Doğrulama Gerektirir",
  };

  return labels[type];
}

function localizeSourceText(value: string, language: "English" | "Turkish") {
  if (language !== "Turkish") {
    return value;
  }

  const dictionary: Record<string, string> = {
    "User provided business context": "Kullanıcı tarafından sağlanan iş bağlamı",
    "Market sizing uses benchmark market scope, serviceable-market rate, and obtainable-share assumptions.":
      "Pazar büyüklüğü benchmark pazar kapsamı, hizmet verilebilir pazar oranı ve elde edilebilir pay varsayımlarını kullanır.",
    "Validate with primary customer research.": "Birincil müşteri araştırmasıyla doğrulayın.",
    "Validate market boundaries with current market research and customer interviews.":
      "Pazar sınırlarını güncel pazar araştırması ve müşteri görüşmeleriyle doğrulayın.",
    "Competitor claims require confirmation from current public company, pricing, and positioning sources.":
      "Rakip iddiaları güncel şirket, fiyatlandırma ve konumlandırma kaynaklarıyla doğrulanmalıdır.",
    "Validate with competitor pricing pages, customer reviews, and direct substitute analysis.":
      "Rakip fiyat sayfaları, müşteri yorumları ve doğrudan ikame analiziyle doğrulayın.",
    "Validate with operating data, supplier quotes, and actual contribution margin.":
      "Operasyon verisi, tedarikçi teklifleri ve gerçek katkı marjıyla doğrulayın.",
    "KPI thresholds are planning inputs until acquisition, activation, retention, and conversion data exists.":
      "Edinim, aktivasyon, elde tutma ve dönüşüm verisi oluşana kadar KPI eşikleri planlama girdisidir.",
    "Validate KPI thresholds with pilot cohorts and funnel tracking.":
      "KPI eşiklerini pilot kohortlar ve funnel takibiyle doğrulayın.",
    "Run willingness-to-pay interviews.": "Ödeme isteği görüşmeleri yapın.",
  };

  return dictionary[value] || value;
}

function formatSourceItem(item: SourceIntelligenceItem, language: "English" | "Turkish") {
  const area = localizeReportLabel(item.area, language);

  return language === "Turkish"
    ? `- ${area}: ${localizeSourceType(item.sourceType, language)} | ${localizeSourceConfidence(item.confidence, language)} | ${localizeSourceText(item.validationRecommendation, language)}`
    : `- ${area}: ${item.sourceType} | ${item.confidence} | ${item.validationRecommendation}`;
}

export function formatSourceIntelligenceSummary(
  context: AiFinancialModelContext,
  language: "English" | "Turkish" = "English"
) {
  const source = context.sourceIntelligence;
  const sectionTitle = localizeReportLabel("Source Intelligence", language);
  const high = source.summary.highConfidence.length > 0
    ? source.summary.highConfidence.map((item) => `- ${localizeSourceText(item, language)}`)
    : [language === "Turkish" ? "- Yüksek güvenli kaynak yok." : "- No high-confidence source available."];
  const medium = source.summary.mediumConfidence.length > 0
    ? source.summary.mediumConfidence.map((item) => `- ${localizeSourceText(item, language)}`)
    : [language === "Turkish" ? "- Orta güvenli kaynak yok." : "- No medium-confidence source available."];
  const low = source.summary.lowConfidence.length > 0
    ? source.summary.lowConfidence.map((item) => `- ${localizeSourceText(item, language)}`)
    : [language === "Turkish" ? "- Düşük güvenli kaynak yok." : "- No low-confidence source available."];

  return [
    `${sectionTitle}:`,
    `${localizeReportLabel("High Confidence", language)}:`,
    ...high,
    `${localizeReportLabel("Medium Confidence", language)}:`,
    ...medium,
    `${localizeReportLabel("Low Confidence", language)}:`,
    ...low,
    `${localizeReportLabel("Validation Recommendations", language)}:`,
    ...source.items.map((item) => formatSourceItem(item, language)),
  ].join("\n");
}

function localizeValidationType(type: ValidationType, language: "English" | "Turkish") {
  if (language !== "Turkish") {
    return type;
  }

  const labels: Record<ValidationType, string> = {
    "Customer Interview": "Müşteri Görüşmesi",
    "Pricing Test": "Fiyatlandırma Testi",
    "Landing Page Test": "Landing Page Testi",
    "Paid Acquisition Test": "Ücretli Edinim Testi",
    "B2B Pilot": "B2B Pilot",
    "Prototype Test": "Prototip Testi",
    "Market Research": "Pazar Araştırması",
  };

  return labels[type];
}

function localizeValidationScore(score: ValidationScore, language: "English" | "Turkish") {
  if (language !== "Turkish") {
    return score;
  }

  if (score === "Validated") return "Doğrulandı";
  if (score === "In Progress") return "Devam Ediyor";

  return "Başlamadı";
}

function localizeValidationText(value: string, language: "English" | "Turkish") {
  if (language !== "Turkish") {
    return value;
  }

  const dictionary: Record<string, string> = {
    "Customer demand exists": "Müşteri talebi var",
    "No customer validation": "Müşteri doğrulaması yok",
    "Run 50 customer interviews": "50 müşteri görüşmesi yap",
    "30%+ strong purchase intent": "%30+ güçlü satın alma niyeti",
    "CAC not validated": "CAC doğrulanmadı",
    "Run a $500 acquisition experiment": "$500 edinim deneyi çalıştır",
    "Willingness to pay not proven": "Ödeme isteği kanıtlanmadı",
    "Test 3 pricing packages": "3 fiyatlandırma paketini test et",
    "20%+ conversion intent": "%20+ dönüşüm niyeti",
    "B2B demand exists": "B2B talep var",
    "B2B demand not proven": "B2B talep kanıtlanmadı",
    "Interview 20 target companies": "20 hedef şirketle görüş",
    "5+ pilot commitments": "5+ pilot taahhüdü",
    "Market positioning converts qualified interest": "Pazar konumlandırması nitelikli ilgiyi dönüştürür",
    "Messaging and conversion not proven": "Mesaj ve dönüşüm kanıtlanmadı",
    "Launch a landing page with one offer and one CTA": "Tek teklif ve tek CTA içeren landing page yayınla",
    "10%+ qualified conversion intent": "%10+ nitelikli dönüşüm niyeti",
    "Market assumptions require validation": "Pazar varsayımları doğrulama gerektiriyor",
    "Market evidence is incomplete": "Pazar kanıtı eksik",
    "Validate competitors, substitutes, and pricing from primary sources":
      "Rakipleri, ikameleri ve fiyatlandırmayı birincil kaynaklardan doğrula",
    "Test the smallest prototype or concierge workflow": "En küçük prototip veya concierge akışını test et",
    "5+ verified competitor/source checks": "5+ doğrulanmış rakip/kaynak kontrolü",
    "5+ qualified users complete the core workflow": "5+ nitelikli kullanıcı temel akışı tamamlar",
  };

  return dictionary[value] || value;
}

function formatValidationExperiment(experiment: ValidationExperiment, language: "English" | "Turkish") {
  return [
    `${language === "Turkish" ? "Öncelik" : "Priority"} ${experiment.priority}: ${localizeValidationText(experiment.assumption, language)}`,
    `${language === "Turkish" ? "Risk" : "Risk"}: ${localizeValidationText(experiment.risk, language)}`,
    `${language === "Turkish" ? "Deney" : "Experiment"}: ${localizeValidationType(experiment.type, language)} — ${localizeValidationText(experiment.action, language)}`,
    `${language === "Turkish" ? "Başarı" : "Success"}: ${localizeValidationText(experiment.successCriteria, language)}`,
    `${language === "Turkish" ? "Durum" : "Status"}: ${localizeValidationScore(experiment.score, language)}`,
  ].join("\n");
}

export function formatValidationIntelligenceSummary(
  context: AiFinancialModelContext,
  language: "English" | "Turkish" = "English"
) {
  return [
    `${localizeReportLabel("Validation Score", language)}: ${localizeValidationScore(context.validationIntelligence.score, language)}`,
    ...context.validationIntelligence.experiments
      .slice(0, 5)
      .map((experiment) => formatValidationExperiment(experiment, language)),
  ].join("\n\n");
}
