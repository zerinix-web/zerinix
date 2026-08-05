import {
  executiveDecisionPackageSchema,
  type ExecutiveDecisionPackage,
} from "../ai/executive-decision-system.ts";

// Formats ZERINIX Executive Decision System v1's output into additive
// prompt context for the existing "Strategic Report" (business plan)
// generator in plan-executor.ts. This module does not call any AI/LLM,
// does not touch report structure/schema, PDF generation, UI, billing,
// or authentication -- it only turns an already-computed, already-
// validated ExecutiveDecisionPackage into plain text the existing
// prompt template can interpolate, plus a small set of instruction
// bullets telling the model how to use that text.
//
// Never fabricates: the input is `unknown` (the raw `request_payload`
// field from an untyped JSON body) and is validated against the real,
// already-exported executiveDecisionPackageSchema before anything is
// read from it -- a missing or malformed value produces `null` (no
// enrichment at all, so the existing prompt is used byte-for-byte),
// never a guessed or partially-assembled block. Every list rendered
// below is a direct, unmodified read of a real field already computed
// by Confidence Engine, Conflict Detection Engine, Evidence Quality
// Scoring, Evidence Corroboration Engine, or Research Prioritization
// (via Business Intelligence Orchestrator) or Executive Decision
// Brief -- there is no synthesis, scoring, or invented text here.

const MAX_LIST_ITEMS = 12;
const MAX_TRACE_ITEMS = 15;
const MAX_CONFLICT_ITEMS = 8;
const MAX_NEXT_ACTION_ITEMS = 6;

export type ExecutiveDecisionSystemPromptContext = {
  // Ready to interpolate directly into the existing prompt template,
  // e.g. `${executiveDecisionSystemContext.contextBlock}`.
  contextBlock: string;
  // Full-detail instruction bullets, for the verbose report-quality-
  // rules list.
  qualityRuleBullets: readonly string[];
  // One dense bullet covering the same ground, for the compact
  // report-quality-rules variant actually sent to the model today.
  compactQualityRuleBullet: string;
};

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function formatBulletBlock(label: string, items: readonly string[], max: number): string {
  if (items.length === 0) {
    return `${label}: none identified.`;
  }
  return `${label}:\n${items
    .slice(0, max)
    .map((item) => `- ${item}`)
    .join("\n")}`;
}

const QUALITY_RULE_BULLETS: readonly string[] = [
  "When the Executive Decision System context block above is present, state its aggregate confidence score (or the relevant confidence driver/penalty) for every important recommendation instead of an unqualified claim.",
  "Surface any listed detected evidence conflicts prominently wherever the corresponding topic is discussed; never silently resolve a conflict the data did not resolve.",
  "Explicitly distinguish verified facts, assumptions, inferred/directional conclusions, and unknowns using the categories in the Executive Decision System context block -- never blur them into one undifferentiated claim.",
  "Explain the rationale for the primary recommendation using the \"Why this recommendation was selected\" list in the Executive Decision System context block.",
  "Reflect the Executive Decision System context block's highest-priority next actions in the report's recommendation/next-steps sections.",
  "Never state a fact, figure, or claim beyond what is present in the Executive Decision System context block, the submitted business context, or the uploaded evidence above.",
];

const COMPACT_QUALITY_RULE_BULLET =
  'When an Executive Decision System context block is present: state its confidence score for every important recommendation, surface its listed conflicts where relevant, distinguish its verified facts/assumptions/inferred conclusions/unknowns, explain the recommendation using its rationale, reflect its next actions, and never state a claim beyond what it (or the submitted evidence) lists.';

// The Executive Decision System package only ever reaches report
// generation on the success path (app/api/plan/route.ts returns a 422
// before report generation for any other status), but this is
// validated defensively rather than assumed, since the input here is
// untrusted `unknown` JSON from a stored job payload, not a live
// in-memory object.
export function formatExecutiveDecisionSystemContext(
  rawPackage: unknown
): ExecutiveDecisionSystemPromptContext | null {
  const parsed = executiveDecisionPackageSchema.safeParse(rawPackage);
  if (!parsed.success) {
    return null;
  }

  return buildContext(parsed.data);
}

function buildContext(pkg: ExecutiveDecisionPackage): ExecutiveDecisionSystemPromptContext | null {
  const brief = pkg.executiveDecisionBrief;
  const businessIntelligence = pkg.businessIntelligence;

  if (!brief || !businessIntelligence) {
    // No real Executive Decision System context was actually computed
    // for this request (e.g. an unsupported domain that still reached
    // ready_for_report_generation through the pre-existing Decision
    // Engine path) -- nothing real to add, so add nothing.
    return null;
  }

  const verifiedFacts = brief.verifiedEvidence;
  const assumptions = brief.assumptions;
  const inferredConclusions = brief.directionalSignals;
  // brief.missingCriticalEvidence already incorporates Business
  // Intelligence Orchestrator's own detectedGaps (Decision Engine's own
  // merge step formats each one into a full sentence before it ever
  // reaches the brief) -- reusing it alone here avoids listing the same
  // gap twice in two different phrasings.
  const unknowns = uniqueStrings(brief.missingCriticalEvidence);
  const whySelected = brief.decisionRationale;
  const conflicts = businessIntelligence.conflictDetection?.conflicts ?? [];
  const overallConflictSeverity = businessIntelligence.conflictDetection?.overallSeverity ?? null;
  const confidenceDrivers = businessIntelligence.confidence?.confidenceDrivers ?? [];
  const confidencePenalties = businessIntelligence.confidence?.confidencePenalties ?? [];
  const evidenceTrace = uniqueStrings([...brief.evidenceTrace, ...pkg.decision.evidenceTrace]);
  const topResearchTask = businessIntelligence.researchPrioritization?.prioritizedTasks[0] ?? null;
  const nextActions = uniqueStrings([
    ...brief.immediateNextActions,
    ...(topResearchTask ? [`${topResearchTask.topic} (${topResearchTask.explanation})`] : []),
  ]);

  const conflictLines =
    conflicts.length === 0
      ? ["- None detected."]
      : conflicts.slice(0, MAX_CONFLICT_ITEMS).map((conflict) => {
          const sources = [conflict.sourceA, conflict.sourceB].filter(Boolean).join(" vs. ");
          return `- [${conflict.severity}] ${conflict.reason}${sources ? ` (sources: ${sources})` : ""}`;
        });

  const driverLines =
    confidenceDrivers.length === 0
      ? ["- None reached the driver threshold."]
      : confidenceDrivers.slice(0, MAX_LIST_ITEMS).map((driver) => `- ${driver.factor}: ${driver.description}`);

  const penaltyLines =
    confidencePenalties.length === 0
      ? ["- None reached the penalty threshold."]
      : confidencePenalties
          .slice(0, MAX_LIST_ITEMS)
          .map((penalty) => `- ${penalty.factor} (-${penalty.impact}): ${penalty.description}`);

  const whySelectedLines =
    whySelected.length === 0
      ? ["- No specific rationale was computed beyond the recommendation status above."]
      : whySelected.slice(0, MAX_LIST_ITEMS).map((reason) => `- ${reason}`);

  const contextBlock = `Executive Decision System context (deterministically computed from verified evidence -- ground every relevant section in this data; never invent evidence beyond what is listed here):
Decision status: ${pkg.status}. Recommendation status: ${brief.recommendationStatus}. Aggregate confidence: ${businessIntelligence.aggregateConfidence}/100. Aggregate evidence quality: ${businessIntelligence.aggregateEvidenceQuality}/100. Executive decision signal: "${businessIntelligence.executiveDecisionSignal}".

${formatBulletBlock("Verified facts (cite as established, sourced facts)", verifiedFacts, MAX_LIST_ITEMS)}

${formatBulletBlock("Assumptions (state explicitly as assumptions, never as facts)", assumptions, MAX_LIST_ITEMS)}

${formatBulletBlock("Inferred / directional conclusions (present as interpretation, not certainty)", inferredConclusions, MAX_LIST_ITEMS)}

${formatBulletBlock("Unknowns / missing evidence (name explicitly wherever relevant; never paper over these gaps)", unknowns, MAX_LIST_ITEMS)}

Why this recommendation was selected:
${whySelectedLines.join("\n")}

Detected evidence conflicts${overallConflictSeverity ? ` (overall severity: ${overallConflictSeverity})` : " (none detected)"}:
${conflictLines.join("\n")}

Confidence drivers:
${driverLines.join("\n")}

Confidence penalties:
${penaltyLines.join("\n")}

${formatBulletBlock("Evidence trace", evidenceTrace, MAX_TRACE_ITEMS)}

${formatBulletBlock("Highest-priority next actions", nextActions, MAX_NEXT_ACTION_ITEMS)}`;

  return {
    contextBlock,
    qualityRuleBullets: QUALITY_RULE_BULLETS,
    compactQualityRuleBullet: COMPACT_QUALITY_RULE_BULLET,
  };
}
