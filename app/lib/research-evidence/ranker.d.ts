import type { ResearchEvidence } from "./model.mjs";

export type EvidenceRankingOptions = {
  referenceDate?: string | number | Date;
};

export class EvidenceRanker {
  rank(
    items: ResearchEvidence[],
    options?: EvidenceRankingOptions
  ): ResearchEvidence[];
}

