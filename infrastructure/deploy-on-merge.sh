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

# Pin the WHOLE toolchain (install/build/migrate) to node-22, matching the unit's
# runtime: native modules (better-sqlite3) must be built against the SAME ABI they
# run under — the first live deploy crash-looped on NODE_MODULE_VERSION 108 vs 127
# because npm ran under the box-default Node 18 (EOL; box-wide swap is
# nous-ergon-ops#17, after which this shim and the unit's node-22 pin both retire).
# A shim dir is needed because npm lifecycle scripts resolve `node` via PATH and
# /usr/bin/node still points at node-18.
NODE_SHIM=$(mktemp -d)
trap 'rm -rf "$NODE_SHIM"' EXIT
ln -sf /usr/bin/node-22 "$NODE_SHIM/node"
ln -sf /usr/bin/npm-22 "$NODE_SHIM/npm"
ln -sf /usr/bin/npx-22 "$NODE_SHIM/npx"
export PATH="$NODE_SHIM:$PATH"
echo "toolchain: node $(node --version), npm $(npm --version)"

npm install --no-audit --no-fund --silent || { echo "npm install FAILED"; exit 1; }
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
