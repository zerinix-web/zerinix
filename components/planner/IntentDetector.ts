import { isAmbiguousBusinessRequest } from "@/app/lib/business-idea-detection";
import type {
  ClarificationQuestion,
  UniversalUnderstanding,
} from "@/app/lib/ai/understanding";

export type PlannerIntent =
  | "Business Idea"
  | "Business Expansion"
  | "Market Research"
  | "Competitor Analysis"
  | "Strategic Advisory"
  | "Financial Planning"
  | "Pricing Strategy"
  | "Investment Analysis"
  | "Contract Review"
  | "Legal Document"
  | "Spreadsheet Analysis"
  | "Dashboard Analysis"
  | "Image Analysis"
  | "Website Analysis"
  | "Company Analysis"
  | "Location Intelligence"
  | "Real Estate"
  | "General Chat";

export type RecommendedReportMode = "plan" | "market";

export type DetectableAttachment = {
  name: string;
  size: number;
  textContent?: string;
};

export type DetectedFile = {
  name: string;
  label: string;
  kind:
    | "commercial-contract"
    | "financial-spreadsheet"
    | "business-plan"
    | "pitch-deck"
    | "invoice"
    | "property-document"
    | "image"
    | "document"
    | "spreadsheet";
};

export type IntentRecommendation = {
  intent: PlannerIntent;
  confidence: number;
  analyses: string[];
  reason: string;
  reportMode: RecommendedReportMode;
  detectedFiles: DetectedFile[];
  detectedUrl?: {
    label: string;
    hostname: string;
  };
  understanding?: UniversalUnderstanding;
  clarificationQuestions?: ClarificationQuestion[];
};

type IntentRule = {
  intent: PlannerIntent;
  pattern: RegExp;
  analyses: string[];
  reason: string;
  reportMode: RecommendedReportMode;
  confidence: number;
};

const INTENT_RULES: IntentRule[] = [
  {
    intent: "Contract Review",
    pattern:
      /\b(contract|agreement|nda|lease|terms and conditions|sözleşme|anlaşma|kira sözleşmesi)\b/i,
    analyses: ["Summary", "Risks", "Compliance", "Improvements"],
    reason:
      "Your request appears to involve a commercial agreement. A structured review will surface obligations, risk areas, compliance concerns, and practical improvements.",
    reportMode: "plan",
    confidence: 94,
  },
  {
    intent: "Real Estate",
    pattern:
      /\b(real estate|property|rental yield|cap rate|listing|apartment|villa|gayrimenkul|emlak|konut|daire)\b/i,
    analyses: ["Investment Analysis", "Location Intelligence", "Risk Review"],
    reason:
      "You appear to be evaluating a property or real-estate opportunity. Investment quality, location context, and downside risks are the most relevant lenses.",
    reportMode: "market",
    confidence: 92,
  },
  {
    intent: "Business Expansion",
    pattern:
      /\b(expand|expansion|new market|market entry|enter (?:a |the )?market|internationalize|genişle|genişleme|yeni pazar|pazara giriş)\b/i,
    analyses: ["Market Intelligence", "Entry Strategy", "Competitive Landscape"],
    reason:
      "Your goal is to evaluate growth into a new market. Market attractiveness, entry strategy, and competitive conditions should be assessed together.",
    reportMode: "market",
    confidence: 94,
  },
  {
    intent: "Competitor Analysis",
    pattern:
      /\b(competitor|competition|competitive landscape|benchmark|rakip|rekabet|karşılaştır)\b/i,
    analyses: ["Competitor Mapping", "Positioning", "Opportunity Gaps"],
    reason:
      "Your request centers on competitive context. Mapping alternatives, positioning, and market gaps will provide the clearest strategic view.",
    reportMode: "market",
    confidence: 93,
  },
  {
    intent: "Pricing Strategy",
    pattern:
      /\b(pricing|price point|monetization|subscription price|fiyatlandırma|fiyat stratejisi|ücretlendirme)\b/i,
    analyses: ["Pricing Strategy", "Unit Economics", "Competitive Benchmarking"],
    reason:
      "You are working through a pricing decision. Willingness to pay, unit economics, and competitive benchmarks are the most useful analyses.",
    reportMode: "plan",
    confidence: 93,
  },
  {
    intent: "Financial Planning",
    pattern:
      /\b(financial plan|cash flow|forecast|budget|profitability|runway|revenue model|nakit akışı|finansal plan|bütçe|kârlılık)\b/i,
    analyses: ["Financial Projection", "Cash Flow", "Profitability"],
    reason:
      "Your request is primarily financial. A projection, cash-flow view, and profitability assessment will make the decision more concrete.",
    reportMode: "plan",
    confidence: 92,
  },
  {
    intent: "Investment Analysis",
    pattern:
      /\b(invest|investment|valuation|due diligence|roi|return on investment|yatırım|değerleme|fizibilite)\b/i,
    analyses: ["Investment Readiness", "Return Scenarios", "Risk Analysis"],
    reason:
      "You appear to be assessing an investment decision. Readiness, return scenarios, and material risks are the most relevant analyses.",
    reportMode: "plan",
    confidence: 91,
  },
  {
    intent: "Market Research",
    pattern:
      /\b(market|market size|tam|sam|som|industry|sector|trend|pazar|pazar büyüklüğü|sektör|trend)\b/i,
    analyses: ["Market Intelligence", "Demand Signals", "Competitive Landscape"],
    reason:
      "Your request asks for a clearer view of a market. Market size, demand signals, and the competitive landscape are the strongest starting points.",
    reportMode: "market",
    confidence: 90,
  },
  {
    intent: "Business Idea",
    pattern:
      /\b(business idea|startup idea|new venture|launch a business|validate (?:my |a )?idea|iş fikri|girişim fikri|iş kur|fikrimi doğrula)\b/i,
    analyses: ["Business Validation", "Market Intelligence", "Financial Projection"],
    reason:
      "You are evaluating a new business opportunity. Business validation, market intelligence, and financial projection are the most relevant analyses.",
    reportMode: "plan",
    confidence: 95,
  },
  {
    intent: "Company Analysis",
    pattern:
      /\b(company analysis|analyze (?:this |the )?company|business model analysis|şirket analizi|şirketi analiz)\b/i,
    analyses: ["Company Intelligence", "Business Model", "Competitive Position"],
    reason:
      "Your request focuses on a company. Its business model, market position, and competitive strengths should be reviewed together.",
    reportMode: "market",
    confidence: 89,
  },
  {
    intent: "Strategic Advisory",
    pattern:
      /\b(strategy|strategic|decision|positioning|growth plan|go-to-market|gtm|strateji|stratejik|karar|konumlandırma|büyüme planı)\b/i,
    analyses: ["Strategic Options", "Risk Assessment", "Action Plan"],
    reason:
      "You are working through a strategic decision. Comparing options, risks, and a practical action plan will produce the most useful outcome.",
    reportMode: "plan",
    confidence: 86,
  },
];

const URL_PATTERN = /https?:\/\/[^\s]+|www\.[^\s]+/i;

function normalizeUrl(value: string) {
  const match = value.match(URL_PATTERN)?.[0];

  if (!match) {
    return null;
  }

  try {
    return new URL(match.startsWith("http") ? match : `https://${match}`);
  } catch {
    return null;
  }
}

function detectUrl(url: URL): Omit<IntentRecommendation, "confidence" | "detectedFiles"> & {
  confidence: number;
} {
  const hostname = url.hostname.replace(/^www\./, "");
  const path = url.pathname.toLowerCase();

  if (/google\.[^/]+$/.test(hostname) && /\/maps|maps\./.test(`${hostname}${path}`)) {
    return {
      intent: "Location Intelligence",
      confidence: 96,
      analyses: ["Location Intelligence", "Demand Drivers", "Competitive Density"],
      reason:
        "The link appears to point to Google Maps. Location demand, nearby competition, and commercial fit are the most relevant analyses.",
      reportMode: "market",
      detectedUrl: { label: "Google Maps", hostname },
    };
  }

  if (hostname.includes("linkedin.com")) {
    return {
      intent: "Company Analysis",
      confidence: 94,
      analyses: ["Company Intelligence", "Market Position", "Growth Signals"],
      reason:
        "The LinkedIn link suggests company research. Company signals, positioning, and growth indicators are the most relevant analyses.",
      reportMode: "market",
      detectedUrl: { label: "LinkedIn", hostname },
    };
  }

  if (hostname.includes("amazon.")) {
    return {
      intent: "Market Research",
      confidence: 93,
      analyses: ["Product Intelligence", "Review Signals", "Competitive Pricing"],
      reason:
        "The Amazon link appears to be a product page. Product positioning, customer signals, and competitive pricing are the most useful analyses.",
      reportMode: "market",
      detectedUrl: { label: "Amazon Product", hostname },
    };
  }

  if (
    /\b(listing|property|real-estate|realestate|homes?|apartments?|satilik|kiralik|emlak)\b/i.test(
      `${hostname}${path}`
    )
  ) {
    return {
      intent: "Real Estate",
      confidence: 92,
      analyses: ["Investment Analysis", "Location Intelligence", "Risk Review"],
      reason:
        "The link appears to be a real-estate listing. Investment quality, location context, and downside risks are the most relevant analyses.",
      reportMode: "market",
      detectedUrl: { label: "Real Estate Listing", hostname },
    };
  }

  return {
    intent: "Website Analysis",
    confidence: 88,
    analyses: ["Business Intelligence", "Market Position", "Improvement Opportunities"],
    reason:
      "The link appears to be a company or product website. Business intelligence, positioning, and improvement opportunities are the best starting points.",
    reportMode: "market",
    detectedUrl: { label: "Website", hostname },
  };
}

function detectFile(attachment: DetectableAttachment): DetectedFile {
  const name = attachment.name.toLowerCase();
  const content = attachment.textContent?.toLowerCase() || "";
  const combined = `${name} ${content.slice(0, 3_000)}`;

  if (
    /\.(xlsx?|csv|tsv)$/i.test(name) &&
    /\b(financial|finance|budget|cash|revenue|expense|profit|forecast|finans|bütçe|nakit|gelir|gider)\b/i.test(
      combined
    )
  ) {
    return { name: attachment.name, label: "Financial Spreadsheet", kind: "financial-spreadsheet" };
  }

  if (/\.(xlsx?|csv|tsv)$/i.test(name)) {
    return { name: attachment.name, label: "Spreadsheet", kind: "spreadsheet" };
  }

  if (
    /\b(contract|agreement|nda|lease|sözleşme|anlaşma)\b/i.test(combined) &&
    /\.(pdf|docx?|txt)$/i.test(name)
  ) {
    return { name: attachment.name, label: "Commercial Contract", kind: "commercial-contract" };
  }

  if (
    /\b(land registry|title deed|deed|property record|tapu|tapu senedi|imar|zoning)\b/i.test(
      combined
    )
  ) {
    return {
      name: attachment.name,
      label: "Land Registry Document",
      kind: "property-document",
    };
  }

  if (/\b(invoice|receipt|bill|fatura|makbuz|fiş)\b/i.test(combined)) {
    return { name: attachment.name, label: "Invoice", kind: "invoice" };
  }

  if (/\b(pitch|investor deck|fundraising|yatırımcı sunumu)\b/i.test(combined)) {
    return { name: attachment.name, label: "Pitch Deck", kind: "pitch-deck" };
  }

  if (/\b(business plan|iş planı)\b/i.test(combined)) {
    return { name: attachment.name, label: "Business Plan", kind: "business-plan" };
  }

  if (/\.(png|jpe?g|webp|gif|heic|avif)$/i.test(name)) {
    const imageLabel =
      /\breceipt|fiş|makbuz\b/i.test(name)
        ? "Receipt Image"
        : /\binvoice|fatura\b/i.test(name)
          ? "Invoice Image"
          : /\bproperty|house|apartment|villa|listing|emlak|daire|konut\b/i.test(name)
            ? "Property Image"
            : /\bchart|graph|dashboard|grafik|panel\b/i.test(name)
              ? "Chart Image"
              : /\bscreenshot|screen[-_ ]?shot|ekran\b/i.test(name)
                ? "Screenshot"
                : /\bdocument|scan|form|belge|evrak\b/i.test(name)
                  ? "Document Image"
                  : /\bproduct|item|ürün\b/i.test(name)
                    ? "Product Image"
                    : "Image";

    return { name: attachment.name, label: imageLabel, kind: "image" };
  }

  return { name: attachment.name, label: "Document", kind: "document" };
}

function recommendationForFile(file: DetectedFile) {
  switch (file.kind) {
    case "commercial-contract":
      return {
        intent: "Contract Review" as const,
        confidence: 95,
        analyses: ["Summary", "Risks", "Compliance", "Improvements"],
        reason:
          "The attached file appears to be a commercial contract. A structured review can surface obligations, risks, compliance concerns, and practical improvements.",
        reportMode: "plan" as const,
      };
    case "financial-spreadsheet":
      return {
        intent: "Financial Planning" as const,
        confidence: 94,
        analyses: ["Dashboard", "Forecast", "Cash Flow", "Profitability"],
        reason:
          "The attached file appears to contain financial data. A dashboard, forecast, cash-flow review, and profitability analysis are the most relevant next steps.",
        reportMode: "plan" as const,
      };
    case "spreadsheet":
      return {
        intent: "Spreadsheet Analysis" as const,
        confidence: 92,
        analyses: ["Dashboard", "Forecast", "Profitability", "Cash Flow"],
        reason:
          "The attached spreadsheet is best understood through a structured dashboard, forecast, profitability review, and cash-flow analysis.",
        reportMode: "plan" as const,
      };
    case "business-plan":
      return {
        intent: "Business Idea" as const,
        confidence: 95,
        analyses: ["Executive Summary", "SWOT", "Financial Review"],
        reason:
          "The attached file appears to be a business plan. An executive summary, SWOT, and financial review will reveal its strongest claims and biggest gaps.",
        reportMode: "plan" as const,
      };
    case "pitch-deck":
      return {
        intent: "Investment Analysis" as const,
        confidence: 94,
        analyses: ["Investor Readiness", "Market Position", "Weakness Detection"],
        reason:
          "The attached file appears to be a pitch deck. Investor readiness, market position, and weakness detection are the most useful review lenses.",
        reportMode: "plan" as const,
      };
    case "invoice":
      return {
        intent: "Financial Planning" as const,
        confidence: 94,
        analyses: ["Data Extraction", "Payment Review", "Tax Review", "Anomalies"],
        reason:
          "The attached file appears to be an invoice or receipt. Extracting the key fields, reviewing payment and tax details, and checking anomalies are the most relevant next steps.",
        reportMode: "plan" as const,
      };
    case "property-document":
      return {
        intent: "Real Estate" as const,
        confidence: 95,
        analyses: [
          "Investment Analysis",
          "Risk Analysis",
          "Valuation",
          "Planning Review",
        ],
        reason:
          "The attached file appears to be a land registry or property document. Investment quality, legal and planning risks, valuation factors, and development constraints should be reviewed together.",
        reportMode: "market" as const,
      };
    case "image":
      if (file.label === "Receipt Image" || file.label === "Invoice Image") {
        return {
          intent: "Image Analysis" as const,
          confidence: 92,
          analyses: ["Data Extraction", "Expense Summary", "Anomaly Review"],
          reason:
            "The attached image appears to be a receipt or invoice. Extracting key fields, summarizing the transaction, and checking anomalies are the most relevant next steps.",
          reportMode: "plan" as const,
        };
      }

      if (file.label === "Property Image") {
        return {
          intent: "Real Estate" as const,
          confidence: 90,
          analyses: ["Property Review", "Investment Factors", "Risk Signals"],
          reason:
            "The attached image appears to show a property. A property review, investment-factor assessment, and visible risk check are the strongest starting points.",
          reportMode: "market" as const,
        };
      }

      if (file.label === "Chart Image") {
        return {
          intent: "Dashboard Analysis" as const,
          confidence: 91,
          analyses: ["Trend Interpretation", "Key Metrics", "Anomaly Detection"],
          reason:
            "The attached image appears to contain a chart or dashboard. Trend interpretation, key metrics, and anomaly detection are the most useful analyses.",
          reportMode: "plan" as const,
        };
      }

      return {
        intent: "Image Analysis" as const,
        confidence: 88,
        analyses: ["Content Detection", "Key Details", "Recommended Actions"],
        reason:
          "An image is attached. ZERINIX will first identify its likely content, then extract the key details and recommend the most relevant next action.",
        reportMode: "plan" as const,
      };
    default:
      return {
        intent: "Legal Document" as const,
        confidence: 82,
        analyses: ["Summary", "Key Findings", "Risks"],
        reason:
          "A document is attached. A concise summary, key findings, and risk review are the strongest starting points before deeper analysis.",
        reportMode: "plan" as const,
      };
  }
}

export function detectPlannerIntent({
  prompt,
  attachments = [],
}: {
  prompt: string;
  attachments?: DetectableAttachment[];
}): IntentRecommendation {
  const detectedFiles = attachments.map(detectFile);
  const primaryFile = detectedFiles[0];

  if (primaryFile) {
    return {
      ...recommendationForFile(primaryFile),
      detectedFiles,
    };
  }

  const url = normalizeUrl(prompt);

  if (url) {
    return {
      ...detectUrl(url),
      detectedFiles,
    };
  }

  const matchingRule = INTENT_RULES.find((rule) => rule.pattern.test(prompt));

  if (matchingRule) {
    if (
      matchingRule.intent === "Business Idea" &&
      isAmbiguousBusinessRequest(prompt)
    ) {
      return {
        intent: "Business Idea",
        confidence: 78,
        analyses: ["Clarify Business Idea", "Opportunity Discovery", "Market Signals"],
        reason:
          "You want to explore a business idea, but the opportunity is still broad. Clarifying the concept and target customer before deeper analysis will produce a stronger result.",
        reportMode: "plan",
        detectedFiles,
      };
    }

    return {
      intent: matchingRule.intent,
      confidence: matchingRule.confidence,
      analyses: matchingRule.analyses,
      reason: matchingRule.reason,
      reportMode: matchingRule.reportMode,
      detectedFiles,
    };
  }

  return {
    intent: "General Chat",
    confidence: prompt.trim().split(/\s+/).length >= 5 ? 82 : 74,
    analyses: ["Clarify Goal", "Strategic Options", "Recommended Next Steps"],
    reason:
      "Your request is open-ended. Continuing as a conversation will help clarify the goal, compare useful options, and identify the best next step.",
    reportMode: "plan",
    detectedFiles,
  };
}

function plannerIntentFromUnderstanding(
  understanding: UniversalUnderstanding,
  fallbackIntent: PlannerIntent
): PlannerIntent {
  if (understanding.detectedContentType === "contract") return "Contract Review";
  if (understanding.detectedIndustry === "real_estate") return "Real Estate";
  if (understanding.detectedContentType === "spreadsheet") return "Spreadsheet Analysis";
  if (understanding.detectedContentType === "financial_statement") return "Financial Planning";
  if (understanding.detectedContentType === "image") return "Image Analysis";
  if (understanding.detectedContentType === "url") return "Website Analysis";
  if (understanding.detectedContentType === "business_idea") return "Business Idea";
  if (understanding.recommendedAction === "chat") return "General Chat";
  return fallbackIntent;
}

export function recommendationFromUnderstanding({
  understanding,
  prompt,
  attachments = [],
}: {
  understanding: UniversalUnderstanding;
  prompt: string;
  attachments?: DetectableAttachment[];
}): IntentRecommendation {
  const localRecommendation = detectPlannerIntent({ prompt, attachments });
  const Turkish =
    /[çğıöşüÇĞİÖŞÜ]/.test(prompt) ||
    /\b(?:bu|bir|için|istiyorum|analiz|rapor)\b/i.test(prompt);
  const industryLabel = Turkish && understanding.detectedIndustry === "real_estate"
    ? "gayrimenkul"
    : understanding.detectedIndustry.replace(/_/g, " ");
  const contentLabel =
    Turkish && understanding.detectedContentType === "property_document"
      ? "gayrimenkul belgesi"
      : understanding.detectedContentType.replace(/_/g, " ");
  const detectedFiles =
    understanding.detectedContentType === "property_document"
      ? localRecommendation.detectedFiles.map((file) =>
          file.kind === "image"
            ? {
                ...file,
                label: Turkish ? "Gayrimenkul Belgesi" : "Property Document",
                kind: "property-document" as const,
              }
            : file
        )
      : localRecommendation.detectedFiles;

  return {
    ...localRecommendation,
    intent: plannerIntentFromUnderstanding(
      understanding,
      localRecommendation.intent
    ),
    confidence: Math.round(understanding.confidence * 100),
    analyses: understanding.suggestedReportTypes,
    reason: Turkish
      ? `ZERINIX bu girdiyi olası "${industryLabel}" alanında "${contentLabel}" içeriği olarak değerlendirdi. Tahmini amaç: ${understanding.detectedIntent}.`
      : `ZERINIX assessed this as likely ${contentLabel} content in the ${industryLabel} domain. Inferred goal: ${understanding.detectedIntent}.`,
    reportMode:
      understanding.detectedIndustry === "real_estate"
        ? "plan"
        : localRecommendation.reportMode,
    detectedFiles,
    understanding,
    clarificationQuestions: understanding.clarificationQuestions,
  };
}
