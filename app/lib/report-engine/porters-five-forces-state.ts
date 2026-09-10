// TASK #69A-28 -- Make Porter's Five Forces structurally authoritative
// at generation time.
//
// ROOT CAUSE (traced before writing any code): portersFiveForces
// (app/lib/report-engine/prompts/plan.ts, and market.ts's own separate
// copy for Market Intelligence) has always been pure free-form AI prose
// -- one continuous string covering all 5 forces in <=160 words, with
// zero structural contract (createFullReportJsonSchema, schema.ts,
// types every one of Business Idea Validation's planFields as a plain
// string, portersFiveForces included). Every renderer (page.tsx,
// Planner.tsx, ReportPdfButton.tsx) independently RE-PARSES that same
// free prose on every render via three separately-maintained copies of
// an identical forceAliases/extractForceIntensity/extractForceImplication
// regex scan, unconditionally rendering all 5 force headings regardless
// of whether the model's own prose actually discussed that force. When
// the model's single combined answer allocates its ~160-word budget
// unevenly across 5 forces (confirmed live: Supplier Power, the most
// abstract of the five and the one least directly supported by data
// already in the prompt, is the one most often shortchanged or
// omitted), the heading still renders (the renderer's own hardcoded
// force-name array is unconditional) but the intensity/implication
// scan finds nothing for that force -- exactly the reported "heading
// exists, analysis is missing" defect. This is not a parsing bug to fix
// harder; it is a genuine absence of a completeness guarantee on what
// the model is asked (and required) to produce.
//
// FIX (mirrors #69A-15A's own proven approach for Competitor Landscape
// exactly, including its documented lesson that a prompt-only
// strengthening is advisory and was confirmed insufficient by a real
// regeneration): Business Idea Validation's single report-generation
// call now ALSO requests a NEW, schema-enforced "portersFiveForcesStructured"
// key, alongside (never instead of) the existing free-prose
// portersFiveForces string. OpenAI's strict json_schema mode requires
// all 5 named forces to be present, each with a level/analysis/
// implication -- real, load-bearing enforcement, not a hopeful
// convention. Evidence honesty is preserved with an explicit
// "Insufficient evidence" level value (never a null/omitted force,
// never a fabricated High/Moderate/Low guess) -- the model is
// instructed to use it, and write a short honest sentence explaining
// why, whenever a force genuinely is not supported by the business/
// research context.
//
// buildPortersFiveForcesStateFromStructuredResponse (below) is Tier 0 --
// read directly from the model's own schema-validated JSON object,
// never re-derived from prose, never independently recomputed per
// renderer. Every renderer's pre-existing forceAliases/
// extractForceIntensity/extractForceImplication prose-parsing tiers
// remain completely unmodified, as the historical-report fallback for
// any report persisted before this state existed. Persisted as a new,
// additive, versioned reports.metadata.portersFiveForcesState key --
// no migration, no schema change to the reports table, no risk to any
// existing persisted report.
export type PorterForceKey =
  | "competitiveRivalry"
  | "threatOfNewEntrants"
  | "buyerPower"
  | "supplierPower"
  | "threatOfSubstitutes";

// Fixed, deterministic canonical ordering -- every renderer must iterate
// this array (never a hand-typed array literal of its own) so the
// on-screen/PDF force order can never silently drift from this one
// definition.
export const PORTER_FORCE_ORDER: readonly PorterForceKey[] = [
  "competitiveRivalry",
  "threatOfNewEntrants",
  "buyerPower",
  "supplierPower",
  "threatOfSubstitutes",
];

export const PORTER_FORCE_LABELS: Readonly<Record<PorterForceKey, string>> = {
  competitiveRivalry: "Competitive Rivalry",
  threatOfNewEntrants: "Threat of New Entrants",
  buyerPower: "Buyer Power",
  supplierPower: "Supplier Power",
  threatOfSubstitutes: "Threat of Substitutes",
};

export const PORTER_FORCE_LEVEL_VALUES = ["High", "Moderate", "Low", "Insufficient evidence"] as const;
export type PorterForceLevel = (typeof PORTER_FORCE_LEVEL_VALUES)[number];

export type PorterForceRecord = {
  level: PorterForceLevel;
  // Never an empty string: normalizeStructuredPorterText below
  // substitutes an honest, generic "insufficient evidence" sentence
  // for any missing/blank value -- callers can always render this
  // directly, with no additional null-check.
  analysis: string;
  implication: string;
};

export const PORTERS_FIVE_FORCES_STATE_VERSION = 1;

export type PortersFiveForcesState = {
  version: typeof PORTERS_FIVE_FORCES_STATE_VERSION;
  forces: Readonly<Record<PorterForceKey, PorterForceRecord>>;
};

function normalizeForceLevel(value: unknown): PorterForceLevel {
  const trimmed = typeof value === "string" ? value.trim().toLowerCase() : "";

  if (/^(?:high|strong|significant|intense|severe)\b/.test(trimmed)) return "High";
  if (/^(?:moderate|medium)\b/.test(trimmed)) return "Moderate";
  if (/^(?:low|weak|limited|minimal)\b/.test(trimmed)) return "Low";

  return "Insufficient evidence";
}

// The model is schema-permitted (and explicitly instructed) to write a
// short honest sentence explaining why a force lacks evidence rather
// than leaving analysis/implication blank -- but this is a defensive
// second line, never trusting the model's output alone: a blank/
// whitespace-only value is always replaced with this same honest,
// force-agnostic sentence, never silently rendered as empty space.
function normalizeStructuredPorterText(value: unknown, forceLabel: string): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed || `Insufficient evidence to assess ${forceLabel.toLowerCase()} for this business.`;
}

// TASK #69A-28 -- the JSON-schema property definition for the NEW,
// schema-enforced "portersFiveForcesStructured" top-level key, requested
// ALONGSIDE (not instead of) portersFiveForces' own existing free-prose
// string field in the SAME single Business Idea Validation generation
// call. additionalProperties: false + every property listed in
// `required` is what OpenAI's strict json_schema mode itself mandates --
// "required" means "the key must be PRESENT", never "the value must
// assert real certainty": a force the business/research context does
// not support is schema-permitted, and explicitly instructed, to use
// level "Insufficient evidence" instead of a fabricated rating.
function porterForceSchema(forceLabel: string, guidance: string) {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      level: {
        type: "string",
        enum: [...PORTER_FORCE_LEVEL_VALUES],
        description: `Qualitative intensity of ${forceLabel} for this specific business. Use "Insufficient evidence" honestly when the business/research context does not support a defensible rating -- never guess High/Moderate/Low without support.`,
      },
      analysis: {
        type: "string",
        description: `${guidance} If genuinely unsupported by the business/research context, write a short honest sentence explaining why instead of leaving this blank.`,
      },
      implication: {
        type: "string",
        description: `One concise, company-specific strategic implication of ${forceLabel} for this business. If genuinely unsupported, write a short honest sentence explaining why instead of leaving this blank.`,
      },
    },
    required: ["level", "analysis", "implication"],
  };
}

export const PORTERS_FIVE_FORCES_JSON_SCHEMA = {
  type: "object",
  description:
    "Porter's Five Forces, analyzed structurally and independently for this specific business -- one object per canonical force, never omitted, never a category heading with no content. Each force must be grounded in this business's own actual value chain, switching costs, distribution dependencies, or margin pressure (and, for supplierPower specifically, this business's own real upstream/platform dependencies as implied by its described product, data, or infrastructure needs) -- never a generic industry template and never a different business's dependencies. Do not invent certainty: use level \"Insufficient evidence\" and say so honestly in analysis/implication whenever the business/research context does not support a defensible rating for that force.",
  additionalProperties: false,
  properties: {
    competitiveRivalry: porterForceSchema(
      "Competitive Rivalry",
      "This business's competitive rivalry specifically -- intensity of existing competition, differentiation, and pricing pressure."
    ),
    threatOfNewEntrants: porterForceSchema(
      "Threat of New Entrants",
      "This business's threat of new entrants specifically -- barriers to entry, capital requirements, and switching costs for this business's own market."
    ),
    buyerPower: porterForceSchema(
      "Buyer Power",
      "This business's buyer power specifically -- customer concentration, price sensitivity, and switching costs for this business's own buyers."
    ),
    supplierPower: porterForceSchema(
      "Supplier Power",
      "This business's supplier/platform power specifically -- concentration or switching cost of the real upstream providers this business actually depends on (e.g. data/integration platforms, cloud/AI/model infrastructure, payment or accounting rails, or other dependencies implied by its own described product and operations). Ground this in what this business is described as actually depending on -- never a generic or unrelated industry's suppliers."
    ),
    threatOfSubstitutes: porterForceSchema(
      "Threat of Substitutes",
      "This business's threat of substitutes specifically -- alternative solutions or workarounds customers could use instead of this business's own product."
    ),
  },
  required: [...PORTER_FORCE_ORDER],
} as const;

// Tier 0 (authoritative): reads directly from the model's own
// schema-validated JSON object -- never re-derived from prose, never
// guessed. Still defensively re-validated here (never trust ANY
// external input blindly, schema enforcement notwithstanding). The
// completeness invariant is enforced here, at the single point every
// caller goes through: this returns null (never a partial 3-or-4-force
// object) unless all 5 canonical forces are present and well-formed,
// so no caller can ever end up silently rendering fewer than 5 --
// either every force is authoritative, or the caller falls back to its
// own existing historical-report tiers for the WHOLE section.
export function buildPortersFiveForcesStateFromStructuredResponse(
  raw: unknown
): PortersFiveForcesState | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }

  const record = raw as Record<string, unknown>;
  const forces: Partial<Record<PorterForceKey, PorterForceRecord>> = {};

  for (const key of PORTER_FORCE_ORDER) {
    const entry = record[key];

    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }

    const entryRecord = entry as Record<string, unknown>;
    const label = PORTER_FORCE_LABELS[key];

    forces[key] = {
      level: normalizeForceLevel(entryRecord.level),
      analysis: normalizeStructuredPorterText(entryRecord.analysis, label),
      implication: normalizeStructuredPorterText(entryRecord.implication, label),
    };
  }

  if (PORTER_FORCE_ORDER.some((key) => !forces[key])) {
    return null;
  }

  return {
    version: PORTERS_FIVE_FORCES_STATE_VERSION,
    forces: forces as Record<PorterForceKey, PorterForceRecord>,
  };
}

// Version-gated read, mirroring readBusinessCompetitorLandscapeState/
// readMarketIntelligenceCanonicalState exactly: absent, malformed, or
// version-mismatched metadata all resolve to null (never a partial/
// best-effort object), so every consumer's fallback to the legacy
// prose-parsing tiers is the same single check -- and every consumer
// that DOES get a non-null result is guaranteed, by construction, to
// have all 5 forces.
export function readPortersFiveForcesState(metadata: unknown): PortersFiveForcesState | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }

  const state = (metadata as { portersFiveForcesState?: unknown }).portersFiveForcesState;

  if (!state || typeof state !== "object" || Array.isArray(state)) {
    return null;
  }

  const typedState = state as Partial<PortersFiveForcesState>;

  if (
    typedState.version !== PORTERS_FIVE_FORCES_STATE_VERSION ||
    !typedState.forces ||
    typeof typedState.forces !== "object" ||
    Array.isArray(typedState.forces)
  ) {
    return null;
  }

  const forces = typedState.forces as Record<string, unknown>;

  if (
    PORTER_FORCE_ORDER.some((key) => {
      const entry = forces[key];
      return (
        !entry ||
        typeof entry !== "object" ||
        typeof (entry as PorterForceRecord).level !== "string" ||
        typeof (entry as PorterForceRecord).analysis !== "string" ||
        typeof (entry as PorterForceRecord).implication !== "string"
      );
    })
  ) {
    return null;
  }

  return {
    version: PORTERS_FIVE_FORCES_STATE_VERSION,
    forces: typedState.forces as Record<PorterForceKey, PorterForceRecord>,
  };
}

// TASK #69A-38 -- ROOT CAUSE FIX: when portersFiveForcesStructured comes
// back null/incomplete from a generation (whatever the cause -- the model
// left the field blank, a schema mismatch, or a per-field AI-failure
// fallback substituted a single generic paragraph), every caller
// previously fell all the way through to each RENDERER's own independent
// forceAliases/extractForceIntensity/extractForceImplication prose scan of
// the single free-text portersFiveForces field -- confirmed live: a fresh
// report whose model output (or fallback text) only substantively
// discussed Buyer Power and Threat of New Entrants in one merged sentence
// produced exactly "Rivalry empty, Entrants generic, Buyer near-duplicate
// generic, Supplier empty, Substitutes empty" once 3 independent per-force
// regex scans ran against that single uneven paragraph -- the EXACT
// pre-#69A-28 defect this task's own history describes, reintroduced
// anywhere Tier 0 is incomplete. This is a NEW Tier 1, generation-time
// synthesis: it runs the SAME alias-scoped intensity/implication
// extraction every renderer already performs (mirrored here, not
// duplicated a 4th time in each renderer), but -- unlike any single
// renderer's own copy -- guarantees exactly 5 independent, well-formed
// force records: a force the prose genuinely discusses keeps its REAL
// extracted level/analysis (never fabricated), and any force the prose
// does not support gets the SAME honest "Insufficient evidence" sentence
// Tier 0 already uses, never left blank and never duplicated from another
// force's text. Persisted into the SAME versioned portersFiveForcesState
// key Tier 0 writes, so every renderer's existing
// `readPortersFiveForcesState(metadata) ?? own-legacy-scan` call site
// automatically prefers this for every report generated from here on,
// with zero renderer changes and zero risk to any report persisted before
// this function existed (those have no portersFiveForcesState key at all,
// and keep using their own renderer-local legacy scan exactly as before).
const LEGACY_PROSE_FORCE_ALIASES: Readonly<Record<PorterForceKey, string[]>> = {
  competitiveRivalry: ["rivalry", "competitive rivalry", "rekabet yoğunluğu"],
  threatOfNewEntrants: ["threat of (?:new )?entr(?:y|ants)", "new entrants", "barriers? to entry", "giriş engeli"],
  buyerPower: ["buyer power", "bargaining power of buyers", "alıcı gücü"],
  supplierPower: ["supplier power", "bargaining power of suppliers", "tedarikçi gücü"],
  threatOfSubstitutes: ["threat of substitutes?", "substitute products?", "substitutes", "ikame ürün"],
};

function extractLegacyProseForceLevel(content: string, force: PorterForceKey): PorterForceLevel | null {
  for (const alias of LEGACY_PROSE_FORCE_ALIASES[force]) {
    const match = content.match(
      new RegExp(
        `(?:${alias})[^.\\n]{0,70}?\\b(high|strong|significant|intense|severe|yüksek|güçlü|moderate|medium|orta|low|weak|limited|minimal|düşük|zayıf)\\b`,
        "i"
      )
    );

    if (match) {
      const word = match[1].toLowerCase();

      if (/high|strong|significant|intense|severe|yüksek|güçlü/.test(word)) {
        return "High";
      }
      if (/moderate|medium|orta/.test(word)) {
        return "Moderate";
      }
      return "Low";
    }
  }

  return null;
}

function extractLegacyProseForceImplication(content: string, force: PorterForceKey): string {
  const sentenceSafeSegmentPattern = "(?:[^.\\n]|(?<=\\d)\\.(?=\\d))*";
  const sentenceTerminatorPattern = "(?:(?<!\\d)\\.|\\.(?!\\d))";

  for (const alias of LEGACY_PROSE_FORCE_ALIASES[force]) {
    const match = content.match(
      new RegExp(
        `${sentenceSafeSegmentPattern}\\b(?:${alias})\\b${sentenceSafeSegmentPattern}${sentenceTerminatorPattern}`,
        "i"
      )
    );

    if (match) {
      return match[0].trim().replace(/^[-*•]\s+/, "");
    }
  }

  return "";
}

// Never null, never returns fewer than 5 forces -- the completeness
// invariant every consumer of PortersFiveForcesState already relies on
// (buildPortersFiveForcesStateFromStructuredResponse's own contract).
// Called only at generation time, only when Tier 0 (the schema-enforced
// response) is null -- never retroactively applied to an already-
// persisted report's metadata via readPortersFiveForcesState, which is
// untouched by this function.
export function buildPortersFiveForcesStateFromLegacyProse(
  content: string
): PortersFiveForcesState {
  const forces = {} as Record<PorterForceKey, PorterForceRecord>;

  for (const key of PORTER_FORCE_ORDER) {
    const label = PORTER_FORCE_LABELS[key];
    const level = content ? extractLegacyProseForceLevel(content, key) : null;
    const implication = content ? extractLegacyProseForceImplication(content, key) : "";

    forces[key] = {
      level: level ?? "Insufficient evidence",
      analysis: normalizeStructuredPorterText(implication, label),
      implication: normalizeStructuredPorterText(implication, label),
    };
  }

  return {
    version: PORTERS_FIVE_FORCES_STATE_VERSION,
    forces,
  };
}

// Shared, canonical mapping from a force's qualitative level onto the
// SAME visual bucket every renderer's own pre-existing intensity bar
// already uses (High -> 82% width, Moderate -> 55%, Low -> 28%,
// Insufficient evidence -> no bar, matching the pre-existing "Not
// specified" treatment for a force with no signal at all). One
// definition, reused by every renderer, instead of three independently
// maintained copies of the same bucket thresholds.
export function porterLevelToIntensityBar(
  level: PorterForceLevel
): { level: "High" | "Moderate" | "Low"; width: number } | null {
  if (level === "High") return { level: "High", width: 82 };
  if (level === "Moderate") return { level: "Moderate", width: 55 };
  if (level === "Low") return { level: "Low", width: 28 };
  return null;
}
