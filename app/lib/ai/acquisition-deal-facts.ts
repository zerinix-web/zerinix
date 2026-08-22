// CRITICAL ACQUISITION CONTENT FIX -- deterministic deal-fact extraction
// and derived-metric computation. Confirmed live: acquisition reports
// ignored explicit user-stated deal figures (purchase price, target ARR,
// customer/employee counts, buyer capital, financing structure) and left
// simple, unambiguous ratios (EV/ARR, debt/equity split) either uncomputed
// or computed inconsistently by the model. Mirrors financial-model.ts's
// extractUserStatedFinancials pattern (label-anchored regex + a negation
// guard so "we don't have $X" is never read as a real figure), but as its
// own module: the acquisition pipeline never calls createFinancialModel,
// and these are acquisition-specific facts, not MRR/ARR/customers for a
// startup's own business.
//
// Every derived metric here is computed once, in code, from the parsed
// user-verified figures -- never left to the model to recompute, and
// never invented when an input is missing. Callers must label extracted
// facts "Verified" (the user stated them) and derived metrics "Derived"
// (computed from verified inputs), matching the report's canonical
// 3-tier evidence vocabulary (Verified / Derived / Benchmark-Assumption).

export type AcquisitionDealFacts = {
  purchasePrice: number | null;
  targetArr: number | null;
  enterpriseCustomers: number | null;
  employees: number | null;
  buyerAvailableCapital: number | null;
  remainingFinancingType: "debt" | "equity" | "mixed" | null;
};

export type AcquisitionDerivedMetrics = {
  evToArr: number | null;
  equityContribution: number | null;
  debtRequirement: number | null;
  debtSharePercent: number | null;
  equitySharePercent: number | null;
};

function parseUsdAmount(rawValue: string, rawSuffix: string): number | null {
  const value = Number(rawValue.replace(/,/g, ""));
  if (!Number.isFinite(value)) return null;

  const suffix = rawSuffix.toLowerCase();
  if (suffix === "k" || suffix === "thousand") return value * 1_000;
  if (suffix === "m" || suffix === "million") return value * 1_000_000;
  if (suffix === "bn" || suffix === "billion") return value * 1_000_000_000;

  return value;
}

// CRITICAL FIX -- preserve user-provided acquisition facts as authoritative
// inputs. Confirmed live: a structured, one-fact-per-line prompt --
// "Purchase price: $40M\nARR: $10M\nEnterprise customers: 500\n
// Employees: 80\nBuyer available capital: $25M" -- corrupted extraction
// entirely. Plain \s* matches across a newline, and that appeared in TWO
// places: (1) the connector between a value and its label, letting
// "$40M" (Purchase price's own value) bleed forward into matching "ARR"
// on the very next line; (2) more subtly, INSIDE usdAmountGroup itself,
// between the captured digits and the optional k/m/bn suffix -- so even
// with (1) fixed, "80" (Employees' own value, no suffix) still matched
// usdAmountGroup with its trailing \s* silently consuming the newline
// before reaching "Buyer available capital" on the following line.
// sameLineGap excludes newlines everywhere a value/label connector is
// built, so a value can only ever pair with a label genuinely on the same
// line as it.
const sameLineGap = "[^\\S\\r\\n]*";

const usdAmountGroup =
  `\\$?${sameLineGap}([\\d][\\d,]*(?:\\.\\d+)?)${sameLineGap}(k|thousand|m|million|bn|billion)?`;

// Same negation vocabulary as financial-model.ts's hasNearbyNegation,
// applied to the ~30 characters immediately before a matched figure --
// "the buyer does not have $8M available" must never be read as a real
// $8M figure.
function hasNearbyNegation(prompt: string, index: number) {
  const precedingContext = prompt.slice(Math.max(0, index - 30), index);

  return /\b(?:no|not|zero|without|never (?:had|have|has)|don'?t have|doesn'?t have|do not have|does not have|haven'?t|have not|hasn'?t|has not|lack(?:s|ing)? of)\s*$/i.test(
    precedingContext
  );
}

function extractLabeledUsdAmount(prompt: string, labelPattern: string): number | null {
  const valueThenLabel = new RegExp(
    `${usdAmountGroup}${sameLineGap}(?:in${sameLineGap}|of${sameLineGap})?(?:${labelPattern})\\b`,
    "i"
  );
  const labelThenValue = new RegExp(
    `\\b(?:${labelPattern})\\b${sameLineGap}(?:of|is|at|was|reached|[:=-])?${sameLineGap}${usdAmountGroup}`,
    "i"
  );

  const match = prompt.match(valueThenLabel) || prompt.match(labelThenValue);
  if (!match || typeof match.index !== "number") return null;
  if (hasNearbyNegation(prompt, match.index)) return null;

  return parseUsdAmount(match[1], match[2] || "");
}

// Handles both "80 employees" (value-then-label, prose) and
// "Employees: 80" (label-then-value, structured one-fact-per-line input)
// -- previously only the value-then-label direction was supported at all,
// so a structured "Employees: 80" line was never read correctly.
function extractLabeledCount(prompt: string, labelPattern: string): number | null {
  const valueThenLabel = new RegExp(
    `\\b([\\d][\\d,]*)${sameLineGap}(?:${labelPattern})\\b`,
    "i"
  );
  const labelThenValue = new RegExp(
    `\\b(?:${labelPattern})\\b${sameLineGap}(?:of|is|at|was|reached|[:=-])?${sameLineGap}([\\d][\\d,]*)\\b`,
    "i"
  );

  const match = prompt.match(valueThenLabel) || prompt.match(labelThenValue);
  if (!match || typeof match.index !== "number") return null;
  if (hasNearbyNegation(prompt, match.index)) return null;

  return Number(match[1].replace(/,/g, ""));
}

function extractRemainingFinancingType(
  prompt: string
): AcquisitionDealFacts["remainingFinancingType"] {
  const explicitLabel = prompt.match(
    /\b(?:remaining|remainder|balance)\s+financ(?:e|ing)\s*(?:is|will be)?\s*[:=-]?\s*(debt|equity|mix(?:ed)?|a mix of debt and equity)\b/i
  );
  if (explicitLabel) {
    const value = explicitLabel[1].toLowerCase();
    if (value.startsWith("mix")) return "mixed";
    if (value === "debt") return "debt";
    if (value === "equity") return "equity";
  }

  const financedVia = prompt.match(
    /\bfinanc(?:e|ed|ing)\s+(?:the\s+)?(?:remainder|rest|balance|gap)\s+(?:via|with|through)\s+(debt|equity)\b/i
  );
  if (financedVia) return financedVia[1].toLowerCase() as "debt" | "equity";

  // Structured, type-first phrasing ("Debt financing: $15M"), the same
  // one-fact-per-line shape the other extractors above now support.
  const typeFirstLabel = prompt.match(/\b(debt|equity|mix(?:ed)?)\s+financing\b/i);
  if (typeFirstLabel) {
    const value = typeFirstLabel[1].toLowerCase();
    if (value.startsWith("mix")) return "mixed";
    if (value === "debt") return "debt";
    if (value === "equity") return "equity";
  }

  return null;
}

// Deliberately excludes bare "users" and market-sizing qualifiers, same
// reasoning as financial-model.ts's extractUserStatedCustomerCount --
// this is the TARGET company's real, current customer base, not a
// market-size estimate.
function extractEnterpriseCustomers(prompt: string): number | null {
  const valueThenLabel = new RegExp(
    `\\b([\\d][\\d,]*)${sameLineGap}(?:enterprise${sameLineGap})?(?:paying${sameLineGap}|active${sameLineGap}|current${sameLineGap})?customers?\\b`,
    "i"
  );
  // Anchored to "enterprise customers" specifically (not bare "customers")
  // in the label-then-value direction -- unlike the value-first prose
  // case, a bare "Customers: 500" label with no qualifier is ambiguous
  // enough (could be a market-size or unrelated figure) that it should
  // not be read as this field without the "enterprise" qualifier.
  const labelThenValue = new RegExp(
    `\\benterprise${sameLineGap}customers?\\b${sameLineGap}(?:of|is|at|was|reached|[:=-])?${sameLineGap}([\\d][\\d,]*)\\b`,
    "i"
  );

  const match = prompt.match(valueThenLabel) || prompt.match(labelThenValue);
  if (!match || typeof match.index !== "number") return null;
  if (hasNearbyNegation(prompt, match.index)) return null;

  const precedingContext = prompt
    .slice(Math.max(0, match.index - 40), match.index)
    .toLowerCase();
  if (
    /\b(?:potential|target|addressable|total addressable|estimated|projected|expected|future)\s*$/.test(
      precedingContext
    )
  ) {
    return null;
  }

  return Number(match[1].replace(/,/g, ""));
}

export function extractAcquisitionDealFacts(prompt: string): AcquisitionDealFacts {
  return {
    purchasePrice: extractLabeledUsdAmount(
      prompt,
      "purchase price|acquisition price|deal price|buying (?:it|them) for|purchasing (?:it|them) for|offer price"
    ),
    targetArr: extractLabeledUsdAmount(
      prompt,
      "target(?:'s)? ARR|ARR|annual recurring revenue"
    ),
    enterpriseCustomers: extractEnterpriseCustomers(prompt),
    employees: extractLabeledCount(prompt, "employees?|headcount|staff"),
    buyerAvailableCapital: extractLabeledUsdAmount(
      prompt,
      "buyer(?:'s)? available capital|available capital|available cash|cash available|equity capital available"
    ),
    remainingFinancingType: extractRemainingFinancingType(prompt),
  };
}

function roundToOneDecimal(value: number) {
  return Math.round(value * 10) / 10;
}

// Every metric here depends only on verified user-stated inputs and pure
// arithmetic -- never on research, benchmarks, or model inference. Any
// metric whose required inputs are missing stays null rather than being
// estimated; callers must never fabricate a number this function could
// not compute from what the user actually provided.
export function computeAcquisitionDerivedMetrics(
  facts: AcquisitionDealFacts
): AcquisitionDerivedMetrics {
  const { purchasePrice, targetArr, buyerAvailableCapital } = facts;

  const evToArr =
    purchasePrice != null && targetArr != null && targetArr > 0
      ? roundToOneDecimal(purchasePrice / targetArr)
      : null;

  const equityContribution =
    purchasePrice != null && buyerAvailableCapital != null
      ? Math.min(buyerAvailableCapital, purchasePrice)
      : null;

  const debtRequirement =
    purchasePrice != null && equityContribution != null
      ? Math.max(0, purchasePrice - equityContribution)
      : null;

  const debtSharePercent =
    purchasePrice != null && purchasePrice > 0 && debtRequirement != null
      ? roundToOneDecimal((debtRequirement / purchasePrice) * 100)
      : null;

  const equitySharePercent =
    purchasePrice != null && purchasePrice > 0 && equityContribution != null
      ? roundToOneDecimal((equityContribution / purchasePrice) * 100)
      : null;

  return {
    evToArr,
    equityContribution,
    debtRequirement,
    debtSharePercent,
    equitySharePercent,
  };
}

export function formatUsdCompact(value: number): string {
  if (Math.abs(value) >= 1_000_000_000) {
    return `$${roundToOneDecimal(value / 1_000_000_000)}B`;
  }
  if (Math.abs(value) >= 1_000_000) {
    return `$${roundToOneDecimal(value / 1_000_000)}M`;
  }
  if (Math.abs(value) >= 1_000) {
    return `$${roundToOneDecimal(value / 1_000)}K`;
  }
  return `$${value}`;
}

function buildVerifiedFactLines(
  facts: AcquisitionDealFacts,
  isTurkish: boolean
): string[] {
  const verifiedLabel = isTurkish ? "Doğrulanmış" : "Verified";
  const lines: string[] = [];

  if (facts.purchasePrice != null) {
    lines.push(
      `[${verifiedLabel}] ${isTurkish ? "Satın alma fiyatı" : "Purchase price"}: ${formatUsdCompact(facts.purchasePrice)}`
    );
  }
  if (facts.targetArr != null) {
    lines.push(
      `[${verifiedLabel}] ${isTurkish ? "Hedef ARR" : "Target ARR"}: ${formatUsdCompact(facts.targetArr)}`
    );
  }
  if (facts.enterpriseCustomers != null) {
    lines.push(
      `[${verifiedLabel}] ${isTurkish ? "Kurumsal müşteriler" : "Enterprise customers"}: ${facts.enterpriseCustomers.toLocaleString("en-US")}`
    );
  }
  if (facts.employees != null) {
    lines.push(
      `[${verifiedLabel}] ${isTurkish ? "Çalışan sayısı" : "Employees"}: ${facts.employees.toLocaleString("en-US")}`
    );
  }
  if (facts.buyerAvailableCapital != null) {
    lines.push(
      `[${verifiedLabel}] ${isTurkish ? "Alıcının kullanılabilir sermayesi" : "Buyer available capital"}: ${formatUsdCompact(facts.buyerAvailableCapital)}`
    );
  }
  if (facts.remainingFinancingType != null) {
    lines.push(
      `[${verifiedLabel}] ${isTurkish ? "Kalan finansman türü" : "Remaining financing"}: ${facts.remainingFinancingType}`
    );
  }

  return lines;
}

function buildValuationDerivedLines(
  derived: AcquisitionDerivedMetrics,
  isTurkish: boolean
): string[] {
  const derivedLabel = isTurkish ? "Türetilmiş" : "Derived";
  const lines: string[] = [];

  if (derived.evToArr != null) {
    lines.push(`[${derivedLabel}] EV/ARR: ${derived.evToArr}x`);
  }

  return lines;
}

function buildFinancingDerivedLines(
  derived: AcquisitionDerivedMetrics,
  isTurkish: boolean
): string[] {
  const derivedLabel = isTurkish ? "Türetilmiş" : "Derived";
  const lines: string[] = [];

  if (derived.equityContribution != null) {
    lines.push(
      `[${derivedLabel}] ${isTurkish ? "Özkaynak katkısı" : "Equity contribution"}: ${formatUsdCompact(derived.equityContribution)}`
    );
  }
  if (derived.debtRequirement != null) {
    lines.push(
      `[${derivedLabel}] ${isTurkish ? "Borç ihtiyacı" : "Debt requirement"}: ${formatUsdCompact(derived.debtRequirement)}`
    );
  }
  if (derived.debtSharePercent != null) {
    lines.push(
      `[${derivedLabel}] ${isTurkish ? "Satın alma fiyatının borç payı" : "Debt share of purchase price"}: ${derived.debtSharePercent}%`
    );
  }
  if (derived.equitySharePercent != null) {
    lines.push(
      `[${derivedLabel}] ${isTurkish ? "Özkaynak payı" : "Equity share"}: ${derived.equitySharePercent}%`
    );
  }

  return lines;
}

function joinLabeledBlock(
  heading: string,
  lines: string[]
): string | null {
  return lines.length > 0 ? `${heading}:\n${lines.join("\n")}` : null;
}

// Deterministic, code-formatted context block -- injected verbatim into
// the generation prompt so the model never has to compute these itself,
// and used again (identically, via the section-specific formatters
// below) to build the guaranteed-correct deterministic prepend applied
// after generation. Returns null when no deal facts were extracted at
// all, so callers can omit the block entirely rather than injecting an
// all-empty section.
export function formatAcquisitionDealFactsContext(
  facts: AcquisitionDealFacts,
  derived: AcquisitionDerivedMetrics,
  language: "English" | "Turkish" = "English"
): string | null {
  const isTurkish = language === "Turkish";
  const verifiedLines = buildVerifiedFactLines(facts, isTurkish);
  const derivedLines = [
    ...buildValuationDerivedLines(derived, isTurkish),
    ...buildFinancingDerivedLines(derived, isTurkish),
  ];

  if (verifiedLines.length === 0 && derivedLines.length === 0) {
    return null;
  }

  const sections = [
    joinLabeledBlock(
      isTurkish ? "Kullanıcı tarafından doğrulanan işlem bilgileri" : "User-verified deal facts",
      verifiedLines
    ),
    joinLabeledBlock(
      isTurkish
        ? "Türetilmiş metrikler (yalnızca doğrulanmış girdilerden hesaplanmıştır)"
        : "Derived metrics (computed only from the verified inputs above)",
      derivedLines
    ),
  ].filter((section): section is string => section !== null);

  return sections.join("\n\n");
}

// Section-specific formatters, used to deterministically prepend
// guaranteed-correct figures to the exact report sections that need
// them, regardless of what the model independently wrote -- the same
// "never trust the model alone for a number that code can compute
// exactly" precedent as formatExecutiveDecisionBrief's prepend pattern
// elsewhere in this codebase.
export function formatVerifiedDealFactsBlock(
  facts: AcquisitionDealFacts,
  language: "English" | "Turkish" = "English"
): string | null {
  const isTurkish = language === "Turkish";
  return joinLabeledBlock(
    isTurkish ? "Doğrulanmış İşlem Bilgileri" : "Verified Deal Facts",
    buildVerifiedFactLines(facts, isTurkish)
  );
}

export function formatDerivedValuationBlock(
  derived: AcquisitionDerivedMetrics,
  language: "English" | "Turkish" = "English"
): string | null {
  const isTurkish = language === "Turkish";
  return joinLabeledBlock(
    isTurkish ? "Türetilmiş Değerleme Metriği" : "Derived Valuation Metric",
    buildValuationDerivedLines(derived, isTurkish)
  );
}

export function formatDerivedFinancingBlock(
  derived: AcquisitionDerivedMetrics,
  language: "English" | "Turkish" = "English"
): string | null {
  const isTurkish = language === "Turkish";
  return joinLabeledBlock(
    isTurkish ? "Türetilmiş Finansman Metrikleri" : "Derived Financing Metrics",
    buildFinancingDerivedLines(derived, isTurkish)
  );
}
