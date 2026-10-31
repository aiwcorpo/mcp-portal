# Image for ci/run.sh: Node 24 with Chromium and its system libraries for the e2e step, plus bash, perl and grep.
# Sources are mounted by `ci/run.sh --container`; nothing is copied in, so the image does not change with the code.
# The Playwright version must match @playwright/test in package.json (1.64.1).
ARG BASE_IMAGE=mcr.microsoft.com/playwright:v1.64.1-noble
FROM ${BASE_IMAGE}
RUN if ! command -v perl >/dev/null && command -v apt-get >/dev/null; then apt-get update -qq && apt-get install -y -qq --no-install-recommends perl bash grep && rm -rf /var/lib/apt/lists/*; fi
