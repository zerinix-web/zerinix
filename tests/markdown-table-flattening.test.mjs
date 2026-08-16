import test from "node:test";
import assert from "node:assert/strict";
import { flattenMarkdownTables } from "../app/lib/report-engine/markdown-table-flattening.ts";

test("a markdown competitor comparison table is flattened into one bullet per row", () => {
  const content = [
    "Validated competitor comparison",
    "| Vendor | Parent Company | Pricing Model | Confidence |",
    "| --- | --- | --- | --- |",
    "| 1Password | - | Enterprise pricing | 71/100 |",
    "| HashiCorp | - | Not disclosed | 71/100 |",
  ].join("\n");

  const flattened = flattenMarkdownTables(content);

  assert.ok(!flattened.includes("| --- |"), "no separator row should survive");
  assert.ok(!/\|\s*Vendor\s*\|/.test(flattened), "no raw header row should survive");
  assert.match(flattened, /-\s*1Password\s*—.*Pricing Model: Enterprise pricing.*Confidence: 71\/100/);
  assert.match(flattened, /-\s*HashiCorp\s*—.*Pricing Model: Not disclosed.*Confidence: 71\/100/);
});

test("content with no table is returned unchanged", () => {
  const content = "1) Regulatory pressure drives adoption.\n2) Cloud-native adoption grows.";
  assert.equal(flattenMarkdownTables(content), content);
});

test("a dash placeholder cell is omitted rather than rendered as 'Field: -'", () => {
  const content = [
    "| Vendor | Parent Company |",
    "| --- | --- |",
    "| Acme | - |",
  ].join("\n");

  const flattened = flattenMarkdownTables(content);
  assert.ok(!flattened.includes("Parent Company: -"));
  assert.match(flattened, /-\s*Acme/);
});

test("prose before and after a table is preserved around the flattened rows", () => {
  const content = [
    "Only 4 named competitors could be independently confirmed.",
    "| Vendor | Confidence |",
    "| --- | --- |",
    "| Acme | 70/100 |",
    "Pricing evidence: Acme enterprise pricing page.",
  ].join("\n");

  const flattened = flattenMarkdownTables(content);
  assert.match(flattened, /^Only 4 named competitors/);
  assert.match(flattened, /Pricing evidence: Acme enterprise pricing page\.$/);
});
