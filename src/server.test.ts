// Server startup + health endpoint + CORS layer (src/server.ts's own logic, distinct
// from better-auth's routes — see allowlist-gate.test.ts / auth.test.ts for those).
// Spins up a real net.Server on an ephemeral port (port 0) per test and tears it down
// in afterEach, so tests never collide with the real service's :4100 nor each other.

import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { allowedOrigins, createRequestListener } from "./server.js";
import { createTestAuth, withTestEnv, type TestAuthContext } from "./test/helpers.js";

let server: Server | undefined;
let ctx: TestAuthContext | undefined;
let restoreEnv: (() => void) | undefined;

async function listen(): Promise<{ url: string; port: number }> {
  await new Promise<void>((resolve) => server!.listen(0, resolve));
  const address = server!.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected an AddressInfo from server.listen(0)");
  }
  return { url: `http://127.0.0.1:${address.port}`, port: address.port };
}

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  }
  ctx?.cleanup();
  ctx = undefined;
  restoreEnv?.();
  restoreEnv = undefined;
});

describe("GET /health", () => {
  it("returns 200 with the expected plain-text body, independent of better-auth", async () => {
    restoreEnv = withTestEnv({
      BETTER_AUTH_SECRET: "test-only-secret-do-not-use-in-prod-0000",
      AUTH_TRUSTED_ORIGINS: "http://allowed.example.com",
    });
    ctx = await createTestAuth();
    server = createServer(createRequestListener(ctx.auth));
    const { url } = await listen();

    const res = await fetch(`${url}/health`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect(await res.text()).toBe("ok");
  });

  it("does not require any auth/CORS headers to succeed", async () => {
    restoreEnv = withTestEnv({
      BETTER_AUTH_SECRET: "test-only-secret-do-not-use-in-prod-0000",
    });
    ctx = await createTestAuth();
    server = createServer(createRequestListener(ctx.auth));
    const { url } = await listen();

    const res = await fetch(`${url}/health`, { method: "GET" });
    expect(res.status).toBe(200);
  });
});

describe("CORS layer", () => {
  // NOTE: /health intentionally returns before the CORS block runs (see the handler's
  // early `return` in src/server.ts) — health checks aren't called from browser JS, so
  // CORS headers are only meaningful on the better-auth API surface. These tests hit
  // /api/auth/jwks (a real, harmless GET route) to exercise the CORS layer itself.
  it("echoes Access-Control-Allow-Origin only for a trusted origin", async () => {
    restoreEnv = withTestEnv({
      BETTER_AUTH_SECRET: "test-only-secret-do-not-use-in-prod-0000",
      AUTH_TRUSTED_ORIGINS: "http://allowed.example.com,http://also-allowed.example.com",
    });
    ctx = await createTestAuth();
    server = createServer(createRequestListener(ctx.auth));
    const { url } = await listen();

    const res = await fetch(`${url}/api/auth/jwks`, {
      headers: { Origin: "http://allowed.example.com" },
    });
    expect(res.headers.get("access-control-allow-origin")).toBe("http://allowed.example.com");
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
  });

  it("does not echo Access-Control-Allow-Origin for an untrusted origin", async () => {
    restoreEnv = withTestEnv({
      BETTER_AUTH_SECRET: "test-only-secret-do-not-use-in-prod-0000",
      AUTH_TRUSTED_ORIGINS: "http://allowed.example.com",
    });
    ctx = await createTestAuth();
    server = createServer(createRequestListener(ctx.auth));
    const { url } = await listen();

    const res = await fetch(`${url}/api/auth/jwks`, {
      headers: { Origin: "http://evil.example.com" },
    });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("answers OPTIONS preflight with 204 and the expected allow-headers", async () => {
    restoreEnv = withTestEnv({
      BETTER_AUTH_SECRET: "test-only-secret-do-not-use-in-prod-0000",
      AUTH_TRUSTED_ORIGINS: "http://allowed.example.com",
    });
    ctx = await createTestAuth();
    server = createServer(createRequestListener(ctx.auth));
    const { url } = await listen();

    const res = await fetch(`${url}/api/auth/sign-in/magic-link`, {
      method: "OPTIONS",
      headers: { Origin: "http://allowed.example.com" },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
    expect(res.headers.get("access-control-allow-headers")).toContain("Content-Type");
  });

  describe("allowedOrigins()", () => {
    it("parses a comma-separated env var into a trimmed, deduped set", () => {
      restoreEnv = withTestEnv({
        AUTH_TRUSTED_ORIGINS: " http://a.example.com ,http://b.example.com,,http://a.example.com",
      });
      const set = allowedOrigins();
      expect([...set].sort()).toEqual(["http://a.example.com", "http://b.example.com"]);
    });

    it("is empty when the env var is unset", () => {
      restoreEnv = withTestEnv({ AUTH_TRUSTED_ORIGINS: undefined });
      expect(allowedOrigins().size).toBe(0);
    });
  });
});

describe("non-health requests", () => {
  it("delegates to the better-auth handler (e.g. reaches the JWKS route)", async () => {
    restoreEnv = withTestEnv({
      BETTER_AUTH_SECRET: "test-only-secret-do-not-use-in-prod-0000",
    });
    ctx = await createTestAuth();
    server = createServer(createRequestListener(ctx.auth));
    const { url } = await listen();

    const res = await fetch(`${url}/api/auth/jwks`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { keys: unknown[] };
    expect(Array.isArray(body.keys)).toBe(true);
  });
});
