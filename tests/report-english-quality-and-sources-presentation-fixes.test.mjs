import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

// FINAL PRODUCTION POLISH FIX -- confirmed live in an AML/Fraud Business
// Plan report:
//
// 1. English quality: buildExecutiveInsight (app/lib/report-jobs/
//    plan-executor.ts) glued investmentScore.nextCriticalAction -- always
//    a full imperative sentence ("Run primary research to validate market
//    size and contribution margin assumptions.") -- lowercased, as the
//    object of "...allocate capital only after X is validated against...",
//    producing "...after run primary research to validate market size and
//    contribution margin assumptions. is validated against..." for every
//    possible action sentence. Fixed by presenting the action as its own
//    standalone sentence in its original casing.
//
// 2. Prompt excerpt formatting: getBusinessIdeaFromPrompt (duplicated in
//    app/dashboard/[id]/ReportPdfButton.tsx and components/Planner.tsx)
//    displayed raw prompt text verbatim, including a leading "i want to
//    build..." chat-instruction phrasing and no sentence-casing. Fixed by
//    stripping the filler opening and capitalizing the first letter.
//
// 3. Sources presentation: Planner.tsx's formatPdfCitationContent (an
//    independent duplicate of ReportPdfButton.tsx's already-correct
//    citation renderer) unconditionally printed "Publisher: ${value}",
//    "Year: ${value || "Not specified"}", and "URL: ${value || "Not
//    provided"}" even when the underlying metadata did not exist,
//    producing empty/placeholder fields ("Publisher:", "Year: Not
//    specified"). Fixed to omit each field entirely when its value is
//    unavailable, matching ReportPdfButton.tsx's existing behavior.
//
// 4. Template cleanup: a new cleanupTemplatePresentationArtifacts pass
//    (report-presentation.ts) collapses stray double periods and
//    duplicated punctuation left behind by broken field/sentence
//    concatenation, and stray mid-line double spaces -- without ever
//    touching a genuine ellipsis or intentional leading indentation (the
//    Sources section's "  Publisher: ..." nested under its bullet).

async function importReportPresentation() {
  const sourcePath = join(repoRoot, "app/lib/report-presentation.ts");
  let source = readFileSync(sourcePath, "utf8");
  source = source.replace(
    '"@/app/lib/report-output-sanitization"',
    JSON.stringify(pathToFileURL(join(repoRoot, "app/lib/report-output-sanitization.ts")).href)
  );
  source = source.replace(
    '"@/app/lib/report-investment-score"',
    JSON.stringify(pathToFileURL(join(repoRoot, "app/lib/report-investment-score.ts")).href)
  );

  const dir = mkdtempSync(join(tmpdir(), "zerinix-report-presentation-"));
  const outPath = join(dir, "report-presentation.ts");
  writeFileSync(outPath, source);
  return import(pathToFileURL(outPath).href);
}

const { normalizeReportPresentationText } = await importReportPresentation();
const reportPresentationSource = readFileSync(join(repoRoot, "app/lib/report-presentation.ts"), "utf8");
const planExecutorSource = readFileSync(join(repoRoot, "app/lib/report-jobs/plan-executor.ts"), "utf8");
const reportPdfButtonSource = readFileSync(join(repoRoot, "app/dashboard/[id]/ReportPdfButton.tsx"), "utf8");
const plannerSource = readFileSync(join(repoRoot, "components/Planner.tsx"), "utf8");

// --- Issue 1: natural English rendering (the exact live bug) ------------

// Mirrors buildExecutiveInsight's exact template (plan-executor.ts has
// heavy Supabase/auth dependencies that prevent clean direct import --
// established convention for this file elsewhere in this suite).
function buildExecutiveInsight(nextCriticalAction, focus, cacPayback, runway) {
  return `AI Executive Insight: ${focus} matters because capital should only be committed once this is complete: ${nextCriticalAction} Confirm it holds against the ${cacPayback} payback and ${runway} runway.`;
}

test("the exact reported broken concatenation ('after run primary research...') no longer occurs for any nextCriticalAction value", () => {
  const actions = [
    "Run primary research to validate market size and contribution margin assumptions.",
    "Convert the strongest ICP into paid pilots using the calculated pricing and payback targets.",
    "Validate a lower-CAC acquisition motion before increasing budget.",
    "Validate pricing, buyer urgency, and repeatable acquisition before committing full funding.",
    "Do not scale spend until the weakest economics are redesigned and validated.",
  ];

  for (const action of actions) {
    const sentence = buildExecutiveInsight(action, "AML/Fraud compliance readiness", "$450K", "14 months");

    assert.doesNotMatch(sentence, /after run primary research/i, `still contains the broken concatenation for "${action}"`);
    assert.doesNotMatch(sentence, /\.\s+is validated against/i, "a trailing lowercase verb phrase leaked after a mid-sentence period");
    assert.match(sentence, new RegExp(action.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "the action sentence must appear in its original casing");
  }
});

test("plan-executor.ts's buildExecutiveInsight no longer lowercases and glues nextCriticalAction into a broken clause (drift check)", () => {
  const fnMatch = /function buildExecutiveInsight\([\s\S]*?\n\}/.exec(planExecutorSource);
  assert.ok(fnMatch, "buildExecutiveInsight not found");
  assert.doesNotMatch(fnMatch[0], /nextCriticalAction\.toLowerCase\(\)/, "still lowercases nextCriticalAction for inline splicing");
  assert.match(fnMatch[0], /\$\{context\.investmentScore\.nextCriticalAction\}/, "nextCriticalAction must be presented as its own standalone sentence");
});

// --- Issue 2: prompt excerpt formatting (sentence capitalization) -------

const leadingWantToPhrase =
  /^i\s+(?:want|would like|plan|am planning|need)\s+to\s+(?:build|create|start|launch|develop)\s+/i;

function sentenceCaseFirstLetter(value) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

test("a raw 'i want to build...' prompt excerpt is reframed as a professional sentence-cased phrase (the exact live bug)", () => {
  const raw = "i want to build an AML/Fraud compliance platform for banks and fintechs.";
  const cleaned = sentenceCaseFirstLetter(raw.replace(leadingWantToPhrase, ""));

  assert.doesNotMatch(cleaned, /^i\s+want\s+to/i);
  assert.equal(cleaned, "An AML/Fraud compliance platform for banks and fintechs.");
  assert.equal(cleaned.charAt(0), cleaned.charAt(0).toUpperCase());
});

test("other 'I want/plan/need to' phrasings are also reframed", () => {
  const cases = [
    ["i would like to create a logistics marketplace for freight carriers.", "A logistics marketplace for freight carriers."],
    ["I plan to launch a subscription box for specialty coffee.", "A subscription box for specialty coffee."],
    ["i need to start a fintech company for cross-border payments.", "A fintech company for cross-border payments."],
  ];

  for (const [raw, expected] of cases) {
    const cleaned = sentenceCaseFirstLetter(raw.replace(leadingWantToPhrase, ""));
    assert.equal(cleaned, expected, `unexpected result for "${raw}"`);
  }
});

test("a prompt that never starts with 'I want to' is still sentence-cased, preserving its original meaning", () => {
  const raw = "an ai-powered compliance platform for financial institutions.";
  const cleaned = sentenceCaseFirstLetter(raw.replace(leadingWantToPhrase, ""));

  assert.equal(cleaned, "An ai-powered compliance platform for financial institutions.");
});

test("ReportPdfButton.tsx and Planner.tsx both apply the leading 'I want to' strip and sentence-casing (drift check, no diverging duplicate left unfixed)", () => {
  for (const [name, source] of [["ReportPdfButton.tsx", reportPdfButtonSource], ["Planner.tsx", plannerSource]]) {
    assert.match(source, /leadingWantToPhrase/, `${name} is missing the leadingWantToPhrase fix`);
    assert.match(source, /sentenceCaseFirstLetter/, `${name} is missing the sentenceCaseFirstLetter fix`);
  }
});

// --- Issue 3: source metadata formatting / omission of empty fields -----

test("Planner.tsx's citation renderer omits Publisher/Year/URL when unavailable instead of printing empty or placeholder values (the exact live bug)", () => {
  const fnMatch = /const finalDedupeSources = getFinalDedupePdfSources\(citations\);[\s\S]*?\.join\("\\n"\)\s*\)\s*\n\s*\.join\("\\n"\);/.exec(plannerSource);
  assert.ok(fnMatch, "Planner.tsx's citation source-line builder not found");
  assert.doesNotMatch(fnMatch[0], /`  Publisher: \$\{source\.publisher\}`,\n/, "Publisher is still unconditionally rendered");
  assert.doesNotMatch(fnMatch[0], /"Not specified"/, "Year still falls back to the placeholder 'Not specified'");
  assert.doesNotMatch(fnMatch[0], /"Not provided"/, "URL still falls back to the placeholder 'Not provided'");
  assert.match(fnMatch[0], /source\.publisher \? \[`  Publisher: \$\{source\.publisher\}`\] : \[\]/);
  assert.match(fnMatch[0], /source\.publicationYear \? \[`  Year: \$\{source\.publicationYear\}`\] : \[\]/);
  assert.match(fnMatch[0], /source\.url \? \[`  URL: \$\{source\.url\}`\] : \[\]/);
});

test("a citation with no publisher/year/url renders with none of those fields present (functional simulation)", () => {
  const source = { sourceName: "Industry benchmark note", sourceType: "", publisher: "", publicationYear: "", url: "", trustLabel: "" };
  const lines = [
    `• ${source.sourceName}`,
    ...(source.sourceType ? [`  Source type: ${source.sourceType}`] : []),
    ...(source.publisher ? [`  Publisher: ${source.publisher}`] : []),
    ...(source.publicationYear ? [`  Year: ${source.publicationYear}`] : []),
    ...(source.url ? [`  URL: ${source.url}`] : []),
    ...(source.trustLabel ? [`  Confidence: ${source.trustLabel}`] : []),
  ].join("\n");

  assert.doesNotMatch(lines, /Publisher:/);
  assert.doesNotMatch(lines, /Year:/);
  assert.doesNotMatch(lines, /URL:/);
  assert.doesNotMatch(lines, /Not specified/);
  assert.doesNotMatch(lines, /Not provided/);
  assert.equal(lines, "• Industry benchmark note");
});

test("a citation with real metadata still renders every present field, unchanged (no regression)", () => {
  const source = { sourceName: "AML Guidance", sourceType: "Government", publisher: "FinCEN", publicationYear: "2024", url: "https://fincen.gov/guidance", trustLabel: "High" };
  const lines = [
    `• ${source.sourceName}`,
    ...(source.sourceType ? [`  Source type: ${source.sourceType}`] : []),
    ...(source.publisher ? [`  Publisher: ${source.publisher}`] : []),
    ...(source.publicationYear ? [`  Year: ${source.publicationYear}`] : []),
    ...(source.url ? [`  URL: ${source.url}`] : []),
    ...(source.trustLabel ? [`  Confidence: ${source.trustLabel}`] : []),
  ].join("\n");

  assert.match(lines, /Publisher: FinCEN/);
  assert.match(lines, /Year: 2024/);
  assert.match(lines, /URL: https:\/\/fincen\.gov\/guidance/);
  assert.match(lines, /Confidence: High/);
});

// --- Issue 4: template artifact detection --------------------------------

test("a stray double period from broken sentence concatenation is collapsed to a single period", () => {
  const broken = "The plan should scale after the pilot completes.. Confirm results before expanding.";
  const cleaned = normalizeReportPresentationText(broken);

  assert.doesNotMatch(cleaned, /\.\./);
  assert.match(cleaned, /completes\. Confirm results/);
});

test("a genuine ellipsis is never touched by the double-period cleanup (no false positive)", () => {
  const withEllipsis = "Findings are still being validated... early signals look positive.";
  const cleaned = normalizeReportPresentationText(withEllipsis);

  assert.match(cleaned, /validated\.\.\. early signals/);
});

test("duplicated punctuation from broken template joins is collapsed", () => {
  assert.match(normalizeReportPresentationText("Confidence:: High"), /Confidence: High/);
  assert.match(normalizeReportPresentationText("This is critical!! Act now."), /critical! Act now/);
  assert.match(normalizeReportPresentationText("Really?? Yes."), /Really\? Yes/);
});

test("a stray mid-line double space from a conditional field join is collapsed to a single space", () => {
  const withDoubleSpace = "Decision:  GO";
  const cleaned = normalizeReportPresentationText(withDoubleSpace);

  assert.equal(cleaned, "Decision: GO");
});

test("intentional leading indentation under a bullet (e.g. nested Sources metadata) is never stripped by the whitespace cleanup", () => {
  const nested = "• FinCEN Guidance\n  Publisher: FinCEN\n  Year: 2024";
  const cleaned = normalizeReportPresentationText(nested);

  assert.match(cleaned, /^• FinCEN Guidance$/m);
  assert.match(cleaned, /^  Publisher: FinCEN$/m);
  assert.match(cleaned, /^  Year: 2024$/m);
});

test("report-presentation.ts wires cleanupTemplatePresentationArtifacts into normalizeReportPresentationText (drift check)", () => {
  const fnMatch = /export function normalizeReportPresentationText\([\s\S]*?\n\}/.exec(reportPresentationSource);
  assert.ok(fnMatch, "normalizeReportPresentationText not found");
  assert.match(fnMatch[0], /cleanupTemplatePresentationArtifacts/);
});

test("cleanupTemplatePresentationArtifacts never touches leading whitespace, only mid-line runs (drift check)", () => {
  const fnMatch = /function cleanupTemplatePresentationArtifacts\([\s\S]*?\n\}/.exec(reportPresentationSource);
  assert.ok(fnMatch, "cleanupTemplatePresentationArtifacts not found");
  assert.match(fnMatch[0], /\(\[\^\\s\]\)\[ \\t\]\{2,\}/, "the mid-line-only double-space collapse pattern has diverged");
});
