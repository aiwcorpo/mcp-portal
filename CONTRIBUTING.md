# Contributing

The portal follows the contracts of `mcp-contracts` (C12 for the browser, C4 and C5 behind the BFF). A change that
needs a different contract starts as a `proposed` entry in `CONTRACT_CHANGES.md` of that repository and needs approval
before it is implemented here. The web client is generated from `portal-bff.v1.bundled.yaml`; nothing in
`web/src/app/api/generated` is edited by hand.

## Setup

Linux and macOS with bash 3.2 or newer; Windows only through WSL2. The BFF needs JDK 25 (found by
`bff/scripts/select-jdk.sh`), the web part Node 24 and npm 11. The `mcp-contracts` artifacts must be reachable: Maven
jars from `~/.m2` or from the registry named by `MCP_MAVEN_REPOSITORY_URL`, the npm tarball in `web/.contracts/`
(`web/scripts/contracts.sh`). See the README, "Instalacja z źródeł".

```bash
bff/ci/run.sh        # text checks, then clean verify
web/ci/run.sh        # text checks, lint, i18n, unit tests, build and the Playwright suite
```

Both must pass before a merge. `CI_STEPS=style` runs only the text checks (no non-ASCII quotes or spaces, no tool
traces in sources).

## Commits

Subject in English, imperative, up to 72 characters. The body describes the change, not the process. Tests go in the
same commit as the code they cover. Texts in the interface are English (the source language) and go through `$localize` with an id;
`npm run i18n:extract` updates `web/src/locale/messages.xlf`, and the Polish translation goes into `web/src/locale/messages.pl.xlf`
(`npm run i18n:check` fails on a missing one).

## License

Contributions are licensed under Apache-2.0 (see `LICENSE`).
