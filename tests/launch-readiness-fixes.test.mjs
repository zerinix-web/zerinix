import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

test("report_jobs migration is fully idempotent (table, indexes, trigger, policies)", () => {
  const source = read("supabase/migrations/20260731120000_create_report_jobs.sql");

  assert.match(source, /create table if not exists public\.report_jobs/);

  for (const indexName of [
    "report_jobs_user_created_at_idx",
    "report_jobs_status_next_attempt_at_idx",
    "report_jobs_lease_expires_at_idx",
    "report_jobs_idempotency_key_idx",
    "report_jobs_report_id_idx",
  ]) {
    assert.match(
      source,
      new RegExp(`create index if not exists ${indexName}`),
      `${indexName} must use "if not exists"`
    );
  }
  assert.match(
    source,
    /create unique index if not exists report_jobs_active_user_idempotency_key_idx/
  );

  assert.match(
    source,
    /drop trigger if exists set_report_jobs_updated_at on public\.report_jobs;\s*create trigger set_report_jobs_updated_at/
  );

  for (const policyName of [
    "Users can insert own queued report jobs",
    "Users can read own report jobs",
    "Users can cancel own pending report jobs",
  ]) {
    assert.match(
      source,
      new RegExp(
        `drop policy if exists "${policyName}" on public\\.report_jobs;\\s*create policy "${policyName}"`
      ),
      `${policyName} must be dropped before being re-created`
    );
  }
});

test("icon-only remove-attachment buttons meet a minimum touch-target size", () => {
  // 24px (h-6 w-6) was below the ~32px+ practical minimum for a touch
  // target; Planner.tsx and MobileConversationExperience.tsx were
  // bumped to 32px (h-8 w-8) for consistency with AIChatWorkspace.tsx,
  // which already used the equivalent min-h-8/min-w-8 (32px).
  const plannerSource = read("components/Planner.tsx");
  assert.match(
    plannerSource,
    /aria-label=\{`Remove \$\{attachment\.name\}`\}\s*className="flex h-8 w-8 items-center justify-center rounded-full/
  );
  assert.doesNotMatch(plannerSource, /Remove \$\{attachment\.name\}`\}\s*className="flex h-6 w-6/);

  const mobileComposerSource = read("components/planner/MobileConversationExperience.tsx");
  assert.match(
    mobileComposerSource,
    /aria-label=\{`Remove \$\{attachment\.name\}`\}\s*className="flex h-8 w-8 items-center justify-center rounded-full/
  );
  assert.doesNotMatch(mobileComposerSource, /Remove \$\{attachment\.name\}`\}\s*className="flex h-6 w-6/);

  const chatWorkspaceSource = read("components/AIChatWorkspace.tsx");
  assert.match(chatWorkspaceSource, /className="min-h-8 min-w-8 rounded-full p-1/);
});

test("previously unlabeled select/search controls now have a visible focus indicator", () => {
  const workspaceManager = read("app/dashboard/WorkspaceManager.tsx");
  assert.match(workspaceManager, /focus-visible:ring-2 focus-visible:ring-teal-200\/30/);

  const chatWorkspace = read("components/AIChatWorkspace.tsx");
  assert.match(
    chatWorkspace,
    /aria-label="Select advisor response mode"|focus-visible:ring-2 focus-visible:ring-teal-200\/30/
  );
  // Both the advisor-mode select and the session-search input must carry
  // a focus ring; count occurrences rather than anchoring to exact
  // surrounding text, since both live in the same file.
  const focusRingCount = (chatWorkspace.match(/focus-(visible|within):ring-2 focus-(visible|within):ring-teal-200\/30/g) || []).length;
  assert.ok(focusRingCount >= 2, "expected focus rings on both the advisor-mode select and the search input");

  const planner = read("components/Planner.tsx");
  assert.match(planner, /focus-within:ring-2 focus-within:ring-teal-200\/30/);
});
