// Evidence-based confidence for the Ask / AI Advisor chat path ONLY.
//
// Deliberately not added to sanitizeAiResponseText, which is shared with the
// report engine. That engine has a real, evidence-backed confidence model
// (confidenceClassification "Verified" | "Estimated", source-derived scores
// with 65/40 thresholds); stripping percentages there would destroy a
// deliberate design. Chat has no such model, so in chat every percentage is
// unsupported precision.
//
// Two independent mechanisms, because prompt guidance alone is not reliable:
//   1. buildChatConfidenceInstruction -- tells the model the standard AND what
//      evidence this specific turn actually has.
//   2. normalizeChatConfidencePrecision + capChatConfidenceToEvidence --
//      deterministic output checks that hold even when the model ignores (1).

export type ChatConfidenceBand = "Low" | "Moderate" | "High";

const BAND_RANK: Record<ChatConfidenceBand, number> = {
  Low: 0,
  Moderate: 1,
  High: 2,
};

export type ChatConfidenceEvidence = {
  // A validated research bundle or a live web search actually ran for THIS turn.
  verifiedSources: boolean;
  // Something specific to this user's situation: an attached file, a saved
  // report in context, or a populated advisor profile.
  userSpecificData: boolean;
};

// The highest band this turn's evidence can support.
//
// "High" requires BOTH external verification and user-specific data: a
// confident answer about someone's business needs to know both the market and
// the business. One of the two supports "Moderate". Neither supports "Low" --
// general reasoning is still useful, it is just not evidence.
//
// Mode is not an input. Balanced may gather more evidence, and more evidence
// raises this ceiling on its own merits; choosing Balanced never does.
export function resolveChatConfidenceCeiling(
  evidence: ChatConfidenceEvidence
): ChatConfidenceBand {
  if (evidence.verifiedSources && evidence.userSpecificData) {
    return "High";
  }

  if (evidence.verifiedSources || evidence.userSpecificData) {
    return "Moderate";
  }

  return "Low";
}

// A percentage in a chat answer is always unsupported: nothing in this path
// computes one. Rather than deleting the model's meaning, it is mapped to the
// nearest honest band -- and never to "High", because a number invented by the
// model cannot be evidence of high certainty.
function bandFromUnsupportedPercent(percent: number): ChatConfidenceBand {
  return percent >= 50 ? "Moderate" : "Low";
}

const CONFIDENCE_PERCENT_PATTERNS: Array<{
  pattern: RegExp;
  replace: (band: ChatConfidenceBand, match: string) => string;
}> = [
  // "Confidence: 95%", "Confidence level — 95%"
  {
    pattern: /\bconfidence\s*(?:level)?\s*[:\-–—]\s*\(?\s*(\d{1,3})\s*%\s*\)?/gi,
    replace: (band) => `Confidence: ${band}`,
  },
  // "with 95% confidence", "at 95 % confidence"
  {
    pattern: /\b(?:with|at)\s+\(?\s*(\d{1,3})\s*%\s*\)?\s+confidence\b/gi,
    replace: (band) => `with ${band.toLowerCase()} confidence`,
  },
  // bare "95% confidence"
  {
    pattern: /\(?\s*(\d{1,3})\s*%\s*\)?\s+confidence\b/gi,
    replace: (band) => `${band.toLowerCase()} confidence`,
  },
];

/**
 * Replaces percentage confidence claims with qualitative bands. Pure, needs no
 * evidence context, and safe to run repeatedly -- including on the partial text
 * of a stream, because an incomplete number cannot match a complete pattern.
 * Text with no confidence percentage is returned byte-identical.
 */
export function normalizeChatConfidencePrecision(text: string): string {
  if (!text || !/\d\s*%/.test(text)) {
    return text;
  }

  return CONFIDENCE_PERCENT_PATTERNS.reduce(
    (current, { pattern, replace }) =>
      current.replace(pattern, (match, rawPercent: string) => {
        const percent = Number.parseInt(rawPercent, 10);

        if (!Number.isFinite(percent)) {
          return match;
        }

        return replace(bandFromUnsupportedPercent(percent), match);
      }),
    text
  );
}

const STATED_BAND_PATTERNS: RegExp[] = [
  /\b(confidence\s*(?:level)?\s*[:\-–—]\s*)(Low|Moderate|Medium|High)\b/gi,
  /\b()(Low|Moderate|Medium|High)(?=\s+confidence\b)/gi,
];

function normalizeBandWord(word: string): ChatConfidenceBand {
  const lowered = word.toLowerCase();

  if (lowered === "high") return "High";
  if (lowered === "low") return "Low";
  return "Moderate";
}

/**
 * Lowers any stated band that exceeds what this turn's evidence supports, and
 * leaves anything at or below the ceiling untouched. Never raises a band: a
 * cautious model stays cautious.
 */
export function capChatConfidenceToEvidence(
  text: string,
  ceiling: ChatConfidenceBand
): string {
  if (!text || !/confidence/i.test(text)) {
    return text;
  }

  return STATED_BAND_PATTERNS.reduce(
    (current, pattern) =>
      current.replace(pattern, (match, prefix: string, band: string) => {
        const stated = normalizeBandWord(band);

        if (BAND_RANK[stated] <= BAND_RANK[ceiling]) {
          return match;
        }

        const replacement =
          band === band.toLowerCase() ? ceiling.toLowerCase() : ceiling;

        return `${prefix}${replacement}`;
      }),
    text
  );
}

/**
 * The prompt half of the standard. States the rule AND the evidence this turn
 * actually has, so the model is not guessing at its own grounding.
 */
export function buildChatConfidenceInstruction(
  evidence: ChatConfidenceEvidence
): string {
  const ceiling = resolveChatConfidenceCeiling(evidence);
  const available = [
    evidence.verifiedSources ? "verified external sources" : "",
    evidence.userSpecificData ? "user-specific business data" : "",
  ].filter(Boolean);

  return [
    "Confidence rules. State a recommendation and your confidence in it as two SEPARATE things: a clear recommendation does not by itself mean high confidence, and 'GO with Moderate confidence' is a valid, useful answer.",
    "Express confidence only as Low, Moderate or High. Never state a confidence percentage: no score is computed anywhere in this system, so any number would be invented precision.",
    available.length > 0
      ? `Evidence available for this answer: ${available.join(" and ")}. Confidence must not exceed ${ceiling}.`
      : `No verified sources and no user-specific business data were available for this answer, so it rests on general reasoning. Confidence must not exceed ${ceiling}.`,
    "When confidence is below High, briefly say what would raise it -- name the missing evidence, at most three short points, only when it is materially useful. Do not add generic disclaimers.",
  ].join(" ");
}

// The ceiling has to travel to the client, because the client is what renders
// the live stream. A response header carries it: it arrives BEFORE the first
// body byte, so the very first painted frame can already be capped, and it
// costs nothing per chunk.
export const CHAT_CONFIDENCE_CEILING_HEADER = "X-Zerinix-Confidence-Ceiling";

/**
 * Reads a ceiling sent by the server. Falls back to "Moderate" when the header
 * is absent or unrecognised: an unknown evidence situation is a limited one,
 * and the standard's safe default is that limited evidence cannot be High. The
 * cost of being wrong is a conservative band, never an overstated one.
 */
export function parseChatConfidenceCeiling(
  headerValue: string | null | undefined
): ChatConfidenceBand {
  if (headerValue === "High" || headerValue === "Moderate" || headerValue === "Low") {
    return headerValue;
  }

  return "Moderate";
}
