import { z } from "zod";
import {
  documentDomainValues,
  type UniversalDocumentIntelligence,
} from "./universal-document-intelligence.ts";

// Layer 5 of ZERINIX Intelligence: the Decision Intelligence Router.
// This is not another document parser -- it takes layer 4's universal
// UniversalDocumentIntelligence output (plus the user's prompt) and
// decides which *future* intelligence modules are worth running, which
// are not, and why. It never generates a report, never answers the
// user, and never touches report generation; it only returns a
// DecisionPlan object for a later layer to consume. Named
// intelligence-router.ts (not decision-intelligence*) specifically to
// avoid any confusion with the existing, unrelated
// app/lib/decision-intelligence/ subsystem, which this layer does not
// read from or write to.

export const intelligenceModuleValues = [
  "Business Intelligence",
  "Market Intelligence",
  "Financial Intelligence",
  "Legal Intelligence",
  "Technical Intelligence",
  "Medical Intelligence",
  "Real Estate Intelligence",
  "HR Intelligence",
  "Risk Intelligence",
  "Investment Intelligence",
  "Executive Summary",
  "Decision Brief",
] as const;

export type IntelligenceModule = (typeof intelligenceModuleValues)[number];

const priorityValues = ["critical", "high", "medium", "low"] as const;
type Priority = (typeof priorityValues)[number];

const moduleRecommendationSchema = z
  .object({
    module: z.enum(intelligenceModuleValues),
    priority: z.enum(priorityValues),
    rationale: z.string().trim().min(1).max(400),
    confidence: z.number().min(0).max(1),
  })
  .strict();

const excludedModuleSchema = z
  .object({
    module: z.enum(intelligenceModuleValues),
    reason: z.string().trim().min(1).max(400),
  })
  .strict();

const businessValueLevelValues = ["low", "medium", "high", "critical"] as const;

export const decisionPlanSchema = z
  .object({
    detectedIntent: z.string().trim().max(400),
    intentConfidence: z.number().min(0).max(1),
    detectedDomain: z.enum(documentDomainValues),
    recommendedAnalyses: z.array(moduleRecommendationSchema).max(12),
    excludedModules: z.array(excludedModuleSchema).max(12),
    executionPriority: z.array(z.enum(intelligenceModuleValues)).max(12),
    missingEvidence: z.array(z.string().trim().min(1).max(300)).max(20),
    confidence: z.number().min(0).max(1),
    estimatedBusinessValue: z
      .object({
        level: z.enum(businessValueLevelValues),
        rationale: z.string().trim().min(1).max(400),
      })
      .strict(),
  })
  .strict();

export type DecisionPlan = z.infer<typeof decisionPlanSchema>;
export type ModuleRecommendation = z.infer<typeof moduleRecommendationSchema>;

function unique(values: readonly string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

const OBJECTIVE_LANGUAGE =
  /\b(analyze|assess|evaluate|review|decide|invest|hire|sue|diagnose|approve|negotiate|buy|sell|comply|compare|forecast|plan|validate|verify)\b/i;

function detectIntent(prompt: string, doc: UniversalDocumentIntelligence) {
  const trimmedPrompt = prompt.trim();

  if (trimmedPrompt.length >= 8 && OBJECTIVE_LANGUAGE.test(trimmedPrompt)) {
    return { intent: trimmedPrompt.slice(0, 400), confidence: 0.8 };
  }
  if (doc.documentPurpose) {
    return {
      intent: `Understand and act on: ${doc.documentPurpose}`.slice(0, 400),
      confidence: 0.6,
    };
  }
  if (trimmedPrompt) {
    return { intent: trimmedPrompt.slice(0, 400), confidence: 0.4 };
  }
  return {
    intent: "No explicit objective was stated by the user or found in the document.",
    confidence: 0.1,
  };
}

const MONEY_OR_PERCENT_PATTERN = /[$€£₺]|USD|EUR|GBP|TRY|%/;
const INVESTMENT_LANGUAGE = /\b(invest(?:ment)?|return|valuation|acquisition|funding|equity)\b/i;
const MARKET_LANGUAGE = /\b(market|competitor|industry|competitive landscape)\b/i;

type RecommendationBuilder = ModuleRecommendation[];

function addRecommendation(
  list: RecommendationBuilder,
  module: IntelligenceModule,
  priority: Priority,
  rationale: string,
  confidence: number
) {
  if (list.some((item) => item.module === module)) return;
  list.push({ module, priority, rationale, confidence });
}

// Each document domain maps to at most one directly-corresponding
// specialist module; everything else (Risk Intelligence, Investment
// Intelligence, Market Intelligence, Decision Brief, Executive Summary)
// is layered on top from content signals rather than the domain alone,
// so a Financial document that also describes risk gets both Financial
// Intelligence and Risk Intelligence recommended, not just one.
function recommendDomainModule(
  recommended: RecommendationBuilder,
  doc: UniversalDocumentIntelligence
) {
  switch (doc.documentDomain) {
    case "Legal":
    case "Contract":
      addRecommendation(
        recommended,
        "Legal Intelligence",
        "critical",
        `Document domain is ${doc.documentDomain}.`,
        doc.domainConfidence
      );
      return;
    case "Financial":
      addRecommendation(
        recommended,
        "Financial Intelligence",
        "critical",
        "Document domain is Financial.",
        doc.domainConfidence
      );
      return;
    case "Business":
      addRecommendation(
        recommended,
        "Business Intelligence",
        "high",
        "Document domain is Business.",
        doc.domainConfidence
      );
      return;
    case "Medical":
      addRecommendation(
        recommended,
        "Medical Intelligence",
        "critical",
        "Document domain is Medical.",
        doc.domainConfidence
      );
      return;
    case "Technical":
    case "Engineering":
      addRecommendation(
        recommended,
        "Technical Intelligence",
        "high",
        `Document domain is ${doc.documentDomain}.`,
        doc.domainConfidence
      );
      return;
    case "Real Estate":
      addRecommendation(
        recommended,
        "Real Estate Intelligence",
        "high",
        "Document domain is Real Estate.",
        doc.domainConfidence
      );
      return;
    case "HR":
      addRecommendation(
        recommended,
        "HR Intelligence",
        "high",
        "Document domain is HR.",
        doc.domainConfidence
      );
      return;
    case "Government":
      addRecommendation(
        recommended,
        "Legal Intelligence",
        "medium",
        "Government/regulatory documents commonly carry legal or compliance implications.",
        doc.domainConfidence * 0.8
      );
      return;
    case "Spreadsheet":
      addRecommendation(
        recommended,
        "Business Intelligence",
        "medium",
        "Tabular data was detected, but a more specific specialist module cannot be determined without knowing what the data represents.",
        0.4
      );
      return;
    case "Academic":
    case "Unknown":
      return;
  }
}

function recommendContentSignalModules(
  recommended: RecommendationBuilder,
  doc: UniversalDocumentIntelligence
) {
  const hasMoneySignals = doc.entities.numbers.some((value) =>
    MONEY_OR_PERCENT_PATTERN.test(value)
  );
  const investmentContext = [doc.documentPurpose, ...doc.risks, ...doc.decisions].join(" ");

  if (hasMoneySignals && INVESTMENT_LANGUAGE.test(investmentContext)) {
    addRecommendation(
      recommended,
      "Investment Intelligence",
      "medium",
      "Monetary figures combined with investment-related language were found in the visible text.",
      0.55
    );
  }

  if (MARKET_LANGUAGE.test(doc.documentPurpose)) {
    addRecommendation(
      recommended,
      "Market Intelligence",
      "medium",
      "Market or competitor language was found in the document's stated purpose.",
      0.5
    );
  }

  if (doc.risks.length > 0) {
    addRecommendation(
      recommended,
      "Risk Intelligence",
      "high",
      `${doc.risks.length} risk statement(s) were identified in the visible text.`,
      0.7
    );
  }

  if (doc.decisions.length > 0 || doc.obligations.length > 0) {
    addRecommendation(
      recommended,
      "Decision Brief",
      "medium",
      "The document contains decision or obligation statements a decision-maker would need summarized.",
      0.6
    );
  }

  if (recommended.length > 0) {
    addRecommendation(
      recommended,
      "Executive Summary",
      "low",
      "At least one specialist module is recommended; a short executive summary would help a decision-maker triage the results.",
      0.5
    );
  }
}

const MODULE_DOMAIN_HINT: Record<
  Exclude<IntelligenceModule, "Executive Summary" | "Decision Brief">,
  string
> = {
  "Business Intelligence": "business strategy or operations",
  "Market Intelligence": "market, competitor, or industry",
  "Financial Intelligence": "financial statement or accounting",
  "Legal Intelligence": "legal, litigation, or contractual",
  "Technical Intelligence": "technical or engineering",
  "Medical Intelligence": "clinical, patient, or medical",
  "Real Estate Intelligence": "real estate or property",
  "HR Intelligence": "employment or HR",
  "Risk Intelligence": "risk",
  "Investment Intelligence": "investment or valuation",
};

function exclusionReason(module: IntelligenceModule, doc: UniversalDocumentIntelligence) {
  if (module === "Executive Summary") {
    return "No specialist module was recommended, so there is nothing yet to summarize into an executive summary.";
  }
  if (module === "Decision Brief") {
    return "No decision or obligation statements were identified in the visible document, so there is nothing to brief a decision-maker on yet.";
  }
  return `No ${MODULE_DOMAIN_HINT[module]} content was identified in the visible document (detected domain: ${doc.documentDomain}).`;
}

function recommendModules(doc: UniversalDocumentIntelligence) {
  const recommended: RecommendationBuilder = [];
  recommendDomainModule(recommended, doc);
  recommendContentSignalModules(recommended, doc);

  const recommendedModules = new Set(recommended.map((item) => item.module));
  const excludedModules = intelligenceModuleValues
    .filter((module) => !recommendedModules.has(module))
    .map((module) => ({
      module,
      reason: exclusionReason(module, doc),
    }));

  return { recommended, excludedModules };
}

const PRIORITY_RANK: Record<Priority, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

function orderByExecutionPriority(recommended: readonly ModuleRecommendation[]) {
  return [...recommended]
    .sort(
      (a, b) =>
        PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] || b.confidence - a.confidence
    )
    .map((item) => item.module);
}

function estimateBusinessValue(doc: UniversalDocumentIntelligence) {
  let score = 0;
  const reasons: string[] = [];

  if (doc.risks.length > 0) {
    score += 2;
    reasons.push(`${doc.risks.length} risk statement(s) identified`);
  }
  if (doc.decisions.length > 0) {
    score += 1;
    reasons.push(`${doc.decisions.length} decision statement(s) identified`);
  }
  if (doc.obligations.length > 0) {
    score += 1;
    reasons.push(`${doc.obligations.length} obligation statement(s) identified`);
  }
  if (doc.entities.numbers.some((value) => MONEY_OR_PERCENT_PATTERN.test(value))) {
    score += 2;
    reasons.push("monetary or percentage figures are present");
  }
  if (doc.entities.organizations.length > 0) {
    score += 1;
    reasons.push("named organizations are involved");
  }
  if (
    doc.documentDomain === "Legal" ||
    doc.documentDomain === "Financial" ||
    doc.documentDomain === "Contract" ||
    doc.documentDomain === "Real Estate"
  ) {
    score += 1;
    reasons.push(`document domain (${doc.documentDomain}) typically carries material stakes`);
  }

  const level: (typeof businessValueLevelValues)[number] =
    score >= 5 ? "critical" : score >= 3 ? "high" : score >= 1 ? "medium" : "low";

  return {
    level,
    rationale: reasons.length
      ? `${reasons.join("; ")}.`
      : "No strong signals of financial, legal, or operational stakes were found in the visible content.",
  };
}

function overallConfidence(
  domainConfidence: number,
  intentConfidence: number,
  recommended: readonly ModuleRecommendation[]
) {
  const topRecommendationConfidence = recommended.length
    ? Math.max(...recommended.map((item) => item.confidence))
    : 0.2;
  return (
    Math.round(
      ((domainConfidence + intentConfidence + topRecommendationConfidence) / 3) * 100
    ) / 100
  );
}

export function buildDecisionPlan({
  prompt = "",
  documentIntelligence,
}: {
  prompt?: string;
  documentIntelligence: UniversalDocumentIntelligence;
}): DecisionPlan {
  const { intent, confidence: intentConfidence } = detectIntent(prompt, documentIntelligence);
  const { recommended, excludedModules } = recommendModules(documentIntelligence);
  const estimatedBusinessValue = estimateBusinessValue(documentIntelligence);

  const missingEvidence = unique([
    ...documentIntelligence.missingInformation,
    intentConfidence < 0.5
      ? "The user's specific objective, or the decision this analysis should support, was not clearly stated."
      : "",
    documentIntelligence.documentDomain === "Unknown"
      ? "The document's domain could not be confidently determined from the visible content."
      : "",
    recommended.length === 0
      ? "No specialist intelligence module could be confidently recommended from the visible content alone."
      : "",
  ]);

  return {
    detectedIntent: intent,
    intentConfidence,
    detectedDomain: documentIntelligence.documentDomain,
    recommendedAnalyses: recommended,
    excludedModules,
    executionPriority: orderByExecutionPriority(recommended),
    missingEvidence,
    confidence: overallConfidence(
      documentIntelligence.domainConfidence,
      intentConfidence,
      recommended
    ),
    estimatedBusinessValue,
  };
}
