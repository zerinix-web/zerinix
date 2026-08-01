import OpenAI from "openai";
import { logOperationalInfo } from "@/app/lib/security/logging";

export type AiRuntimeEnvironment = "development" | "production" | "test";
export type AiExecutionSource = "mock" | "cache" | "real_ai";

const devUsage = {
  day: "",
  month: "",
  dailyRequests: 0,
  monthlyRequests: 0,
};

function currentUtcDay() {
  return new Date().toISOString().slice(0, 10);
}

function currentUtcMonth() {
  return new Date().toISOString().slice(0, 7);
}

function readPositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export function getAiRuntimeEnvironment(): AiRuntimeEnvironment {
  if (process.env.AI_TEST_MODE === "true") {
    return "test";
  }

  const developmentMode = process.env.DEVELOPMENT_MODE === "true";
  const productionMode = process.env.PRODUCTION_MODE === "true";

  if (developmentMode && productionMode) {
    throw new Error("Only one AI environment mode can be enabled.");
  }

  if (developmentMode) {
    return "development";
  }

  if (productionMode) {
    return "production";
  }

  return process.env.NODE_ENV === "production" ? "production" : "development";
}

function enforceDevelopmentBudget() {
  const day = currentUtcDay();
  const month = currentUtcMonth();

  if (devUsage.day !== day) {
    devUsage.day = day;
    devUsage.dailyRequests = 0;
  }

  if (devUsage.month !== month) {
    devUsage.month = month;
    devUsage.monthlyRequests = 0;
  }

  const dailyLimit = readPositiveInt(process.env.AI_DEV_DAILY_REQUEST_LIMIT, 100000);
  const monthlyLimit = readPositiveInt(process.env.AI_DEV_MONTHLY_REQUEST_LIMIT, 100);

  if (devUsage.dailyRequests >= dailyLimit) {
    throw new Error("Development AI daily budget exceeded.");
  }

  if (devUsage.monthlyRequests >= monthlyLimit) {
    throw new Error("Development AI monthly budget exceeded.");
  }

  devUsage.dailyRequests += 1;
  devUsage.monthlyRequests += 1;
}

export function getOpenAiApiKey() {
  const environment = getAiRuntimeEnvironment();

  if (environment === "test") {
    return { environment, apiKey: "", usesMock: true };
  }

  const devKey = process.env.OPENAI_API_KEY_DEV;
  const prodKey = process.env.OPENAI_API_KEY_PROD;

  if (environment === "development") {
    if (prodKey) {
      throw new Error("OPENAI_API_KEY_PROD must not be present during development AI calls.");
    }

    if (!devKey) {
      throw new Error("OPENAI_API_KEY_DEV is required for development AI calls.");
    }

    enforceDevelopmentBudget();

    return { environment, apiKey: devKey, usesMock: false };
  }

  if (devKey) {
    throw new Error("OPENAI_API_KEY_DEV must not be present during production AI calls.");
  }

  if (!prodKey) {
    throw new Error("OPENAI_API_KEY_PROD is required for production AI calls.");
  }

  return { environment, apiKey: prodKey, usesMock: false };
}

export function createOpenAiClient() {
  const { apiKey } = getOpenAiApiKey();

  return new OpenAI({ apiKey });
}

export function getAiConfigurationErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "";

  if (
    message.includes("OPENAI_API_KEY") ||
    message.includes("AI environment mode") ||
    message.includes("AI model routing")
  ) {
    return message;
  }

  return "";
}

export function isAiTestMode() {
  return getAiRuntimeEnvironment() === "test";
}

export function logAiExecution(input: {
  endpoint: string;
  source: AiExecutionSource;
  mode: string;
  model?: string;
  cacheHit?: boolean;
}) {
  logOperationalInfo("[ai runtime]", {
    endpoint: input.endpoint,
    source: input.source,
    Environment: getAiRuntimeEnvironment().toUpperCase(),
    mode: input.mode,
    model: input.model ?? null,
    cacheHit: input.cacheHit ?? input.source === "cache",
  });
}
