# Research provider architecture

This package is an internal, provider-agnostic preparation layer. It is not
connected to a route, report generator, client component, billing flow, or
database table and performs no network activity.

## Execution boundary

Future provider implementations belong in server-only modules. A provider owns
its API client and credential lookup; credentials are deliberately absent from
`ResearchProviderRequest`, provider metadata, coordinator options, cache
entries, and usage events. Provider implementations must import `server-only`
and read secrets through the existing server environment layer.

The coordinator accepts a structured research request, not a raw application
prompt. `ResearchQueryPolicy` rejects prompt-injection signatures, strips HTML
and control characters, limits query size, validates language/region, caps
result counts, and normalizes freshness. Only that prepared request may reach a
provider.

## Provider contract

`ResearchProvider` supports four future adapter families:

- Search API
- News
- Research Paper
- Company Data

Every provider declares whether it supports a prepared request, estimates cost
before execution, and returns raw evidence, provider metadata, and estimated
cost. The registry can select an explicit provider or the cheapest compatible
provider. The Tavily adapter is the first concrete adapter, but its server
factory is not imported by any application route. It is hard-disabled in
production and requires an explicit non-production feature flag plus
server-only `TAVILY_API_KEY` configuration.

## Cost and duplicate controls

The cost-control sequence is:

1. Normalize and validate the structured request.
2. Select a compatible provider.
3. Check exact and optional topic-aware cache reuse.
4. Coalesce identical in-flight research to prevent duplicate provider calls.
5. Estimate cost and reject requests above the configured request budget.
6. Execute the provider.
7. Normalize, deduplicate, and rank evidence through `EvidenceCollector`.
8. Store the cache entry.
9. Emit a usage event through the injected tracking interface.

Cost estimates are expressed in USD with billable units. The default in-memory
tracker and cache exist for deterministic tests and local composition only;
future production implementations can replace them without changing provider
or coordinator contracts.

## Cache strategy

Exact cache keys include provider, normalized query, language, region, result
limit, and freshness requirement. This prevents cross-language or
cross-freshness contamination.

A secondary topic index includes provider, language, region, industry, and
topics. Topic reuse remains opt-in and requires both strong query similarity
and topic overlap. Cache entries expire according to freshness:

- recent research: short TTL bounded between 15 minutes and 24 hours;
- since-date research: six hours;
- unrestricted research: 24 hours.

A future persistent cache may implement the same `ResearchCache` interface.

## Admin and usage visibility

Every execution, cache reuse, coalesced request, and failure can emit a
`ResearchUsageEvent`. The prepared aggregation exposes:

- total, completed, and failed research calls;
- estimated API cost;
- cache hit rate;
- most expensive normalized queries;
- provider-level calls, cost, cache hits, and failures.

No admin UI or database schema is added. A future storage-backed tracker can
persist these events after a separate schema and privacy review.

## Future integration sequence

1. Complete a security and cost review of the dormant Tavily adapter.
2. Add encrypted deployment configuration and provider health checks.
3. Add a persistent cache and usage tracker behind existing interfaces.
4. Run production-contract, cost-limit, redaction, and failure-isolation tests.
5. Integrate the coordinator into a report research stage behind a separate
   production feature flag.
6. Expose admin metrics only after storage, authorization, and retention rules
   are approved.
