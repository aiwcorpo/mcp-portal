#!/usr/bin/env bash
# C4 (credential broker) and C5 (gateway admin) as WireMock processes on the host, with the stubs shipped in the
# mcp-contracts jar the BFF is built against. Plain http on 127.0.0.1, so the BFF needs PORTAL_MOCKS=1 (run-dev.sh).
# Swapping in the real services is a change of two addresses: PORTAL_BROKER_URL and PORTAL_GATEWAY_ADMIN_URL.
#
#   ./scripts/run-mocks.sh start|stop|status
#
# Ports 18721 (C4) and 18722 (C5) are in the range of ws-07 (18720-18729); override with MOCK_BROKER_PORT and
# MOCK_GATEWAY_ADMIN_PORT. `Prefer: example=<name>` picks another stub example (README of mcp-contracts, "Mocki").
set -euo pipefail

bff_dir="$(cd "$(dirname "$0")/.." && pwd)"
state_dir="$bff_dir/target/mocks"
broker_port="${MOCK_BROKER_PORT:-18721}"
gateway_port="${MOCK_GATEWAY_ADMIN_PORT:-18722}"
m2="${M2_REPO:-$HOME/.m2/repository}"

pom_property() {
  sed -n "s#.*<$1>\(.*\)</$1>.*#\1#p" "$bff_dir/pom.xml" | head -n 1
}

contracts_version="$(pom_property mcp-contracts.version)"
wiremock_version="$(pom_property wiremock.version)"
contracts_jar="$m2/pl/aiwcorpo/mcp/mcp-contracts/$contracts_version/mcp-contracts-$contracts_version.jar"
wiremock_jar="$m2/org/wiremock/wiremock-standalone/$wiremock_version/wiremock-standalone-$wiremock_version.jar"
java_bin="${JAVA_HOME:+$JAVA_HOME/bin/}java"

start_one() {
  local name="$1" port="$2" dir="$3"
  if [[ -f "$state_dir/$name.pid" ]] && kill -0 "$(cat "$state_dir/$name.pid")" 2>/dev/null; then
    echo "$name already running (pid $(cat "$state_dir/$name.pid"), port $port)"
    return
  fi
  if lsof -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "port $port is taken by another process; not starting $name" >&2
    exit 1
  fi
  nohup "$java_bin" -jar "$wiremock_jar" --bind-address 127.0.0.1 --port "$port" --root-dir "$dir" \
    >"$state_dir/$name.log" 2>&1 &
  echo $! >"$state_dir/$name.pid"
  echo "$name on http://127.0.0.1:$port (pid $!)"
}

stop_one() {
  local name="$1"
  if [[ -f "$state_dir/$name.pid" ]]; then
    kill "$(cat "$state_dir/$name.pid")" 2>/dev/null || true
    rm -f "$state_dir/$name.pid"
    echo "$name stopped"
  fi
}

case "${1:-}" in
  start)
    for jar in "$contracts_jar" "$wiremock_jar"; do
      [[ -f "$jar" ]] || { echo "missing $jar (run ./mvnw test once to download it)" >&2; exit 1; }
    done
    mkdir -p "$state_dir"
    unzip -oq "$contracts_jar" 'mcp-contracts/mocks/wiremock/*' -d "$state_dir/contracts"
    start_one credential-broker "$broker_port" "$state_dir/contracts/mcp-contracts/mocks/wiremock/credential-broker"
    start_one gateway-admin "$gateway_port" "$state_dir/contracts/mcp-contracts/mocks/wiremock/gateway-admin"
    ;;
  stop)
    stop_one credential-broker
    stop_one gateway-admin
    ;;
  status)
    for name in credential-broker gateway-admin; do
      if [[ -f "$state_dir/$name.pid" ]] && kill -0 "$(cat "$state_dir/$name.pid")" 2>/dev/null; then
        echo "$name running (pid $(cat "$state_dir/$name.pid"))"
      else
        echo "$name not running"
      fi
    done
    ;;
  *)
    echo "usage: $0 start|stop|status" >&2
    exit 2
    ;;
esac
