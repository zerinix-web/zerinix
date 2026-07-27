import type {
  ResearchProvider,
  ResearchProviderKind,
  ResearchProviderRequest,
} from "./model.mjs";
import type { ResearchCostController } from "./cost.mjs";

export class ResearchProviderNotFoundError extends Error {}

export class ResearchProviderRegistry {
  constructor(providers?: ResearchProvider[]);
  register(provider: ResearchProvider): ResearchProvider;
  get(providerId: string): ResearchProvider | null;
  compatible(
    request: ResearchProviderRequest,
    options?: {
      providerId?: string;
      providerKind?: ResearchProviderKind;
    }
  ): ResearchProvider[];
  select(
    request: ResearchProviderRequest,
    options: {
      providerId?: string;
      providerKind?: ResearchProviderKind;
      costController: ResearchCostController;
    }
  ): Promise<ResearchProvider>;
}

