import "server-only";

export type AdminProviderHealthResult = {
  ok: boolean;
  status: number;
  responseTimeMs: number;
  error?: string;
};

export async function fetchAdminHealth(
  url: string,
  init: RequestInit,
  timeoutMs = 4_000
): Promise<AdminProviderHealthResult> {
  const controller = new AbortController();
  const startedAt = Date.now();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      cache: "no-store",
    });

    return {
      ok: response.ok,
      status: response.status,
      responseTimeMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      responseTimeMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : "Provider request failed.",
    };
  } finally {
    clearTimeout(timer);
  }
}

export function statusFromAdminHealth(
  check: AdminProviderHealthResult,
  options?: {
    allowStatuses?: number[];
    degradedStatuses?: number[];
    downStatuses?: number[];
  }
): "Healthy" | "Degraded" | "Down" {
  if (check.ok || options?.allowStatuses?.includes(check.status)) {
    return check.responseTimeMs > 2_000 ? "Degraded" : "Healthy";
  }

  if (options?.degradedStatuses?.includes(check.status) || check.status === 429) {
    return "Degraded";
  }

  if (
    options?.downStatuses?.includes(check.status) ||
    check.status === 401 ||
    check.status === 403 ||
    check.status >= 500
  ) {
    return "Down";
  }

  return "Degraded";
}

export async function fetchOpenAiOrganizationData(
  endpoint: string,
  key: string,
  params: Record<string, string | number>
) {
  const allBuckets: Array<Record<string, unknown>> = [];
  let page: string | null = null;

  for (let index = 0; index < 20; index += 1) {
    const url = new URL(endpoint);

    Object.entries(params).forEach(([paramKey, value]) => {
      url.searchParams.set(paramKey, String(value));
    });

    if (page) {
      url.searchParams.set("page", page);
    }

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`OpenAI organization API returned ${response.status}: ${body.slice(0, 240)}`);
    }

    const payload = (await response.json()) as Record<string, unknown>;
    const buckets = Array.isArray(payload.data) ? payload.data : [];
    allBuckets.push(...(buckets as Array<Record<string, unknown>>));

    const nextPage = typeof payload.next_page === "string" ? payload.next_page.trim() : "";
    if (!payload.has_more || !nextPage) {
      break;
    }
    page = nextPage;
  }

  return allBuckets;
}
