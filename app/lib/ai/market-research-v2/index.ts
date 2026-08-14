// Market Intelligence Research V2 -- orchestrator.
//
// The whole pipeline in one place: user query -> research plan -> web
// research execution -> normalized evidence objects -> evidence
// completeness check -> DomainResearchBundle for the existing report
// generator. Gated behind ENABLE_MARKET_INTELLIGENCE_RESEARCH_V2 so it is
// only ever reachable for Market Intelligence, and only when explicitly
// turned on; every other report type and the pre-V2 pipeline are
// untouched.
import type OpenAI from "openai";
import type { ResponseLanguage } from "@/app/lib/report-language";
import { buildMarketResearchTasks } from "../market-research-planner.ts";
import {
  createExpertiseProfileFallback,
  resolveExpertiseProfile,
  type ExpertiseProfile,
} from "../expertise-profile.ts";
import {
  createDynamicReportPlanFallback,
  resolveDynamicReportPlan,
  type DynamicReportPlan,
} from "../dynamic-report-plan.ts";
import type { AnalysisAsset } from "../analysis-assets.ts";
import type { DomainResearchBundle } from "../domain-research.ts";
import { executeMarketResearchTask } from "./execute.ts";
import { assessMarketEvidenceCompleteness } from "./completeness.ts";
import { buildMarketResearchV2Bundle } from "./adapter.ts";
import type { MarketFieldResearchOutcome } from "./types.ts";

export function isMarketResearchV2Enabled() {
  return process.env.ENABLE_MARKET_INTELLIGENCE_RESEARCH_V2 === "true";
}

const V2_TASK_CONCURRENCY_LIMIT = 4;
const V2_TASK_TIMEOUT_MS = 45_000;

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from(
      { length: Math.min(Math.max(1, limit), Math.max(1, items.length)) },
      async () => {
        while (cursor < items.length) {
          const index = cursor++;
          results[index] = await worker(items[index]!);
        }
      }
    )
  );
  return results;
}

function withTaskTimeout(parentSignal: AbortSignal | undefined) {
  const controller = new AbortController();
  const onAbort = () => controller.abort(parentSignal?.reason);
  if (parentSignal?.aborted) controller.abort(parentSignal.reason);
  else parentSignal?.addEventListener("abort", onAbort, { once: true });
  const timeoutId = setTimeout(
    () => controller.abort(new Error("Market research v2 task timed out.")),
    V2_TASK_TIMEOUT_MS
  );
  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timeoutId);
      parentSignal?.removeEventListener("abort", onAbort);
    },
  };
}

export type MarketResearchV2Input = {
  client: OpenAI;
  model: string;
  prompt: string;
  assets: AnalysisAsset[];
  language: ResponseLanguage;
  signal?: AbortSignal;
  expertiseProfile?: ExpertiseProfile;
  reportPlan?: DynamicReportPlan;
};

export async function runMarketIntelligenceResearchV2({
  client,
  model,
  prompt,
  assets,
  signal,
  expertiseProfile: requestedExpertiseProfile,
  reportPlan: requestedReportPlan,
}: MarketResearchV2Input): Promise<DomainResearchBundle> {
  const expertiseProfile = resolveExpertiseProfile(
    requestedExpertiseProfile,
    createExpertiseProfileFallback({ prompt, assets, selectedMode: "market" }),
    "market"
  );
  const reportPlanFallback = createDynamicReportPlanFallback({
    expertiseProfile,
    selectedMode: "market",
    prompt,
  });
  const reportPlan = resolveDynamicReportPlan({
    value: requestedReportPlan,
    fallback: reportPlanFallback,
    expertiseProfile,
    selectedMode: "market",
  });

  const tasks = buildMarketResearchTasks({ expertiseProfile, reportPlan, prompt });

  const outcomes: MarketFieldResearchOutcome[] = await mapWithConcurrency(
    tasks,
    V2_TASK_CONCURRENCY_LIMIT,
    async (task) => {
      const linked = withTaskTimeout(signal);
      try {
        return await executeMarketResearchTask({
          client,
          model,
          task,
          signal: linked.signal,
        });
      } finally {
        linked.cleanup();
      }
    }
  );

  const completeness = assessMarketEvidenceCompleteness(outcomes);
  return buildMarketResearchV2Bundle({ outcomes, completeness });
}
