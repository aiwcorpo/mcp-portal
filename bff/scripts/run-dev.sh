#!/usr/bin/env bash
# Runs the BFF on the host (port PORTAL_PORT, default 18090) against a running mcp-platform-dev (`make up`).
# Values are read from its .env and generated .secrets/dev.env on every start; nothing is copied here.
set -euo pipefail

bff_dir="$(cd "$(dirname "$0")/.." && pwd)"
dev_dir="${MCP_PLATFORM_DEV_DIR:-$bff_dir/../../mcp-platform-dev}"
dev_dir="$(cd "$dev_dir" && pwd)"

value() {
  local key="$1" found
  found="$(sed -n "s/^${key}=//p" "$dev_dir/.secrets/dev.env" "$dev_dir/.env" | tail -n 1)"
  if [[ -z "$found" ]]; then
    echo "missing $key in $dev_dir (.env or .secrets/dev.env); run make up there" >&2
    exit 1
  fi
  printf '%s' "$found"
}

export PORTAL_PORT="${PORTAL_PORT:-$(value PORTAL_PORT)}"
export PORTAL_OIDC_ISSUER_URI="http://localhost:$(value KEYCLOAK_PORT)/realms/corp"
export PORTAL_OIDC_CLIENT_SECRET="$(value KC_CLIENT_MCP_PORTAL_BFF_SECRET)"
export PORTAL_BROKER_URL="${PORTAL_BROKER_URL:-https://localhost:$(value BROKER_MOCK_PORT)}"
export PORTAL_BROKER_TLS_NAME="$(value MCP_BROKER_TLS_NAME)"
export PORTAL_GATEWAY_ADMIN_URL="${PORTAL_GATEWAY_ADMIN_URL:-https://localhost:$(value GATEWAY_ADMIN_MOCK_PORT)}"
export PORTAL_GATEWAY_ADMIN_TLS_NAME="$(value MCP_GATEWAY_INTERNAL_TLS_NAME)"
export PORTAL_GATEWAY_PUBLIC_URL="${PORTAL_GATEWAY_PUBLIC_URL:-http://localhost:$(value GATEWAY_PORT)}"
export PORTAL_TLS_KEYSTORE="$dev_dir/certs/mcp-portal-bff/keystore.p12"
export PORTAL_TLS_KEYSTORE_PASSWORD="$(value TLS_STORE_PASSWORD)"
export PORTAL_TLS_TRUSTSTORE="$dev_dir/certs/ca/truststore.p12"
export PORTAL_TLS_TRUSTSTORE_PASSWORD="$PORTAL_TLS_KEYSTORE_PASSWORD"
export PORTAL_WEB_DIST="${PORTAL_WEB_DIST:-$bff_dir/../web/dist/portal}"

cd "$bff_dir"
exec ./mvnw -q spring-boot:run
