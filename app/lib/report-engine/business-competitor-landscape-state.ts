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
// TASK #69A-29 -- Make competitor weaknesses evidence-aware, structurally
// authoritative, and eliminate "Not available" where defensible analysis
// exists.
//
// ROOT CAUSE (traced before writing any code): the structured Tier 0
// path (buildBusinessCompetitorLandscapeStateFromStructuredResponse,
// below) was already firing correctly for the reported case -- company/
// type/positioning came through fine for Float/Cash Flow Frog/Futrli.
// The defect is specifically that `weaknesses` came back null far more
// often than `strengths` for the SAME competitors with the SAME
// evidence available. Two contributing causes, both confirmed by
// reading the actual prompt/schema/research code, not assumed:
//   1. domain-research.ts's "competitors" research objective ("Verify
//      current competitors, positioning, pricing, and substitute
//      offerings") never asked for differentiation/limitation signals
//      at all -- research was never directed to gather the KIND of
//      evidence a defensible weakness needs.
//   2. The schema's own `weaknesses` field description only ever said
//      "use null instead of inventing a value" -- technically already
//      permitting "a clearly evidence-grounded analytical inference"
//      (the mapping-requirement prompt's own pre-existing phrase), but
//      with no concrete permission or pattern for what a defensible
//      NEGATIVE inference about a real, named company actually looks
//      like. Confirmed asymmetric behavior: the model reliably wrote
//      strengths (a positive claim about a named competitor) but
//      defaulted weaknesses to null far more often -- a known LLM
//      caution bias against negative claims about a specific real
//      business, not a wiring bug (the field name, mapping, and
//      persistence path are all correct and unchanged).
//
// FIX: weaknesses may now be a directly-evidenced fact OR a clearly
// labeled, evidence-grounded INFERENCE (narrower target segment,
// integration limitation, pricing friction, workflow complexity,
// weaker scenario depth, limited prescriptive guidance, enterprise/SMB
// mismatch, channel limitation, switching/implementation burden --
// never a generic template weakness and never speculative criticism
// unsupported by any evidence). The new `weaknessBasis` field makes
// that provenance distinction structural (never prose-embedded, never
// inferred by a renderer): "verified" when directly documented,
// "directional" when reasonably inferred from this competitor's own
// positioning/pricing/differentiation evidence, "unavailable" when
// weaknesses is null. Optional (BUSINESS_COMPETITOR_LANDSCAPE_STATE_VERSION
// stays 1, deliberately NOT bumped) so every already-persisted report's
// existing company/type/positioning/strengths/threat data keeps working
// completely unchanged -- historical records simply have no
// weaknessBasis, and every renderer treats that as "no provenance
// qualifier to show", never a fabricated one.
//
// TASK #69A-29A -- a fresh real regeneration after #69A-29 confirmed
// this structural fix alone was insufficient: Float/Cash Flow Frog/
// Futrli (real, named direct competitors) still came back with
// weaknesses unavailable, while a generic "Spreadsheets/Quicken"
// substitute entry got one. ROOT CAUSE, traced to the ACTUAL research-
// execution code (not assumed): the generation-time schema/prompt
// permission this file already added was correct, but the model had
// nothing comparative to work with for real named competitors --
// domain-research.ts's own `RESEARCH_DOMAIN_TASKS` config (whose
// "competitors" objective #69A-29 widened) is DEAD configuration, never
// read by the real research-execution path at all; the REAL,
// load-bearing "competitors" research requirement text lives in
// app/lib/decision-intelligence/profiles.ts's `sharedBusinessResearch`
// (consumed by buildDecisionResearchPlan into every task's own query),
// and domain-research.ts's own buildTaskStageQueries further enriches
// that query from a separate `fieldSynonyms` map -- NEITHER ever
// mentioned limitations/feature-gaps/review-platform cons, and
// businessResearchSourceStages' own "authoritative_public" stage
// guidance named G2/Capterra/TrustRadius/Trustpilot as sources to
// search but never said to capture their own Cons/limitations
// sections specifically. Generic substitutes like "spreadsheets" need
// no fresh research at all -- the model's own general knowledge
// already supplies an obvious, well-known limitation (manual entry, no
// automation), which is exactly why that entry already worked while
// real named SaaS competitors, requiring real comparative evidence,
// did not. Fixed at the query-text layer (profiles.ts, domain-
// research.ts) -- see those files' own #69A-29A comments -- so real
// comparative/limitation evidence can actually reach the generation
// step this file's own #69A-29 fix already knows how to use.
export type BivCompetitorType = "Direct competitor" | "Substitute" | "Unknown";

export const WEAKNESS_BASIS_VALUES = ["verified", "directional", "unavailable"] as const;
export type WeaknessBasis = (typeof WEAKNESS_BASIS_VALUES)[number];

export type BivCompetitorRecord = {
  company: string;
  type: BivCompetitorType;
  positioning: string;
  strengths: string;
  weaknesses: string;
  // TASK #69A-29 -- optional: absent on any record built before this
  // field existed (a historical report, or a record built by a path
  // this task didn't touch). Present on every record Tier 0 or Tier 1
  // build from here on.
  weaknessBasis?: WeaknessBasis;
  // TASK #69A-45 -- optional, additive (mirrors weaknessBasis's own
  // precedent: absent on any record built before this task, never
  // required for a historical report to keep rendering correctly).
  // Extends the SAME canonical weakness structure (never a renderer-
  // specific parallel object) with the provenance ticket #69A-45 asked
  // for: which evidence registry entries actually support this specific
  // weakness (weaknessSourceRefs, the "R#" ids already cited inline as
  // "[R#]" in the weaknesses text -- extracted, never re-invented) and
  // how strong that cited evidence is (weaknessConfidence, derived from
  // those SAME evidence items' own numeric confidence field, using this
  // codebase's existing >=75/>=55 High/Medium/Low convention -- see
  // domain-research.ts's own "Confidence classification" text). Both are
  // pure derivations over already-fetched evidence (attachWeaknessProvenance,
  // below) -- never model output, never a new research call, never
  // fabricated when no citation exists.
  weaknessSourceRefs?: string[];
  weaknessConfidence?: "High" | "Medium" | "Low";
  threat: string;
};

// TASK #69A-29 -- the ONE canonical mapping from a competitor's
// weakness + its provenance onto display text, used by every renderer
// (web table x2, PDF x2) instead of reading `weaknesses` raw -- so the
// "(Directional)" qualifier can never appear in one renderer and not
// another for the same persisted report. Never appends anything when
// basis is "verified" or absent (undefined -- a historical record, or a
// genuinely verified one) so that case's visible text is byte-identical
// to before this task.
//
// TASK #69A-40 -- the UNAVAILABLE case now returns the explicit "Not
// available" (never the bare "—" sentinel) -- an ambiguous dash reads as
// "this cell was left blank" rather than "evidence genuinely could not
// support a claim here", which this fix's own root-cause work confirmed
// live is a legitimate, honest outcome for a real competitor (not a
// defect to hide). "—" remains the internal, storage-level sentinel
// (every comparison elsewhere in this file still checks against it
// directly) -- only this function's own DISPLAY text changed, so no
// persisted data or internal comparison anywhere else is affected.
export function formatCompetitorWeaknessForDisplay(record: Pick<BivCompetitorRecord, "weaknesses" | "weaknessBasis">) {
  if (record.weaknesses === "—") {
    return "Not available";
  }

  if (record.weaknessBasis !== "directional") {
    return record.weaknesses;
  }

  return `${record.weaknesses} (Directional)`;
}

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

    const normalizedWeaknesses = normalizeStructuredCompetitorFieldValue(weaknesses);

    records.push({
      company: company.trim(),
      type: normalizeStructuredCompetitorType(type),
      positioning: normalizeStructuredCompetitorFieldValue(positioning),
      strengths: normalizeStructuredCompetitorFieldValue(strengths),
      weaknesses: normalizedWeaknesses,
      // TASK #69A-29 -- the labeled-line prose format (Tier 1) carries
      // no provenance signal of its own, so a real, non-"—" value here
      // can never be confirmed as "verified" -- "directional" is the
      // honest, conservative default for anything Tier 1 recovers from
      // free text.
      weaknessBasis: normalizedWeaknesses === "—" ? "unavailable" : "directional",
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
          // TASK #69A-40 -- ROOT CAUSE FIX. Confirmed live: for a real
          // fresh business_plan generation, gathered evidence for
          // QuickBooks and Xero (this competitor's own official product
          // documentation) directly described their forecasting/
          // scenario-planning capability as a feature EMBEDDED inside a
          // broader, general-purpose accounting platform (e.g. "built-in
          // AI forecasting... available in QuickBooks Online", "cash
          // flow manager" within Xero's wider accounting suite) --
          // exactly the shape of a defensible directional inference this
          // field already permits ("a clearly reasonable, company-
          // specific INFERENCE grounded in this competitor's own
          // positioning/pricing/differentiation/review evidence already
          // gathered"). The model still returned null far more often
          // than not for these two real, well-evidenced competitors --
          // this specific inference PATTERN (secondary/embedded feature
          // within a broader platform vs. a dedicated, purpose-built
          // specialization) was never named among the field's own worked
          // examples, unlike narrower-target-segment/integration-
          // limitation/pricing-friction/etc., which already were. Naming
          // it explicitly, since it is an extremely common real
          // competitive shape (a large incumbent's bundled add-on vs. a
          // focused best-of-breed challenger) and was already implicitly
          // licensed, not newly invented here.
          "This competitor's own specific, defensible weakness or limitation, distinct from positioning -- never copy positioning here. May be a DIRECTLY documented weakness (a review, comparison, or stated limitation) OR a clearly reasonable, company-specific INFERENCE grounded in this competitor's own positioning/pricing/differentiation/review evidence already gathered (e.g. narrower target segment, integration limitation, pricing friction, workflow complexity, weaker scenario depth, limited prescriptive guidance, enterprise/SMB mismatch, channel limitation, switching/implementation burden, or the specific capability this report's own product differentiates on being offered only as a secondary, embedded feature within a broader general-purpose platform rather than a dedicated, purpose-built specialization). A directional inference requires a clear evidence-backed comparison (e.g. this competitor explicitly lacks a feature multiple comparable alternatives support, its own review/comparison evidence names a specific, material limitation, or its own official documentation describes the relevant capability as embedded within a wider general-purpose product rather than a dedicated specialization) -- NEVER generic sentiment (\"seems expensive\", \"looks outdated\", \"probably weak\") or assumptions based only on company size/age, and never invented merely because no directly documented weakness exists -- absence of evidence about a limitation is never itself evidence of that limitation. Do not default to null merely because no explicit negative statement exists -- an evidence-grounded inference is expected when the evidence supports one. Null only when neither a documented weakness nor a defensible, comparison-backed inference exists for this specific competitor.",
      },
      weaknessBasis: {
        type: "string",
        enum: [...WEAKNESS_BASIS_VALUES],
        description:
          "Provenance of the weaknesses field above. \"verified\" ONLY when the evidence registry directly documents this weakness by name. \"directional\" when it is a reasonable inference from this competitor's own positioning/pricing/differentiation evidence rather than a directly stated fact. \"unavailable\" if and only if weaknesses is null.",
      },
      threat: {
        type: ["string", "null"],
        description:
          "Low, Medium, or High, or a short phrase describing this competitor's own competitive threat level. Null if not supported by evidence -- never copy positioning here.",
      },
    },
    required: ["company", "type", "positioning", "strengths", "weaknesses", "weaknessBasis", "threat"],
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

  // TASK #69A-29 -- never trust the model's own weaknessBasis blindly:
  // "verified" is only honored when weaknesses is actually non-"—" AND
  // the model explicitly said "verified"; any other combination
  // (missing, malformed, or a "verified" claim with no actual
  // weakness text) safely resolves to "directional"/"unavailable" by
  // the SAME rule the schema itself requires (basis must match
  // whether weaknesses is null), so a schema-non-compliant response
  // can never silently claim stronger provenance than it earned.
  const resolveWeaknessBasis = (weaknesses: string, rawBasis: unknown): WeaknessBasis => {
    if (weaknesses === "—") {
      return "unavailable";
    }

    return rawBasis === "verified" ? "verified" : "directional";
  };

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

    const weaknesses = readNullableField(record.weaknesses);

    competitors.push({
      company,
      type: normalizeStructuredCompetitorType(typeof record.type === "string" ? record.type : ""),
      positioning: readNullableField(record.positioning),
      strengths: readNullableField(record.strengths),
      weaknesses,
      weaknessBasis: resolveWeaknessBasis(weaknesses, record.weaknessBasis),
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

// TASK #69A-40B -- ROOT CAUSE FIX. Confirmed live, by direct inspection
// of a real fresh generation's own persisted report: the SAME response
// that left QuickBooks/Xero's structured `weaknesses` "Not available"
// simultaneously wrote, in its own free-form "problem" field, "product-
// gap evidence is supported by incumbent product pages showing limited
// embedded scenario depth [R6][R7]" -- citing the EXACT SAME evidence
// registry entries (R6: Intuit QuickBooks Help Center's own "Intuit
// Intelligence forecasting... available in QuickBooks Online" page; R7:
// Xero US's own "cash flow manager" page, both literally describing the
// capability as "built-in"/"embedded") that #69A-40's schema fix named
// as exactly the pattern the weaknesses field should recognize. The
// model reliably drew this inference in loose prose but not inside the
// strict, schema-validated competitorLandscapeStructured JSON for the
// SAME evidence in the SAME response -- a known LLM caution-bias
// asymmetry (structured output feels more "final"/factual to the model
// than hedged prose), not a wiring bug and not a research gap.
//
// FIX: a deterministic, code-level Tier 1.5 safety net -- never a second
// AI call, never parsing the report's own final prose (that would be
// exactly the "parse final prose as the source of truth" this task's
// own instructions forbid). It reuses ONLY the same raw, already-paid-
// for research evidence registry the generation call itself was given,
// and only ever WRITES a weakness for a competitor Tier 0 left
// "unavailable" -- it never overrides a weakness the model itself
// already supplied (verified or directional).
//
// Entity attribution safety: a competitor's own name is tokenized (after
// stripping the model's own parenthetical gloss, e.g. "(example FP&A
// startup)", which describes the model's role for the company, not its
// identity) into distinct tokens (>= 4 chars, to avoid short/generic
// false positives), and an evidence item is only treated as belonging to
// that SPECIFIC competitor when the item's own URL HOSTNAME contains one
// of those tokens -- the single most authoritative, hardest-to-fake
// signal (this competitor's OWN official domain), deliberately stronger
// than matching against the free-text publisher/sourceTitle string
// (which can legitimately be a multi-vendor aggregate citation, e.g.
// "OnDeck; market.us; LivePlan; Planful" -- confirmed live this exact
// aggregate citation's URL list keeps "liveplan" buried in a path
// segment, never in the (first, authoritative) hostname, so it is
// correctly never mistaken for LivePlan-specific evidence).
//
// Claim-shape safety: even after a competitor-specific, official-domain
// evidence item is found, this only ever produces a DIRECTIONAL
// inference (never "verified" -- describing a capability as embedded is
// evidence of a SHAPE, not a directly-stated limitation), and ONLY when
// that evidence item's own claim/value text uses the specific, narrow,
// pre-vetted "built-in/embedded/bundled" vocabulary -- never a broader
// or fuzzier pattern that could sweep in an unrelated characteristic.
// Every other competitor (no official-domain evidence at all, or
// official-domain evidence that says nothing about how the capability is
// packaged -- Dryrun's real case: a genuinely content-less URL stub)
// is left completely untouched, still honestly "unavailable".
const EMBEDDED_FEATURE_EVIDENCE_PATTERN =
  /\b(?:built[- ]?in|built directly into|embedded|bundled|natively (?:built|integrated) into)\b/i;
const MIN_COMPETITOR_ENTITY_TOKEN_LENGTH = 4;

// TASK #69A-45 -- ROOT CAUSE FIX. Confirmed live (5 consecutive fresh
// business_plan reports, inspected via a temporary, immediately-deleted
// service-role scratch script): Xero was reliably enriched with a
// directional weakness, but a real named competitor written as a
// genuinely multi-word company name with NO comma/slash/ampersand
// separator -- the model's most common real shape for this exact
// company, "Intuit QuickBooks" -- was NEVER enriched, even though the
// exact same official-domain, embedded-feature evidence this function
// was built to recognize (quickbooks.intuit.com's own "built-in AI
// forecasting" page) existed in every one of those runs (this file's
// own #69A-40B comment already names this evidence). ROOT CAUSE: the
// original split pattern only breaks a company string on an explicit
// multi-company delimiter (/, &, "and", "vs") -- a single company name
// with an internal space but no such delimiter ("Intuit QuickBooks")
// survived the split as ONE token, "intuit quickbooks". A real URL
// hostname never contains a literal space, so `hostname.includes(token)`
// could never match that token against ANY hostname -- not a research
// gap, not a claim-shape gap, a pure tokenization defect that silently
// disabled this entire enrichment path for any multi-word,
// undelimited competitor name (a very common real shape, not an edge
// case). FIX: additionally split any already-produced multi-word
// segment on whitespace, contributing each individual word (still
// gated by the same MIN_COMPETITOR_ENTITY_TOKEN_LENGTH) plus the
// words joined with no separator at all (many real product domains
// concatenate a multi-word brand, e.g. "cashflowfrog.com") as further
// candidate tokens -- purely additive, so every existing single-word or
// already-delimited company name (Xero, "Dryrun / Fathom") tokenizes
// identically to before. A short denylist of generic business-name
// filler words that are common across many UNRELATED companies (and so
// would otherwise raise this heuristic's false-positive-match risk far
// more than a distinctive brand word does) is excluded from the
// individual-word contribution only -- never from the original
// whole-segment or concatenated-word tokens, which already carry the
// distinctiveness of the full multi-word name.
const GENERIC_COMPANY_NAME_WORDS = new Set([
  "and", "the", "for", "with", "group", "team", "tech", "labs", "cloud",
  "data", "suite", "online", "app", "apps", "software", "systems",
  "solutions", "company", "corp", "inc", "ltd", "llc", "co", "plus",
  "pro", "hub", "desk", "book", "flow", "cash", "pay", "bank", "card",
  "wallet", "invoice", "pricing", "plan", "plans", "category",
]);

function extractCompetitorEntityTokens(company: string): string[] {
  const segments = company
    .replace(/\([^)]*\)/g, " ")
    .split(/[\/,&]|\s+(?:and|vs\.?)\s+/i)
    .map((segment) => segment.trim().toLowerCase())
    .filter(Boolean);

  const tokens = new Set<string>();

  for (const segment of segments) {
    if (segment.length >= MIN_COMPETITOR_ENTITY_TOKEN_LENGTH) {
      tokens.add(segment);
    }

    const words = segment.split(/\s+/).filter(Boolean);
    if (words.length <= 1) {
      continue;
    }

    for (const word of words) {
      if (word.length >= MIN_COMPETITOR_ENTITY_TOKEN_LENGTH && !GENERIC_COMPANY_NAME_WORDS.has(word)) {
        tokens.add(word);
      }
    }

    const concatenated = words.join("");
    if (concatenated.length >= MIN_COMPETITOR_ENTITY_TOKEN_LENGTH) {
      tokens.add(concatenated);
    }
  }

  return [...tokens];
}

function findOfficialDomainEvidenceForCompetitor(
  tokens: readonly string[],
  evidence: readonly { id: string; url: string; claim: string; value: string }[]
) {
  return evidence.find((item) => {
    let hostname = "";
    try {
      hostname = new URL(item.url).hostname.toLowerCase();
    } catch {
      return false;
    }
    return tokens.some((token) => hostname.includes(token));
  });
}

export function enrichCompetitorWeaknessesFromEvidence(
  state: BusinessCompetitorLandscapeState | null,
  evidence: readonly { id: string; url: string; claim: string; value: string }[]
): BusinessCompetitorLandscapeState | null {
  if (!state || !evidence.length) {
    return state;
  }

  return {
    ...state,
    competitors: state.competitors.map((competitor) => {
      if (competitor.weaknessBasis !== "unavailable") {
        return competitor;
      }

      const tokens = extractCompetitorEntityTokens(competitor.company);
      if (!tokens.length) {
        return competitor;
      }

      const officialEvidence = findOfficialDomainEvidenceForCompetitor(tokens, evidence);
      if (!officialEvidence) {
        return competitor;
      }

      const combinedText = `${officialEvidence.claim} ${officialEvidence.value}`;
      if (!EMBEDDED_FEATURE_EVIDENCE_PATTERN.test(combinedText)) {
        return competitor;
      }

      return {
        ...competitor,
        weaknesses: `Its own official product documentation describes the relevant capability as a feature embedded within a broader general-purpose platform rather than a dedicated, purpose-built specialization [${officialEvidence.id}].`,
        weaknessBasis: "directional" as const,
      };
    }),
  };
}

const WEAKNESS_SOURCE_REF_PATTERN = /\[(R\d+)\]/g;

// TASK #69A-45 -- canonical structure item D: this is the ONE place
// weaknessSourceRefs/weaknessConfidence are ever derived, reused
// identically by every renderer through the persisted competitor
// record -- never a renderer-specific reconstruction. Runs AFTER
// enrichCompetitorWeaknessesFromEvidence (both Tier 0/Tier 1's own
// model- or prose-authored [R#] citations AND Tier 1.5's own generated
// citation are already in place by this point), reusing the SAME
// already-fetched evidence registry -- never a new research call, never
// parsing report prose, never invented when no citation exists.
//
// Deliberately conservative: a weakness's confidence is the MINIMUM
// (never the average or max) of its cited evidence items' own
// confidence scores -- a claim citing one strong and one weak source is
// only as credible as its weakest link, not its strongest. Bucketed
// with this codebase's own existing >=75/>=55 High/Medium/Low
// convention (see domain-research.ts's "Confidence classification"
// text) rather than a newly-invented threshold. A weakness with no
// resolvable [R#] citation at all (a defensible DIRECTIONAL inference
// with no single citable source, or "unavailable") gets neither field
// populated -- never a fabricated confidence for evidence that isn't
// actually cited.
export function attachWeaknessProvenance(
  state: BusinessCompetitorLandscapeState | null,
  evidence: readonly { id: string; confidence: number }[]
): BusinessCompetitorLandscapeState | null {
  if (!state) {
    return state;
  }

  const evidenceById = new Map(evidence.map((item) => [item.id, item]));

  return {
    ...state,
    competitors: state.competitors.map((competitor) => {
      if (competitor.weaknessBasis === "unavailable" || !competitor.weaknesses) {
        return competitor;
      }

      const refs = [...competitor.weaknesses.matchAll(WEAKNESS_SOURCE_REF_PATTERN)].map(
        (match) => match[1]
      );

      if (refs.length === 0) {
        return competitor;
      }

      const matchedConfidences = refs
        .map((ref) => evidenceById.get(ref)?.confidence)
        .filter((value): value is number => typeof value === "number");

      if (matchedConfidences.length === 0) {
        return { ...competitor, weaknessSourceRefs: refs };
      }

      const minConfidence = Math.min(...matchedConfidences);
      const weaknessConfidence: "High" | "Medium" | "Low" =
        minConfidence >= 75 ? "High" : minConfidence >= 55 ? "Medium" : "Low";

      return { ...competitor, weaknessSourceRefs: refs, weaknessConfidence };
    }),
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
