// The deploy leaves .env at 0600 — and does so before any secret is written.
//
// infrastructure/deploy-on-merge.sh hydrates BETTER_AUTH_SECRET and
// RESEND_API_KEY into /home/ec2-user/nousergon-auth/.env on a box where every
// service runs as ec2-user. Until this test existed the file was created by
// `touch` at the umask default (0644) and never tightened, so every co-tenant
// could read both secrets, and the dashboard box's daily unit-secrets check
// (nous-ergon-ops check_unit_secrets.py, ops-config-drift.service) failed on it.
//
// This runs the script's OWN mode-setting lines (the span between `touch` and
// the hydration block) against a real 0644 temp file, so a reworded or removed
// chmod fails here rather than on the box.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = readFileSync(join(REPO_ROOT, "infrastructure", "deploy-on-merge.sh"), "utf-8");

const TOUCH = 'touch "$ENVF"\n';
const HYDRATE = "BLOCK=$(mktemp)";
const FIRST_SECRET_WRITE = 'cat "$BLOCK" >> "$ENVF"';

function modeSpan(): string {
  const start = SCRIPT.indexOf(TOUCH);
  const end = SCRIPT.indexOf(HYDRATE);
  expect(start, "deploy-on-merge.sh no longer touches $ENVF").toBeGreaterThan(-1);
  expect(end, "deploy-on-merge.sh no longer builds the hydration block").toBeGreaterThan(start);
  return SCRIPT.slice(start, end);
}

function runSpan(envf: string): string {
  return execFileSync("bash", ["-c", `set -uo pipefail\nENVF="$1"\n${modeSpan()}`, "span", envf], {
    encoding: "utf-8",
  });
}

describe("deploy-on-merge.sh .env mode", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("tightens an existing 0644 .env to 0600", () => {
    dir = mkdtempSync(join(tmpdir(), "nousergon-auth-env-"));
    const envf = join(dir, ".env");
    writeFileSync(envf, "HAND_SET=1\n", { mode: 0o644 });
    const out = runSpan(envf);
    expect(statSync(envf).mode & 0o777).toBe(0o600);
    expect(out).toContain("mode 644 -> 600");
  });

  it("creates a missing .env at 0600", () => {
    dir = mkdtempSync(join(tmpdir(), "nousergon-auth-env-"));
    const envf = join(dir, ".env");
    runSpan(envf);
    expect(statSync(envf).mode & 0o777).toBe(0o600);
  });

  it("sets the mode before the first secret is appended", () => {
    const chmodAt = SCRIPT.indexOf('chmod 600 "$ENVF"');
    expect(chmodAt).toBeGreaterThan(-1);
    expect(chmodAt).toBeLessThan(SCRIPT.indexOf(FIRST_SECRET_WRITE));
  });
});
