import type {
  DecisionResearchProvider,
  ResearchProviderRequest,
  ResearchProviderResult,
  ResearchTaskResult,
} from "./contracts";

export async function executeDecisionResearch({
  providers,
  request,
}: {
  providers: DecisionResearchProvider[];
  request: ResearchProviderRequest;
}): Promise<ResearchProviderResult> {
  const selected = providers.find((provider) =>
    request.tasks.every((task) => provider.canExecute(task))
  );

  if (!selected) {
    throw new Error(
      `No research provider can execute all planned tasks: ${request.tasks
        .map((task) => task.id)
        .join(", ")}`
    );
  }

  const result = await selected.execute(request);
  const returnedTaskResults = Array.from(
    new Map(
      (result.taskResults || []).map((task) => [
        task.id,
        {
          ...task,
          provider: task.provider || selected.id,
        },
      ])
    ).values()
  );
  const resultByTask = new Map(
    returnedTaskResults.map((task) => [task.id, task])
  );
  const taskResults = request.tasks.map((task): ResearchTaskResult => {
    const returned = resultByTask.get(task.id);
    const usableEvidence = result.evidence.filter(
      (item) =>
        item.field === task.field &&
        item.verified &&
        Boolean(item.title) &&
        Boolean(item.value) &&
        /^https?:\/\//i.test(item.url)
    );
    const hasUsableEvidence = usableEvidence.length > 0;
    const status = hasUsableEvidence
      ? "completed_with_evidence"
      : returned?.status === "completed_with_evidence"
        ? "completed_no_evidence"
        : returned?.status || "skipped_with_reason";
    const reason =
      status === "completed_no_evidence"
        ? returned?.reason ||
          "Provider execution completed without usable normalized evidence."
        : returned?.reason ||
          "The provider returned no task-level execution record.";

    return {
      id: task.id,
      field: task.field,
      provider: returned?.provider || selected.id,
      status,
      reason,
      confidence: hasUsableEvidence
        ? Math.max(...usableEvidence.map((item) => item.confidence))
        : 0,
      providerConfigured: returned?.providerConfigured ?? true,
      requestStartedAt: returned?.requestStartedAt || "",
      requestEndedAt: returned?.requestEndedAt || "",
      resultStatus: returned?.resultStatus || status,
      sourceTitles: usableEvidence.map((item) => item.title),
      sourceUrls: usableEvidence.map((item) => item.url),
      sourceTypes: usableEvidence.map(
        (item) => item.sourceType || item.category
      ),
      officialSourceCount: usableEvidence.filter((item) => item.official).length,
      extractedFacts: returned?.extractedFacts || [],
      timeoutReason: status === "timed_out" ? reason : "",
      notFoundReason: status === "completed_no_evidence" ? reason : "",
      attempts: returned?.attempts || [],
    };
  });

  return {
    ...result,
    provider: selected.id,
    attemptedFields: [
      ...new Set([
        ...result.attemptedFields,
        ...taskResults
          .filter((task) =>
            [
              "completed_with_evidence",
              "completed_no_evidence",
              "timed_out",
              "failed",
            ].includes(task.status)
          )
          .map((task) => task.field),
      ]),
    ],
    unresolvedFields: [
      ...new Set([
        ...result.unresolvedFields,
        ...taskResults
          .filter((task) => task.status !== "completed_with_evidence")
          .map((task) => task.field),
      ]),
    ],
    taskResults,
  };
}
