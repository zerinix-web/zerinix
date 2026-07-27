import { EvidenceDeduplicator } from "./deduplicator.mjs";
import { EvidenceNormalizer } from "./normalizer.mjs";
import { EvidenceRanker } from "./ranker.mjs";

/**
 * Provider-agnostic orchestration point for future research adapters.
 * It accepts raw evidence records only; it performs no network activity.
 */
export class EvidenceCollector {
  constructor(dependencies = {}) {
    this.normalizer =
      dependencies.normalizer || new EvidenceNormalizer();
    this.deduplicator =
      dependencies.deduplicator || new EvidenceDeduplicator();
    this.ranker = dependencies.ranker || new EvidenceRanker();
  }

  collect(inputs, options = {}) {
    const normalized = this.normalizer.normalizeAll(inputs, {
      collectedAt: options.collectedAt,
    });
    const deduplicated = this.deduplicator.deduplicate(normalized);

    return this.ranker.rank(deduplicated, {
      referenceDate: options.referenceDate,
    });
  }
}

