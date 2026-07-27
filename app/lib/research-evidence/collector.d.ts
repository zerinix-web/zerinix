import type {
  ResearchEvidence,
  ResearchEvidenceInput,
} from "./model.mjs";
import type {
  EvidenceNormalizationOptions,
  EvidenceNormalizer,
} from "./normalizer.mjs";
import type { EvidenceDeduplicator } from "./deduplicator.mjs";
import type {
  EvidenceRanker,
  EvidenceRankingOptions,
} from "./ranker.mjs";

export type EvidenceCollectionOptions = EvidenceNormalizationOptions &
  EvidenceRankingOptions;

export type EvidenceCollectorDependencies = {
  normalizer?: EvidenceNormalizer;
  deduplicator?: EvidenceDeduplicator;
  ranker?: EvidenceRanker;
};

export class EvidenceCollector {
  constructor(dependencies?: EvidenceCollectorDependencies);
  collect(
    inputs: ResearchEvidenceInput[],
    options?: EvidenceCollectionOptions
  ): ResearchEvidence[];
}

