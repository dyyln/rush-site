#!/usr/bin/env bash
# Smoke test the running stack.
# Checks api /health, web / and /health on every agent in AGENT_URLS.
#
# Env overrides:
#   API_URL      default http://localhost:3001
#   WEB_URL      default http://localhost:3000
#   AGENT_URLS   comma separated. host.docker.internal is rewritten to localhost
#   RUSHSITE_AGENT_TOKEN  sent as bearer token to agents
set -uo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
if [[ -f "$REPO_DIR/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$REPO_DIR/.env"
  set +a
fi

API_URL="${API_URL:-http://localhost:3001}"
WEB_URL="${WEB_URL:-http://localhost:3000}"
AGENT_URLS="${AGENT_URLS:-http://localhost:8080}"
TIMEOUT="${SMOKE_TIMEOUT:-5}"

fail=0

check() {
  local name="$1" url="$2"
  shift 2
  local code
  code="$(curl -sS -o /tmp/rushsite-smoke.$$ -w '%{http_code}' --max-time "$TIMEOUT" "$@" "$url" 2>/dev/null)"
  if [[ "$code" =~ ^2 ]]; then
    printf 'ok    %-8s %s (%s)\n' "$name" "$url" "$code"
  else
    printf 'FAIL  %-8s %s (%s)\n' "$name" "$url" "${code:-no response}"
    fail=1
  fi
  if [[ "$name" == agent* && -s /tmp/rushsite-smoke.$$ ]]; then
    printf '      %s\n' "$(head -c 300 /tmp/rushsite-smoke.$$)"
  fi
  rm -f /tmp/rushsite-smoke.$$
}

check api "$API_URL/health"
check web "$WEB_URL/"

auth=()
if [[ -n "${RUSHSITE_AGENT_TOKEN:-}" ]]; then
  auth=(-H "Authorization: Bearer $RUSHSITE_AGENT_TOKEN")
fi

IFS=',' read -r -a agents <<< "$AGENT_URLS"
i=0
for a in "${agents[@]}"; do
  a="$(echo "$a" | xargs)"
  [[ -z "$a" ]] && continue
  # The container name does not resolve on the host.
  a="${a//host.docker.internal/localhost}"
  check "agent$i" "${a%/}/health" "${auth[@]}"
  i=$((i + 1))
done

if [[ $fail -ne 0 ]]; then
  echo "smoke test failed"
  exit 1
fi
echo "smoke test passed"
