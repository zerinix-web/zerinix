import test from "node:test";
import assert from "node:assert/strict";
import {
  getAuthRouteRedirectPath,
  getAuthRouteState,
} from "../app/auth/route-access.ts";

test("authenticated users are redirected away from auth pages", () => {
  assert.equal(
    getAuthRouteState({ id: "user_123", email: "admin@zerinix.com" }),
    "redirect_dashboard"
  );
});

test("unauthenticated users can see auth pages", () => {
  assert.equal(getAuthRouteState(null), "show_auth");
  assert.equal(getAuthRouteState(undefined), "show_auth");
});

test("unauthenticated user on /login is not redirected", () => {
  assert.equal(getAuthRouteRedirectPath("/login", null), null);
});

test("unauthenticated user on /register is not redirected", () => {
  assert.equal(getAuthRouteRedirectPath("/register", undefined), null);
});

test("authenticated user on /login redirects to dashboard", () => {
  const user = { id: "user_123", email: "admin@zerinix.com" };

  assert.equal(getAuthRouteRedirectPath("/login", user), "/dashboard");
});

test("authenticated user on /register redirects to dashboard", () => {
  const user = { id: "user_123", email: "admin@zerinix.com" };

  assert.equal(getAuthRouteRedirectPath("/register", user), "/dashboard");
});

test("authenticated users redirect from /login and /register before render", () => {
  const user = { id: "user_123", email: "admin@zerinix.com" };

  assert.equal(getAuthRouteRedirectPath("/login", user), "/dashboard");
  assert.equal(getAuthRouteRedirectPath("/register", user), "/dashboard");
});

test("/login and /register return the same redirect for the same authenticated session", () => {
  const user = { id: "user_123", email: "admin@zerinix.com" };
  const loginRedirect = getAuthRouteRedirectPath("/login", user);
  const registerRedirect = getAuthRouteRedirectPath("/register", user);

  assert.equal(loginRedirect, registerRedirect);
  assert.equal(loginRedirect, "/dashboard");
});

test("anonymous users and non-auth routes do not redirect through auth guard", () => {
  const user = { id: "user_123", email: "admin@zerinix.com" };

  assert.equal(getAuthRouteRedirectPath("/login", null), null);
  assert.equal(getAuthRouteRedirectPath("/dashboard", null), null);
  assert.equal(getAuthRouteRedirectPath("/plan", undefined), null);
  assert.equal(getAuthRouteRedirectPath("/dashboard", user), null);
  assert.equal(getAuthRouteRedirectPath("/plan", user), null);
});
