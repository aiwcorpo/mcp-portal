# mcp-portal/web

Frontend of the MCP platform portal (workstream ws-08): Angular 22.2 (standalone, signals, zoneless), Angular
Material 22.2, texts through `$localize`. It talks only to the BFF through the C12 API (`/api/v1`, contract
`portal-bff.v1.yaml` from `mcp-contracts` 7.0.0). The BFF (`../bff`, ws-07) serves the built files from the same origin.

Scope of the current version and the split into milestones: [STATUS.md](STATUS.md).

## Requirements

- Node 24, npm 11.
- The `@aiwcorpo/mcp-contracts` 7.0.0 package (OpenAPI, MSW handlers, vectors) as a dev dependency. It lives in
  `web/.contracts/` (git-ignored), where npm reads it from. `scripts/contracts.sh` fills that directory, see
  "Contracts package" below.
- Java 25, only to regenerate the API client (`npm run generate:api`).
- Chromium for Playwright: `npx playwright install chromium` (once).

```bash
scripts/contracts.sh && npm ci
```

### Contracts package

`package.json` points at a file: `"@aiwcorpo/mcp-contracts": "file:.contracts/aiwcorpo-mcp-contracts-7.0.0.tgz"`.
`.contracts/` is in `.gitignore`, so the repository holds no tarball. `scripts/contracts.sh` puts the package there from the
first available source: a file already in place (checked against `CONTRACTS_TARBALL_SHA256` when set),
`CONTRACTS_TARBALL=<file>`, `CONTRACTS_TARBALL_URL=<url>`, `CONTRACTS_SOURCE_DIR=<mcp-contracts checkout at tag v7.0.0>`
(runs `npm pack` there; a package from the same tag has the same bytes) or `CONTRACTS_FROM_NPMJS=1` (`npm pack` of the published
package from npmjs, no token; set `CONTRACTS_TARBALL_SHA256` to pin the bytes, as the GitHub workflows do). A release file from `mcp-contracts/release/`
also works as `CONTRACTS_TARBALL`. `ci/run.sh` calls the script itself before `npm ci`.

Once `mcp-contracts` is published on npmjs, change the entry in `package.json` to `"@aiwcorpo/mcp-contracts": "7.0.0"` and run
`npm install`, which updates `package-lock.json` (registry URL and checksum instead of a file). No token or `.npmrc` is
needed. With such a dependency `scripts/contracts.sh` does nothing.

## Running locally

On mocks (no BFF), MSW in the browser:

```bash
npm run start:mocks          # http://localhost:18730
```

The mock is stateful: login and logout, saving (without MFA) and deleting a connection, OAuth return, access request, and
the MCP address with a filter (`GET /me/mcp-endpoint`, computed by the gateway rules). Responses come from the C12 examples
(`@aiwcorpo/mcp-contracts/msw`; the catalog from the `states` example, extended with a few tools), and their handlers also
enforce CSRF. Row statuses and actions are computed by `deriveRow` from the contract table (tested against the
`catalog-actions/` vectors).

URL parameters, valid until the browser session ends (state in the `mcp-portal-mock` cookie, no secrets):

| Parameter | Values |
| --- | --- |
| `mockScenario` | `default` (`states` example: expiring token, reconnect required, no entitlements, service account, token exchange), `mixed` (`mixed` example: connected and not connected), `empty` (no servers), `wide` (53 tools: exceeds the default warning threshold and the 512-byte limit with 16 long names), `errors` (`503 upstream_unavailable` with `requestId`); changing the scenario resets changes |
| `mockAuthenticator` | `none`, `active`, `locked`, `disabled`: Authenticator enrollment (default `none`; starting enrollment and removal need fresh MFA, which the mock "performs" on the step-up redirect) |
| `mockIga` | IGA adapter behavior: `direct` (request created at once, default), `redirect` (response with the IGA form URL), `groups` (Keycloak adapter without requests: `422 not_requestable`), `down` (`503`) |
| `mockAdmin` | `in`: administrator session (Administration tab, registry with pending definitions; the hook `window.__portalMock.changePendingDefinition(serverId, tool)` changes a definition after the diff is opened, to trigger `409`) |
| `mockOAuth` | result of the next return from the provider: `ok`, `cancelled`, `flow_invalid`, `provider_error` |
| `mockSession` | `in` or `out`: start with or without a session (with `?loginError=<code>` shows login errors) |

Operation preview: `/confirm/cnf_4k9Qe2LxW7tB3mZp` (expires 120 s after first opening), `/confirm/cnf_Zb3Qm8TnR5vKd2Wy` (argument with control characters); any other id is 404. The Authenticator enrollment code is RFC 6238 from the seed `GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ` (`src/mocks/totp.ts`).

A token starting with `invalid` gives `422 secret_invalid`. The `getMcpEndpoint` mock uses the filter parser from the
contract (`src/app/core/mcp-filter.ts`, pinned by the `endpoint-filter/` and `mcp-endpoint/` vectors), so a bad filter
gives `400 invalid_filter`.

More URL parameters (also valid until the browser session ends): `mockAdapter=in` (two adapter tools wait in the Jira registry
for classification, one was classified and then changed: lowering needs MFA), `mockSecretMissing=in` (Jira connection in state
`error`), `mockBasic=in` (Jira token form with a login field, `userSecretScheme: Basic`). The mock keeps kill switches in its state
(`/admin/kill-switches`); lifting one needs "fresh MFA", like approval with a risk reduction.

With the real BFF (ws-01, port 18090):

```bash
npm start                    # http://localhost:18730, proxy /api -> http://localhost:18090 (proxy.conf.json)
```

The `mcp-portal-bff` client in Keycloak has its redirect URI on `http://localhost:18090`, so after login the browser returns
to port 18090. Cookies on `localhost` do not depend on the port: go back to `http://localhost:18730` and the session works
through the proxy.

## Administration screens (2.0.0)

`/admin` is the approvals view (tool definitions, and the policies and resource types of a server next to them); the sub
navigation (`AdminNav`) leads to `/admin/servers`, `/admin/systems`, `/admin/scope-mapping`, `/admin/overrides` and
`/admin/kill-switches`. The code is in `src/app/features/admin/`.

- No list of systems, servers or resource types is in the code. `systemName` writes the identifier with a capital letter
  (the contracts have no display name), `SYSTEM_ID_PATTERN` and the patterns in `admin-validation.ts` follow `common.schema.json`,
  and the systems of the request dialog, the servers of the override target and the datalist of the server form come from the
  catalog, the registry and the broker.
- Writes carry the ETag they were read with (`If-Match`; a create sends `If-None-Match: *`). `401 step_up_required` goes through
  `AdminStepUp`: the form (never the client secret) is kept in `sessionStorage` as an `admin-draft` of `ResumeIntentStore`, the
  browser goes to the IdP with `?mfa=ok` as the return address and the page takes the draft back; the approval of policies carries
  itself out after the return. A second step-up request right after a return is shown as an error, not repeated.
- Rejected writes (`server_rejected`, `scope_mapping_rejected`, `override_rejected`, `system_rejected`) are shown with the page's
  own text for the closed `reason` and, under it, the gateway's `message` as inert text (`neutraliseText`).
- Mock build: the registry data of these screens (servers, systems, mapping, overrides) is in `src/mocks/dynamic-mock.ts` and in
  `sessionStorage`, not in the state cookie; `?mockPolicies=in` puts the policies of Jira (changed) and of a new Notes server up for
  approval. The unit tests of the screens are `*-page.spec.ts` in the same folder, the end-to-end ones `e2e/dynamic-servers.spec.ts`.

## Build for the BFF (ws-07)

```bash
npm ci && npm run build
```

Output: `mcp-portal/web/dist/portal/` (flat, no `browser/` subdirectory): `index.html`, `main-<hash>.js`,
`polyfills-<hash>.js`, `chunk-<hash>.js`, `styles-<hash>.css`, `favicon.svg`, `3rdpartylicenses.txt`.
The production build contains neither MSW nor `mockServiceWorker.js`.

What the BFF has to do when serving:

1. Serve the files from `dist/portal/` under `/`. Every path outside `/api/**` that is not a file gets
   `index.html` (SPA routes: `/catalog`, `/connect/jira`, `/connections`, ...).
2. In `index.html`, replace every occurrence of `__CSP_NONCE__` with a random nonce per response (at least
   128 bits, base64) and send the header:

   ```
   Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'nonce-<nonce>';
     img-src 'self'; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self';
     form-action 'self'; frame-ancestors 'none'
   ```

   The nonce is needed only for styles: Angular inserts component styles (Angular Material too) as `<style>`
   elements and gives them the nonce from the `ngCspNonce` attribute on `<app-root>`. Scripts are files only
   (`script-src 'self'`), critical CSS is not inlined (`inlineCritical: false`), fonts are system fonts. Without the
   nonce substitution the browser blocks component styles and the page is visibly broken, so the mistake shows at once.
3. `index.html` with `Cache-Control: no-store`; files with a hash in the name can be cached as immutable.
4. The rest as in C12: an `XSRF-TOKEN` cookie readable by JS (not HttpOnly, `Path=/`), set by `GET /api/v1/me` at the latest;
   `401 {"error":"unauthenticated"}` for `/api/**` instead of a redirect to the IdP.

`scripts/serve-csp.mjs` is the reference implementation of points 1-3 (Node, no dependencies); the e2e tests run on it.
The only difference is `worker-src 'self'`, needed only by the MSW service worker in the e2e build.

The frontend redirects to the OAuth provider (`authorizeUrl`) only for `https:`; `http:` only for `localhost`, `127.0.0.1`
and `[::1]` (ws-01 mocks).

The frontend builds `GET /api/v1/auth/login?returnPath=<path>` with `URLSearchParams`, so `returnPath` arrives encoded in the
query. The BFF decodes the parameter once, the standard way, and validates the result against the `ReturnPath` pattern
(CC-032). Saving a token needs no step-up MFA (CC-090); `stepUpUrlFor` in `core/auth-urls.ts` stays for confirmations (M3).

Return from the OAuth provider: the frontend sends `returnPath=/catalog?system=<system>` (or `/connections?...`), because the BFF
appends only `connected=<system>` or `connectError=<code>` (`ConnectErrorCode` codes, including `cancelled`), and the error
message has to name the system. Values from the URL are checked against closed lists; unknown ones give a generic message.

## Tests and lint

```bash
npm test                     # Vitest + jsdom, MSW (msw/node) with the same handlers as the mock mode
npm run lint                 # angular-eslint, including template accessibility rules
npm run i18n:check           # texts in code match src/locale/messages.xlf
npm run e2e                  # e2e config build + Playwright (Chromium, 1280 px and 360 px)
```

`npm run e2e` builds the app in optimized mode with MSW (`dist/e2e/`) and serves it through `scripts/serve-csp.mjs` with the
CSP above. Every e2e test fails if the browser reports a CSP violation or an unhandled exception. Accessibility tests use
axe-core (WCAG 2.1 A/AA) in the dark (default) and light (switch in the header) theme.

Screenshots for the repository README (1280 x 800 px, light theme, mock data): `npm run screenshots` writes them to `../docs/screenshots`.
Screenshots of key views to compare with the mockups (`mcp-platform-plan/design/`), 1280 and 360 px:

```bash
SHOTS_DIR=/path/to/dir npx playwright test e2e/screenshots.spec.ts   # after npm run build:e2e
```

File names start with the mockup number, e.g. `01-serwery-mcp-rozwiniete-desktop.png` or
`08-adres-mcp-mobile-360.png`.

## CI

One entry point: `ci/run.sh` (called by `make ci`). Steps: `style` (hidden and typographic characters, forbidden phrases),
`lint`, `i18n`, `unit`, `build`, `e2e`; a subset through `CI_STEPS=style,unit ci/run.sh`.
`ci/run.sh --container` does the same in the image from `ci/Dockerfile` (Node 24 and Chromium from the Playwright 1.64.1
image). It mounts only `web/` (with the contracts package in `.contracts/`), read-only, and copies the sources without `node_modules`.
Contracts package: `scripts/contracts.sh` (file in `web/.contracts/`, `CONTRACTS_TARBALL`, `CONTRACTS_TARBALL_URL` with
`CONTRACTS_TARBALL_SHA256`, `CONTRACTS_SOURCE_DIR`, or `CONTRACTS_FROM_NPMJS=1` for the public npm registry); paths given on the host are
brought in before mounting. Pull requests need only `CI_STEPS=style` (no npm, no package); the full run happens on the main
branch. `PW_WORKERS` (default 4 in the container) limits the number of browsers. `.gitlab-ci.yml`, `Jenkinsfile` and GitHub
Actions workflows may only call this script.

## MCP address and the list size warning

The `/endpoint` page shows the address of the whole platform (`<publicBaseUrl>/mcp`) and lets you narrow it with a filter
(`systems`, `tools`, `access`, `exclude`). Nothing is saved; the BFF returns the address and client configurations.
The wizard builds the query itself and counts bytes: the limit is 512 bytes, not 100 tools (CC-185). When the selection does
not fit, it sends no request and suggests systems and exclusions.

The list size warning appears from `toolCount >= 50`. The threshold is not settled (it waits for a measurement of the list's
token cost in the M5 load test), so it is configuration: `<meta name="mcp-tool-list-warning"
content="N">` in `index.html` (a positive integer, otherwise 50 applies). Above 100 tools the page reminds that the client must
follow `nextCursor` (CC-181).

## Resuming an action after MFA

When an action ends with `step_up_required`, the portal stores one entry in the tab's `sessionStorage`: the action kind and
identifiers (server and tool, hash of the definition being approved), valid for 5 minutes, never tokens, keys or
passwords. After the return with `?mfa=ok` the action runs once, without a second click: approving a definition (only when
the hash is the one the administrator saw, and for an adapter tool also with the classification chosen before MFA),
lifting a kill switch (only when it is still active), starting Authenticator enrollment, removing the
Authenticator (after the warning confirmed before MFA). `?mfa=ok` alone in the URL starts nothing. A form with a token is not
resumed: the secret must not be stored, so the user types it again.

## API client

`src/app/api/generated/` is generated from `portal-bff.v1.bundled.yaml` (openapi-generator 7.26.0,
`typescript-angular`, `openapitools.json`) and kept in the repository so the build needs neither Java nor network.
Do not edit by hand.

```bash
export JAVA_HOME=<JDK 25 directory>       # macOS: "$(/usr/libexec/java_home -v 25)"
npm run generate:api
git diff --stat src/app/api/generated     # changes only after a contract update
```

`--type-mappings set=Array`: arrays with `uniqueItems` arrive in JSON as arrays, and the default `Set` in the types would
lie. The client `basePath` is empty (`provideApi({ basePath: '' })`), so calls are relative, and `xsrfInterceptor`
(`src/app/core/xsrf.interceptor.ts`) adds `X-XSRF-TOKEN` to POST, PUT and DELETE. It reads the value from the
`__Host-XSRF-TOKEN` cookie (contract, CC-055), and when that is missing from `XSRF-TOKEN` (the name the BFF used until M1);
Angular's built-in mechanism (one name) is switched off by `withNoXsrfProtection()`.

Changing the contracts version: replace the package name in `package.json` (`@aiwcorpo/mcp-contracts`), `scripts/contracts.sh`,
`npm install`, `npm run generate:api`, tests.

## Texts and i18n

English is the source: texts in code and templates are in English with identifiers (`i18n="@@..."`,
`` $localize`:@@...:` ``), `sourceLocale` is `en`. The Polish translation is `src/locale/messages.pl.xlf` (XLIFF 2, same
identifier, `<target>`). One build serves both languages: `scripts/i18n.mjs json` (run by `prebuild`,
`prestart`) turns the Polish file into `public/i18n/messages.pl.json` (git-ignored), and `main.ts` picks the language before the
app starts (saved choice in `localStorage`, then `navigator.languages`: `pl` or English) and for Polish registers the
translations through `loadTranslations`. The app modules load only afterwards (`import()` in `main.ts`), because `$localize` is
evaluated when a module loads. The language switch in the header and on the login screen saves the choice and reloads the page. The BFF and
nginx serve `i18n/messages.pl.json` like any other static file; CSP is unchanged (`connect-src 'self'`).

`npm run i18n:extract` -> `src/locale/messages.xlf`; a new text has to be added to `messages.pl.xlf` (a unit with the same
`id` and `<target>`). `npm run i18n:check` fails when `messages.xlf` does not match the texts in code, when a text
has no Polish translation, or when a translation has different markup and interpolations than the source (meant for CI).
E2e tests run in English (`locale: 'en-US'`); there is one Polish smoke suite, `e2e/polish.spec.ts`.
Error messages come only from codes (C10 and C12 codes from CC-012/CC-022, `src/app/core/error-messages.ts`);
the `message` field of a BFF response is never displayed.

## Structure

```
src/app/
  api/generated/        C12 client (generated)
  core/                 session, error mapping, login URLs, admin guard, theme, interceptors (session, XSRF)
  shared/               messages, labels, row state, OAuth return, loading and load error, dialog
  features/login/       login screen and loginError errors
  features/catalog/     MCP servers (table with expandable rows)
  features/connect/     Connect account (OAuth, PAT token)
  features/connections/ System connections
  features/endpoint/    MCP address: one platform address, filter wizard without saving, client configuration
  features/requests/    Requests: list, "Submit request" dialog with IGA entitlements
  features/admin/       Administration (lazy, isAdmin only): registry, definition diffs, approval, adapter tool
                        classification (dialog), kill switches (`/admin/kill-switches`)
src/mocks/              stateful layer over the MSW handlers from the contracts; MSW start in the browser
src/testing/            unit test helpers (MSW in Node, TestBed)
e2e/                    Playwright
scripts/serve-csp.mjs   static server with CSP and nonce (pattern for the BFF, used in e2e)
```

`src/app/core/mock-api.ts` does nothing in the production build; the `mocks` and `e2e` configurations replace it
with `src/mocks/mock-api.msw.ts` (`fileReplacements` in `angular.json`).
