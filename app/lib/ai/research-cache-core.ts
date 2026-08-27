export type ResearchResolution<T> = {
  value: T;
  source: "cache" | "in_flight" | "generated";
};

const inFlight = new Map<string, Promise<unknown>>();

// P0 PRODUCTION FIX -- confirmed live (Market Intelligence generation
// timeout incident, cost-efficiency finding): the previous
// implementation awaited `input.read()` (a real Supabase round trip)
// BEFORE checking/registering the in-flight map. Two calls for the same
// dedupeKey issued close together (a genuine duplicate submit, or a
// client retry after perceiving a hang -- exactly the scenario this
// production incident's frontend can produce) could both observe
// `cached === null` and both observe `inFlight.get()` return `undefined`
// before either had set it, so BOTH proceeded to call the expensive
// `execute()` independently -- a real duplicate research/AI call, not a
// theoretical one. The map is now checked and populated SYNCHRONOUSLY
// (no `await` between the `get` and the `set` below), so a second
// concurrent call can never observe an empty map while the first call's
// resolution -- including its own `read()` -- is already in flight.
export async function resolveCachedOrExecuteResearch<T>(input: {
  dedupeKey: string;
  read: () => Promise<T | null>;
  execute: () => Promise<T>;
  write: (value: T) => Promise<void>;
}): Promise<ResearchResolution<T>> {
  const existing = inFlight.get(input.dedupeKey) as
    | Promise<{ value: T; source: "cache" | "generated" }>
    | undefined;
  if (existing) {
    const resolved = await existing;
    return { value: resolved.value, source: "in_flight" };
  }

  const resolution = (async () => {
    const cached = await input.read();
    if (cached !== null) {
      return { value: cached, source: "cache" as const };
    }

    const value = await input.execute();
    await input.write(value);
    return { value, source: "generated" as const };
  })();
  inFlight.set(input.dedupeKey, resolution);

  try {
    return await resolution;
  } finally {
    inFlight.delete(input.dedupeKey);
  }
}
