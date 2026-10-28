#!/usr/bin/env bash
# Runs the BFF on the host (port PORTAL_PORT, default 18090) against a running mcp-platform-dev (`make up`).
# Values are read from its .env and generated .secrets/dev.env on every start; nothing is copied here.
set -euo pipefail

bff_dir="$(cd "$(dirname "$0")/.." && pwd)"

# The build targets Java 25 (class file 69); an older JDK fails with UnsupportedClassVersionError.
java_bin="${JAVA_HOME:+$JAVA_HOME/bin/}java"
java_major="$("$java_bin" -XshowSettings:properties -version 2>&1 | sed -n 's/^ *java.specification.version = //p')"
if [[ -z "$java_major" || "$java_major" -lt 25 ]]; then
  echo "Java 25 is required (found: ${java_major:-none} from $java_bin). Set JAVA_HOME to a JDK 25, e.g." >&2
  echo "  export JAVA_HOME=/opt/homebrew/Cellar/openjdk@25/25.0.4.1/libexec/openjdk.jdk/Contents/Home" >&2
  exit 1
fi
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

# ws-07 owns host ports 18720-18729. The OIDC client of the realm lists the redirect URI of PORTAL_PORT from .env
# (18090) and, since CC-089, needs <PORTAL_PUBLIC_BASE_URL>/api/v1/auth/callback registered for this port too.
export PORTAL_PORT="${PORTAL_PORT:-18720}"
# Origin of the one public domain (portal, /api, /s/, /v/): the reverse proxy in front, or the BFF itself.
export PORTAL_PUBLIC_BASE_URL="${PORTAL_PUBLIC_BASE_URL:-http://localhost:$PORTAL_PORT}"
export PORTAL_OIDC_ISSUER_URI="http://localhost:$(value KEYCLOAK_PORT)/realms/corp"
export PORTAL_OIDC_CLIENT_SECRET="$(value KC_CLIENT_MCP_PORTAL_BFF_SECRET)"
export PORTAL_BROKER_URL="${PORTAL_BROKER_URL:-https://localhost:$(value BROKER_MOCK_PORT)}"
export PORTAL_BROKER_TLS_NAME="$(value MCP_BROKER_TLS_NAME)"
export PORTAL_GATEWAY_ADMIN_URL="${PORTAL_GATEWAY_ADMIN_URL:-https://localhost:$(value GATEWAY_ADMIN_MOCK_PORT)}"
export PORTAL_GATEWAY_ADMIN_TLS_NAME="$(value MCP_GATEWAY_INTERNAL_TLS_NAME)"
if [[ "${PORTAL_MOCKS:-}" == "1" ]]; then
  # C4 and C5 from ./scripts/run-mocks.sh: plain http, accepted only together with the dev profile.
  export PORTAL_BROKER_URL="http://127.0.0.1:${MOCK_BROKER_PORT:-18721}"
  export PORTAL_GATEWAY_ADMIN_URL="http://127.0.0.1:${MOCK_GATEWAY_ADMIN_PORT:-18722}"
  export PORTAL_TLS_INSECURE_PLAIN_HTTP_FOR_TESTS=true
fi
export PORTAL_TLS_KEYSTORE="$dev_dir/certs/mcp-portal-bff/keystore.p12"
export PORTAL_TLS_KEYSTORE_PASSWORD="$(value TLS_STORE_PASSWORD)"
export PORTAL_TLS_TRUSTSTORE="$dev_dir/certs/ca/truststore.p12"
export PORTAL_TLS_TRUSTSTORE_PASSWORD="$PORTAL_TLS_KEYSTORE_PASSWORD"
export PORTAL_WEB_DIST="${PORTAL_WEB_DIST:-$bff_dir/../web/dist/portal}"
export PORTAL_IGA_MOCK_FILE="${PORTAL_IGA_MOCK_FILE:-$bff_dir/dev/iga-mock.yaml}"
export SPRING_PROFILES_ACTIVE=dev

cd "$bff_dir"
exec ./mvnw -q spring-boot:run
