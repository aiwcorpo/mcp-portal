#!/usr/bin/env bash
# Single entry point of the BFF CI (M5-5). The same script runs on a workstation, in the container of ci/Dockerfile and
# from any CI system; .gitlab-ci.yml, Jenkinsfile and GitHub Actions workflows only call it.
#
#   ci/run.sh                  all steps: style, build
#   ci/run.sh --container      the same inside the image built from ci/Dockerfile (needs docker and ~/.m2 with mcp-contracts)
#   CI_STEPS=style ci/run.sh   a subset (comma separated: style, build); an unknown or empty list is an error
#
# Needs a JDK 25 (JAVA_HOME or PATH) for the build step and the mcp-contracts artifacts either in ~/.m2 or in the registry
# named by MCP_MAVEN_REPOSITORY_URL (+ _USER, _PASSWORD; settings in .ci/settings.xml). CI_MVNW replaces ./mvnw (tests).
set -euo pipefail

bff_dir="$(cd "$(dirname "$0")/.." && pwd)"

if [[ "${1:-}" == "--container" ]]; then
  repo_root="$(cd "$bff_dir/.." && pwd)"
  image="${CI_IMAGE:-mcp-portal-bff-ci}"
  docker build -q -f "$bff_dir/ci/Dockerfile" ${CI_BASE_IMAGE:+--build-arg "BASE_IMAGE=$CI_BASE_IMAGE"} -t "$image" "$bff_dir/ci" >/dev/null
  mkdir -p "$HOME/.m2"
  exec docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp/ci-home ${CI_STEPS+-e "CI_STEPS=$CI_STEPS"} \
    -e MCP_MAVEN_REPOSITORY_URL -e MCP_MAVEN_REPOSITORY_USER -e MCP_MAVEN_REPOSITORY_PASSWORD \
    -v "$repo_root:/work" -v "$HOME/.m2:/tmp/ci-home/.m2" -w /work/bff "$image" ci/run.sh
fi

cd "$bff_dir"
requested="${CI_STEPS-style,build}"
[[ -n "$requested" ]] || { echo "ci/run.sh: CI_STEPS is empty" >&2; exit 2; }
IFS=, read -r -a steps <<< "$requested"
for step in "${steps[@]}"; do
  [[ "$step" == "style" || "$step" == "build" ]] || { echo "ci/run.sh: unknown step '$step' (style, build)" >&2; exit 2; }
done

# No step runs under `if` or `||` as a whole (that would switch set -e off inside it), so every command ends in `|| return 1`.
step_style() {
  echo "== style"
  local files=() bad=0 file
  while IFS= read -r -d '' file; do
    files+=("$file")
  done < <(find src ci scripts dev .ci README.md STATUS.md pom.xml Makefile -type f ! -name '*.p12' ! -name '*.jar' -print0) || return 1
  [[ "${#files[@]}" -gt 0 ]] || { echo "style: no files found" >&2; return 1; }
  # <<>> opens the names literally (plain <> would treat "|" or a leading "<" in a file name as a command or mode).
  perl -CSD -e 'while (<<>>) { if (/[\x{00A0}\x{200B}\x{202F}\x{FEFF}\x{2018}\x{2019}\x{201C}\x{201D}\x{2026}]/) { print "$ARGV:$.: hidden or typographic character\n"; $bad = 1 } close ARGV if eof } exit($bad // 0)' -- "${files[@]}" || bad=1
  grep -niE -- '[a]s an ai|[g]enerated with|[c]o-authored-by: claude|[l]orem ipsum|[y]our-api-key|[e]xample\.com' "${files[@]}" && bad=1
  return "$bad"
}

step_build() {
  echo "== build"
  if [[ -z "${JAVA_HOME:-}" ]] && ! command -v java >/dev/null; then
    echo "ci/run.sh: no JDK; set JAVA_HOME to a JDK 25 or use the image of ci/Dockerfile" >&2
    return 1
  fi
  local java_bin="${JAVA_HOME:+$JAVA_HOME/bin/}java"
  "$java_bin" -version 2>&1 | grep -q 'version "25' || { echo "JDK 25 is required (JAVA_HOME or PATH)" >&2; return 1; }
  local mvnw="${CI_MVNW:-./mvnw}" args=(-B -ntp)
  if [[ -n "${MCP_MAVEN_REPOSITORY_URL:-}" ]]; then
    args+=(-s .ci/settings.xml)
  fi
  # clean: the count below is read from reports of this run only.
  "$mvnw" "${args[@]}" clean verify || return 1
  local total
  total="$(perl -e 'while (<<>>) { $t += $1 if /<testsuite [^>]*\btests="(\d+)"/ } print $t + 0' -- target/surefire-reports/TEST-*.xml)" || return 1
  echo "tests run: $total"
  [[ "$total" -gt 0 ]] || { echo "build: no tests ran" >&2; return 1; }
}

failed=0
for step in "${steps[@]}"; do
  "step_$step" || failed=1
done
if [[ "$failed" -ne 0 ]]; then
  echo "ci: FAILED" >&2
  exit 1
fi
echo "ci: OK"
