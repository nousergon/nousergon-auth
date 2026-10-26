#!/bin/bash
# deploy-on-merge.sh — refresh deps, rebuild, hydrate SSM-sourced config (secrets AND
# the trusted-origins allowlist), install/update the systemd unit + nginx fragment if
# they drifted, restart, health-check. Invoked via SSM from .github/workflows/deploy.yml
# AFTER the caller has already pulled this repo to its target ref. Mirrors
# metron/infrastructure/deploy-on-merge.sh's conventions.
#
# Runs as ec2-user (owns node_modules/dist); sudo only for systemctl/nginx reload
# (ec2-user has passwordless sudo on the box). Exits non-zero on a failed build or
# health check so the deploy is marked failed (fail loud).
set -uo pipefail

REPO=/home/ec2-user/nousergon-auth
echo "=== nousergon-auth deploy $(date -u +%FT%TZ) — $(git -C "$REPO" rev-parse --short HEAD) ==="

cd "$REPO"

# Pin the WHOLE toolchain (install/build/migrate) to node-${NODE_MAJOR}, matching the
# unit's runtime: native modules (better-sqlite3) must be built against the SAME ABI they
# run under — the first live deploy crash-looped on NODE_MODULE_VERSION 108 vs 127
# because npm ran under the box-default Node 18 (EOL; the box-wide swap is
# alpha-engine-config-I6094, after which this shim and the unit's pin both retire).
# A shim dir is needed because npm lifecycle scripts resolve `node` via PATH and
# /usr/bin/node still points at node-18.
#
# NODE_MAJOR must equal the major in nousergon-auth.service's ExecStart (asserted just
# below, and in src/deploy-node-runtime.test.ts). alpha-engine-config-I12116 moves the
# runtime to 24 in two PRs: this one adds the side-by-side install, the default-node
# assert and the ABI probe while still on 22 (a no-op on the current box); the second
# flips NODE_MAJOR and ExecStart together. Rolling back is a revert of the second PR
# alone — safe ONLY because the probe below stays and rebuilds for the older ABI.
NODE_MAJOR=22
UNIT_NODE=$(sed -n 's|^ExecStart=/usr/bin/node-\([0-9][0-9]*\) .*|\1|p' "$REPO/infrastructure/nousergon-auth.service")
[ "$UNIT_NODE" = "$NODE_MAJOR" ] || { echo "runtime mismatch: deploy builds with node-${NODE_MAJOR} but the unit runs node-${UNIT_NODE:-?} — flip NODE_MAJOR and ExecStart together"; exit 1; }

# Side-by-side install, idempotent, so a rebuilt/replaced box self-heals. The box-default
# /usr/bin/node is asserted unchanged: other Node services on this box use it.
DEFAULT_NODE=$(readlink -f /usr/bin/node)
if [ ! -x "/usr/bin/node-${NODE_MAJOR}" ]; then
  echo "installing nodejs${NODE_MAJOR} side-by-side"
  sudo dnf install -y "nodejs${NODE_MAJOR}" "nodejs${NODE_MAJOR}-npm" || { echo "nodejs${NODE_MAJOR} install FAILED"; exit 1; }
fi
[ "$(readlink -f /usr/bin/node)" = "$DEFAULT_NODE" ] || { echo "nodejs${NODE_MAJOR} install moved /usr/bin/node off ${DEFAULT_NODE} — box default changed, investigate"; exit 1; }

NODE_SHIM=$(mktemp -d)
trap 'rm -rf "$NODE_SHIM"' EXIT
ln -sf "/usr/bin/node-${NODE_MAJOR}" "$NODE_SHIM/node"
ln -sf "/usr/bin/npm-${NODE_MAJOR}" "$NODE_SHIM/npm"
ln -sf "/usr/bin/npx-${NODE_MAJOR}" "$NODE_SHIM/npx"
export PATH="$NODE_SHIM:$PATH"
echo "toolchain: node $(node --version), npm $(npm --version)"

npm install --no-audit --no-fund --silent || { echo "npm install FAILED"; exit 1; }

# `npm install` does NOT rebuild a native module already in node_modules when the node
# major changes (measured, alpha-engine-config-I12116: it exits 0 and leaves the old
# NODE_MODULE_VERSION in place), so a runtime switch — or its rollback — would deploy
# green and crash-loop the unit. Probe the ABI under the pinned node; rebuild on mismatch.
# >>> native-abi-probe
abi_probe() { node -e 'require("better-sqlite3")(":memory:").close()'; }
if probe_err=$(abi_probe 2>&1); then
  echo "better-sqlite3 ABI OK under node $(node --version)"
else
  echo "better-sqlite3 does not load under node $(node --version): $(printf '%s\n' "$probe_err" | grep -m1 'NODE_MODULE_VERSION' || printf '%s\n' "$probe_err" | head -n1)"
  echo "rebuilding better-sqlite3 against this ABI"
  npm rebuild better-sqlite3 || { echo "better-sqlite3 rebuild FAILED"; exit 1; }
  abi_probe || { echo "better-sqlite3 ABI probe FAILED after rebuild"; exit 1; }
  echo "better-sqlite3 rebuilt; ABI OK under node $(node --version)"
fi
# <<< native-abi-probe
npm run build || { echo "build FAILED"; exit 1; }

# Schema migration on EVERY deploy — idempotent (better-auth migrate only applies
# missing tables/columns). In the pipeline, not a hand-run step: the 2026-07-10
# hand-run migration silently never landed (SSM broke mid-session), which shipped a
# service whose /jwks 500'd on a missing table.
npm run migrate || { echo "schema migration FAILED"; exit 1; }

# Hydrate config from SSM Parameter Store into .env — SSM is the durable source of
# truth, .env is a generated cache refreshed every deploy, so a rebuilt/replaced box
# self-heals. Only the marked block is rewritten; hand-set lines are preserved. Values
# are written straight to the file and NEVER echoed (they'd leak into the GHA log).
# AUTH_TRUSTED_ORIGINS is included here even though it isn't a secret (plain String
# SSM parameter, not SecureString) — a hand-edited .env silently drifted from the
# intended allowlist in production (missing metron.nousergon.ai), which silently
# CORS-blocked Metron's client-side session check while the server-side fetch kept
# working, so the site showed "Sign in" for an already-authenticated user. Hydrating
# this value from SSM every deploy means a rebuilt/replaced box self-heals instead of
# drifting again. --with-decryption is a documented no-op on a plain String parameter
# (nothing to decrypt), so it's safe to reuse unmodified for a non-secret entry.
ENVF="$REPO/.env"
echo "=== hydrating SSM config → .env ==="
touch "$ENVF"
# .env holds BETTER_AUTH_SECRET and RESEND_API_KEY, and every service on this
# box runs as ec2-user — so at the umask default (0644: what `touch` creates, and
# `sed -i` below preserves whatever mode the file already has) every co-tenant
# can read them. 0600 costs nothing: systemd (pid 1) reads the EnvironmentFile
# as root, and `npm run migrate` runs as the owner. Set on EVERY deploy, not only
# on create, so a file born 0644 is corrected too — and BEFORE any secret is
# appended below. The dashboard box's unit-secrets check (nous-ergon-ops
# check_unit_secrets.py, run daily by ops-config-drift.service) fails any
# credential-bearing EnvironmentFile more permissive than 0640; Metron's deploy
# enforces the same contract for its env files (metron-ops-I275).
mode=$(stat -c %a "$ENVF")
if [ "$mode" != "600" ]; then
  chmod 600 "$ENVF" || { echo "env file mode FAILED: $ENVF"; exit 1; }
  echo "  $ENVF: mode $mode -> 600"
else
  echo "  $ENVF: mode 600"
fi
BLOCK=$(mktemp)
{
  echo "# >>> ssm-hydrated (managed by deploy-on-merge.sh — do not edit) >>>"
  for pair in \
    "BETTER_AUTH_SECRET:/nousergon-auth/better_auth_secret" \
    "RESEND_API_KEY:/nousergon-auth/resend_api_key" \
    "AUTH_TRUSTED_ORIGINS:/nousergon-auth/auth_trusted_origins"; do
    var=${pair%%:*}; path=${pair#*:}
    val=$(aws ssm get-parameter --region us-east-1 --name "$path" --with-decryption --query Parameter.Value --output text 2>/dev/null)
    [ -n "$val" ] && [ "$val" != "None" ] && printf '%s=%s\n' "$var" "$val"
  done
  echo "# <<< ssm-hydrated <<<"
} >> "$BLOCK"
HYDRATED=$(grep -cE '^[A-Z][A-Z0-9_]*=' "$BLOCK" || true)
sed -i '/# >>> ssm-hydrated/,/# <<< ssm-hydrated/d' "$ENVF"
cat "$BLOCK" >> "$ENVF"
rm -f "$BLOCK"
echo "  hydrated ${HYDRATED} var(s) from SSM (values not logged)"

# Install the tracked systemd unit + nginx fragment when the repo copy differs from
# the live one, so an edit deploys via the merge button alone.
if ! cmp -s "$REPO/infrastructure/nousergon-auth.service" /etc/systemd/system/nousergon-auth.service 2>/dev/null; then
  sudo cp "$REPO/infrastructure/nousergon-auth.service" /etc/systemd/system/nousergon-auth.service || { echo "unit install FAILED"; exit 1; }
  sudo systemctl daemon-reload
  echo "  installed nousergon-auth.service"
fi
if ! cmp -s "$REPO/infrastructure/nginx.conf" /etc/nginx/conf.d/nousergon-auth.conf 2>/dev/null; then
  sudo cp "$REPO/infrastructure/nginx.conf" /etc/nginx/conf.d/nousergon-auth.conf || { echo "nginx install FAILED"; exit 1; }
  sudo nginx -t && sudo systemctl reload nginx || { echo "nginx reload FAILED"; exit 1; }
  echo "  installed nginx.conf"
fi

sudo systemctl restart nousergon-auth

wait_for_200() {
  local url=$1 label=$2 tries=30 code
  for ((i = 1; i <= tries; i++)); do
    code=$(curl -s -o /dev/null -w '%{http_code}' "$url")
    case "$code" in
      200 | 307) echo "${label} healthy (HTTP $code, ${i}s)"; return 0 ;;
    esac
    sleep 1
  done
  echo "${label} health FAILED (last HTTP $code after ${tries}s)"
  return 1
}

wait_for_200 "http://127.0.0.1:4100/health" "nousergon-auth" || exit 1
echo "deploy OK — nousergon-auth healthy"
