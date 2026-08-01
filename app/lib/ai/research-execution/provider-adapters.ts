import { executeDecisionResearch } from "../../decision-intelligence/research-execution.ts";
import type {
  DecisionResearchProvider,
  DecisionEvidence,
} from "../../decision-intelligence/contracts.ts";
import type {
  AdapterCitation,
  ResearchProviderAdapter,
  ResearchProviderKind,
} from "./contracts.ts";

function citationsFromEvidence(evidence: DecisionEvidence[]): AdapterCitation[] {
  return evidence.flatMap((item) =>
    /^https?:\/\//i.test(item.url)
      ? [
          {
            title: item.title,
            url: item.url,
            excerpt: item.proposition || item.summary,
            accessedAt: item.lastChecked,
          },
        ]
      : []
  );
}

/**
 * Bridges the established Decision Intelligence provider contract into the
 * Phase 4 adapter contract. Existing provider implementations remain intact.
 */
export function createDecisionResearchProviderAdapter(
  provider: DecisionResearchProvider,
  options: {
    kind: ResearchProviderKind;
    priority?: number;
    timeoutMs?: number;
  }
): ResearchProviderAdapter {
  return {
    id: provider.id,
    kind: options.kind,
    priority: options.priority ?? 100,
    timeoutMs: options.timeoutMs ?? 30_000,
    canExecute: (task) => provider.canExecute(task),
    async execute(request) {
      const result = await executeDecisionResearch({
        providers: [provider],
        request,
      });

      return {
        source: result.provider,
        confidence: result.evidence.length
          ? Math.max(...result.evidence.map((item) => item.confidence))
          : 0,
        evidence: result.evidence,
        citations: citationsFromEvidence(result.evidence),
        metadata: {
          responseId: result.responseId,
          providerContract: "decision_intelligence_v1",
        },
        extractedFacts: result.extractedFacts,
        attemptedFields: result.attemptedFields,
        unresolvedFields: result.unresolvedFields,
        taskResults: result.taskResults,
        summary: result.summary,
        responseId: result.responseId,
      };
    },
  };
}
