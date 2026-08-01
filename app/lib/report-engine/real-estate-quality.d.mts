export type RealEstateQualityEvidence = {
  label?: string;
  field?: string;
  taskId?: string;
  claim?: string;
  value?: string;
  sourceTitle?: string;
  publisher?: string;
  sourceType?: string;
  url?: string;
  supportingData?: string[];
  retrievalStatus?: string;
  resultStatus?: string;
  status?: string;
  responseStatus?: number;
  httpStatus?: number;
};

export function isUsableRealEstateExternalEvidence(
  item: RealEstateQualityEvidence
): boolean;

export function deduplicateUsableRealEstateExternalEvidence(
  evidence: RealEstateQualityEvidence[]
): RealEstateQualityEvidence[];

export function assertRealEstateUsesAvailableExternalEvidence(input: {
  reportText: string;
  evidence: RealEstateQualityEvidence[];
}): {
  usableExternalEvidenceCount: number;
  externalClaimCount: number;
};

export function calculateRealEstateResearchComposition(
  report: Record<string, string>
): {
  researchedCharacters: number;
  totalDecisionCharacters: number;
  researchShare: number;
};

export function assertRealEstateResearchComposition(input: {
  report: Record<string, string>;
  minimumResearchShare?: number;
}): {
  researchedCharacters: number;
  totalDecisionCharacters: number;
  researchShare: number;
};
