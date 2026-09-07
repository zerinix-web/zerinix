// TASK #69A-15 -- Make Business Idea Validation Competitor Landscape
// structurally authoritative at generation time.
//
// ROOT CAUSE (traced before writing any code): Business Idea
// Validation's competitorLandscape field (app/lib/report-engine/
// prompts/plan.ts) has always been pure free-form AI prose with zero
// structural contract -- no JSON schema constrains it (createFullReportJsonSchema,
// app/lib/report-engine/schema.ts, types EVERY one of the 23 planFields
// as a plain string, competitorLandscape included). Every renderer
// (Planner.tsx, page.tsx, ReportPdfButton.tsx) was independently
// RE-PARSING that same free prose from scratch on every single render,
// via increasingly elaborate regex heuristics (#69A-13/#69A-14) -- which
// can recover a real competitor's NAME and its own parenthetical
// description (Positioning), but can never reliably recover per-entity
// Strengths/Weaknesses/Threat from prose that never labels those
// sub-fields per competitor in the first place. That is not a parsing
// bug to fix harder; it is a genuine absence of information in what the
// model was ever asked to write.
//
// FIX, round 1 (#69A-15): strengthened competitorLandscape's PROMPT
// (plan.ts) to request one explicitly labeled line per competitor
// (never changing the field's TYPE -- it stayed a plain string), then
// deterministically parsed that specific line format at generation
// time. CONFIRMED INSUFFICIENT by a fresh real localhost regeneration:
// the model did not reliably follow the labeled-line prompt convention
// -- Strengths/Weaknesses/Threat still rendered "—" for real,
// independently-identified competitors (Float, Cash Flow Frog). A
// PROMPT is advisory; the model can and did silently ignore it.
//
// FIX, round 2 (#69A-15A) -- the load-bearing fix: competitor-specific
// structure is now ENFORCED at the JSON-schema layer of the SAME single
// business-plan generation call (plan-executor.ts's "zerinix_business_plan_report"
// call only -- createFullReportJsonSchema's new, purely-additive
// fieldSchemaOverrides parameter lets this ONE call request a
// genuinely structured array for a NEW top-level key,
// "competitorLandscapeStructured", without changing the schema for any
// of the 23 existing string fields, and without affecting real
// estate/domain-analysis/acquisition's own, separate
// createFullReportJsonSchema calls at all). OpenAI's strict JSON-schema
// mode VALIDATES the response against BUSINESS_COMPETITOR_LANDSCAPE_JSON_SCHEMA
// before ever returning it -- this is real, load-bearing enforcement,
// not a hopeful convention the model can silently ignore. Evidence
// honesty is preserved by making every per-competitor field nullable
// (`type: ["string", "null"]`) rather than a required, always-populated
// string -- the model is schema-permitted, and explicitly instructed,
// to return null instead of inventing a value.
//
// buildBusinessCompetitorLandscapeStateFromStructuredResponse (below) is
// now Tier 0 -- read directly from the model's own schema-validated JSON
// array, never re-derived from prose. #69A-15's own
// parseStructuredCompetitorLines (the labeled-line text parser) stays as
// Tier 1, a safety net for any generation path that doesn't go through
// the schema-enforced call at all (the deterministic, no-AI-call timeout
// fallback report skeleton, or an already-cached pre-#69A-15A response).
// Every renderer's own #69A-13/#69A-14 prose-parsing tiers remain Tier 2,
// completely unmodified, for reports persisted before either mechanism
// existed. Persisted as the exact same versioned, additive
// reports.metadata.businessCompetitorLandscapeState key #69A-15 already
// established -- no migration, no schema change to the reports table,
// no risk to any existing persisted report, and every one of #69A-15's
// four renderer call sites (Planner.tsx's on-screen card and its own
// downloadPdf, page.tsx, ReportPdfButton.tsx) keeps working completely
// unchanged, since they all read the SAME metadata key regardless of
// which tier actually populated it.
export type BivCompetitorType = "Direct competitor" | "Substitute" | "Unknown";

export type BivCompetitorRecord = {
  company: string;
  type: BivCompetitorType;
  positioning: string;
  strengths: string;
  weaknesses: string;
  threat: string;
};

export const BUSINESS_COMPETITOR_LANDSCAPE_STATE_VERSION = 1;

export type BusinessCompetitorLandscapeState = {
  version: typeof BUSINESS_COMPETITOR_LANDSCAPE_STATE_VERSION;
  competitors: BivCompetitorRecord[];
};

// The exact self-labeled line format competitorLandscape's own prompt
// (plan.ts) now asks the model to write, one line per competitor:
// "COMPETITOR: <name> | TYPE: <Direct competitor|Substitute> |
// POSITIONING: <...> | STRENGTHS: <...> | WEAKNESSES: <...> | THREAT:
// <...>". Every field is captured independently by its own regex
// group -- there is no code path by which one field's text can end up
// copied into another, and no path by which a field can be "guessed"
// when absent (a line missing any of the six labels simply does not
// match at all and contributes nothing).
const structuredCompetitorLinePattern =
  /^COMPETITOR:\s*(.+?)\s*\|\s*TYPE:\s*(.+?)\s*\|\s*POSITIONING:\s*(.+?)\s*\|\s*STRENGTHS:\s*(.+?)\s*\|\s*WEAKNESSES:\s*(.+?)\s*\|\s*THREAT:\s*(.+?)\s*$/i;

// The prompt explicitly permits the model to write "Not available" (or
// an equivalent) for a field it genuinely cannot support with evidence,
// rather than inventing one -- normalized here to this codebase's
// existing canonical missing-value marker, never left as a model-chosen
// synonym and never replaced with fabricated content.
function normalizeStructuredCompetitorFieldValue(value: string) {
  const trimmed = value.trim();
  return /^(?:not available|unavailable|unknown|none|n\/a|na)\.?$/i.test(trimmed) ? "—" : trimmed;
}

function normalizeStructuredCompetitorType(value: string): BivCompetitorType {
  const trimmed = value.trim();
  if (/substitute/i.test(trimmed)) return "Substitute";
  if (/direct competitor/i.test(trimmed)) return "Direct competitor";
  return "Unknown";
}

// Deterministic, evidence-preserving -- reads exactly what the model
// labeled and nothing else. Never invoked on the appended "AI Executive
// Insight:\n..." block (appendIntelligenceBlock's own, structurally
// different shape, per its own definition in plan-executor.ts), since
// that block never matches this pattern at all.
export function parseStructuredCompetitorLines(content: string): BivCompetitorRecord[] {
  if (!content) return [];

  const lines = content.split("\n").map((line) => line.trim());
  const records: BivCompetitorRecord[] = [];

  for (const line of lines) {
    const match = structuredCompetitorLinePattern.exec(line);

    if (!match) {
      continue;
    }

    const [, company, type, positioning, strengths, weaknesses, threat] = match;

    if (!company.trim()) {
      continue;
    }

    records.push({
      company: company.trim(),
      type: normalizeStructuredCompetitorType(type),
      positioning: normalizeStructuredCompetitorFieldValue(positioning),
      strengths: normalizeStructuredCompetitorFieldValue(strengths),
      weaknesses: normalizeStructuredCompetitorFieldValue(weaknesses),
      threat: normalizeStructuredCompetitorFieldValue(threat),
    });
  }

  return records.slice(0, 5);
}

// Returns null (never an empty array) when the generated content
// doesn't contain even one structured line -- callers must treat null
// as "fall back to the legacy prose-parsing tiers", exactly like
// readMarketIntelligenceCanonicalState's own null contract, rather than
// treating a genuinely-empty structured result as "this report has zero
// competitors."
export function buildBusinessCompetitorLandscapeState(
  competitorLandscapeContent: string
): BusinessCompetitorLandscapeState | null {
  const competitors = parseStructuredCompetitorLines(competitorLandscapeContent);

  if (competitors.length === 0) {
    return null;
  }

  return {
    version: BUSINESS_COMPETITOR_LANDSCAPE_STATE_VERSION,
    competitors,
  };
}

// TASK #69A-15A -- the JSON-schema property definition for the NEW,
// schema-enforced "competitorLandscapeStructured" top-level key,
// requested ALONGSIDE (not instead of) competitorLandscape's own
// existing free-prose string field in the SAME single AI call.
// additionalProperties: false + every property listed in `required`
// (even the nullable ones) is what OpenAI's strict json_schema mode
// itself mandates -- "required" here means "the key must be PRESENT",
// never "the value must be a non-null string": a field the model
// cannot support with evidence is schema-permitted, and explicitly
// instructed, to be null. This is the actual enforcement mechanism
// (validated by the provider before the response is ever returned) --
// the description strings below are guidance on top of that
// enforcement, not a substitute for it.
export const BUSINESS_COMPETITOR_LANDSCAPE_JSON_SCHEMA = {
  type: "array",
  description:
    "0 to 5 independent structured records, one per real, NAMED competitor or substitute supported by the research evidence registry provided earlier in this prompt (or otherwise discussed in competitorLandscape). Include a competitor even when only its identity (and optionally positioning) is supported -- do not withhold a real, named competitor merely because strengths/weaknesses/threat lack evidence; use null for those instead. Each field must be populated ONLY when genuinely supported by evidence -- use null instead of inventing a value. Never copy positioning's text into strengths, weaknesses, or threat; each field describes a DIFFERENT aspect of this specific competitor. Do not create a record for a category/heading (e.g. \"Direct competitors\", \"Substitutes\", \"Pricing\") -- only for an actual named company or product. If no real competitor is supported by evidence, return an empty array rather than inventing one.",
  items: {
    type: "object",
    additionalProperties: false,
    properties: {
      company: {
        type: "string",
        description: "The competitor or substitute's real, specific name -- never a category heading.",
      },
      type: {
        type: "string",
        enum: ["Direct competitor", "Substitute", "Unknown"],
      },
      positioning: {
        type: ["string", "null"],
        description: "This competitor's own market positioning, in one sentence. Null if not supported by evidence.",
      },
      strengths: {
        type: ["string", "null"],
        description:
          "This competitor's own specific strength, distinct from positioning. Null if not supported by evidence -- never copy positioning here.",
      },
      weaknesses: {
        type: ["string", "null"],
        description:
          "This competitor's own specific weakness, distinct from positioning. Null if not supported by evidence -- never copy positioning here.",
      },
      threat: {
        type: ["string", "null"],
        description:
          "Low, Medium, or High, or a short phrase describing this competitor's own competitive threat level. Null if not supported by evidence -- never copy positioning here.",
      },
    },
    required: ["company", "type", "positioning", "strengths", "weaknesses", "threat"],
  },
} as const;

// Tier 0 (authoritative): reads directly from the model's own
// schema-validated JSON array -- never re-derived from prose, never
// guessed. Still defensively re-validated here (never trust ANY
// external input blindly, schema enforcement notwithstanding): a
// non-array, a non-object entry, or a blank/whitespace-only company
// name is skipped rather than crashing or fabricating a placeholder.
// Deduplicates by lowercased company name (first occurrence wins),
// exactly like #69A-15's own named-entity extraction.
export function buildBusinessCompetitorLandscapeStateFromStructuredResponse(
  raw: unknown
): BusinessCompetitorLandscapeState | null {
  if (!Array.isArray(raw)) {
    return null;
  }

  const seenCompanyNames = new Set<string>();
  const competitors: BivCompetitorRecord[] = [];

  const readNullableField = (value: unknown) =>
    typeof value === "string" && value.trim() ? normalizeStructuredCompetitorFieldValue(value) : "—";

  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }

    const record = entry as Record<string, unknown>;
    const company = typeof record.company === "string" ? record.company.trim() : "";

    if (!company) {
      continue;
    }

    const key = company.toLowerCase();

    if (seenCompanyNames.has(key)) {
      continue;
    }

    seenCompanyNames.add(key);

    competitors.push({
      company,
      type: normalizeStructuredCompetitorType(typeof record.type === "string" ? record.type : ""),
      positioning: readNullableField(record.positioning),
      strengths: readNullableField(record.strengths),
      weaknesses: readNullableField(record.weaknesses),
      threat: readNullableField(record.threat),
    });
  }

  if (competitors.length === 0) {
    return null;
  }

  return {
    version: BUSINESS_COMPETITOR_LANDSCAPE_STATE_VERSION,
    competitors: competitors.slice(0, 5),
  };
}

// Version-gated read, mirroring readMarketIntelligenceCanonicalState
// exactly: absent, malformed, or version-mismatched metadata all
// resolve to null (never a partial/best-effort object), so every
// consumer's fallback to the legacy prose-parsing tiers is the same
// single check.
export function readBusinessCompetitorLandscapeState(
  metadata: unknown
): BusinessCompetitorLandscapeState | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }

  const state = (metadata as { businessCompetitorLandscapeState?: unknown })
    .businessCompetitorLandscapeState;

  if (!state || typeof state !== "object" || Array.isArray(state)) {
    return null;
  }

  const typedState = state as Partial<BusinessCompetitorLandscapeState>;

  if (typedState.version !== BUSINESS_COMPETITOR_LANDSCAPE_STATE_VERSION || !Array.isArray(typedState.competitors)) {
    return null;
  }

  return {
    version: BUSINESS_COMPETITOR_LANDSCAPE_STATE_VERSION,
    competitors: typedState.competitors,
  };
}
