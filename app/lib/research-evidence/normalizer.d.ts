import type {
  ResearchEvidence,
  ResearchEvidenceInput,
} from "./model.mjs";

export type EvidenceNormalizationOptions = {
  collectedAt?: string | Date;
};

export function assessEvidenceReliability(
  input: ResearchEvidenceInput
): number;
export function extractEvidenceFacts(value: unknown): string[];

export class EvidenceNormalizer {
  normalize(
    input: ResearchEvidenceInput,
    options?: EvidenceNormalizationOptions
  ): ResearchEvidence;
  normalizeAll(
    inputs: ResearchEvidenceInput[],
    options?: EvidenceNormalizationOptions
  ): ResearchEvidence[];
}

