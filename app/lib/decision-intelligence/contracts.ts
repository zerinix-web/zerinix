export type DecisionIntent =
  | "business_validation"
  | "investment_decision"
  | "market_research"
  | "strategic_advisory"
  | "financial_analysis"
  | "real_estate"
  | "medical"
  | "legal"
  | "manufacturing"
  | "pricing"
  | "competitor_analysis"
  | "expansion"
  | "risk_assessment"
  | "operational_improvement"
  | "investment_opportunity";

export type DecisionDomain =
  | "real_estate"
  | "healthcare"
  | "legal"
  | "finance"
  | "accounting"
  | "operations"
  | "procurement"
  | "manufacturing"
  | "technology"
  | "automotive"
  | "retail"
  | "ecommerce"
  | "restaurant"
  | "hospitality"
  | "construction"
  | "agriculture"
  | "logistics"
  | "energy"
  | "education"
  | "insurance"
  | "government"
  | "business"
  | "acquisition"
  | "general";

export type EvidenceCategory =
  | "Verified Asset"
  | "Official Source"
  | "External Research"
  | "AI Inference"
  | "Estimated"
  | "Missing Information";

export type IntentDetection = {
  primary: DecisionIntent;
  secondary: DecisionIntent[];
  confidence: number;
  rationale: string[];
};

export type ExtractedFact = {
  field: string;
  value: string;
  confidence: number;
  source: string;
  category: EvidenceCategory;
  verified: boolean;
  estimated: boolean;
  missing: boolean;
};

export type ResearchTaskStatus =
  | "completed_with_evidence"
  | "completed_no_evidence"
  | "provider_unavailable"
  | "failed"
  | "timed_out"
  | "skipped_with_reason";

export type ResearchAttempt = {
  stage: string;
  provider: string;
  query: string;
  status: ResearchTaskStatus;
  reason: string;
  evidenceCount: number;
  requestStartedAt: string;
  requestEndedAt: string;
  nextProvider: string;
};

export type ResearchTask = {
  id: string;
  field: string;
  priority: "critical" | "high" | "medium";
  reason: string;
  query: string;
  queryVariants?: string[];
  provider: string;
  status: ResearchTaskStatus;
  confidence: number;
  required: boolean;
  preferredSources: string[];
  statusReason?: string;
  providerConfigured?: boolean;
  requestStartedAt?: string;
  requestEndedAt?: string;
  resultStatus?: string;
  sourceTitles?: string[];
  sourceUrls?: string[];
  sourceTypes?: string[];
  officialSourceCount?: number;
  extractedFacts?: string[];
  timeoutReason?: string;
  notFoundReason?: string;
  attempts?: ResearchAttempt[];
  jurisdiction?: string;
  legalIssue?: string;
  requestedDecision?: string;
  urgency?: string;
  userFacts?: string[];
};

export type ResearchTaskResult = {
  id: string;
  field: string;
  provider: string;
  status: ResearchTaskStatus;
  reason: string;
  confidence: number;
  providerConfigured: boolean;
  requestStartedAt: string;
  requestEndedAt: string;
  resultStatus: string;
  sourceTitles: string[];
  sourceUrls: string[];
  sourceTypes: string[];
  officialSourceCount: number;
  extractedFacts: string[];
  timeoutReason: string;
  notFoundReason: string;
  attempts: ResearchAttempt[];
};

export type DecisionEvidence = {
  id: string;
  field: string;
  title: string;
  summary: string;
  value: string;
  source: string;
  url: string;
  provider: string;
  confidence: number;
  official: boolean;
  verified: boolean;
  publishedDate: string;
  lastChecked: string;
  supportingData: string[];
  category: EvidenceCategory;
  impact?: "favorable" | "neutral" | "adverse" | "unknown";
  impactReason?: string;
  sourceType?: string;
  authorityLevel?: "primary" | "secondary" | "uploaded" | "user" | "method";
  qualityScore?: number;
  qualityRationale?: string;
  researchStage?: string;
  searchQuery?: string;
  jurisdiction?: string;
  supportedIssue?: string;
  proposition?: string;
  sourceClassification?:
    | "primary legislation"
    | "official regulation"
    | "official court decision"
    | "official agency guidance"
    | "authoritative secondary source"
    | "commercial commentary"
    | "unsupported/irrelevant";
};

export type ResearchProviderRequest = {
  prompt: string;
  language: import("@/app/lib/report-language").ResponseLanguage;
  tasks: ResearchTask[];
  signal?: AbortSignal;
};

export type ResearchProviderResult = {
  provider: string;
  evidence: DecisionEvidence[];
  extractedFacts: ExtractedFact[];
  attemptedFields: string[];
  unresolvedFields: string[];
  taskResults: ResearchTaskResult[];
  summary: string;
  responseId: string;
};

export type DecisionResearchProvider = {
  id: string;
  canExecute(task: ResearchTask): boolean;
  execute(request: ResearchProviderRequest): Promise<ResearchProviderResult>;
};

export type EvidenceConflict = {
  field: string;
  evidenceIds: string[];
  values: string[];
  explanation: string;
  severity: "low" | "medium" | "high";
};

export type EvidenceValidation = {
  evidence: DecisionEvidence[];
  conflicts: EvidenceConflict[];
  corroboratedFields: string[];
  unresolvedFields: string[];
  coverage: number;
  confidence: number;
};

export type DecisionScore = {
  id: string;
  label: string;
  score: number;
  confidence: number;
  explanation: string;
  evidenceIds: string[];
};

export type DecisionRecommendation =
  | "Proceed"
  | "Proceed Conditionally"
  | "Proceed Carefully"
  | "Wait"
  | "Avoid"
  | "Insufficient Evidence";

export type DecisionResult = {
  finalDecision: "BUY" | "WAIT" | "AVOID";
  recommendation: DecisionRecommendation;
  confidence: number;
  topReasons: string[];
  decisionChangingEvidence: string;
  conflictExplanation: string;
  scores: DecisionScore[];
  opportunities: string[];
  risks: string[];
  contradictions: EvidenceConflict[];
  unknowns: string[];
  rationale: string[];
  nextActions: string[];
};

export type DomainResearchRequirement = {
  field: string;
  reason: string;
  preferredSources: string[];
  priority: ResearchTask["priority"];
  required: boolean;
};

export type DomainDecisionRule = {
  id: string;
  label: string;
  evidenceFields: string[];
  riskFields: string[];
  weight: number;
};

export type DecisionInputDisposition = "research" | "user_input";

export type DecisionInputField = {
  id: string;
  question: string;
  placeholder: string;
  options: string[];
  required: boolean;
  disposition: DecisionInputDisposition;
  reason: string;
};

export type DecisionInputPolicy = {
  domain: DecisionDomain;
  userInputFields: DecisionInputField[];
  researchFields: DecisionInputField[];
};

export type DomainProfile = {
  id: DecisionDomain;
  label: string;
  signals: RegExp[];
  criticalEvidence: string[];
  researchRequirements: DomainResearchRequirement[];
  decisionRules: DomainDecisionRule[];
  riskModel: string[];
  reportTemplate: string;
};

export type DecisionIntelligenceContext = {
  version: "decision_intelligence_v1";
  intent: IntentDetection;
  domain: DecisionDomain;
  domainProfile: DomainProfile;
  extractedFacts: ExtractedFact[];
  researchPlan: ResearchTask[];
  evidenceValidation: EvidenceValidation;
  decision: DecisionResult;
  outputMode: "full_report" | "preliminary_report" | "clarification";
};
