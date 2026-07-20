// Shared, self-hosted identity service for Nous Ergon products (Metron, Vires, and
// future products). Owns identity ONLY — id, email, session. Never a tenant/workspace
// concept: each product keeps its own local tenant table, mapped to this service's
// stable `user.id` via an `identity_user_id` column on its own User model. This is the
// standard shape for a shared IdP (how Auth0/Clerk/etc. work) — see the shared plan
// doc for the reasoning against having this service own per-product tenancy.
//
// better-auth's magic-link `verify` endpoint sets the session cookie AND redirects to
// the caller-supplied `callbackURL` itself (see node_modules/better-auth/dist/plugins
// /magic-link/index.mjs) — so no product needs its own "/auth/verify" page. Each
// product's sign-in call passes its own post-login callbackURL, e.g.
// `https://vires.nousergon.ai/app` or `https://metron.nousergon.ai/dash`.

import Database from "better-sqlite3";
import { betterAuth } from "better-auth";
import { magicLink } from "better-auth/plugins";
import { jwt } from "better-auth/plugins/jwt";
import { allowlistGate } from "./allowlist-gate.js";
import { magicLinkEmail, type Product } from "./magic-link-templates.js";
import { sendEmail } from "./email.js";

function trustedOrigins(): string[] {
  return (process.env.AUTH_TRUSTED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// Factory, not just a module-level singleton, so tests can construct an isolated
// instance pointed at a throwaway sqlite file (via `databasePath`) instead of sharing
// the process-wide `./auth.sqlite` / AUTH_DATABASE_URL target. Config/plugin wiring is
// otherwise identical to the runtime singleton below.
export function createAuth(options: { databasePath?: string } = {}) {
  const db = new Database(options.databasePath ?? process.env.AUTH_DATABASE_URL ?? "./auth.sqlite");

  return betterAuth({
    database: db,
    baseURL: process.env.AUTH_BASE_URL ?? "http://localhost:4100",
    secret: process.env.BETTER_AUTH_SECRET,
    trustedOrigins: trustedOrigins(),
    // Explicitly enabled — better-auth's own default gates on NODE_ENV=production,
    // which nothing on the box sets, so the limiter was silently OFF in prod until
    // 2026-07-11 (nousergon-auth#4). Global ceiling here; the magic-link plugin
    // additionally registers its own tighter per-path rule (5 requests / 60s per IP).
    rateLimit: {
      enabled: true,
      window: 10,
      max: 100,
    },
    advanced: {
      // Session cookie set on the parent domain so it's readable by every
      // *.nousergon.ai product host — the mechanism the JWT/JWKS plugin below exists
      // specifically to complement for non-Node (Python/FastAPI) backends, which can't
      // read this cookie directly and instead verify a short-lived JWT minted off it.
      crossSubDomainCookies: {
        enabled: true,
        domain: process.env.AUTH_COOKIE_DOMAIN ?? ".nousergon.ai",
      },
      // Rate-limit keys need the TRUE client IP: this origin sits behind Cloudflare
      // (orange-cloud) → nginx, so the socket peer is always the edge/proxy.
      // cf-connecting-ip is set by Cloudflare itself; x-forwarded-for is the
      // fallback for any non-CF path. NOTE: a direct-to-origin caller could spoof
      // these headers — locking the origin to Cloudflare IP ranges is tracked as
      // follow-up hardening on nousergon-auth#4.
      ipAddress: {
        ipAddressHeaders: ["cf-connecting-ip", "x-forwarded-for"],
      },
    },
    // No databaseHooks.user.create hook here — deliberately. Tenant/workspace minting
    // is each product's own responsibility now (JIT-provisioned on first authenticated
    // request, matched by this service's stable user.id), not this service's.
    plugins: [
      // Listed first: registers a hooks.before on /sign-in/magic-link that gates new
      // signups behind a per-product admin EMAIL ALLOWLIST (Brian's 2026-07-10 ruling
      // on vires#93 — allowlist over invite codes; restored 2026-07-11 after the
      // original gate silently adopted Metron's code model instead). Returning users
      // (existing `user` row) always pass. See allowlist-gate.ts for the full contract.
      allowlistGate(),
      magicLink({
        sendMagicLink: async ({ email, url, metadata }) => {
          const product = (metadata?.product as Product | undefined) ?? "metron";
          // The email links to OUR confirm interstitial, not `url` (the verify
          // endpoint) directly — see confirm-page.ts for why: a bare GET link
          // atomically and irreversibly consumes the one-time token, which mail
          // clients' own link-safety prefetching silently does before the human's
          // real click lands.
          const confirmUrl = new URL(
            "/confirm",
            process.env.AUTH_BASE_URL ?? "http://localhost:4100",
          );
          confirmUrl.searchParams.set("verify", url);
          confirmUrl.searchParams.set("product", product);
          await sendEmail({
            to: email,
            subject: `Sign in to ${product === "vires" ? "Vires" : "Metron"}`,
            html: magicLinkEmail(confirmUrl.toString(), product),
            text: `Sign in: ${confirmUrl.toString()}`,
          });
        },
      }),
      // Issues short-lived, verifiable JWTs (GET /token) + exposes a JWKS endpoint
      // (GET /jwks) so each product's own backend (Python/FastAPI for both Metron and
      // Vires) can verify a caller's identity locally — cached JWKS, periodic refresh —
      // without a synchronous round-trip to this service on every request.
      jwt({
        jwt: {
          issuer: process.env.AUTH_BASE_URL ?? "http://localhost:4100",
          expirationTime: "15m",
          // Keep the token payload minimal and stable: `sub` (this service's user.id)
          // is the only thing downstream products key off of. No product-specific
          // claims belong here — see the module docstring on why tenancy stays local
          // to each product.
          definePayload: ({ user }) => ({ sub: user.id, email: user.email }),
        },
      }),
    ],
  });
}

// Local SQLite file. Seeded from Metron's original auth.sqlite at cutover (see the
// shared plan doc, Part 0) so Brian's existing account carries over byte-for-byte.
// Postgres later is a drop-in dialect swap if load ever justifies it — not needed for
// a 1-2-user fleet.
export const auth = createAuth();
