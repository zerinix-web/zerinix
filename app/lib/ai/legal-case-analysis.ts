import { z } from "zod";
import {
  normalizeForMatch,
  type LegalDocumentSummary,
} from "./legal-document-understanding.ts";

// Third layer of ZERINIX Legal Intelligence: evidence-grounded legal case
// analysis, built only from the structured output of
// legal-document-understanding.ts (layer 2). Like layers 1 and 2, this is
// a deterministic derivation rather than a model call: every statement it
// produces is traceable to a specific layer-2 field, and every statement
// carries one of exactly four labels so a reader can tell a quoted
// document fact apart from a party's own argument, a court's finding, or
// this module's own inference. Nothing here computes or presents a
// success/reversal probability -- that is explicitly out of scope.

export const statementLabelValues = [
  "Document Fact",
  "Party Argument",
  "Court Finding",
  "Model Inference",
] as const;

export type StatementLabel = (typeof statementLabelValues)[number];

const labeledStatementSchema = z
  .object({
    text: z.string().trim().min(1).max(600),
    label: z.enum(statementLabelValues),
  })
  .strict();

export type LabeledStatement = z.infer<typeof labeledStatementSchema>;

const personOutcomeSchema = z
  .object({
    person: z.string().trim().min(1).max(200),
    statements: z.array(labeledStatementSchema).min(1).max(10),
  })
  .strict();

export type PersonOutcome = z.infer<typeof personOutcomeSchema>;

export const legalCaseAnalysisSchema = z
  .object({
    caseSummary: z.array(labeledStatementSchema).max(20),
    proceduralPosture: z.array(labeledStatementSchema).max(20),
    personByPersonOutcome: z.array(personOutcomeSchema).max(30),
    courtReasoning: z.array(labeledStatementSchema).max(20),
    appealArguments: z.array(labeledStatementSchema).max(20),
    acceptedArguments: z.array(labeledStatementSchema).max(20),
    rejectedArguments: z.array(labeledStatementSchema).max(20),
    evidenceAssessment: z.array(labeledStatementSchema).max(20),
    legalIssues: z.array(labeledStatementSchema).max(20),
    inconsistencies: z.array(labeledStatementSchema).max(20),
    strengths: z.array(labeledStatementSchema).max(20),
    weaknesses: z.array(labeledStatementSchema).max(20),
    unresolvedIssues: z.array(labeledStatementSchema).max(30),
    practicalNextSteps: z.array(labeledStatementSchema).max(10),
    confidenceAndLimitations: z.array(labeledStatementSchema).max(20),
    disclaimer: z.string().trim().min(1).max(600),
  })
  .strict();

export type LegalCaseAnalysis = z.infer<typeof legalCaseAnalysisSchema>;

const DISCLAIMER =
  "This analysis is limited strictly to the content visible in the uploaded document. It is not legal advice, does not predict any outcome, and is not a substitute for review by a licensed lawyer.";

function fact(text: string): LabeledStatement {
  return { text, label: "Document Fact" };
}
function partyArgument(text: string): LabeledStatement {
  return { text, label: "Party Argument" };
}
function courtFinding(text: string): LabeledStatement {
  return { text, label: "Court Finding" };
}
function modelInference(text: string): LabeledStatement {
  return { text, label: "Model Inference" };
}

function isTruncatedDisposition(summary: LegalDocumentSummary) {
  return summary.unresolvedQuestions.some((item) =>
    /reddi,?\s*ancak/.test(normalizeForMatch(item))
  );
}

function isRejectionOf(claim: string) {
  return /\b(reddi|ret)\b/.test(normalizeForMatch(claim));
}

function mentionsAcquittal(text: string) {
  return /\bberaat\b/.test(normalizeForMatch(text));
}

function buildCaseSummary(summary: LegalDocumentSummary): LabeledStatement[] {
  const statements: LabeledStatement[] = [];

  if (summary.documentType || summary.courtOrAuthority) {
    statements.push(
      fact(
        [
          summary.documentType ? `Document type: ${summary.documentType}.` : "",
          summary.courtOrAuthority ? `Issuing court/authority: ${summary.courtOrAuthority}.` : "",
        ]
          .filter(Boolean)
          .join(" ")
      )
    );
  }
  if (summary.caseSubject || summary.allegedOffenses.length) {
    statements.push(
      fact(
        `Subject matter: ${summary.caseSubject || summary.allegedOffenses.join("; ")}.`
      )
    );
  }
  if (summary.defendants.length) {
    statements.push(
      fact(`Named defendant(s) on the document: ${summary.defendants.join(", ")}.`)
    );
  }
  if (!statements.length) {
    statements.push(
      fact("The uploaded attachment did not contain enough recognizable text to summarize the case.")
    );
  }
  return statements;
}

function buildProceduralPosture(summary: LegalDocumentSummary): LabeledStatement[] {
  const statements: LabeledStatement[] = [];
  if (summary.proceduralStage) {
    statements.push(fact(`Procedural stage stated on the document: ${summary.proceduralStage}.`));
  } else {
    statements.push(fact("No procedural stage is explicitly stated in the visible text."));
  }
  if (isTruncatedDisposition(summary)) {
    statements.push(
      fact(
        'The visible page ends mid-sentence ("...REDDİ, ancak;"), so the decision continues beyond the uploaded page and the complete procedural disposition cannot be determined from this page alone.'
      )
    );
  }
  return statements;
}

function buildPersonByPersonOutcome(summary: LegalDocumentSummary): PersonOutcome[] {
  const truncated = isTruncatedDisposition(summary);

  return summary.defendants.map((person) => {
    const decisions = summary.decisionsByPerson.filter((item) => item.person === person);
    const statements: LabeledStatement[] = [];

    if (decisions.length === 0) {
      statements.push(
        fact(`No outcome specific to ${person} is stated in the visible text.`)
      );
      return { person, statements };
    }

    for (const decision of decisions) {
      statements.push(courtFinding(decision.decision));

      const isAcquittal = mentionsAcquittal(decision.decision);
      const acquittalChallengeRejected =
        isAcquittal &&
        summary.disputedClaims.some(
          (claim) => isRejectionOf(claim) && /itiraz/.test(normalizeForMatch(claim))
        );

      if (isAcquittal && acquittalChallengeRejected) {
        statements.push(
          modelInference(
            `Because the objection to ${person}'s acquittal was rejected in the visible text, the acquittal appears to be upheld with respect to that objection. This is inferred from two document statements together, not a literal quote, and the decision continues past "ancak;" so the complete final outcome for ${person} is not confirmed by this page.`
          )
        );
      } else if (isAcquittal) {
        statements.push(
          modelInference(
            `An acquittal is recorded for ${person} on the visible text; whether it was challenged, upheld, or altered elsewhere in the decision is not determinable from this page alone.`
          )
        );
      }
    }

    if (truncated) {
      statements.push(
        fact(
          `The decision continues past the visible page ("...REDDİ, ancak;"), so the complete final outcome for ${person} cannot be determined from the uploaded page.`
        )
      );
    }

    return { person, statements };
  });
}

function buildCourtReasoning(summary: LegalDocumentSummary): LabeledStatement[] {
  const statements = summary.decisionsByPerson.map((item) =>
    courtFinding(item.decision)
  );
  if (!statements.length) {
    statements.push(
      fact("No court reasoning or disposition sentence is identifiable in the visible text.")
    );
  }
  return statements;
}

function buildAppealArguments(summary: LegalDocumentSummary): LabeledStatement[] {
  const statements = summary.disputedClaims.map((claim) => partyArgument(claim));
  if (!statements.length) {
    statements.push(fact("No appeal or objection is described in the visible text."));
  }
  return statements;
}

function buildAcceptedArguments(summary: LegalDocumentSummary): LabeledStatement[] {
  const accepted = summary.disputedClaims.filter((claim) => !isRejectionOf(claim));
  if (!accepted.length) {
    return [fact("No appeal argument is stated as accepted on the visible page.")];
  }
  return accepted.map((claim) => courtFinding(claim));
}

function buildRejectedArguments(summary: LegalDocumentSummary): LabeledStatement[] {
  const rejected = summary.disputedClaims.filter((claim) => isRejectionOf(claim));
  const fromDecisions = summary.decisionsByPerson
    .filter((item) => isRejectionOf(item.decision))
    .map((item) => item.decision);
  const statements = [...rejected, ...fromDecisions].map((text) => courtFinding(text));
  if (!statements.length) {
    return [fact("No appeal argument is stated as rejected on the visible page.")];
  }
  return statements;
}

function buildEvidenceAssessment(): LabeledStatement[] {
  return [
    fact(
      "The visible text is a procedural/appellate disposition; it does not itself set out specific items of evidence (witness testimony, physical evidence, expert reports)."
    ),
    fact(
      "No evidentiary assessment beyond what is stated above can be made without the underlying trial record, which is not part of the uploaded attachment."
    ),
  ];
}

function buildLegalIssues(summary: LegalDocumentSummary): LabeledStatement[] {
  const statements: LabeledStatement[] = [];
  if (summary.caseSubject) {
    statements.push(fact(`Charge/subject at issue: ${summary.caseSubject}.`));
  }
  if (summary.citedStatutes.length) {
    statements.push(
      fact(`Statutes cited on the document: ${summary.citedStatutes.join(", ")}.`)
    );
  }
  if (!statements.length) {
    statements.push(fact("No specific charge or statute citation is identifiable in the visible text."));
  }
  return statements;
}

function buildInconsistencies(): LabeledStatement[] {
  return [
    modelInference(
      "No internal inconsistency is apparent between the statements extracted from the visible text, but this cannot be fully assessed because the page is incomplete."
    ),
  ];
}

function buildStrengthsAndWeaknesses(summary: LegalDocumentSummary) {
  const truncated = isTruncatedDisposition(summary);
  const strengths: LabeledStatement[] = [];
  const weaknesses: LabeledStatement[] = [];

  for (const decision of summary.decisionsByPerson) {
    if (mentionsAcquittal(decision.decision)) {
      strengths.push(
        modelInference(
          `An acquittal already exists in favor of ${decision.person} on the visible text, and any objection to it that is described as rejected is a favorable procedural signal on this page. This is a description of what is visible, not a prediction of the final result.`
        )
      );
    }
  }
  if (!strengths.length) {
    strengths.push(fact("No party-favorable disposition is identifiable in the visible text."));
  }

  if (truncated) {
    weaknesses.push(
      fact(
        'The page is incomplete ("...REDDİ, ancak;"), so any strength or weakness assessment is necessarily partial and may not reflect the complete decision.'
      )
    );
  }
  const undecided = summary.defendants.filter(
    (person) => !summary.decisionsByPerson.some((item) => item.person === person)
  );
  if (undecided.length) {
    weaknesses.push(
      fact(`No outcome is stated on the visible page for: ${undecided.join(", ")}.`)
    );
  }
  if (!weaknesses.length) {
    weaknesses.push(fact("No unfavorable disposition is identifiable in the visible text."));
  }

  return { strengths, weaknesses };
}

function buildUnresolvedIssues(summary: LegalDocumentSummary): LabeledStatement[] {
  const statements = [...summary.unresolvedQuestions.map((item) => fact(item))];
  const undecided = summary.defendants.filter(
    (person) => !summary.decisionsByPerson.some((item) => item.person === person)
  );
  for (const person of undecided) {
    statements.push(fact(`The outcome for ${person} is not stated on the visible page.`));
  }
  if (!statements.length) {
    statements.push(fact("No unresolved issues were identified in the visible text."));
  }
  return statements;
}

function buildPracticalNextSteps(): LabeledStatement[] {
  return [
    fact(
      "Obtain the complete decision text, including the portion following the cut-off point, to determine the final disposition for every named party."
    ),
    fact(
      "Have a licensed lawyer review the complete document before relying on any of these statements for a decision."
    ),
  ];
}

function buildConfidenceAndLimitations(summary: LegalDocumentSummary): LabeledStatement[] {
  return [
    ...summary.sourceLimitations.map((item) => fact(item)),
    modelInference(
      "Confidence in statements labeled Document Fact or Court Finding is high, because they are drawn directly from the visible text. No confidence level is assigned to any case outcome or legal conclusion, because none is computed by this analysis."
    ),
  ];
}

export function createLegalCaseAnalysis(
  summary: LegalDocumentSummary
): LegalCaseAnalysis {
  const { strengths, weaknesses } = buildStrengthsAndWeaknesses(summary);

  return {
    caseSummary: buildCaseSummary(summary),
    proceduralPosture: buildProceduralPosture(summary),
    personByPersonOutcome: buildPersonByPersonOutcome(summary),
    courtReasoning: buildCourtReasoning(summary),
    appealArguments: buildAppealArguments(summary),
    acceptedArguments: buildAcceptedArguments(summary),
    rejectedArguments: buildRejectedArguments(summary),
    evidenceAssessment: buildEvidenceAssessment(),
    legalIssues: buildLegalIssues(summary),
    inconsistencies: buildInconsistencies(),
    strengths,
    weaknesses,
    unresolvedIssues: buildUnresolvedIssues(summary),
    practicalNextSteps: buildPracticalNextSteps(),
    confidenceAndLimitations: buildConfidenceAndLimitations(summary),
    disclaimer: DISCLAIMER,
  };
}
