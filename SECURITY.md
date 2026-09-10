# Security Policy

## Reporting a vulnerability

If you find a security vulnerability in nousergon-auth, please report it privately:

- **Preferred:** open a [GitHub Security Advisory](https://github.com/nousergon/nousergon-auth/security/advisories/new). This keeps the discussion private until a fix ships.
- **Alternative:** email `security@nousergon.ai` with a description and reproduction steps.

Please **do not** open a public issue for security reports. We aim to acknowledge within 72 hours and ship a fix or mitigation within 14 days for high-severity issues — a shorter window than most projects, because a bug here is inherited by every product that trusts this service (see "Why the bar is higher" below).

## Scope

nousergon-auth is a shared, self-hosted identity service (Better Auth) fronting sign-in for multiple products (Metron, Vires). The sensitive surface is **session/token issuance and verification**. In scope:

- **Session or token forgery/bypass:** anything that lets a request be treated as authenticated without a valid session cookie or JWT verified against this service's own JWKS.
- **Magic-link token handling:** premature consumption, replay, or leakage of a one-time sign-in token (see `src/confirm-page.ts` for the mitigation already in place against link-scanner prefetch).
- **Allowlist-gate bypass:** a signup reaching an account without a matching `allowedEmail` row for that product.
- **Cross-product boundary violations:** a session or token issued for one product (`metadata.product`) being accepted by another, or by a consumer with no legitimate claim to it.
- **Credential exposure:** any path that leaks `BETTER_AUTH_SECRET`, `RESEND_API_KEY`, or the SQLite database contents through logs, error responses, or telemetry.
- **Injection:** SQL injection against the `allowedEmail`/session tables, or unsafe handling of email/callback-URL input reaching a shell, redirect, or query.

Out of scope:

- DoS via traffic volume (single small-deployment shared box, not a public-scale service).
- Issues requiring access to the SSM parameter store or the EC2 instance itself (if that's compromised, the threat model has already failed).
- Vulnerabilities in upstream dependencies (`better-auth`, `better-sqlite3`) not yet publicly disclosed — report those upstream first.

## Threat model assumptions

- **Multi-product, single-tenant-per-product.** This service owns identity only (id, email, session); each product owns its own tenant/workspace mapping via `identity_user_id`. A vulnerability that lets one product's session cross into another is the highest-severity class here.
- **Credentials live in AWS SSM Parameter Store** (deployed) or `.env` (local, gitignored). Protect them with SSM/IAM permissions; rotate if exposed.
- **HTTPS** is assumed for all traffic to `auth.nousergon.ai` and between it and every consuming product.
- **The confirm-page interstitial (`src/confirm-page.ts`) is load-bearing**, not decorative — it exists specifically because a bare magic-link GET is auto-triggered by mail-client link scanners, burning the token before the human clicks (see the module's own comment for the incident this fixed). Any change that makes verification reachable without a real user click reopens that class.

## Hardening notes

- `npm run typecheck` and the test suite (`npm test`) gate every PR — types are treated as part of the contract for this service specifically because of the blast radius of a session-handling bug.
- Deploy is push-to-`main` → CI → SSM → `infrastructure/deploy-on-merge.sh`; there is no path that skips CI.
