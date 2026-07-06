export type AiJobKind = "business_plan" | "market_analysis" | "simple";
export type AiJobStatus = "queued" | "running" | "completed" | "failed";

export type AiJobDescriptor = {
  kind: AiJobKind;
  userId: string;
  endpoint: string;
  reportField?: string;
  promptHash: string;
  language: string;
  model: string;
  status: AiJobStatus;
  createdAt: string;
};

export function createAiJobDescriptor(
  input: Omit<AiJobDescriptor, "status" | "createdAt">
): AiJobDescriptor {
  return {
    ...input,
    status: "queued",
    createdAt: new Date().toISOString(),
  };
}
