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

# require_real NAME VALUE — refuse a value that is empty or is Netlify's mask.
#
# A var stored with --secret comes back from `netlify env:get` as a short run of
# asterisks, not the key. Exporting that mask is silent: the tool signs real
# bytes with a fake key and the site answers 401 bad_signature, which reads like
# a broken signature and cost most of an afternoon on 2026-09-03 (F26). Four or
# more asterisks is not a key. The value itself is never printed.
require_real() {
  local name="$1" value="$2" stars
  if [ -z "$value" ]; then
    echo "$name came back EMPTY from netlify env:get" >&2
    exit 1
  fi
  stars="$(printf '%s' "$value" | tr -cd '*' | wc -c | tr -d ' ')"
  if [ "$stars" -ge 4 ]; then
    echo "$name came back MASKED from netlify env:get (it is stored with --secret)." >&2
    echo "Signing with the mask produces a 401 that looks like a signature bug." >&2
    echo "Use a key that is NOT stored with --secret, or export $name by hand." >&2
    exit 1
  fi
}

export DATABASE_URL="$(netlify env:get DATABASE_URL --context production)"
export INNGEST_EVENT_KEY="$(netlify env:get INNGEST_EVENT_KEY --context production)"
require_real DATABASE_URL "$DATABASE_URL"

if [ "$tool" = "push-payment" ]; then
  # SIM_WEBHOOK_SECRET is the one that has to read back whole — it is set
  # WITHOUT --secret precisely so it can. The site accepts it only for a receipt
  # carrying the `simulated` marker (src/adapters/commas.mjs), so it can never
  # post traffic that looks live.
  export SIM_WEBHOOK_SECRET="$(netlify env:get SIM_WEBHOOK_SECRET --context production 2>/dev/null || true)"
  require_real SIM_WEBHOOK_SECRET "$SIM_WEBHOOK_SECRET"
fi

exec node "scripts/sim/$tool.mjs" "$@"
