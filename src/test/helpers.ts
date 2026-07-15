// Shared test helpers: build a fully-isolated better-auth instance backed by a
// throwaway SQLite file (os.tmpdir(), never under the repo), migrated in-process via
// better-auth's programmatic migration API (same machinery `npm run migrate` / the
// @better-auth/cli uses under the hood — see node_modules/better-auth/dist/db/get-migration).
// No live credentials: BETTER_AUTH_SECRET is a fixed non-secret test string,
// RESEND_API_KEY is deliberately left UNSET (src/email.ts throws loud if a magic-link
// send is ever actually attempted — tests assert on the auth layer, never send real mail).

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getMigrations } from "better-auth/db/migration";
import { createAuth } from "../auth.js";

export interface TestAuthContext {
  auth: ReturnType<typeof createAuth>;
  dir: string;
  cleanup: () => void;
}

/**
 * Creates a betterAuth instance against a fresh SQLite file under a per-call temp
 * directory, runs migrations against it, and returns a cleanup function that removes
 * the temp directory (including -wal/-shm/-journal siblings) afterward.
 */
export async function createTestAuth(): Promise<TestAuthContext> {
  const dir = mkdtempSync(join(tmpdir(), "nousergon-auth-test-"));
  const databasePath = join(dir, "test.sqlite");

  const auth = createAuth({ databasePath });
  const { runMigrations } = await getMigrations(auth.options);
  await runMigrations();

  return {
    auth,
    dir,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/** Fixed, non-secret test value — never a real credential. Meets better-auth's 32-char floor. */
export const TEST_SECRET = "test-only-secret-do-not-use-in-prod-0000";

export function withTestEnv(overrides: Record<string, string | undefined> = {}) {
  const keys = [
    "AUTH_DATABASE_URL",
    "AUTH_BASE_URL",
    "AUTH_TRUSTED_ORIGINS",
    "AUTH_COOKIE_DOMAIN",
    "BETTER_AUTH_SECRET",
    "RESEND_API_KEY",
    "EMAIL_SENDER",
    "ALLOWLIST_GATE_ENABLED",
    ...Object.keys(overrides),
  ];
  const saved = new Map(keys.map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return () => {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
}
