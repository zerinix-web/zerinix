// Decision Engine V2 -- deterministic evidence-signal extraction.
//
// PHASE 9 (COST CONTROL): this module makes ZERO new AI/web-search
// calls. It reads report section text ZERINIX has ALREADY generated
// (the same Record<MarketReportField, string> the legacy engine
// formats for display) and applies keyword/pattern scanning -- the same
// class of technique already used throughout this codebase (see
// financial-model.ts's hasValidationEvidence negation handling,
// decision-contradiction-gate.ts's affirmative-action patterns) -- to
// recover a SENTIMENT signal the legacy engine never computes at all.
//
// This is the module that answers the deep architectural gap found
// during investigation: MarketResearchCoverage's dimensions (market-
// Confidence, competitiveEvidence, productEvidence, financialEvidence)
// measure evidence VOLUME (how many independent sources exist), not
// evidence SENTIMENT (do those sources describe a good or bad market).
// A market with ten well-documented, fiercely entrenched competitors
// scores HIGHER "competitiveEvidence" than one with a single, thinly
// documented weak competitor -- the legacy engine cannot tell those
// apart. Every scanner below is deliberately one-directional-honest: it
// only ever reports a signal it actually found textual evidence for; a
// section with no matches of either polarity contributes nothing (not a
// negative default), which is what lets dimensions.ts correctly land on
// "unknown" instead of "unfavorable" when a topic simply was not
// discussed.
//
// Never claims precision it doesn't have: this is pattern matching over
// natural-language prose, not a semantic classifier. See dimensions.ts
// and the final report for the explicit limitation this implies.

function splitSentences(text: string): string[] {
  return (text || "")
    .split(/(?<=[.!?])\s+(?=[A-ZÇĞİÖŞÜ0-9])|\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

// Mirrors financial-model.ts's/investment-score.ts's own negation
// convention: a sentence containing one of these words near a signal
// phrase is read as DENYING that phrase, not asserting it (e.g. "no
// dominant incumbent exists" must not count as evidence OF a dominant
// incumbent).
const NEGATION_PATTERN =
  /\b(?:no|not|none|never|without|lacks?|lacking|isn't|aren't|wasn't|weren't|doesn't|don't|didn't|hasn't|haven't|hadn't)\b/i;

export type SignalMatch = {
  sentence: string;
  matchedPhrase: string;
};

export type SignalScan = {
  positive: SignalMatch[];
  negative: SignalMatch[];
};

// Whether NEGATION_PATTERN fires anywhere in `sentence` OUTSIDE the
// span already consumed by `match` -- NOT whether it fires anywhere in
// the raw sentence. Several vocabulary patterns are THEMSELVES phrased
// as a negation because that phrasing IS the finding (e.g. "no clear
// dominant player" is a positive competitive signal in its own right,
// "no clear demand" is a negative demand signal in its own right).
// Testing NEGATION_PATTERN against the whole sentence made every such
// pattern self-suppressing -- it would always find its own "no" and
// treat the match as negated-away, permanently dead code regardless of
// input. Confirmed live: fixture text "The market is fragmented with
// no clear dominant player" never registered as favorable competitive
// intensity because of exactly this. Excising the matched span before
// testing fixes this while still correctly catching a genuine EXTERNAL
// negation like "It is not true that there is no clear dominant
// player."
function isNegatedOutsideMatch(sentence: string, match: RegExpMatchArray): boolean {
  const index = match.index ?? 0;
  const remainder = sentence.slice(0, index) + sentence.slice(index + match[0].length);
  return NEGATION_PATTERN.test(remainder);
}

function scanSentences(
  sentences: readonly string[],
  positivePatterns: readonly RegExp[],
  negativePatterns: readonly RegExp[]
): SignalScan {
  const positive: SignalMatch[] = [];
  const negative: SignalMatch[] = [];

  for (const sentence of sentences) {
    for (const pattern of negativePatterns) {
      const match = sentence.match(pattern);
      if (!match) continue;
      if (!isNegatedOutsideMatch(sentence, match)) {
        negative.push({ sentence: sentence.slice(0, 220), matchedPhrase: match[0] });
      }
    }

    for (const pattern of positivePatterns) {
      const match = sentence.match(pattern);
      if (!match) continue;
      if (!isNegatedOutsideMatch(sentence, match)) {
        positive.push({ sentence: sentence.slice(0, 220), matchedPhrase: match[0] });
      }
    }
  }

  return { positive, negative };
}

export function scanText(
  text: string,
  positivePatterns: readonly RegExp[],
  negativePatterns: readonly RegExp[]
): SignalScan {
  return scanSentences(splitSentences(text), positivePatterns, negativePatterns);
}

export function scanFields(
  sections: Partial<Record<string, string>>,
  fields: readonly string[],
  positivePatterns: readonly RegExp[],
  negativePatterns: readonly RegExp[]
): SignalScan {
  const combined: SignalScan = { positive: [], negative: [] };
  for (const field of fields) {
    const scan = scanText(sections[field] || "", positivePatterns, negativePatterns);
    combined.positive.push(...scan.positive);
    combined.negative.push(...scan.negative);
  }
  return combined;
}

// --- Demand / market-attractiveness signal vocabulary -----------------

export const demandPositivePatterns: RegExp[] = [
  // Adjective-before-noun order ("growing demand", "strong adoption")...
  /\b(?:strong|robust|rapidly?|significant|growing|rising|surging|accelerating)\s+(?:demand|adoption|growth)\b/i,
  // ...and subject-verb order ("demand is growing/accelerating", "adoption
  // is rising") -- real report prose uses both shapes interchangeably, and
  // a scanner that only recognizes one silently misses half of them.
  /\b(?:demand|adoption)\s+(?:is|are|was|were|remains?|continues? to)\s+(?:strong|robust|growing|rising|surging|accelerating)\b/i,
  /\bunderserved\b/i,
  /\bwhitespace\b/i,
  /\bhigh[\s-]growth\b/i,
  /\bstructural (?:demand|tailwind)\b/i,
  /\bclear (?:demand|need|market pull)\b/i,
];

export const demandNegativePatterns: RegExp[] = [
  /\b(?:declining|shrinking|contracting|stagnant|flat|saturated)\s+(?:market|demand)\b/i,
  /\b(?:demand|market)\s+(?:is|are|was|were|remains?|continues? to)\s+(?:declining|shrinking|contracting|stagnating|flat|saturating|saturated)\b/i,
  /\bno clear demand\b/i,
  /\bweak (?:demand|adoption)\b/i,
  /\blimited (?:demand|appetite)\b/i,
];

// --- Competitive intensity signal vocabulary ---------------------------

export const competitionSeverePatterns: RegExp[] = [
  /\bdominant (?:player|incumbent|position)\b/i,
  /\bmarket leader\w*\s+(?:controls?|holds?|commands?)\b/i,
  /\bhigh switching costs?\b/i,
  /\bnetwork effects?\b/i,
  /\bwinner[\s-]take[\s-]all\b/i,
  /\bentrenched\s+(?:incumbents?|competitors?|players?)\b/i,
  /\bconsolidated\s+market\b/i,
  /\bintense(?:ly)? competitive\b/i,
];

export const competitionMildPatterns: RegExp[] = [
  /\bfragmented\s+(?:market|competitive landscape|industry)\b/i,
  // Subject-verb order ("the market is fragmented") in addition to the
  // adjective-noun order above -- report prose uses both interchangeably.
  /\b(?:market|competitive landscape|industry)\s+(?:is|are|remains?|looks?)\s+fragmented\b/i,
  /\bno clear (?:leader|dominant player)\b/i,
  /\bunderserved segment\b/i,
  /\blow switching costs?\b/i,
  /\bopen (?:competitive )?field\b/i,
];

// --- Differentiation / whitespace signal vocabulary --------------------

export const differentiationPositivePatterns: RegExp[] = [
  // Allows a single comma-separated intervening adjective ("clear,
  // defensible whitespace") in addition to the direct-adjacency form
  // ("clear whitespace") -- real report prose routinely stacks a second
  // adjective before the noun.
  /\b(?:clear|genuine|real|meaningful)(?:,\s*\w+)?\s+(?:differentiation|whitespace|gap)\b/i,
  /\bunmet\s+need\b/i,
  /\bfirst[\s-]mover\s+advantage\b/i,
  /\bdefensible\s+(?:moat|position|advantage)\b/i,
];

export const differentiationNegativePatterns: RegExp[] = [
  /\bcommodit(?:y|ized|ization)\b/i,
  /\bmetoo\b|\bme[\s-]too\b/i,
  /\bno\s+(?:clear\s+)?differentiation\b/i,
  /\beasily\s+replicat\w+\b/i,
];

// --- Execution feasibility signal vocabulary ----------------------------

export const executionEasierPatterns: RegExp[] = [
  /\blow\s+capital\s+requirement\w*\b/i,
  /\bexisting\s+(?:channel|distribution)\b/i,
  /\bshort\s+sales\s+cycle\w*\b/i,
  // Subject-verb order ("sales cycles are short") in addition to the
  // adjective-noun order above.
  /\bsales\s+cycles?\s+(?:is|are|remains?)\s+short\b/i,
  /\bquick(?:ly)?\s+to\s+integrate\b/i,
  /\bintegration\s+(?:is|are|remains?)\s+(?:straightforward|simple|easy)\b/i,
];

export const executionHarderPatterns: RegExp[] = [
  /\blong\s+sales\s+cycle\w*\b/i,
  /\bhigh\s+capital\s+requirement\w*\b/i,
  /\bcomplex\s+integration\w*\b/i,
  /\blengthy\s+(?:procurement|implementation)\b/i,
  /\bhigh\s+customer\s+acquisition\s+cost\b/i,
];

// --- Regulatory/legal exposure vocabulary ---------------------------
//
// One-directional (only ever adds a signal when explicitly found;
// silence is neutral, not scored as a gap, since most markets
// genuinely have no such exposure) -- but NOT single-tier. A "the
// business cannot legally operate" prohibition and a "may need
// standard licensing" throwaway line are both technically "regulatory
// language," yet only one of them should be able to move a decision at
// all, and only the most severe should be able to do so independent of
// how good the rest of the market looks. Four tiers, most severe
// first:
//
// 1. regulatoryProhibitionPatterns -- an explicit statement the
//    business cannot legally/practically operate at all. The ONLY tier
//    dimensions.ts marks as a hard blocker (isHardBlocker: true),
//    because this is the one case where real-world logic says the
//    finding should not be diluted by an otherwise-strong market
//    (REQUIREMENT 8).
// 2. regulatoryMaterialRiskPatterns -- a specific, named, real
//    regulatory/legal risk (required approval, active litigation,
//    heavy regulation) that is material enough to weigh against the
//    opportunity, but is not evidence the business cannot operate.
//    Contributes to the ordinary weighted market-quality blend like
//    any other negative dimension -- it can help justify NO_GO when
//    corroborated by other real negatives, but never forces it alone
//    (REQUIREMENT 7).
// 3. regulatoryUncertaintyPatterns -- an explicit statement that
//    regulatory status is UNRESOLVED, not a finding of risk. Maps to
//    "unknown", not a negative state (REQUIREMENT 4/5): this is a gap
//    to close, not evidence against the opportunity.
// 4. regulatoryManageableBurdenPatterns -- generic, routine compliance
//    language ("standard licensing requirements may apply") that
//    nearly every ordinary business carries. Maps to "neutral" --
//    named and acknowledged in the rationale for transparency, but
//    never treated as a negative finding (REQUIREMENT 6).

export const regulatoryProhibitionPatterns: RegExp[] = [
  /\b(?:is|are|remains?)\s+(?:currently\s+)?(?:illegal|prohibited|banned)\b/i,
  /\b(?:effectively|de facto)\s+banned\b/i,
  /\bcannot\s+legally\s+operate\b/i,
  /\bnot\s+(?:currently\s+)?(?:permitted|authorized)\s+to\s+operate\b/i,
  /\bno\s+legal\s+path\s+to\s+market\b/i,
  /\blicense\s+(?:is\s+)?not\s+(?:currently\s+)?(?:available|obtainable|being\s+issued)\b/i,
  /\bregulatory\s+prohibition\b/i,
];

export const regulatoryMaterialRiskPatterns: RegExp[] = [
  /\brequires?\s+(?:fda|regulatory|government)\s+approval\b/i,
  /\bheavily\s+regulated\b/i,
  /\bcompliance\s+risk\b/i,
  /\blegal\s+exposure\b/i,
  /\bpending\s+litigation\b/i,
];

export const regulatoryUncertaintyPatterns: RegExp[] = [
  /\bregulatory\s+uncertainty\b/i,
  /\bregulatory\s+status\s+(?:is\s+)?unclear\b/i,
  /\bnot\s+yet\s+determined\s+whether\b/i,
  /\brequires?\s+(?:further\s+)?legal\s+review\s+to\s+determine\b/i,
];

// Deliberately NOT the same list as regulatoryMaterialRiskPatterns's
// "licensing requirement" wording used to be -- a bare mention of
// licensing is what nearly every ordinary business has, and treating
// it as a real risk was exactly the false-severity bug this tiering
// fixes (REQUIREMENT 6's literal example: "regulatory requirements may
// apply" must not read as a blocker).
export const regulatoryManageableBurdenPatterns: RegExp[] = [
  /\bstandard\s+(?:business\s+)?licens\w*\s+requirement\w*\b/i,
  /\brequires?\s+(?:standard|routine|typical)\s+(?:business\s+)?licens\w*\b/i,
  /\blicensing\s+requirement\w*\b/i,
  /\bregulatory\s+requirements?\s+may\s+apply\b/i,
];

// --- Economic viability vocabulary -------------------------------------

export const economicPositivePatterns: RegExp[] = [
  /\bhealthy\s+(?:margins?|unit economics)\b/i,
  /\battractive\s+(?:pricing|margins?)\b/i,
  /\bstrong\s+willingness\s+to\s+pay\b/i,
];

export const economicNegativePatterns: RegExp[] = [
  /\bthin\s+margins?\b/i,
  /\bprice[\s-]sensitiv\w+\b/i,
  /\bunsustainable\s+unit economics\b/i,
  /\brace\s+to\s+the\s+bottom\b/i,
];
