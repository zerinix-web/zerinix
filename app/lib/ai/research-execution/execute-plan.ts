import type {
  DecisionEvidence,
  ExtractedFact,
  ResearchProviderRequest,
  ResearchTask,
  ResearchTaskResult,
} from "../../decision-intelligence/contracts.ts";
import type {
  ProviderExecutionTiming,
  ResearchExecutionResult,
  ResearchProviderAdapter,
} from "./contracts.ts";
import { mergeEvidenceCollection } from "./evidence-merger.ts";
import { executeProviderTasks } from "./provider-manager.ts";

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function taskResultsAfterValidation({
  tasks,
  evidence,
  returned,
  unassigned,
}: {
  tasks: ResearchTask[];
  evidence: DecisionEvidence[];
  returned: ResearchTaskResult[];
  unassigned: Set<string>;
}) {
  const byId = new Map(returned.map((result) => [result.id, result]));
  return tasks.map((task): ResearchTaskResult => {
    const existing = byId.get(task.id);
    const usable = evidence.filter((item) => item.field === task.field);
    const now = new Date().toISOString();
    const status = usable.length
      ? "completed_with_evidence"
      : unassigned.has(task.id)
        ? "provider_unavailable"
        : existing?.status === "timed_out" || existing?.status === "failed"
          ? existing.status
          : "completed_no_evidence";
    return {
      id: task.id,
      field: task.field,
      provider: existing?.provider || "research_execution_engine",
      status,
      reason:
        status === "completed_with_evidence"
          ? "Validated evidence was collected."
          : existing?.reason ||
            (status === "provider_unavailable"
              ? "No compatible research source was available."
              : "Execution completed without valid evidence."),
      confidence: usable.length
        ? Math.max(...usable.map((item) => item.confidence))
        : 0,
      providerConfigured: status !== "provider_unavailable",
      requestStartedAt: existing?.requestStartedAt || now,
      requestEndedAt: existing?.requestEndedAt || now,
      resultStatus: status,
      sourceTitles: usable.map((item) => item.title),
      sourceUrls: usable.map((item) => item.url).filter(Boolean),
      sourceTypes: usable.map((item) => item.sourceType || item.category),
      officialSourceCount: usable.filter((item) => item.official).length,
      extractedFacts: existing?.extractedFacts || [],
      timeoutReason: status === "timed_out" ? existing?.timeoutReason || "" : "",
      notFoundReason:
        status === "completed_no_evidence" ? existing?.notFoundReason || existing?.reason || "" : "",
      attempts: existing?.attempts || [],
    };
  });
}

export async function executeResearchPlan({
  tasks,
  request,
  adapters,
  seedEvidence = [],
  concurrencyLimit = 3,
  onTiming,
}: {
  tasks: ResearchTask[];
  request: Omit<ResearchProviderRequest, "tasks">;
  adapters: ResearchProviderAdapter[];
  seedEvidence?: DecisionEvidence[];
  concurrencyLimit?: number;
  onTiming?: (timing: ProviderExecutionTiming) => void;
}): Promise<ResearchExecutionResult> {
  const managed = await executeProviderTasks({
    tasks,
    adapters,
    request,
    concurrencyLimit,
    onTiming,
  });
  const merged = mergeEvidenceCollection({
    tasks,
    results: managed.results,
    seedEvidence,
    timings: managed.timings,
    unassignedTasks: managed.unassignedTasks,
  });
  const taskResults = taskResultsAfterValidation({
    tasks,
    evidence: merged.evidence,
    returned: managed.results.flatMap((result) => result.taskResults),
    unassigned: new Set(managed.unassignedTasks.map((task) => task.id)),
  });
  const extractedFacts = managed.results.flatMap(
    (result) => result.extractedFacts
  ).filter((fact, index, facts) =>
    facts.findIndex((candidate) =>
      candidate.field === fact.field &&
      candidate.value === fact.value &&
      candidate.source === fact.source
    ) === index
  ) as ExtractedFact[];

  return {
    collection: merged.collection,
    evidence: merged.evidence,
    extractedFacts,
    attemptedFields: unique([
      ...managed.results.flatMap((result) => result.attemptedFields),
      ...taskResults
        .filter((task) => task.status !== "provider_unavailable")
        .map((task) => task.field),
    ]),
    unresolvedFields: unique([
      ...merged.collection.missingInformation,
      ...managed.results.flatMap((result) => result.unresolvedFields),
    ]).filter((field) => !merged.evidence.some((item) => item.field === field)),
    taskResults,
    summary:
      managed.results.map((result) => result.summary).filter(Boolean).join("\n") ||
      "Research execution completed without additional external evidence.",
    responseId: unique(
      managed.results.map((result) => result.responseId)
    ).join(","),
  };
}
