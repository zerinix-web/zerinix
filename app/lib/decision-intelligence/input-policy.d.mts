import type {
  DecisionInputPolicy,
} from "./contracts";

export type ProposedDecisionInputField = {
  id: string;
  question: string;
  placeholder: string;
  options: string[];
  required: boolean;
};

export function createDecisionInputPolicy(input: {
  domain: string;
  fields: ProposedDecisionInputField[];
}): DecisionInputPolicy;

export function expressDecisionInputFields(input: {
  policy: DecisionInputPolicy;
  llmPhrasings: ProposedDecisionInputField[];
}): ProposedDecisionInputField[];
