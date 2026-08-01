import { z } from "zod";

export const expertiseDomainValues = [
  "legal",
  "real_estate",
  "finance",
  "retail",
  "business",
  "marketing",
  "accounting",
  "operations",
  "procurement",
  "healthcare",
  "logistics",
  "manufacturing",
  "technology",
  "general",
] as const;

export const selectedAnalysisModeValues = ["plan", "market", "chat"] as const;

const profileText = z.string().trim().min(1).max(240);
const profileList = z.array(z.string().trim().min(1).max(160)).max(12);

export const expertiseProfileSchema = z
  .object({
    domain: z.enum(expertiseDomainValues),
    subdomain: profileText,
    taskType: profileText,
    jurisdiction: z.string().trim().max(240),
    userGoal: profileText,
    professionalPerspective: profileText,
    requiredAnalyses: profileList,
    decisionCriteria: profileList,
    requiredEvidence: profileList,
    forbiddenTopics: profileList,
    criticalClarifications: z
      .array(z.string().trim().min(1).max(200))
      .max(4),
    confidence: z.number().min(0).max(1),
  })
  .strict();

export type ExpertiseProfile = z.infer<typeof expertiseProfileSchema>;
export type SelectedAnalysisMode =
  (typeof selectedAnalysisModeValues)[number];

type ExpertiseAsset = {
  name?: string;
  mimeType?: string;
  type?: string;
  textContent?: string;
};

type ExpertiseProfileInput = {
  prompt: string;
  assets?: readonly ExpertiseAsset[];
  selectedMode?: unknown;
  detectedDomain?: unknown;
};

const legalSignals =
  /\b(?:employment|employee|employer|terminated|termination|dismissal|overtime|wages?|salary|retaliat|exempt|misclassif|contract|agreement|legal|lawsuit|law|iş hukuku|işçi|işveren|işten çıkar|fazla mesai|ücret|maaş|misilleme|sözleşme|hukuk|dava)\b/i;
const employmentSignals =
  /\b(?:employment|employee|employer|terminated|termination|dismissal|overtime|wages?|salary|retaliat|exempt|misclassif|worked\s+for|iş hukuku|işçi|işveren|işten çıkar|fazla mesai|ücret|maaş|kıdem|ihbar)\b/i;
const wageRetaliationSignals =
  /\b(?:overtime|unpaid|wages?|salary|retaliat|reporting|whistleblow|exempt|misclassif|fazla mesai|ödenmeyen|ödenmemiş|ücret|maaş|misilleme|ihbar)\b/i;
const realEstateSignals =
  /\b(?:real[\s-]?estate|property|land|parcel|title deed|deed|cadastr|zoning|investment property|tapu|arsa|arazi|parsel|imar|kadastro|gayrimenkul|taşınmaz)\b/i;
const retailSignals =
  /\b(?:retail|store|branch|sku|product sales|inventory|stock turnover|sell-through|perakende|mağaza|şube|ürün satış|stok|devir hızı)\b/i;
const financeSignals =
  /\b(?:financial statement|balance sheet|income statement|cash flow|profitability|liquidity|leverage|expense structure|bilanço|gelir tablosu|nakit akış|kârlılık|karlılık|likidite|borçluluk|gider yapısı)\b/i;

const domainForbiddenTopics: Partial<
  Record<ExpertiseProfile["domain"], string[]>
> = {
  legal: [
    "CAC",
    "customer validation",
    "capital efficiency",
    "product-market fit",
    "startup execution score",
  ],
  real_estate: [
    "CAC",
    "SaaS metrics",
    "product-market fit",
    "startup execution score",
  ],
  finance: ["zoning", "legal claim strength", "startup GTM unless requested"],
  retail: ["zoning", "legal claim strength", "startup execution score"],
};

function unique(values: readonly string[], limit = 12) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(
    0,
    limit
  );
}

function assetContext(assets: readonly ExpertiseAsset[]) {
  return assets
    .map(
      (asset) =>
        `${asset.name || ""} ${asset.mimeType || asset.type || ""} ${(asset.textContent || "").slice(0, 4_000)}`
    )
    .join("\n");
}

function normalizedDetectedDomain(value: unknown) {
  if (typeof value !== "string") return "";

  const normalized = value.trim().toLowerCase();
  const aliases: Record<string, ExpertiseProfile["domain"]> = {
    startup: "business",
    realestate: "real_estate",
    logistics: "logistics",
    manufacturing: "manufacturing",
    healthcare: "healthcare",
    technology: "technology",
    marketing: "marketing",
    accounting: "accounting",
    retail: "retail",
    legal: "legal",
    finance: "finance",
    operations: "operations",
    procurement: "procurement",
    business: "business",
    general: "general",
  };

  return aliases[normalized] || "";
}

function detectDomain(
  combined: string,
  assets: readonly ExpertiseAsset[],
  detectedDomain: unknown
): ExpertiseProfile["domain"] {
  if (realEstateSignals.test(combined)) return "real_estate";
  if (employmentSignals.test(combined) || legalSignals.test(combined)) return "legal";
  if (retailSignals.test(combined)) return "retail";
  if (financeSignals.test(combined)) return "finance";

  const normalized = normalizedDetectedDomain(detectedDomain);
  if (normalized) return normalized as ExpertiseProfile["domain"];

  const hasSpreadsheet = assets.some(
    (asset) =>
      /(?:spreadsheet|excel|csv)/i.test(asset.mimeType || asset.type || "") ||
      /\.(?:xlsx?|csv|tsv)$/i.test(asset.name || "")
  );
  if (hasSpreadsheet) return "finance";

  return "general";
}

function detectJurisdiction(combined: string, domain: ExpertiseProfile["domain"]) {
  if (/\bCalifornia\b/i.test(combined)) return "California, United States";
  if (/\b(?:United States|USA|U\.S\.)\b/i.test(combined)) return "United States";
  if (/\b(?:Türkiye|Turkey)\b/i.test(combined)) return "Türkiye";
  if (/\b(?:Germany|Almanya)\b/i.test(combined)) return "Germany";
  if (/\b(?:United Kingdom|UK|England and Wales)\b/i.test(combined)) {
    return "United Kingdom";
  }
  if (/\bHatay\b/i.test(combined)) return "Hatay, Türkiye";

  return domain === "legal" || domain === "real_estate" ? "" : "Global";
}

export function normalizeSelectedAnalysisMode(
  value: unknown
): SelectedAnalysisMode {
  return selectedAnalysisModeValues.includes(value as SelectedAnalysisMode)
    ? (value as SelectedAnalysisMode)
    : "chat";
}

function modeGoal(mode: SelectedAnalysisMode, goal: string) {
  const modeLabel =
    mode === "plan"
      ? "Business Idea Validation"
      : mode === "market"
        ? "Market Intelligence"
        : "Strategic Advisory";

  return `${goal} within the user-selected ${modeLabel} mode`;
}

export function createExpertiseProfileFallback({
  prompt,
  assets = [],
  selectedMode,
  detectedDomain,
}: ExpertiseProfileInput): ExpertiseProfile {
  const combined = `${prompt}\n${assetContext(assets)}`;
  const mode = normalizeSelectedAnalysisMode(selectedMode);
  const domain = detectDomain(combined, assets, detectedDomain);
  const jurisdiction = detectJurisdiction(combined, domain);

  if (domain === "legal") {
    const employment = employmentSignals.test(combined);
    const wageAndRetaliation = wageRetaliationSignals.test(combined);
    return {
      domain,
      subdomain: employment ? "employment_law" : "legal_risk_assessment",
      taskType:
        employment && wageAndRetaliation
          ? "wage_and_retaliation_assessment"
          : employment
            ? "employment_claim_assessment"
            : "legal_issue_assessment",
      jurisdiction,
      userGoal: modeGoal(
        mode,
        "assess claims, risks, evidence, deadlines, defenses, and next actions"
      ),
      professionalPerspective: employment
        ? "employment attorney"
        : "legal risk advisor",
      requiredAnalyses: employment
        ? [
            "overtime and unpaid wages",
            "exemption or misclassification",
            "retaliation",
            "claim elements",
            "evidence strength",
            "deadlines and procedure",
            "employer defenses",
            "next actions",
          ]
        : [
            "applicable legal rules",
            "rights and obligations",
            "evidence strength",
            "deadlines and procedure",
            "counterparty defenses",
            "next actions",
          ],
      decisionCriteria: [
        "jurisdiction-specific legal rule",
        "claim elements supported by facts",
        "evidence completeness",
        "deadline exposure",
        "credible defenses",
        "remedy viability",
      ],
      requiredEvidence: employment
        ? [
            "employment agreement and policies",
            "payroll and time records",
            "classification and duties evidence",
            "complaint and retaliation timeline",
            "termination records",
            "communications and witnesses",
          ]
        : [
            "operative documents",
            "event chronology",
            "communications",
            "official legal sources",
            "procedural dates",
          ],
      forbiddenTopics: domainForbiddenTopics.legal || [],
      criticalClarifications: unique(
        [
          jurisdiction ? "" : "Which jurisdiction applies?",
          /\b(?:deadline|filed|hearing|limitation|son tarih|duruşma|zamanaşımı)\b/i.test(
            combined
          )
            ? ""
            : "What is the earliest relevant deadline?",
        ],
        4
      ),
      confidence: employment && jurisdiction ? 0.92 : employment ? 0.84 : 0.72,
    };
  }

  if (domain === "real_estate") {
    return {
      domain,
      subdomain: "investment_due_diligence",
      taskType: "acquisition_assessment",
      jurisdiction,
      userGoal: modeGoal(
        mode,
        "assess acquisition suitability, material risks, value support, and decision gates"
      ),
      professionalPerspective:
        "real-estate investment and due-diligence advisor",
      requiredAnalyses: [
        "property facts",
        "title verification",
        "zoning and land use",
        "legal and physical access",
        "infrastructure",
        "environmental and geotechnical risk",
        "regional development",
        "comparables",
        "liquidity",
        "investment decision gates",
      ],
      decisionCriteria: [
        "clean title and encumbrance position",
        "development-compatible zoning",
        "verified legal access",
        "acceptable hazard exposure",
        "supported acquisition economics",
        "market liquidity",
      ],
      requiredEvidence: [
        "current title and encumbrance record",
        "parcel-specific zoning record",
        "cadastral and legal access evidence",
        "infrastructure evidence",
        "location-specific hazard evidence",
        "validated comparable transactions or listings",
      ],
      forbiddenTopics: domainForbiddenTopics.real_estate || [],
      criticalClarifications: [],
      confidence: jurisdiction ? 0.9 : 0.82,
    };
  }

  if (domain === "retail") {
    return {
      domain,
      subdomain: "sales_and_inventory",
      taskType: "branch_and_product_performance",
      jurisdiction,
      userGoal: modeGoal(
        mode,
        "identify branch, product, profit, inventory, and growth decisions"
      ),
      professionalPerspective: "retail performance analyst",
      requiredAnalyses: [
        "branch performance",
        "product performance",
        "profitability",
        "stock turnover",
        "weak products",
        "growth opportunities",
      ],
      decisionCriteria: [
        "revenue contribution",
        "gross margin contribution",
        "sell-through",
        "stock turnover",
        "branch variance",
        "data period completeness",
      ],
      requiredEvidence: [
        "dated branch sales",
        "product-level revenue and cost",
        "inventory balances",
        "returns and discounts",
        "currency and reporting period",
      ],
      forbiddenTopics: domainForbiddenTopics.retail || [],
      criticalClarifications: [],
      confidence: 0.9,
    };
  }

  if (domain === "finance" || domain === "accounting") {
    return {
      domain: "finance",
      subdomain: "financial_health",
      taskType: "financial_statement_analysis",
      jurisdiction,
      userGoal: modeGoal(
        mode,
        "assess financial health, resilience, and material financial risks"
      ),
      professionalPerspective: "financial analyst",
      requiredAnalyses: [
        "cash flow",
        "profitability",
        "liquidity",
        "leverage",
        "expense structure",
        "financial risks",
      ],
      decisionCriteria: [
        "cash conversion",
        "margin quality",
        "short-term liquidity",
        "debt service capacity",
        "earnings quality",
        "period consistency",
      ],
      requiredEvidence: [
        "balance sheet",
        "income statement",
        "cash-flow statement",
        "reporting period and currency",
        "debt schedule",
        "material accounting notes",
      ],
      forbiddenTopics: domainForbiddenTopics.finance || [],
      criticalClarifications: [],
      confidence: 0.88,
    };
  }

  const normalizedDomain = domain === "general" ? "business" : domain;
  return {
    domain: normalizedDomain,
    subdomain: "general_advisory",
    taskType: "decision_assessment",
    jurisdiction,
    userGoal: modeGoal(mode, "assess the stated decision and define next actions"),
    professionalPerspective: "strategy advisor",
    requiredAnalyses: [
      "decision objective",
      "available facts",
      "material risks",
      "options",
      "decision criteria",
      "next actions",
    ],
    decisionCriteria: [
      "goal clarity",
      "evidence completeness",
      "risk materiality",
      "option feasibility",
    ],
    requiredEvidence: ["user-provided facts", "relevant uploaded evidence"],
    forbiddenTopics: [],
    criticalClarifications: prompt.trim()
      ? []
      : ["What decision should this analysis support?"],
    confidence: prompt.trim() ? 0.58 : 0.35,
  };
}

export function resolveExpertiseProfile(
  value: unknown,
  fallback: ExpertiseProfile
): ExpertiseProfile {
  const parsed = expertiseProfileSchema.safeParse(value);

  if (!parsed.success) return fallback;

  const candidate = parsed.data;
  if (fallback.domain !== "general" && candidate.domain !== fallback.domain) {
    return fallback;
  }

  return {
    ...candidate,
    requiredAnalyses: unique(
      candidate.requiredAnalyses.length
        ? candidate.requiredAnalyses
        : fallback.requiredAnalyses
    ),
    decisionCriteria: unique(
      candidate.decisionCriteria.length
        ? candidate.decisionCriteria
        : fallback.decisionCriteria
    ),
    requiredEvidence: unique(
      candidate.requiredEvidence.length
        ? candidate.requiredEvidence
        : fallback.requiredEvidence
    ),
    forbiddenTopics: unique([
      ...candidate.forbiddenTopics,
      ...(domainForbiddenTopics[candidate.domain] || []),
    ]),
    criticalClarifications: unique(candidate.criticalClarifications, 4),
    confidence: Math.min(0.99, Math.max(0.05, candidate.confidence)),
  };
}

export function formatExpertiseProfileForReportContext(
  profile: ExpertiseProfile,
  selectedMode: unknown
) {
  const mode = normalizeSelectedAnalysisMode(selectedMode);
  const modeLabel =
    mode === "plan"
      ? "Business Idea Validation"
      : mode === "market"
        ? "Market Intelligence"
        : "Strategic Advisory";

  return [
    "Private expertise routing context. Never render this block, its labels, or its schema to the user.",
    `Authoritative user-selected mode: ${modeLabel}. Do not switch it.`,
    `Expert perspective: ${profile.professionalPerspective}.`,
    `Domain scope: ${profile.domain} / ${profile.subdomain} / ${profile.taskType}.`,
    `Jurisdiction or geography: ${profile.jurisdiction || "not established"}.`,
    `User goal: ${profile.userGoal}.`,
    `Required analysis: ${profile.requiredAnalyses.join("; ")}.`,
    `Decision criteria: ${profile.decisionCriteria.join("; ")}.`,
    `Required evidence: ${profile.requiredEvidence.join("; ")}.`,
    `Forbidden analysis topics: ${profile.forbiddenTopics.join("; ") || "none"}.`,
    `Critical clarifications: ${profile.criticalClarifications.join("; ") || "none"}.`,
    `Profile confidence: ${profile.confidence.toFixed(2)}.`,
  ].join("\n");
}

export function createExpertiseProfileObjectJsonSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      domain: { type: "string", enum: [...expertiseDomainValues] },
      subdomain: { type: "string" },
      taskType: { type: "string" },
      jurisdiction: { type: "string" },
      userGoal: { type: "string" },
      professionalPerspective: { type: "string" },
      requiredAnalyses: {
        type: "array",
        maxItems: 12,
        items: { type: "string" },
      },
      decisionCriteria: {
        type: "array",
        maxItems: 12,
        items: { type: "string" },
      },
      requiredEvidence: {
        type: "array",
        maxItems: 12,
        items: { type: "string" },
      },
      forbiddenTopics: {
        type: "array",
        maxItems: 12,
        items: { type: "string" },
      },
      criticalClarifications: {
        type: "array",
        maxItems: 4,
        items: { type: "string" },
      },
      confidence: { type: "number", minimum: 0, maximum: 1 },
    },
    required: [
      "domain",
      "subdomain",
      "taskType",
      "jurisdiction",
      "userGoal",
      "professionalPerspective",
      "requiredAnalyses",
      "decisionCriteria",
      "requiredEvidence",
      "forbiddenTopics",
      "criticalClarifications",
      "confidence",
    ],
  } as const;
}
