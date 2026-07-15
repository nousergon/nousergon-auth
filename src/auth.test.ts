// better-auth config wiring (src/auth.ts): asserts the constructed instance carries the
// expected options (rate limiting on, cross-subdomain cookie domain, trusted origins,
// jwt issuer/payload shape) and that the expected plugin surfaces actually resolve as
// live HTTP routes — without ever touching a real credential (BETTER_AUTH_SECRET is a
// fixed test string; RESEND_API_KEY is left unset throughout).

import { afterEach, describe, expect, it } from "vitest";
import { createTestAuth, withTestEnv, type TestAuthContext } from "./test/helpers.js";
import Database from "better-sqlite3";

let ctx: TestAuthContext | undefined;
let restoreEnv: (() => void) | undefined;

afterEach(() => {
  ctx?.cleanup();
  ctx = undefined;
  restoreEnv?.();
  restoreEnv = undefined;
});

describe("createAuth() config wiring", () => {
  it("enables rate limiting explicitly (better-auth defaults this off outside NODE_ENV=production)", async () => {
    restoreEnv = withTestEnv({ BETTER_AUTH_SECRET: "test-only-secret-do-not-use-in-prod-0000" });
    ctx = await createTestAuth();
    expect(ctx.auth.options.rateLimit?.enabled).toBe(true);
    expect(ctx.auth.options.rateLimit?.max).toBe(100);
  });

  it("enables cross-subdomain cookies with the configured domain", async () => {
    restoreEnv = withTestEnv({
      BETTER_AUTH_SECRET: "test-only-secret-do-not-use-in-prod-0000",
      AUTH_COOKIE_DOMAIN: ".test.example.com",
    });
    ctx = await createTestAuth();
    expect(ctx.auth.options.advanced?.crossSubDomainCookies?.enabled).toBe(true);
    expect(ctx.auth.options.advanced?.crossSubDomainCookies?.domain).toBe(".test.example.com");
  });

  it("defaults the cookie domain to .nousergon.ai when unset", async () => {
    restoreEnv = withTestEnv({
      BETTER_AUTH_SECRET: "test-only-secret-do-not-use-in-prod-0000",
      AUTH_COOKIE_DOMAIN: undefined,
    });
    ctx = await createTestAuth();
    expect(ctx.auth.options.advanced?.crossSubDomainCookies?.domain).toBe(".nousergon.ai");
  });

  it("parses AUTH_TRUSTED_ORIGINS into the trustedOrigins list", async () => {
    restoreEnv = withTestEnv({
      BETTER_AUTH_SECRET: "test-only-secret-do-not-use-in-prod-0000",
      AUTH_TRUSTED_ORIGINS: "https://metron.nousergon.ai,https://vires.nousergon.ai",
    });
    ctx = await createTestAuth();
    expect(ctx.auth.options.trustedOrigins).toEqual([
      "https://metron.nousergon.ai",
      "https://vires.nousergon.ai",
    ]);
  });

  it("never sets a secret from a hardcoded default — comes only from BETTER_AUTH_SECRET", async () => {
    restoreEnv = withTestEnv({ BETTER_AUTH_SECRET: "test-only-secret-do-not-use-in-prod-0000" });
    ctx = await createTestAuth();
    expect(ctx.auth.options.secret).toBe("test-only-secret-do-not-use-in-prod-0000");
  });

  it("wires the allowlist-gate, magic-link, and jwt plugins (three plugins, in that order)", async () => {
    restoreEnv = withTestEnv({ BETTER_AUTH_SECRET: "test-only-secret-do-not-use-in-prod-0000" });
    ctx = await createTestAuth();
    const ids = (ctx.auth.options.plugins ?? []).map((p) => p.id);
    expect(ids).toEqual(["allowlist-gate", "magic-link", "jwt"]);
  });

  it("sets the jwt issuer from AUTH_BASE_URL", async () => {
    restoreEnv = withTestEnv({
      BETTER_AUTH_SECRET: "test-only-secret-do-not-use-in-prod-0000",
      AUTH_BASE_URL: "https://auth.test.example.com",
    });
    ctx = await createTestAuth();
    const jwtPlugin = (ctx.auth.options.plugins ?? []).find((p) => p.id === "jwt") as
      | { options?: { jwt?: { issuer?: string; expirationTime?: string } } }
      | undefined;
    expect(jwtPlugin?.options?.jwt?.issuer).toBe("https://auth.test.example.com");
    expect(jwtPlugin?.options?.jwt?.expirationTime).toBe("15m");
  });

  it("migrates a fresh sqlite file into the expected table set", async () => {
    restoreEnv = withTestEnv({ BETTER_AUTH_SECRET: "test-only-secret-do-not-use-in-prod-0000" });
    ctx = await createTestAuth();
    const dbPath = `${ctx.dir}/test.sqlite`;
    const db = new Database(dbPath, { readonly: true });
    const tables = db
      .prepare("select name from sqlite_master where type='table'")
      .all()
      .map((r) => (r as { name: string }).name)
      .sort();
    db.close();
    expect(tables).toEqual(
      ["account", "allowedEmail", "jwks", "session", "user", "verification"].sort(),
    );
  });
});

describe("GET /api/auth/jwks", () => {
  it("exposes a JWKS document (jwt plugin wired end-to-end)", async () => {
    restoreEnv = withTestEnv({ BETTER_AUTH_SECRET: "test-only-secret-do-not-use-in-prod-0000" });
    ctx = await createTestAuth();
    const res = await ctx.auth.handler(new Request("http://localhost:4100/api/auth/jwks"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { keys: Array<{ kty: string; alg: string }> };
    expect(body.keys.length).toBeGreaterThan(0);
    expect(body.keys[0]?.kty).toBeTruthy();
  });
});
