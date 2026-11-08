# Changelog

Versions follow SemVer, newest first. Test images built before the first release are tagged `m<milestone>-<sha>`.

## 2.0.0

Dynamic servers: no list of systems, servers or resource types is left in the portal. It needs `mcp-contracts` 7.0.0, a gateway
2.0.0 and a credential broker 2.0.0; it does not work with 1.x of either.

- Breaking: contracts 7.0.0. System, server, tool and resource type identifiers are patterns, not enumerations (the reserved
  system ids are refused); `needs_reconnect` is a new connection status, shown as `reconnect_required` in the catalog; the
  `/mcp` filter takes up to 20 systems.
- BFF: C12 administration of the gateway and the broker, with `ETag`, `If-Match` and `If-None-Match` passed through: servers
  (list, add, change, remove), the scope mapping, the emergency overrides, the pending policies and resource types of a server
  and their approval, and the systems of the broker (list, add, replace, remove; the client secret is write only and never
  returned or logged). A fresh MFA is required exactly where the contracts require it; an upstream `step_up_required` becomes the
  portal's own step-up. The BFF takes the registered servers and systems from the gateway and the broker instead of a built-in
  list, and the broker's `needs_reconnect` reaches the catalog.
- Web: administration screens for servers, systems, scope mapping and overrides, and the approval of policies and resource types
  next to the tool approvals; the user's connection page says plainly that an administrator's change deleted a connection. The
  names of systems come from the identifier, the generic instructions for a personal token replace the per-system texts, and the
  request dialog takes the systems from the catalog.
- Mock build and tests: the MSW mock keeps servers, systems, mapping and overrides as data (`?mockPolicies=in` puts policies up
  for approval); new unit and end-to-end tests for every screen; screenshots 21 to 25.
- Servers are added by address (CC-249): the gateway probes the certificate and pulls the manifest, and the administrator approves
  the connection (`ca`, `pinned` or `plain`) with a fresh MFA, then the policies and tools. BFF: `createAdminServer` takes
  `ServerAddRequest`, new `approveAdminServerConnection` and `refreshAdminServer` (`429 refresh_too_frequent`), `manifestReason`
  passed on in `server_rejected`, `409 connection_changed` and `no_pending_connection`, pending source `manifest` instead of `ci`.
  Web: add form with "Allow plain HTTP", status and badges per server, connection approval card, server details with Refresh;
  screenshots 26 to 28.
- Review fixes: replacing an override needs a fresh MFA (creating one does not); a malformed path identifier or `If-Match` is
  `400 invalid_request`, never 404; request bodies over 64 KB on `/api/v1/admin/**` are refused before they are read and the
  admin check comes first; system display names (administration pages only); the scope mapping page lists the approved resource
  types and scope patterns of the registered servers (new read of the approved policies of a server) and warns before the
  gateway refuses a scope; the OAuth return banner names a system only when it is in the catalog; the web `SystemId` pattern
  has the reserved ids; a kept policy approval is checked before it is resumed.
- Admin tokens after a step-up: the step-up login of an administrator asks for the admin audience scopes and the admin calls use one
  refresh grant narrowed to each audience instead of a token exchange. Keycloak 26.8.1 reports `acr: "password"` on every exchange, so an
  exchanged token never proved MFA; the narrowed refresh keeps `acr` and `auth_time`. The tokens stay in session memory for two minutes,
  other flows keep the exchange, and the exchange remains the fallback (`PORTAL_STEP_UP_ADMIN_TOKENS`, `PORTAL_STEP_UP_ADMIN_TOKEN_TTL`).
- Generic REST systems with user secrets (CC-247): the Systems form offers a generic REST system user secrets or a service account (one of
  them, no OAuth) and an optional check of the token (`whoami`: a path on the base address and the field of the answer that holds the user
  name; both validated, with the hint that without it the token is stored without a check). A connection carries `verified`; the
  connections page shows "Not verified" (no account name, no warning colour), and the token form warns before a token is stored again for
  a connection that was not verified and says after the store that the system does not check tokens. `backendUser` may be null. The
  C12 catalog now carries `userSecretVerified` (CC-248), so the token form warns before the first token too.
- Catalog names and the first token (CC-248): the catalog credential carries `displayName` and `userSecretVerified` from the broker. The
  pages for users (catalog, connections, requests, the request dialog, the MCP address, the disconnect dialog, the OAuth return banner for
  systems of the catalog) show the display name instead of the capitalised identifier, as inert text, and the token form warns before the
  very first token of a system that does not check tokens.
- Operation: after the upgrade the identity provider has to put `auth_time`, `acr` and `amr` into the tokens exchanged for the
  gateway and the broker, or every widening administration operation ends in `step_up_required` (see
  [bff/README.md](bff/README.md#fresh-mfa-for-the-administration-operations-identity-provider-settings)).

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
