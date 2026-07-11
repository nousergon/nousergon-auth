#!/bin/bash
# deploy-on-merge.sh — refresh deps, rebuild, hydrate SSM secrets, install/update the
# systemd unit + nginx fragment if they drifted, restart, health-check. Invoked via SSM
# from .github/workflows/deploy.yml AFTER the caller has already pulled this repo to
# its target ref. Mirrors metron/infrastructure/deploy-on-merge.sh's conventions.
#
# Runs as ec2-user (owns node_modules/dist); sudo only for systemctl/nginx reload
# (ec2-user has passwordless sudo on the box). Exits non-zero on a failed build or
# health check so the deploy is marked failed (fail loud).
set -uo pipefail

REPO=/home/ec2-user/nousergon-auth
echo "=== nousergon-auth deploy $(date -u +%FT%TZ) — $(git -C "$REPO" rev-parse --short HEAD) ==="

cd "$REPO"
npm install --no-audit --no-fund --silent || { echo "npm install FAILED"; exit 1; }
npm run build || { echo "build FAILED"; exit 1; }

# Hydrate secrets from SSM Parameter Store into .env — SSM is the durable source of
# truth, .env is a generated cache refreshed every deploy, so a rebuilt/replaced box
# self-heals. Only the marked block is rewritten; hand-set lines are preserved. Values
# are written straight to the file and NEVER echoed (they'd leak into the GHA log).
ENVF="$REPO/.env"
echo "=== hydrating SSM secrets → .env ==="
touch "$ENVF"
BLOCK=$(mktemp)
{
  echo "# >>> ssm-hydrated (managed by deploy-on-merge.sh — do not edit) >>>"
  for pair in \
    "BETTER_AUTH_SECRET:/nousergon-auth/better_auth_secret" \
    "RESEND_API_KEY:/nousergon-auth/resend_api_key"; do
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
