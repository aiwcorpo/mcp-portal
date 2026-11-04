#!/usr/bin/env bash
# Puts the mcp-contracts tarball named in package.json into .contracts/ (ignored by git), where npm reads it from.
# The tarball is a published artifact of mcp-contracts, so the sources are tried in this order:
#
#   1. .contracts/<name> already there (CONTRACTS_TARBALL_SHA256, when set, is checked)
#   2. CONTRACTS_TARBALL=<file>             a tarball on disk
#   3. CONTRACTS_TARBALL_URL=<url>          a package server
#   4. CONTRACTS_SOURCE_DIR=<checkout>      `npm pack` in a checkout of mcp-contracts at the release tag (dist/ built there)
#   5. CONTRACTS_FROM_NPMJS=1               `npm pack` of the published package from the public registry (npmjs), no token;
#                                           CONTRACTS_TARBALL_SHA256 should be set, since it pins the bytes
#
# After mcp-contracts is published to npmjs, the dependency in package.json becomes a registry version and
# there is nothing to prepare. When it is a registry version ("6.3.2" instead of a file: path) there is nothing to prepare.
set -euo pipefail

web_dir="$(cd "$(dirname "$0")/.." && pwd)"
spec="$(node -e 'console.log(require(process.argv[1]).devDependencies["@aiwcorpo/mcp-contracts"] || "")' "$web_dir/package.json")"
case "$spec" in
  file:*) ;;
  "") echo "contracts: @aiwcorpo/mcp-contracts is not a devDependency" >&2; exit 2 ;;
  *) echo "contracts: dependency is the registry version $spec, nothing to prepare"; exit 0 ;;
esac
relative="${spec#file:}"
name="$(basename "$relative")"
target="$web_dir/$relative"
version="${name#aiwcorpo-mcp-contracts-}"
version="${version%.tgz}"

sha256_of() {
  node -e 'console.log(require("crypto").createHash("sha256").update(require("fs").readFileSync(process.argv[1])).digest("hex"))' "$1"
}

check_sha() {
  [[ -z "${CONTRACTS_TARBALL_SHA256:-}" ]] && return 0
  [[ "$(sha256_of "$1")" == "$CONTRACTS_TARBALL_SHA256" ]] || { echo "contracts: sha256 of $1 differs from CONTRACTS_TARBALL_SHA256" >&2; return 1; }
}

mkdir -p "$(dirname "$target")"

if [[ -f "$target" ]]; then
  check_sha "$target"
  echo "contracts: $relative is there"
  exit 0
fi

if [[ -n "${CONTRACTS_TARBALL:-}" ]]; then
  cp "$CONTRACTS_TARBALL" "$target"
elif [[ -n "${CONTRACTS_TARBALL_URL:-}" ]]; then
  node -e '
    const [url, target] = process.argv.slice(1);
    fetch(url).then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.arrayBuffer(); })
      .then((b) => require("fs").writeFileSync(target, Buffer.from(b)))
      .catch((e) => { console.error("contracts: download failed: " + e.message); process.exit(1); });
  ' "$CONTRACTS_TARBALL_URL" "$target"
elif [[ -n "${CONTRACTS_SOURCE_DIR:-}" ]]; then
  packed="$(cd "$CONTRACTS_SOURCE_DIR" && npm pack --silent --pack-destination "$(dirname "$target")" | tail -n 1)"
  if [[ "$packed" != "$name" ]]; then
    rm -f "$(dirname "$target")/$packed"
    echo "contracts: the checkout produced $packed, package.json wants $name (check out the tag v$version)" >&2
    exit 1
  fi
elif [[ "${CONTRACTS_FROM_NPMJS:-}" == "1" ]]; then
  # From an empty directory, so no .npmrc of the checkout can redirect the scope to another registry.
  scratch="$(mktemp -d)"
  trap 'rm -rf "$scratch"' EXIT
  (cd "$scratch" && npm pack --silent --registry https://registry.npmjs.org/ "@aiwcorpo/mcp-contracts@$version" \
    --pack-destination "$scratch" >/dev/null)
  cp "$scratch/$name" "$target"
else
  cat >&2 <<MSG
contracts: $relative is missing. Provide the tarball of mcp-contracts $version with one of:
  CONTRACTS_TARBALL=<file> (for example mcp-contracts/release/$name), CONTRACTS_TARBALL_URL=<url>
  CONTRACTS_SOURCE_DIR=<checkout at tag v$version> or CONTRACTS_FROM_NPMJS=1 (public registry).
MSG
  exit 1
fi

[[ -f "$target" ]] || { echo "contracts: $relative was not created" >&2; exit 1; }
check_sha "$target" || { rm -f "$target"; exit 1; }
echo "contracts: $relative ready"
