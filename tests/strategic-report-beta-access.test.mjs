import test from "node:test";
import assert from "node:assert/strict";
import { authorizeStrategicReportAccess } from "../app/lib/strategic-report-access.ts";

const request = new Request("https://zerinix.com/api/plan");

function user(overrides = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    email: "user@example.com",
    app_metadata: {},
    user_metadata: {},
    aud: "authenticated",
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

test("verified admin role is allowed to generate strategic reports", async () => {
  const result = await authorizeStrategicReportAccess({
    request,
    account: user(),
    allowedEmails: "beta@example.com",
    loadAdminRole: async () => "admin",
  });
  assert.deepEqual(result, {
    allowed: true,
    branch: "verified_admin_owner_role",
  });
});

test("verified owner role is allowed to generate strategic reports", async () => {
  const result = await authorizeStrategicReportAccess({
    request,
    account: user(),
    allowedEmails: "beta@example.com",
    loadAdminRole: async () => "owner",
  });
  assert.equal(result.allowed, true);
  assert.equal(result.branch, "verified_admin_owner_role");
});

test("approved beta user remains allowed", async () => {
  let roleLookupCalled = false;
  const result = await authorizeStrategicReportAccess({
    request,
    account: user({ email: "beta@example.com" }),
    allowedEmails: "beta@example.com",
    loadAdminRole: async () => {
      roleLookupCalled = true;
      return null;
    },
  });
  assert.equal(result.allowed, true);
  assert.equal(result.branch, "approved_beta");
  assert.equal(roleLookupCalled, false);
});

test("unapproved normal user remains blocked", async () => {
  const result = await authorizeStrategicReportAccess({
    request,
    account: user(),
    allowedEmails: "beta@example.com",
    loadAdminRole: async () => null,
  });
  assert.deepEqual(result, {
    allowed: false,
    branch: "private_beta_denied",
  });
});

test("profile loading failure does not grant a normal user access", async () => {
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    const result = await authorizeStrategicReportAccess({
      request,
      account: user(),
      allowedEmails: "beta@example.com",
      loadAdminRole: async () => {
        throw new Error("profile unavailable");
      },
    });
    assert.equal(result.allowed, false);
    assert.equal(result.branch, "private_beta_denied");
  } finally {
    console.error = originalConsoleError;
  }
});
