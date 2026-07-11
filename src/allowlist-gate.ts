// Allowlist gate — closes self-serve signup during each product's private beta.
// Replaces the invite-code gate (2026-07-11): Brian's 2026-07-10 ruling on
// nousergon/vires#93 chose an ADMIN EMAIL ALLOWLIST over invite codes — an admin
// pre-approves a specific address, keyed by the address itself, rather than a shared
// secret the user has to type in. The shared service's original gate adopted Metron's
// invite-code model and silently dropped that ruling; this restores it. Semantics are
// lifted from Vires's retired hand-rolled allowlist (api/routers/auth.py, pre-cutover)
// and extended with a `product` field so Metron-beta and Vires-beta approvals are
// separate pools sharing one table.
//
// Magic-link is the same endpoint for new and returning users, so gating happens on
// the shared `/sign-in/magic-link` request itself, BEFORE better-auth issues a token
// or sends any email:
//
//   - An email that already has an account (a `user` row exists) always passes — this
//     gate only blocks *new* signups, never re-entry for people already inside.
//   - A brand-new email must have an `allowedEmail` row for the REQUESTED PRODUCT
//     (the request's `metadata.product` field, "metron" | "vires"). No row -> 403.
//
// Unlike an invite code there is nothing to consume: the unique index on user.email
// already guarantees one account per address, so `usedAt`/`usedByEmail` are pure
// audit fields (mirrors the reasoning in Vires's original AllowedEmail model).
//
// Default ON (ALLOWLIST_GATE_ENABLED unset or "true") — a pre-launch access gate
// should default closed, not open.
//
// Approval provisioning: no admin panel yet (nousergon-auth#2). Seed rows directly:
//
//   sqlite3 auth.sqlite "INSERT INTO allowedEmail (id, email, product, createdAt) \
//     VALUES (lower(hex(randomblob(16))), 'friend@example.com', 'vires', datetime('now'));"

import { APIError } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import type { BetterAuthPlugin } from "better-auth";
import type { Product } from "./magic-link-templates.js";

export const ALLOWLIST_GATE_MESSAGES = {
  NOT_INVITED:
    "That email hasn't been invited yet — this product is in private beta.",
} as const;

export function allowlistGateEnabled(): boolean {
  return process.env.ALLOWLIST_GATE_ENABLED !== "false";
}

export function allowlistGate(): BetterAuthPlugin {
  return {
    id: "allowlist-gate",
    schema: {
      allowedEmail: {
        fields: {
          email: { type: "string", required: true },
          product: { type: "string", required: true },
          createdAt: { type: "date", required: true },
          // Audit-only (see module comment) — set on the first gated signup
          // that consumed the approval; never enforced.
          usedAt: { type: "date", required: false },
          note: { type: "string", required: false },
        },
      },
    },
    hooks: {
      before: [
        {
          matcher: (ctx) => ctx.path === "/sign-in/magic-link",
          handler: createAuthMiddleware(async (ctx) => {
            if (!allowlistGateEnabled()) return;

            const email = (ctx.body as { email?: unknown } | undefined)?.email;
            // Bail out to the endpoint's own zod validation for a malformed body
            // rather than passing a non-string into findUserByEmail (which calls
            // .toLowerCase() internally and would throw an unhandled 500).
            if (typeof email !== "string" || !email) return;

            const existingUser = await ctx.context.internalAdapter.findUserByEmail(email);
            if (existingUser) return; // returning user: never gated, only new signups are

            const metadata = (ctx.body as { metadata?: Record<string, unknown> } | undefined)
              ?.metadata;
            const product =
              typeof metadata?.product === "string" ? (metadata.product as Product) : undefined;
            if (!product) {
              throw new APIError("BAD_REQUEST", {
                message: 'metadata.product is required ("metron" | "vires").',
              });
            }

            const approvals = await ctx.context.adapter.findMany<{ id: string }>({
              model: "allowedEmail",
              where: [
                { field: "email", value: email.toLowerCase() },
                { field: "product", value: product },
              ],
              limit: 1,
            });
            if (approvals.length < 1) {
              throw new APIError("FORBIDDEN", { message: ALLOWLIST_GATE_MESSAGES.NOT_INVITED });
            }

            // Audit mark, best-effort by design: the approval row is a record, not a
            // consumable — failure to stamp usedAt must never block a legitimate
            // sign-in (recording surface: the row simply keeps usedAt=null).
            await ctx.context.adapter
              .updateMany({
                model: "allowedEmail",
                where: [
                  { field: "email", value: email.toLowerCase() },
                  { field: "product", value: product },
                ],
                update: { usedAt: new Date() },
              })
              .catch(() => {});
          }),
        },
      ],
    },
  };
}
