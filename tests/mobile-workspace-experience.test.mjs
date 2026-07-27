import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const listPageSource = await readFile(
  new URL("../app/dashboard/workspaces/page.tsx", import.meta.url),
  "utf8"
);
const detailPageSource = await readFile(
  new URL("../app/dashboard/workspaces/[id]/page.tsx", import.meta.url),
  "utf8"
);
const homeSource = await readFile(
  new URL("../components/mobile/MobileWorkspaceHome.tsx", import.meta.url),
  "utf8"
);
const detailSource = await readFile(
  new URL("../components/mobile/MobileWorkspaceDetail.tsx", import.meta.url),
  "utf8"
);
const reportDataSource = await readFile(
  new URL("../app/dashboard/report-utils.ts", import.meta.url),
  "utf8"
);
const listLoadingSource = await readFile(
  new URL("../app/dashboard/workspaces/loading.tsx", import.meta.url),
  "utf8"
);
const detailLoadingSource = await readFile(
  new URL("../app/dashboard/workspaces/[id]/loading.tsx", import.meta.url),
  "utf8"
);

test("workspace routes isolate the new experience to mobile and preserve desktop managers", () => {
  assert.match(listPageSource, /<MobileWorkspaceHome/);
  assert.match(listPageSource, /className="flex-1 lg:hidden"/);
  assert.match(
    listPageSource,
    /className="hidden flex-1 px-4 pb-28 pt-5 sm:px-8 lg:block/
  );
  assert.match(listPageSource, /<WorkspaceManager workspaces=\{workspaces\} \/>/);

  assert.match(detailPageSource, /<MobileWorkspaceDetail/);
  assert.match(detailPageSource, /className="flex-1 lg:hidden"/);
  assert.match(detailPageSource, /<ReportManager/);
});

test("mobile workspace home covers cards, creation, empty, and error states", () => {
  for (const label of [
    "Workspaces",
    "Last activity",
    "Open",
    "No workspace yet",
    "Create your first workspace to organize strategic analysis.",
    "Create Workspace",
    "Workspaces are temporarily unavailable",
  ]) {
    assert.match(homeSource, new RegExp(label));
  }

  assert.match(homeSource, /action=\{createWorkspace\}/);
  assert.match(homeSource, /workspace\.reportCount/);
  assert.match(
    homeSource,
    /href=\{`\/dashboard\/workspaces\/\$\{workspace\.id\}`\}\s+prefetch=\{false\}/
  );
});

test("mobile detail shows workspace information, reports, conversations, and back navigation", () => {
  assert.match(detailSource, /href="\/dashboard\/workspaces"/);
  assert.match(detailSource, /Workspace information/);
  assert.match(detailSource, /Recent reports/);
  assert.match(detailSource, /Recent conversations/);
  assert.match(detailSource, /Conversation history is currently account-level/);
  assert.match(detailSource, /No reports in this workspace/);
  assert.match(detailSource, /No recent conversations/);
  assert.match(detailSource, /env\(safe-area-inset-bottom\)/);
});

test("workspace list stays lightweight and detail data loads only on the opened route", () => {
  const workspaceListLoader = reportDataSource.slice(
    reportDataSource.indexOf("export async function loadUserWorkspaces"),
    reportDataSource.indexOf("export async function loadUserReports")
  );

  assert.match(workspaceListLoader, /reports\(id\)/);
  assert.doesNotMatch(workspaceListLoader, /sections|metadata|prompt/);
  assert.doesNotMatch(listPageSource, /loadWorkspaceReports/);
  assert.match(detailPageSource, /loadWorkspaceReports\(supabase, user, id\)/);
  assert.match(detailPageSource, /\.select\("id,title,updated_at"\)/);
  assert.match(detailPageSource, /\.eq\("user_id", user\.id\)/);
  assert.match(detailPageSource, /\.limit\(4\)/);
});

test("workspace list and detail routes provide mobile skeletons", () => {
  assert.match(listLoadingSource, /animate-pulse/);
  assert.match(listLoadingSource, /env\(safe-area-inset-bottom\)/);
  assert.match(detailLoadingSource, /animate-pulse/);
  assert.match(detailLoadingSource, /env\(safe-area-inset-bottom\)/);
});
