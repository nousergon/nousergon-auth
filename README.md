# nousergon-auth

[![CI](https://github.com/nousergon/nousergon-auth/actions/workflows/ci.yml/badge.svg)](https://github.com/nousergon/nousergon-auth/actions/workflows/ci.yml)
[![Coverage](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/nousergon/nousergon-auth/badges/coverage.json)](https://github.com/nousergon/nousergon-auth/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/nousergon/nousergon-auth)](LICENSE)

Shared, self-hosted identity service for Nous Ergon products (Metron, Vires, and
future products). Better Auth (magic-link + JWT/JWKS + allowlist-gate), running as its
own standalone Node process at `auth.nousergon.ai` — not embedded in any one product.

**Owns identity only** — id, email, session. Never a tenant/workspace concept: each
product keeps its own local tenant table, mapped to this service's stable `user.id`
via an `identity_user_id` column on its own User model. This is the standard shape for
a shared IdP (how Auth0/Clerk/etc. work) — see each product's own migration for how it
maps a verified identity to its local tenant.

## Why this exists

Metron and Vires each built their own magic-link auth independently — Metron with
Better Auth embedded in its Next.js process, Vires fully hand-rolled in FastAPI. This
service consolidates both onto one real, shared, self-hosted implementation instead of
two divergent ones. Self-hosted (not a third-party identity SaaS) because both
products hold personal financial/health data.

## How products integrate

- **Node/Next.js apps** (Metron): `better-auth/react`'s `createAuthClient({ baseURL: "https://auth.nousergon.ai" })` directly, cross-subdomain session cookie handles the rest.
- **Non-Node backends** (Vires's FastAPI, Metron's own FastAPI backend): verify a
  short-lived JWT (obtained client-side via `GET /api/auth/token`) against this
  service's JWKS (`GET /api/auth/jwks`) — cached locally, no per-request round trip.
- **Sign-in**: `authClient.signIn.magicLink({ email, callbackURL: "<product's own post-login URL>", metadata: { product: "metron" | "vires" } })`. The emailed link points directly at this service's own verify endpoint, which sets the session cookie and redirects to `callbackURL` itself — no product needs its own `/auth/verify` page.

## Development & testing

```
npm install
cp .env.example .env   # fill in RESEND_API_KEY, BETTER_AUTH_SECRET, etc.
npm run dev            # runs the service locally with tsx watch
```

Run the suite (typecheck, build, and vitest with coverage) the same way CI does:

```
npm run typecheck
npm run build
npm test                # vitest run --coverage
```

`npm test` exits non-zero if coverage drops below the floor in `vitest.config.ts` — a
ratchet, raised as coverage improves and never lowered to make a change pass. The
README's coverage badge above renders whatever CI last measured on `main`, published by
`scripts/publish_coverage_badge.sh`.

## Signup allowlist

New signups are gated on a per-product admin email allowlist (an admin pre-approves a
specific address — Brian's 2026-07-10 ruling on vires#93: allowlist over invite
codes). Returning users are never gated. No admin UI yet (tracked as a fast-follow).
Approve directly:

```
sqlite3 auth.sqlite "INSERT INTO allowedEmail (id, email, product, createdAt) \
  VALUES (lower(hex(randomblob(16))), 'friend@example.com', 'metron', datetime('now'));"
```

(The retired `inviteCode` table is dropped in a follow-up migration once the
allowlist gate is verified live.)

## Deploy

Runs on the shared dashboard EC2 box (`i-09b539c844515d549`), port 4100, behind its
own nginx fragment at `auth.nousergon.ai`. Push to `main` → GHA (OIDC) → SSM →
`infrastructure/deploy-on-merge.sh` rebuilds + restarts + health-checks. See
`infrastructure/` for the systemd unit and nginx config, tracked as source of truth.

## Further documentation

- [`CONTRIBUTING.md`](CONTRIBUTING.md) — how to propose a change, run the suite, and
  what review to expect.
- [`SECURITY.md`](SECURITY.md) — how to report a vulnerability and the response window.
- `infrastructure/` — systemd unit, nginx config, and the deploy script, tracked as the
  source of truth for the running service.
