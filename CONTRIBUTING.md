# Contributing to nousergon-auth

nousergon-auth is a shared, self-hosted identity service (Better Auth) used by Metron, Vires and future Nous Ergon products. Bug reports, PRs, and design discussion are all welcome — see [SECURITY.md](SECURITY.md) first if what you found is a vulnerability rather than a bug.

## Quick start

```bash
git clone https://github.com/nousergon/nousergon-auth.git
cd nousergon-auth
npm install
cp .env.example .env   # fill in RESEND_API_KEY, BETTER_AUTH_SECRET, etc.
npm test
```

You should see the suite (7 files, 40+ tests) pass with coverage above the floor enforced in `vitest.config.ts`.

To run the service locally:

```bash
npm run dev
```

## How to propose a change

1. Open an issue first for anything beyond a small fix, to align on shape — this is shared infrastructure, and a change here is inherited by every product that trusts it.
2. Branch from `main`, make the change, add or update tests for the behavior change.
3. Open a PR against `main` using the repository's PR template. Fill in what & why, the test plan, and the deploy-mechanism field.

## What review to expect

- CI (`typecheck + build`, including the test suite and its coverage gate) must be green before merge.
- A PR touching session issuance, token verification, or the allowlist gate gets the SOTA treatment by default — no expedient patch, no "works today" heuristic where a named correct procedure exists (see `AGENTS.md`'s "why the bar is higher here", inherited by every product that trusts this service).
- A maintainer reviews and merges; `.github/CODEOWNERS` names the reviewer of record.

## Style & requirements

- **Tests:** any behavior change ships with a test. `npm test` runs `vitest run --coverage`; the coverage floor in `vitest.config.ts` is a ratchet — raised as coverage improves, never lowered to make a change pass.
- **Types are the contract:** `npm run typecheck` must pass. This is an auth service — a type error hidden by `any` is a class of bug this project treats as unacceptable.
- **Fail loud:** don't add silent `catch { }` swallows. If a failure must degrade, log why and say so in the PR description.
- **Secrets never committed:** `.env` is gitignored; the tracked shape is `.env.example`. Real values live in SSM (deployed) or your own local `.env`.
- **Scope:** this service owns identity only (id, email, session) — never a tenant/workspace concept. A change that pushes product-specific tenant logic into this repo is out of scope; it belongs in the consuming product.

## Pull requests

Open a PR against `main` with a clear description and the test plan. CI must pass before merge. A PR must be deployable by the merge button alone — never describe a manual step to run after merging.

## Licensing of contributions

This project is licensed AGPL-3.0 (see [LICENSE](LICENSE)). By submitting a PR you agree your contribution is licensed under the same terms.
