import test from "node:test";
import assert from "node:assert/strict";
import {
  isFounderEmail,
  parseFounderEmails,
} from "../app/lib/founder-access.mjs";

test("founder account matches FOUNDER_EMAILS", () => {
  assert.equal(
    isFounderEmail(
      "admin@zerinix.com",
      "admin@zerinix.com,another@zerinix.com"
    ),
    true
  );
});

test("normal free account does not match founder allowlist", () => {
  assert.equal(
    isFounderEmail(
      "free-user@example.com",
      "admin@zerinix.com,another@zerinix.com"
    ),
    false
  );
});

test("unknown account does not match founder allowlist", () => {
  assert.equal(isFounderEmail("", "admin@zerinix.com"), false);
  assert.equal(isFounderEmail(null, "admin@zerinix.com"), false);
  assert.equal(isFounderEmail("unknown@zerinix.com", ""), false);
});

test("founder emails parser supports multiple comma-separated accounts", () => {
  assert.deepEqual(parseFounderEmails(" admin@zerinix.com, another@zerinix.com "), [
    "admin@zerinix.com",
    "another@zerinix.com",
  ]);
});
