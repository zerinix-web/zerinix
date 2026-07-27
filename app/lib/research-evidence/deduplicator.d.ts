import type { ResearchEvidence } from "./model.mjs";

export class EvidenceDeduplicator {
  isDuplicate(left: ResearchEvidence, right: ResearchEvidence): boolean;
  merge(
    left: ResearchEvidence,
    right: ResearchEvidence
  ): ResearchEvidence;
  deduplicate(items: ResearchEvidence[]): ResearchEvidence[];
}

