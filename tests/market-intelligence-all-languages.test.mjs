import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildMarketIntelligenceGraph,
  projectMarketIntelligenceGraphToReport,
} from "../app/lib/ai/market-intelligence-graph.ts";
import {
  findReportLanguageIssues,
  getResponseLanguage,
  resolveMarketIntelligenceLanguage,
  resolveMarketPdfLanguage,
} from "../app/lib/report-language.ts";
import { buildMarketLanguageInstructions } from "../app/lib/report-engine/prompts/market.ts";
import { marketFieldLabels } from "../app/lib/report-engine/prompts/market.ts";

const planRoute = readFileSync("app/api/plan/route.ts", "utf8");
const plannerSource = readFileSync("components/Planner.tsx", "utf8");
const planPageSource = readFileSync("app/plan/page.tsx", "utf8");
const marketRoute = readFileSync("app/api/market-analysis/route.ts", "utf8");
const pdfButton = readFileSync("app/dashboard/[id]/ReportPdfButton.tsx", "utf8");

const checkedAt = "2026-08-02T00:00:00.000Z";
function vendorEvidence({ id, name, domain, category }) {
  const claim = `${name} provides ${category} subscription software with workflow features for enterprise and SMB customers.`;
  return {
    id,
    field: "vendor_discovery",
    claim,
    value: `${name} subscription pricing and product feature evidence`,
    label: "Verified from external source",
    sourceTitle: `${name} official product and pricing page`,
    publisher: name,
    url: `https://${domain}/pricing`,
    sourceType: "company_source",
    authorityLevel: "primary",
    confidence: 82,
    publishedDate: "2026-01-15",
    lastChecked: checkedAt,
    supportingData: [claim],
    impact: "neutral",
    impactReason: "Supports vendor coverage.",
    qualityScore: 76,
    qualityRationale: "Official vendor evidence with valid provenance.",
  };
}

function govNoise(id, domain, publisher) {
  return vendorEvidence({ id, name: publisher, domain, category: "market infrastructure" });
}

const samplePrompts = {
  English: "US AI accounting software",
  Turkish: "ABD yapay zeka muhasebe yazılımı pazarı",
  German: "KI-Buchhaltungssoftware für den deutschen Markt analysieren",
  French: "Analyser le marché français des logiciels de comptabilité par intelligence artificielle",
  Spanish: "Analizar el mercado español de software de contabilidad con inteligencia artificial",
};

const languageCodes = { English: "en", Turkish: "tr", German: "de", French: "fr", Spanish: "es" };

// --- Requirement: every supported language resolves correctly from its own prompt ---

for (const [language, prompt] of Object.entries(samplePrompts)) {
  test(`${language} prompt resolves to ${language} via resolveMarketIntelligenceLanguage`, () => {
    const code = resolveMarketIntelligenceLanguage({ requestText: prompt });
    assert.equal(code, languageCodes[language]);
    assert.equal(getResponseLanguage(code), language);
  });
}

// --- Requirement: English and Turkish specifically, per the reported bug ---

test("English input 'US AI accounting software' never falls back to a locale guess", () => {
  assert.equal(resolveMarketIntelligenceLanguage({ requestText: "US AI accounting software" }), "en");
  assert.equal(resolveMarketIntelligenceLanguage({ requestText: "Construction ERP" }), "en");
  assert.equal(resolveMarketIntelligenceLanguage({ requestText: "Cybersecurity MDR" }), "en");
});

test("Turkish input 'ABD yapay zeka muhasebe yazılımı pazarı' resolves to Turkish", () => {
  assert.equal(
    resolveMarketIntelligenceLanguage({ requestText: "ABD yapay zeka muhasebe yazılımı pazarı" }),
    "tr"
  );
});

// --- Requirement: explicit language selector overrides prompt detection ---

for (const language of Object.keys(samplePrompts)) {
  test(`explicit selector forces ${language} regardless of a different prompt's language`, () => {
    const otherPrompt = Object.entries(samplePrompts).find(([name]) => name !== language)[1];
    assert.equal(
      resolveMarketIntelligenceLanguage({ explicitLanguage: language, requestText: otherPrompt }),
      languageCodes[language]
    );
  });
}

// --- Requirement: saved report language survives reload/export in every language ---

for (const [language] of Object.entries(samplePrompts)) {
  test(`${language} saved report language is trusted by PDF export over re-detection`, () => {
    const code = languageCodes[language];
    const misleadingPrompt = samplePrompts.Turkish; // would detect as Turkish if re-derived
    assert.equal(
      resolveMarketPdfLanguage({ savedReportLanguage: code, requestText: misleadingPrompt }),
      code
    );
  });
}

// --- Requirement: prompt enforcement names the language and forbids mixing, per language ---

for (const language of Object.keys(samplePrompts)) {
  test(`buildMarketLanguageInstructions enforces ${language} with a no-mixing rule`, () => {
    const instructions = buildMarketLanguageInstructions(language);
    assert.match(instructions, new RegExp(`Output language is ${language}`));
    assert.match(instructions, /Do not mix languages/);
    assert.match(instructions, /Preserve proper nouns/i);
  });
}

// --- Requirement: section titles (marketFieldLabels) exist in every supported language ---

test("marketFieldLabels covers all 18 canonical section titles in every supported language", () => {
  const fields = [
    "executiveSummary", "marketOverview", "marketSize", "cagr", "marketSegmentation",
    "regionalAnalysis", "industryTrends", "competitiveLandscape", "majorPlayers",
    "customerSegments", "marketDrivers", "barriers", "opportunities", "threats",
    "tamSamSom", "portersFiveForces", "strategicRecommendations", "sources",
  ];
  for (const language of Object.keys(samplePrompts)) {
    for (const field of fields) {
      assert.ok(
        marketFieldLabels[language]?.[field],
        `${language} is missing a label for ${field}`
      );
    }
  }
});

// --- Requirement: the deterministic competitor/graph projection is fully localized ---

function buildGraphFixture(prompt) {
  const evidence = [
    vendorEvidence({ id: "R1", name: "Xero", domain: "xero.com", category: "accounting software" }),
    vendorEvidence({ id: "R2", name: "Sage", domain: "sage.com", category: "accounting software" }),
    govNoise("G1", "bea.gov", "Bureau of Economic Analysis"),
  ];
  return buildMarketIntelligenceGraph({ evidence }, prompt);
}

const graphTitleKeys = {
  English: ["Market Infrastructure", "Validated competitor comparison"],
  Turkish: ["Pazar Altyapısı", "Doğrulanmış rakip karşılaştırması"],
  German: ["Marktinfrastruktur", "Validierter Wettbewerbervergleich"],
  French: ["Infrastructure du marché", "Comparaison validée des concurrents"],
  Spanish: ["Infraestructura del mercado", "Comparación validada de competidores"],
};

for (const [language, prompt] of Object.entries(samplePrompts)) {
  test(`${language} competitor/graph projection uses ${language} titles and table headers`, () => {
    const graph = buildGraphFixture(prompt);
    const projection = projectMarketIntelligenceGraphToReport(graph, language);
    const [infraTitle, competitorTitle] = graphTitleKeys[language];

    assert.match(projection.marketInfrastructure, new RegExp(infraTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(projection.competitiveLandscape, new RegExp(competitorTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    // Company names remain untranslated proper nouns in every language.
    assert.match(projection.competitiveLandscape, /Xero/);
    assert.match(projection.competitiveLandscape, /Sage/);
  });
}

test("English and Turkish graph projections never leak the other language's title text", () => {
  const englishGraph = buildGraphFixture(samplePrompts.English);
  const englishProjection = projectMarketIntelligenceGraphToReport(englishGraph, "English");
  assert.doesNotMatch(englishProjection.marketInfrastructure, /Pazar Altyapısı/);
  assert.doesNotMatch(englishProjection.competitiveLandscape, /Doğrulanmış/);

  const turkishGraph = buildGraphFixture(samplePrompts.Turkish);
  const turkishProjection = projectMarketIntelligenceGraphToReport(turkishGraph, "Turkish");
  assert.doesNotMatch(turkishProjection.marketInfrastructure, /Market Infrastructure/);
  assert.doesNotMatch(turkishProjection.competitiveLandscape, /Validated competitor comparison/);
});

// --- Requirement: no language mixing in a single section, across every language ---

const sampleProse = {
  English: "The competitive landscape shows five major vendors with strong evidence coverage across independent domains.",
  Turkish: "Rekabet ortamı, bağımsız alanlarda güçlü kanıt kapsamına sahip beş büyük tedarikçi göstermektedir.",
  German: "Die Wettbewerbslandschaft zeigt fünf große Anbieter mit starker Nachweisabdeckung über unabhängige Domains.",
  French: "Le paysage concurrentiel montre cinq grands fournisseurs avec une forte couverture de preuves sur des domaines indépendants.",
  Spanish: "El panorama competitivo muestra cinco grandes proveedores con una sólida cobertura de evidencia en dominios independientes.",
};

for (const [language, prose] of Object.entries(sampleProse)) {
  test(`a fully ${language} section reports no language-consistency issues`, () => {
    assert.equal(findReportLanguageIssues(prose, language).length, 0);
  });
}

test("mixing German prose into an English section is detected", () => {
  const mixed = `${sampleProse.English} ${sampleProse.German}`;
  const issues = findReportLanguageIssues(mixed, "English");
  assert.ok(issues.length > 0);
});

test("mixing French prose into a Spanish section is detected", () => {
  const mixed = `${sampleProse.Spanish} ${sampleProse.French}`;
  const issues = findReportLanguageIssues(mixed, "Spanish");
  assert.ok(issues.length > 0);
});

// --- Requirement: company names and URLs remain unchanged in every language ---

for (const language of Object.keys(samplePrompts)) {
  test(`${language}: source line with a URL and a company name is never flagged as mixed`, () => {
    const text = "Source: https://quickbooks.intuit.com/pricing — BlackLine and Xero are referenced.";
    assert.equal(findReportLanguageIssues(text, language).length, 0);
  });
}

// --- Requirement: regeneration reuses the saved report language (wiring checks) ---

test("regeneration passes the saved report language through instead of re-detecting it", () => {
  assert.match(planPageSource, /reportLanguage:\s*regenerationReport\?\.metadata\?\.reportLanguage/);
  assert.match(plannerSource, /reportLanguage\?:\s*string/);
  assert.match(plannerSource, /isRegeneratingSavedReport/);
  assert.match(
    plannerSource,
    /regenerationContext\?\.prompt\.trim\(\)\s*===\s*submittedPrompt/
  );
});

// --- Requirement: transient loading-state mismatch is eliminated ---

test("the client and server resolve Market Intelligence language with the same function and the same explicit-priority input", () => {
  assert.match(plannerSource, /resolveMarketIntelligenceLanguage/);
  assert.match(planRoute, /resolveMarketIntelligenceLanguage/);
  // The client receives the server-fetched Settings preference synchronously
  // (no extra round-trip) so the loading-state guess matches the server.
  assert.match(planPageSource, /preferred_language/);
  assert.match(planPageSource, /preferredLanguage=\{preferredLanguage\}/);
  assert.match(plannerSource, /preferredLanguage\s*=\s*""/);
  assert.match(
    plannerSource,
    /resolvePlannerReportLanguage\(submittedPrompt, requestedMode, preferredLanguage\)/
  );
});

// --- Requirement: German/French/Spanish deterministic scorecard text exists (route.ts) ---

test("market-analysis route's marketText helper supports all 5 languages", () => {
  assert.match(
    marketRoute,
    /function marketText\(\s*language: ResponseLanguage,\s*english: string,\s*turkish: string,\s*german = english,\s*french = english,\s*spanish = english\s*\)/
  );
  assert.match(marketRoute, /Gesamtempfehlung/); // German scorecard line
  assert.match(marketRoute, /Recommandation globale/); // French scorecard line
  assert.match(marketRoute, /Recomendación general/); // Spanish scorecard line
  assert.match(marketRoute, /CEO-Zusammenfassung/);
  assert.match(marketRoute, /Résumé du PDG/);
  assert.match(marketRoute, /Resumen del CEO/);
});

test("PDF cover-card labels are localized for German/French/Spanish market reports", () => {
  assert.match(pdfButton, /isMarketIntelligenceDashboardReport/);
  assert.match(pdfButton, /pdfLocaleToBcp47/);
  assert.match(pdfButton, /localizePdfPresentationLabel\("Sections", pdfLocale\)/);
  assert.match(pdfButton, /localizePdfPresentationLabel\("Investor Ready", pdfLocale\)/);
});

const pdfNormalization = readFileSync("app/lib/pdf-normalization.mjs", "utf8");

test("PDF label dictionary has German/French/Spanish entries for market-report labels", () => {
  for (const key of ["financial quality", "report quality", "market analysis", "investor ready", "sections", "table of contents"]) {
    assert.ok(pdfNormalization.includes(`["${key}"`), `missing PDF label key: ${key}`);
  }
});
