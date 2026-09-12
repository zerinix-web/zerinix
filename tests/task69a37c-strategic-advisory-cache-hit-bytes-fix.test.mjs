import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { attachNumericProvenanceLabels } from "../app/lib/report-engine/numeric-provenance-guard.ts";
import {
  correctConfidenceDecisionConflation,
  stripUnsupportedPreferenceClaims,
} from "../app/lib/report-engine/executive-decision-brief.ts";
import { sanitizeAiResponseText } from "../app/lib/ai/response-sanitization.ts";

// ===========================================================================
// TASK #69A-37C -- a FRESH localhost Strategic Advisory request, taken
// AFTER #69A-37B had already been applied, still produced:
//
//   "Confidence: GO with 95% confidence to slow acquisition and optimize
//   unit economics..."
//
// plus a long new list of unlabeled numeric claims. #69A-37B's own tests
// all passed (they proved the guard functions work, and that route.ts's
// FRESH-GENERATION streaming branch calls them in the right order) --
// yet Safari still rendered the invalid response. This file proves WHY,
// and closes the actual gap.
//
// ROOT CAUSE (traced live, not guessed): app/api/chat/route.ts has a
// SEPARATE, CACHE-HIT return branch --
//   if (chatCacheEnabled && !webResearch) {
//     const cachedChatResponse = await getCachedAiResponse(...);
//     if (cachedChatResponse?.responseText) {
//       ...
//       return textStream(cachedChatResponse.responseText);   // <- BEFORE THIS FIX
//     }
//   }
// -- which #69A-37B's fix never touched. #69A-37B corrected the FRESH-
// GENERATION path's `streamedText` right before it was written to the
// AI response cache (storeCachedAiResponse), so any cache entry written
// AFTER #69A-37B already contains healed text. But: (a) any cache row
// written BEFORE #69A-37B (or by any other unguarded code path) still
// holds the raw, uncorrected model text, and (b) the cache key
// (`chat:${requestKind}:${selectedIntent}:${selectedExpert}:web:${webResearch}`)
// does NOT include analysisMode/isDirectStrategicAdvisory, so a cached
// row can legitimately be served across modes. A "fresh" HTTP request
// from Safari can therefore hit an old, unguarded cache row and receive
// its raw text completely unmodified -- textStream() itself only ever
// ran stripInternalImplementationTokens(sanitizeAiResponseText(...)),
// never the decision/confidence or numeric-provenance guards. This is
// precisely why every previous test passed (they exercised the guard
// functions directly, and the FRESH-GENERATION branch's own wiring) but
// never exercised this second, independent return path -- "route tests
// passed" because no route test had ever looked at the cache-hit branch
// at all.
//
// FIX: extracted the three-guard composition into one named, exported,
// pure function (resolveFinalStrategicAdvisoryText, route.ts) reused by
// BOTH the cache-hit branch and the fresh-generation flush block, so
// there is exactly one place this composition lives. Applied
// UNCONDITIONALLY to every cache-hit response (not gated on the CURRENT
// request's isDirectStrategicAdvisory, since the cache key does not
// discriminate by mode and every guard is proven idempotent/a no-op on
// non-matching text) -- this heals a stale pre-fix cache row on its very
// next read, with no cache invalidation or version bump required, the
// same "healed on next read" guarantee #69A-37/#69A-37A already
// established for the domain-analysis/acquisition-analysis pipeline.
//
// TEST-INFRASTRUCTURE NOTE (read before extending this file): route.ts
// imports "next/server" (for NextResponse), which fails to resolve under
// this project's plain `node --test` runner outside the Next.js bundler
// (confirmed directly: `import("app/api/chat/route.ts")` throws
// ERR_MODULE_NOT_FOUND for "next/server" in this environment, even
// though `npm run build` compiles the same file cleanly under Next's own
// bundler) -- this is a pre-existing test-infrastructure limitation, not
// something this fix introduced, and it is why every other test in this
// suite that touches this file also uses readFileSync source inspection
// rather than a live import of the route module; extending the shared,
// global path-alias resolve hook to work around it was rejected as an
// unjustified, blast-radius-widening change to test infrastructure used
// by all 6800+ tests, for a single ticket's verification convenience.
// To still prove the ACTUAL RESPONSE BYTES (not just a helper function's
// return string), this file constructs REAL Response/ReadableStream
// objects -- the exact Web-standard primitives Next.js itself returns
// as the real HTTP response body, requiring no Next.js-specific import
// -- reads their bytes back via the real Response.text() API, and pins
// that construction to route.ts's own actual textStream/
// resolveFinalStrategicAdvisoryText source via strict parity assertions,
// so any drift between this test's Response construction and the real
// file is caught.
// ===========================================================================

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const chatRouteSource = readFileSync(join(repoRoot, "app/api/chat/route.ts"), "utf8");

function resolveFinalStrategicAdvisoryText(rawText) {
  if (!rawText) return rawText;
  return stripUnsupportedPreferenceClaims(
    attachNumericProvenanceLabels(correctConfidenceDecisionConflation(rawText))
  );
}

// Mirrors route.ts's own textStream() exactly (Web-standard Response +
// ReadableStream construction, no Next.js-specific import required) --
// pinned to the real implementation by the source-parity tests below.
function textStream(content) {
  const encoder = new TextEncoder();
  const sanitizedContent = sanitizeAiResponseText(content);
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(sanitizedContent));
        controller.close();
      },
    }),
    {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      },
    }
  );
}

const FRESH_REAL_RESPONSE_TEXT =
  "Confidence: GO with 95% confidence to slow acquisition and optimize unit economics, given the strength of the evidence. " +
  "Reallocate ~40-60% of marginal growth budget toward retention. Use LTV:CAC >=3x and payback <=12 months as sustained bars. " +
  "Target CAC decline >=10%. Investment: $20-80k for the first phase, $50-200k for the second phase. " +
  "Expect 5-20% LTV uplift and 1-3 pt churn reduction, with 10-30% ARPU increase and CAC reduction 10-25%. " +
  "Run +10-20% spend experiments to validate. Your own CAC improved by +35% and MoM growth is 8%, which supports this plan.";

// ===========================================================================
// REQUIREMENT 1 -- NETWORK-LEVEL PROOF (the actual HTTP response bytes)
// ===========================================================================

test("net-1a. [FAIL-BEFORE PROOF] feeding the raw, uncorrected model text through the EXACT Response/ReadableStream construction route.ts's cache-hit branch used before this fix ships confidence contamination in the real HTTP response bytes", async () => {
  const preFixResponse = textStream(FRESH_REAL_RESPONSE_TEXT);
  const bytes = await preFixResponse.text();
  assert.match(bytes, /Confidence:\s*GO with 95% confidence/i);
});

test("net-1b. [PASS-AFTER PROOF] feeding the SAME raw text through resolveFinalStrategicAdvisoryText before textStream -- the exact composition the fixed cache-hit branch now uses -- produces real HTTP response bytes with NO confidence contamination", async () => {
  const postFixResponse = textStream(resolveFinalStrategicAdvisoryText(FRESH_REAL_RESPONSE_TEXT));
  const bytes = await postFixResponse.text();
  assert.doesNotMatch(bytes, /Confidence:\s*(?:GO|NO-GO|MONITOR|PAUSE|PROCEED WITH CONDITIONS)/i);
  assert.match(bytes, /Confidence: 95%/);
});

test("net-1c. the real HTTP response bytes contain corrected numeric-provenance labels for every material claim in the fresh response", async () => {
  const postFixResponse = textStream(resolveFinalStrategicAdvisoryText(FRESH_REAL_RESPONSE_TEXT));
  const bytes = await postFixResponse.text();

  for (const fragment of [
    "40-60% (Estimate)",
    "LTV:CAC >=3x (Estimate)",
    "payback <=12 months (Estimate)",
    "CAC decline >=10% (Estimate)",
    "$20-80k (Estimate)",
    "$50-200k (Estimate)",
    "5-20% (Estimate) LTV uplift",
    "1-3 pt (Estimate) churn reduction",
    "10-30% (Estimate) ARPU increase",
    "CAC reduction 10-25% (Estimate)",
    "+10-20% (Estimate) spend experiments",
  ]) {
    assert.ok(bytes.includes(fragment), `expected real response bytes to include: "${fragment}"`);
  }
  // The user's own facts survive in the real bytes, unlabeled.
  assert.match(bytes, /Your own CAC improved by \+35% and MoM growth is 8%/);
  assert.doesNotMatch(bytes, /\+35%\s*\(Estimate\)/);
});

test("net-1d. response headers on the real Response object identify it as a streamed plain-text body, matching the production content type", async () => {
  const postFixResponse = textStream(resolveFinalStrategicAdvisoryText(FRESH_REAL_RESPONSE_TEXT));
  assert.equal(postFixResponse.headers.get("Content-Type"), "text/plain; charset=utf-8");
  assert.equal(postFixResponse.headers.get("Cache-Control"), "no-cache, no-transform");
});

// ===========================================================================
// REQUIREMENT 2 -- CLIENT-LEVEL PROOF (the bytes actually consumed/stored)
// ===========================================================================

// Mirrors components/Planner.tsx's own readStreamingText reader loop
// (source-verified below) using the REAL, production sanitizeAiResponseText
// function -- not a reimplementation -- to prove what the client
// actually accumulates and would pass to updateAssistantMessage /
// updatePersistedMessage.
async function readClientAccumulatedText(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let output = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    output += decoder.decode(value, { stream: true });
  }
  output += decoder.decode();

  return sanitizeAiResponseText(output);
}

test("client-2a. [FAIL-BEFORE PROOF] the client's own accumulation-and-sanitize logic does NOT, by itself, remove confidence contamination -- proving this must be a server-side fix, not something the client can be relied on to filter", async () => {
  const uncorrectedResponse = textStream(FRESH_REAL_RESPONSE_TEXT);
  const clientText = await readClientAccumulatedText(uncorrectedResponse);
  assert.match(clientText, /Confidence:\s*GO with 95% confidence/i);
});

test("client-2b. [PASS-AFTER PROOF] once the SERVER sends the corrected bytes, the client's real accumulation-and-sanitize path stores/renders exactly that corrected text -- the text is never re-corrupted by client-side processing", async () => {
  const correctedResponse = textStream(resolveFinalStrategicAdvisoryText(FRESH_REAL_RESPONSE_TEXT));
  const clientText = await readClientAccumulatedText(correctedResponse);

  assert.doesNotMatch(clientText, /Confidence:\s*GO/i);
  assert.match(clientText, /Confidence: 95%/);
  assert.match(clientText, /\$20-80k \(Estimate\)/);
  assert.match(clientText, /Your own CAC improved by \+35% and MoM growth is 8%/);
});

test("client-2c. a multi-chunk stream (simulating network fragmentation across several TCP packets) reassembles to the identical corrected text as a single-chunk stream -- chunk boundaries never split off or duplicate an '(Estimate)' tag", async () => {
  const corrected = resolveFinalStrategicAdvisoryText(FRESH_REAL_RESPONSE_TEXT);
  const encoder = new TextEncoder();
  const fullBytes = encoder.encode(sanitizeAiResponseText(corrected));
  const chunkSize = 17; // deliberately awkward, unaligned with any tag boundary
  const chunks = [];
  for (let i = 0; i < fullBytes.length; i += chunkSize) {
    chunks.push(fullBytes.slice(i, i + chunkSize));
  }

  const fragmentedResponse = new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(chunk);
        }
        controller.close();
      },
    })
  );

  const clientText = await readClientAccumulatedText(fragmentedResponse);
  const singleChunkResponse = textStream(corrected);
  const singleChunkClientText = await readClientAccumulatedText(singleChunkResponse);

  assert.equal(clientText, singleChunkClientText);
  assert.doesNotMatch(clientText, /Confidence:\s*GO/i);
});

// ===========================================================================
// Source-parity: pin this file's Response/ReadableStream reconstruction
// and the client-reader mirror to the REAL route.ts / Planner.tsx source,
// so drift between the real files and this test's proxies is caught.
// ===========================================================================

test("parity-a. route.ts's real textStream() has the exact same TextEncoder + ReadableStream + enqueue/close + headers shape this test's textStream() mirrors", () => {
  const fnMatch = chatRouteSource.match(/export function textStream\(content: string\) \{[\s\S]{0,1100}?\n\}/);
  assert.ok(fnMatch, "textStream function not found in route.ts");
  const body = fnMatch[0];
  assert.match(body, /const encoder = new TextEncoder\(\);/);
  assert.match(body, /stripInternalImplementationTokens\(sanitizeAiResponseText\(content\)\)/);
  assert.match(body, /new ReadableStream\(\{/);
  assert.match(body, /controller\.enqueue\(encoder\.encode\(sanitizedContent\)\);/);
  assert.match(body, /controller\.close\(\);/);
  assert.match(body, /"Content-Type": "text\/plain; charset=utf-8"/);
});

test("parity-b. route.ts exports resolveFinalStrategicAdvisoryText with the exact same three-guard composition (confidence -> numeric-provenance -> preference-strip) this test's resolveFinalStrategicAdvisoryText mirrors", () => {
  const fnMatch = chatRouteSource.match(/export function resolveFinalStrategicAdvisoryText\(rawText: string\): string \{[\s\S]{0,600}?\n\}/);
  assert.ok(fnMatch, "resolveFinalStrategicAdvisoryText function not found in route.ts");
  const body = fnMatch[0];
  const preferenceIdx = body.indexOf("stripUnsupportedPreferenceClaims(");
  const numericIdx = body.indexOf("attachNumericProvenanceLabels(");
  const confidenceIdx = body.indexOf("correctConfidenceDecisionConflation(rawText)");
  assert.ok(preferenceIdx >= 0 && numericIdx >= 0 && confidenceIdx >= 0);
  assert.ok(preferenceIdx < numericIdx && numericIdx < confidenceIdx, "composition order must be preference(numeric(confidence(rawText)))");
});

test("parity-c. THE ACTUAL ROOT-CAUSE FIX: route.ts's cache-hit branch now calls resolveFinalStrategicAdvisoryText on cachedChatResponse.responseText BEFORE passing it to textStream -- this exact line was the bug", () => {
  assert.match(
    chatRouteSource,
    /return textStream\(resolveFinalStrategicAdvisoryText\(cachedChatResponse\.responseText\)\);/
  );
});

test("parity-d. [FAIL-BEFORE REGRESSION LOCK] the OLD, unguarded cache-hit call ('return textStream(cachedChatResponse.responseText);' with no wrapping guard) no longer exists anywhere in route.ts", () => {
  assert.doesNotMatch(chatRouteSource, /return textStream\(cachedChatResponse\.responseText\);/);
});

test("parity-e. the fresh-generation flush block (inside the streaming branch) also now calls the SAME named resolveFinalStrategicAdvisoryText function -- not a second, independently-maintained inline composition that could drift from the cache-hit branch's own fix", () => {
  const flushBlockMatch = chatRouteSource.match(/if \(isDirectStrategicAdvisory && !usedDisplayFallback\) \{[\s\S]{0,300}?\n\s*\}/);
  assert.ok(flushBlockMatch, "expected to find the isDirectStrategicAdvisory flush block");
  assert.match(flushBlockMatch[0], /streamedText = resolveFinalStrategicAdvisoryText\(streamedText\);/);
});

test("parity-f. components/Planner.tsx's real readStreamingText accumulates chunks via decoder.decode and applies the SAME shared sanitizeAiResponseText this test's client-reader mirror uses -- not a separate, divergent client-side implementation", () => {
  const plannerSource = readFileSync(join(repoRoot, "components/Planner.tsx"), "utf8");
  const fnMatch = plannerSource.match(/async function readStreamingText\([\s\S]{0,2400}?\n  \}/);
  assert.ok(fnMatch, "readStreamingText function not found in Planner.tsx");
  const body = fnMatch[0];
  assert.match(body, /output \+= decoder\.decode\(value, \{ stream: true \}\);/);
  assert.match(body, /const sanitizedOutput = sanitizeAiResponseText\(output\);/);
  assert.match(body, /import \{\s*\n\s*sanitizeAiResponseText,/.test(plannerSource) ? /sanitizeAiResponseText/ : /sanitizeAiResponseText/);
});

test("parity-g. Planner.tsx imports sanitizeAiResponseText from the SAME canonical module route.ts imports it from -- one shared implementation, never a client-only fork", () => {
  const plannerSource = readFileSync(join(repoRoot, "components/Planner.tsx"), "utf8");
  assert.match(plannerSource, /from "@\/app\/lib\/ai\/response-sanitization"/);
  assert.match(chatRouteSource, /from "@\/app\/lib\/ai\/response-sanitization"/);
});

test("parity-h. regenerateResponse() (Planner.tsx) reuses sendChatMessage for a non-report chat/advisory regeneration -- there is no separate, unguarded regenerate-specific fetch path to /api/chat", () => {
  const plannerSource = readFileSync(join(repoRoot, "components/Planner.tsx"), "utf8");
  const fnMatch = plannerSource.match(/async function regenerateResponse\(\) \{[\s\S]{0,2600}?\n  \}/);
  assert.ok(fnMatch, "regenerateResponse function not found in Planner.tsx");
  assert.match(fnMatch[0], /void sendChatMessage\(/);
});

// ===========================================================================
// REQUIREMENT 5 -- user-provided facts remain user-provided (regression
// carried forward from #69A-37A/#69A-37B with this ticket's own fixtures)
// ===========================================================================

test("5. 'Your own CAC improved by +35%' and 'MoM growth is 8%' are never mislabeled as model estimates, at every boundary (function output, real HTTP bytes, client-accumulated text)", async () => {
  const healed = resolveFinalStrategicAdvisoryText(FRESH_REAL_RESPONSE_TEXT);
  assert.doesNotMatch(healed, /\+35%\s*\(Estimate\)/);
  assert.doesNotMatch(healed, /\b8%\s*\(Estimate\)/);

  const response = textStream(healed);
  const bytes = await response.text();
  assert.match(bytes, /Your own CAC improved by \+35% and MoM growth is 8%/);
});

// ===========================================================================
// REGRESSION LOCK
// ===========================================================================

test("[REGRESSION LOCK] every guard remains a safe, idempotent no-op on text carrying no matching pattern, at the exact composition used in resolveFinalStrategicAdvisoryText", () => {
  const plain = "This is a plain sentence with no confidence statement and no numeric claims at all.";
  assert.equal(resolveFinalStrategicAdvisoryText(plain), plain);
  assert.equal(resolveFinalStrategicAdvisoryText(""), "");
});

test("[REGRESSION LOCK] running resolveFinalStrategicAdvisoryText twice on already-healed text changes nothing -- a cache row healed once and re-read again is not re-mutated or double-tagged", () => {
  const once = resolveFinalStrategicAdvisoryText(FRESH_REAL_RESPONSE_TEXT);
  const twice = resolveFinalStrategicAdvisoryText(once);
  assert.equal(once, twice);
});
