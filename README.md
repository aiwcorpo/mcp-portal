# mcp-portal

The portal of the MCP platform: the page where a user sees the MCP servers available to them, connects accounts in the
systems, submits requests for entitlements and builds the `/mcp` address with a filter, and where an administrator manages the
servers and systems of the platform at runtime, approves tool definitions and server policies, classifies the tools of foreign
servers, edits the scope mapping and the emergency overrides and, in an incident, switches a server or a tool off. The portal
holds no list of systems, servers or resource types: they come from the gateway (servers, catalog) and the credential broker
(systems). Two components in one repository:

| Directory | What it is | Description |
| --- | --- | --- |
| `bff/` | backend (Java 25, Spring Boot 4.1): OIDC sign-in, server-side session, the C12 API, aggregation of the gateway (C5), the broker (C4) and the IGA (C13); the browser gets no token and no secret | [bff/README.md](bff/README.md) |
| `web/` | frontend (Angular 22, Angular Material): only the C12 API, no hand-written API types | [web/README.md](web/README.md) |

Who it is for: operators and users of the platform. It is deployed as container images, it is not a library. Installation
and everyday operation of the whole platform: the `mcp-docs` repository (in preparation); this file covers what is needed to set
up and maintain the portal itself. Contracts: `mcp-contracts` 7.0.0. Licence: Apache-2.0 ([LICENSE](LICENSE), [NOTICE](NOTICE));
reporting vulnerabilities: [SECURITY.md](SECURITY.md); changes: [CHANGELOG.md](CHANGELOG.md); working on the code:
[CONTRIBUTING.md](CONTRIBUTING.md).

## Language

The interface is in English (the source language of the texts) and in Polish. The portal opens in the language the
browser asks for (Polish for `pl`, English otherwise); the button in the header (and on the sign-in screen) switches and
remembers the choice in the browser. The Polish texts are in `web/src/locale/messages.pl.xlf`, loaded as one JSON file
(`/i18n/messages.pl.json`) before the application starts, so there is one build, one image and no change in the BFF.
Texts that come from the BFF or from the contracts (error codes, descriptions from the servers) are shown as they arrive.

## Screenshots

Taken from the mock build (MSW; the data are the examples of the contract, a made-up user, no real account and no token),
in the light theme, 1280 x 800 px. English pictures are in `docs/screenshots/en/`, the same pictures with the Polish
interface (same file names) in `docs/screenshots/pl/`. To take them again: `cd web && npm run screenshots`.

| | |
| --- | --- |
| ![Sign-in with the company account (OIDC)](docs/screenshots/en/01-sign-in.png) Sign-in with the company account (OIDC). | ![MCP servers with status, action and the tools with their risk level](docs/screenshots/en/02-mcp-servers.png) MCP servers with status, action and the tools with their risk level. |
| ![System connections and the Authenticator](docs/screenshots/en/03-system-connections.png) System connections and the Authenticator. | ![A connection that lost its secret](docs/screenshots/en/04-connection-error.png) A connection that lost its secret: the row asks to connect the account again. |
| ![The `/mcp` address with the filter and ready commands for clients](docs/screenshots/en/05-mcp-address.png) The `/mcp` address with the filter and ready commands for clients. | ![Administration](docs/screenshots/en/06-admin-differences.png) Administration: differences between the approved and the pending definition. |
| ![Classification of a foreign server tool](docs/screenshots/en/07-tool-classification.png) Classification of a foreign server tool: the adapter is read only, so the dialog offers only Read and `read`. | ![Emergency switches](docs/screenshots/en/08-emergency-switch.png) Emergency switches: list of active ones, switching off without MFA, lifting after a fresh MFA. |
| ![A token in the Basic scheme (login and password or token)](docs/screenshots/en/09-form-with-login.png) A token in the Basic scheme (login and password or token): a login field next to the password or API token; the login does not come back from the server and does not reach the logs. | ![Authenticator registration, step "Add the account in the app"](docs/screenshots/en/10-authenticator-register-qr.png) Authenticator registration, step "Add the account in the app": QR code, key for manual entry and the time left. The code and the key come from the made-up seed of the mock. |
| ![Step "Enter the first code" with the error "Invalid code."](docs/screenshots/en/11-authenticator-register-code.png) Step "Enter the first code" with the error "Invalid code." | ![Authenticator active](docs/screenshots/en/12a-authenticator-active.png) Authenticator active. |
| ![Authenticator locked after 5 wrong codes; only time lifts the lock](docs/screenshots/en/12b-authenticator-locked.png) Authenticator locked after 5 wrong codes; only time lifts the lock. | ![Authenticator switched off after 20 wrong codes; it has to be registered again](docs/screenshots/en/12c-authenticator-disabled.png) Authenticator switched off after 20 wrong codes; it has to be registered again. |
| ![Preview of an irreversible operation waiting for a code](docs/screenshots/en/13-confirmation-preview.png) Preview of an irreversible operation waiting for a code: countdown, arguments, cancel button (made-up `jira__delete_issue`, key ABC-1182). | ![The same preview after cancelling](docs/screenshots/en/14a-operation-cancelled.png) The same preview after cancelling. |
| ![The same preview after the time ran out](docs/screenshots/en/14b-operation-expired.png) The same preview after the time ran out. | ![Adding a Jira token](docs/screenshots/en/15-add-token-jira.png) Adding a Jira token: instructions for a narrow token and an optional expiry date. |
| ![Audit logs with filters and an expanded row (request ID); results](docs/screenshots/en/16-audit-logs.png) Audit logs with filters and an expanded row (request ID); results: done, refused, waiting for confirmation. | ![Requests](docs/screenshots/en/17a-requests-list.png) Requests: the list with the statuses Pending, Approved, Rejected and Cancelled. |
| ![The "Submit request" form with the entitlement catalog](docs/screenshots/en/17b-requests-form.png) The "Submit request" form with the entitlement catalog. | ![The `keycloak-groups` adapter](docs/screenshots/en/17c-requests-not-accepted.png) The `keycloak-groups` adapter has no request flow: the catalog says that the platform administrator grants access, and no "Submit request" button is shown. |
| ![Administration](docs/screenshots/en/18a-risk-lowering-list.png) Administration: a tool marked "Risk lowering" with the definition differences. | ![The "Approve risk lowering?" dialog](docs/screenshots/en/18b-risk-lowering-dialog.png) The "Approve risk lowering?" dialog. |
| ![The "Approve a definition reported by the server?" dialog (source](docs/screenshots/en/19-server-definition-dialog.png) The "Approve a definition reported by the server?" dialog (source: server, not the pulled manifest). | ![Return after confirming identity](docs/screenshots/en/20-step-up-return.png) Return after confirming identity: "Identity confirmed. Lifting the switch..." |

| ![Servers of the gateway](docs/screenshots/en/21-servers.png) Servers of the gateway: add, edit, disable and remove. | ![A system whose address changed](docs/screenshots/en/22-system-address-changed.png) A system whose address changed: the form asks for the client secret again and warns that the user connections are deleted. |
| ![Scope mapping with errors](docs/screenshots/en/23-scope-mapping-errors.png) Scope mapping: errors of the form and the reason given by the gateway. | ![Emergency overrides](docs/screenshots/en/24-overrides.png) Emergency overrides. |
| ![Policies waiting for approval](docs/screenshots/en/25-policies-pending.png) Approvals: policies and resource types of a server next to the tool approvals. | ![Adding a server by its address](docs/screenshots/en/26-add-server.png) Adding a server by its address, with the plain HTTP option and its warning. |
| ![Approval of a connection](docs/screenshots/en/27-connection-approval.png) Approvals: the connection of a server (fingerprint, names, validity) is approved before its policies and tools. | ![Details of a server on plain HTTP](docs/screenshots/en/28-server-details-plain.png) Details of a server on plain HTTP: warning, connection, last check and Refresh. |

Pictures 21 to 28 show the 2.0.0 administration screens. Pictures 10 to 20 correspond to items 1 to 11 of the list in `mcp-docs/docs/screenshots-needed.md` (10 = item 1, 11 = item 2,
12a-12c = item 3, 13 = item 4, 14a-14b = item 5, 15 = item 6, 16 = item 7, 17a-17c = item 8, 18a-18b = item 9, 19 = item 10,
20 = item 11). Screenshots of client applications and the architecture drawing (items 12 to 15) are not taken from the portal.

## Installation

### From images

The images are built from the `Dockerfile` in the repository root. Names and tags after the first release:
`ghcr.io/aiwcorpo/mcp-portal-bff`, `ghcr.io/aiwcorpo/mcp-portal-web` and `ghcr.io/aiwcorpo/mcp-portal` (the BFF with the
application), tag `v<version>`. Until then the images are built locally (below) and tagged `m6-<sha>`.

| `Dockerfile` target | Image | Contents |
| --- | --- | --- |
| `bff` | `mcp-portal-bff` | the BFF, port 8080; the application is served by the reverse proxy in front of it |
| `web` | `mcp-portal-web` | nginx with the built application, port 8080, no state, read only |
| `portal` | `mcp-portal` | the BFF with the application inside (`PORTAL_WEB_DIST=/app/web`): one container, one origin |

The portal is meant to be exposed under one domain together with the gateway (`/mcp`, `/s/`) and its own API (`/api`), so a
reverse proxy stands in front of it; the reference configuration is in `examples/compose` of `mcp-docs` (`proxy/`, `compose.yaml`).
The simplest start is the `portal` target:

```bash
docker run -d --name mcp-portal -p 8080:8080 \
  -e PORTAL_PUBLIC_BASE_URL=<public address of the portal, https> \
  -e PORTAL_OIDC_ISSUER_URI=<OIDC issuer, the same as in the tokens> \
  -e PORTAL_OIDC_CLIENT_ID=mcp-portal-bff \
  -e PORTAL_OIDC_CLIENT_SECRET=<secret of the confidential client> \
  -e PORTAL_BROKER_URL=https://<broker>:8443 -e PORTAL_BROKER_TLS_NAME=<name in the broker certificate> \
  -e PORTAL_GATEWAY_ADMIN_URL=https://<gateway>:8443 -e PORTAL_GATEWAY_ADMIN_TLS_NAME=<name in the gateway certificate> \
  -e PORTAL_TLS_KEYSTORE=/certs/keystore.p12 -e PORTAL_TLS_KEYSTORE_PASSWORD=<password> \
  -e PORTAL_TLS_TRUSTSTORE=/certs/truststore.p12 -e PORTAL_TLS_TRUSTSTORE_PASSWORD=<password> \
  -e PORTAL_IGA_ADAPTER=keycloak-groups -e PORTAL_IGA_CATALOG_FILE=/config/iga-catalog.yaml \
  -v "$PWD/certs:/certs:ro" -v "$PWD/config:/config:ro" \
  mcp-portal:<tag>
```

Requirements that the BFF checks at start and refuses to start without: `https` under `PORTAL_PUBLIC_BASE_URL`, the client
certificate `CN=mcp-portal-bff` for talking to the broker and the gateway (mTLS), and a chosen IGA adapter. The redirect URI of
the client in the IdP is `<PORTAL_PUBLIC_BASE_URL>/api/v1/auth/callback`. All variables: the "Configuration" table in
[bff/README.md](bff/README.md#configuration). Behind a proxy set `PORTAL_TRUSTED_PROXY_HOST` (the proxy name, resolved at start)
or `PORTAL_TRUSTED_PROXIES` (a regular expression of addresses), otherwise `X-Forwarded-*` is ignored.

### From source

Linux and macOS with bash 3.2 or newer; Windows only through WSL2. Needed: git, docker, JDK 25 (`JAVA_HOME`
for `scripts/build-images.sh`), Node 24 and the `mcp-contracts` 7.0.0 artifacts.

The contract artifacts come in two ways, and neither needs a file in the git of this repository:

- The BFF reads the `mcp-contracts` and `mcp-manifest` jars from `~/.m2` or from Maven Central.
- The web part reads the npm package from `web/.contracts/` (outside git), which `web/scripts/contracts.sh` fills: from a
  file (`CONTRACTS_TARBALL`; the release file is in `mcp-contracts/release/`), from an address (`CONTRACTS_TARBALL_URL`,
  `CONTRACTS_TARBALL_SHA256` checks the sum), from npmjs (`CONTRACTS_FROM_NPMJS=1`, no token) or from a local checkout of `mcp-contracts` at the tag `v7.0.0`
  (`CONTRACTS_SOURCE_DIR`, runs `npm pack`). After the release to npmjs, moving to the registry is one change in
  `web/package.json`, described in [web/README.md](web/README.md#contracts-package).

```bash
(cd bff && ./mvnw -B verify)                                   # BFF tests
(cd web && scripts/contracts.sh && npm ci && npm run lint && npm run i18n:check && npm test && npm run build && npm run e2e)
scripts/build-images.sh       # images mcp-portal-bff:m6-<sha>, mcp-portal-web:m6-<sha>, mcp-portal:m6-<sha> from git (HEAD or a given ref)
```

`scripts/build-images.sh` builds the jar and the application in a temporary copy from `git archive`, so the image holds what is
in the commit, not what lies in the working directory. It pushes nothing to a registry.

## Operation

- **State and restart.** The BFF keeps sessions in process memory (30 minutes idle, 8 hours absolute). A restart and a new
  version sign users out; nothing else is lost, because the portal has no database. Several instances need session
  affinity on the proxy.
- **Health.** `GET /actuator/health` (no details) on the container port. The `web` image answers `ok` on `/__web/health`.
- **TLS on the BFF port.** Optional, off by default: `PORTAL_PUBLIC_TLS_ENABLED=true` with `PORTAL_PUBLIC_TLS_CERTIFICATE` and
  `PORTAL_PUBLIC_TLS_PRIVATE_KEY` (PEM, file paths); description and consequences in
  [bff/README.md](bff/README.md#tls-on-the-bff-port-optional). It applies to the `bff` and `portal` images. The `web` image
  stays on HTTP at 8080: it is a static nginx only behind the proxy, it carries no session cookies, and TLS would need an
  `nginx.conf` template and a certificate in the image without any effect on session security; whoever wants to encrypt that
  hop too does it on the proxy. The images have no `HEALTHCHECK`, so with TLS the stack switches the probe to https.
- **Logs.** Stdout in text format; the C8 audit events (`component: portal`) go to a separate logger,
  `pl.aiwcorpo.mcp.audit`, one JSON line per event. The text of a switch (`reason`) and secret values never get there.
- **New version.** Change the image tag and restart the container. Image versions are immutable; a rollback is the previous tag.
  The portal 2.0.0 needs a gateway 2.0.0 and a credential broker 2.0.0 (contracts 7.0.0): deploy the broker and the gateway first,
  then the portal. A 1.x gateway or broker does not know the administration operations and the new identifiers.
- **OIDC client secret.** Rotation: a new secret in the IdP, `PORTAL_OIDC_CLIENT_SECRET` in the container, restart.
- **Client certificate (mTLS).** Replacing the keystore needs a restart. The name in the server certificate (`*_TLS_NAME`) is
  checked independently of the host in the URL.
- **Emergency switch (A9).** Administration, "Emergency switches": choose a server (or a server and a tool), enter a reason,
  confirm. The effect on every gateway instance comes within 5 s at the latest; calls already accepted are not interrupted.
  Switching off needs no MFA, lifting needs a fresh MFA (after the return from the IdP the lift carries itself out). The switch
  survives a restart and the approval of definitions; only the lift operation removes it.
- **Servers and systems at runtime (2.0.0).** Administration, "Servers" and "Systems": a new MCP server made from the template is
  added by adding its system in the broker and the server in the gateway; neither needs a restart of anything. A server has no
  tools until its manifest is approved, and a server whose policies or resource type declarations changed goes back to
  "Pending approval" (its tools are blocked) until an administrator approves them in "Approvals", where the differences of the
  policies and of the declarations are shown next to the tool approvals. Removing a server takes its tools out of the catalog and
  refuses its calls. The client secret of a system is write only; it has to be entered again when the base address, the
  authorization or token address, the client identifier or the revoke address changes, and such a change also deletes every
  user's connection to the system (the row in "System connections" then says to connect the account again).
- **Scope mapping and overrides (2.0.0).** "Scope mapping" replaces the whole document that maps groups to resource scopes, with
  the ETag it was read with (`If-Match`); the gateway refuses scopes of undeclared types or ids that do not fit the scope pattern
  and the page shows its reason. "Overrides" are single `forbid` Cedar policies for the gateway's decision, for every server or
  for one server; adding one needs no second factor.
- **Fresh MFA (2.0.0).** The same step-up as for lifting a kill switch is required for adding, changing (except a body that only
  disables the server) and removing a server, saving the scope mapping, removing an override, approving policies, and saving or
  removing a system. The form is kept through the trip to the identity provider (never the client secret) and the approval of
  policies carries itself out afterwards. The gateway and the broker check `auth_time` and the proof of MFA (`acr` or `amr`) of
  the token again; what the identity provider has to put into the exchanged tokens is in
  [bff/README.md](bff/README.md#fresh-mfa-for-the-administration-operations-identity-provider-settings).
- **Display names.** An administrator can give a system a display name (1 to 64 characters, no control or invisible characters) in
  "Systems"; the administration pages show it, as inert text. The C12 catalog carries no name, so the pages for users show the
  system identifier with a capital letter ("gitlab" is "Gitlab").
- **Request size.** The BFF refuses a body over 64 KB on `/api/v1/admin/**` before it reads it, and answers an administrator-only
  check before the body is read at all. Set the same limit on the reverse proxy (`client_max_body_size 64k;` for `/api/`), see
  [bff/README.md](bff/README.md).
- **Tools of foreign servers.** A tool from an adapter waits with no risk and no action, and agents do not see it. In
  Administration, "Classify and approve": the adapter is read only, so only Read (`read`) can be assigned; a tool that
  writes or deletes data will not pass through the adapter. Hints from the server are text to read, nothing more. A change
  of the definition sends the tool back to pending. A write classification (`UPDATE`, `DESTRUCTIVE`) saved before gateway
  6.3.x is invalid: the entry goes back to pending, and approving it again as Read is a lowering that needs a fresh MFA
  (after the return from the IdP it carries itself out).
- **Token with a login.** A system in the `Basic` scheme (`userSecretScheme` in the catalog, for example Jira Data Center with
  a login and password) shows a login field next to the password or API token in the form. The login goes to the broker with the
  secret; the BFF does not log it, does not write it to the audit and does not return it. A missing login with `Basic`, or a
  login with `Bearer`, is a 400 from the broker.
- **Catalog unavailable (503).** When the gateway cannot read the state of the switches, the catalog answers 503 and the portal
  shows "The service is temporarily unavailable" with a retry button; this is a transient state, not a portal failure.
- **Connection in error.** When the broker reports that the secret is gone from the store (`secret_missing`) or that a refreshed
  token could not be saved, the row in "System connections" says the connection stopped working; the user connects the account
  again. On the operator side: check OpenBao and the broker audit (reasons `secret_missing`, `refresh_token_lost`).

## Layout

```
Dockerfile              targets bff, web, portal
scripts/build-images.sh images from git, nothing is pushed
bff/                    Spring Boot BFF (docker/, dev/, .run/)
web/                    Angular (scripts/, e2e/, src/, .run/)
docs/screenshots/       en/ and pl/: pictures for this README
```
