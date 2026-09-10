## What & why

<!-- What does this change and why? Link any related issue (`nousergon-auth-I<N>` or
`alpha-engine-config-I<N>` for tracked work). -->

## Checklist

- [ ] Tests added/updated for the behavior change
- [ ] `npm test` passes locally — the coverage floor in `vitest.config.ts` is a ratchet, raised as coverage improves and never lowered to make a change pass
- [ ] `npm run typecheck` and `npm run build` are clean
- [ ] No secrets committed (`.env`, SSM parameter values, `*.sqlite`) — use `.env.example` for shape
- [ ] Every product that trusts this service was considered — a session-handling change here is a cross-product incident, not a local one
- [ ] Fail-loud preserved — no new silent `catch { }` swallows

## Test plan

<!-- How you verified this works. -->

## Deploy-mechanism

<!-- Push to main → GHA (OIDC) → SSM → infrastructure/deploy-on-merge.sh. State N/A if this PR
carries no deploy-relevant change, or name any deliberate deviation. -->

## Attribution

<!-- Required for an agent-authored PR; omit this section for Dependabot/scanner PRs. -->
Prepared by: <model name> via [Claude Code](https://claude.com/claude-code)
