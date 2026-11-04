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
# Needs Node 24 and the contracts tarball named in package.json, which scripts/contracts.sh puts in .contracts/ (ignored by
# git): from CONTRACTS_TARBALL (a file), CONTRACTS_TARBALL_URL (package server, CONTRACTS_TARBALL_SHA256 checks it),
# CONTRACTS_SOURCE_DIR (a checkout of mcp-contracts at the release tag) (npm pack there) or, with CONTRACTS_FROM_NPMJS=1, the public npm registry.
# --container mounts only this directory, read-only. The e2e step needs Chromium for Playwright (the image has it; locally:
# npx playwright install chromium) and uses port 18731.
set -euo pipefail
export CI=1

web_dir="$(cd "$(dirname "$0")/.." && pwd)"

if [[ "${1:-}" == "--container" ]]; then
  image="${CI_IMAGE:-mcp-portal-web-ci}"
  docker build -q -f "$web_dir/ci/Dockerfile" ${CI_BASE_IMAGE:+--build-arg "BASE_IMAGE=$CI_BASE_IMAGE"} -t "$image" "$web_dir/ci" >/dev/null
  # Only this directory goes in, read-only: the parent directory also holds files that no build needs (.secrets). The tree
  # is copied without node_modules and dist, so `npm ci` in the container does not replace the host's node_modules and the
  # build does not write into the checkout. A tarball or checkout given as a host path is fetched here, before the mount.
  if [[ -n "${CONTRACTS_TARBALL:-}" || -n "${CONTRACTS_SOURCE_DIR:-}" ]]; then
    "$web_dir/scripts/contracts.sh" || exit 1
  fi
  exec docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp/ci-home -e CI=1 -e CI_STEPS="${CI_STEPS:-}" \
    -e CI_INSTALL=1 -e PW_WORKERS="${PW_WORKERS:-4}" -e CONTRACTS_TARBALL_URL="${CONTRACTS_TARBALL_URL:-}" \
    -e CONTRACTS_TARBALL_SHA256="${CONTRACTS_TARBALL_SHA256:-}" -e CONTRACTS_FROM_NPMJS="${CONTRACTS_FROM_NPMJS:-}" \
    -v "$web_dir:/src/web:ro" -w /tmp "$image" bash -c '
      set -euo pipefail
      mkdir -p /tmp/ws/mcp-portal/web
      tar -C /src/web --exclude=./node_modules --exclude=./dist --exclude=./test-results --exclude=./.angular -cf - . \
        | tar -C /tmp/ws/mcp-portal/web -xf -
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
  scripts/contracts.sh || exit 1
  npm ci --no-audit --no-fund || { echo "ci: npm ci failed" >&2; exit 1; }
fi

step_style() {
  echo "== style"
  local bad=0 status
  local -a files=()
  while IFS= read -r -d '' file; do
    files+=("$file")
  done < <(find src e2e e2e-live scripts ci docker -type f ! -path 'src/app/api/generated/*' ! -name '*.png' -print0 2>/dev/null)
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
