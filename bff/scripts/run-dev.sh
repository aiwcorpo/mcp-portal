#!/usr/bin/env bash
# Runs the BFF on the host (default port 18720). Two modes:
#   ./scripts/run-dev.sh                  against a running dev stack (`make up`); values are read from its .env
#                                         and generated .secrets/dev.env on every start, nothing is copied here;
#   PORTAL_MOCKS=1 ./scripts/run-dev.sh   C4/C5 from ./scripts/run-mocks.sh, no dev stack needed.
set -euo pipefail

bff_dir="$(cd "$(dirname "$0")/.." && pwd)"

# shellcheck source=select-jdk.sh
source "$bff_dir/scripts/select-jdk.sh"
select_jdk || exit 1
mocks=false
[[ "${PORTAL_MOCKS:-}" == "1" ]] && mocks=true

# Sibling repository with the dev stack. Only the real-stack mode needs it; with PORTAL_MOCKS=1 it is optional and,
# when present, still supplies the Keycloak client secret so that logging in through its realm works.
dev_dir="${MCP_PLATFORM_DEV_DIR:-$bff_dir/../../mcp-platform-dev}"
if [[ -d "$dev_dir" ]]; then
  dev_dir="$(cd "$dev_dir" && pwd)"
elif $mocks; then
  dev_dir=""
else
  echo "dev stack not found at $dev_dir." >&2
  echo "Check it out next to this repository or set MCP_PLATFORM_DEV_DIR; without it use PORTAL_MOCKS=1." >&2
  exit 1
fi

# Value from the dev stack files; empty when the stack is absent or lacks the key (fatal only outside mock mode).
value() {
  local key="$1" found=""
  if [[ -n "$dev_dir" ]]; then
    found="$(cat "$dev_dir/.env" "$dev_dir/.secrets/dev.env" 2>/dev/null | sed -n "s/^${key}=//p" | tail -n 1)"
  fi
  if [[ -z "$found" ]] && ! $mocks; then
    echo "missing $key in ${dev_dir:-the dev stack} (.env or .secrets/dev.env); run make up there" >&2
    exit 1
  fi
  printf '%s' "$found"
}

# ws-07 owns host ports 18720-18729. The OIDC client of the realm lists the redirect URI of PORTAL_PORT from .env
# (18090) and, since CC-089, needs <PORTAL_PUBLIC_BASE_URL>/api/v1/auth/callback registered for this port too.
export PORTAL_PORT="${PORTAL_PORT:-18720}"
# Origin of the one public domain (portal, /api, /s/, /v/): the reverse proxy in front, or the BFF itself.
export PORTAL_PUBLIC_BASE_URL="${PORTAL_PUBLIC_BASE_URL:-http://localhost:$PORTAL_PORT}"

if $mocks; then
  # C4 and C5 from ./scripts/run-mocks.sh: plain http, accepted only together with the dev profile, so no
  # certificates are needed. Explicit PORTAL_* variables win over everything below.
  keycloak_port="$(value KEYCLOAK_PORT)"
  if [[ -n "$keycloak_port" ]]; then
    default_issuer="http://localhost:$keycloak_port/realms/corp"
  else
    # No dev stack: the discovery stub of run-mocks.sh is enough for the BFF to start (login needs Keycloak).
    default_issuer="http://127.0.0.1:${MOCK_IDP_PORT:-18723}/realms/corp"
  fi
  export PORTAL_OIDC_ISSUER_URI="${PORTAL_OIDC_ISSUER_URI:-$default_issuer}"
  secret="$(value KC_CLIENT_MCP_PORTAL_BFF_SECRET)"
  export PORTAL_OIDC_CLIENT_SECRET="${PORTAL_OIDC_CLIENT_SECRET:-${secret:-local-dev-$RANDOM$RANDOM}}"
  export PORTAL_BROKER_URL="http://127.0.0.1:${MOCK_BROKER_PORT:-18721}"
  export PORTAL_GATEWAY_ADMIN_URL="http://127.0.0.1:${MOCK_GATEWAY_ADMIN_PORT:-18722}"
  export PORTAL_TLS_INSECURE_PLAIN_HTTP_FOR_TESTS=true
else
  # Plain assignments, so that a missing key stops the script (a failing $(...) inside `export` would not).
  keycloak_port="$(value KEYCLOAK_PORT)"
  client_secret="$(value KC_CLIENT_MCP_PORTAL_BFF_SECRET)"
  broker_port="$(value BROKER_MOCK_PORT)"
  broker_tls_name="$(value MCP_BROKER_TLS_NAME)"
  gateway_port="$(value GATEWAY_ADMIN_MOCK_PORT)"
  gateway_tls_name="$(value MCP_GATEWAY_INTERNAL_TLS_NAME)"
  store_password="$(value TLS_STORE_PASSWORD)"
  export PORTAL_OIDC_ISSUER_URI="${PORTAL_OIDC_ISSUER_URI:-http://localhost:$keycloak_port/realms/corp}"
  export PORTAL_OIDC_CLIENT_SECRET="${PORTAL_OIDC_CLIENT_SECRET:-$client_secret}"
  export PORTAL_BROKER_URL="${PORTAL_BROKER_URL:-https://localhost:$broker_port}"
  export PORTAL_BROKER_TLS_NAME="${PORTAL_BROKER_TLS_NAME:-$broker_tls_name}"
  export PORTAL_GATEWAY_ADMIN_URL="${PORTAL_GATEWAY_ADMIN_URL:-https://localhost:$gateway_port}"
  export PORTAL_GATEWAY_ADMIN_TLS_NAME="${PORTAL_GATEWAY_ADMIN_TLS_NAME:-$gateway_tls_name}"
  export PORTAL_TLS_KEYSTORE="${PORTAL_TLS_KEYSTORE:-$dev_dir/certs/mcp-portal-bff/keystore.p12}"
  export PORTAL_TLS_KEYSTORE_PASSWORD="${PORTAL_TLS_KEYSTORE_PASSWORD:-$store_password}"
  export PORTAL_TLS_TRUSTSTORE="${PORTAL_TLS_TRUSTSTORE:-$dev_dir/certs/ca/truststore.p12}"
  export PORTAL_TLS_TRUSTSTORE_PASSWORD="${PORTAL_TLS_TRUSTSTORE_PASSWORD:-$store_password}"
fi
export PORTAL_WEB_DIST="${PORTAL_WEB_DIST:-$bff_dir/../web/dist/portal}"
export PORTAL_IGA_MOCK_FILE="${PORTAL_IGA_MOCK_FILE:-$bff_dir/dev/iga-mock.yaml}"
export SPRING_PROFILES_ACTIVE=dev

cd "$bff_dir"
exec ./mvnw -q spring-boot:run
