import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  applyChatOutputBudgetPreference,
  createChatResponseCapabilities,
  createChatResponseVerbosity,
} from "@/app/lib/ai/chat-request-config";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const route = read("app/api/chat/route.ts");
const workspace = read("components/AIChatWorkspace.tsx");

test("Fast uses low reasoning effort", () => {
  assert.equal(createChatResponseCapabilities(false, "fast").reasoning.effort, "low");
  assert.equal(createChatResponseCapabilities(true, "fast").reasoning.effort, "low");
  // Fast is the default for anything unspecified, so an absent or unknown
  // preference can never silently buy the more expensive mode.
  assert.equal(createChatResponseCapabilities(false).reasoning.effort, "low");
  assert.equal(createChatResponseVerbosity(), "low");
  assert.equal(applyChatOutputBudgetPreference(3200), 3200);
});

test("Balanced uses medium reasoning effort", () => {
  assert.equal(createChatResponseCapabilities(false, "balanced").reasoning.effort, "medium");
  assert.equal(createChatResponseCapabilities(true, "balanced").reasoning.effort, "medium");

  // Effort stops at medium: high/xhigh multiply reasoning tokens, which bill as
  // output, and push latency towards the client's own 75s request timeout.
  for (const webSearch of [false, true]) {
    for (const preference of ["fast", "balanced"]) {
      assert.ok(
        ["low", "medium"].includes(
          createChatResponseCapabilities(webSearch, preference).reasoning.effort
        )
      );
    }
  }
});

test("Balanced has the intended larger output budget", () => {
  // ~1.5x, and Fast's own budget is untouched.
  for (const base of [900, 3000, 3200, 3500]) {
    assert.equal(applyChatOutputBudgetPreference(base, "fast"), base);
    assert.equal(applyChatOutputBudgetPreference(base, "balanced"), Math.round(base * 1.5));
  }

  // Verbosity rises with the budget, never on its own: more verbosity on the
  // same budget truncates, and truncation starts the continuation loop, which
  // is slower and dearer than allowing the tokens up front.
  assert.equal(createChatResponseVerbosity("balanced"), "medium");
  assert.match(route, /text: \{ verbosity: createChatResponseVerbosity\(modelPreference\) \}/);
  assert.match(
    route,
    /applyChatOutputBudgetPreference\(\s*getChatMaxOutputTokens\(requestKind\),\s*modelPreference\s*\)/
  );
});

test("both modes retain web research, differing only in depth", () => {
  // Whether search runs is decided upstream and is NOT affected by the mode:
  // both ground an answer whenever grounding is needed.
  for (const preference of ["fast", "balanced"]) {
    const withSearch = createChatResponseCapabilities(true, preference);
    assert.ok("tools" in withSearch, `${preference} must keep web search available`);
    assert.equal(withSearch.tools[0].type, "web_search_preview");
    assert.deepEqual(withSearch.include, ["web_search_call.action.sources"]);
    assert.equal("tools" in createChatResponseCapabilities(false, preference), false);
  }

  assert.equal(createChatResponseCapabilities(true, "fast").tools[0].search_context_size, "low");
  assert.equal(createChatResponseCapabilities(true, "balanced").tools[0].search_context_size, "medium");

  // The trigger itself is untouched, and still not gated on the preference.
  assert.match(route, /const webResearch = shouldUseAnalysisWebResearch\(prompt, attachments\);/);
  assert.doesNotMatch(route, /webResearch = [^;]*modelPreference/);
});

test("memory, context and security behaviour are unchanged by the mode", () => {
  // Nothing about identity, grounding or context may branch on the preference.
  for (const guard of [
    /await supabase\.auth\.getUser\(\)/,
    /const reportAccess = await authorizeStrategicReportAccess\(/,
    /loadUserMemoriesForUser\(/,
    /const instructionsText = \[/,
    /checkAiProductionRateLimit\(/,
  ]) {
    assert.match(route, guard);
  }

  // The instructions are built identically for both modes.
  const instructions = route.slice(
    route.indexOf("const instructionsText = ["),
    route.indexOf("const instructionsText = [") + 4000
  );
  assert.doesNotMatch(instructions, /modelPreference/);

  // Model routing is untouched: the router remains the only authority.
  assert.doesNotMatch(route, /routedModel[^;]*modelPreference/);
  assert.match(read("app/lib/ai/chat-request-config.ts"), /model selection stays with the router/);
});

test("Fast and Balanced cannot share cached results", () => {
  // THE CORRECTNESS RISK. The two modes produce materially different answers,
  // so a key without the mode would serve whichever ran first to the other.
  assert.match(
    route,
    /mode: `chat:\$\{requestKind\}:\$\{selectedIntent\}:\$\{selectedExpert\}:web:\$\{webResearch\}:mode:\$\{modelPreference\}`/
  );

  // Telemetry still identifies the mode, on every recorded path.
  assert.ok(
    (route.match(/model_preference: modelPreference/g) || []).length >= 4,
    "every usage record must carry the mode"
  );
});

test("mobile Ask, keyboard and scroll fixes remain protected", () => {
  // None of this work may be disturbed by the mode split.
  assert.match(workspace, /const mobileKeyboardOpen =\s*\n\s*mobileKeyboardViewportHeight !== null \|\| mobileComposerFocused;/);
  assert.match(workspace, /root\.classList\.toggle\("zx-keyboard-open", mobileKeyboardOpen\);/);
  assert.match(workspace, /\$\{\s*mobileKeyboardOpen \? "" : MOBILE_NAV_CLEARANCE\s*\}/);
  assert.match(workspace, /\{mobileKeyboardOpen \? null : <MobileBottomNavigation \/>\}/);
  assert.match(read("app/globals.css"), /html\.zx-keyboard-open,/);
  assert.match(workspace, /const freshConversationId = useMemo\(\(\) => createMessageId\(\), \[\]\);/);
  assert.match(workspace, /className="hidden min-h-12[^"]*md:inline-flex"/);
});

test("the mode descriptions describe what actually happens", () => {
  // No promises about speed or quality beyond what the parameters deliver.
  assert.match(workspace, /label: "Fast",\s*\n\s*description: "Quick guidance",/);
  assert.match(workspace, /label: "Balanced",\s*\n\s*description: "Deeper analysis",/);
  assert.doesNotMatch(workspace, /Low-latency answers|Deeper reasoning/);
  // The selection still reaches the backend.
  assert.match(workspace, /modelPreference,/);
  assert.match(route, /const modelPreference = body\?\.modelPreference === "balanced" \? "balanced" : "fast";/);
});
