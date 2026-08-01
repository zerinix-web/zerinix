import type {
  ResearchProviderRequest,
  ResearchTask,
  ResearchTaskResult,
} from "../../decision-intelligence/contracts.ts";
import type {
  ProviderExecutionTiming,
  ResearchProviderAdapter,
  ValidatedProviderResult,
} from "./contracts.ts";
import { validateProviderResult } from "./evidence-validator.ts";

type ProviderRun = {
  adapter: ResearchProviderAdapter;
  tasks: ResearchTask[];
};

export type ProviderManagerResult = {
  results: ValidatedProviderResult[];
  timings: ProviderExecutionTiming[];
  unassignedTasks: ResearchTask[];
};

const transientFailure =
  /(?:abort|timeout|timed out|429|5\d\d|econnreset|network|fetch failed|temporar|rate limit)/i;

function linkAbortSignal(parent: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  const timeoutError = new Error(`Research provider timed out after ${timeoutMs}ms.`);
  const abortFromParent = () => controller.abort(parent?.reason);
  const timeout = setTimeout(() => controller.abort(timeoutError), timeoutMs);

  if (parent?.aborted) abortFromParent();
  else parent?.addEventListener("abort", abortFromParent, { once: true });

  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timeout);
      parent?.removeEventListener("abort", abortFromParent);
    },
  };
}

function assignTasks(
  tasks: ResearchTask[],
  adapters: ResearchProviderAdapter[]
): { runs: ProviderRun[]; unassignedTasks: ResearchTask[] } {
  const sorted = [...adapters].sort((a, b) => b.priority - a.priority);
  const grouped = new Map<string, ProviderRun>();
  const unassignedTasks: ResearchTask[] = [];

  for (const task of tasks) {
    const adapter = sorted.find((candidate) => candidate.canExecute(task));
    if (!adapter) {
      unassignedTasks.push(task);
      continue;
    }
    const run = grouped.get(adapter.id) || { adapter, tasks: [] };
    run.tasks.push(task);
    grouped.set(adapter.id, run);
  }

  return { runs: [...grouped.values()], unassignedTasks };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function awaitWithAbort<T>(promise: Promise<T>, signal: AbortSignal) {
  if (signal.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new Error("Research execution was aborted.");
  }
  let rejectForAbort: ((reason?: unknown) => void) | undefined;
  const abortPromise = new Promise<never>((_resolve, reject) => {
    rejectForAbort = reject;
  });
  const onAbort = () =>
    rejectForAbort?.(
      signal.reason instanceof Error
        ? signal.reason
        : new Error("Research execution was aborted.")
    );
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    return await Promise.race([promise, abortPromise]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

async function executeRun({
  run,
  request,
  onTiming,
}: {
  run: ProviderRun;
  request: Omit<ResearchProviderRequest, "tasks">;
  onTiming?: (timing: ProviderExecutionTiming) => void;
}) {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  let attempts = 0;
  let lastError: unknown;

  while (attempts < 2) {
    attempts += 1;
    const linked = linkAbortSignal(request.signal, run.adapter.timeoutMs);
    try {
      const result = await awaitWithAbort(
        run.adapter.execute({
          ...request,
          tasks: run.tasks,
          signal: linked.signal,
        }),
        linked.signal
      );
      const validated = validateProviderResult({
        adapterId: run.adapter.id,
        providerKind: run.adapter.kind,
        result,
      });
      const completedAt = new Date().toISOString();
      const timing: ProviderExecutionTiming = {
        providerKind: run.adapter.kind,
        startedAt,
        completedAt,
        durationMs: Date.now() - started,
        taskCount: run.tasks.length,
        attempts,
        status:
          validated.evidence.length > 0
            ? "completed"
            : validated.taskResults.some((task) => task.status === "failed")
              ? "partial"
              : "completed",
      };
      onTiming?.(timing);
      return { result: validated, timing };
    } catch (error) {
      lastError = error;
      if (attempts >= 2 || !transientFailure.test(errorMessage(error))) break;
    } finally {
      linked.cleanup();
    }
  }

  const completedAt = new Date().toISOString();
  const timedOut = /(?:abort|timeout|timed out)/i.test(errorMessage(lastError));
  const timing: ProviderExecutionTiming = {
    providerKind: run.adapter.kind,
    startedAt,
    completedAt,
    durationMs: Date.now() - started,
    taskCount: run.tasks.length,
    attempts,
    status: timedOut ? "timed_out" : "failed",
  };
  onTiming?.(timing);

  const taskResults: ResearchTaskResult[] = run.tasks.map((task) => ({
    id: task.id,
    field: task.field,
    provider: run.adapter.kind,
    status: timedOut ? "timed_out" : "failed",
    reason: timedOut
      ? "The research source did not respond within its execution window."
      : "The research source could not be completed.",
    confidence: 0,
    providerConfigured: true,
    requestStartedAt: startedAt,
    requestEndedAt: completedAt,
    resultStatus: timedOut ? "timed_out" : "failed",
    sourceTitles: [],
    sourceUrls: [],
    sourceTypes: [],
    officialSourceCount: 0,
    extractedFacts: [],
    timeoutReason: timedOut ? "Provider execution window exceeded." : "",
    notFoundReason: "",
    attempts: [],
  }));

  return {
    result: {
      adapterId: run.adapter.id,
      providerKind: run.adapter.kind,
      confidence: 0,
      evidence: [],
      citations: [],
      metadata: { trustBoundary: "untrusted_external_content" },
      extractedFacts: [],
      attemptedFields: run.tasks.map((task) => task.field),
      unresolvedFields: run.tasks.map((task) => task.field),
      taskResults,
      summary: "One research source was unavailable; remaining sources continued.",
      responseId: "",
    } satisfies ValidatedProviderResult,
    timing,
  };
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>
) {
  const results = new Array<R>(values.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(Math.max(1, concurrency), values.length) },
    async () => {
      while (cursor < values.length) {
        const index = cursor++;
        results[index] = await mapper(values[index]);
      }
    }
  );
  await Promise.all(workers);
  return results;
}

export async function executeProviderTasks({
  tasks,
  adapters,
  request,
  concurrencyLimit = 3,
  onTiming,
}: {
  tasks: ResearchTask[];
  adapters: ResearchProviderAdapter[];
  request: Omit<ResearchProviderRequest, "tasks">;
  concurrencyLimit?: number;
  onTiming?: (timing: ProviderExecutionTiming) => void;
}): Promise<ProviderManagerResult> {
  const { runs, unassignedTasks } = assignTasks(tasks, adapters);
  const completed = await mapWithConcurrency(runs, concurrencyLimit, (run) =>
    executeRun({ run, request, onTiming })
  );

  return {
    results: completed.map((item) => item.result),
    timings: completed.map((item) => item.timing),
    unassignedTasks,
  };
}
