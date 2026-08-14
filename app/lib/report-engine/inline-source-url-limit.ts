// Shared, report-type-agnostic presentation fix for
// executive-quality-gate.ts's no_long_source_lists check (limit: 1 raw URL
// inline per non-source field). Rather than trusting every section a
// model writes to never exceed that limit, this keeps the first raw URL
// as-is and rewrites every additional one into a bracketed evidence
// reference -- the same [R#] citation convention report prompts already
// ask the model to use everywhere. Traceability is never lost: when the
// URL matches a source the caller already knows about (the common case --
// e.g. Market Intelligence's shared graph independently renders every
// known source into the Sources field), that source's full record
// (title/publisher/URL) is already there; the bracket marker is enough to
// look it up. Only a URL with no known record (no source list available,
// or a citation that never reached it) gets a short line appended to
// Sources, built only from what the URL itself reveals (its hostname),
// never a fabricated title.

export type KnownSourceForUrlLookup = {
  url: string;
  evidenceId: string;
  title: string;
  publisher: string;
};

function hostnameOfRawUrl(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

function normalizeUrlForSourceLookup(value: string) {
  try {
    const url = new URL(value);
    return `${url.hostname.replace(/^www\./i, "").toLowerCase()}${url.pathname.replace(/\/$/, "")}`;
  } catch {
    return "";
  }
}

export function buildSourceLookupByUrl(
  knownSources: readonly KnownSourceForUrlLookup[] = []
) {
  const byUrl = new Map<string, KnownSourceForUrlLookup>();
  for (const source of knownSources) {
    const key = normalizeUrlForSourceLookup(source.url);
    if (key) byUrl.set(key, source);
  }
  return byUrl;
}

export function enforceInlineRawUrlLimit(
  content: string,
  maxInlineUrls: number,
  sourceLookupByUrl: ReadonlyMap<string, KnownSourceForUrlLookup>
): { content: string; extraSourceLines: string[] } {
  let seen = 0;
  const extraSourceLines: string[] = [];
  const rewritten = (content || "").replace(/https?:\/\/\S+/g, (rawUrl) => {
    seen += 1;
    if (seen <= maxInlineUrls) return rawUrl;

    const cleanedUrl = rawUrl.replace(/[)\].,;!?"'”]+$/, "");
    const known = sourceLookupByUrl.get(normalizeUrlForSourceLookup(cleanedUrl));
    if (known) return `[${known.evidenceId}]`;

    const marker = `[R-extra-${seen}]`;
    // Never fall back to the raw URL itself here: this line is appended
    // to Sources, whose own raw-URL ceiling this must not silently
    // consume. Stripping the scheme guarantees the quality gate's
    // https?:// pattern can never match what gets appended, even if
    // hostname parsing somehow fails for a string that already matched
    // the URL regex above.
    const fallbackLabel = cleanedUrl.replace(/^https?:\/\//i, "");
    extraSourceLines.push(`- ${marker} ${hostnameOfRawUrl(cleanedUrl) || fallbackLabel}`);
    return marker;
  });

  return { content: rewritten, extraSourceLines };
}

// Applies enforceInlineRawUrlLimit across every field except the
// designated source field(s), and folds every extracted reference line
// into that source field once. Mirrors runExecutiveQualityGate's own
// sourceFields convention so callers pass the exact same list to both.
export function enforceInlineRawUrlLimitAcrossSections<T extends string>({
  sections,
  sourceFields,
  maxInlineUrls,
  knownSources,
}: {
  sections: Record<T, string>;
  sourceFields: readonly T[];
  maxInlineUrls: number;
  knownSources?: readonly KnownSourceForUrlLookup[];
}): Record<T, string> {
  const sourceLookupByUrl = buildSourceLookupByUrl(knownSources);
  const result = { ...sections };
  const extraSourceLines: string[] = [];

  for (const field of Object.keys(result) as T[]) {
    if (sourceFields.includes(field)) continue;
    const { content, extraSourceLines: fieldExtraLines } = enforceInlineRawUrlLimit(
      result[field],
      maxInlineUrls,
      sourceLookupByUrl
    );
    result[field] = content;
    extraSourceLines.push(...fieldExtraLines);
  }

  if (extraSourceLines.length > 0 && sourceFields.length > 0) {
    const primarySourceField = sourceFields[0];
    result[primarySourceField] =
      `${result[primarySourceField]}\n${extraSourceLines.join("\n")}`.trim();
  }

  return result;
}
