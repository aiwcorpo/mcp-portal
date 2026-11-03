#!/usr/bin/env bash
# Sourced by the scripts of this directory: select_jdk exports a JDK 25 as JAVA_HOME. The build targets Java 25 (class
# file 69); an older JDK fails with UnsupportedClassVersionError. The current JDK is kept when it is new enough,
# otherwise the usual places are searched (macOS java_home, Homebrew, /usr/lib/jvm, SDKMAN, IntelliJ). Works in bash 3.2.

java_major() {
  "$1" -XshowSettings:properties -version 2>&1 | sed -n 's/.*java.specification.version = //p' | head -n 1
}

jdk_is_25() {
  local major
  [[ -x "$1/bin/java" ]] || return 1
  major="$(java_major "$1/bin/java" 2>/dev/null || true)"
  [[ -n "$major" ]] && [[ "${major%%.*}" -ge 25 ]] 2>/dev/null
}

select_jdk() {
  local candidate brewed
  if [[ -n "${JAVA_HOME:-}" ]] && jdk_is_25 "$JAVA_HOME"; then
    return 0
  fi
  if command -v java >/dev/null 2>&1; then
    candidate="$(dirname "$(dirname "$(command -v java)")")"
    if jdk_is_25 "$candidate"; then
      export JAVA_HOME="$candidate"
      return 0
    fi
  fi
  if [[ -x /usr/libexec/java_home ]]; then
    candidate="$(/usr/libexec/java_home -v 25 2>/dev/null || true)"
    if [[ -n "$candidate" ]] && jdk_is_25 "$candidate"; then
      export JAVA_HOME="$candidate"
      return 0
    fi
  fi
  if command -v brew >/dev/null 2>&1; then
    brewed="$(brew --prefix openjdk@25 2>/dev/null || true)"
    for candidate in "$brewed/libexec/openjdk.jdk/Contents/Home" "$brewed/libexec"; do
      if [[ -n "$brewed" ]] && jdk_is_25 "$candidate"; then
        export JAVA_HOME="$candidate"
        return 0
      fi
    done
  fi
  for candidate in /usr/lib/jvm/*25* "$HOME"/.sdkman/candidates/java/25* "$HOME"/.jdks/*25*; do
    if jdk_is_25 "$candidate"; then
      export JAVA_HOME="$candidate"
      return 0
    fi
  done
  echo "JDK 25 not found: set JAVA_HOME to a JDK 25 or use the maven:3.9.12-eclipse-temurin-25 image" >&2
  return 1
}
