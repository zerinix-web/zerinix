import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const home = read("components/mobile/MobileHomeDashboard.tsx");
const dashboardPage = read("app/dashboard/page.tsx");
const homeSections = read("components/mobile/MobileHomeSections.tsx");

test("mobile Home is a dashboard, not a second AI chat entry point", () => {
  assert.match(dashboardPage, /<MobileHomeDashboard/);
  assert.doesNotMatch(dashboardPage, /MobileChatHome/);
  assert.equal(
    existsSync(new URL("../components/mobile/MobileChatHome.tsx", import.meta.url)),
    false,
    "the superseded Home chat component must not linger as dead code"
  );

  // No composer, no chat transport, no conversation persistence on Home.
  for (const forbidden of [/<textarea/, /\/api\/chat/, /ai_conversations/, /ai_messages/]) {
    assert.doesNotMatch(home, forbidden);
  }
  assert.doesNotMatch(home, /Ask anything about your business/);
  assert.doesNotMatch(home, /What do you want to accomplish today/);
});

test("Home header drops the redundant profile affordance", () => {
  assert.match(home, /ZERINIX/);
  // Account lives in the bottom navigation; the old header button only
  // duplicated it (plus a link to the screen the user was already on).
  assert.doesNotMatch(home, /account menu/i);
  assert.doesNotMatch(home, /UserRound/);
  assert.doesNotMatch(home, /SignOutButton/);
});

test("the three analysis capabilities link to existing planner routes", () => {
  assert.match(home, /"Business Idea Validation"/);
  assert.match(home, /"Market Intelligence"/);
  assert.match(home, /"Strategic Advisory"/);
  assert.match(home, /href: "\/plan\?new=1&mode=plan"/);
  assert.match(home, /href: "\/plan\?new=1&mode=market"/);
  // app/plan/page.tsx preseeds only "plan" and "market", so Strategic
  // Advisory must not claim a mode parameter that does nothing.
  assert.match(home, /href: "\/plan\?new=1"/);
  assert.doesNotMatch(home, /mode=chat/);
});

test("Home reuses the existing real-data sections and invents no metrics", () => {
  assert.match(home, /<RecentProjectsSection workspaces=\{workspaces\}/);
  assert.match(home, /<ContinueActivitySection reports=\{recentReports\}/);
  assert.match(homeSections, /export function RecentProjectsSection/);
  assert.match(homeSections, /export function ContinueActivitySection/);

  // Counts arrive as props derived from already-loaded data.
  assert.match(dashboardPage, /completedReports=\{completedReports\}/);
  assert.match(dashboardPage, /reportsNeedingAttention=\{reportsNeedingAttention\}/);
  assert.match(
    dashboardPage,
    /const reportsNeedingAttention = reports\.filter\(\s*\(report\) => report\.status\.toLowerCase\(\) !== "completed"\s*\)\.length;/
  );

  // Mockup-only content that no real data backs must not appear.
  for (const fabricated of [/In Progress/, /Good afternoon/, /Your impact/, /AI conversations/]) {
    assert.doesNotMatch(home, fabricated);
  }
  // Every metric is rendered from a prop, never a literal.
  assert.doesNotMatch(home, /value=\{\s*\d/);
});

test("metrics and calls to action are omitted when there is nothing real to show", () => {
  assert.match(home, /projectCount > 0 \? \(/);
  assert.match(home, /completedReports > 0 \? \(/);
  assert.match(home, /reportsNeedingAttention > 0 \? \(/);
  // "View priorities" only renders when reports actually need attention,
  // and points at a route that exists.
  assert.match(home, /View priorities/);
  assert.match(home, /href="\/dashboard\/reports"/);
  assert.match(home, /No analyses yet/);
});

test("Home scrolls naturally and clears the bottom navigation exactly once", () => {
  // Nav clearance comes from the shared constant the navigation exports, so
  // the reserved height can never drift from the bar it reserves for.
  assert.match(home, /MOBILE_NAV_CLEARANCE/);
  assert.match(home, /pt-\[max\(0\.6rem,env\(safe-area-inset-top\)\)\]/);

  // Natural document scrolling: no fixed-height shell, no inner scroller.
  // (`overflow-hidden` on the line-clamped card text is unrelated layout.)
  assert.doesNotMatch(home, /h-\[100dvh\]/);
  assert.doesNotMatch(home, /min-h-\[100svh\]/);
  assert.doesNotMatch(home, /overflow-y-auto/);

  // No spacer elements, negative margins, or hardcoded device offsets.
  assert.doesNotMatch(home, /<div className="pb-\[calc\([^"]*\)\]" \/>/);
  assert.doesNotMatch(home, /className="[^"]*\s-m[btlrxy]?-/);
  // Spacing and positioning must never be a hardcoded device offset.
  // (Typography such as text-[11px] is unrelated and allowed.)
  assert.doesNotMatch(home, /(?:p[btlrxy]?|m[btlrxy]?|top|bottom|inset)-\[\d+(?:\.\d+)?px\]/);

  // Home never restates the bottom inset inline; it comes from the shared
  // constant, and the navigation owns its own.
  assert.equal((home.match(/safe-area-inset-bottom/g) || []).length, 0);
});
