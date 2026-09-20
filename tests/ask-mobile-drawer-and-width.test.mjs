import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const chat = read("components/AIChatWorkspace.tsx");
const panel = read("components/chat/AdvisorProfilePanel.tsx");
const shared = read("components/chat/advisor-profile-types.ts");

// The <aside> is BOTH the desktop sidebar and the mobile drawer -- one element,
// two roles, switched at md. Everything about drawer contents hangs on that.
const aside = chat.slice(chat.indexOf("<aside"), chat.indexOf("</aside>"));
const askColumn = chat.slice(chat.indexOf("</aside>"));
// Comments explain why the panel is absent, so they mention it by name.
const askColumnCode = askColumn.replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

test("the mobile drawer contains navigation and sessions only, never the profile form", () => {
  // The regression: the Advisor Profile form was written inline inside the
  // aside, so opening the hamburger on a phone showed the whole preferences
  // form (Country / market, Budget ranges, Risk...) under the session list.
  assert.doesNotMatch(aside, /Country \/ market/, "the form's fields must not be inline in the drawer");
  assert.doesNotMatch(aside, /Budget ranges/);
  assert.doesNotMatch(aside, /Preferred industries/);

  // It may still appear in the aside for the DESKTOP sidebar, but only behind
  // a breakpoint that excludes the drawer.
  const sidebarSlot = aside.slice(aside.indexOf("<AdvisorProfilePanel") - 400, aside.indexOf("<AdvisorProfilePanel"));
  assert.match(sidebarSlot, /className="hidden md:block"/, "the sidebar slot must be md and up only");

  // The navigation the drawer DOES own is untouched.
  for (const kept of [/New advisory session/, /AI Plan/, /Market Analysis/, /Search advisory sessions/]) {
    assert.match(aside, kept, "drawer navigation must be preserved");
  }
});

test("the profile panel has one implementation and one state owner", () => {
  // Not duplicated: a single component, rendered into a slot per breakpoint,
  // with every value passed in. No local state of its own.
  assert.equal(
    (chat.match(/<AdvisorProfilePanel/g) || []).length,
    1,
    "exactly one slot: the desktop sidebar"
  );
  assert.doesNotMatch(panel, /useState|useReducer/, "the panel must not own state");
  assert.match(panel, /export default function AdvisorProfilePanel/);

  // The state still lives in the workspace, so both slots read the same values.
  for (const state of [/const \[profile, setProfile\]/, /const \[profileDraft, setProfileDraft\]/, /const \[profileOpen, setProfileOpen\]/]) {
    assert.match(chat, state);
  }

  // The only slot is the desktop sidebar one.
  assert.match(chat, /className="hidden md:block"/);
});

test("Advisor Profile is not rendered anywhere on the mobile Ask screen", () => {
  // Below md there are exactly two places it could show: the drawer (the
  // aside) and the Ask content column. It must be in neither -- the drawer
  // because navigation is not main content, the column because the feature is
  // moving to Account. The ONLY slot is `hidden md:block` inside the aside,
  // which is display:none below md, so nothing is rendered on a phone.
  assert.doesNotMatch(askColumnCode, /<AdvisorProfilePanel/, "not in the Ask content column");
  assert.doesNotMatch(askColumnCode, /Advisor Profile/, "no collapsed card either");

  const slotContext = chat.slice(chat.indexOf("<AdvisorProfilePanel") - 400, chat.indexOf("<AdvisorProfilePanel"));
  assert.match(slotContext, /className="hidden md:block"/);
  assert.ok(
    chat.indexOf("<AdvisorProfilePanel") < chat.indexOf("</aside>"),
    "the single slot lives in the aside, behind an md-and-up breakpoint"
  );
  // No mobile-visible slot may reappear.
  assert.doesNotMatch(chat, /md:hidden[^>]*>\s*<AdvisorProfilePanel/);

  // The feature itself is intact -- state, save path and data model untouched.
  assert.match(chat, /const \[profile, setProfile\] = useState<ChatProfile>/);
  assert.match(chat, /saveProfile/);
  assert.ok(read("components/chat/AdvisorProfilePanel.tsx").length > 0);
});

test("the drawer can never be wider than the viewport", () => {
  // min() clamps it to the viewport minus a gutter, so it cannot introduce
  // horizontal overflow on a narrow phone.
  assert.match(aside, /w-\[min\(20rem,calc\(100vw-1\.25rem\)\)\]/);
  assert.match(aside, /\bfixed inset-y-0 left-0\b/, "below md it is out of flow");
  assert.match(aside, /md:static md:w-80/, "from md up it is a real sidebar");
  // Closed, it translates off-canvas to the LEFT, which creates no scrollable
  // area in a left-to-right document.
  assert.match(chat, /sidebarOpen \? "translate-x-0" : "-translate-x-full"/);
});

test("nothing in Ask can push the document wider than the viewport", () => {
  // The shell hides its own overflow, so no in-flow descendant can create a
  // horizontal scroll region...
  const shell = chat.slice(chat.indexOf("<main"), chat.indexOf("<aside"));
  assert.match(shell, /overflow-hidden/);
  // ...and the content column can shrink, which is what stops a wide child
  // (a long token, a table) from widening the flex row instead.
  assert.match(chat, /<section className="relative flex min-h-0 min-w-0 flex-1 flex-col">/);

  // No viewport-width or fixed-pixel widths anywhere in the screen.
  assert.doesNotMatch(chat, /(?<![\w-])w-screen\b/);
  // (?<![\w-]) so this does not match inside "min-w-[520px]", which is a
  // deliberate table width and is boxed in its own scroller below.
  assert.doesNotMatch(chat, /className="[^"]*(?<![\w-])w-\[\d+px\]/);
  assert.doesNotMatch(panel, /(?<![\w-])w-screen\b/);

  // The one wide element (a markdown table) is boxed in its own scroller.
  const table = chat.slice(chat.lastIndexOf("<div", chat.indexOf('min-w-[520px]')), chat.indexOf('min-w-[520px]'));
  assert.match(table, /max-w-full overflow-x-auto/, "wide tables must scroll inside their own box");
});

test("the Ask content column stays independently scrollable and correctly sized", () => {
  assert.match(chat, /className="relative z-10 min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 sm:px-6"/);
  // One scroll owner in the column: the message list, with the composer as a
  // shrink-0 sibling below it. Nothing else splits or steals the scroll.
  assert.match(chat, /shrink-0 border-t border-white\/10 bg-black\/80/);
  // The composer's textarea scrolls its own text, which is not a layout
  // scroller; the column itself must have exactly one.
  assert.equal(
    (askColumnCode.match(/flex-1 overflow-y-auto/g) || []).length,
    1,
    "exactly one layout scroll owner in the Ask content column"
  );
});

test("the shared profile module is importable from both sides", () => {
  // Plain types and pure helpers, no "use client", so the workspace and the
  // panel can both take them without a module-boundary surprise.
  assert.doesNotMatch(shared, /^\s*["']use client["']/);
  for (const name of ["ChatProfile", "hasProfileContent", "parseList", "formatList"]) {
    assert.match(shared, new RegExp(`export (?:type |function )${name}`));
  }
  assert.doesNotMatch(chat, /^function (?:parseList|formatList|hasProfileContent)\(/m, "no second copy in the workspace");
});
