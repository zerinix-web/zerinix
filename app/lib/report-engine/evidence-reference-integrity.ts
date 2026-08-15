// Fail-fast integrity check for bracketed [R#] evidence citations: every
// reference actually rendered anywhere in the report must resolve to a
// real entry in the verified evidence/source registry (MarketIntelligenceGraph's
// own `sources`, built directly from research evidence -- see
// market-intelligence-graph.ts). A citation the model wrote that does not
// resolve is either a hallucinated reference number or a real source that
// was dropped somewhere between research and the final report -- in either
// case it must never reach the reader as a silent, unverifiable [R#]
// marker with nothing behind it. Matches the same fail-fast convention as
// this file's siblings (report-isolation-validator.ts,
// decision-contradiction-gate.ts): throw rather than silently degrade.

export type OrphanEvidenceReference = { field: string; reference: string };

const evidenceReferencePattern = /\[R(\d+)\]/g;

export function findOrphanEvidenceReferences(
  sections: Record<string, string | undefined>,
  knownEvidenceIds: ReadonlySet<string>
): OrphanEvidenceReference[] {
  const orphans: OrphanEvidenceReference[] = [];

  for (const [field, content] of Object.entries(sections)) {
    if (!content) continue;

    const seenInField = new Set<string>();
    evidenceReferencePattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = evidenceReferencePattern.exec(content))) {
      const id = `R${match[1]}`;
      if (seenInField.has(id)) continue;
      seenInField.add(id);
      if (!knownEvidenceIds.has(id)) {
        orphans.push({ field, reference: `[${id}]` });
      }
    }
  }

  return orphans;
}

export class OrphanEvidenceReferenceError extends Error {
  orphans: OrphanEvidenceReference[];

  constructor(orphans: OrphanEvidenceReference[]) {
    const summary = orphans
      .map((orphan) => `[${orphan.field}] ${orphan.reference}`)
      .join("; ");
    super(
      `Report cites ${orphans.length} evidence reference(s) with no matching entry in the verified source registry: ${summary}`
    );
    this.name = "OrphanEvidenceReferenceError";
    this.orphans = orphans;
  }
}

// Fail fast instead of silently shipping a report with an unresolvable
// [R#] marker -- every reference the model actually used must be backed
// by a real, verified source record.
export function assertNoOrphanEvidenceReferences(
  sections: Record<string, string | undefined>,
  knownEvidenceIds: ReadonlySet<string>
): void {
  const orphans = findOrphanEvidenceReferences(sections, knownEvidenceIds);
  if (orphans.length > 0) {
    throw new OrphanEvidenceReferenceError(orphans);
  }
}
