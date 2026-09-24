import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildChatConfidenceInstruction,
  parseChatConfidenceCeiling,
  CHAT_CONFIDENCE_CEILING_HEADER,
  capChatConfidenceToEvidence,
  normalizeChatConfidencePrecision,
  resolveChatConfidenceCeiling,
} from "@/app/lib/ai/chat-confidence-standard";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const route = read("app/api/chat/route.ts");
const workspace = read("components/AIChatWorkspace.tsx");

const NONE = { verifiedSources: false, userSpecificData: false };
const SOURCES_ONLY = { verifiedSources: true, userSpecificData: false };
const USER_DATA_ONLY = { verifiedSources: false, userSpecificData: true };
const BOTH = { verifiedSources: true, userSpecificData: true };

test("a broad prompt with weak evidence cannot produce unsupported 95% confidence", () => {
  // The exact production output that prompted this work.
  const produced = "Decision: GO — 95% confidence.";
  const normalized = normalizeChatConfidencePrecision(produced);

  assert.doesNotMatch(normalized, /95\s*%/);
  assert.doesNotMatch(normalized, /\d\s*%\s*confidence/i);
  assert.match(normalized, /GO/, "the recommendation itself survives");

  // ...and with no evidence the band is capped as well.
  const capped = capChatConfidenceToEvidence(normalized, resolveChatConfidenceCeiling(NONE));
  assert.doesNotMatch(capped, /High/i);
  assert.match(capped, /low confidence/i);
});

test("unsupported percentage confidence is normalized, in every phrasing", () => {
  const cases = [
    ["Confidence: 95%", /Confidence: Moderate/],
    ["Confidence level — 87 %", /Confidence: Moderate/],
    ["Confidence: (92%)", /Confidence: Moderate/],
    ["I recommend proceeding with 90% confidence.", /with moderate confidence/],
    ["This is a 35% confidence call.", /low confidence/],
  ];

  for (const [input, expected] of cases) {
    const output = normalizeChatConfidencePrecision(input);
    assert.match(output, expected, `failed for: ${input}`);
    assert.doesNotMatch(output, /\d\s*%/, `percentage survived: ${input}`);
  }

  // A percentage can never become "High": a number the model invented is not
  // evidence of high certainty.
  assert.doesNotMatch(normalizeChatConfidencePrecision("Confidence: 99%"), /High/i);

  // Unrelated percentages are untouched.
  const unrelated = "Margins fell 12% and churn rose 3% last quarter.";
  assert.equal(normalizeChatConfidencePrecision(unrelated), unrelated);
  // Text with no percentage at all comes back byte-identical.
  const plain = "Decision: GO\nConfidence: Moderate";
  assert.equal(normalizeChatConfidencePrecision(plain), plain);
});

test("GO can coexist with Moderate confidence", () => {
  // Recommendation strength and confidence are independent: the cap touches
  // only the confidence, never the decision.
  const text = "Decision: GO\nConfidence: High\n\nWhy: the direction is clear.";
  const capped = capChatConfidenceToEvidence(text, "Moderate");

  assert.match(capped, /Decision: GO/, "the recommendation is never weakened");
  assert.match(capped, /Confidence: Moderate/);
  assert.doesNotMatch(capped, /Confidence: High/);

  // A firm NO-GO on thin evidence is equally valid.
  const noGo = capChatConfidenceToEvidence("Decision: NO-GO\nConfidence: High", "Low");
  assert.match(noGo, /Decision: NO-GO/);
  assert.match(noGo, /Confidence: Low/);
});

test("High confidence requires stronger evidence conditions", () => {
  assert.equal(resolveChatConfidenceCeiling(NONE), "Low");
  assert.equal(resolveChatConfidenceCeiling(SOURCES_ONLY), "Moderate");
  assert.equal(resolveChatConfidenceCeiling(USER_DATA_ONLY), "Moderate");
  assert.equal(resolveChatConfidenceCeiling(BOTH), "High");

  // The cap lowers, never raises: a cautious model stays cautious.
  assert.match(capChatConfidenceToEvidence("Confidence: Low", "High"), /Confidence: Low/);
  assert.match(capChatConfidenceToEvidence("Confidence: Moderate", "High"), /Confidence: Moderate/);
  // "Medium" is treated as Moderate rather than ignored.
  assert.match(capChatConfidenceToEvidence("Confidence: Medium", "Low"), /Confidence: Low/);
});

test("Fast and Balanced use the same confidence standard", () => {
  // Mode is not an input to any of it -- only evidence is. Comments discuss
  // Balanced by name to explain exactly that, so compare against code only.
  const standardCode = read("app/lib/ai/chat-confidence-standard.ts")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(standardCode, /modelPreference/i);
  assert.doesNotMatch(standardCode, /"balanced"|"fast"/i);

  // The route derives evidence from facts, never from the mode.
  // chatResearchContext is only ever set inside `if (webResearch)`, so
  // webResearch alone is a sufficient proxy -- and it is available early
  // enough to compute the ceiling before the cache lookup returns.
  assert.match(
    route,
    /const confidenceEvidence: ChatConfidenceEvidence = \{\s*\n\s*verifiedSources: webResearch,\s*\n\s*userSpecificData:\s*\n?\s*attachments\.length > 0 \|\| Boolean\(reportMemory\) \|\| Boolean\(profileContext\),/
  );
  const evidenceBlock = route.slice(
    route.indexOf("const confidenceEvidence"),
    route.indexOf("const confidenceCeiling")
  );
  assert.doesNotMatch(evidenceBlock, /modelPreference/);
});

test("prompt guidance and deterministic validation are both present", () => {
  // Prompt-only would drift; validation-only would fight the model.
  assert.match(route, /buildChatConfidenceInstruction\(confidenceEvidence\)/);
  assert.match(route, /normalizeChatConfidencePrecision\(rawText\)/);
  assert.match(route, /capChatConfidenceToEvidence\(\s*normalizeChatConfidencePrecision\(streamedText\),\s*confidenceCeiling\s*\)/);

  const instruction = buildChatConfidenceInstruction(NONE);
  assert.match(instruction, /Never state a confidence percentage/);
  assert.match(instruction, /SEPARATE/);
  assert.match(instruction, /must not exceed Low/);
  assert.match(buildChatConfidenceInstruction(BOTH), /must not exceed High/);
  // Names the evidence it actually has, rather than hedging generically.
  assert.match(buildChatConfidenceInstruction(SOURCES_ONLY), /verified external sources/);
  // It bans disclaimer walls rather than adding one.
  assert.match(instruction, /Do not add generic disclaimers/);
});

test("streaming output remains valid and is normalized as it paints", () => {
  // Every painted frame goes through the transform, so invented precision
  // never reaches the screen -- and the final flush matches what was rendered.
  assert.match(workspace, /onChunk\(applyConfidenceStandard\(sanitizeAiResponseText\(latestOutput\)\)\)/);
  assert.match(workspace, /const sanitizedOutput = applyConfidenceStandard\(/);

  // Safe on partial text: an incomplete number cannot match.
  for (const partial of ["Confidence: 9", "Decision: GO — 9", "Confidence: "]) {
    assert.equal(normalizeChatConfidencePrecision(partial), partial);
  }
  // Idempotent, so repainting the same frame cannot compound.
  const once = normalizeChatConfidencePrecision("Confidence: 95%");
  assert.equal(normalizeChatConfidencePrecision(once), once);

  // The streaming machinery itself is untouched.
  assert.match(workspace, /requestAnimationFrame\(paint\)/);
  assert.match(workspace, /cancelPendingPaint\(\);\s*output \+= decoder\.decode\(\);/);
});

test("the report engine's own evidence-backed confidence is untouched", () => {
  // It computes real, source-derived scores; stripping percentages there would
  // destroy a deliberate design. The chat standard is deliberately separate.
  const sanitizer = read("app/lib/ai/response-sanitization.ts");
  assert.doesNotMatch(sanitizer, /normalizeChatConfidencePrecision/);
  assert.match(read("app/lib/report-engine/market-intelligence-presentation.ts"), /confidence >= 65/);
});

test("unsupported High confidence cannot reach the user DURING the live stream", () => {
  // THE GAP THIS CLOSES. Percentages were already normalised per frame, but the
  // client could not cap a stated BAND -- it did not know the evidence -- so a
  // model that wrote "Confidence: High" against instructions rendered as High
  // live and was only corrected later in the cache. That is exactly the
  // "display now, fix afterwards" behaviour the standard must not have.
  //
  // The ceiling now travels in a response header, which arrives BEFORE the
  // first body byte, so the very first painted frame is already capped.
  assert.match(route, new RegExp(`\\[CHAT_CONFIDENCE_CEILING_HEADER\\]: confidenceCeiling`));
  assert.equal(
    (route.match(/\[CHAT_CONFIDENCE_CEILING_HEADER\]: confidenceCeiling/g) || []).length,
    2,
    "both the streaming response and textStream must send it"
  );

  // The client reads it before touching the body...
  const readLoop = workspace.slice(
    workspace.indexOf("async function readStreamingText"),
    workspace.indexOf("async function sendMessage")
  );
  assert.ok(
    readLoop.indexOf("parseChatConfidenceCeiling") < readLoop.indexOf("response.body.getReader()"),
    "the ceiling must be read before the stream starts"
  );
  // ...and applies BOTH the precision normaliser and the band cap per frame.
  assert.match(
    readLoop,
    /const applyConfidenceStandard = \(text: string\) =>\s*\n\s*capChatConfidenceToEvidence\(\s*\n\s*normalizeChatConfidencePrecision\(text\),\s*\n\s*confidenceCeiling\s*\n\s*\);/
  );
  assert.match(readLoop, /onChunk\(applyConfidenceStandard\(sanitizeAiResponseText\(latestOutput\)\)\)/);
  assert.match(readLoop, /const sanitizedOutput = applyConfidenceStandard\(sanitizeAiResponseText\(output\)\);/);

  // Simulating the frames a stream actually paints: no frame may show High.
  const frames = [
    "Decision: GO",
    "Decision: GO\nConfidence: Hi",
    "Decision: GO\nConfidence: High",
    "Decision: GO\nConfidence: High\n\nWhy: the direction is clear.",
  ];
  for (const frame of frames) {
    const painted = capChatConfidenceToEvidence(
      normalizeChatConfidencePrecision(frame),
      "Low"
    );
    assert.doesNotMatch(painted, /Confidence: High/, `High leaked in frame: ${frame}`);
  }
  // The recommendation is never weakened by any of it.
  assert.match(
    capChatConfidenceToEvidence("Decision: GO\nConfidence: High", "Low"),
    /Decision: GO/
  );
});

test("an absent or unknown ceiling header fails safe", () => {
  // Unknown evidence is limited evidence, and limited evidence cannot be High.
  assert.equal(parseChatConfidenceCeiling(null), "Moderate");
  assert.equal(parseChatConfidenceCeiling(undefined), "Moderate");
  assert.equal(parseChatConfidenceCeiling(""), "Moderate");
  assert.equal(parseChatConfidenceCeiling("Very High"), "Moderate");
  // Valid values pass through exactly.
  assert.equal(parseChatConfidenceCeiling("Low"), "Low");
  assert.equal(parseChatConfidenceCeiling("Moderate"), "Moderate");
  assert.equal(parseChatConfidenceCeiling("High"), "High");
  assert.equal(CHAT_CONFIDENCE_CEILING_HEADER, "X-Zerinix-Confidence-Ceiling");
});

test("capping per frame does not buffer the stream or slow it", () => {
  // Still one repaint per animation frame, still no accumulation before
  // painting: the standard is two pure string transforms on text the frame was
  // already going to sanitise.
  const readLoop = workspace.slice(
    workspace.indexOf("async function readStreamingText"),
    workspace.indexOf("async function sendMessage")
  );
  assert.match(readLoop, /requestAnimationFrame\(paint\)/);
  assert.match(readLoop, /latestOutput = output;\s*\n\s*schedulePaint\(\);/);
  assert.doesNotMatch(readLoop, /await new Promise\(\s*\(resolve\) => setTimeout/);
  // No whole-response buffering was introduced on the server either.
  assert.match(route, /const shouldStreamLiveDeltas = !isDirectStrategicAdvisory;/);
});
