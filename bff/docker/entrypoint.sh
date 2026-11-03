#!/bin/sh
# Tomcat's remoteip valve takes a regex of proxy addresses. Compose and Kubernetes networks have no fixed subnet, so
# with PORTAL_TRUSTED_PROXY_HOST the address of the one proxy is resolved at start (a recreated proxy needs a restart of
# the BFF). Without it PORTAL_TRUSTED_PROXIES is used as it is (README, "Konfiguracja").
set -eu
if [ -n "${PORTAL_TRUSTED_PROXY_HOST:-}" ]; then
  address="$(getent hosts "$PORTAL_TRUSTED_PROXY_HOST" | awk 'NR == 1 { print $1 }')"
  [ -n "$address" ] || { echo "cannot resolve $PORTAL_TRUSTED_PROXY_HOST" >&2; exit 1; }
  PORTAL_TRUSTED_PROXIES="$(printf '%s' "$address" | sed 's/\./[.]/g')"
  export PORTAL_TRUSTED_PROXIES
fi
exec java -XX:MaxRAMPercentage=75 -XX:+ExitOnOutOfMemoryError -jar /app/app.jar
