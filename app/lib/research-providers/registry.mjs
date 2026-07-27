export class ResearchProviderNotFoundError extends Error {
  constructor(message = "No compatible research provider is registered.") {
    super(message);
    this.name = "ResearchProviderNotFoundError";
  }
}

export class ResearchProviderRegistry {
  constructor(providers = []) {
    this.providers = new Map();
    for (const provider of providers) this.register(provider);
  }

  register(provider) {
    if (!provider?.id || typeof provider.research !== "function") {
      throw new TypeError("Research provider must define an id and research method.");
    }

    if (this.providers.has(provider.id)) {
      throw new TypeError(`Research provider "${provider.id}" is already registered.`);
    }

    this.providers.set(provider.id, provider);
    return provider;
  }

  get(providerId) {
    return this.providers.get(providerId) || null;
  }

  compatible(request, options = {}) {
    return [...this.providers.values()].filter(
      (provider) =>
        (!options.providerKind || provider.kind === options.providerKind) &&
        (!options.providerId || provider.id === options.providerId) &&
        provider.supports(request)
    );
  }

  async select(request, options = {}) {
    const providers = this.compatible(request, options);
    if (!providers.length) throw new ResearchProviderNotFoundError();

    if (options.providerId) return providers[0];

    const priced = await Promise.all(
      providers.map(async (provider) => ({
        provider,
        estimate: await options.costController.estimate(provider, request),
      }))
    );
    priced.sort(
      (left, right) =>
        left.estimate.estimatedCostUsd - right.estimate.estimatedCostUsd ||
        left.provider.id.localeCompare(right.provider.id)
    );

    return priced[0].provider;
  }
}

