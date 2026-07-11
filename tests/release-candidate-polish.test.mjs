import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

function read(path) {
  return readFileSync(path, "utf8");
}

test("major application areas have polished route error states", () => {
  for (const path of [
    "app/error.tsx",
    "app/dashboard/error.tsx",
    "app/plan/error.tsx",
    "app/chat/error.tsx",
    "app/admin/error.tsx",
  ]) {
    assert.equal(existsSync(path), true, `${path} should exist`);
    assert.match(read(path), /RouteErrorState/);
  }

  const sharedError = read("components/RouteErrorState.tsx");

  assert.match(sharedError, /Try again/);
  assert.match(sharedError, /Back to dashboard/);
  assert.match(sharedError, /focus-visible:ring/);
});

test("AI Chat profile clearing uses the premium modal flow instead of browser confirm", () => {
  const source = read("components/AIChatWorkspace.tsx");

  assert.doesNotMatch(source, /window\.confirm/);
  assert.match(source, /clearProfileConfirmOpen/);
  assert.match(source, /Remove saved chat preferences/);
  assert.match(source, /Clear profile/);
});
