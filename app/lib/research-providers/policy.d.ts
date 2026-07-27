import type {
  ResearchProviderRequest,
  ResearchRequestInput,
} from "./model.mjs";

export class UnsafeResearchQueryError extends Error {}

export class ResearchQueryPolicy {
  prepare(input?: ResearchRequestInput): ResearchProviderRequest;
}

