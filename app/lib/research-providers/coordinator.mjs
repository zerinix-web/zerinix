import { EvidenceCollector } from "../research-evidence/collector.mjs";
import {
  buildResearchCacheKey,
  InMemoryResearchCache,
} from "./cache.mjs";
import {
  ResearchCostController,
  ResearchRequestCoalescer,
} from "./cost.mjs";
import { ResearchQueryPolicy } from "./policy.mjs";
import { ResearchProviderRegistry } from "./registry.mjs";
import {
  ResearchQuotaContextError,
  ResearchQuotaExceededError,
} from "./quota.mjs";
import {
  createResearchUsageEvent,
  InMemoryResearchUsageTracker,
} from "./usage.mjs";

export class ResearchCoordinator {
  constructor(options = {}) {
    this.registry =
      options.registry || new ResearchProviderRegistry(options.providers || []);
    this.policy = options.policy || new ResearchQueryPolicy();
    this.cache = options.cache || new InMemoryResearchCache();
    this.costController =
      options.costController || new ResearchCostController();
    this.usageTracker =
      options.usageTracker || new InMemoryResearchUsageTracker();
    this.quotaChecker = options.quotaChecker || null;
    this.coalescer = options.coalescer || new ResearchRequestCoalescer();
    this.evidenceCollector =
      options.evidenceCollector || new EvidenceCollector();
  }

  async research(input, options = {}) {
    const startedAt = Date.now();
    const request = this.policy.prepare(input);
    const provider = await this.registry.select(request, {
      providerId: options.providerId,
      providerKind: options.providerKind,
      costController: this.costController,
    });
    const cached =
      this.cache.get(request, provider.id, { now: options.now }) ||
      (options.allowTopicReuse
        ? this.cache.findReusable(request, provider.id, { now: options.now })
        : null);

    if (cached) {
      const exact =
        cached.key === buildResearchCacheKey(request, provider.id);
      const cacheStatus = exact ? "exact-hit" : "topic-hit";
      await this.recordUsage({
        request,
        provider,
        options,
        startedAt,
        cacheStatus,
        estimatedCostUsd: 0,
        resultCount: cached.value.evidence.length,
        status: "completed",
      });

      return {
        ...cached.value,
        request,
        cacheStatus,
        estimatedCost: {
          currency: "USD",
          estimatedCostUsd: 0,
          billableUnits: 0,
          unitName: "cache hit",
          freeTierEligible: true,
        },
      };
    }

    const coalescingKey = buildResearchCacheKey(request, provider.id);
    if (this.coalescer.has(coalescingKey)) {
      const coalesced = await this.coalescer.run(coalescingKey, () => {
        throw new Error("Coalesced research factory should not execute.");
      });
      await this.recordUsage({
        request,
        provider,
        options,
        startedAt,
        cacheStatus: "coalesced",
        duplicateRequest: true,
        estimatedCostUsd: 0,
        resultCount: coalesced.evidence.length,
        status: "completed",
      });

      return {
        ...coalesced,
        request,
        cacheStatus: "coalesced",
        estimatedCost: {
          currency: "USD",
          estimatedCostUsd: 0,
          billableUnits: 0,
          unitName: "coalesced request",
          freeTierEligible: true,
        },
      };
    }

    return this.coalescer.run(coalescingKey, async () => {
      const secondCacheCheck = this.cache.get(request, provider.id, {
        now: options.now,
      });
      if (secondCacheCheck) {
        await this.recordUsage({
          request,
          provider,
          options,
          startedAt,
          cacheStatus: "exact-hit",
          duplicateRequest: true,
          estimatedCostUsd: 0,
          resultCount: secondCacheCheck.value.evidence.length,
          status: "completed",
        });
        return {
          ...secondCacheCheck.value,
          request,
          cacheStatus: "exact-hit",
          estimatedCost: {
            currency: "USD",
            estimatedCostUsd: 0,
            billableUnits: 0,
            unitName: "coalesced cache hit",
            freeTierEligible: true,
          },
        };
      }

      let estimate = {
        currency: "USD",
        estimatedCostUsd: 0,
        billableUnits: 0,
        unitName: "request",
        freeTierEligible: false,
      };
      let quotaReservationId;
      let providerExecutionStarted = false;

      try {
        estimate = await this.costController.estimate(provider, request);
        this.costController.assertWithinBudget(estimate, {
          maxEstimatedCostUsd: options.maxEstimatedCostUsd,
        });
        if (this.quotaChecker) {
          const quotaDecision = await this.quotaChecker.checkAndReserve({
            userId: options.userId,
            workspaceId: options.workspaceId,
            tier: options.researchTier,
            estimatedCostUsd: estimate.estimatedCostUsd,
            now: options.now,
          });
          if (!quotaDecision.allowed) {
            throw new ResearchQuotaExceededError(quotaDecision);
          }
          quotaReservationId = quotaDecision.reservationId;
        }

        providerExecutionStarted = true;
        const providerResult = await provider.research(request);
        const evidence = this.evidenceCollector.collect(
          providerResult.rawEvidenceItems,
          {
            collectedAt:
              providerResult.metadata.executedAt || options.now,
            referenceDate: options.now,
          }
        );
        const value = {
          request,
          evidence,
          providerMetadata: {
            ...providerResult.metadata,
            providerId: provider.id,
            providerKind: provider.kind,
            resultCount: evidence.length,
          },
          estimatedCost: providerResult.estimatedCost || estimate,
          cacheStatus: "miss",
        };

        this.cache.set(request, provider.id, value, {
          now: options.now,
          ttlMs: options.cacheTtlMs,
        });
        await this.recordUsage({
          request,
          provider,
          options,
          startedAt,
          cacheStatus: "miss",
          duplicateRequest: false,
          estimatedCostUsd: value.estimatedCost.estimatedCostUsd,
          providerExecuted: true,
          resultCount: evidence.length,
          status: "completed",
        });

        return value;
      } catch (error) {
        if (
          error instanceof ResearchQuotaExceededError ||
          error instanceof ResearchQuotaContextError
        ) {
          throw error;
        }
        await this.recordUsage({
          request,
          provider,
          options,
          startedAt,
          cacheStatus: "miss",
          duplicateRequest: false,
          estimatedCostUsd: estimate.estimatedCostUsd,
          providerExecuted: providerExecutionStarted,
          resultCount: 0,
          status: "failed",
        });
        throw error;
      } finally {
        this.quotaChecker?.release(quotaReservationId);
      }
    });
  }

  async recordUsage(input) {
    await this.usageTracker.record(
      createResearchUsageEvent({
        occurredAt: input.options.now,
        userId: input.options.userId,
        workspaceId: input.options.workspaceId,
        request: input.request,
        providerId: input.provider.id,
        providerName: input.provider.name || input.provider.id,
        providerKind: input.provider.kind,
        cacheStatus: input.cacheStatus,
        duplicateRequest: input.duplicateRequest,
        estimatedCostUsd: input.estimatedCostUsd,
        providerExecuted: input.providerExecuted,
        resultCount: input.resultCount,
        durationMs: Date.now() - input.startedAt,
        status: input.status,
      })
    );
  }
}
