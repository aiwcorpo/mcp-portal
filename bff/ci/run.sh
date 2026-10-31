#!/usr/bin/env bash
# Single entry point of the BFF CI (M5-5). The same script runs on a workstation, in the container of ci/Dockerfile and
# from any CI system; .gitlab-ci.yml, Jenkinsfile and GitHub Actions workflows are only allowed to call it.
#
#   ci/run.sh                  all steps: style, build
#   ci/run.sh --container      the same inside the image built from ci/Dockerfile (needs docker and ~/.m2 with mcp-contracts)
#   CI_STEPS=style ci/run.sh   a subset (comma separated: style, build)
#
# Needs a JDK 25 (JAVA_HOME or PATH) for the build step and mcp-contracts 5.1.0 in the local Maven repository.
set -euo pipefail

bff_dir="$(cd "$(dirname "$0")/.." && pwd)"

if [[ "${1:-}" == "--container" ]]; then
  repo_root="$(cd "$bff_dir/.." && pwd)"
  image="${CI_IMAGE:-mcp-portal-bff-ci}"
  docker build -q -f "$bff_dir/ci/Dockerfile" ${CI_BASE_IMAGE:+--build-arg "BASE_IMAGE=$CI_BASE_IMAGE"} -t "$image" "$bff_dir/ci" >/dev/null
  mkdir -p "$HOME/.m2"
  exec docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp/ci-home -e CI_STEPS="${CI_STEPS:-}" \
    -v "$repo_root:/work" -v "$HOME/.m2:/tmp/ci-home/.m2" -w /work/bff "$image" ci/run.sh
fi

cd "$bff_dir"
steps=",${CI_STEPS:-style,build},"

step_style() {
  echo "== style"
  local files
  files="$(find src ci scripts dev -type f ! -name '*.p12' ! -name '*.jar' 2>/dev/null; ls README.md STATUS.md pom.xml Makefile)"
  local bad=0
  # shellcheck disable=SC2086
  if perl -ne 'if (/[\x{00A0}\x{200B}\x{202F}\x{FEFF}\x{2018}\x{2019}\x{201C}\x{201D}\x{2026}]/) { print "$ARGV:$.: hidden or typographic character\n"; $bad = 1 } close ARGV if eof; END { exit $bad }' -CSD $files; then :; else bad=1; fi
  # shellcheck disable=SC2086
  if grep -niE '[a]s an ai|[g]enerated with|[c]o-authored-by: claude|[l]orem ipsum|[y]our-api-key|[e]xample\.com' $files; then bad=1; fi
  return $bad
}

step_build() {
  echo "== build"
  local java_bin="${JAVA_HOME:+$JAVA_HOME/bin/}java"
  "$java_bin" -version 2>&1 | grep -q 'version "25' || { echo "JDK 25 is required (JAVA_HOME or PATH)" >&2; return 1; }
  ./mvnw -B -ntp verify
  local total
  total="$(perl -ne '$t += $1 if /<testsuite [^>]*\btests="(\d+)"/; END { print $t + 0 }' target/surefire-reports/TEST-*.xml)"
  echo "tests run: $total"
}

failed=0
for step in style build; do
  if [[ "$steps" == *",$step,"* ]]; then
    "step_$step" || failed=1
  fi
done
if [[ "$failed" -ne 0 ]]; then
  echo "ci: FAILED" >&2
  exit 1
fi
echo "ci: OK"
