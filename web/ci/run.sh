#!/usr/bin/env bash
# Single entry point of the web CI (M5-5). The same script runs on a workstation, in the container of ci/Dockerfile and
# from any CI system; .gitlab-ci.yml, Jenkinsfile and GitHub Actions workflows may only call it.
#
#   ci/run.sh                   all steps: style, lint, i18n, unit, build, e2e
#   ci/run.sh --container       the same inside the image built from ci/Dockerfile (needs docker)
#   CI_STEPS=style,unit ci/run.sh   a subset (comma separated)
#
# Pull requests: CI_STEPS=style is enough for a quick gate (it needs neither npm nor the contracts tarball); the
# default run is for the main branch.
#
# Needs Node 24 and the contracts tarball (a dev dependency): from the mcp-contracts checkout next to mcp-portal, from
# CONTRACTS_TARBALL (a file) or from CONTRACTS_TARBALL_URL (package server; CONTRACTS_TARBALL_SHA256 checks it).
# --container mounts only this directory and that tarball. The e2e step needs Chromium for Playwright (the image has it; locally: npx playwright install chromium)
# and uses port 18731.
set -euo pipefail
export CI=1

web_dir="$(cd "$(dirname "$0")/.." && pwd)"
contracts_name="$(grep -o 'aiwcorpo-mcp-contracts-[0-9][0-9.]*\.tgz' "$web_dir/package.json" | head -n 1)"
[[ -n "$contracts_name" ]] || { echo "ci: no mcp-contracts tarball in package.json" >&2; exit 2; }

# The dev dependency @aiwcorpo/mcp-contracts is a tarball at ../../mcp-contracts/release/<name>. A CI that checks out
# only this repository sets CONTRACTS_TARBALL_URL (package server) and, better, CONTRACTS_TARBALL_SHA256; a workstation
# next to the mcp-contracts checkout needs neither (CONTRACTS_TARBALL points at another local file).
fetch_contracts() {
  local target="$1"
  mkdir -p "$(dirname "$target")"
  if [[ -n "${CONTRACTS_TARBALL_URL:-}" ]]; then
    node -e '
      const [url, target] = process.argv.slice(1);
      fetch(url).then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.arrayBuffer(); })
        .then((b) => require("fs").writeFileSync(target, Buffer.from(b)))
        .catch((e) => { console.error("ci: download failed: " + e.message); process.exit(1); });
    ' "$CONTRACTS_TARBALL_URL" "$target" || return 1
  elif [[ -n "${CONTRACTS_TARBALL:-}" ]]; then
    cp "$CONTRACTS_TARBALL" "$target" || return 1
  else
    echo "ci: set CONTRACTS_TARBALL_URL or CONTRACTS_TARBALL (no mcp-contracts checkout next to this repository)" >&2
    return 1
  fi
  if [[ -n "${CONTRACTS_TARBALL_SHA256:-}" ]]; then
    local actual
    actual="$(node -e 'console.log(require("crypto").createHash("sha256").update(require("fs").readFileSync(process.argv[1])).digest("hex"))' "$target")"
    [[ "$actual" == "$CONTRACTS_TARBALL_SHA256" ]] || { echo "ci: sha256 of the tarball differs" >&2; return 1; }
  fi
}

if [[ "${1:-}" == "--container" ]]; then
  image="${CI_IMAGE:-mcp-portal-web-ci}"
  docker build -q -f "$web_dir/ci/Dockerfile" ${CI_BASE_IMAGE:+--build-arg "BASE_IMAGE=$CI_BASE_IMAGE"} -t "$image" "$web_dir/ci" >/dev/null
  # Only this directory and the contracts tarball go in, read-only: the parent directory also holds files that no
  # build needs (.secrets). The tree is copied without node_modules and dist, so `npm ci` in the container does
  # not replace the host's node_modules and the build does not write into the checkout.
  mounts=(-v "$web_dir:/src/web:ro")
  local_tarball="$web_dir/../../mcp-contracts/release/$contracts_name"
  [[ -n "${CONTRACTS_TARBALL:-}" ]] && local_tarball="$CONTRACTS_TARBALL"
  if [[ -z "${CONTRACTS_TARBALL_URL:-}" ]]; then
    [[ -f "$local_tarball" ]] || { echo "ci: $local_tarball not found (or set CONTRACTS_TARBALL_URL)" >&2; exit 1; }
    mounts+=(-v "$(cd "$(dirname "$local_tarball")" && pwd)/$(basename "$local_tarball"):/src/contracts.tgz:ro")
  fi
  exec docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp/ci-home -e CI=1 -e CI_STEPS="${CI_STEPS:-}" \
    -e CI_INSTALL=1 -e PW_WORKERS="${PW_WORKERS:-4}" -e CONTRACTS_TARBALL_URL="${CONTRACTS_TARBALL_URL:-}" \
    -e CONTRACTS_TARBALL_SHA256="${CONTRACTS_TARBALL_SHA256:-}" -e CONTRACTS_NAME="$contracts_name" \
    "${mounts[@]}" -w /tmp "$image" bash -c '
      set -euo pipefail
      mkdir -p /tmp/ws/mcp-portal/web /tmp/ws/mcp-contracts/release
      tar -C /src/web --exclude=./node_modules --exclude=./dist --exclude=./test-results --exclude=./.angular -cf - . \
        | tar -C /tmp/ws/mcp-portal/web -xf -
      if [[ -f /src/contracts.tgz ]]; then cp /src/contracts.tgz "/tmp/ws/mcp-contracts/release/$CONTRACTS_NAME"; fi
      cd /tmp/ws/mcp-portal/web && ci/run.sh'
fi

cd "$web_dir"

all_steps="style lint i18n unit build e2e"
requested="${CI_STEPS:-style,lint,i18n,unit,build,e2e}"
selected=""
IFS=',' read -r -a requested_list <<< "$requested"
for step in "${requested_list[@]}"; do
  [[ -n "$step" ]] || continue
  if [[ " $all_steps " != *" $step "* ]]; then
    echo "ci: unknown step '$step' (known: $all_steps)" >&2
    exit 2
  fi
  selected="$selected $step"
done
if [[ -z "${selected// /}" ]]; then
  echo "ci: no step selected" >&2
  exit 2
fi

# Steps are run in an `||` context, where `set -e` is off, so every command of a step ends with `|| return 1`.
needs_install=0
for step in $selected; do
  [[ "$step" == "style" ]] || needs_install=1
done
if [[ "$needs_install" == "1" && ( "${CI_INSTALL:-}" == "1" || ! -d node_modules ) ]]; then
  echo "== install"
  contracts_file="$web_dir/../../mcp-contracts/release/$contracts_name"
  if [[ ! -f "$contracts_file" ]]; then
    fetch_contracts "$contracts_file" || exit 1
  fi
  npm ci --no-audit --no-fund || { echo "ci: npm ci failed" >&2; exit 1; }
fi

step_style() {
  echo "== style"
  local bad=0 status
  local -a files=()
  while IFS= read -r -d '' file; do
    files+=("$file")
  done < <(find src e2e e2e-live scripts ci -type f ! -path 'src/app/api/generated/*' ! -name '*.png' -print0 2>/dev/null)
  files+=(README.md STATUS.md package.json Makefile)
  [[ "${#files[@]}" -gt 4 ]] || { echo "ci: no files to check" >&2; return 1; }
  perl -CSD -ne 'if (/[\x{00A0}\x{200B}\x{202F}\x{FEFF}\x{2018}\x{2019}\x{201C}\x{201D}\x{2026}]/) { print "$ARGV:$.: hidden or typographic character\n"; $bad = 1 } close ARGV if eof; END { exit $bad }' "${files[@]}" || bad=1
  status=0
  grep -niE '[a]s an ai|[g]enerated with|[c]o-authored-by: claude|[l]orem ipsum|[y]our-api-key|[e]xample\.com' "${files[@]}" || status=$?
  if [[ "$status" -eq 0 ]]; then
    bad=1
  elif [[ "$status" -ne 1 ]]; then
    echo "ci: grep failed with status $status" >&2
    bad=1
  fi
  return "$bad"
}

step_lint() { echo "== lint"; npm run lint || return 1; }
step_i18n() { echo "== i18n"; npm run i18n:check || return 1; }

step_unit() {
  echo "== unit"
  local log
  log="$(mktemp)"
  npm test 2>&1 | tee "$log"
  if [[ "${PIPESTATUS[0]}" -ne 0 ]]; then rm -f "$log"; return 1; fi
  local total
  total="$(perl -pe 's/\e\[[0-9;]*m//g' "$log" | perl -ne '$t = $1 if /Tests\s+(?:\d+ failed \| )?(\d+) passed/; END { print $t + 0 }')"
  rm -f "$log"
  echo "unit tests run: $total"
  [[ "$total" -gt 0 ]] || { echo "ci: no unit test ran" >&2; return 1; }
}

step_build() {
  echo "== build"
  npm run build || return 1
  [[ -s dist/portal/index.html ]] || { echo "ci: build left no dist/portal/index.html" >&2; return 1; }
}

step_e2e() {
  echo "== e2e"
  local log
  log="$(mktemp)"
  npm run e2e 2>&1 | tee "$log"
  if [[ "${PIPESTATUS[0]}" -ne 0 ]]; then rm -f "$log"; return 1; fi
  local passed
  passed="$(perl -ne '$p = $1 if /^\s*(\d+) passed/; END { print $p + 0 }' "$log")"
  rm -f "$log"
  echo "e2e tests passed: $passed"
  [[ "$passed" -gt 0 ]] || { echo "ci: no e2e test ran" >&2; return 1; }
}

failed=0
for step in $selected; do
  "step_$step" || failed=1
done
if [[ "$failed" -ne 0 ]]; then
  echo "ci: FAILED" >&2
  exit 1
fi
echo "ci: OK"
