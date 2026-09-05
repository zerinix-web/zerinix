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

const exclusiveExecutions = new Map<string, Promise<void>>();

// TASK #67 -- generic atomic "only one caller may run for this key at a
// time" guard, complementary to resolveCachedOrExecuteResearch above.
// That function coalesces concurrent callers onto ONE shared, already-
// resolved VALUE -- it requires every caller to want the exact same
// result shape. This one instead lets each caller run its OWN full
// `run` callback (which may itself start with a cache check, exactly
// like resolveDomainResearchWithCache's caller does one level up), but
// guarantees no two callers holding the same key ever execute `run`
// concurrently: a caller that finds the key already held simply waits
// for the current holder to finish (success or failure -- deliberately
// ignored here, via `.catch(() => {})`, since a failure just means "no
// new state to build on," not an error for THIS caller) and then tries
// again from scratch, calling `run` a second time. `run` itself is
// expected to re-check whatever cache/state the previous holder may
// have populated before doing any expensive work of its own, so a
// waiter whose predecessor succeeded typically returns immediately on
// this second attempt without ever becoming a holder itself.
//
// The check-then-set below is synchronous (no `await` between the `get`
// and the `set`), exactly like resolveCachedOrExecuteResearch's own
// documented fix -- no two concurrent calls can ever both observe "the
// key is free" for the same key. The guard can never lock a key
// indefinitely: `release()` and the same-instance-guarded `delete()` in
// `finally` both run synchronously, with no `await` between them and
// the holder's own `run()` settling (success OR failure/throw), so the
// key is freed the instant the holder's attempt is done, regardless of
// outcome -- a failed/timed-out/aborted attempt still frees the key for
// a legitimate retry.
export async function runExclusivelyByKey<T>(
  key: string,
  run: () => Promise<T>
): Promise<T> {
  const existing = exclusiveExecutions.get(key);
  if (existing) {
    await existing.catch(() => {});
    return runExclusivelyByKey(key, run);
  }

  let release: () => void = () => {};
  const ownership = new Promise<void>((resolve) => {
    release = resolve;
  });
  exclusiveExecutions.set(key, ownership);

  try {
    return await run();
  } finally {
    release();
    if (exclusiveExecutions.get(key) === ownership) {
      exclusiveExecutions.delete(key);
    }
  }
}
