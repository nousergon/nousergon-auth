// src/email.ts — the transactional email sender the magic-link plugin calls into.
// "Fails loud" is a documented, load-bearing contract (see the module docstring): a
// missing credential must throw synchronously rather than silently swallowing a
// magic-link send. No real Resend credentials are used anywhere here.

import { afterEach, describe, expect, it } from "vitest";
import { sendEmail } from "./email.js";
import { withTestEnv } from "./test/helpers.js";

let restoreEnv: (() => void) | undefined;

afterEach(() => {
  restoreEnv?.();
  restoreEnv = undefined;
});

describe("sendEmail()", () => {
  it("throws when RESEND_API_KEY is not configured", async () => {
    restoreEnv = withTestEnv({ RESEND_API_KEY: undefined, EMAIL_SENDER: "no-reply@example.com" });
    await expect(
      sendEmail({ to: "user@example.com", subject: "hi", html: "<p>hi</p>" }),
    ).rejects.toThrow(/RESEND_API_KEY/);
  });

  it("throws when EMAIL_SENDER is not configured, even if RESEND_API_KEY is set", async () => {
    restoreEnv = withTestEnv({
      RESEND_API_KEY: "not-a-real-key-just-a-test-fixture",
      EMAIL_SENDER: undefined,
    });
    await expect(
      sendEmail({ to: "user@example.com", subject: "hi", html: "<p>hi</p>" }),
    ).rejects.toThrow(/EMAIL_SENDER/);
  });
});
