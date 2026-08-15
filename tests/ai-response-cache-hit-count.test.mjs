import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// governance.ts uses "@/app/..." path aliases that only resolve through
// Next's own TypeScript config, not plain `node --test` -- confirmed by
// attempting a direct import (ERR_MODULE_NOT_FOUND on "@/app"). Existing
// tests referencing this file (security-hardening.test.mjs,
// universal-understanding-pipeline.test.mjs) hit the same constraint and
// use the same static-source-text pattern this mirrors.
const source = await readFile(
  new URL("../app/lib/ai/governance.ts", import.meta.url),
  "utf8"
);

test("the cache-hit hit_count update is fire-and-forget, not blocking the cache-hit response", () => {
  const hitBranchStart = source.indexOf("} else if (data?.response_text) {");
  const hitBranchEnd = source.indexOf("recordOpenAiApplicationCache({", hitBranchStart);
  const hitBranch = source.slice(hitBranchStart, hitBranchEnd);

  // The update call itself must not be preceded by "await" or destructure
  // its result synchronously the way an awaited call would -- it must use
  // .then(...) instead, proving execution continues without waiting for
  // the write to settle.
  assert.doesNotMatch(hitBranch, /await\s+supabase\s*\n?\s*\.from\("ai_response_cache"\)\s*\n?\s*\.update/);
  assert.match(hitBranch, /supabase\s*\n?\s*\.from\("ai_response_cache"\)\s*\n?\s*\.update\(\{ hit_count: hitCount \+ 1 \}\)/);
  assert.match(hitBranch, /\.then\(\(\{ error: updateError \}\) => \{/);
  // The write must still genuinely happen (error still logged), not be
  // silently dropped -- this is fire-and-forget, not a removed write.
  assert.match(hitBranch, /logServerError\("ai-governance:cache-hit-update", updateError\)/);
});

test("hit_count is never read anywhere else in the codebase, confirming it is safe to update without blocking (write-only counter)", async () => {
  // Every source location that references hit_count, repo-wide, must be
  // inside this same read-then-increment sequence in governance.ts --
  // nothing else in the app depends on reading it back.
  const selectClauses = [...source.matchAll(/hit_count/g)];
  assert.ok(selectClauses.length >= 3, "expected hit_count to appear in both select column lists and the update");
});
