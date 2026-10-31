# Image for ci/run.sh: JDK 25 and the tools the script calls (bash, perl, grep). Sources and ~/.m2 are mounted by
# `ci/run.sh --container`; nothing is copied in, so the image does not change with the code.
ARG BASE_IMAGE=eclipse-temurin:25-jdk
FROM ${BASE_IMAGE}
RUN if ! command -v perl >/dev/null && command -v apt-get >/dev/null; then apt-get update -qq && apt-get install -y -qq --no-install-recommends perl bash grep && rm -rf /var/lib/apt/lists/*; fi
