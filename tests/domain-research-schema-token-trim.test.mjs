import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// domain-research.ts imports "server-only" and cannot be imported outside
// Next's own dev/build process (confirmed repeatedly this session) -- this
// mirrors the established static-source-text pattern used elsewhere in
// this suite for asserting behavior in files that can't be imported.
const source = await readFile(
  new URL("../app/lib/ai/domain-research.ts", import.meta.url),
  "utf8"
);

function extractSchemaBlock(fieldName) {
  const start = source.indexOf(`${fieldName}: {\n          type: "array",`);
  if (start === -1) throw new Error(`could not locate ${fieldName} schema block`);
  // Both blocks close with the same "},\n        },\n" shape (items object,
  // then the field object) -- slice a generous window and let the caller's
  // assertions do the precise checking.
  return source.slice(start, start + 1400);
}

test("taskResults schema no longer requests a provider field the caller always overwrites", () => {
  const block = extractSchemaBlock("taskResults");
  assert.doesNotMatch(block, /provider:\s*\{\s*type:\s*"string"\s*\}/);
  assert.doesNotMatch(block, /required:\s*\[\s*\n\s*"id",\s*\n\s*"field",\s*\n\s*"provider"/);
  // The fields that ARE actually consumed must still be present.
  assert.match(block, /id:\s*\{\s*type:\s*"string",\s*enum:\s*taskIds\s*\}/);
  assert.match(block, /field:\s*\{\s*type:\s*"string",\s*enum:\s*taskFields\s*\}/);
  assert.match(block, /status:\s*\{/);
  assert.match(block, /confidence:\s*\{\s*type:\s*"number"/);
});

test("extractedFacts schema no longer requests a taskId field that is never read for extractedFacts", () => {
  const block = extractSchemaBlock("extractedFacts");
  assert.doesNotMatch(block, /taskId:\s*\{\s*type:\s*"string",\s*enum:\s*taskIds\s*\}/);
  assert.doesNotMatch(block, /required:\s*\[\s*\n\s*"taskId"/);
  // field remains the (sufficient, actually-used) task association key.
  assert.match(block, /field:\s*\{\s*type:\s*"string",\s*enum:\s*taskFields\s*\}/);
  assert.match(block, /required:\s*\[\s*\n\s*"field"/);
});

test("evidence schema (a different array) still requires its own taskId -- confirmed actually used by resolveResearchTaskReference, so it was correctly left alone", () => {
  const evidenceStart = source.indexOf('evidence: {\n          type: "array",');
  const evidenceBlock = source.slice(evidenceStart, evidenceStart + 600);
  assert.match(evidenceBlock, /taskId:\s*\{\s*type:\s*"string",\s*enum:\s*taskIds\s*\}/);
  assert.match(
    source,
    /resolveResearchTaskReference\(\s*\{\s*\n\s*taskId:\s*record\.taskId,/
  );
});
