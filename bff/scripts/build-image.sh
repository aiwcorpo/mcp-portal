#!/usr/bin/env bash
# Builds the BFF image mcp-portal-bff:m3-<sha> from a git ref of this repository (git archive into a temporary
# directory; the working tree is not touched), with the Dockerfile and entrypoint of mcp-platform-dev (read only).
# Usage: scripts/build-image.sh [ref]   (default HEAD). Needs JDK 25 in JAVA_HOME and docker.
set -euo pipefail

bff_dir="$(cd "$(dirname "$0")/.." && pwd)"
repo_root="$(git -C "$bff_dir" rev-parse --show-toplevel)"
dev_dir="${MCP_PLATFORM_DEV_DIR:-$repo_root/../mcp-platform-dev}"
ref="${1:-HEAD}"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

"${JAVA_HOME:?set JAVA_HOME to a JDK 25}/bin/java" -version 2>&1 | grep -q 'version "25' || { echo "JAVA_HOME is not a JDK 25" >&2; exit 1; }
for file in docker/bff.Dockerfile docker/bff-entrypoint.sh; do
  [[ -f "$dev_dir/$file" ]] || { echo "missing $dev_dir/$file" >&2; exit 1; }
done

short="$(git -C "$repo_root" rev-parse --short "$ref")"
git -C "$repo_root" archive "$ref" bff | tar -x -C "$work"
(cd "$work/bff" && ./mvnw -B -q package -DskipTests)
ctx="$work/ctx"
mkdir -p "$ctx"
cp "$(ls "$work"/bff/target/mcp-portal-bff-*.jar | grep -v original | head -1)" "$ctx/app.jar"
cp "$dev_dir/docker/bff-entrypoint.sh" "$ctx/bff-entrypoint.sh"
docker build -q -f "$dev_dir/docker/bff.Dockerfile" -t "mcp-portal-bff:m3-$short" "$ctx" >/dev/null
echo "mcp-portal-bff:m3-$short"
