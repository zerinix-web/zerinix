import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getRegisterRouteState } from "../app/register/register-access.mjs";

test("authenticated users are redirected away from /register", () => {
  assert.equal(
    getRegisterRouteState({ id: "user_123", email: "admin@zerinix.com" }),
    "redirect_dashboard"
  );
});

test("unauthenticated users only see the private beta registration state", () => {
  assert.equal(getRegisterRouteState(null), "private_beta");
  assert.equal(getRegisterRouteState(undefined), "private_beta");
});

test("/register does not expose public signup form wiring", () => {
  const source = readFileSync("app/register/page.tsx", "utf8");

  assert.equal(source.includes("signUpWithPassword"), false);
  assert.equal(source.includes("<form"), false);
  assert.equal(source.includes("auth_error"), false);
  assert.match(source, /ZERINIX Private Beta/);
  assert.match(
    source,
    /mailto:admin@zerinix\.com\?subject=ZERINIX%20Private%20Beta/
  );
});
