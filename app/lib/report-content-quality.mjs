const evidenceFieldPattern = /(?:^|_)(?:sources?|citations?|references?|evidence)(?:$|_)/i;
const nonNarrativeBlockPattern = /^(?:```|\|)/;
const turkishTextPattern = /[çğıöşüÇĞİÖŞÜ]|\b(?:yatırım|karar|özet|pazar|risk)\b/i;

const stopWords = new Set([
  "a", "an", "and", "are", "as", "at", "be", "because", "been", "by",
  "can", "for", "from", "has", "have", "in", "into", "is", "it", "its",
  "of", "on", "or", "that", "the", "their", "this", "to", "was", "were",
  "will", "with", "bir", "bu", "da", "de", "ile", "icin", "için", "ve",
  "veya", "olan", "olarak", "gibi", "daha", "hem", "ise", "mi", "mı",
]);
const numberWordPattern = /\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|sıfır|bir|iki|üç|dört|beş|altı|yedi|sekiz|dokuz|on|yirmi|otuz|kırk|elli|altmış|yetmiş|seksen|doksan|yüz|bin|milyon|milyar)\b/giu;

function normalizeParagraphFingerprint(value) {
  return value
    .normalize("NFC")
    .replace(/\*\*/g, "")
    .replace(/^(?:#{1,6}\s*)?[^\n:]{2,60}:\s*/i, "")
    .replace(/\s+/g, " ")
    .replace(/[“”]/g, '"')
    .replace(
      /^(?:#{1,6}\s*)?(?:executive recommendation|recommendation|next actions?|immediate actions?|yönetici tavsiyesi|tavsiye|sonraki adımlar?|acil adımlar?)\s*[:\-–—]\s*/i,
      ""
    )
    .trim()
    .toLocaleLowerCase();
}

function normalizeInsightToken(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/(?:ing|edly|edly|ed|es|s)$/i, "")
    .replace(/(?:ları|leri|lar|ler|dan|den|dir|dır|dur|dür)$/i, "");
}

function createInsightSignature(value) {
  const fingerprint = normalizeParagraphFingerprint(value);
  const semanticText = fingerprint
    .replace(/\[(?:r\d+|asset:[^\]]+|user|method:[^\]]+)\]/gi, "")
    .replace(/https?:\/\/[^\s)\]]+/gi, "")
    .trim();
  const tokens = new Set(
    (semanticText.match(/[\p{L}\p{N}]+/gu) || [])
      .map(normalizeInsightToken)
      .filter((token) => token.length >= 3 && !stopWords.has(token))
  );
  const numbers = new Set(
    [
      ...(semanticText.match(/(?:[$€£₺]\s*)?\d[\d.,]*(?:\s*%|\s*[kmb])?/gi) || []),
      ...(semanticText.match(numberWordPattern) || []),
    ]
      .map((number) => number.replace(/\s+/g, "").toLocaleLowerCase())
  );

  return { fingerprint, tokens, numbers };
}

function isNarrativeParagraph(value) {
  const trimmed = value.trim();
  const narrativeText = trimmed.replace(/^(?:[-*•]|\d+[.)])\s+/, "");
  const isListItem = narrativeText !== trimmed;
  const isDecisionBlock =
    /^(?:#{1,6}\s*)?(?:executive recommendation|recommendation|next actions?|immediate actions?|yönetici tavsiyesi|tavsiye|sonraki adımlar?|acil adımlar?)\s*[:\-–—]/i.test(
      trimmed
    );

  return (
    (narrativeText.length >= (isListItem ? 70 : 90) ||
      (isDecisionBlock && narrativeText.length >= 50)) &&
    !nonNarrativeBlockPattern.test(trimmed) &&
    !/^(?:#{1,6}\s*)?(?:strengths|weaknesses|opportunities|threats|güçlü yönler|zayıf yönler|fırsatlar|tehditler)\s*:/i.test(
      trimmed
    )
  );
}

function setsEqual(left, right) {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function describesSameInsight(current, previous) {
  if (current.fingerprint === previous.fingerprint) return true;
  if (current.tokens.size < 7 || previous.tokens.size < 7) return false;
  if (!setsEqual(current.numbers, previous.numbers)) return false;

  let shared = 0;
  for (const token of current.tokens) {
    if (previous.tokens.has(token)) shared += 1;
  }

  const shorter = Math.min(current.tokens.size, previous.tokens.size);
  const longer = Math.max(current.tokens.size, previous.tokens.size);
  const containment = shared / shorter;
  const jaccard = shared / (current.tokens.size + previous.tokens.size - shared);
  const novelTerms = longer - shared;

  // High containment plus very little novel vocabulary identifies a restatement
  // while protecting paragraphs that add material section-specific analysis.
  return containment >= 0.82 && jaccard >= 0.68 && novelTerms <= 4;
}

function extractEvidenceReferences(value) {
  return [
    ...(value.match(/\[(?:R\d+|Asset:[^\]]+|User|Method:[^\]]+)\]/gi) || []),
    ...(value.match(/https?:\/\/[^\s)\]]+/gi) || []),
  ];
}

function titleFromField(field) {
  return field
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toLocaleUpperCase());
}

function resolveLanguage(options, content) {
  if (typeof options.language === "string") return options.language;
  return turkishTextPattern.test(content) ? "Turkish" : "English";
}

function buildReference(ownerLabel, language, references, wholeSection) {
  const evidenceSuffix = references.length > 0
    ? ` ${[...new Set(references)].join(" ")}`
    : "";

  if (language === "Turkish") {
    if (
      wholeSection &&
      (ownerLabel === "Yönetici Özeti" || ownerLabel === "Executive Summary")
    ) {
      return `Birleştirilmiş değerlendirme Yönetici Özeti bölümünde sunulmuştur.${evidenceSuffix}`;
    }
    return `Yerleşik dayanak için “${ownerLabel}” bölümüne bakın.${evidenceSuffix}`;
  }

  if (wholeSection && ownerLabel === "Executive Summary") {
    return `See the Executive Summary for the consolidated assessment.${evidenceSuffix}`;
  }

  const localizedPrefix = {
    German: "Zur bereits dargelegten Grundlage siehe",
    French: "Pour le fondement déjà établi, voir",
    Spanish: "Para el fundamento ya establecido, consulte",
  }[language];

  return localizedPrefix
    ? `${localizedPrefix} « ${ownerLabel} ».${evidenceSuffix}`
    : `See “${ownerLabel}” for the established premise.${evidenceSuffix}`;
}

/**
 * Removes exact and conservative near-duplicate insights across report fields.
 * The first section remains the owner; later sections receive one short
 * cross-reference and retain every section-specific paragraph and citation.
 */
export function dedupeReportParagraphsAcrossSections(report, options = {}) {
  const seenInsights = [];
  const excludedFields = new Set(options.excludedFields || []);
  const sectionLabels = options.sectionLabels || {};

  return Object.fromEntries(
    Object.entries(report).map(([field, content]) => {
      if (
        typeof content !== "string" ||
        !content.trim() ||
        evidenceFieldPattern.test(field) ||
        excludedFields.has(field)
      ) {
        return [field, content];
      }

      const blocks = content
        .split(/\n{2,}/)
        .map((block) => block.trim())
        .filter(Boolean);
      const uniqueBlocks = [];
      const duplicateOwners = new Map();

      for (const block of blocks) {
        const units = block.includes("\n") ? block.split("\n") : [block];
        const retainedUnits = [];

        for (const unit of units) {
          if (!isNarrativeParagraph(unit)) {
            retainedUnits.push(unit);
            continue;
          }

          const signature = createInsightSignature(unit);
          const owner = seenInsights.find((entry) =>
            describesSameInsight(signature, entry.signature)
          );

          if (!owner) {
            seenInsights.push({
              field,
              signature,
              references: new Set(extractEvidenceReferences(unit)),
            });
            retainedUnits.push(unit);
            continue;
          }

          const references = extractEvidenceReferences(unit).filter(
            (reference) => !owner.references?.has(reference)
          );
          const existing = duplicateOwners.get(owner.field) || [];
          duplicateOwners.set(owner.field, [...existing, ...references]);
          owner.references = new Set([
            ...owner.references,
            ...extractEvidenceReferences(unit),
          ]);
        }

        if (retainedUnits.some((unit) => unit.trim())) {
          uniqueBlocks.push(retainedUnits.join("\n").trim());
        }
      }

      if (duplicateOwners.size > 0) {
        const language = resolveLanguage(options, content);
        const wholeSection = uniqueBlocks.length === 0;
        for (const [ownerField, references] of duplicateOwners) {
          uniqueBlocks.push(
            buildReference(
              sectionLabels[ownerField] || titleFromField(ownerField),
              language,
              references,
              wholeSection
            )
          );
        }
      }

      return [
        field,
        uniqueBlocks
          .join("\n\n")
          .replace(/\n{3,}/g, "\n\n")
          .trim(),
      ];
    })
  );
}

export function estimateReportOutputTokens(report) {
  const content = Object.values(report)
    .filter((value) => typeof value === "string")
    .join("\n");
  return content ? Math.ceil(content.length / 4) : 0;
}

export function measureReportTokenReduction(before, after) {
  const tokensBefore = estimateReportOutputTokens(before);
  const tokensAfter = estimateReportOutputTokens(after);
  const tokensSaved = Math.max(0, tokensBefore - tokensAfter);

  return {
    estimatedOutputTokensBefore: tokensBefore,
    estimatedOutputTokensAfter: tokensAfter,
    estimatedOutputTokensSaved: tokensSaved,
    estimatedOutputTokenReductionPercent: tokensBefore
      ? Math.round((tokensSaved / tokensBefore) * 100)
      : 0,
  };
}

export function auditExecutiveReportContent(report, requiredFields, businessTerms = []) {
  const entries = Object.entries(report).filter(
    ([field, content]) =>
      !evidenceFieldPattern.test(field) &&
      typeof content === "string" &&
      content.trim()
  );
  const seenInsights = [];
  const duplicateParagraphs = [];

  for (const [field, content] of entries) {
    const insightUnits = content
      .split(/\n{2,}/)
      .flatMap((block) => (block.includes("\n") ? block.split("\n") : [block]))
      .map((item) => item.trim());

    for (const paragraph of insightUnits) {
      if (!isNarrativeParagraph(paragraph)) continue;

      const signature = createInsightSignature(paragraph);
      const previous = seenInsights.find((entry) =>
        describesSameInsight(signature, entry.signature)
      );

      if (previous && previous.field !== field) {
        duplicateParagraphs.push(`${previous.field}/${field}`);
      } else {
        seenInsights.push({ field, signature });
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
