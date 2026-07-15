import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Explicit dist/ exclusion (belt-and-suspenders): dist/ is gitignored and the
    // build now excludes *.test.ts (see tsconfig.build.json), but a locally
    // pre-existing dist/ from an older build could otherwise still match vitest's
    // default include glob and get double-run as compiled .test.js.
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
