import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

// CRITICAL PRODUCTION FIX -- confirmed live: an AI-native maritime
// logistics intelligence platform for governments, ports, shipping
// companies, and defense organizations was classified as "Drone
// technology / autonomous systems" -- contaminating Financial
// Assumptions, Benchmark Intelligence, SWOT, and the roadmap with
// drone-hardware terminology.
//
// Root cause: inferIndustryKey's (app/lib/ai/financial-model.ts) "drone"
// pattern was positioned BEFORE the "logistics" pattern (which already
// recognized maritime/shipping/vessel vocabulary). Drone imagery was only
// ONE of several intelligence input sources the platform described
// (alongside satellite imagery, AIS vessel tracking, and customs data),
// but firstMatching's first-match-wins array order meant that single
// supporting-technology mention won before the prompt's own primary
// business vocabulary ("maritime", "logistics", "shipping") ever got
// checked -- the same false-positive shape as every other fix in this
// function (payments/compliance/vendor/battery/manufacturing).
//
// The fix moves the logistics/maritime pattern ahead of "drone" and
// enriches it with maritime-intelligence-specific vocabulary (AIS
// tracking, customs, port authority/intelligence, maritime security/
// defense) -- deliberately NOT including a bare "satellite imagery"
// trigger, since that alone is not maritime-exclusive (confirmed it would
// otherwise misclassify unrelated agriculture/insurance/geospatial
// businesses that also analyze satellite imagery, reproducing the exact
// bug class this fix exists to eliminate). Because getIndustryBenchmarks
// (industryKey) is the single source of truth every benchmark-driven
// section (Financial Assumptions, Benchmark Intelligence, SWOT, Roadmap,
// Executive Summary, Financial Dashboard, Founder Readiness, PDF) already
// reads from, fixing the classifier alone corrects every section
// automatically -- no per-section patch was needed.

async function importFinancialModel() {
  const sourcePath = join(repoRoot, "app/lib/ai/financial-model.ts");
  const benchmarksPath = join(repoRoot, "app/lib/ai/industry-benchmarks.ts");
  let source = readFileSync(sourcePath, "utf8");
  source = source.replace(
    '"@/app/lib/ai/industry-benchmarks"',
    JSON.stringify(pathToFileURL(benchmarksPath).href)
  );
  source = source.replace(
    '"@/app/lib/ai/company-lifecycle"',
    JSON.stringify(pathToFileURL(join(repoRoot, "app/lib/ai/company-lifecycle.ts")).href)
  );

  const dir = mkdtempSync(join(tmpdir(), "zerinix-financial-model-"));
  const outPath = join(dir, "financial-model.ts");
  writeFileSync(outPath, source);
  return import(pathToFileURL(outPath).href);
}

const { inferIndustryKey, inferFinancialModelingInputs } = await importFinancialModel();
const financialModelSource = readFileSync(join(repoRoot, "app/lib/ai/financial-model.ts"), "utf8");

const maritimeIntelligencePrompt =
  "An AI-native maritime logistics intelligence platform for governments, ports, shipping companies, and defense organizations, fusing satellite imagery, AIS vessel tracking, drone imagery, and customs data to monitor global shipping activity and detect sanctions evasion.";

// --- The exact live bug and its fix --------------------------------------

test("the exact reported maritime intelligence prompt classifies as 'logistics', never 'drone' (the exact live bug)", () => {
  const industryKey = inferIndustryKey(maritimeIntelligencePrompt);

  assert.equal(industryKey, "logistics");
  assert.notEqual(industryKey, "drone");
});

test("the resolved benchmark label never renders 'Drone technology / autonomous systems' for the maritime intelligence prompt", () => {
  const { industry } = inferFinancialModelingInputs(maritimeIntelligencePrompt);

  assert.notEqual(industry, "Drone technology / autonomous systems");
  assert.doesNotMatch(industry, /drone/i);
  assert.equal(industry, "Logistics / supply chain");
});

// --- Requirement 5: named regression categories ---------------------------

test("maritime intelligence ideas classify as logistics", () => {
  const prompts = [
    "A maritime intelligence platform tracking vessel movements and port activity for national security agencies.",
    "A maritime domain awareness platform providing AIS vessel tracking and port authority monitoring.",
  ];
  for (const prompt of prompts) {
    assert.equal(inferIndustryKey(prompt), "logistics", `"${prompt}" should classify as logistics`);
  }
});

test("satellite intelligence for shipping/logistics classifies as logistics, but generic satellite-imagery businesses do not get pulled into logistics", () => {
  assert.equal(
    inferIndustryKey(
      "A satellite intelligence platform for monitoring global shipping and maritime supply chains."
    ),
    "logistics"
  );

  // Adversarial check: "satellite imagery" alone must never be a
  // sufficient trigger for "logistics" -- these unrelated businesses must
  // fall through to their own correct category instead.
  assert.equal(
    inferIndustryKey("A satellite imagery platform for precision agriculture and crop yield monitoring."),
    "agriculture"
  );
  assert.notEqual(
    inferIndustryKey("A satellite imagery analytics platform for urban planning and disaster response."),
    "logistics"
  );
});

test("logistics intelligence ideas classify as logistics", () => {
  assert.equal(
    inferIndustryKey("An AI logistics intelligence platform that optimizes freight routing and warehouse operations for retailers."),
    "logistics"
  );
});

test("geospatial intelligence ideas that are not maritime-specific do not get misrouted to logistics", () => {
  const industryKey = inferIndustryKey(
    "A geospatial intelligence platform for satellite and drone imagery analysis for urban planning."
  );
  assert.notEqual(industryKey, "logistics");
  assert.notEqual(industryKey, "manufacturing");
});

test("a drone manufacturer (no maritime/logistics vocabulary) still classifies as drone (no regression)", () => {
  assert.equal(
    inferIndustryKey("A drone manufacturer building autonomous aerial vehicles for agricultural surveying."),
    "drone"
  );
});

test("autonomous drone software (no maritime/logistics vocabulary) still classifies as drone (no regression)", () => {
  assert.equal(
    inferIndustryKey("An autonomous drone software platform for flight planning and fleet management of commercial drones."),
    "drone"
  );
});

test("an AI logistics platform still classifies as logistics", () => {
  assert.equal(
    inferIndustryKey("An AI-powered logistics platform that predicts delivery delays and optimizes warehouse inventory."),
    "logistics"
  );
});

test("a maritime security platform (AIS, vessel tracking, customs screening, port authorities) classifies as logistics", () => {
  assert.equal(
    inferIndustryKey("A maritime security platform providing vessel tracking, AIS monitoring, and customs screening for port authorities."),
    "logistics"
  );
});

// --- Existing benchmark tests continue passing (explicit acceptance criterion) --

test("renewable energy, AML/Fraud, fintech, and cybersecurity classification are unaffected by this reorder", () => {
  const cases = [
    ["An AI-powered renewable energy portfolio optimization platform for utilities, managing solar, wind, and battery storage assets.", "energy"],
    ["An AML and fraud detection compliance platform (transaction monitoring, sanctions screening, and KYC automation) for banks.", "cybersecurity"],
    ["A neobank platform offering digital wallets and payment processing for consumers.", "fintech"],
    ["A cybersecurity platform providing threat detection and managed detection and response for enterprises.", "cybersecurity"],
  ];

  for (const [prompt, expected] of cases) {
    assert.equal(inferIndustryKey(prompt), expected, `"${prompt}" should still classify as ${expected}`);
  }
});

// --- Drift checks -----------------------------------------------------

test("inferIndustryKey's logistics/maritime pattern is positioned before the drone pattern (drift check on match-order precedence)", () => {
  const logisticsIndex = financialModelSource.indexOf('"logistics"],');
  const droneIndex = financialModelSource.indexOf('"drone"],');
  assert.ok(logisticsIndex > -1, "logistics pattern not found");
  assert.ok(droneIndex > -1, "drone pattern not found");
  assert.ok(logisticsIndex < droneIndex, "logistics pattern must be checked before drone");
});

test("the logistics pattern does not include a bare 'satellite imagery' trigger (drift check preventing the adjacent false-positive class)", () => {
  const patternMatch = /\[\/\\b\(logistics\|freight[\s\S]*?"logistics"\],/.exec(financialModelSource);
  assert.ok(patternMatch, "logistics pattern not found in expected shape");
  assert.doesNotMatch(patternMatch[0], /\|satellite imagery\)/, "bare 'satellite imagery' was reintroduced as a standalone trigger");
});

test("the logistics pattern includes the maritime-intelligence vocabulary named in the requirements (AIS, customs, port, maritime security/intelligence)", () => {
  const patternMatch = /\[\/\\b\(logistics\|freight[\s\S]*?"logistics"\],/.exec(financialModelSource);
  assert.ok(patternMatch, "logistics pattern not found in expected shape");
  for (const term of ["ais tracking", "customs clearance", "port authority", "maritime security", "maritime intelligence"]) {
    assert.match(patternMatch[0], new RegExp(term, "i"), `logistics pattern missing "${term}"`);
  }
});
