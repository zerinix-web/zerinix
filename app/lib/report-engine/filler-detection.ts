// Shared, report-type-agnostic filler detection/removal. Targets generic
// AI hedge phrasing, obvious disclaimers, and repeated sentences -- pure
// writing-quality/output-structure concerns, not report-specific business
// content, so safe to share across all three report types.

// Each pattern matches a SENTENCE-OPENING hedge/filler construction. These
// are checked against the start of a sentence (after trimming bullet/markdown
// markers) so they don't fire on a legitimate mid-sentence use of the same
// words (e.g. "growth depends on channel mix" should survive; "It depends on
// many factors." as a standalone throat-clearing sentence should not).
const fillerSentencePatterns: RegExp[] = [
  /^according to\b/i,
  /^it depends\b/i,
  /^there are many\b/i,
  /^as an ai\b/i,
  /^it is important to (?:note|understand|recognize)\b/i,
  /^in conclusion\b/i,
  /^in today'?s (?:market|business|world|economy)\b/i,
  /^by leveraging\b/i,
  /^this strategy can help\b/i,
  /^businesses should\b/i,
  /^it'?s worth (?:noting|mentioning)\b/i,
  /^needless to say\b/i,
  /^at the end of the day\b/i,
  /^in order to\b/i,
  /^generally speaking\b/i,
  /^as (?:previously|mentioned above|noted above)\b/i,
  /^building on the previous section\b/i,
  /^as we (?:can see|have seen|discussed)\b/i,
];

// The pipeline appends a per-section "Evidence & Confidence" block
// (report-evidence-confidence.ts's formatEvidenceConfidenceBlock) after
// EVERY major section. It is a fixed, cross-language template of short
// field labels (Evidence Quality, Confidence Score, Primary Evidence
// Type(s), Missing Evidence, a validation recommendation) -- when two
// sections happen to land on the same evidence quality/confidence value,
// their blocks are byte-for-byte identical, which is expected (the same
// way two table rows sharing a value aren't "duplicate prose"), not
// generic filler. Treating this narrative-quality check as blind to
// where a line came from would otherwise flag most real, well-formed
// multi-section reports as filler-heavy for the sole reason that they
// consistently label their own evidence quality.
const evidenceConfidenceBlockHeadingPattern =
  /^(?:evidence & confidence|kanıt ve güven|evidenz & konfidenz|preuves et confiance|evidencia y confianza)$/i;

// Marks every line that belongs to one of these blocks (the heading
// itself through the following blank-line boundary, matching how
// formatEvidenceConfidenceBlock's own lines are always joined with "\n"
// and the block itself is appended after a blank line separator).
function findStructuralBlockLines(content: string) {
  const lines = (content || "").split("\n");
  const structural = new Set<number>();
  let inBlock = false;

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) {
      inBlock = false;
      return;
    }
    if (evidenceConfidenceBlockHeadingPattern.test(trimmed)) {
      inBlock = true;
    }
    if (inBlock) {
      structural.add(index);
    }
  });

  return structural;
}

function stripBulletMarker(sentence: string) {
  return sentence.replace(/^[-*•]\s*/, "").replace(/^\d+[.)]\s*/, "").trim();
}

function isFillerSentence(sentence: string) {
  const normalized = stripBulletMarker(sentence);
  return fillerSentencePatterns.some((pattern) => pattern.test(normalized));
}

function normalizeForDuplicateCheck(sentence: string) {
  return stripBulletMarker(sentence).toLowerCase().replace(/\s+/g, " ").trim();
}

// Removes known filler-phrase sentences and any sentence that exactly
// repeats an earlier one in the same content (word-for-word, case/whitespace
// -insensitive) -- but never removes short lines (labels, headings, table
// rows), since those legitimately repeat structural words without being
// filler.
export function stripFillerAndDuplicateSentences(content: string) {
  const lines = (content || "").split("\n");
  const structuralBlockLines = findStructuralBlockLines(content);
  const seenSentences = new Set<string>();
  const keptLines: string[] = [];

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) {
      keptLines.push(line);
      return;
    }

    const normalized = normalizeForDuplicateCheck(trimmed);
    const isShortStructuralLine = normalized.length < 20 || structuralBlockLines.has(index);

    if (!isShortStructuralLine) {
      if (isFillerSentence(trimmed)) {
        return;
      }
      if (seenSentences.has(normalized)) {
        return;
      }
      seenSentences.add(normalized);
    }

    keptLines.push(line);
  });

  return keptLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// Fraction (0-1) of substantive sentences that are filler and/or exact
// duplicates of an earlier sentence -- used by the executive quality gate's
// "no more than 15% generic filler" check. Computed independently of
// stripFillerAndDuplicateSentences so the gate can measure filler even on
// content that hasn't been through that cleanup step yet.
export function computeFillerRatio(content: string) {
  const structuralBlockLines = findStructuralBlockLines(content);
  const sentences = (content || "")
    .split("\n")
    .flatMap((line, index) =>
      structuralBlockLines.has(index)
        ? []
        : line.split(/(?<=[.!?])\s+/).map((sentence) => sentence.trim())
    )
    .filter((sentence) => sentence && normalizeForDuplicateCheck(sentence).length >= 20);

  if (sentences.length === 0) {
    return 0;
  }

  const seen = new Set<string>();
  let fillerCount = 0;

  for (const sentence of sentences) {
    const normalized = normalizeForDuplicateCheck(sentence);
    if (isFillerSentence(sentence) || seen.has(normalized)) {
      fillerCount += 1;
    }
    seen.add(normalized);
  }

  return fillerCount / sentences.length;
}
