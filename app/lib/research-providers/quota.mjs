const DEFAULT_RESEARCH_QUOTA_RULES = Object.freeze({
  free: Object.freeze({
    dailyResearchCount: 5,
    monthlyResearchCount: 20,
    monthlyEstimatedCostUsd: 0.2,
  }),
  paid: Object.freeze({
    dailyResearchCount: 50,
    monthlyResearchCount: 500,
    monthlyEstimatedCostUsd: 10,
  }),
  enterprise: Object.freeze({
    dailyResearchCount: 500,
    monthlyResearchCount: 5000,
    monthlyEstimatedCostUsd: 100,
  }),
});

export const RESEARCH_QUOTA_TIERS = Object.freeze([
  "free",
  "paid",
  "enterprise",
]);

export class ResearchQuotaContextError extends Error {
  constructor(message = "Authenticated user context is required for research.") {
    super(message);
    this.name = "ResearchQuotaContextError";
  }
}

export class ResearchQuotaExceededError extends Error {
  constructor(decision) {
    super(decision.message);
    this.name = "ResearchQuotaExceededError";
    this.code = "RESEARCH_QUOTA_EXCEEDED";
    this.decision = decision;
  }
}

function normalizeLimit(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : fallback;
}

export function createResearchQuotaRules(overrides = {}) {
  return Object.fromEntries(
    RESEARCH_QUOTA_TIERS.map((tier) => {
      const defaults = DEFAULT_RESEARCH_QUOTA_RULES[tier];
      const custom = overrides[tier] || {};
      return [
        tier,
        Object.freeze({
          dailyResearchCount: Math.floor(
            normalizeLimit(
              custom.dailyResearchCount,
              defaults.dailyResearchCount
            )
          ),
          monthlyResearchCount: Math.floor(
            normalizeLimit(
              custom.monthlyResearchCount,
              defaults.monthlyResearchCount
            )
          ),
          monthlyEstimatedCostUsd: normalizeLimit(
            custom.monthlyEstimatedCostUsd,
            defaults.monthlyEstimatedCostUsd
          ),
        }),
      ];
    })
  );
}

function getPeriodBoundaries(nowInput) {
  const now = new Date(nowInput || Date.now());
  const safeNow = Number.isFinite(now.getTime()) ? now : new Date();
  const dayStart = new Date(
    Date.UTC(
      safeNow.getUTCFullYear(),
      safeNow.getUTCMonth(),
      safeNow.getUTCDate()
    )
  );
  const nextDay = new Date(dayStart);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const monthStart = new Date(
    Date.UTC(safeNow.getUTCFullYear(), safeNow.getUTCMonth(), 1)
  );
  const nextMonth = new Date(
    Date.UTC(safeNow.getUTCFullYear(), safeNow.getUTCMonth() + 1, 1)
  );

  return { safeNow, dayStart, nextDay, monthStart, nextMonth };
}

function isProviderExecution(event) {
  return event.cacheStatus === "miss" && event.providerExecuted !== false;
}

function createUsageSummary(events, boundaries, reservations, userId) {
  const monthEvents = events.filter((event) => {
    const timestamp = new Date(
      event.requestTimestamp || event.occurredAt
    ).getTime();
    return (
      isProviderExecution(event) &&
      timestamp >= boundaries.monthStart.getTime() &&
      timestamp < boundaries.nextMonth.getTime()
    );
  });
  const dailyEvents = monthEvents.filter(
    (event) =>
      new Date(event.requestTimestamp || event.occurredAt).getTime() >=
      boundaries.dayStart.getTime()
  );
  const userReservations = [...reservations.values()].filter(
    (reservation) => reservation.userId === userId
  );
  const dailyReservations = userReservations.filter(
    (reservation) =>
      reservation.createdAt >= boundaries.dayStart.getTime() &&
      reservation.createdAt < boundaries.nextDay.getTime()
  );
  const monthlyReservations = userReservations.filter(
    (reservation) =>
      reservation.createdAt >= boundaries.monthStart.getTime() &&
      reservation.createdAt < boundaries.nextMonth.getTime()
  );

  return {
    dailyResearchCount: dailyEvents.length + dailyReservations.length,
    monthlyResearchCount: monthEvents.length + monthlyReservations.length,
    monthlyEstimatedCostUsd: Number(
      (
        monthEvents.reduce(
          (sum, event) => sum + (Number(event.estimatedCostUsd) || 0),
          0
        ) +
        monthlyReservations.reduce(
          (sum, reservation) => sum + reservation.estimatedCostUsd,
          0
        )
      ).toFixed(6)
    ),
  };
}

function createRemaining(limits, usage) {
  return {
    dailyResearchCount: Math.max(
      0,
      limits.dailyResearchCount - usage.dailyResearchCount
    ),
    monthlyResearchCount: Math.max(
      0,
      limits.monthlyResearchCount - usage.monthlyResearchCount
    ),
    monthlyEstimatedCostUsd: Number(
      Math.max(
        0,
        limits.monthlyEstimatedCostUsd - usage.monthlyEstimatedCostUsd
      ).toFixed(6)
    ),
  };
}

export class ResearchQuotaChecker {
  constructor(options) {
    if (!options?.usageStore || typeof options.usageStore.list !== "function") {
      throw new TypeError("ResearchQuotaChecker requires a usage store.");
    }
    this.usageStore = options.usageStore;
    this.rules = createResearchQuotaRules(options.rules);
    this.clock = options.clock || (() => new Date());
    this.reservations = new Map();
    this.nextReservationId = 1;
  }

  async check(input) {
    const userId = String(input?.userId || "").trim();
    if (!userId) throw new ResearchQuotaContextError();

    const tier = RESEARCH_QUOTA_TIERS.includes(input.tier)
      ? input.tier
      : "free";
    const estimatedCostUsd = Math.max(
      0,
      Number(input.estimatedCostUsd) || 0
    );
    const boundaries = getPeriodBoundaries(input.now || this.clock());
    const events = await this.usageStore.list({
      userId,
      from: boundaries.monthStart,
      to: boundaries.nextMonth,
    });
    const limits = this.rules[tier];
    const usage = createUsageSummary(
      events,
      boundaries,
      this.reservations,
      userId
    );
    const projected = {
      dailyResearchCount: usage.dailyResearchCount + 1,
      monthlyResearchCount: usage.monthlyResearchCount + 1,
      monthlyEstimatedCostUsd: Number(
        (usage.monthlyEstimatedCostUsd + estimatedCostUsd).toFixed(6)
      ),
    };
    let reason = null;

    if (projected.dailyResearchCount > limits.dailyResearchCount) {
      reason = "daily_count";
    } else if (
      projected.monthlyResearchCount > limits.monthlyResearchCount
    ) {
      reason = "monthly_count";
    } else if (
      projected.monthlyEstimatedCostUsd > limits.monthlyEstimatedCostUsd
    ) {
      reason = "monthly_cost";
    }

    const allowed = reason === null;
    return {
      allowed,
      tier,
      reason,
      limits: { ...limits },
      usage,
      remaining: createRemaining(limits, allowed ? projected : usage),
      resetAt:
        reason === "daily_count"
          ? boundaries.nextDay.toISOString()
          : boundaries.nextMonth.toISOString(),
      message: allowed
        ? "Research usage is within quota."
        : "Research quota exceeded. Try again after the quota resets or use a higher research tier.",
    };
  }

  async checkAndReserve(input) {
    const decision = await this.check(input);
    if (!decision.allowed) return decision;

    const reservationId = `research-quota-${this.nextReservationId++}`;
    const now = new Date(input.now || this.clock()).getTime();
    this.reservations.set(reservationId, {
      userId: String(input.userId),
      workspaceId: input.workspaceId
        ? String(input.workspaceId)
        : undefined,
      estimatedCostUsd: Math.max(
        0,
        Number(input.estimatedCostUsd) || 0
      ),
      createdAt: Number.isFinite(now) ? now : Date.now(),
    });

    return { ...decision, reservationId };
  }

  release(reservationId) {
    if (reservationId) this.reservations.delete(reservationId);
  }

  async getRemainingUsage(input) {
    const decision = await this.check({
      ...input,
      estimatedCostUsd: 0,
    });
    return {
      tier: decision.tier,
      limits: decision.limits,
      usage: decision.usage,
      remaining: {
        dailyResearchCount: Math.min(
          decision.limits.dailyResearchCount,
          decision.usage.dailyResearchCount >=
            decision.limits.dailyResearchCount
            ? 0
            : decision.limits.dailyResearchCount -
                decision.usage.dailyResearchCount
        ),
        monthlyResearchCount: Math.max(
          0,
          decision.limits.monthlyResearchCount -
            decision.usage.monthlyResearchCount
        ),
        monthlyEstimatedCostUsd: Math.max(
          0,
          Number(
            (
              decision.limits.monthlyEstimatedCostUsd -
              decision.usage.monthlyEstimatedCostUsd
            ).toFixed(6)
          )
        ),
      },
    };
  }
}

export { DEFAULT_RESEARCH_QUOTA_RULES };
