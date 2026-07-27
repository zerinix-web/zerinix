function normalizeParagraphFingerprint(value) {
  return value
    .normalize("NFC")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .replace(/[“”]/g, '"')
    .trim()
    .toLocaleLowerCase();
}

function isNarrativeParagraph(value) {
  const trimmed = value.trim();

  return (
    trimmed.length >= 90 &&
    !/^[-*•|]/.test(trimmed) &&
    !/^(?:#{1,6}\s*)?(?:strengths|weaknesses|opportunities|threats|güçlü yönler|zayıf yönler|fırsatlar|tehditler)\s*:/i.test(
      trimmed
    )
  );
}

export function dedupeReportParagraphsAcrossSections(report) {
  const seenParagraphs = new Set();

  return Object.fromEntries(
    Object.entries(report).map(([field, content]) => {
      if (typeof content !== "string" || !content.trim()) {
        return [field, content];
      }

      const blocks = content
        .split(/\n{2,}/)
        .map((block) => block.trim())
        .filter(Boolean);
      const uniqueBlocks = blocks.filter((block) => {
        if (!isNarrativeParagraph(block)) {
          return true;
        }

        const fingerprint = normalizeParagraphFingerprint(block);

        if (seenParagraphs.has(fingerprint)) {
          return false;
        }

        seenParagraphs.add(fingerprint);
        return true;
      });

      return [
        field,
        (uniqueBlocks.length > 0 ? uniqueBlocks : blocks)
          .join("\n\n")
          .replace(/\n{3,}/g, "\n\n")
          .trim(),
      ];
    })
  );
}

export function auditExecutiveReportContent(report, requiredFields, businessTerms = []) {
  const entries = Object.entries(report).filter(
    ([, content]) => typeof content === "string" && content.trim()
  );
  const seenParagraphs = new Map();
  const duplicateParagraphs = [];

  for (const [field, content] of entries) {
    for (const paragraph of content.split(/\n{2,}/).map((item) => item.trim())) {
      if (!isNarrativeParagraph(paragraph)) {
        continue;
      }

      const fingerprint = normalizeParagraphFingerprint(paragraph);
      const previousField = seenParagraphs.get(fingerprint);

      if (previousField && previousField !== field) {
        duplicateParagraphs.push(`${previousField}/${field}`);
      } else {
        seenParagraphs.set(fingerprint, field);
      }
    }
  }

  const missingFields = requiredFields.filter(
    (field) => typeof report[field] !== "string" || !report[field].trim()
  );
  const recommendationText = String(
    report.executiveRecommendation || report.executiveSummary || ""
  ).toLocaleLowerCase();
  const recommendationMatchesBusiness = businessTerms.some((term) =>
    recommendationText.includes(term.toLocaleLowerCase())
  );

  return {
    missingFields,
    duplicateParagraphs: [...new Set(duplicateParagraphs)],
    recommendationMatchesBusiness,
  };
}
