#!/usr/bin/env bash
# Builds the images of the portal from a git ref (default HEAD): the jar and the single-page application are built in a
# temporary copy made with `git archive`, so the working tree is not touched and uncommitted changes are not in the image.
#
#   scripts/build-images.sh [ref]
#
# Result: mcp-portal-bff:<prefix>-<sha>, mcp-portal-web:<prefix>-<sha> and mcp-portal:<prefix>-<sha> (targets bff, web and
# portal of the Dockerfile), prefix m6 unless IMAGE_TAG_PREFIX says otherwise; IMAGE_TAG replaces the whole tag (a release). Nothing is pushed: IMAGE_REGISTRY, when set
# (for example ghcr.io/aiwcorpo), only changes the names, and pushing is a separate, deliberate step.
#
# NGINX_IMAGE overrides the nginx base image of the web target.
#
# Needs git, docker, JDK 25 (bff/scripts/select-jdk.sh finds it), Node 24 and the mcp-contracts artifacts: Maven jars in
# ~/.m2 or in the registry of MCP_MAVEN_REPOSITORY_URL (+ _USER, _PASSWORD), the npm tarball through web/scripts/contracts.sh
# (CONTRACTS_TARBALL, CONTRACTS_TARBALL_URL or CONTRACTS_SOURCE_DIR; a tarball already in
# web/.contracts/ of this checkout is used as it is).
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
ref="${1:-HEAD}"
prefix="${IMAGE_TAG_PREFIX:-m6}"
registry="${IMAGE_REGISTRY:+${IMAGE_REGISTRY%/}/}"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# shellcheck source=../bff/scripts/select-jdk.sh
source "$repo_root/bff/scripts/select-jdk.sh"
select_jdk || exit 1

short="$(git -C "$repo_root" rev-parse --short "$ref")"
tag="${IMAGE_TAG:-${prefix}-${short}}"
git -C "$repo_root" archive "$ref" | tar -x -C "$work"

echo "== bff"
bff_args=(-B -ntp -DskipTests)
if [[ -n "${MCP_MAVEN_REPOSITORY_URL:-}" ]]; then
  bff_args+=(-s .ci/settings.xml)
fi
(cd "$work/bff" && ./mvnw "${bff_args[@]}" package)

echo "== web"
contracts_name="$(grep -o 'aiwcorpo-mcp-contracts-[0-9][0-9.]*\.tgz' "$work/web/package.json" | head -n 1 || true)"
if [[ -n "$contracts_name" && -f "$repo_root/web/.contracts/$contracts_name" && -z "${CONTRACTS_TARBALL:-}" ]]; then
  export CONTRACTS_TARBALL="$repo_root/web/.contracts/$contracts_name"
fi
node_major="$(node -p 'process.versions.node.split(".")[0]')"
[[ "$node_major" -ge 24 ]] || { echo "Node 24 or newer is required (found $node_major)" >&2; exit 1; }
# --ignore-scripts: no install script of a dependency runs next to the credentials of a release job.
(cd "$work/web" && scripts/contracts.sh && npm ci --ignore-scripts --prefer-offline --no-audit --no-fund && npm run build)

echo "== images"
for target in bff web portal; do
  name="mcp-portal-$target"
  [[ "$target" == "portal" ]] && name="mcp-portal"
  docker build -q ${NGINX_IMAGE:+--build-arg "NGINX_IMAGE=$NGINX_IMAGE"} --target "$target" -t "${registry}${name}:${tag}" "$work" >/dev/null
  echo "${registry}${name}:${tag}"
done
