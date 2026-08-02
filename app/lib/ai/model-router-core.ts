export type AiTaskCategory =
  | "greeting"
  | "simple_chat"
  | "clarification"
  | "rename"
  | "summarization"
  | "extraction"
  | "translation"
  | "formatting"
  | "research"
  | "report_generation"
  | "strategic_advisory"
  | "market_intelligence"
  | "business_planning"
  | "decision_intelligence"
  | "admin_analysis";

export type AiRoutingQualityTier = "FAST" | "BALANCED" | "HIGH_QUALITY";

export type AiRoutingModels = Record<AiRoutingQualityTier, string>;

export type AiModelRoutingDecision = {
  category: AiTaskCategory;
  tier: AiRoutingQualityTier;
  previousModel: string;
  routedModel: string;
  modelChanged: boolean;
  qualityProtected: boolean;
  reason: string;
};

const categoryTiers: Record<AiTaskCategory, AiRoutingQualityTier> = {
  greeting: "FAST",
  simple_chat: "FAST",
  clarification: "FAST",
  rename: "FAST",
  summarization: "BALANCED",
  extraction: "BALANCED",
  translation: "FAST",
  formatting: "FAST",
  research: "HIGH_QUALITY",
  report_generation: "HIGH_QUALITY",
  strategic_advisory: "HIGH_QUALITY",
  market_intelligence: "HIGH_QUALITY",
  business_planning: "HIGH_QUALITY",
  decision_intelligence: "HIGH_QUALITY",
  admin_analysis: "BALANCED",
};

const defaultInputPricesPerMillion: Record<string, number> = {
  "gpt-5.5": 5,
  "gpt-5-mini": 0.25,
  "gpt-5-nano": 0.05,
  "gpt-5.6-sol": 5,
  "gpt-5.6-terra": 2,
  "gpt-5.6-luna": 0.2,
};

const defaultOutputPricesPerMillion: Record<string, number> = {
  "gpt-5.5": 30,
  "gpt-5-mini": 2,
  "gpt-5-nano": 0.4,
  "gpt-5.6-sol": 30,
  "gpt-5.6-terra": 12,
  "gpt-5.6-luna": 1.2,
};

export function classifyAiTask(prompt: string): AiTaskCategory {
  const value = prompt.trim().toLowerCase();

  if (/^(hi|hello|hey|good (morning|afternoon|evening)|merhaba|selam)[!.?\s]*$/i.test(value)) return "greeting";
  if (/\b(rename|change the (name|title)|yeniden adlandır|adını değiştir)\b/i.test(value)) return "rename";
  if (/\b(translate|translation|çevir|tercüme)\b/i.test(value)) return "translation";
  if (/\b(format|reformat|formatla|biçimlendir)\b/i.test(value)) return "formatting";
  if (/\b(summarize|summary|özetle|özet)\b/i.test(value)) return "summarization";
  if (/\b(extract|parse|identify fields?|çıkar|ayı[kı]la)\b/i.test(value)) return "extraction";
  if (/\b(clarify|clarification|açıkla|netleştir)\b/i.test(value)) return "clarification";
  return "simple_chat";
}

export function getAiTaskQualityTier(category: AiTaskCategory) {
  return categoryTiers[category];
}

function modelCostRank(model: string) {
  const input = defaultInputPricesPerMillion[model];
  const output = defaultOutputPricesPerMillion[model];
  return input !== undefined && output !== undefined ? input + output : null;
}

export function routeAiModel(input: {
  category: AiTaskCategory;
  previousModel: string;
  models: AiRoutingModels;
}): AiModelRoutingDecision {
  const tier = getAiTaskQualityTier(input.category);

  if (tier === "HIGH_QUALITY") {
    return {
      category: input.category,
      tier,
      previousModel: input.previousModel,
      routedModel: input.previousModel,
      modelChanged: false,
      qualityProtected: true,
      reason: "High-value reasoning remains on its existing premium model.",
    };
  }

  const candidate = input.models[tier];
  const previousRank = modelCostRank(input.previousModel);
  const candidateRank = modelCostRank(candidate);
  const canSafelyDowngrade =
    candidate !== input.previousModel &&
    previousRank !== null &&
    candidateRank !== null &&
    candidateRank < previousRank;
  const routedModel = canSafelyDowngrade ? candidate : input.previousModel;

  return {
    category: input.category,
    tier,
    previousModel: input.previousModel,
    routedModel,
    modelChanged: routedModel !== input.previousModel,
    qualityProtected: true,
    reason: canSafelyDowngrade
      ? `Bounded ${input.category} work is routed to the cheaper ${tier} tier.`
      : "The existing model is already as cheap as or cheaper than the configured tier.",
  };
}

export function estimateModelRoutingCost(input: {
  previousModel: string;
  routedModel: string;
  inputTokens: number;
  outputTokens: number;
  monthlyRequests?: number;
  inputPricesPerMillion?: Record<string, number>;
  outputPricesPerMillion?: Record<string, number>;
}) {
  const inputPrices = input.inputPricesPerMillion || defaultInputPricesPerMillion;
  const outputPrices = input.outputPricesPerMillion || defaultOutputPricesPerMillion;
  const estimate = (model: string) =>
    ((input.inputTokens * (inputPrices[model] || 0)) +
      (input.outputTokens * (outputPrices[model] || 0))) /
    1_000_000;
  const estimatedRequestCostBefore = estimate(input.previousModel);
  const estimatedRequestCostAfter = estimate(input.routedModel);
  const estimatedRequestSavings = Math.max(
    0,
    estimatedRequestCostBefore - estimatedRequestCostAfter
  );

  return {
    estimatedRequestCostBefore: Number(estimatedRequestCostBefore.toFixed(8)),
    estimatedRequestCostAfter: Number(estimatedRequestCostAfter.toFixed(8)),
    estimatedRequestSavings: Number(estimatedRequestSavings.toFixed(8)),
    estimatedMonthlySavings: Number(
      (estimatedRequestSavings * (input.monthlyRequests || 0)).toFixed(2)
    ),
  };
}
