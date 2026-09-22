import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const chat = read("components/AIChatWorkspace.tsx");
const route = read("app/api/chat/route.ts");
const vercelConfig = JSON.parse(read("vercel.json"));
const poolerUrl = (() => {
  try {
    return read("supabase/.temp/pooler-url");
  } catch {
    return "";
  }
})();

const readLoop = chat.slice(
  chat.indexOf("async function readStreamingText"),
  chat.indexOf("async function sendMessage")
);

test("streaming repaints are coalesced to one per frame, not one per chunk", () => {
  // Painting every chunk was quadratic: sanitizeAiResponseText rescans the
  // whole accumulated answer and the React update re-parses the entire
  // markdown message, both growing with the reply. A long answer paid that
  // hundreds of times, each more expensive than the last.
  assert.match(readLoop, /requestAnimationFrame\(paint\)/);
  assert.match(readLoop, /cancelAnimationFrame/);

  // The expensive call must NOT sit directly in the read loop any more.
  const loopBody = readLoop.slice(readLoop.indexOf("while (true)"));
  assert.doesNotMatch(
    loopBody,
    /onChunk\(sanitizeAiResponseText\(output\)\)/,
    "the per-chunk full-text sanitize + setState is the regression"
  );
  // Exactly one scheduled paint can be outstanding.
  assert.match(readLoop, /if \(paintHandle === null\) \{\s*paintHandle = requestAnimationFrame/);
});

test("batching never delays or loses the final answer", () => {
  // A pending frame is cancelled and the exact final text flushed, so the
  // completed message is never a frame-stale copy.
  assert.match(readLoop, /cancelPendingPaint\(\);\s*output \+= decoder\.decode\(\);/);
  assert.match(readLoop, /const sanitizedOutput = sanitizeAiResponseText\(output\);\s*onChunk\(sanitizedOutput\);/);
  // Stream errors still abort immediately, per chunk, before any paint.
  assert.match(readLoop, /if \(streamError !== null\) \{\s*cancelPendingPaint\(\);\s*throw new Error\(streamError\)/);
});

test("non-browser runtimes keep the original synchronous behaviour", () => {
  // No rAF (tests, SSR, older runtimes) means paint immediately -- the batching
  // is an optimisation, never a correctness dependency.
  assert.match(readLoop, /typeof requestAnimationFrame === "function"/);
  assert.match(readLoop, /if \(!canSchedulePaint\) \{\s*paint\(\);/);
});

test("mobile shows one waiting state: the answer card, and nothing in the composer", () => {
  const stopAt = chat.indexOf("onClick={stopGeneration}");
  const composer = chat.slice(stopAt - 400, stopAt + 1800);
  // Comments describe the removed UI, so compare against code only.
  const chatCode = chat.replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

  // The answer card is the single generation indicator, and within it only
  // one element is ever visible at a time (see the dedicated test below).
  assert.match(chat, /\{message\.regenerating \? "Regenerating" : "Generating"\}/);

  // The composer shows no second spinner and no second generation label.
  assert.doesNotMatch(chatCode, /Advising\.\.\./);
  assert.doesNotMatch(composer, /loading \? <Loader2/);

  // Stop is hidden on phones; the composer is simply disabled while streaming.
  assert.match(composer, /onClick=\{stopGeneration\}/);
  assert.match(composer, /className="hidden min-h-12[^"]*md:inline-flex"/);
  assert.doesNotMatch(
    composer,
    /className="inline-flex min-h-12[^"]*"\s*>\s*<Square/,
    "Stop must never render unconditionally on mobile"
  );

  // The send button stays mounted and is disabled for the duration.
  assert.match(composer, /disabled=\{\s*loading \|\|/);
  assert.match(composer, /Ask advisor/);
  assert.match(composer, /!prompt\.trim\(\)/);
  assert.match(composer, /attachments\.some\(\(attachment\) => attachment\.status !== "ready"\)/);
});

test("the research snapshot no longer blocks the first token", () => {
  // It is a snapshot of context the model already has; nothing in this request
  // reads it back, so awaiting it before the model call only cost a database
  // round trip of first-token latency.
  assert.match(route, /import \{ NextResponse, after \} from "next\/server";/);
  assert.match(route, /after\(async \(\) => \{[\s\S]*?storeConversationResearchSnapshot\(researchSnapshot\)/);

  // ...and it must still actually run, with its failure logged, not swallowed.
  assert.match(route, /logServerError\("chat:research_snapshot", snapshotError\)/);

  // No blocking await may come back.
  const beforeModel = route.slice(0, route.indexOf('mark("prep")'));
  assert.doesNotMatch(
    beforeModel,
    /await storeConversationResearchSnapshot\(\{/,
    "the snapshot write must not be awaited on the critical path"
  );
});

test("the server reports its own share of first-token latency", () => {
  // Cumulative marks, emitted as Server-Timing on the streamed response, so
  // the pre-model cost can be read from a device Network tab rather than
  // inferred. Measurement only: nothing branches on these.
  for (const phase of ["auth", "profile", "memory", "ratelimit", "research_start", "prep"]) {
    assert.match(route, new RegExp(`mark\\("${phase}"\\)`), `${phase} must be marked`);
  }
  assert.match(route, /"Server-Timing": Object\.entries\(timings\)/);
  assert.match(route, /`\$\{phase\};dur=\$\{duration\}`/);

  // The anti-buffering headers that make progressive delivery possible stay.
  assert.match(route, /"Cache-Control": "no-cache, no-transform"/);
  assert.match(route, /"X-Accel-Buffering": "no"/);
});

test("user-keyed reads start before the work that does not depend on them", () => {
  // The profile read is issued as soon as the user is known and awaited at its
  // original call site, so its round trip overlaps the body parse and the
  // beta-access authorization instead of queueing behind them.
  assert.match(route, /const profileQuery = supabase\s*\n\s*\.from\("ai_chat_profiles"\)/);
  assert.match(route, /const \{ data: profileData, error: profileError \} = await profileQuery;/);
  assert.ok(
    route.indexOf("const profileQuery") < route.indexOf("const body = await req.json()"),
    "the profile read must be in flight before the body is parsed"
  );

  // The user-memory read starts early too, but ONLY when no memory write has
  // to happen first -- a turn that writes memories still reads after writing.
  assert.match(
    route,
    /const memoriesQuery =\s*\n\s*memoryOperations\.length === 0 \? loadUserMemoriesForUser\(supabase, user\) : null;/
  );
  assert.match(route, /memoriesQuery\s*\n\s*\? await memoriesQuery\s*\n\s*: await loadUserMemoriesForUser\(/);
  assert.match(route, /memoryApplyResult\.fallbackMemories/, "the write-then-read path is unchanged");
});

test("research is measured, and its Fast-mode cost is visible rather than silently skipped", () => {
  // webResearch is decided from the prompt alone, not from modelPreference, so
  // a Fast-mode request can still run the whole pipeline before the first
  // token. Skipping it would change what the model is grounded on, so it is
  // measured here, not disabled.
  assert.match(route, /mark\("research_start"\)/);
  assert.match(route, /const webResearch = shouldUseAnalysisWebResearch\(prompt, attachments\);/);
  assert.doesNotMatch(
    route,
    /webResearch = [^;]*modelPreference/,
    "gating research on Fast mode is an answer-quality decision, not a silent optimisation"
  );
});

test("serverless functions are co-located with the database region", () => {
  // Measured on a physical iPhone: prep was 1746ms for about five sequential
  // Supabase round trips -- 240-600ms each, where a co-located single-row
  // indexed select is 10-50ms. The cause was distance, not work: Vercel
  // defaults to iad1 (US East) and this project's database is in eu-central-1
  // (Frankfurt), so every query crossed the Atlantic twice.
  //
  // Next's preferredRegion is not an option here: on Vercel it is only honoured
  // with runtime = "edge", and this route needs Node (Supabase service client,
  // OpenAI SDK). vercel.json regions applies to Node serverless functions.
  assert.deepEqual(vercelConfig.regions, ["fra1"], "functions must run beside the database");

  // Pinned to what the repo itself records about where the database lives, so
  // the two cannot drift apart silently.
  if (poolerUrl) {
    assert.match(poolerUrl, /aws-0-eu-central-1/, "database region changed -- revisit vercel.json regions");
  }

  // The cron entry must survive the edit.
  assert.equal(vercelConfig.crons?.[0]?.path, "/api/report-jobs/worker");
});

test("auth is unchanged: the session is still verified against Supabase", () => {
  // Replacing getUser() with local JWT verification would remove a 325ms round
  // trip but weaken revocation -- a revoked session would stay valid until the
  // token expired. Latency work must not buy speed with that.
  assert.match(route, /await supabase\.auth\.getUser\(\)/);
  assert.doesNotMatch(route, /getClaims\(|jwtVerify\(|decodeJwt\(/);
});

test("exactly one loading element is on screen at a time", () => {
  // The regression: before the first token the header badge said "Thinking"
  // AND the big TypingIndicator card said "AI is thinking" directly below it --
  // two spinners, one line apart, for the same wait.
  //
  // The two now render on strictly inverse conditions, so they can never
  // overlap: the card while there is no content, the badge only once there is.
  assert.match(
    chat,
    /message\.status === "streaming" && !message\.content \? \(\s*<TypingIndicator \/>/,
    "the big card owns the pre-stream wait"
  );
  assert.match(
    chat,
    /\{message\.status === "streaming" && message\.content \? \(/,
    "the header badge must require content"
  );

  // The badge can no longer say "Thinking" -- that wording belongs to the card,
  // and reaching it would mean the two conditions had drifted back together.
  const badge = chat.slice(
    chat.indexOf('{message.status === "streaming" && message.content ? ('),
    chat.indexOf('{message.status === "streaming" && message.content ? (') + 500
  );
  assert.doesNotMatch(badge, /"Thinking"/);
  assert.match(badge, /"Regenerating"/);
  assert.match(badge, /"Generating"/);

  // The big card keeps its own copy and remains the single pre-stream state.
  assert.match(chat, /<p className="text-sm font-semibold text-white">AI is thinking<\/p>/);
  assert.equal((chat.match(/<TypingIndicator \/>/g) || []).length, 1);

  // And Stop stays gone from mobile.
  assert.match(chat, /className="hidden min-h-12[^"]*md:inline-flex"/);
});
