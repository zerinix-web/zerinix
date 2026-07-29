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

test("unauthenticated users see the production registration state", () => {
  assert.equal(getRegisterRouteState(null), "show_registration");
  assert.equal(getRegisterRouteState(undefined), "show_registration");
});

test("/register exposes the production signup form", () => {
  const source = readFileSync("app/register/page.tsx", "utf8");
  const form = readFileSync("components/RegisterForm.tsx", "utf8");

  assert.match(source, /RegisterForm/);
  assert.match(form, /signUpWithPassword/);
  assert.match(form, /name="fullName"/);
  assert.match(form, /name="email"/);
  assert.match(form, /name="password"/);
  assert.match(form, /name="confirmPassword"/);
  assert.doesNotMatch(source, /ZERINIX Private Beta/);
  assert.doesNotMatch(source, /mailto:admin@zerinix\.com/);
});
