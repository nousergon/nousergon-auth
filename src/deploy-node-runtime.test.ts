// The deploy builds and runs on ONE Node major, and a native module built for
// another major is rebuilt before the unit restarts.
//
// infrastructure/deploy-on-merge.sh pins the install/build/migrate toolchain to
// node-${NODE_MAJOR}; infrastructure/nousergon-auth.service runs
// ExecStart=/usr/bin/node-<major>. If those two disagree, better-sqlite3 is
// compiled for one ABI and loaded under another and the unit crash-loops
// (2026-07-11: NODE_MODULE_VERSION 108 vs 127). And `npm install` does NOT
// rebuild a native module already in node_modules when the major changes — it
// exits 0 and leaves the old ABI in place — so the move to node-24 (and any
// rollback of it) would deploy green and then crash. alpha-engine-config-I12116.
//
// These tests run the script's OWN lines (the runtime-lockstep assert and the
// marked ABI-probe block) rather than a copy, so a reworded or removed guard
// fails here instead of on the box.

import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = readFileSync(join(REPO_ROOT, "infrastructure", "deploy-on-merge.sh"), "utf-8");
const UNIT = readFileSync(join(REPO_ROOT, "infrastructure", "nousergon-auth.service"), "utf-8");

const PROBE_START = "# >>> native-abi-probe\n";
const PROBE_END = "# <<< native-abi-probe\n";
const LOCKSTEP_START = "NODE_MAJOR=";
const LOCKSTEP_END = "# Side-by-side install";

function span(start: string, end: string): string {
  const s = SCRIPT.indexOf(start);
  const e = SCRIPT.indexOf(end, s);
  expect(s, `deploy-on-merge.sh no longer contains ${JSON.stringify(start)}`).toBeGreaterThan(-1);
  expect(e, `deploy-on-merge.sh no longer contains ${JSON.stringify(end)} after it`).toBeGreaterThan(s);
  return SCRIPT.slice(s, e);
}

function runBash(body: string, env: NodeJS.ProcessEnv, cwd = REPO_ROOT) {
  const r = spawnSync("bash", ["-c", `set -uo pipefail\n${body}`], { encoding: "utf-8", env, cwd });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

const scriptMajor = (): string => /^NODE_MAJOR=(\d+)$/m.exec(SCRIPT)?.[1] ?? "";
const unitMajor = (): string => /^ExecStart=\/usr\/bin\/node-(\d+) /m.exec(UNIT)?.[1] ?? "";

describe("deploy-on-merge.sh runtime lockstep", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("builds with the same node major the unit runs", () => {
    expect(scriptMajor()).not.toBe("");
    expect(scriptMajor()).toBe(unitMajor());
  });

  function runLockstep(execStartMajor: string) {
    dir = mkdtempSync(join(tmpdir(), "nousergon-auth-lockstep-"));
    mkdirSync(join(dir, "infrastructure"));
    writeFileSync(
      join(dir, "infrastructure", "nousergon-auth.service"),
      UNIT.replace(/^ExecStart=\/usr\/bin\/node-\d+ /m, `ExecStart=/usr/bin/node-${execStartMajor} `),
    );
    return runBash(`REPO=${JSON.stringify(dir)}\n${span(LOCKSTEP_START, LOCKSTEP_END)}`, process.env);
  }

  it("passes the script's own assert when the unit matches", () => {
    expect(runLockstep(scriptMajor()).status).toBe(0);
  });

  it("refuses to deploy when only one side was flipped", () => {
    const other = scriptMajor() === "24" ? "22" : "24";
    const r = runLockstep(other);
    expect(r.status).toBe(1);
    expect(r.out).toContain("runtime mismatch");
  });
});

describe("deploy-on-merge.sh native-module ABI probe", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("runs after npm install and before build, migrate and restart", () => {
    const probeAt = SCRIPT.indexOf(PROBE_START);
    expect(probeAt).toBeGreaterThan(SCRIPT.indexOf("npm install --no-audit"));
    for (const later of ["npm run build", "npm run migrate", "sudo systemctl restart nousergon-auth"]) {
      expect(probeAt, later).toBeLessThan(SCRIPT.indexOf(later));
    }
  });

  it("loads the real better-sqlite3 under the node running this suite", () => {
    const r = runBash(span(PROBE_START, PROBE_END), process.env);
    expect(r.out).toContain("better-sqlite3 ABI OK");
    expect(r.status).toBe(0);
  });

  // Fake `node`/`npm` on PATH: the probe fails with an ABI error until `npm rebuild
  // better-sqlite3` drops a marker — the exact sequence a node-major switch produces.
  function fakeToolchain(rebuildWorks: boolean, rebuildFixes: boolean): NodeJS.ProcessEnv {
    dir = mkdtempSync(join(tmpdir(), "nousergon-auth-abi-"));
    const marker = join(dir, "rebuilt");
    writeFileSync(
      join(dir, "node"),
      `#!/bin/bash
[ "$1" = "--version" ] && { echo v24.0.0; exit 0; }
[ -e ${JSON.stringify(marker)} ] && [ "${rebuildFixes ? 1 : 0}" = 1 ] && exit 0
echo "Error: was compiled against a different Node.js version using" >&2
echo "NODE_MODULE_VERSION 127. This version of Node.js requires NODE_MODULE_VERSION 137." >&2
exit 1
`,
    );
    writeFileSync(
      join(dir, "npm"),
      `#!/bin/bash
[ "$1 $2" = "rebuild better-sqlite3" ] || exit 2
[ "${rebuildWorks ? 1 : 0}" = 1 ] || exit 1
touch ${JSON.stringify(marker)}
`,
    );
    chmodSync(join(dir, "node"), 0o755);
    chmodSync(join(dir, "npm"), 0o755);
    return { ...process.env, PATH: `${dir}:${process.env.PATH ?? ""}` };
  }

  it("rebuilds on an ABI mismatch and re-probes", () => {
    const env = fakeToolchain(true, true);
    const r = runBash(span(PROBE_START, PROBE_END), env);
    expect(r.out).toContain("NODE_MODULE_VERSION 127");
    expect(r.out).toContain("better-sqlite3 rebuilt; ABI OK");
    expect(existsSync(join(dir as string, "rebuilt"))).toBe(true);
    expect(r.status).toBe(0);
  });

  it("fails the deploy when the rebuild fails", () => {
    const r = runBash(span(PROBE_START, PROBE_END), fakeToolchain(false, true));
    expect(r.status).toBe(1);
    expect(r.out).toContain("better-sqlite3 rebuild FAILED");
  });

  it("fails the deploy when the module still does not load after rebuilding", () => {
    const r = runBash(span(PROBE_START, PROBE_END), fakeToolchain(true, false));
    expect(r.status).toBe(1);
    expect(r.out).toContain("ABI probe FAILED after rebuild");
  });
});

// The box must run a node that meets package.json engines.node, not merely the right
// major: `npm install --silent` hides EBADENGINE, so a distro nodejs24 below the
// declared floor would otherwise deploy green on an undeclared runtime.
// alpha-engine-config-I12116.
describe("deploy-on-merge.sh engines floor", () => {
  const FLOOR_START = "# >>> engines-floor\n";
  const FLOOR_END = "# <<< engines-floor\n";
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  function runFloor(engine: string | undefined) {
    dir = mkdtempSync(join(tmpdir(), "nousergon-auth-engines-"));
    const pkg = engine === undefined ? { name: "x" } : { name: "x", engines: { node: engine } };
    writeFileSync(join(dir, "package.json"), JSON.stringify(pkg));
    return runBash(`NODE_MAJOR=${scriptMajor()}\n${span(FLOOR_START, FLOOR_END)}`, process.env, dir);
  }

  it("runs before npm install touches node_modules", () => {
    const at = SCRIPT.indexOf(FLOOR_START);
    expect(at).toBeGreaterThan(SCRIPT.indexOf('export PATH="$NODE_SHIM:$PATH"'));
    expect(at).toBeLessThan(SCRIPT.indexOf("npm install --no-audit"));
  });

  it("the repo's own engines.node is a floor the check can read", () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf-8"));
    expect(pkg.engines?.node).toMatch(/^>=\s*\d+\.\d+\.\d+$/);
    expect(pkg.engines.node).toMatch(new RegExp(`^>=\\s*${scriptMajor()}\\.`));
  });

  it("passes when the running node meets the floor exactly", () => {
    const r = runFloor(`>=${process.versions.node}`);
    expect(r.out).toContain("satisfies engines.node");
    expect(r.status).toBe(0);
  });

  it("passes when the running node is above the floor", () => {
    const r = runFloor(">=0.0.1");
    expect(r.status).toBe(0);
  });

  it("refuses the deploy when the running node is below the floor", () => {
    const [maj] = process.versions.node.split(".").map(Number);
    const r = runFloor(`>=${maj}.${999}.0`);
    expect(r.status).toBe(1);
    expect(r.out).toContain("is below engines.node");
    expect(r.out).toContain("engines floor FAILED");
  });

  it("refuses an engines.node it cannot read rather than passing it", () => {
    for (const engine of [undefined, "^24.15.0", ">=24"]) {
      const r = runFloor(engine);
      expect(r.status, String(engine)).toBe(1);
      expect(r.out).toContain("not a plain >=X.Y.Z floor");
    }
  });
});
