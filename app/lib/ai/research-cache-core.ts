export type ResearchResolution<T> = {
  value: T;
  source: "cache" | "in_flight" | "generated";
};

const inFlight = new Map<string, Promise<unknown>>();

export async function resolveCachedOrExecuteResearch<T>(input: {
  dedupeKey: string;
  read: () => Promise<T | null>;
  execute: () => Promise<T>;
  write: (value: T) => Promise<void>;
}): Promise<ResearchResolution<T>> {
  const cached = await input.read();
  if (cached !== null) {
    return { value: cached, source: "cache" };
  }

  const existing = inFlight.get(input.dedupeKey) as Promise<T> | undefined;
  if (existing) {
    return { value: await existing, source: "in_flight" };
  }

  const generated = (async () => {
    const value = await input.execute();
    await input.write(value);
    return value;
  })();
  inFlight.set(input.dedupeKey, generated);

  try {
    return { value: await generated, source: "generated" };
  } finally {
    inFlight.delete(input.dedupeKey);
  }
}
