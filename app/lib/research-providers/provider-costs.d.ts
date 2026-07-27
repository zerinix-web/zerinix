export type ResearchProviderPricing = {
  perRequestUsd: number;
  perResultUsd: number;
};

export const DEFAULT_PROVIDER_COSTS: Readonly<
  Record<"Tavily" | "Exa" | "Bing" | "Other", ResearchProviderPricing>
>;

export class ResearchProviderCostCatalog {
  constructor(
    overrides?: Record<string, Partial<ResearchProviderPricing>>
  );
  getPricing(providerName: string): ResearchProviderPricing;
  estimate(
    providerName: string,
    input?: { maxResults?: number; resultCount?: number }
  ): number;
}
