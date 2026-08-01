import type { AnalysisAsset } from "@/app/lib/ai/analysis-assets";
import type { ExtractedFact } from "./contracts";
import { extractLegalResearchContext } from "./legal-research-context.mjs";

const fieldPatterns: Array<{
  field: string;
  pattern: RegExp;
}> = [
  { field: "province", pattern: /\b(?:province|il)\s*[:\-]\s*([^\n,;]+)/i },
  { field: "district", pattern: /\b(?:district|ilçe)\s*[:\-]\s*([^\n,;]+)/i },
  { field: "parcel", pattern: /\b(?:parcel|parsel)\s*(?:no|numarası)?\s*[:\-]?\s*([a-z0-9/-]+)/i },
  { field: "block", pattern: /\b(?:block|ada)\s*(?:no|numarası)?\s*[:\-]?\s*([a-z0-9/-]+)/i },
  { field: "company", pattern: /\b(?:company|şirket)\s*[:\-]\s*([^\n,;]+)/i },
  { field: "tax_id", pattern: /\b(?:tax id|tax number|vergi no|vergi numarası)\s*[:\-]?\s*([a-z0-9/-]+)/i },
  { field: "address", pattern: /\b(?:address|adres)\s*[:\-]\s*([^\n]+)/i },
  { field: "coordinates", pattern: /\b(-?\d{1,2}\.\d{3,})\s*[,/]\s*(-?\d{1,3}\.\d{3,})\b/ },
  { field: "currency", pattern: /\b(USD|EUR|GBP|TRY|TL|₺|\$|€|£)\b/i },
  { field: "date", pattern: /\b(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})\b/ },
];

function fact(
  field: string,
  value: string,
  source: string,
  confidence: number
): ExtractedFact {
  return {
    field,
    value,
    confidence,
    source,
    category: "Verified Asset",
    verified: true,
    estimated: false,
    missing: false,
  };
}

export function extractStructuredAssetFacts(
  prompt: string,
  assets: readonly AnalysisAsset[]
) {
  const facts: ExtractedFact[] = [];
  const legalContext = extractLegalResearchContext(prompt);
  const sources = [
    { name: "User prompt", text: prompt, category: "User" },
    ...assets.map((asset) => ({
      name: asset.name,
      text: asset.textContent || "",
      category: "Asset",
    })),
  ];

  for (const source of sources) {
    if (!source.text.trim()) continue;

    for (const { field, pattern } of fieldPatterns) {
      const match = source.text.match(pattern);
      const value = match?.slice(1).filter(Boolean).join(", ").trim();

      if (!value || facts.some((item) => item.field === field && item.value === value)) {
        continue;
      }

      facts.push(
        source.category === "Asset"
          ? fact(field, value, source.name, 90)
          : {
              ...fact(field, value, source.name, 75),
              category: "AI Inference",
              verified: false,
            }
      );
    }
  }

  assets.forEach((asset) => {
    facts.push({
      field: "uploaded_asset",
      value: `${asset.name} (${asset.type})`,
      confidence: 100,
      source: asset.name,
      category: "Verified Asset",
      verified: true,
      estimated: false,
      missing: false,
    });
  });

  if (legalContext.issues.length > 0) {
    const promptFacts = [
      legalContext.country && ["jurisdiction_country", legalContext.country],
      legalContext.region && ["jurisdiction_region", legalContext.region],
      legalContext.jurisdiction && ["governing_law", legalContext.jurisdiction],
      legalContext.legalDomain && ["legal_domain", legalContext.legalDomain],
      legalContext.requestedDecision && ["requested_decision", legalContext.requestedDecision],
      legalContext.urgency !== "Not stated" && ["urgency", legalContext.urgency],
      ...legalContext.userFacts.map((item) => [item.field, item.value]),
    ].filter((item): item is string[] => Boolean(item));

    promptFacts.forEach(([field, value]) => {
      if (!facts.some((item) => item.field === field && item.value === value)) {
        facts.push({
          field,
          value,
          confidence: 100,
          source: "User prompt",
          category: "AI Inference",
          verified: false,
          estimated: false,
          missing: false,
        });
      }
    });
  }

  return facts;
}
