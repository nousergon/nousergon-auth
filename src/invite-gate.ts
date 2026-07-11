// Invite gate — closes self-serve signup during each product's private beta. Lifted
// from Metron's web/lib/invite-gate.ts (metron-ops#18) and extended with a `product`
// field so Metron-beta and Vires-beta invite codes are separate pools sharing one
// table, rather than forking this file per product.
//
// Magic-link is the same endpoint for new and returning users, so gating happens on
// the shared `/sign-in/magic-link` request itself, BEFORE better-auth issues a token
// or sends any email:
//
//   - An email that already has an account (a `user` row exists) always passes — this
//     gate only blocks *new* signups, never re-entry for people already inside.
//   - A brand-new email must present a valid, unused invite code for the REQUESTED
//     PRODUCT (the magic-link request's `metadata.product` field, "metron" | "vires")
//     in `metadata.inviteCode`. Wrong/used/missing/wrong-product code -> 403.
//
// The code is consumed here, at request time (atomically, via a guarded SQL UPDATE),
// not when the emailed link is later clicked — see Metron's original comment for why
// (better-auth's magic-link plugin never round-trips `metadata` to the verify step).
//
// Default ON (INVITE_GATE_ENABLED unset or "true") — same rationale as Metron's
// original: a pre-launch access gate should default closed, not open.
//
// Code provisioning: no admin panel yet (tracked as a fast-follow, not silently
// dropped — see the shared PLAN's "out of scope" list). Seed rows directly, e.g.:
//
//   sqlite3 auth.sqlite "INSERT INTO inviteCode (id, code, product, createdAt) \
//     VALUES (lower(hex(randomblob(16))), 'VIRES-BETA-XXXX', 'vires', datetime('now'));"

import { APIError } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import type { BetterAuthPlugin } from "better-auth";
import type { Product } from "./magic-link-templates.js";

export const INVITE_GATE_MESSAGES = {
  INVITE_CODE_REQUIRED: "An invite code is required to sign up — this product is in private beta.",
  INVALID_INVITE_CODE: "That invite code isn't valid, has already been used, or is for a different product.",
} as const;

export function inviteGateEnabled(): boolean {
  return process.env.INVITE_GATE_ENABLED !== "false";
}

export function inviteGate(): BetterAuthPlugin {
  return {
    id: "invite-gate",
    schema: {
      inviteCode: {
        fields: {
          code: { type: "string", required: true, unique: true },
          product: { type: "string", required: true },
          createdAt: { type: "date", required: true },
          usedAt: { type: "date", required: false },
          usedByEmail: { type: "string", required: false },
          note: { type: "string", required: false },
        },
      },
    },
    hooks: {
      before: [
        {
          matcher: (ctx) => ctx.path === "/sign-in/magic-link",
          handler: createAuthMiddleware(async (ctx) => {
            if (!inviteGateEnabled()) return;

            const email = (ctx.body as { email?: unknown } | undefined)?.email;
            // Bail out to the endpoint's own zod validation for a malformed body rather
            // than passing a non-string into findUserByEmail (which calls
            // .toLowerCase() internally and would throw an unhandled 500).
            if (typeof email !== "string" || !email) return;

            const existingUser = await ctx.context.internalAdapter.findUserByEmail(email);
            if (existingUser) return; // returning user: never gated, only new signups are

            const metadata = (ctx.body as { metadata?: Record<string, unknown> } | undefined)?.metadata;
            const inviteCode = typeof metadata?.inviteCode === "string" ? metadata.inviteCode.trim() : "";
            const product = typeof metadata?.product === "string" ? (metadata.product as Product) : undefined;
            if (!product) {
              throw new APIError("BAD_REQUEST", { message: "metadata.product is required (\"metron\" | \"vires\")." });
            }
            if (!inviteCode) {
              throw new APIError("FORBIDDEN", { message: INVITE_GATE_MESSAGES.INVITE_CODE_REQUIRED });
            }

            // Guarded update: the WHERE clause requires usedAt IS NULL at the same
            // statement that sets it, so two concurrent requests for the same code
            // can't both report success — and the product must match the request, so a
            // Metron code can never unlock a Vires signup or vice versa. Codes stay in
            // the table (not deleted) so usage is auditable via usedByEmail.
            const updated = await ctx.context.adapter.updateMany({
              model: "inviteCode",
              where: [
                { field: "code", value: inviteCode },
                { field: "product", value: product },
                { field: "usedAt", value: null },
              ],
              update: { usedAt: new Date(), usedByEmail: email },
            });
            if (updated < 1) {
              throw new APIError("FORBIDDEN", { message: INVITE_GATE_MESSAGES.INVALID_INVITE_CODE });
            }
          }),
        },
      ],
    },
  };
}
