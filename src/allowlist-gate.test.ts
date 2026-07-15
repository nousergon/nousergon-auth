// Route handler test for the allowlist-gate plugin (src/allowlist-gate.ts), which hooks
// POST /sign-in/magic-link — the one custom route handler this service registers beyond
// what better-auth's own plugins provide (see src/server.ts for the only OTHER
// handler-level logic, /health + CORS, covered in server.test.ts). Exercises the gate's
// documented contract end-to-end through auth.handler() against a real (throwaway)
// sqlite-backed instance: uniform responses, product validation ordering, returning-user
// bypass. No live credentials — RESEND_API_KEY/EMAIL_SENDER are deliberately unset, so an
// approved-and-actually-sent path fails loud (asserted below) rather than silently
// pretending to send mail.

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { allowlistGateEnabled } from "./allowlist-gate.js";
import { createTestAuth, withTestEnv, type TestAuthContext } from "./test/helpers.js";

let ctx: TestAuthContext | undefined;
let restoreEnv: (() => void) | undefined;

// Each call uses a distinct x-forwarded-for so the magic-link plugin's own tight
// per-path rate limit (5 req/60s, keyed by client IP — see src/auth.ts's
// advanced.ipAddress.ipAddressHeaders wiring) buckets every test independently,
// exactly as distinct real-world callers would. Without a resolvable IP, better-auth
// falls back to a single shared bucket and unrelated tests in this file would 429 each
// other (the actual failure mode observed before this fixture existed).
let ipCounter = 0;
function signIn(auth: TestAuthContext["auth"], body: unknown) {
  ipCounter += 1;
  return auth.handler(
    new Request("http://localhost:4100/api/auth/sign-in/magic-link", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": `10.0.0.${ipCounter}`,
      },
      body: JSON.stringify(body),
    }),
  );
}

function approveEmail(dbPath: string, email: string, product: string) {
  const db = new Database(dbPath);
  db.prepare(
    `INSERT INTO allowedEmail (id, email, product, createdAt) VALUES (?, ?, ?, ?)`,
  ).run(`approval-${email}-${product}`, email, product, new Date().toISOString());
  db.close();
}

beforeEach(() => {
  restoreEnv = withTestEnv({ BETTER_AUTH_SECRET: "test-only-secret-do-not-use-in-prod-0000" });
});

afterEach(() => {
  ctx?.cleanup();
  ctx = undefined;
  restoreEnv?.();
  restoreEnv = undefined;
});

describe("POST /sign-in/magic-link — allowlist gate", () => {
  it("400s when metadata.product is missing, before any account lookup", async () => {
    ctx = await createTestAuth();
    const res = await signIn(ctx.auth, { email: "nobody@example.com", callbackURL: "/" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { message: string };
    expect(body.message).toMatch(/metadata\.product is required/);
  });

  it("400s for a missing product even when the email IS approved (contract check runs first)", async () => {
    ctx = await createTestAuth();
    approveEmail(`${ctx.dir}/test.sqlite`, "friend@example.com", "vires");
    const res = await signIn(ctx.auth, { email: "friend@example.com", callbackURL: "/" });
    expect(res.status).toBe(400);
  });

  it("returns uniform success for an UNAPPROVED new address (no email attempted, no 500)", async () => {
    ctx = await createTestAuth();
    const res = await signIn(ctx.auth, {
      email: "unapproved@example.com",
      callbackURL: "/",
      metadata: { product: "vires" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: boolean };
    expect(body.status).toBe(true);
  });

  it("attempts a real send for an APPROVED new address — fails loud (500) with no RESEND_API_KEY configured", async () => {
    // This is the discriminating case: if the gate regressed to block APPROVED users
    // too, this would come back 200 with no send attempt instead of 500. If the gate
    // regressed to ALSO pass unapproved users through, the "unapproved" test above
    // would be the one to catch it. Together the two cases pin the gate's branch.
    ctx = await createTestAuth();
    approveEmail(`${ctx.dir}/test.sqlite`, "friend@example.com", "vires");
    const res = await signIn(ctx.auth, {
      email: "friend@example.com",
      callbackURL: "/",
      metadata: { product: "vires" },
    });
    expect(res.status).toBe(500);
  });

  it("scopes approval by product — approved for metron does not pass for vires", async () => {
    ctx = await createTestAuth();
    approveEmail(`${ctx.dir}/test.sqlite`, "friend@example.com", "metron");
    const res = await signIn(ctx.auth, {
      email: "friend@example.com",
      callbackURL: "/",
      metadata: { product: "vires" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: boolean };
    expect(body.status).toBe(true); // uniform response — still "succeeds" but no send is attempted
  });

  it("400s on a non-string email rather than throwing an unhandled 500", async () => {
    ctx = await createTestAuth();
    const res = await signIn(ctx.auth, {
      email: 12345,
      callbackURL: "/",
      metadata: { product: "vires" },
    });
    expect(res.status).toBe(400);
  });

  it("is bypassed entirely for a RETURNING user (existing user row), even when unapproved", async () => {
    ctx = await createTestAuth();
    const db = new Database(`${ctx.dir}/test.sqlite`);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run("user-1", "Returning User", "returning@example.com", 1, now, now);
    db.close();

    // Returning user is never gated — but sendMagicLink is still attempted (fails
    // loud without RESEND creds), proving the gate's `return;` early-exit was taken
    // rather than the "unapproved" suppression path (which never sends and 200s).
    const res = await signIn(ctx.auth, {
      email: "returning@example.com",
      callbackURL: "/",
      metadata: { product: "vires" },
    });
    expect(res.status).toBe(500);
  });

  it("disables the gate entirely when ALLOWLIST_GATE_ENABLED=false (dev convenience escape hatch)", () => {
    restoreEnv?.();
    restoreEnv = withTestEnv({
      BETTER_AUTH_SECRET: "test-only-secret-do-not-use-in-prod-0000",
      ALLOWLIST_GATE_ENABLED: "false",
    });
    expect(allowlistGateEnabled()).toBe(false);
  });

  it("defaults the gate ON when ALLOWLIST_GATE_ENABLED is unset (pre-launch access gate defaults closed)", () => {
    restoreEnv?.();
    restoreEnv = withTestEnv({
      BETTER_AUTH_SECRET: "test-only-secret-do-not-use-in-prod-0000",
      ALLOWLIST_GATE_ENABLED: undefined,
    });
    expect(allowlistGateEnabled()).toBe(true);
  });
});
