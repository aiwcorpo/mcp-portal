# mcp-portal-bff

Backend of the MCP portal (workstream ws-07): OIDC login and server-side session, the C12 API for the frontend,
and aggregation of C5 (gateway admin), C4 (credential broker) and C13 (IGA). The browser never receives tokens or
secrets. The BFF also serves the built Angular frontend (`../web`) from the same origin.

Stack: Java 25, Spring Boot 4.1.0 (Spring Security 7.1), Maven wrapper. Contracts: `mcp-contracts` 7.0.0 (the `mcp-contracts`, `mcp-manifest` and `test-vectors` jars, from `~/.m2` or from Maven Central).
Image: `Dockerfile` in the repository root (targets `bff`, `web`, `portal`), `scripts/build-images.sh`; described in [../README.md](../README.md).

## Running locally

Requires JDK 25 (`scripts/select-jdk.sh` finds it; `JAVA_HOME` takes precedence) and `mcp-contracts` 7.0.0 in `~/.m2` or in the registry. Two modes.

With mocks (no dev stack; C4/C5 data comes from the WireMock mocks in the contracts jar):

```bash
./mvnw -q test-compile                  # once: downloads the WireMock and contracts jars to ~/.m2
./scripts/run-mocks.sh start            # C4 :18721, C5 :18722, discovery OIDC :18723
PORTAL_MOCKS=1 ./scripts/run-dev.sh     # BFF on http://localhost:18720
./scripts/run-mocks.sh stop
```

Without the dev stack there is no Keycloak: the BFF starts (stub discovery on :18723), `/api/v1/me` returns 401 and
login does not work. You can pass the values explicitly with `PORTAL_OIDC_ISSUER_URI` and `PORTAL_OIDC_CLIENT_SECRET` (for
example for your own Keycloak). When a dev stack directory exists (next to the repository, or `MCP_PLATFORM_DEV_DIR`),
the script takes the issuer and client secret from it, so login works after `make up` there.

With the local dev stack (not public yet; the Compose install in `mcp-docs`, `examples/compose`, runs the platform for everybody) (`make up`: Keycloak :18080, C4 and C5 stubs with mTLS):

```bash
./scripts/run-dev.sh            # BFF on http://localhost:18720 (ws-07 port)
```

This mode needs the directory `../../mcp-platform-dev`, a checkout of the dev stack that is not public yet (another one: `MCP_PLATFORM_DEV_DIR=...`); a missing directory or
a missing key in `.env` / `.secrets/dev.env` ends with a readable message. On every start the script reads the
`mcp-portal-bff` client secret, the keystore password and the ports; nothing is copied into this repository. Any value can
be overridden with a `PORTAL_*` variable (table below). To use the real broker instead of the stub:
`PORTAL_BROKER_URL=https://localhost:18100 ./scripts/run-dev.sh`.

The script locates JDK 25 (`scripts/select-jdk.sh`, with a readable message when missing) and enables the Spring profile
`dev`. Replacing the mocks with real services means changing two addresses (`PORTAL_BROKER_URL`, `PORTAL_GATEWAY_ADMIN_URL`).
Login through Keycloak needs the redirect URI `<PORTAL_PUBLIC_BASE_URL>/api/v1/auth/callback` in the `corp` realm.

Frontend: `cd ../web && npx ng build`, output in `../web/dist/portal` (the default `PORTAL_WEB_DIST`). Without a
build the API works and SPA routes return 404.

Quick check:

```bash
curl -i http://localhost:18720/api/v1/me                         # 401 {"error":"unauthenticated"}
open 'http://localhost:18720/api/v1/auth/login?returnPath=/'     # log in as alice (password: make users)
```

## Tests

```bash
./mvnw test             # unit + API (profile dev) over HTTP (fake IdP, WireMock C4/C5 stubs from mcp-contracts)
./mvnw test -Pdev-env   # with a real Keycloak and mTLS stubs from the dev stack (make up, port 18090 free)
```

| Test | What it checks |
| --- | --- |
| `PortalApiTest` | every API response validated against the C12 schema (`portal-bff.v1.bundled.yaml` from the contracts jar; a status outside the contract is an error); login with PKCE and nonce; `__Host-session` and `__Host-XSRF-TOKEN` cookies; CSRF for PUT/DELETE/POST; step-up (`step_up_required` + `stepUpUrl`, `max_age=0`, return); token exchange for the broker and gateway admin `aud`; C8 audit validated against `audit-event.schema.json`; SPA with fallback, CSP with nonce, HSTS; `/api/**` never HTML; finally, no response or log line contains an IdP token or a secret |
| `ServerTlsTest` | TLS on the BFF port enabled with `PORTAL_PUBLIC_TLS_*` (PEM from a test CA made with keytool): a client trusting the CA gets `/actuator/health`, a client without the CA and plain HTTP do not; session cookie `Secure`/`HttpOnly`/`__Host-`; missing PEM files are a startup error; key readable by others: refused outside the `dev` profile (`ServerTlsStartTest`, `PublicTlsEnvironmentTest`: spellings `yes`/`on`/`1`/`TRUE`, key 0600 without the `dev` profile). With TLS off, all other tests run over HTTP |
| `RunDevConfigurationTest` | startup with the same configuration as `run-dev.sh` (profile `dev`, `PORTAL_*` as environment variables with relaxed binding) and the IGA mock data in the directory |
| `FrontendBuildTest` | the real ws-08 build from `../web/dist/portal` (skipped when not built; `-Dportal.test.require-web-dist=true` makes that an error): SPA routes, nonce in styles, JS/CSS files; return after login to `PORTAL_WEB_LOGIN_RETURN_ORIGIN` |
| `CatalogAssemblerTest` | catalog status and action rules (CC-021); rebuilding the C12 `mixed` example from C5/C4/C13 data |
| `ReturnPathsTest` | `test-vectors/return-paths` vectors (CC-032) |
| `StepUpPolicyTest`, `RequestIdsTest` | MFA freshness, `stepUpUrl` construction, UUIDv7 for `requestId` |
| `DevEnvironmentFlowTest` (`-Pdev-env`) | alice: Keycloak login, `me`, catalog, connections, secret write, step-up with re-login, disconnect, logout including the IdP; mallory without groups |
| `UpstreamTlsDevEnvironmentTest` (`-Pdev-env`) | mTLS to the C4 stub: certificate from a foreign CA rejected, TLS name pinned (CC-035) |
| `UpstreamGuardsTest`, `IgaConfigTest`, `LoginRedirectsTest`, `MockAccessGovernanceTest` | startup refused for dev-only settings outside the `dev` profile, http and missing mTLS; normalization of C4/C5 data; `loginError` codes; requester identified by a claim |

## Configuration

Everything is set through environment variables (`application.yml`):

| Variable | Meaning | dev |
| --- | --- | --- |
| `PORTAL_PORT` | HTTP port | `18720` |
| `PORTAL_OIDC_ISSUER_URI` | OIDC issuer (discovery) | `http://localhost:18080/realms/corp` |
| `PORTAL_OIDC_CLIENT_ID`, `PORTAL_OIDC_CLIENT_SECRET` | confidential client | `mcp-portal-bff`, `KC_CLIENT_MCP_PORTAL_BFF_SECRET` |
| `PORTAL_BROKER_URL`, `PORTAL_BROKER_TLS_NAME` | C4 and the name in the broker certificate | `https://localhost:18443`, `MCP_BROKER_TLS_NAME` |
| `PORTAL_GATEWAY_ADMIN_URL`, `PORTAL_GATEWAY_ADMIN_TLS_NAME` | C5 and the name in its certificate | `https://localhost:18444`, `MCP_GATEWAY_INTERNAL_TLS_NAME` |
| `PORTAL_PUBLIC_BASE_URL` | origin of the single domain (portal, `/api`, `/mcp`, `/s/`): source of the OIDC redirect URI `<url>/api/v1/auth/callback`, the `copy_link` links and `clientConfigs`; never taken from `Host`; outside `dev` https only, no IPv6 literal (former name: `PORTAL_GATEWAY_PUBLIC_URL`) | `http://localhost:18720` |
| `PORTAL_TLS_KEYSTORE`, `PORTAL_TLS_KEYSTORE_PASSWORD` | client certificate `CN=mcp-portal-bff` (PKCS12) | `certs/mcp-portal-bff/keystore.p12` |
| `PORTAL_TLS_TRUSTSTORE`, `PORTAL_TLS_TRUSTSTORE_PASSWORD` | internal CA | `certs/ca/truststore.p12` |
| `PORTAL_WEB_DIST` | directory with the built frontend's `index.html` | `../web/dist/portal` |
| `PORTAL_WEB_LOGIN_RETURN_ORIGIN` | dev only: origin of the `ng serve` frontend the BFF returns to after login (`scheme://host:port`, from configuration, never from the request) | empty; with `npm start` in `web/`: `http://localhost:4200` |
| `SPRING_PROFILES_ACTIVE` | `dev` only for the dev stack; without it the BFF will not start with the `mock` IGA adapter, step-up without `acr`, `PORTAL_WEB_LOGIN_RETURN_ORIGIN` or `portal.tls.insecure-plain-http-for-tests` | `dev` (set by `run-dev.sh`) |
| `PORTAL_LIMIT_SECRET_WRITE_MAX`, `PORTAL_LIMIT_SECRET_WRITE_WINDOW` | token write (`PUT .../secret`): at most this many requests per session in the window, then `429` with `Retry-After` (CC-156) | `10`, `1m` |
| `PORTAL_LIMIT_AUTHENTICATOR_MAX`, `PORTAL_LIMIT_AUTHENTICATOR_WINDOW` | Authenticator writes (start, removal, confirmation) per session | `10`, `10m` |
| `PORTAL_IGA_ADAPTER` | C13 adapter: `keycloak-groups` or `mock` (`dev` only); unset is a startup error | `mock` (profile `dev`) |
| `PORTAL_IGA_CATALOG_FILE` | entitlement catalog for the `keycloak-groups` adapter (same YAML format as the mock: `entitlements`, optionally `descriptions`); the adapter has no request workflow | none |
| `PORTAL_IGA_MOCK_FILE` | data for the `mock` adapter (outside the jar): a plain filesystem path, no `file:` | `dev/iga-mock.yaml` |
| `PORTAL_IGA_REQUESTER_ID_CLAIM` | login claim that identifies the requester in IGA; a user without the claim is an adapter error (503) | `preferred_username` |
| `PORTAL_CLIENT_CONFIGS_CLAUDE_CODE_CLIENT_ID` | `--client-id` in the `clientConfigs.claudeCode` command; empty = no flag (letters, digits, `.`, `_`, `-`; anything else is a startup error) | `claude-code` in profile `dev`, empty otherwise |
| `PORTAL_CLIENT_CONFIGS_CLAUDE_CODE_CALLBACK_PORT` | `--callback-port` in that command (1024-65535); empty = no flag | `33418` in profile `dev`, empty otherwise |
| `PORTAL_TRUSTED_PROXIES` | regex of proxy addresses from which `X-Forwarded-*` is accepted | `127[.]0[.]0[.]1\|0:0:0:0:0:0:0:1` |
| `PORTAL_PUBLIC_TLS_ENABLED` | `true` enables TLS on the BFF port (`PORTAL_PORT`); off by default, the port then speaks plain HTTP | `false` |
| `PORTAL_PUBLIC_TLS_CERTIFICATE`, `PORTAL_PUBLIC_TLS_PRIVATE_KEY` | server certificate (with chain) and private key in PEM (PKCS#8): a plain file path (the BFF adds the `file:` prefix itself); required with `PORTAL_PUBLIC_TLS_ENABLED=true`, a missing file is a startup error | none |
| `PORTAL_PUBLIC_TLS_PRIVATE_KEY_PASSWORD` | password of an encrypted PEM key; empty for an unencrypted key | empty |
| `PORTAL_STEP_UP_MAX_AGE` | maximum age of the last login for step-up operations | `5m` |
| `PORTAL_STEP_UP_ACR_VALUES` | `acr` values accepted as MFA; empty = `auth_time` only, allowed in profile `dev` only | empty (the realm has no `acr` levels) |

C4 and C5 are reachable only over https with a client certificate and a dedicated truststore (internal CA); http, or a missing
keystore or truststore, is a startup error. Exception: `portal.tls.insecure-plain-http-for-tests=true` in profile `dev` (tests on
WireMock stubs without TLS). The TLS name (`*_TLS_NAME`) is checked as a DNS SAN of the server certificate regardless of the host
in the URL, so connecting through `localhost` does not disable name verification.

Login: the only entry point is `GET /api/v1/auth/login` (`/oauth2/authorization/*` is closed). Step-up must authenticate the
same `sub`, otherwise the session is invalidated. After every login the session keeps only the new security context and
tokens. On a login error the BFF answers 302 to `/?loginError=<code>`, with codes `cancelled`, `idp_error`, `session_expired`,
`step_up_failed`.

Session: cookie `__Host-session` (Secure, HttpOnly, SameSite=Lax, Path=/), 30 min idle timeout, 8 h absolute limit, sessions held
in process memory. CSRF: cookie `__Host-XSRF-TOKEN` (Secure, SameSite=Strict, readable by JS, already set in the response that
completes login) and the `X-XSRF-TOKEN` header for POST/PUT/DELETE; the `_csrf` parameter is not accepted.

Frontend and CSP (agreed with ws-08, `../web/README.md`): the BFF serves `index.html` for every SPA route with
`Cache-Control: no-store`, replacing each occurrence of `__CSP_NONCE__` with a random nonce (128 bits, base64) taken from the
header of that response:
`default-src 'self'; script-src 'self'; style-src 'self' 'nonce-<n>'; img-src 'self'; font-src 'self';
connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`.

C8 audit: logger `pl.aiwcorpo.mcp.audit`, one JSON line per event on stdout, `component: portal`,
`componentId: mcp-portal-bff`, event `connection_change` for secret writes and disconnects (including step-up refusals and
rejections by the broker).

### TLS on the BFF port (optional)

By default the BFF port speaks plain HTTP, because a reverse proxy in front of it terminates TLS. If traffic between the proxy
and the BFF must be encrypted (it carries the session cookie), set `PORTAL_PUBLIC_TLS_ENABLED=true`,
`PORTAL_PUBLIC_TLS_CERTIFICATE=/certs/tls.crt` and `PORTAL_PUBLIC_TLS_PRIVATE_KEY=/certs/tls.key` (PEM; PKCS#8 key, with the
password in `PORTAL_PUBLIC_TLS_PRIVATE_KEY_PASSWORD`). This is a regular Spring Boot SSL bundle (`portal-server`), not the
`PORTAL_TLS_*` keystore, which is used for mTLS towards the broker and gateway. What changes:

- The same `PORTAL_PORT` then serves HTTPS only; plain HTTP on it gets 400. The proxy must connect over `https://` and trust the
  certificate's CA (the name in the certificate must match the name the proxy uses to reach the BFF).
- Health: `GET https://<host>:<port>/actuator/health`. Probe inside the container: `wget -q -O /dev/null --no-check-certificate
  https://127.0.0.1:8080/actuator/health` (loopback inside the container, so no chain verification).
- The image has no `HEALTHCHECK` instruction; the probe is defined by the stack (compose, Kubernetes), so with TLS it must be
  switched to https.
- `PORTAL_TRUSTED_PROXY_HOST` and `entrypoint.sh` are unchanged: trust in `X-Forwarded-*` concerns the proxy address, not TLS.
- The `__Host-session` cookie has `Secure`, `HttpOnly`, `Path=/` and no `Domain` regardless of TLS on the port (set by the BFF
  configuration, because the public address is always https); `ServerTlsTest` checks this on a TLS port.
- Protocols: TLS 1.3 and 1.2 (set explicitly in the SSL bundle); older ones are rejected. `PORTAL_PUBLIC_TLS_ENABLED` is read like
  `server.ssl.enabled` (`true`, `yes`, `on`, `1`), so the key check and the `file:` prefix work for every spelling.
- The names have the same suffixes as `MCP_PUBLIC_TLS_*` in the gateway. As in its `DevstackGuard`: with TLS enabled, a key
  readable by "others" (any `o` bit) refuses startup unless the `dev` profile is active; `chmod 600`/`640` is enough.
- The certificate is read at startup; replacing it requires a restart. Enabled TLS without readable PEM files is a startup error.

## M2: connections, virtual servers, tests

The OIDC callback is `/api/v1/auth/callback` (single domain, CC-089). OAuth connection: `POST /connections/{system}/oauth`
stores `flowId`, the `state` from `authorizeUrl` and `returnPath` in the session; `GET /api/v1/oauth/callback` looks up the flow
by `state` in the current user's session (one use, 15 min, at most 8 at a time), and the `connectError` codes are `cancelled`,
`provider_error`, `flow_invalid` (`identity_mismatch` was removed in contracts 3.0.0). The saved links (`/api/v1/virtual-servers`,
`/v/<slug>/mcp`) were dropped in contracts 5.0.0 (CC-175, CC-177) in favour of `GET /api/v1/me/mcp-endpoint` (below).

`clientConfigs.claudeCode` is `claude mcp add --transport http [--client-id <id>] [--callback-port <port>] aiwcorpo-mcp "<address>"`.
Keycloak in the dev stack does not allow dynamic client registration, so without both flags Authenticate in Claude Code does
not work; profile `dev` sets `claude-code` and `33418` (the `claude-code` client in the realm needs the redirect URI
`http://localhost:33418/callback`). Production with Entra ID may need a different client or none, so the flags are off by
default. Copilot and Codex get only the address: there is no confirmed field for a client id in their configuration (see
STATUS.md). The `connection_change` event carries the connected account's `backendUser` (CC-117; absent when the broker did not return it).

| Test | What it checks |
| --- | --- |
| `OAuthConnectTest`, `ConnectRedirectVectorsTest` | start and callback, all codes, someone else's link, replay, no session, `connect-redirects/` vectors |
| `McpEndpointTest`, `McpEndpointVectorsTest`, `ComposedQueryTest` | `GET /api/v1/me/mcp-endpoint`: `mcp-endpoint/` vectors, also with the query as the client sends it, counter from the C5 catalog, refusals without calling the gateway, no audit |
| `ClientConfigsTest`, `ClientConfigsBindingTest` | Claude Code command (boundary values, metacharacters, no flags outside profile `dev`, startup error on a bad value) |
| `BackendUserAuditTest` | `backendUser` in the audit matches the C8 schema pattern or is omitted |
| `NegativeSecurityTest` | `X-Request-Id` on every response and ignoring the client's value, missing XSRF, someone else's session and token, secret and OAuth code in logs, `returnPath` outside the pattern |
| `PublicBaseUrlTest` | redirect URI taken from configuration despite `X-Forwarded-Host` |
| `CatalogAssemblerTest` | `catalog-actions/` vectors, C12 `mixed` and `states` examples |

## M3: confirmations, Authenticator, activity logs

Contracts 3.0.1. Confirming a DESTRUCTIVE action is a TOTP code typed in the MCP client and checked by the broker, so the BFF
has no decision endpoint (`POST /api/v1/confirmations/{id}` is 405).

- `GET /api/v1/confirmations/{id}`: read-only preview (proxy to C5), session only, no MFA, `Cache-Control: no-store`. A response
  that does not match the schema, or one for a different `confirmationId`, is 503, not an empty preview. An id outside the pattern,
  someone else's, expired or invalidated all give the same `404 not_found_or_denied`.
- `POST .../viewed`: XSRF and `Sec-Fetch-Site: same-origin` (missing header or another value: `403 csrf_invalid`); a request with
  `Sec-Purpose` or `Purpose` containing `prefetch` gets 204 without being forwarded to the gateway.
- `POST .../cancel`: XSRF, no MFA. If the gateway cannot burn the codes at the broker, the result is 503 and nothing is cancelled.
- `GET /api/v1/activity/calls`: the filters `limit`, `from`, `to`, `result`, `q`, `cursor` are validated (once, within the C12
  bounds; other parameters are not forwarded); the `X-Next-Cursor` cursor passes through unchanged in both directions. Rows
  outside the schema are skipped, a cursor outside `[\x21-\x7e]{1,256}` is 503. A gateway 400 on a supplied cursor is 400.
- Authenticator (`/api/v1/authenticator`, `/enrollment`, `/enrollment/confirm`): starting enrollment and removal need fresh MFA
  (`401 step_up_required` with `stepUpUrl`, return to `portal.step-up.authenticator-return-path`, default `/authenticator`), the
  first code does not. The seed appears in a single `201` response (`no-store`) and never reaches the session, logs or audit; the
  session keeps `enrollmentId`, and someone else's or a used one is `404 not_found_or_denied`. The `disabled` state with
  `disabledAt` and `disabledReason` is passed through; starting enrollment from `disabled` does not call `DELETE` first.
  `GET /api/v1/me` returns `mfaFreshUntil` when the last login counts as fresh.
- Step-up: freshness is decided by `auth_time` (`portal.step-up.max-age`, 5 min, re-login with `max_age=0`) and MFA evidence.
  The evidence is `acr` from the `PORTAL_STEP_UP_ACR_VALUES` list (Keycloak; also sent as `acr_values`; dev: `mfa`) or an `amr`
  in the ID token containing a value from `PORTAL_STEP_UP_AMR_VALUES` (Entra ID: `mfa`, when Conditional Access enforced a second
  factor; the policy must cover the portal application). One source is enough. With both lists empty only `auth_time` counts,
  which is allowed in profile `dev` only, otherwise startup fails.
- Audit: `authenticator` (`authenticator_enrollment_started`, `authenticator_registered`, `authenticator_enrollment_failed`,
  `authenticator_removed`, `step_up_required`, `upstream_unavailable`) and `admin_change` for refused definition approvals.
  `virtual_server_change` events were removed from the schema (CC-174). `confirmation` events (including `cancelled_by_owner`) are written by the gateway.
- Preview: the gateway response is read as a closed object (a field outside the schema: 503), at most 64 arguments, a value after
  neutralization at most 8192 characters (longer ones are cut, `truncated: true`).
- Text in the preview: argument values with hidden characters (`TextHygiene`: bidi, zero-width, tag, fillers, controls other than
  `\n` and `\t`, separators, lone surrogates, private-use and unassigned) reach the browser as `<U+202E>` (a literal `<U+` in a value
  becomes `<U+003C>`, so the notation always means a character that was there); an argument name, `resource.id`,
  `resource.parent` or `client` containing such characters causes rejection (of the preview or the row). The definition follows
  CC-121, stricter by U+200C..U+200F and CR.
- `ReturnPath` (CC-099): no semicolon; the first segment is not `api`, `mcp`, `s`, `v` or `.well-known` (`/mcp-docs` is allowed); no
  path segment is `.` or `..`.

| Test | What it checks |
| --- | --- |
| `ConfirmationsTest` | preview without side effects, `viewed` (XSRF, `Sec-Fetch-Site`, prefetch), `cancel` without MFA, 404 for someone else's, no decision endpoint |
| `AuthenticatorTest` | step-up on start and removal, seed shown once and `no-store`, no seed or code in logs and audit, `enrollmentId` bound to the session, `disabled` state, `mfaFreshUntil` |
| `ActivityCallsTest` | filters, cursor unchanged, parameters outside the contract, rows outside the schema |
| `GatewayDataTest` | neutralization of hidden characters, agreement with the `text-hygiene/` vectors |
| `BackchannelOidcTest` | login without discovery (`portal.oidc.*`), `iss` still checked, startup error on an incomplete set of addresses |
| `ReturnPathsTest`, `NegativeSecurityTest` | `return-paths/` vectors from 3.0.1 |

## OIDC with separate addresses (no discovery)

When the BFF in a container sees the IdP under a different address than the browser does, discovery at `issuer-uri` needed a
relay on the public address (`idp-relay` in the dev stack). Instead, `PORTAL_OIDC_TOKEN_URI` switches to registration from
explicit addresses, and then `PORTAL_OIDC_AUTHORIZATION_URI` (public address, for the browser) and `PORTAL_OIDC_JWK_SET_URI` are
mandatory too; `PORTAL_OIDC_USER_INFO_URI` and `PORTAL_OIDC_END_SESSION_URI` (IdP logout over the back channel) are optional.
`PORTAL_OIDC_ISSUER_URI` remains the expected `iss` (compared, not fetched). Http-only addresses are allowed in profile `dev`; the
browser-facing address is https, or http on loopback in dev. Without `PORTAL_OIDC_TOKEN_URI`, discovery works as before. For
the dev stack (compose change):
`PORTAL_OIDC_AUTHORIZATION_URI=https://localhost:18746/realms/corp/protocol/openid-connect/auth`,
`PORTAL_OIDC_TOKEN_URI=http://keycloak:8080/realms/corp/protocol/openid-connect/token`,
`PORTAL_OIDC_JWK_SET_URI=http://keycloak:8080/realms/corp/protocol/openid-connect/certs`,
`PORTAL_OIDC_END_SESSION_URI=http://keycloak:8080/realms/corp/protocol/openid-connect/logout`; after that `idp-relay` and
`JAVA_TOOL_OPTIONS` with the dev public CA truststore in the BFF are unnecessary. Without `PORTAL_OIDC_END_SESSION_URI`, logout
ends only the BFF session (the SSO session at the IdP stays), and the BFF logs a warning at startup. An empty
`PORTAL_OIDC_TOKEN_URI` means discovery.

## M4: requests, registry administration, limits

Contracts 4.0.0 (the M4 state; M5 is described below). Decision details are in `STATUS.md` (M4.1 ... M4.4).

- Access requests (C13 port): `GET/POST /api/v1/access-requests`, `GET /api/v1/access-requests/entitlements?system=`. Adapters:
  `keycloak-groups` (catalog from a file, no requests: `POST` gives `422 not_requestable`) and `mock` (profile `dev`). A `POST` for an
  entitlement that already has a pending request returns `200` with its `requestId`; an entitlement outside the catalog or already
  held is `422 not_requestable`. An entitlement description from IGA is untrusted text (hidden characters written as `<U+XXXX>`, up
  to 500 characters), and a `requestUrl` from IGA must be `https`.
- Catalog action table per CC-113: `request_access` only when `requiredEntitlements` is known; `view_request` also when `connected`.
- Registry administration (group `mcp-platform-admin`, checked in the BFF and in the gateway): `GET /api/v1/admin/registry`,
  `.../servers/{serverId}/tools/{tool}/pending` (diff: `approvedEntry`, `pendingEntry`, versions, `source`),
  `POST .../approve` (`409 hash_mismatch`, `422 ManifestRejected` with `reason`). Definition texts have hidden characters written
  out explicitly; hashes are unchanged. The source of truth for a successful approval is the gateway event (`admin_change` /
  `definition_approved`, the administrator's `sub`, `definitionHash`); the portal writes its own `admin_change` only for attempts
  without effect (no `reason`, with `outcome` and `errorCode`). `approve` requires `Sec-Fetch-Site: same-origin`.
- Per-session limits: token write and Authenticator writes (`PORTAL_LIMIT_*` variables), response `429 rate_limited` with
  `Retry-After`; a broker `429` is passed through only where C12 describes `429` (token write, Authenticator; without a broker
  `Retry-After`: 60 s), elsewhere it becomes `503`.
- The "Last used" column for a service account (CC-150) is computed by web from `GET /api/v1/activity/calls` rows (results `ok`,
  `confirmed`, `error`); the BFF has no separate field for it.

| Test | What it checks |
| --- | --- |
| `AccessRequestsTest`, `AccessRequestsAdapterTest` | list, idempotent `POST`, `422`, `503`, strict body, CSRF, C12 examples, scripted adapter (redirect, result outside the contract, rows outside the contract, text from IGA) |
| `IgaDataTest`, `KeycloakGroupsAccessGovernanceTest`, `IgaConfigTest` | `requestUrl` addresses, adapter result, catalog without requests, adapter selection |
| `RegistryAdminTest` | admin only, views checked against the schema, definition neutralization, C12 examples, approval with audit, `409`, `422`, status mapping |
| `RateLimitsTest` | per-session limits (window, `Retry-After`, counting only requests that reach the broker), `429` from the broker and gateway |

## M6: kill switch and adapter tool classification (contracts 6.3.2)

- Kill switch (A9, CC-194), group `mcp-platform-admin`: `GET /api/v1/admin/kill-switches` (list checked against the schema, reason
  as untrusted text with hidden characters written out), `PUT` and `DELETE` under `.../registry/servers/{serverId}/kill-switch` and
  `.../tools/{tool}/kill-switch`. Enabling (`PUT`, body `{"reason"}` of 1..200 characters without hidden characters) does not need
  fresh MFA; clearing (`DELETE`) does, and without it returns `401 step_up_required` with a `stepUpUrl` that returns to the page
  the request came from (U12). The gateway record (`kill_switch_set`, `kill_switch_cleared`) is the source of truth; the portal
  writes `admin_change` only for attempts without effect (refusal, no MFA, gateway failure) and never copies the reason text into the audit.
- `approve` carries `risk` and `action` for an adapter tool (CC-193); the BFF checks the enum values (`400`, in the contract since
  CC-210), and leaves the pairing, whether the entry comes from the adapter, and that the adapter accepts only `READ_ONLY` (CC-227)
  to the gateway (`422 classification_inconsistent`, `classification_required`, `classification_not_allowed` with `reason`).
- `PUT .../secret` accepts `username` (CC-222): 1..255 characters, no `:`, control, formatting, separator or filler characters
  (the same filter as `backendUser`); beyond that the login goes to the broker, which decides whether the system accepts it
  (`400`). It is not logged, audited or returned; the record's `toString` hides it. The catalog carries `userSecretScheme` and
  `deployment` from `GET /v1/systems` (values outside the enum are dropped).
  Lowering an earlier classification is `acceptRiskLowering` with fresh MFA, like any lowering.
- Registry views accept a pending entry with `source: adapter` without `risk` and `action` (with empty `resourceRefs`),
  `classifiedBy` and `classifiedAt`; a non-adapter entry must still have both values. The catalog passes `disabledBy` only with `disabled: true`.
- The vectors `http-broken-escape`, `http-lone-percent`, `http-half-escape` (CC-202) go over HTTP as a raw request, because
  `java.net.URI` cannot build an address from `%zz`; `TestBrowser.getRawTarget` sends them over a socket.

| Test | What it checks |
| --- | --- |
| `KillSwitchTest` | admin only, list checked against the schema, enabling without MFA, clearing with MFA and `stepUpUrl` from the page, request body, mapping of gateway responses, audit of attempts without effect, no reason in the audit |
| `RegistryAdminTest` (added) | classification passed to the gateway, unknown values, `422` refusals with `reason`, lowering with MFA, adapter entry without `risk` and `action`, `classifiedBy` |

## 2.0.0: dynamic servers and systems (contracts 7.0.0)

The BFF has no list of systems, servers or resource types. A system id, a server id, a qualified tool name, a resource type
and a scope id are checked by the patterns of `common.schema.json` (`ContractValues`, with the reserved ids of CC-237); which
systems and servers exist comes from the broker (`GET /v1/systems`) and the gateway (catalog, registry). The IGA port lists the
systems of its catalog (`AccessGovernance.systems()`) instead of a built-in list. A connection that the broker marks
`needs_reconnect` (the administrator changed where the system points, CC-238) is kept as such and the catalog shows the server as
`reconnect_required` with `reconnect` or `add_secret` and `disconnect`.

Administration mirrors (group `mcp-platform-admin`, checked in the BFF and again by the gateway and the broker on the exchanged
token). Every one goes through `AdminOperations`: the exchanged token for `mcp-gateway-admin` or `mcp-credential-broker`, the
browser's `If-Match` or `If-None-Match: *` sent on unchanged, the `ETag` of the answer returned unchanged, the answer checked
against the closed schema of the contract (`AdminViews`; an answer that does not fit is a `503`, never partly shown) with hidden
characters written out, and the refusals of the upstream mapped to the C12 answers (`400`, `403`, `404`, `409` only for the code the
operation lists, `412`, `422` with `reason` and a neutralized `message`, `428`; anything else is a `503`).

| Operation | Upstream | Fresh MFA |
| --- | --- | --- |
| `GET`, `POST /api/v1/admin/servers`, `GET`, `PATCH`, `DELETE .../servers/{serverId}` | C5 `/admin/v1/servers` | create, delete and every `PATCH` except a body that only sets `enabled: false` |
| `GET`, `PUT /api/v1/admin/policy/scope-mapping` | C5 | `PUT` |
| `GET .../policy/overrides`, `GET`, `PUT`, `DELETE .../overrides/{id}` | C5 | `DELETE` only (an override can only forbid) |
| `GET .../registry/servers/{serverId}/policies/pending`, `POST .../policies/approve` | C5 | approve (also needs `Sec-Fetch-Site: same-origin`) |
| `GET /api/v1/admin/systems`, `GET`, `PUT`, `DELETE .../systems/{system}` | C4 `/v1/admin/systems` | `PUT` and `DELETE` |

- Fresh MFA is `StepUpPolicy.requireFresh`, the mechanism and window of lifting a kill switch, with `returnPath` from the page that sent
  the request. An upstream `401 step_up_required` (C4 and C5 check `auth_time` of the exchanged token within 300 s on their own) becomes
  the same `401 step_up_required` with `stepUpUrl`, in every mirror. The token exchange cache of the session is dropped by every login,
  so a token exchanged after a step-up carries the new `auth_time`; the IdP mapper has to copy that claim into the exchanged token.
- `DELETE .../servers/{serverId}` asks for fresh MFA although C12 shows a plain `401` for it: the gateway needs it (CC-239).
- Preconditions: `If-Match` is required (`428` without it, no call) by `PATCH`, the scope mapping `PUT`, `DELETE` of an override and
  of a system; `PUT` of an override and of a system takes `If-Match` (replace) or `If-None-Match: *` (create), not both. A malformed
  tag is `400`, and `412` for the two `DELETE`s, where C12 lists no `400`.
- Request bodies are closed (no field the schema does not know, no repeated key, at most 64 KiB, types not coerced). A server has no
  `tlsName` (the gateway pins `<serverId>.internal`) and `adapter` is set only on create (CC-240). The client secret of a system
  travels in the `PUT` body to the broker and is in no answer, log or audit event; a broker answer with a `clientSecret` field is
  refused by the closed schema. The broker asks for it again when an address changes (`422 system_rejected`, reason
  `client_secret_required`).
- Audit: the gateway and the broker record every change. The portal writes `admin_change` only for an attempt that changed nothing
  (reasons such as `not_admin`, `step_up_required`, `precondition_failed`, the `reason` of an upstream rejection); override
  attempts carry `overrideId`, `overrideTarget` and `textSha256`, never the text.

| Test | What it checks |
| --- | --- |
| `AdminMirrorsTest` | every operation above: admin only (no upstream call, audited `not_admin`), unauthenticated, fresh MFA exactly where listed (and the disable-only `PATCH`), an upstream `step_up_required`, `If-Match` and `If-None-Match` passed on, `428` and `400`/`412` for bad tags, `ETag` back, `404`, `409`, `412`, `422` with reason, `503`, closed request bodies, closed answers (a leaked `clientSecret`, wrong ids, hidden characters), no secret in responses or logs, audit of refused override writes |
| `DynamicSystemsTest` | system, server, tool, resource type and scope patterns and the reserved ids, a system and a resource type the BFF was never told about, `needs_reconnect` to `reconnect_required`, `policiesStatus` of the registry |

## Fresh MFA for the administration operations (identity provider settings)

The gateway and the broker do not trust the portal to have asked for a second factor. On the widening operations of the table above
they accept the exchanged administrator token as fresh MFA only when `auth_time` is at most 300 s old and the token proves MFA: its `acr`
is one of the values configured in the gateway and in the broker, or its `amr` contains `mfa`, `otp`, `hwk` or `totp`. A token without
`auth_time`, or with neither proof, is answered `401 step_up_required`, which the BFF turns into the step-up login. What the BFF
does and what the identity provider has to do:

- **Step-up login (BFF).** `GET /api/v1/auth/login?stepUp=true` sends `max_age=0` (a new authentication even with a live SSO session)
  and, when `PORTAL_STEP_UP_ACR_VALUES` is set, `acr_values` with the same list. `PORTAL_STEP_UP_ACR_VALUES` has to name the
  `acr` level that the realm gives only to a login that included the second factor (Keycloak: the level of conditions of the
  authentication flow, for example `mfa`), and that level has to be one of the `acr` values the gateway and the broker accept.
  Where the provider reports methods instead of levels (Entra ID), leave it empty and set `PORTAL_STEP_UP_AMR_VALUES`.
  Without either list the BFF accepts `auth_time` alone, which is allowed in the `dev` profile only, and the upstreams would still refuse.
- **Token exchange (BFF).** The BFF forwards the access token of the session as `subject_token`, with `audience` `mcp-gateway-admin` or
  `mcp-credential-broker`, and uses the exchanged token as it is: it removes and adds no claim. After a step-up login the session
  holds the access token of that login and the cache of exchanged tokens is empty, so the next exchange carries the new `auth_time`.
- **Token exchange (identity provider).** The exchanged token must contain `auth_time`, `acr` and `amr` copied from the subject token.
  In Keycloak the exchange builds the token from the client scopes of the target audience, so the scopes that the portal client uses
  for `mcp-gateway-admin` and `mcp-credential-broker` (by default `mcp-gateway-admin-audience` and `mcp-credential-broker-audience`, the
  properties `portal.token-exchange.gateway-admin-scope` and `portal.token-exchange.broker-scope`) need mappers for: `auth_time` ("Auth Time"
  session note mapper, "Add to access token"), `acr` ("Authentication Context Class Reference", "Add to access token") and `amr`
  (a user session note or script mapper that copies the methods of the login, "Add to access token"). A token that lacks one of them
  is not fresh as far as the upstreams are concerned, whatever the BFF thinks.
- **Check.** Decode an exchanged token of an administrator right after a step-up login: `auth_time` within the last minutes, and `acr`
  or `amr` as configured. The BFF logs no token, so use the exchange against the token endpoint with the same client for the check.

## Structure

```
src/main/java/pl/aiwcorpo/mcp/portal/bff/
  security/    OIDC login, step-up, CSRF, session, logout
  token/       token exchange (RFC 8693) for the broker and gateway admin aud, cached in the session
  upstream/    C4/C5 clients (mTLS, pinned TLS name)
  catalog/     GET /api/v1/catalog (CC-021 rules)
  connection/  GET/PUT/DELETE of connections
  mcpendpoint/ GET /api/v1/me/mcp-endpoint: /mcp address with filter, clientConfigs, tool count
  me/          GET /api/v1/me
  confirmation/ preview, viewed, cancel
  authenticator/ Authenticator (TOTP) enrollment
  activity/    GET /api/v1/activity/calls
  admin/       registry: view, definition diff, approval; servers, scope mapping, overrides, policy approval, broker systems (group mcp-platform-admin)
  limits/      per-session limits (429 with Retry-After)
  iga/         C13 port, mock (data: dev/iga-mock.yaml, profile dev only) and keycloak-groups adapters, access requests
  audit/       C8 events
  spa/         frontend serving, route fallback, CSP
  web/         JSON errors, returnPath, requestId
```

## M5: single `/mcp` address (contracts 5.1.0)

`GET /api/v1/me/mcp-endpoint?systems=&tools=&access=&exclude=` (CC-175, CC-182) returns a normalized address
`<PORTAL_PUBLIC_BASE_URL>/mcp[?filter]`, `filter` (when present), `toolCount` and `clientConfigs`. Nothing is stored and nothing
goes to the audit. Details:

- The four parameters arrive already decoded by the HTTP layer (`jira%2Cgitlab` is `jira,gitlab`). The BFF builds the query from
  them itself (`name=value` joined with `&`, `&` and `=` inside values written as `%26` and `%3D`, no re-encoding) and parses it
  with the `EndpointFilter` class from `mcp-manifest` 5.1.0, so the rules are the same as in the gateway. All of these are
  `400 invalid_request` with `reason: invalid_filter`: a parameter outside the four, a repeated one, a value with `%` after
  decoding, `+` (space), an empty value, an invalid escape (`%zz`), non-UTF-8 bytes, a parameter without a name (`?=jira`), a name
  outside the four after decoding (`?systems%3Djira%26access=read`), and empty segments (`&&`, leading or trailing `&`; the
  container would drop them silently while the gateway rejects them). The refusal happens before the gateway is called and
  reveals nothing about the user's tools.
- `toolCount`: a flat list from `servers[].tools[]` in the `GET /admin/v1/catalog` response (C5, token exchanged for
  `mcp-gateway-admin`), only `granted` and not `disabled`, after the filter (`EndpointFilter.allows`). It is an estimate; the
  gateway's `tools/list` is authoritative.
- `clientConfigs` is built from `PORTAL_PUBLIC_BASE_URL` (never from the request); the address is quoted because it contains `&`;
  the server name in the clients is `aiwcorpo-mcp`. The Claude Code flags `--client-id` and `--callback-port` still come from configuration.
- Activity: rows have `filter` instead of `virtualServer` (CC-174); `filter` is shown only in canonical form. The old result
  `denied_link_scope` is read as `denied_filter_scope` (CC-188; the gateway maps it on read and the BFF repeats that for an older
  gateway), and a `virtualServer` field from an old gateway is discarded without losing the row.
- `ReturnPath` does not allow `/mcp` or `/mcp?...` (CC-169); `/mcp-docs` and `/f/...` are allowed. The SPA fallback does not answer on `/mcp`.
- U12 (resuming after step-up without a second click): `401 step_up_required` carries a `stepUpUrl` whose `returnPath` is the page
  the request came from (the `Referer` header of the same origin as `PORTAL_PUBLIC_BASE_URL`, path and query without fragment, only
  when it satisfies `ReturnPath`; otherwise a fixed `/authenticator` or `/admin`). The contract does not change
  (`stepUpUrl.returnPath` is a default the frontend may replace). Resuming the action itself after the return is up to web: the
  page recognizes the return (`Me.mfaFreshUntil`, query in `returnPath`) and sends the saved request again. The BFF replays
  nothing, because it must not hold the request body (secret, TOTP code).

## CI

`make ci` (that is, `ci/run.sh`) is the only entry point: it checks JDK 25, style (characters, phrases), runs `./mvnw verify` and
prints the test count. It works locally without any CI system. In a container, `ci/run.sh --container` builds an image from
`ci/Dockerfile` and runs the same script in it (repository and `~/.m2` as volumes). The files `.gitlab-ci.yml`, `Jenkinsfile`
and `.github/workflows/ci.yml` in the `mcp-portal` root are thin wrappers that call `bff/ci/run.sh` and `web/ci/run.sh`.
No job needs a registry secret: the `mcp-contracts` artifacts come from public registries.
The Docker socket (job `web`) is available only on the main branch and a dedicated agent.
Isolation does not come from the wrapper files alone (a branch can change them) but from the CI system's settings. GitHub: no registry secrets and no token (`permissions: contents: read`). Jenkins: the label
`ci-style` is a pool without the Docker socket for the `style` step; the `docker` node accepts only `main` jobs; for pull requests the Jenkinsfile comes from a trusted branch
(a plugin with a trusted Jenkinsfile source), not from the PR branch. `ci/run.sh` fails on an unknown or
empty `CI_STEPS`, on a failed `mvnw` and on zero tests.

Status of the work and the split into milestones: [STATUS.md](STATUS.md).
