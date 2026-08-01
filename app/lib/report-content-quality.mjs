function normalizeParagraphFingerprint(value) {
  return value
    .normalize("NFC")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .replace(/[“”]/g, '"')
    .replace(
      /^(?:#{1,6}\s*)?(?:executive recommendation|recommendation|next actions?|immediate actions?|yönetici tavsiyesi|tavsiye|sonraki adımlar?|acil adımlar?)\s*[:\-–—]\s*/i,
      ""
    )
    .trim()
    .toLocaleLowerCase();
}

function isNarrativeParagraph(value) {
  const trimmed = value.trim();
  const isDecisionBlock =
    /^(?:#{1,6}\s*)?(?:executive recommendation|recommendation|next actions?|immediate actions?|yönetici tavsiyesi|tavsiye|sonraki adımlar?|acil adımlar?)\s*[:\-–—]/i.test(
      trimmed
    );

  return (
    (trimmed.length >= 90 || (isDecisionBlock && trimmed.length >= 50)) &&
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
      let removedDuplicate = false;
      const uniqueBlocks = blocks.filter((block) => {
        if (!isNarrativeParagraph(block)) {
          return true;
        }

        const fingerprint = normalizeParagraphFingerprint(block);

        if (seenParagraphs.has(fingerprint)) {
          removedDuplicate = true;
          return false;
        }

        seenParagraphs.add(fingerprint);
        return true;
      });

      return [
        field,
        (uniqueBlocks.length > 0
          ? uniqueBlocks
          : removedDuplicate
            ? [
                /[çğıöşüÇĞİÖŞÜ]|\b(?:tavsiye|yatırım|karar|özet)\b/i.test(content)
                  ? "Birleştirilmiş değerlendirme Yönetici Özeti bölümünde sunulmuştur."
                  : "See the Executive Summary for the consolidated assessment.",
              ]
            : blocks)
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
