export type DecisionIntelligencePhase =
  | "Intent Detection"
  | "Domain Detection"
  | "Asset Extraction"
  | "Entity Extraction"
  | "Research Planning"
  | "Research Execution"
  | "Evidence Collection"
  | "Cross Validation"
  | "Decision Engine"
  | "Executive Recommendation";

export type DecisionIntelligencePhaseEvent = {
  phase: DecisionIntelligencePhase;
  status: "started" | "completed" | "fallback";
  details?: Record<string, unknown>;
  error?: unknown;
};

export type DecisionIntelligencePhaseLogger = (
  event: DecisionIntelligencePhaseEvent
) => void;

export function runFailSafeDecisionPhase<T>({
  phase,
  execute,
  fallback,
  onPhase,
  completedDetails,
}: {
  phase: DecisionIntelligencePhase;
  execute: () => T;
  fallback: () => T;
  onPhase?: DecisionIntelligencePhaseLogger;
  completedDetails?: (result: T) => Record<string, unknown>;
}) {
  onPhase?.({ phase, status: "started" });

  try {
    const result = execute();
    onPhase?.({
      phase,
      status: "completed",
      details: completedDetails?.(result),
    });
    return result;
  } catch (error) {
    const result = fallback();
    onPhase?.({ phase, status: "fallback", error });
    return result;
  }
}
