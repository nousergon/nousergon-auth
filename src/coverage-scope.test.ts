// The coverage gate's *scope* is asserted here, not only its number.
//
// repository-baseline-policy.md §4.2 C5: the way a coverage gate stops being
// honest is by narrowing what it measures rather than by lowering the
// number — which reads as an improvement in every report. Measured on
// symposion: removing one flag moved the reported figure from 34.76% to
// 92.36% with no new test code.
//
// So this file asserts, from `vitest.config.ts`'s own text, the four things
// a passing suite cannot otherwise notice:
//
//   * coverage.include names the WHOLE src/ tree (C1), never a subpath —
//     a module nothing imports must still land in the denominator at 0%;
//   * coverage.all is on, so an unimported module is instrumented rather
//     than silently dropped from the report;
//   * coverage.exclude is exactly the pinned, justified list below — any
//     addition shrinks the denominator without adding a test;
//   * the floor is enforced (C2) and is a ratchet that may only rise (C3).
//
// Mirrors tests/test_coverage_scope.py in nousergon/morning-signal and
// nousergon/mnemon, translated to this repo's TypeScript/vitest idiom.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG_PATH = join(REPO_ROOT, "vitest.config.ts");
const CONFIG_SOURCE = readFileSync(CONFIG_PATH, "utf-8");

// The only exclusions with a stated justification: the test files
// themselves, and the shared test-only helper directory. Anything else
// added here narrows the denominator without adding a test — that is
// exactly the C5 failure mode, so it is pinned and any addition must edit
// this constant (and justify it in the PR that does).
const ALLOWED_COVERAGE_EXCLUDES = ["**/*.test.ts", "src/test/**"];

// The floor may be RAISED here as coverage improves. Lowering any of these
// is a policy amendment (repository-baseline-policy.md §4.2 C3), not a code
// change — and a lowered number here is indistinguishable, to this test,
// from a floor that was never met, which is the point: it forces the PR
// that lowers a floor to also edit the thing asserting it may not.
const MINIMUM_THRESHOLDS = {
  statements: 90,
  branches: 88,
  functions: 85,
  lines: 90,
} as const;

/**
 * Extracts the brace-balanced `coverage: { ... }` block from the config
 * source so `include`/`exclude` inside it are never confused with the
 * sibling `test.exclude` array (which serves an unrelated purpose — keeping
 * a stale `dist/` build out of the test run, not coverage scope).
 */
function extractCoverageBlock(source: string): string {
  const marker = "coverage: {";
  const start = source.indexOf(marker);
  if (start === -1) {
    throw new Error("vitest.config.ts has no `coverage: { ... }` block");
  }
  let depth = 0;
  let i = start + marker.length - 1; // position of the opening brace
  for (; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  return source.slice(start, i + 1);
}

function extractStringArray(block: string, key: string): string[] {
  const re = new RegExp(`${key}:\\s*\\[([^\\]]*)\\]`);
  const match = block.match(re);
  if (!match) {
    throw new Error(`coverage.${key} not found or not a literal array`);
  }
  return [...match[1].matchAll(/["']([^"']+)["']/g)].map((m) => m[1]);
}

const COVERAGE_BLOCK = extractCoverageBlock(CONFIG_SOURCE);

describe("coverage measurement scope (repository-baseline-policy.md §4.2)", () => {
  it("C1 — include names the whole src/ tree, not a subpath", () => {
    const include = extractStringArray(COVERAGE_BLOCK, "include");
    expect(include).toEqual(["src/**/*.ts"]);
  });

  it("C1 — coverage.all is on, so an unimported module still counts", () => {
    expect(/\ball:\s*true\b/.test(COVERAGE_BLOCK)).toBe(true);
  });

  it("C5 — exclude is exactly the pinned, justified list", () => {
    const exclude = extractStringArray(COVERAGE_BLOCK, "exclude");
    expect(new Set(exclude)).toEqual(new Set(ALLOWED_COVERAGE_EXCLUDES));
  });

  it("C2 — a threshold is set for every gated metric", () => {
    const thresholdsMatch = COVERAGE_BLOCK.match(
      /thresholds:\s*\{([^}]*)\}/,
    );
    expect(thresholdsMatch).not.toBeNull();
    const body = thresholdsMatch![1];
    for (const metric of Object.keys(MINIMUM_THRESHOLDS)) {
      expect(body).toMatch(new RegExp(`${metric}:\\s*\\d`));
    }
  });

  it("C2/C3 — every threshold meets its ratchet floor and never drops below it", () => {
    const thresholdsMatch = COVERAGE_BLOCK.match(
      /thresholds:\s*\{([^}]*)\}/,
    );
    const body = thresholdsMatch![1];
    for (const [metric, floor] of Object.entries(MINIMUM_THRESHOLDS)) {
      const m = body.match(new RegExp(`${metric}:\\s*(\\d+(?:\\.\\d+)?)`));
      expect(m, `no ${metric} threshold found`).not.toBeNull();
      const configured = Number(m![1]);
      expect(
        configured,
        `coverage threshold ${metric}=${configured} is below the ratchet ` +
          `floor ${floor}. A floor is raised as coverage improves and never ` +
          "lowered to make a change pass (repository-baseline-policy.md §4.2 C3).",
      ).toBeGreaterThanOrEqual(floor);
    }
  });

  it("the test runner actually enables coverage (C2 — reported, not just printed)", () => {
    const pkg = JSON.parse(
      readFileSync(join(REPO_ROOT, "package.json"), "utf-8"),
    ) as { scripts?: Record<string, string> };
    expect(pkg.scripts?.test ?? "").toMatch(/vitest run --coverage/);
  });
});
