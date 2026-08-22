import type {
  DecisionResult,
  DecisionScore,
  DomainProfile,
  EvidenceValidation,
  ExtractedFact,
  ResearchTask,
} from "./contracts";
import { analyzeDecisionRisks } from "./risk-engine";
import { reasonAboutDecisionRule } from "./reasoning-engine";

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

const realEstateCapitalGateFields = ["title_status", "zoning", "access"];
const realEstateValuationGateFields = [
  "location",
  "parcel_size",
  "zoning",
  "comparables",
  "currency",
  "valuation_method",
];
const realEstateMaterialAdverseFields = [
  "title_status",
  "zoning",
  "access",
  "hazards",
];
const ambiguousRealEstateRecommendations = new Set<
  DecisionResult["recommendation"]
>(["Proceed Conditionally", "Insufficient Evidence"]);

function enforceClearRealEstateRecommendation(
  profile: DomainProfile,
  recommendation: DecisionResult["recommendation"]
) {
  return profile.id === "real_estate" &&
    ambiguousRealEstateRecommendations.has(recommendation)
    ? ("Wait" as const)
    : recommendation;
}

function isDecisionGradeExternalEvidence(
  item: EvidenceValidation["evidence"][number]
) {
  return (
    item.verified &&
    item.value.trim().length > 0 &&
    item.category === "Official Source" &&
    item.official &&
    /^https?:\/\//i.test(item.url)
  );
}

function nextActionFor(field: string) {
  const actions: Record<string, string> = {
    title_status:
      "Obtain a current official title and encumbrance record and resolve every annotation, easement, or restriction.",
    zoning:
      "Obtain parcel-specific official zoning status and applicable plan notes from the planning authority.",
    access:
      "Confirm legal cadastral road access and any right-of-way with the cadastral authority.",
    infrastructure:
      "Request parcel-specific utility availability confirmations from the responsible operators.",
    hazards:
      "Obtain location-specific hazard, geological, flood, and environmental records from the competent authorities.",
    comparables:
      "Collect recent, genuinely comparable local transactions or listings with area, date, currency, and exact location.",
    valuation_method:
      "Commission an evidence-based valuation using validated comparables and an explicit calculation method.",
  };
  return actions[field] ||
    `Confirm ${field} with the appropriate supporting documentation before this can be finalized.`;
}

function exactlyThreeNextActions({
  recommendation,
  blockingFields,
  adverseFields,
}: {
  recommendation: DecisionResult["recommendation"];
  blockingFields: string[];
  adverseFields: string[];
}) {
  if (recommendation === "Proceed") {
    return [
      "Commission a final independent valuation and set the maximum purchase price from the validated comparable set.",
      "Complete closing legal due diligence using current title, encumbrance, zoning, and cadastral-access records.",
      "Make the purchase agreement conditional on all verified legal and planning facts remaining valid at closing.",
    ];
  }
  if (recommendation === "Avoid") {
    const adverseField = adverseFields[0] || "material adverse condition";
    return [
      `Obtain and retain the authoritative record confirming the adverse ${adverseField} finding.`,
      "Do not sign a purchase agreement, pay a deposit, or commit capital while the adverse condition remains effective.",
      "Reconsider the asset only if the competent authority formally removes the adverse condition and every BUY gate is revalidated.",
    ];
  }

  const fallbackPriority = [
    "title_status",
    "zoning",
    "access",
    "comparables",
    "currency",
    "valuation_method",
  ];
  return [
    ...new Set([...blockingFields, ...fallbackPriority]),
  ].slice(0, 3).map(nextActionFor);
}

function canonicalFinalDecision(
  recommendation: DecisionResult["recommendation"]
): DecisionResult["finalDecision"] {
  if (recommendation === "Proceed") return "BUY";
  if (recommendation === "Avoid") return "AVOID";
  return "WAIT";
}

function exactlyFiveReasons(candidates: string[]) {
  const unique = candidates
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item, index, items) => items.indexOf(item) === index);
  const deterministicFallbacks = [
    "The decision uses only evidence that passed source-quality and claim-relevance checks.",
    "Uploaded-document facts remain separate from independently verified official facts.",
    "Unresolved critical evidence prevents unsupported certainty from entering the decision.",
    "Material adverse evidence overrides favorable but non-decisive signals.",
    "The recommendation cannot exceed the confidence supported by the available evidence.",
  ];
  for (const fallback of deterministicFallbacks) {
    if (unique.length === 5) break;
    if (!unique.includes(fallback)) unique.push(fallback);
  }
  return unique.slice(0, 5);
}

export function createDecisionResult({
  profile,
  validation,
  facts,
  researchPlan,
}: {
  profile: DomainProfile;
  validation: EvidenceValidation;
  facts: ExtractedFact[];
  researchPlan: ResearchTask[];
}): DecisionResult {
  const criticalConflictPenalty =
    validation.conflicts.filter((item) => item.severity === "high").length * 15;
  const requiredTasks = researchPlan.filter((task) => task.required);
  const completedRequired = requiredTasks.filter(
    (task) => task.status === "completed_with_evidence"
  ).length;
  const researchCompletion = requiredTasks.length
    ? (completedRequired / requiredTasks.length) * 100
    : 100;
  const verifiedFactRatio = facts.length
    ? facts.filter((item) => item.verified && !item.missing).length / facts.length
    : 0;

  const realEstateExternalSources = new Set(
    validation.evidence
      .filter(
        (item) =>
          item.verified &&
          (item.category === "Official Source" ||
            item.category === "External Research") &&
          /^https?:\/\//i.test(item.url)
      )
      .map((item) => item.url.toLowerCase())
  ).size;
  const scoringEvidenceIsSufficient =
    profile.id !== "real_estate" ||
    (realEstateExternalSources >= 3 &&
      validation.coverage >= 60 &&
      validation.evidence.some(
        (item) =>
          item.verified &&
          item.impact &&
          item.impact !== "unknown" &&
          /^https?:\/\//i.test(item.url)
      ));
  const componentScores: DecisionScore[] = scoringEvidenceIsSufficient
    ? profile.decisionRules.map((rule) => {
    const reasoning = reasonAboutDecisionRule({
      rule,
      validation,
      researchCompletion,
      verifiedFactRatio,
    });
    const score = clamp(
      validation.coverage * 0.25 +
        reasoning.evidenceStrength * 0.2 +
        researchCompletion * 0.15 +
        verifiedFactRatio * 10 -
        reasoning.relevantConflicts.length * 12 -
        criticalConflictPenalty * rule.weight +
        (reasoning.assessedEvidenceCount > 0 ? reasoning.impactScore : 0) * 0.3
    );

    return {
      id: rule.id,
      label: rule.label,
      score,
      confidence: validation.confidence,
      explanation: `${reasoning.explanation} Component weight: ${Math.round(rule.weight * 100)}%.`,
      evidenceIds: reasoning.relevantEvidence.map((item) => item.id),
    };
      })
    : [];

  const weightedScore = componentScores.length
    ? componentScores.reduce((sum, item, index) => {
        const weight = profile.decisionRules[index]?.weight || 0;
        return sum + item.score * weight;
      }, 0) /
      Math.max(
        0.01,
        profile.decisionRules.reduce((sum, item) => sum + item.weight, 0)
      )
    : validation.confidence;
  const roundedWeightedScore = clamp(weightedScore);
  const scores: DecisionScore[] =
    profile.id === "real_estate" && componentScores.length > 0
      ? [
          ...componentScores,
          {
            id: "overall_investment_score",
            label: "Overall Investment Score",
            score: roundedWeightedScore,
            confidence: validation.confidence,
            explanation: `Weighted calculation: ${componentScores
              .map(
                (score, index) =>
                  `${score.label} ${Math.round(
                    (profile.decisionRules[index]?.weight || 0) * 100
                  )}% × ${score.score}`
              )
              .join(" + ")}. Evidence coverage and unresolved critical fields reduce confidence; this score is not a valuation.`,
            evidenceIds: [
              ...new Set(componentScores.flatMap((score) => score.evidenceIds)),
            ],
          },
        ]
      : componentScores;
  const unknownRatio = profile.criticalEvidence.length
    ? validation.unresolvedFields.filter((field) =>
        profile.criticalEvidence.includes(field)
      ).length / profile.criticalEvidence.length
    : 0;
  const rawConfidence = clamp(
    validation.confidence -
      validation.conflicts.length * 5 -
      unknownRatio * 25
  );
  const hasAssessedDecisionEvidence = validation.evidence.some(
    (item) =>
      item.verified &&
      item.value.trim().length > 0 &&
      (item.category === "Verified Asset" || /^https?:\/\//i.test(item.url)) &&
      item.impact &&
      item.impact !== "unknown"
  );
  const realEstateGateEvidence = validation.evidence.filter(
    (item) =>
      realEstateCapitalGateFields.includes(item.field) &&
      isDecisionGradeExternalEvidence(item) &&
      item.impact &&
      item.impact !== "unknown"
  );
  const allCapitalGatesFavorable = realEstateCapitalGateFields.every((field) =>
    realEstateGateEvidence.some(
      (item) =>
        item.field === field &&
        item.impact === "favorable" &&
        item.confidence >= 70
    )
  );
  const hasHighSeverityConflict = validation.conflicts.some(
    (item) => item.severity === "high"
  );
  const unresolvedBuyGateFields = [
    ...new Set([
      ...realEstateCapitalGateFields,
      ...realEstateValuationGateFields,
    ]),
  ].filter((field) => validation.unresolvedFields.includes(field));
  const adverseMaterialEvidence = validation.evidence.filter(
    (item) =>
      realEstateMaterialAdverseFields.includes(item.field) &&
      isDecisionGradeExternalEvidence(item) &&
      item.impact === "adverse" &&
      item.confidence >= 70 &&
      !validation.conflicts.some(
        (conflict) =>
          conflict.severity === "high" && conflict.field === item.field
      )
  );
  const hasVerifiedAdverseCapitalGate = adverseMaterialEvidence.length > 0;
  const valuationEvidenceIsSufficient =
    realEstateValuationGateFields.every(
      (field) => !validation.unresolvedFields.includes(field)
    ) &&
    validation.evidence.filter(
      (item) =>
        item.field === "comparables" &&
        item.category === "External Research" &&
        /^https?:\/\//i.test(item.url)
    ).length >= 2;
  const confidence = Math.min(
    rawConfidence,
    hasHighSeverityConflict ? 45 : 100,
    profile.id === "real_estate" && unresolvedBuyGateFields.length > 0
      ? 60
      : 100,
    validation.evidence.some(
      (item) => item.category === "Official Source" && item.official
    )
      ? 100
      : 35
  );
  const evidenceRecommendation: DecisionResult["recommendation"] =
    profile.id === "real_estate"
      ? hasVerifiedAdverseCapitalGate
        ? "Avoid"
        : allCapitalGatesFavorable &&
            !hasHighSeverityConflict &&
            unresolvedBuyGateFields.length === 0 &&
            valuationEvidenceIsSufficient &&
            validation.coverage >= 75 &&
            confidence >= 70 &&
            weightedScore >= 70
          ? "Proceed"
          : "Wait"
      : unknownRatio > 0.4 || confidence < 40 || !hasAssessedDecisionEvidence
        ? "Wait"
        : weightedScore >= 75 && confidence >= 70
          ? "Proceed"
          : weightedScore >= 60
            ? "Proceed Carefully"
            : weightedScore >= 42
              ? "Wait"
              : "Avoid";
  const recommendation = enforceClearRealEstateRecommendation(
    profile,
    evidenceRecommendation
  );
  const riskAnalysis = analyzeDecisionRisks({ profile, validation });
  const unresolvedCapitalGates = realEstateCapitalGateFields.filter((field) =>
    validation.unresolvedFields.includes(field)
  );
  const decisionReason =
    profile.id === "real_estate"
      ? recommendation === "Avoid"
        ? `Do not commit capital because authoritative evidence identifies an adverse condition in ${[
            ...new Set(
              adverseMaterialEvidence
                .map((item) => item.field)
            ),
          ].join(", ")}.`
        : recommendation === "Proceed"
          ? "Capital commitment is supportable because title, zoning, and legal access are independently verified as favorable, with no unresolved high-severity contradiction."
          : `Wait before committing capital because ${[
              ...(unresolvedCapitalGates.length
                ? [`authoritative ${unresolvedCapitalGates.join(", ")} evidence is unresolved`]
                : []),
              ...(hasHighSeverityConflict
                ? ["high-severity evidence contradictions remain"]
                : []),
              ...(!valuationEvidenceIsSufficient
                ? ["valuation evidence is not decision-grade"]
                : []),
              ...(unresolvedBuyGateFields.length > 0
                ? ["decision-blocking evidence is incomplete"]
                : []),
            ].join(" and ") || "the current evidence does not support a defensible buy decision"}.`
      : recommendation === "Avoid"
        ? "Do not proceed because the evidence-weighted downside exceeds the supported opportunity."
        : recommendation === "Proceed"
          ? "Proceed because decision evidence, coverage, and confidence clear the required thresholds."
          : "Wait for the unresolved critical evidence before making an irreversible commitment.";
  const confidenceLevel =
    confidence >= 75 ? "High" : confidence >= 50 ? "Moderate" : "Low";
  const prioritizedUnknowns = [
    ...realEstateCapitalGateFields.filter((field) =>
      validation.unresolvedFields.includes(field)
    ),
    ...realEstateValuationGateFields.filter((field) =>
      validation.unresolvedFields.includes(field)
    ),
    ...validation.unresolvedFields.filter(
      (field) =>
        !realEstateCapitalGateFields.includes(field) &&
        !realEstateValuationGateFields.includes(field)
    ),
  ];
  const officialSourceCount = new Set(
    validation.evidence
      .filter((item) => item.category === "Official Source" && item.official)
      .map((item) => item.url)
  ).size;
  const independentSourceCount = new Set(
    validation.evidence
      .filter((item) => item.category === "External Research")
      .map((item) => item.url)
  ).size;
  const uploadedFactCount = validation.evidence.filter(
    (item) => item.category === "Verified Asset"
  ).length;
  const confidenceReason = `Confidence is ${confidenceLevel.toLowerCase()} because the decision uses ${officialSourceCount} authoritative source(s), ${independentSourceCount} independent source(s), ${uploadedFactCount} uploaded-document fact(s), ${validation.corroboratedFields.length} corroborated field(s), ${unresolvedBuyGateFields.length} decision-blocking gap(s), and ${validation.conflicts.length} contradiction(s).`;
  const consistencyReason = hasHighSeverityConflict
    ? `A trusted-source conflict remains in ${validation.conflicts
        .filter((item) => item.severity === "high")
        .map((item) => item.field)
        .join(", ")}; the engine therefore blocks BUY and reduces confidence.`
    : recommendation === "Proceed"
      ? "The BUY decision is consistent with favorable legal gates, sufficient valuation evidence, and the absence of material contradictions."
      : recommendation === "Avoid"
        ? `The AVOID decision is supported by uncontradicted authoritative adverse evidence in ${adverseMaterialEvidence
            .map((item) => item.field)
            .join(", ")}.`
        : `The WAIT decision is caused by these blocking fields: ${prioritizedUnknowns
            .slice(0, 6)
            .join(", ") || "insufficient decision-grade evidence"}.`;
  const finalDecision = canonicalFinalDecision(recommendation);
  const conflictExplanation = validation.conflicts.length
    ? validation.conflicts
        .map(
          (conflict) =>
            `${conflict.field}: trusted sources report incompatible values (${conflict.values.join(" versus ")}); confidence is reduced and BUY is blocked until an authoritative record resolves the conflict.`
        )
        .join(" ")
    : "";
  const decisionChangingEvidence =
    finalDecision === "BUY"
      ? "A current authoritative record showing a material title, zoning, legal-access, or hazard defect would change the decision to AVOID."
      : finalDecision === "AVOID"
        ? `A current authoritative record that formally removes the adverse ${adverseMaterialEvidence[0]?.field || "material"} condition would be required before the decision could move from AVOID to WAIT.`
        : prioritizedUnknowns.length > 0
          ? `The highest-leverage missing evidence is ${nextActionFor(prioritizedUnknowns[0])}`
          : hasHighSeverityConflict
            ? `The decision-changing evidence is a current authoritative record resolving the ${validation.conflicts[0]?.field || "critical"} conflict.`
            : "The decision-changing evidence is a complete authoritative legal and valuation package that clears every BUY gate.";
  const gateReason = (field: string, label: string) => {
    const evidence = realEstateGateEvidence.filter(
      (item) => item.field === field
    );
    if (!evidence.length) {
      return `${label}: no parcel-specific authoritative evidence cleared this BUY gate.`;
    }
    if (validation.conflicts.some((item) => item.field === field)) {
      return `${label}: trusted sources conflict, so this BUY gate remains unresolved.`;
    }
    const impact = evidence.some((item) => item.impact === "adverse")
      ? "adverse"
      : evidence.every((item) => item.impact === "favorable")
        ? "favorable"
        : "not conclusively favorable";
    return `${label}: authoritative evidence is ${impact} with maximum confidence ${Math.max(...evidence.map((item) => item.confidence))}/100.`;
  };
  const realEstateReasons =
    finalDecision === "BUY"
      ? [
          gateReason("title_status", "Title"),
          gateReason("zoning", "Zoning"),
          gateReason("access", "Legal access"),
          `Valuation: ${validation.evidence.filter((item) => item.field === "comparables").length} validated comparable evidence item(s), currency, parcel size, location, and method cleared the valuation gate.`,
          `Evidence confidence: ${confidence}/100 from ${officialSourceCount} authoritative and ${independentSourceCount} independent source(s), with ${validation.conflicts.length} contradiction(s).`,
        ]
      : finalDecision === "AVOID"
        ? [
            `Material adverse finding: authoritative evidence is adverse for ${adverseMaterialEvidence.map((item) => item.field).join(", ")}.`,
            `Source reliability: the adverse finding passed parcel matching, claim relevance, and primary-source validation at ${Math.max(...adverseMaterialEvidence.map((item) => item.confidence))}/100 confidence.`,
            `Contradiction status: no unresolved trusted-source conflict weakens the adverse finding used for AVOID.`,
            `Remaining uncertainty: ${unresolvedBuyGateFields.length} BUY-gate field(s) remain unresolved, but they cannot override the verified adverse condition.`,
            `Decision confidence: ${confidence}/100 after evidence quality, coverage, missing fields, and source consistency were applied.`,
          ]
        : [
            gateReason("title_status", "Title"),
            gateReason("zoning", "Zoning"),
            gateReason("access", "Legal access"),
            valuationEvidenceIsSufficient
              ? "Valuation: the valuation evidence gate is complete but cannot override unresolved legal gates or trusted-source conflicts."
              : `Valuation: decision-grade evidence is incomplete for ${realEstateValuationGateFields.filter((field) => validation.unresolvedFields.includes(field)).join(", ") || "validated comparable support"}.`,
            hasHighSeverityConflict
              ? `Evidence consistency: ${validation.conflicts.length} trusted-source contradiction(s) cap confidence at ${confidence}/100 and block BUY.`
              : `Evidence confidence: ${confidence}/100 after ${officialSourceCount} authoritative source(s), ${independentSourceCount} independent source(s), and ${unresolvedBuyGateFields.length} blocking gap(s) were evaluated.`,
          ];
  const topReasons = exactlyFiveReasons(
    profile.id === "real_estate"
      ? realEstateReasons
      : [
          decisionReason,
          confidenceReason,
          consistencyReason,
          riskAnalysis.risks[0]
            ? `Primary material risk: ${riskAnalysis.risks[0]}`
            : "No material adverse finding passed evidence validation.",
          decisionChangingEvidence,
        ]
  );

  return {
    finalDecision,
    recommendation,
    confidence,
    topReasons,
    decisionChangingEvidence,
    conflictExplanation,
    scores,
    opportunities: riskAnalysis.opportunities,
    risks: riskAnalysis.risks,
    contradictions: validation.conflicts,
    unknowns: validation.unresolvedFields,
    rationale: topReasons,
    nextActions: exactlyThreeNextActions({
      recommendation,
      blockingFields: prioritizedUnknowns,
      adverseFields: adverseMaterialEvidence.map((item) => item.field),
    }),
  };
}
