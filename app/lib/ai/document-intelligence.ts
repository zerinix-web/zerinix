import {
  normalizeSelectedAnalysisMode,
  type SelectedAnalysisMode,
} from "./expertise-profile.ts";

// First layer of ZERINIX document intelligence: attachment-aware document
// classification and safe routing. This inspects the uploaded attachment
// itself (filename, mime type, and any already-extracted text/OCR content)
// independently of the prompt, so a generic instruction like "bunun
// analizini yap" attached to a legal document cannot be misread as a
// business idea or a market-research request. Only legal_document has a
// concrete forced-routing rule for now; the other categories are labeled
// for future layers but do not change routing yet.
export const documentCategoryValues = [
  "legal_document",
  "business_document",
  "market_research_document",
  "financial_document",
  "real_estate_document",
  "construction_document",
  "contract_document",
  "unknown_document",
] as const;

export type DocumentCategory = (typeof documentCategoryValues)[number];

export type DocumentClassificationAsset = {
  name?: string;
  mimeType?: string;
  textContent?: string;
};

export type DocumentClassificationResult = {
  category: DocumentCategory;
  confidence: number;
  analysisType: string | null;
};

const MIN_CONFIDENT_DOCUMENT_CATEGORY_CONFIDENCE = 0.7;

type CategorySignal = {
  pattern: RegExp;
  analysisType: string;
};

// Patterns are matched against text already normalized by normalizeForMatch
// (Turkish-aware lowercasing, dotless-i folded to plain "i"), so every
// alternative here must be written in that normalized form: no dotted/
// dotless Turkish I variants, no uppercase.
const categorySignals: Record<
  Exclude<DocumentCategory, "unknown_document">,
  CategorySignal
> = {
  legal_document: {
    pattern:
      /\b(yargitay|hukuk dairesi|esas no|karar no|davaci|davali|mahkeme karari|temyiz|istinaf|bolge adliye mahkemesi|dava dosyasi|hukum|court of appeal|supreme court|plaintiff|defendant|docket no|case no|judgment|ruling|verdict|litigation)\b/g,
    analysisType: "legal_case_analysis",
  },
  contract_document: {
    pattern:
      /\b(hereinafter|sozlesme|taraflar arasinda|termination clause|governing law|indemnif|non-disclosure agreement|nda)\b/g,
    analysisType: "contract_review",
  },
  financial_document: {
    pattern:
      /\b(balance sheet|income statement|cash flow statement|bilanco|gelir tablosu|nakit akis tablosu|trial balance|mizan|audited financials)\b/g,
    analysisType: "financial_statement_analysis",
  },
  real_estate_document: {
    pattern:
      /\b(tapu|title deed|ada\/parsel|imar durumu|cadastral|land registry|property listing)\b/g,
    analysisType: "real_estate_document_review",
  },
  construction_document: {
    pattern:
      /\b(construction permit|yapi ruhsati|building permit|bill of quantities|hakedis|insaat sozlesmesi|structural drawing)\b/g,
    analysisType: "construction_document_review",
  },
  market_research_document: {
    pattern:
      /\b(market research report|industry report|market sizing|competitive landscape report|pazar arastirmasi raporu)\b/g,
    analysisType: "market_research_document_review",
  },
  business_document: {
    pattern:
      /\b(business plan|pitch deck|is plani|girisim sunumu|cap table|term sheet)\b/g,
    analysisType: "business_document_review",
  },
};

// Category-priority order used only to break ties on equal confidence.
// legal_document is checked first because it is the only category with a
// hard safety constraint (never Business Idea Validation or Market
// Intelligence) -- ties should resolve toward the safer classification.
const tieBreakOrder: Exclude<DocumentCategory, "unknown_document">[] = [
  "legal_document",
  "contract_document",
  "financial_document",
  "real_estate_document",
  "construction_document",
  "market_research_document",
  "business_document",
];

function normalizeForMatch(value: string) {
  return value
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .replace(/i̇/g, "i");
}

function combinedAssetText(
  assets: readonly DocumentClassificationAsset[]
) {
  return normalizeForMatch(
    assets
      .map(
        (asset) =>
          `${asset.name || ""} ${asset.mimeType || ""} ${(asset.textContent || "").slice(0, 8_000)}`
      )
      .join("\n")
  );
}

function confidenceFromMatches(matches: string[]) {
  const uniqueHits = new Set(matches).size;
  return Math.min(0.6 + uniqueHits * 0.15, 0.97);
}

export function classifyAttachmentDocument({
  assets = [],
}: {
  assets?: readonly DocumentClassificationAsset[];
}): DocumentClassificationResult {
  if (!assets.length) {
    return { category: "unknown_document", confidence: 0, analysisType: null };
  }

  const text = combinedAssetText(assets);
  let best: DocumentClassificationResult = {
    category: "unknown_document",
    confidence: 0,
    analysisType: null,
  };

  for (const category of tieBreakOrder) {
    const { pattern, analysisType } = categorySignals[category];
    const matches = [...text.matchAll(pattern)].map((match) => match[0]);

    if (matches.length === 0) continue;

    const confidence = confidenceFromMatches(matches);

    if (confidence > best.confidence) {
      best = { category, confidence, analysisType };
    }
  }

  if (best.confidence < MIN_CONFIDENT_DOCUMENT_CATEGORY_CONFIDENCE) {
    return { category: "unknown_document", confidence: best.confidence, analysisType: null };
  }

  return best;
}

export function isConfidentDocumentCategory(
  result: DocumentClassificationResult
) {
  return (
    result.category !== "unknown_document" &&
    result.confidence >= MIN_CONFIDENT_DOCUMENT_CATEGORY_CONFIDENCE
  );
}

export type DocumentAwareRoutingResult = {
  selectedMode: SelectedAnalysisMode;
  documentCategory: DocumentCategory;
  analysisType: string | null;
  overridden: boolean;
};

// Generic prompt text (e.g. "bunun analizini yap") must never override a
// confidently detected attachment category -- this is the only place that
// forces a mode change, and it only ever forces legal_document requests
// away from Business Idea Validation / Market Intelligence and into
// Strategic Advisory (chat). Every other category is labeled but does not
// change routing yet; that is intentionally out of scope for this layer.
export function applyDocumentAwareModeOverride({
  selectedMode,
  classification,
}: {
  selectedMode: unknown;
  classification: DocumentClassificationResult;
}): DocumentAwareRoutingResult {
  const normalizedMode = normalizeSelectedAnalysisMode(selectedMode);

  if (
    classification.category === "legal_document" &&
    isConfidentDocumentCategory(classification)
  ) {
    return {
      selectedMode: "chat",
      documentCategory: "legal_document",
      analysisType: "legal_case_analysis",
      overridden: normalizedMode !== "chat",
    };
  }

  return {
    selectedMode: normalizedMode,
    documentCategory: classification.category,
    analysisType: classification.analysisType,
    overridden: false,
  };
}
