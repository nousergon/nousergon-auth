// src/confirm-page.ts — the interstitial that stands between the emailed link and
// better-auth's token-consuming verify GET (see the module docstring for why this
// exists, and why the confirming click is a plain <a href> navigation rather than a
// script-initiated fetch — a fetch can't follow the verify endpoint's cross-origin
// redirect without CORS support on the product's own origin). Covers: branding per
// product, the verify URL landing intact in a real href (never auto-triggered on
// load), and HTML-attribute escaping.

import { describe, expect, it } from "vitest";
import { renderConfirmPage } from "./confirm-page.js";

describe("renderConfirmPage()", () => {
  it("renders Vires branding with the verify URL as the link's href", () => {
    const html = renderConfirmPage(
      "https://auth.nousergon.ai/api/auth/magic-link/verify?token=abc",
      "vires",
    );
    expect(html).toContain("Sign in to Vires");
    expect(html).not.toContain("Metron");
    expect(html).toContain(
      'href="https://auth.nousergon.ai/api/auth/magic-link/verify?token=abc"',
    );
  });

  it("renders Metron branding for product='metron'", () => {
    const html = renderConfirmPage(
      "https://auth.nousergon.ai/api/auth/magic-link/verify?token=xyz",
      "metron",
    );
    expect(html).toContain("Sign in to Metron");
    expect(html).not.toContain("Vires");
  });

  it("never auto-triggers the verify URL on page load — no meta-refresh, no auto-navigating script", () => {
    const html = renderConfirmPage(
      "https://auth.nousergon.ai/api/auth/magic-link/verify?token=abc",
      "vires",
    );
    // A prefetcher/scanner fetches this page's own HTML but never parses-and-follows
    // links inside it, so a plain unclicked <a href> is inert — that's the whole
    // point. There must be no OTHER mechanism (meta-refresh, <script> setting
    // location, auto-submitting form) that would fire without a real click.
    expect(html).not.toMatch(/<meta[^>]+http-equiv=["']refresh["']/i);
    expect(html).not.toContain("<script");
    expect(html).not.toContain("window.location");
  });

  it("HTML-attribute-escapes the verify URL so it can't break out of the href", () => {
    const html = renderConfirmPage(
      'https://auth.nousergon.ai/api/auth/magic-link/verify?token=x"><script>alert(1)</script>',
      "vires",
    );
    expect(html).not.toContain('"><script>alert(1)</script>');
    expect(html).toContain("&quot;&gt;&lt;script&gt;");
  });
});
