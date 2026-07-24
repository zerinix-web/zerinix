import "server-only";

import type { AiRequestKind } from "@/app/lib/ai/governance";

export type AiModelRoutingOperation =
  | "chat"
  | "strategic_chat"
  | "plan_report"
  | "market_report"
  | "executive_report";

export type AiModelRoutingTier = "FAST" | "BALANCED" | "HIGH_QUALITY";

type AiModelRoutingConfig = {
  tiers: Partial<Record<AiModelRoutingTier, string>>;
  operations: Partial<Record<AiModelRoutingOperation, AiModelRoutingTier>>;
};

const defaultOperationTiers: Record<AiModelRoutingOperation, AiModelRoutingTier> = {
  chat: "FAST",
  strategic_chat: "BALANCED",
  plan_report: "HIGH_QUALITY",
  market_report: "HIGH_QUALITY",
  executive_report: "HIGH_QUALITY",
};

const fallbackTierModels: Record<AiModelRoutingTier, string> = {
  FAST: "gpt-5-nano",
  BALANCED: "gpt-5-mini",
  HIGH_QUALITY: "gpt-5-mini",
};

function readJsonConfig(name: string) {
  const raw = process.env[name];

  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readRoutingConfig(): AiModelRoutingConfig {
  const standaloneConfig = readJsonConfig("AI_MODEL_ROUTING_CONFIG");
  const costConfigRouting = readJsonConfig("AI_COST_CONFIG")?.routing;
  const rawConfig =
    standaloneConfig ||
    (costConfigRouting && typeof costConfigRouting === "object"
      ? costConfigRouting as Record<string, unknown>
      : null);
  const rawTiers = rawConfig?.tiers && typeof rawConfig.tiers === "object"
    ? rawConfig.tiers as Record<string, unknown>
    : {};
  const rawOperations = rawConfig?.operations && typeof rawConfig.operations === "object"
    ? rawConfig.operations as Record<string, unknown>
    : {};

  return {
    tiers: Object.fromEntries(
      (["FAST", "BALANCED", "HIGH_QUALITY"] as const)
        .map((tier) => [tier, rawTiers[tier]])
        .filter((entry): entry is [AiModelRoutingTier, string] => typeof entry[1] === "string" && entry[1].trim().length > 0)
        .map(([tier, model]) => [tier, model.trim()])
    ) as Partial<Record<AiModelRoutingTier, string>>,
    operations: Object.fromEntries(
      (["chat", "strategic_chat", "plan_report", "market_report", "executive_report"] as const)
        .map((operation) => [operation, rawOperations[operation]])
        .filter((entry): entry is [AiModelRoutingOperation, AiModelRoutingTier] =>
          entry[1] === "FAST" || entry[1] === "BALANCED" || entry[1] === "HIGH_QUALITY"
        )
    ) as Partial<Record<AiModelRoutingOperation, AiModelRoutingTier>>,
  };
}

export function resolveAiModelForOperation(operation: AiModelRoutingOperation) {
  const config = readRoutingConfig();
  const tier = config.operations[operation] || defaultOperationTiers[operation];
  const model = config.tiers[tier] || fallbackTierModels[tier];

  return model;
}

export function getModelRoutingOperationForRequestKind(
  requestKind: AiRequestKind
): AiModelRoutingOperation {
  if (requestKind === "report_generation") {
    return "plan_report";
  }

  if (requestKind === "market_analysis") {
    return "market_report";
  }

  if (requestKind === "simple_chat") {
    return "chat";
  }

  return "strategic_chat";
}

export function resolveAiModelForRequestKind(requestKind: AiRequestKind) {
  return resolveAiModelForOperation(getModelRoutingOperationForRequestKind(requestKind));
}
