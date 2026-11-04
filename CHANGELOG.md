# Changelog

Versions follow SemVer, newest first. Test images built before the first release are tagged `m<milestone>-<sha>`.

## 1.0.0

First release. It needs `mcp-contracts` 6.3.2 and a gateway on the same contracts.

- Portal for users: the MCP servers they may use, connecting accounts (OAuth, personal tokens, tokens with a login for the
  `Basic` scheme), requests for entitlements through the IGA adapter, the `/mcp` address with its filter, audit logs of
  their own calls, and the preview of a pending irreversible operation that is confirmed with a code from the Authenticator.
- Authenticator: registration with a QR code and a key shown once, lock after 5 wrong codes, switch-off after 20, removal
  with a fresh MFA.
- Administration: review and approval of tool definitions as a diff (including risk lowering and definitions reported
  by a running server), classification of the tools of foreign servers (read only), emergency switches for a server or a tool
  (switching off needs no MFA, lifting does; after the return from the IdP the action carries itself out).
- BFF (Java 25, Spring Boot 4.1): OIDC sign-in, server-side session, the C12 API, aggregation of the gateway, the broker and the
  IGA; the browser never gets a token or a secret. Optional TLS on the BFF port.
- Interface in English (source language) and Polish: one build, the language comes from the stored choice or the browser, a
  switch in the header and on the sign-in screen. Texts from the BFF and the contracts are shown as they arrive.
- Images from one `Dockerfile` (targets `bff`, `web`, `portal`), `ci/run.sh` for the BFF and the web part as the single CI entry
  point, screenshots in `docs/screenshots/en` and `docs/screenshots/pl`, Apache-2.0 licence, NOTICE, SECURITY.md, CONTRIBUTING.md.
- CI workflows run without a token or a secret; the contracts come from Maven Central and npmjs.

## Before 1.0.0

The milestones M1 to M6 were never released. Their changes are folded into 1.0.0; the last ones were the `/mcp` address with a
filter instead of saved links (M5, contracts 5.1.0) and the emergency switch, the classification of adapter tools, the login
field of the token form and the optional TLS port (M6, contracts 6.3.2).
