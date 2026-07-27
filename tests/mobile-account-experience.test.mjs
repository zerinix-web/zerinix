import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const pageSource = await readFile(
  new URL("../app/dashboard/settings/page.tsx", import.meta.url),
  "utf8"
);
const mobileSource = await readFile(
  new URL("../components/mobile/MobileAccountHome.tsx", import.meta.url),
  "utf8"
);
const loadingSource = await readFile(
  new URL("../app/dashboard/settings/loading.tsx", import.meta.url),
  "utf8"
);
const reportDataSource = await readFile(
  new URL("../app/dashboard/report-utils.ts", import.meta.url),
  "utf8"
);

test("settings route isolates Account home to mobile and preserves desktop settings", () => {
  assert.match(pageSource, /<MobileAccountHome/);
  assert.match(pageSource, /className="flex-1 lg:hidden"/);
  assert.match(
    pageSource,
    /className="hidden flex-1 px-5 pt-6 pb-28 sm:px-8 lg:block/
  );
  assert.match(pageSource, /<form action=\{updateProfileSettings\}/);
  assert.match(pageSource, /<form action=\{updatePassword\}/);
});

test("mobile Account renders profile, plan, usage, settings, and support", () => {
  for (const label of [
    "Account",
    "Current plan",
    "AI credits remaining",
    "Reports",
    "AI usage",
    "Research",
    "Profile settings",
    "Notifications",
    "Language",
    "Security",
    "Help",
    "Contact support",
    "Terms",
    "Privacy",
  ]) {
    assert.match(mobileSource, new RegExp(label));
  }

  assert.match(mobileSource, /settings\.avatarUrl/);
  assert.match(mobileSource, /settings\.email/);
  assert.match(mobileSource, /billing\.usage\.remaining\.aiChats/);
  assert.match(mobileSource, /Research[\s\S]*not enabled/);
});

test("mobile Account includes safe loading, empty, and partial-error states", () => {
  assert.match(
    mobileSource,
    /Some usage details are temporarily unavailable/
  );
  assert.match(
    mobileSource,
    /Your account activity will appear here after your first/
  );
  assert.match(mobileSource, /env\(safe-area-inset-bottom\)/);
  assert.match(loadingSource, /mobile-account-usage/);
  assert.match(loadingSource, /animate-pulse/);
  assert.match(loadingSource, /env\(safe-area-inset-bottom\)/);
});

test("report usage uses an ownership-scoped count instead of loading report bodies", () => {
  const countLoader = reportDataSource.slice(
    reportDataSource.indexOf("export async function loadUserReportCount"),
    reportDataSource.indexOf("export async function loadWorkspaceReports")
  );

  assert.match(
    countLoader,
    /\.select\("id", \{ count: "exact", head: true \}\)/
  );
  assert.match(countLoader, /\.eq\("user_id", user\.id\)/);
  assert.doesNotMatch(countLoader, /sections|metadata|prompt/);
});
