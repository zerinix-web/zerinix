import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// The 60-second IP/user checkRateLimit gates in these three files used to
// return "Daily AI usage limit reached..." on a plain short-window burst
// block -- misleading, since it's not a daily quota at that layer (the real
// daily/monthly quota lives in governance.ts's checkUsageAllowance, gated
// separately deeper in the pipeline via checkAiProductionRateLimit, and
// still legitimately uses that daily message). This proves the short-window
// call sites now say something accurate, and that the real daily-quota
// message elsewhere is untouched.
const shortWindowRateLimitFiles = [
  "app/api/plan/route.ts",
  "app/lib/report-jobs/plan-executor.ts",
  "app/api/market-analysis/route.ts",
];

test("60-second IP/user rate-limit responses no longer claim a daily limit was hit", () => {
  for (const file of shortWindowRateLimitFiles) {
    const source = readFileSync(file, "utf8");
    assert.ok(
      !source.includes("Daily AI usage limit reached"),
      `${file} should no longer contain the misleading daily-limit message`
    );
    assert.ok(
      source.includes("Too many requests. Please wait a moment and try again."),
      `${file} should contain the accurate short-window rate-limit message`
    );
  }
});

test("the real, Supabase-backed daily/monthly quota message is untouched", () => {
  const governance = readFileSync("app/lib/ai/governance.ts", "utf8");
  assert.match(
    governance,
    /dailyAiLimitMessage =\s*\n?\s*"Daily AI usage limit reached\. Please try again tomorrow or upgrade your plan\."/
  );
});
