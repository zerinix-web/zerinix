// Decision Engine V2 -- reliable structured shadow-comparison log.
//
// PROBLEM THIS FIXES: shadow-mode.ts already logged a full comparison
// via logOperationalInfo(scope, metadata), but the Next.js dev logger
// silently drops the metadata (second) argument of console.info when
// writing to .next/dev/logs/next-development.log -- confirmed live
// during E2E testing ("[decision-engine-v2] shadow comparison {}").
// This is a general Next.js/Turbopack tooling limitation affecting
// every logOperationalInfo call in the codebase, not specific to
// Decision Engine V2, and it is out of scope to fix in the shared
// logger. Instead, this module gives shadow-mode a SECOND, reliable
// sink that never passes through that pipeline at all.
//
// SAFETY (PHASE 6): written only when shouldLogOperationalInfo() is
// true (dev, or ZERINIX_VERBOSE_LOGS=true) -- the exact same gate the
// existing console log already uses -- so this never attempts a
// filesystem write on a real production deployment. Every write is
// wrapped in try/catch and is best-effort: a failed write is silently
// swallowed and never affects the request that produced it. Nothing
// here makes a new AI, search, or database call.
//
// Lives under .next/ (already covered by "/.next/" in .gitignore) so
// these diagnostic files are never accidentally committed or confused
// with tracked source.

import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sanitizeMetadata, shouldLogOperationalInfo } from "@/app/lib/security/logging";

const SHADOW_LOG_DIR = join(process.cwd(), ".next", "decision-engine-v2");
const SHADOW_LOG_FILE = join(SHADOW_LOG_DIR, "shadow-comparisons.jsonl");

export function shadowComparisonLogPath(): string {
  return SHADOW_LOG_FILE;
}

// One JSON object per line (JSONL) so the file can be inspected with
// simple line-based tools (tail, grep, node --print) and appended to
// concurrently across requests without needing to parse/rewrite the
// whole file.
export function recordShadowComparisonToDisk(entry: Record<string, unknown>): void {
  if (!shouldLogOperationalInfo()) return;

  try {
    mkdirSync(SHADOW_LOG_DIR, { recursive: true });
    const sanitized = sanitizeMetadata(entry);
    const line = JSON.stringify({ loggedAt: new Date().toISOString(), ...sanitized });
    appendFileSync(SHADOW_LOG_FILE, `${line}\n`, "utf8");
  } catch {
    // Best-effort only -- a diagnostics-logging failure must never
    // affect the production request path (PHASE 6).
  }
}

// Reads back every entry written so far -- used by the controlled
// comparison script/tests to analyze results without re-parsing
// truncated console output.
export function readShadowComparisonLog(): Record<string, unknown>[] {
  try {
    const raw = readFileSync(SHADOW_LOG_FILE, "utf8");
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  } catch {
    return [];
  }
}
