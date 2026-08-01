import type {
  DecisionEvidence,
  ResearchTask,
} from "../../decision-intelligence/contracts.ts";
import { scoreCollectionConfidence, scoreEvidenceConfidence } from "./confidence-scorer.ts";
import type {
  EvidenceCollection,
  NormalizedEvidenceCitation,
  NormalizedEvidenceFinding,
  NormalizedEvidenceSource,
  ProviderExecutionTiming,
  ValidatedProviderResult,
} from "./contracts.ts";

function identity(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function canonicalUrl(value: string) {
  if (!value) return "";
  try {
    const url = new URL(value);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_|fbclid|gclid)/i.test(key)) url.searchParams.delete(key);
    }
    url.hostname = url.hostname.toLowerCase();
    url.pathname = url.pathname.replace(/\/$/, "") || "/";
    return url.toString();
  } catch {
    return "";
  }
}

function tokens(value: string) {
  return new Set(identity(value).split(" ").filter((token) => token.length > 2));
}

function similarity(a: string, b: string) {
  const left = tokens(a);
  const right = tokens(b);
  if (!left.size || !right.size) return 0;
  const overlap = [...left].filter((token) => right.has(token)).length;
  return overlap / new Set([...left, ...right]).size;
}

function dedupeAndMerge(evidence: DecisionEvidence[]) {
  const exact = new Map<string, DecisionEvidence>();
  for (const item of evidence) {
    const key = [
      item.field,
      canonicalUrl(item.url),
      identity(item.proposition || item.summary || item.value),
    ].join("|");
    const current = exact.get(key);
    if (!current || scoreEvidenceConfidence(item) > scoreEvidenceConfidence(current)) {
      exact.set(key, item);
    }
  }

  const merged: DecisionEvidence[] = [];
  for (const item of exact.values()) {
    const match = merged.find(
      (candidate) =>
        candidate.field === item.field &&
        similarity(
          candidate.proposition || candidate.summary,
          item.proposition || item.summary
        ) >= 0.82
    );
    if (!match) {
      merged.push({ ...item });
      continue;
    }
    const stronger =
      scoreEvidenceConfidence(item) > scoreEvidenceConfidence(match) ? item : match;
    const weaker = stronger === item ? match : item;
    Object.assign(match, stronger, {
      supportingData: [
        ...new Set([...stronger.supportingData, ...weaker.supportingData]),
      ].slice(0, 8),
      confidence: Math.max(stronger.confidence, weaker.confidence),
    });
  }
  return merged.sort(
    (a, b) => scoreEvidenceConfidence(b) - scoreEvidenceConfidence(a)
  );
}

function taskForEvidence(tasks: ResearchTask[], evidence: DecisionEvidence) {
  return tasks.find((task) => task.field === evidence.field)?.id || evidence.field;
}

export function mergeEvidenceCollection({
  tasks,
  results,
  seedEvidence = [],
  timings,
  unassignedTasks = [],
}: {
  tasks: ResearchTask[];
  results: ValidatedProviderResult[];
  seedEvidence?: DecisionEvidence[];
  timings: ProviderExecutionTiming[];
  unassignedTasks?: ResearchTask[];
}): { collection: EvidenceCollection; evidence: DecisionEvidence[] } {
  const evidence = dedupeAndMerge([
    ...seedEvidence,
    ...results.flatMap((result) => result.evidence),
  ]);
  const sourceByUrl = new Map<string, NormalizedEvidenceSource>();
  const citationByUrl = new Map<string, NormalizedEvidenceCitation>();

  for (const item of evidence) {
    const url = canonicalUrl(item.url);
    if (!url) continue;
    const sourceId = `source-${sourceByUrl.size + 1}`;
    if (!sourceByUrl.has(url)) {
      sourceByUrl.set(url, {
        id: sourceId,
        title: item.title,
        publisher: item.source,
        url,
        sourceType: item.sourceType || item.category,
        official: item.official,
      });
    }
    const citationId = `citation-${citationByUrl.size + 1}`;
    if (!citationByUrl.has(url)) {
      citationByUrl.set(url, {
        id: citationId,
        title: item.title,
        url,
        excerpt: item.proposition || item.summary,
        accessedAt: item.lastChecked,
      });
    }
  }

  for (const citation of results.flatMap((result) => result.citations)) {
    const url = canonicalUrl(citation.url);
    if (!url || citationByUrl.has(url)) continue;
    citationByUrl.set(url, {
      id: `citation-${citationByUrl.size + 1}`,
      title: citation.title,
      url,
      excerpt: citation.excerpt || "",
      accessedAt: citation.accessedAt || "",
    });
  }

  const findings: NormalizedEvidenceFinding[] = evidence.map((item, index) => {
    const url = canonicalUrl(item.url);
    return {
      id: `finding-${index + 1}`,
      taskId: taskForEvidence(tasks, item),
      field: item.field,
      claim: item.proposition || item.summary,
      evidence: item.value || item.summary,
      confidence: scoreEvidenceConfidence(item),
      sourceIds: url && sourceByUrl.has(url) ? [sourceByUrl.get(url)!.id] : [],
      citationIds:
        url && citationByUrl.has(url) ? [citationByUrl.get(url)!.id] : [],
      official: item.official,
      metadata: {
        impact: item.impact || "unknown",
        authorityLevel: item.authorityLevel || "secondary",
        trustBoundary:
          item.authorityLevel === "uploaded"
            ? "trusted_internal_content"
            : "untrusted_external_content",
      },
    };
  });
  const resolvedFields = new Set(evidence.map((item) => item.field));
  const missingInformation = [
    ...new Set(
      [...tasks, ...unassignedTasks]
        .filter((task) => !resolvedFields.has(task.field))
        .map((task) => task.field)
    ),
  ];
  const warnings = [
    ...(unassignedTasks.length
      ? ["Some planned research tasks had no compatible source adapter."]
      : []),
    ...(results.some((result) => result.taskResults.some((task) =>
      ["failed", "timed_out", "provider_unavailable"].includes(task.status)
    ))
      ? ["Some research sources were unavailable; available evidence was preserved."]
      : []),
  ];

  return {
    evidence,
    collection: {
      findings,
      citations: [...citationByUrl.values()],
      sources: [...sourceByUrl.values()],
      confidenceScore: scoreCollectionConfidence(evidence),
      missingInformation,
      warnings,
      timings,
    },
  };
}
