// TASK #69A-37A -- ROOT CAUSE FIX. Confirmed live: a real Strategic
// Advisory response's own Recommended Actions/Final Recommendation text
// named many material numeric thresholds, budgets, and impact ranges --
// "CAC reduction >=20%", "LTV/CAC >=3", "CAC payback <=12 months",
// "$5-15k"/"$10-30k"/"$20-60k" spend ranges, "10-20%"/"10-30%"/"10-25%"
// improvement ranges, "NRR +3-8 percentage points", an "8-12 week
// sprint" -- with NO provenance attached to most of them. None of these
// were supplied by the user; they are the model's own planning
// assumptions, illustrative benchmarks, or cost/impact estimates, but
// the prose gave a reader no way to tell that apart from a verified fact
// about their own business.
//
// #69A-37A's own prompt-level fix (domain-analysis.ts,
// acquisition-analysis.ts) now instructs the model to attach one of
// Verified / Benchmark / Assumption / Estimated directly next to every
// such number going forward -- but a prompt instruction is not a
// guarantee, and this same generic domain-analysis/acquisition pipeline
// already needed a deterministic backstop once before for a related gap
// (#69A-37's correctConfidenceDecisionConflation). This module is that
// same style of backstop for numeric provenance: for every MATERIAL
// numeric claim (a dollar amount/range, a percentage/range, an
// LTV:CAC-style ratio threshold with an explicit comparison operator, or
// a week/month/day duration range or comparison) with NO provenance
// signal already present nearby, it appends the single safest possible
// label -- "(Estimate)" -- immediately after the number.
//
// It deliberately NEVER assigns "Benchmark" or "Verified" itself -- only
// the model can know whether a real external reference or a user's own
// statement backs a given number, and guessing either would fabricate a
// stronger evidentiary status than actually exists, exactly what this
// ticket forbids ("Do not label model-generated numbers as Benchmark
// unless actual benchmark evidence exists"). "Estimate" is the correct
// universal fallback: by definition, a number this function had to tag
// carried no recognizable provenance signal at all, so the most honest
// available label is "this is an approximation, not a verified figure."
//
// Never removes or alters existing text -- only appends. A claim that
// already carries ANY recognized provenance signal nearby (Verified,
// Benchmark, Assumption, Estimated, an [R#] registry reference, or an
// explicit reference to the user's own stated figure) is left completely
// untouched, byte-identical. This also makes the function naturally
// idempotent: the text it appends ("(Estimate)") itself contains the
// word "estimate", so re-running this on already-healed (or
// already-labeled) text changes nothing on a second pass -- the same
// property #69A-37's correctConfidenceDecisionConflation relies on, and
// the same reason no cache-version bump is needed: this healing pass
// runs fresh inside parseDomainAnalysisReport/parseAcquisitionAnalysisReport's
// own per-field loop on every read, cached or fresh, so a historical
// report with this gap is healed on its next read with no database
// rewrite.
//
// Known, deliberate limitation (documented rather than over-engineered):
// the ratio-threshold pattern below only recognizes an EXPLICIT
// comparison operator (>=, <=, >, <, =) directly against the ratio, e.g.
// "LTV/CAC >= 3" -- natural-language phrasing with no such symbol (e.g.
// "an LTV/CAC of 3 or higher") is not detected here. That phrasing is
// the prompt-level fix's responsibility (domain-analysis.ts/
// acquisition-analysis.ts now require an attached label at generation
// time); this backstop's narrower, symbol-anchored scope keeps its own
// false-positive rate low rather than attempting a general numeric-
// claim NLP classifier.

type NumericSpan = { start: number; end: number };

const materialNumericPatterns: RegExp[] = [
  // Dollar amounts / ranges, optional k/m suffix: $10-30k, $5-15k, $20-60k
  /\$\s?\d[\d,]*(?:\.\d+)?\s*[kKmM]?(?:\s*[-–—]\s*\$?\s?\d[\d,]*(?:\.\d+)?\s*[kKmM]?)?/g,
  // Bare percentage ranges where only the second number carries "%":
  // 10-20%, 10–30%
  /\b\d{1,3}(?:\.\d+)?\s*[-–—]\s*\d{1,3}(?:\.\d+)?\s*%/g,
  // A single percentage value with a comparison/sign prefix: >=20%,
  // ~20%, +5%. Checked alongside (not before) the range pattern above --
  // overlap resolution happens later, once, across every pattern.
  /(?:>=|<=|[≥≤><+±~])\s?\d{1,3}(?:\.\d+)?\s*%/g,
  // Ratio thresholds with an explicit comparison operator: LTV/CAC >= 3,
  // CAC:LTV <= 4, LTV/CAC >=3x -- see the module-level comment for why a
  // purely natural-language ratio ("an LTV/CAC of 3 or higher") is out
  // of scope. TASK #69A-37B -- FIX: a real response wrote "LTV/CAC
  // >=3x" (an "x" multiplier suffix on the threshold number); the
  // number-only pattern used before this fix stopped matching right
  // after the digit, so the appended label landed BEFORE the "x"
  // ("LTV/CAC >=3 (Estimate)x") instead of after it -- the trailing
  // `x?` below folds the suffix into the same matched span so the
  // label always lands after the whole threshold, never inside it.
  /\b[A-Z]{2,6}\s*[/:]\s*[A-Z]{2,6}[^.\n%]{0,20}?(?:>=|<=|[≥≤>=]{1,2})\s*\d+(?:\.\d+)?[xX]?/g,
  // Duration comparisons: <=12 months, >=6 weeks
  /(?:>=|<=|[≥≤><])\s?\d{1,3}\s*(?:months?|weeks?|days?)/g,
  // Duration ranges: 8-12 week sprint, 30-60 days
  /\b\d{1,2}\s*[-–—]\s*\d{1,2}\s*(?:weeks?|months?|days?)\b/g,
  // Percentage-point deltas: +3-8 percentage points, 3-8 pts
  /[+±]?\d{1,3}(?:\.\d+)?\s*[-–—]\s*\d{1,3}(?:\.\d+)?\s*(?:percentage\s*points?|pts?)\b/gi,
];

// Any of these, found near a candidate number, means it already carries
// real provenance (or is a user-referenced figure) -- never re-tagged.
const provenanceSignalPattern =
  /\b(user[\s-]?provided|user[\s-]?stated|the user'?s?\s+own|your\s+own|as (?:you|the user)\s+(?:stated|mentioned|reported|provided|shared)|directly stated|verified evidence|verified|benchmark|planning assumption|assumption|estimate|estimated|illustrative|approximate|projected|derived from|based on (?:your|the user'?s?)|industry (?:reference|report|benchmark)|comparable[\s-]?(?:transaction|company)|market reference)\b/i;
const registryReferencePattern = /\[R\d+\]/;

// The report's own Decision/Confidence banner (#69A-37) states a bare
// percentage right after "Confidence:" -- that number is a certainty
// level, not a material numeric recommendation, and must never be
// tagged here even though it matches the percentage pattern above.
const confidenceLabelTailPattern = /confidence\s*(?:level)?\s*[:\-–—]?\s*$/i;

const APPENDED_LABEL = " (Estimate)";

function collectCandidateSpans(text: string): NumericSpan[] {
  const candidates: NumericSpan[] = [];

  for (const pattern of materialNumericPatterns) {
    for (const match of text.matchAll(pattern)) {
      if (match.index === undefined || match[0].length === 0) continue;
      candidates.push({ start: match.index, end: match.index + match[0].length });
    }
  }

  // Longest-match-wins de-overlap: sort by start ascending, then by
  // length descending, then greedily keep only non-overlapping spans.
  candidates.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));

  const kept: NumericSpan[] = [];
  for (const span of candidates) {
    const last = kept[kept.length - 1];
    if (last && span.start < last.end) continue;
    kept.push(span);
  }

  return kept;
}

// Appends the safest possible provenance label ("(Estimate)") directly
// after every material numeric claim that has no recognizable
// provenance signal nearby. Never fabricates a stronger label, never
// removes or rewrites existing content, and returns text unchanged
// (byte-identical) when nothing qualifies.
export function attachNumericProvenanceLabels(text: string): string {
  if (!text) {
    return text;
  }

  const spans = collectCandidateSpans(text);
  if (spans.length === 0) {
    return text;
  }

  let result = "";
  let cursor = 0;

  for (const span of spans) {
    const before = text.slice(Math.max(0, span.start - 140), span.start);
    // TASK #69A-37C -- ROOT CAUSE FIX. Confirmed live: in a dense
    // paragraph of back-to-back claims ("...CAC reduction 10-25%. Run
    // +10-20% spend experiments to validate. Your own CAC improved by
    // +35%..."), a naive fixed-width 40-char lookahead for "+10-20%"
    // reached PAST its own sentence's end and into the START of the
    // NEXT, unrelated sentence ("Your own CAC..."), which legitimately
    // signals THAT sentence's own number is user-provided -- but the
    // lookahead had no way to tell the two apart, so it wrongly treated
    // "your own" as covering "+10-20%" too and skipped tagging a number
    // that genuinely needed it. Bounding the lookahead to the current
    // sentence (stopping at the first ./!/?/newline) keeps a genuine
    // trailing label like "$10-30k (Estimate)." in scope while never
    // again reaching into unrelated, later content.
    const afterLookahead = text.slice(span.end, span.end + 40);
    const sentenceBoundaryIndex = afterLookahead.search(/[.!?\n]/);
    const after =
      sentenceBoundaryIndex === -1
        ? afterLookahead
        : afterLookahead.slice(0, sentenceBoundaryIndex + 1);

    if (confidenceLabelTailPattern.test(before)) {
      continue;
    }
    if (
      provenanceSignalPattern.test(before) ||
      provenanceSignalPattern.test(after) ||
      registryReferencePattern.test(before) ||
      registryReferencePattern.test(after)
    ) {
      continue;
    }

    result += text.slice(cursor, span.end) + APPENDED_LABEL;
    cursor = span.end;
  }

  result += text.slice(cursor);
  return result;
}
