import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const pageSource = await readFile(
  new URL("../app/dashboard/reports/page.tsx", import.meta.url),
  "utf8"
);
const mobileSource = await readFile(
  new URL("../components/mobile/MobileReportsHome.tsx", import.meta.url),
  "utf8"
);
const reportDataSource = await readFile(
  new URL("../app/dashboard/report-utils.ts", import.meta.url),
  "utf8"
);
const loadingSource = await readFile(
  new URL("../app/dashboard/reports/loading.tsx", import.meta.url),
  "utf8"
);

test("reports route isolates the new library to mobile and preserves the desktop manager", () => {
  assert.match(pageSource, /<MobileReportsHome reports=\{reports\}/);
  assert.match(pageSource, /className="flex-1 lg:hidden"/);
  assert.match(
    pageSource,
    /className="hidden flex-1 px-4 pb-28 pt-5 sm:px-8 lg:block/
  );
  assert.match(
    pageSource,
    /<ReportManager reports=\{desktopReports\} workspaceName="All reports" \/>/
  );
});

test("mobile report library covers populated, empty, filtered, and error states", () => {
  assert.match(mobileSource, /Your strategic insights and business analyses/);
  assert.match(mobileSource, /No reports yet/);
  assert.match(
    mobileSource,
    /Generate your first strategic report from a conversation\./
  );
  assert.match(mobileSource, /No matching reports/);
  assert.match(mobileSource, /Reports are temporarily unavailable/);
  assert.match(mobileSource, /href=\{`\/dashboard\/\$\{report\.id\}`\}/);
  assert.match(
    mobileSource,
    /href=\{`\/dashboard\/\$\{report\.id\}`\}\s+prefetch=\{false\}/
  );
  assert.match(mobileSource, /\{report\.confidence\}% confidence/);
});

test("mobile search and filters use only title and report type", () => {
  assert.match(
    mobileSource,
    /report\.title\.toLowerCase\(\)\.includes\(normalizedQuery\)/
  );
  assert.match(
    mobileSource,
    /report\.type\.toLowerCase\(\)\.includes\(normalizedQuery\)/
  );
  assert.match(mobileSource, /"All"/);
  assert.match(mobileSource, /"Business Plan"/);
  assert.match(mobileSource, /"Market Analysis"/);
  assert.match(mobileSource, /"Strategic Report"/);
});

test("report list query excludes heavy sections and has a mobile skeleton", () => {
  const previewLoader = reportDataSource.slice(
    reportDataSource.indexOf("export async function loadUserReportPreviews"),
    reportDataSource.indexOf("export async function loadWorkspaceReports")
  );

  assert.match(
    previewLoader,
    /id,user_id,workspace_id,title,prompt,report_type,status,created_at,metadata/
  );
  assert.doesNotMatch(previewLoader, /\.select\([^)]*sections/);
  assert.match(loadingSource, /animate-pulse/);
  assert.match(loadingSource, /env\(safe-area-inset-bottom\)/);
});
