// src/magic-link-templates.ts — pure HTML template function. Covers both Product
// branches and confirms the sign-in link itself is embedded (the one thing that must
// never be dropped from the template, or magic links would render un-clickable).

import { describe, expect, it } from "vitest";
import { magicLinkEmail } from "./magic-link-templates.js";

describe("magicLinkEmail()", () => {
  it("renders Metron branding for product='metron'", () => {
    const html = magicLinkEmail("https://auth.example.com/verify?token=abc", "metron");
    expect(html).toContain("Metron");
    expect(html).not.toContain("Vires");
    expect(html).toContain("https://auth.example.com/verify?token=abc");
  });

  it("renders Vires branding for product='vires'", () => {
    const html = magicLinkEmail("https://auth.example.com/verify?token=xyz", "vires");
    expect(html).toContain("Vires");
    expect(html).not.toContain("Metron");
    expect(html).toContain("https://auth.example.com/verify?token=xyz");
  });

  it("includes the sign-in URL twice (button href + plaintext fallback link)", () => {
    const url = "https://auth.example.com/verify?token=unique-marker-12345";
    const html = magicLinkEmail(url, "metron");
    const occurrences = html.split(url).length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });
});
