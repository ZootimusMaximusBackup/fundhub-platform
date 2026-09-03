#!/usr/bin/env bash
# scripts/sim/with-prod-env.sh — run a sim push tool against LIVE with the
# production secrets pulled from Netlify at run time. Nothing is printed, nothing
# is written to disk. Needs `netlify` logged in on this machine.
#
#   scripts/sim/with-prod-env.sh push-credit  --email … --profile funding
#   scripts/sim/with-prod-env.sh push-payment --email …
#
# CLAUDE.md §11: DATABASE_URL is read, never repointed. INNGEST_EVENT_KEY stays
# whatever it is on Netlify — it is exported here so the events the push tools
# emit reach the workflow engine exactly as a live pull's would.
set -euo pipefail
tool="${1:-}"; shift || true
case "$tool" in
  push-credit|push-payment) ;;
  *) echo "usage: $0 push-credit|push-payment [args]" >&2; exit 2 ;;
esac
cd "$(dirname "$0")/../.."
export DATABASE_URL="$(netlify env:get DATABASE_URL --context production)"
export INNGEST_EVENT_KEY="$(netlify env:get INNGEST_EVENT_KEY --context production)"
if [ "$tool" = "push-payment" ]; then
  export COMMAS_WEBHOOK_SECRET="$(netlify env:get COMMAS_WEBHOOK_SECRET --context production)"
fi
[ -n "$DATABASE_URL" ] || { echo "DATABASE_URL came back empty from netlify env:get" >&2; exit 1; }
exec node "scripts/sim/$tool.mjs" "$@"
