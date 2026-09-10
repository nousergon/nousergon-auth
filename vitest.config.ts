import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Explicit dist/ exclusion (belt-and-suspenders): dist/ is gitignored and the
    // build now excludes *.test.ts (see tsconfig.build.json), but a locally
    // pre-existing dist/ from an older build could otherwise still match vitest's
    // default include glob and get double-run as compiled .test.js.
    exclude: ["**/node_modules/**", "**/dist/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "json"],
      // The whole `src` package, not just the files the suite happens to
      // import — repository-baseline-policy.md §4.2 C1/C5: a coverage number
      // computed only over touched files reports the tested subset as the
      // whole repository.
      include: ["src/**/*.ts"],
      exclude: ["**/*.test.ts", "src/test/**"],
      // repository-baseline-policy.md §4.2 C2: the floor must exit non-zero
      // below it, not merely print (`vitest run --coverage` fails the process
      // when a threshold isn't met). Raised as coverage improves, never
      // lowered to make a change pass (C3). No CI run had ever measured this
      // repo's coverage before this PR — first measured by this PR's own CI
      // run at statements 90.09%, branches 88.31%, functions 85.71%, lines
      // 90.62% over the whole `src/` package (nothing omitted — C1). Floor
      // set a point below each, per-metric, matching what was measured. See
      // CHANGELOG.md.
      thresholds: {
        statements: 90,
        branches: 88,
        functions: 85,
        lines: 90,
      },
    },
  },
});
