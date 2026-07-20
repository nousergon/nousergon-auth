// src/confirm-page.ts — the interstitial that stands between the emailed link and
// better-auth's token-consuming verify GET (see the module docstring for why this
// exists). Covers: branding per product, the verify URL surviving into the page
// intact (and only via the JSON payload, not interpolated raw into HTML/JS), and the
// `</script>`-breakout guard.

import { describe, expect, it } from "vitest";
import { renderConfirmPage } from "./confirm-page.js";

describe("renderConfirmPage()", () => {
  it("renders Vires branding and embeds the verify URL in the JSON payload", () => {
    const html = renderConfirmPage(
      "https://auth.nousergon.ai/api/auth/magic-link/verify?token=abc",
      "vires",
    );
    expect(html).toContain("Sign in to Vires");
    expect(html).not.toContain("Metron");
    expect(html).toContain("https://auth.nousergon.ai/api/auth/magic-link/verify?token=abc");
  });

  it("renders Metron branding for product='metron'", () => {
    const html = renderConfirmPage(
      "https://auth.nousergon.ai/api/auth/magic-link/verify?token=xyz",
      "metron",
    );
    expect(html).toContain("Sign in to Metron");
    expect(html).not.toContain("Vires");
  });

  it("does not fetch or navigate to the verify URL on its own — only wires it to a click handler", () => {
    const html = renderConfirmPage(
      "https://auth.nousergon.ai/api/auth/magic-link/verify?token=abc",
      "vires",
    );
    // The verify URL must appear ONLY inside the JSON payload script, never as a
    // meta-refresh, auto-navigating <script>, or bare href that a prefetcher's HTML
    // parser (as opposed to its JS engine) could follow on its own.
    expect(html).not.toMatch(/<meta[^>]+http-equiv=["']refresh["']/i);
    expect(html).not.toContain(`href="https://auth.nousergon.ai/api/auth/magic-link/verify`);
    expect(html).toContain("addEventListener('click'");
  });

  it("escapes a literal </script> in the verify URL so it can't break out of the JSON block", () => {
    const html = renderConfirmPage(
      "https://auth.nousergon.ai/api/auth/magic-link/verify?token=</script><script>alert(1)</script>",
      "vires",
    );
    expect(html).not.toContain("</script><script>alert(1)");
  });
});
