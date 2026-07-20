// The magic-link plugin's `sendMagicLink` callback in auth.ts must email the confirm
// interstitial (confirm-page.ts), never better-auth's raw token-consuming verify URL
// — see confirm-page.ts's docstring for why a bare emailed GET is unsafe. Exercises
// the real sign-in-request flow end-to-end (POST /api/auth/sign-in/magic-link) with
// `sendEmail` mocked, and asserts on what would have actually been emailed.

import { afterEach, describe, expect, it, vi } from "vitest";

const sendEmailMock = vi.fn().mockResolvedValue(undefined);
vi.mock("./email.js", () => ({ sendEmail: sendEmailMock }));

const { createTestAuth, withTestEnv } = await import("./test/helpers.js");
type TestAuthContext = Awaited<ReturnType<typeof createTestAuth>>;

let ctx: TestAuthContext | undefined;
let restoreEnv: (() => void) | undefined;

afterEach(() => {
  ctx?.cleanup();
  ctx = undefined;
  restoreEnv?.();
  restoreEnv = undefined;
  sendEmailMock.mockClear();
});

describe("magic-link sendMagicLink → confirm-page URL", () => {
  it("emails a /confirm link carrying the verify URL, not the verify URL itself", async () => {
    restoreEnv = withTestEnv({
      BETTER_AUTH_SECRET: "test-only-secret-do-not-use-in-prod-0000",
      AUTH_BASE_URL: "https://auth.nousergon.ai",
      ALLOWLIST_GATE_ENABLED: "false",
    });
    ctx = await createTestAuth();

    const res = await ctx.auth.handler(
      new Request("https://auth.nousergon.ai/api/auth/sign-in/magic-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "friend@example.com",
          callbackURL: "https://vires.nousergon.ai/app/",
          metadata: { product: "vires" },
        }),
      }),
    );
    expect(res.status).toBe(200);

    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const { html, text } = sendEmailMock.mock.calls[0][0] as { html: string; text: string };

    expect(html).toContain("https://auth.nousergon.ai/confirm?verify=");
    expect(text).toContain("https://auth.nousergon.ai/confirm?verify=");

    // The confirm URL's `verify` param, once decoded, must be better-auth's own
    // verify endpoint carrying a real token — not dropped or pointed elsewhere.
    const match = html.match(/https:\/\/auth\.nousergon\.ai\/confirm\?verify=([^"&]+)&product=vires/);
    expect(match).not.toBeNull();
    const decoded = decodeURIComponent(match![1]);
    expect(decoded).toMatch(
      /^https:\/\/auth\.nousergon\.ai\/api\/auth\/magic-link\/verify\?token=.+/,
    );
  });
});
