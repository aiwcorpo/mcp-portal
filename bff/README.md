# mcp-portal-bff

Backend portalu MCP (strumień ws-07): logowanie OIDC i sesja po stronie serwera, API C12 dla frontendu,
agregacja C5 (gateway admin), C4 (credential broker) i C13 (IGA). Przeglądarka nigdy nie dostaje tokenów
ani sekretów. BFF serwuje też zbudowany frontend Angular (`../web`) z tego samego originu.

Stos: Java 25, Spring Boot 4.1.0 (Spring Security 7.1), Maven wrapper. Kontrakty: `mcp-contracts` 6.3.2 (jary `mcp-contracts`, `mcp-manifest` i `test-vectors` w `~/.m2` albo w rejestrze Maven z `MCP_MAVEN_REPOSITORY_URL`, np. GitHub Packages `https://maven.pkg.github.com/aiwcorpo/mcp-contracts`; ustawienia w `.ci/settings.xml`).
Obraz: `Dockerfile` w korzeniu repozytorium (cele `bff`, `web`, `portal`), `scripts/build-images.sh`; opis w [../README.md](../README.md).

## Uruchomienie lokalne

Wymagane: JDK 25 (`scripts/select-jdk.sh` szuka go sam; `JAVA_HOME` ma pierwszeństwo) i `mcp-contracts` 6.3.2 w `~/.m2` albo w rejestrze. Dwa tryby.

Z mockami (bez `mcp-platform-dev`; dane C4/C5 z mocków WireMock z jara kontraktów):

```bash
./mvnw -q test-compile                  # raz: pobiera jary WireMock i kontraktów do ~/.m2
./scripts/run-mocks.sh start            # C4 :18721, C5 :18722, discovery OIDC :18723
PORTAL_MOCKS=1 ./scripts/run-dev.sh     # BFF na http://localhost:18720
./scripts/run-mocks.sh stop
```

Bez `mcp-platform-dev` nie ma Keycloaka: BFF startuje (stub discovery na :18723), `/api/v1/me` daje 401, a logowanie
nie działa. Wartości można podać jawnie zmiennymi `PORTAL_OIDC_ISSUER_URI` i `PORTAL_OIDC_CLIENT_SECRET` (np. dla
własnego Keycloaka); gdy katalog `mcp-platform-dev` istnieje (obok repozytorium albo `MCP_PLATFORM_DEV_DIR`), skrypt
bierze z niego issuera i sekret klienta, więc logowanie działa po `make up` tam.

Ze stosem `mcp-platform-dev` (`make up`: Keycloak :18080, stuby C4 i C5 z mTLS):

```bash
./scripts/run-dev.sh            # BFF na http://localhost:18720 (port ws-07)
```

Tryb ze stosem wymaga katalogu `../../mcp-platform-dev` (inny: `MCP_PLATFORM_DEV_DIR=...`); brak katalogu albo
klucza w `.env` / `.secrets/dev.env` kończy się czytelnym komunikatem. Skrypt czyta sekret klienta `mcp-portal-bff`,
hasło keystore'ów i porty przy każdym starcie, nic nie jest kopiowane do tego repozytorium. Każdą wartość można
nadpisać zmienną `PORTAL_*` (tabela niżej). Prawdziwy broker zamiast stuba:
`PORTAL_BROKER_URL=https://localhost:18100 ./scripts/run-dev.sh`.

Skrypt znajduje JDK 25 (`scripts/select-jdk.sh`) i kończy się czytelnym komunikatem, gdy go nie ma, oraz
włącza profil Spring `dev`. Podmiana mocków na prawdziwe usługi to zmiana dwóch adresów (`PORTAL_BROKER_URL`,
`PORTAL_GATEWAY_ADMIN_URL`). Logowanie przez Keycloak wymaga w realmie `corp` redirect URI
`<PORTAL_PUBLIC_BASE_URL>/api/v1/auth/callback`.

Frontend: `cd ../web && npx ng build`, wynik w `../web/dist/portal` (domyślne `PORTAL_WEB_DIST`). Bez
builda API działa, a trasy SPA odpowiadają 404.

Szybkie sprawdzenie:

```bash
curl -i http://localhost:18720/api/v1/me                         # 401 {"error":"unauthenticated"}
open 'http://localhost:18720/api/v1/auth/login?returnPath=/'     # logowanie alice (hasło: make users)
```

## Testy

```bash
./mvnw test             # jednostkowe + API (profil dev) przez HTTP (fałszywy IdP, stuby WireMock C4/C5 z mcp-contracts)
./mvnw test -Pdev-env   # z prawdziwym Keycloakiem i stubami mTLS z mcp-platform-dev (make up, port 18090 wolny)
```

| Test | Co sprawdza |
| --- | --- |
| `PortalApiTest` | każda odpowiedź API walidowana schematem C12 (`portal-bff.v1.bundled.yaml` z jara kontraktów, status spoza kontraktu = błąd); logowanie z PKCE i nonce; ciasteczka `__Host-session` i `__Host-XSRF-TOKEN`; CSRF dla PUT/DELETE/POST; step-up (`step_up_required` + `stepUpUrl`, `max_age=0`, powrót); wymiana tokenów na `aud` brokera i gateway admin; audyt C8 walidowany `audit-event.schema.json`; SPA z fallbackiem, CSP z nonce, HSTS; `/api/**` nigdy HTML; na końcu: żadna odpowiedź ani linia logu nie zawiera tokenu IdP ani sekretu |
| `RunDevConfigurationTest` | start z tą samą konfiguracją co `run-dev.sh` (profil `dev`, zmienne `PORTAL_*` jako zmienne środowiska z relaxed binding) i dane mocka IGA w katalogu |
| `FrontendBuildTest` | prawdziwy build ws-08 z `../web/dist/portal` (pomijany, gdy nie zbudowany; `-Dportal.test.require-web-dist=true` robi z tego błąd): trasy SPA, nonce w stylach, pliki JS/CSS; powrót po logowaniu na `PORTAL_WEB_LOGIN_RETURN_ORIGIN` |
| `CatalogAssemblerTest` | reguły statusów i akcji katalogu (CC-021); odtworzenie przykładu `mixed` z C12 z danych C5/C4/C13 |
| `ReturnPathsTest` | wektory `test-vectors/return-paths` (CC-032) |
| `StepUpPolicyTest`, `RequestIdsTest` | świeżość MFA, budowa `stepUpUrl`, UUIDv7 dla `requestId` |
| `DevEnvironmentFlowTest` (`-Pdev-env`) | alice: logowanie w Keycloak, `me`, katalog, połączenia, zapis sekretu, step-up z ponownym logowaniem, odłączenie, wylogowanie także z IdP; mallory bez grup |
| `UpstreamTlsDevEnvironmentTest` (`-Pdev-env`) | mTLS do stuba C4: certyfikat z obcego CA odrzucony, nazwa TLS przypięta (CC-035) |
| `UpstreamGuardsTest`, `IgaConfigTest`, `LoginRedirectsTest`, `MockAccessGovernanceTest` | odmowa startu dla ustawień tylko-dev poza profilem `dev`, http i brak mTLS; normalizacja danych C4/C5; kody `loginError`; identyfikacja wnioskodawcy claimem |

## Konfiguracja

Wszystko przez zmienne środowiska (`application.yml`):

| Zmienna | Znaczenie | dev |
| --- | --- | --- |
| `PORTAL_PORT` | port HTTP | `18720` |
| `PORTAL_OIDC_ISSUER_URI` | issuer OIDC (discovery) | `http://localhost:18080/realms/corp` |
| `PORTAL_OIDC_CLIENT_ID`, `PORTAL_OIDC_CLIENT_SECRET` | klient poufny | `mcp-portal-bff`, `KC_CLIENT_MCP_PORTAL_BFF_SECRET` |
| `PORTAL_BROKER_URL`, `PORTAL_BROKER_TLS_NAME` | C4 i nazwa w certyfikacie brokera | `https://localhost:18443`, `MCP_BROKER_TLS_NAME` |
| `PORTAL_GATEWAY_ADMIN_URL`, `PORTAL_GATEWAY_ADMIN_TLS_NAME` | C5 i nazwa w certyfikacie | `https://localhost:18444`, `MCP_GATEWAY_INTERNAL_TLS_NAME` |
| `PORTAL_PUBLIC_BASE_URL` | origin jednej domeny (portal, `/api`, `/mcp`, `/s/`): z niego redirect URI OIDC `<url>/api/v1/auth/callback`, linki `copy_link` i `clientConfigs`; nigdy z `Host`; poza `dev` tylko https, bez literału IPv6 (dawna nazwa: `PORTAL_GATEWAY_PUBLIC_URL`) | `http://localhost:18720` |
| `PORTAL_TLS_KEYSTORE`, `PORTAL_TLS_KEYSTORE_PASSWORD` | certyfikat klienta `CN=mcp-portal-bff` (PKCS12) | `certs/mcp-portal-bff/keystore.p12` |
| `PORTAL_TLS_TRUSTSTORE`, `PORTAL_TLS_TRUSTSTORE_PASSWORD` | CA wewnętrzne | `certs/ca/truststore.p12` |
| `PORTAL_WEB_DIST` | katalog z `index.html` zbudowanego frontendu | `../web/dist/portal` |
| `PORTAL_WEB_LOGIN_RETURN_ORIGIN` | tylko dev: origin frontendu z `ng serve`, na który BFF wraca po logowaniu (`scheme://host:port`, z konfiguracji, nigdy z żądania) | puste; z `npm start` w `web/`: `http://localhost:4200` |
| `SPRING_PROFILES_ACTIVE` | `dev` tylko dla mcp-platform-dev; bez niego BFF nie wstanie z adapterem IGA `mock`, step-up bez `acr`, `PORTAL_WEB_LOGIN_RETURN_ORIGIN` ani `portal.tls.insecure-plain-http-for-tests` | `dev` (ustawia `run-dev.sh`) |
| `PORTAL_LIMIT_SECRET_WRITE_MAX`, `PORTAL_LIMIT_SECRET_WRITE_WINDOW` | zapis tokenu (`PUT .../secret`): najwyżej tyle żądań w oknie na sesję, potem `429` z `Retry-After` (CC-156) | `10`, `1m` |
| `PORTAL_LIMIT_AUTHENTICATOR_MAX`, `PORTAL_LIMIT_AUTHENTICATOR_WINDOW` | zapisy Authenticatora (start, usunięcie, potwierdzenie) na sesję | `10`, `10m` |
| `PORTAL_IGA_ADAPTER` | adapter C13: `keycloak-groups` albo `mock` (tylko `dev`); brak = błąd startu | `mock` (profil `dev`) |
| `PORTAL_IGA_CATALOG_FILE` | katalog uprawnień adaptera `keycloak-groups` (ten sam format YAML co mock: `entitlements`, opcjonalnie `descriptions`); adapter nie ma obiegu wniosków | brak |
| `PORTAL_IGA_MOCK_FILE` | dane adaptera `mock` (poza jarem): zwykła ścieżka w systemie plików, bez `file:` | `dev/iga-mock.yaml` |
| `PORTAL_IGA_REQUESTER_ID_CLAIM` | claim logowania identyfikujący wnioskodawcę w IGA; brak claimu u użytkownika = błąd adaptera (503) | `preferred_username` |
| `PORTAL_CLIENT_CONFIGS_CLAUDE_CODE_CLIENT_ID` | `--client-id` w komendzie `clientConfigs.claudeCode`; puste = bez flagi (litery, cyfry, `.`, `_`, `-`; inna wartość to błąd startu) | `claude-code` w profilu `dev`, poza nim puste |
| `PORTAL_CLIENT_CONFIGS_CLAUDE_CODE_CALLBACK_PORT` | `--callback-port` w tej komendzie (1024-65535); puste = bez flagi | `33418` w profilu `dev`, poza nim puste |
| `PORTAL_TRUSTED_PROXIES` | regex adresów proxy, od których przyjmowane są `X-Forwarded-*` | `127[.]0[.]0[.]1\|0:0:0:0:0:0:0:1` |
| `PORTAL_STEP_UP_MAX_AGE` | wiek ostatniego logowania dla operacji ze step-up | `5m` |
| `PORTAL_STEP_UP_ACR_VALUES` | wartości `acr` uznawane za MFA; puste = tylko `auth_time`, dozwolone wyłącznie w profilu `dev` | puste (realm nie ma poziomów `acr`) |

C4 i C5 tylko po https z certyfikatem klienta i własnym truststore (CA wewnętrzne); http, brak keystore albo
truststore to błąd startu. Wyjątek: `portal.tls.insecure-plain-http-for-tests=true` w profilu `dev` (testy na
stubach WireMock bez TLS). Nazwa TLS (`*_TLS_NAME`) jest sprawdzana jako DNS SAN certyfikatu serwera niezależnie od hosta w URL, więc
połączenie przez `localhost` nie wyłącza weryfikacji nazwy.

Logowanie: jedyne wejście to `GET /api/v1/auth/login` (`/oauth2/authorization/*` jest zamknięte). Step-up musi
uwierzytelnić ten sam `sub`, inaczej sesja jest unieważniana. Po każdym logowaniu w sesji zostaje tylko nowy
kontekst bezpieczeństwa i tokeny. Błąd logowania: 302 na `/?loginError=<kod>`, kody `cancelled`, `idp_error`,
`session_expired`, `step_up_failed`.

Sesja: ciasteczko `__Host-session` (Secure, HttpOnly, SameSite=Lax, Path=/), bezczynność 30 min, limit
bezwzględny 8 h, sesje w pamięci procesu. CSRF: ciasteczko `__Host-XSRF-TOKEN` (Secure, SameSite=Strict, czytelne
dla JS, ustawiane już w odpowiedzi kończącej logowanie) i nagłówek `X-XSRF-TOKEN` dla POST/PUT/DELETE; parametr
`_csrf` nie jest przyjmowany.

Frontend i CSP (uzgodnione z ws-08, `../web/README.md`): `index.html` jest serwowany przez BFF przy każdej
trasie SPA z `Cache-Control: no-store`; każde wystąpienie `__CSP_NONCE__` jest zastępowane losowym nonce
(128 bitów, base64) z nagłówka tej odpowiedzi:
`default-src 'self'; script-src 'self'; style-src 'self' 'nonce-<n>'; img-src 'self'; font-src 'self';
connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`.

Audyt C8: logger `pl.aiwcorpo.mcp.audit`, jedna linia JSON na zdarzenie na stdout, `component: portal`,
`componentId: mcp-portal-bff`, zdarzenie `connection_change` dla zapisu sekretu i odłączenia (także odmowy
step-up i odrzucenia przez broker).

## M2: połączenia, wirtualne serwery, testy

Callback OIDC to `/api/v1/auth/callback` (jedna domena, CC-089). Połączenie OAuth: `POST /connections/{system}/oauth`
zapisuje w sesji `flowId`, `state` z `authorizeUrl` i `returnPath`; `GET /api/v1/oauth/callback` szuka przepływu po
`state` w sesji bieżącego użytkownika (jednorazowo, 15 min, najwyżej 8 naraz), a kody `connectError` to
`cancelled`, `provider_error`, `flow_invalid` (`identity_mismatch` usunięte w kontraktach 3.0.0). Zapisane linki
(`/api/v1/virtual-servers`, `/v/<slug>/mcp`) zniknęły w kontraktach 5.0.0 (CC-175, CC-177): zamiast nich jest
`GET /api/v1/me/mcp-endpoint` (niżej).

`clientConfigs.claudeCode` to `claude mcp add --transport http [--client-id <id>] [--callback-port <port>] aiwcorpo-mcp "<adres>"`.
Keycloak w mcp-platform-dev nie pozwala na dynamiczną rejestrację klienta, więc bez obu flag Authenticate w Claude Code
nie działa; profil `dev` ustawia `claude-code` i `33418` (klient `claude-code` w realmie musi mieć redirect URI
`http://localhost:33418/callback`). Produkcja z Entra ID może potrzebować innego klienta albo żadnego, dlatego domyślnie
flag nie ma. Copilot i Codex dostają tylko adres: nie ma potwierdzonego pola na identyfikator klienta w ich konfiguracji
(patrz STATUS.md). Zdarzenie `connection_change` niesie `backendUser` połączonego konta (CC-117; brak, gdy broker go nie zwrócił).

| Test | Co sprawdza |
| --- | --- |
| `OAuthConnectTest`, `ConnectRedirectVectorsTest` | start i callback, wszystkie kody, cudzy link, powtórzenie, brak sesji, wektory `connect-redirects/` |
| `McpEndpointTest`, `McpEndpointVectorsTest`, `ComposedQueryTest` | `GET /api/v1/me/mcp-endpoint`: wektory `mcp-endpoint/` także z zapytaniem tak, jak je wysyła klient, licznik z katalogu C5, odmowy bez wywołania gateway'a, brak audytu |
| `ClientConfigsTest`, `ClientConfigsBindingTest` | komenda Claude Code (wartości graniczne, metaznaki, brak flag bez profilu `dev`, błąd startu przy złej wartości) |
| `BackendUserAuditTest` | `backendUser` w audycie zgodny ze wzorcem schematu C8 albo pomijany |
| `NegativeSecurityTest` | `X-Request-Id` na każdej odpowiedzi i ignorowanie wartości klienta, brak XSRF, cudza sesja i token, sekret i kod OAuth w logach, `returnPath` poza wzorcem |
| `PublicBaseUrlTest` | redirect URI z konfiguracji mimo `X-Forwarded-Host` |
| `CatalogAssemblerTest` | wektory `catalog-actions/`, przykłady `mixed` i `states` z C12 |

## M3: potwierdzenia, Authenticator, logi aktywności

Kontrakty 3.0.1. Potwierdzenie akcji DESTRUCTIVE to kod TOTP wpisany w kliencie MCP i sprawdzany przez broker, więc
BFF nie ma endpointu decyzji (`POST /api/v1/confirmations/{id}` to 405).

- `GET /api/v1/confirmations/{id}`: podgląd tylko do odczytu (proxy do C5), sama sesja, bez MFA, `Cache-Control: no-store`.
  Odpowiedź bez zgodności ze schematem albo dla innego `confirmationId` to 503, nie pusty podgląd. Id spoza wzorca,
  cudze, wygasłe i unieważnione to ten sam `404 not_found_or_denied`.
- `POST .../viewed`: XSRF oraz `Sec-Fetch-Site: same-origin` (brak nagłówka lub inna wartość: `403 csrf_invalid`);
  żądanie z `Sec-Purpose` albo `Purpose` zawierającym `prefetch` dostaje 204 bez przekazania do gateway'a.
- `POST .../cancel`: XSRF, bez MFA. Gdy gateway nie może spalić kodów u brokera, jest 503 i nic nie zostaje anulowane.
- `GET /api/v1/activity/calls`: filtry `limit`, `from`, `to`, `result`, `q`, `cursor` są sprawdzane (jeden raz, w granicach
  C12; reszta parametrów nie jest przekazywana), kursor `X-Next-Cursor` idzie w obie strony bez zmian. Wiersze poza
  schematem są pomijane, kursor spoza `[\x21-\x7e]{1,256}` to 503. 400 gateway'a przy podanym kursorze to 400.
- Authenticator (`/api/v1/authenticator`, `/enrollment`, `/enrollment/confirm`): start rejestracji i usunięcie wymagają
  świeżego MFA (`401 step_up_required` ze `stepUpUrl`, powrót na `portal.step-up.authenticator-return-path`, domyślnie
  `/authenticator`), pierwszy kod nie. Ziarno jest w jednej odpowiedzi `201` (`no-store`), nie trafia do sesji, logów ani
  audytu; w sesji zostaje `enrollmentId`, a cudzy lub zużyty to `404 not_found_or_denied`. Stan `disabled` z `disabledAt` i
  `disabledReason` jest przekazywany; start rejestracji ze stanu `disabled` nie woła wcześniej `DELETE`.
  `GET /api/v1/me` zwraca `mfaFreshUntil`, gdy ostatnie logowanie liczy się jako świeże.
- Step-up: o świeżości decydują `auth_time` (`portal.step-up.max-age`, 5 min, ponowne logowanie z `max_age=0`) oraz dowód MFA.
  Dowodem jest `acr` z listy `PORTAL_STEP_UP_ACR_VALUES` (Keycloak; wysyłane też jako `acr_values`; dev: `mfa`) albo `amr` z ID
  tokenu zawierający wartość z `PORTAL_STEP_UP_AMR_VALUES` (Entra ID: `mfa`, gdy Conditional Access wymusiło drugi czynnik; polityka
  musi obejmować aplikację portalu). Wystarczy jedno ze źródeł. Obie listy puste: tylko `auth_time`, dozwolone wyłącznie w profilu
  `dev`, inaczej błąd startu.
- Audyt: `authenticator` (`authenticator_enrollment_started`, `authenticator_registered`,
  `authenticator_enrollment_failed`, `authenticator_removed`, `step_up_required`, `upstream_unavailable`) i
  `admin_change` dla odmówionych zatwierdzeń definicji. Zdarzenia `virtual_server_change` zniknęły ze schematu (CC-174). Zdarzenia `confirmation` (w tym `cancelled_by_owner`) pisze gateway.
- Podgląd: odpowiedź gateway'a jest czytana jako obiekt zamknięty (pole spoza schematu: 503), najwyżej 64 argumenty, wartość po
  neutralizacji najwyżej 8192 znaki (dłuższa cięta, `truncated: true`).
- Tekst w podglądzie: wartości argumentów ze znakami ukrytymi (`TextHygiene`: bidi, zero-width, tag, wypełniacze, sterujące poza
  `\n` i `\t`, separatory, samotne surogaty, prywatne i nieprzypisane) trafiają do przeglądarki jako `<U+202E>` (literalne `<U+` w wartości dostaje `<U+003C>`, więc zapis zawsze znaczy znak, który tam był); nazwa
  argumentu, `resource.id`, `resource.parent` i `client` z takimi znakami powodują odrzucenie (podglądu albo wiersza). Definicja
  wg CC-121, ostrzejsza o U+200C..U+200F i CR.
- `ReturnPath` (CC-099): bez średnika; pierwszy segment nie jest `api`, `mcp`, `s`, `v` ani `.well-known` (`/mcp-docs` jest dozwolone); żaden segment ścieżki
  nie jest `.` ani `..`.

| Test | Co sprawdza |
| --- | --- |
| `ConfirmationsTest` | podgląd bez skutków ubocznych, `viewed` (XSRF, `Sec-Fetch-Site`, prefetch), `cancel` bez MFA, 404 dla cudzych, brak endpointu decyzji |
| `AuthenticatorTest` | step-up przy starcie i usunięciu, ziarno raz i `no-store`, brak ziarna i kodu w logach i audycie, `enrollmentId` związany z sesją, stan `disabled`, `mfaFreshUntil` |
| `ActivityCallsTest` | filtry, kursor bez zmian, parametry spoza kontraktu, wiersze poza schematem |
| `GatewayDataTest` | neutralizacja ukrytych znaków, zgodność z wektorami `text-hygiene/` |
| `BackchannelOidcTest` | logowanie bez discovery (`portal.oidc.*`), `iss` nadal sprawdzany, błąd startu przy niepełnym zestawie adresów |
| `ReturnPathsTest`, `NegativeSecurityTest` | wektory `return-paths/` z 3.0.1 |

## OIDC z osobnymi adresami (bez discovery)

Gdy BFF w kontenerze widzi IdP pod innym adresem niż przeglądarka, discovery pod `issuer-uri` wymagało przekaźnika
na publicznym adresie (`idp-relay` w mcp-platform-dev). Zamiast tego: `PORTAL_OIDC_TOKEN_URI` włącza rejestrację z jawnych
adresów, a wtedy obowiązkowe są też `PORTAL_OIDC_AUTHORIZATION_URI` (adres publiczny, dla przeglądarki) i
`PORTAL_OIDC_JWK_SET_URI`; opcjonalne `PORTAL_OIDC_USER_INFO_URI` i `PORTAL_OIDC_END_SESSION_URI` (logowanie z IdP przez
back channel). `PORTAL_OIDC_ISSUER_URI` zostaje oczekiwanym `iss` (porównywanym, nie pobieranym). Adresy tylko http są
dopuszczone w profilu `dev`; adres dla przeglądarki jest https albo http na loopbacku w dev. Bez `PORTAL_OIDC_TOKEN_URI`
działa discovery jak dotąd. Dla mcp-platform-dev (zmiana compose po stronie ws-01):
`PORTAL_OIDC_AUTHORIZATION_URI=https://localhost:18746/realms/corp/protocol/openid-connect/auth`,
`PORTAL_OIDC_TOKEN_URI=http://keycloak:8080/realms/corp/protocol/openid-connect/token`,
`PORTAL_OIDC_JWK_SET_URI=http://keycloak:8080/realms/corp/protocol/openid-connect/certs`,
`PORTAL_OIDC_END_SESSION_URI=http://keycloak:8080/realms/corp/protocol/openid-connect/logout`; po tym `idp-relay`
i `JAVA_TOOL_OPTIONS` z truststore'em dev public CA w BFF są zbędne. Bez `PORTAL_OIDC_END_SESSION_URI` wylogowanie kończy
tylko sesję BFF (sesja SSO w IdP zostaje), co BFF zgłasza ostrzeżeniem przy starcie. Pusta wartość `PORTAL_OIDC_TOKEN_URI`
oznacza discovery.

## M4: wnioski, administracja rejestru, limity

Kontrakty 4.0.0 (stan M4; M5 opisuje sekcja niżej). Szczegóły decyzji w `STATUS.md` (M4.1 ... M4.4).

- Wnioski o dostęp (port C13): `GET/POST /api/v1/access-requests`, `GET /api/v1/access-requests/entitlements?system=`. Adaptery:
  `keycloak-groups` (katalog z pliku, bez wniosków: `POST` daje `422 not_requestable`) i `mock` (profil `dev`). `POST` na uprawnienie,
  na które wniosek już czeka, zwraca `200` z jego `requestId`; uprawnienie spoza katalogu albo już posiadane to `422 not_requestable`.
  Opis uprawnienia z IGA to tekst nieufny (znaki ukryte zapisane jako `<U+XXXX>`, do 500 znaków), `requestUrl` z IGA tylko `https`.
- Tabela akcji katalogu wg CC-113: `request_access` tylko przy znanym `requiredEntitlements`; `view_request` także przy `connected`.
- Administracja rejestru (grupa `mcp-platform-admin`, sprawdzana w BFF i w gateway): `GET /api/v1/admin/registry`,
  `.../servers/{serverId}/tools/{tool}/pending` (diff: `approvedEntry`, `pendingEntry`, wersje, `source`),
  `POST .../approve` (`409 hash_mismatch`, `422 ManifestRejected` z `reason`). Teksty definicji z hasłami ukrytych znaków zapisanymi
  jawnie; hashe bez zmian. Źródłem prawdy dla udanego zatwierdzenia jest zdarzenie gateway'a (`admin_change` / `definition_approved`, `sub` administratora,
  `definitionHash`); portal zapisuje własne `admin_change` tylko dla prób bez skutku (bez `reason`, z `outcome` i `errorCode`). `approve` wymaga `Sec-Fetch-Site: same-origin`.
- Limity na sesję: zapis tokenu i zapisy Authenticatora (zmienne `PORTAL_LIMIT_*`), odpowiedź `429 rate_limited` z `Retry-After`; `429` z
  brokera jest przekazywane dalej tylko tam, gdzie C12 opisuje `429` (zapis tokenu, Authenticator; bez `Retry-After` od brokera: 60 s), gdzie indziej to `503`.
- "Ostatnie użycie" konta serwisowego (CC-150) liczy web z wierszy `GET /api/v1/activity/calls` (wyniki `ok`, `confirmed`, `error`);
  BFF nie ma na to osobnego pola.

| Test | Co sprawdza |
| --- | --- |
| `AccessRequestsTest`, `AccessRequestsAdapterTest` | lista, idempotentny `POST`, `422`, `503`, ścisłe ciało, CSRF, przykłady C12, adapter skryptowany (przekierowanie, wynik spoza kontraktu, wiersze spoza kontraktu, tekst z IGA) |
| `IgaDataTest`, `KeycloakGroupsAccessGovernanceTest`, `IgaConfigTest` | adresy `requestUrl`, wynik adaptera, katalog bez wniosków, wybór adaptera |
| `RegistryAdminTest` | tylko admin, widoki sprawdzane względem schematu, neutralizacja definicji, przykłady C12, zatwierdzenie z audytem, `409`, `422`, mapowanie statusów |
| `RateLimitsTest` | limity na sesję (okno, `Retry-After`, liczenie tylko żądań do brokera), `429` z brokera i gateway'a |

## M6: wyłącznik awaryjny i klasyfikacja narzędzi adaptera (kontrakty 6.3.2)

- Wyłącznik awaryjny (A9, CC-194), grupa `mcp-platform-admin`: `GET /api/v1/admin/kill-switches` (lista sprawdzana względem schematu, powód
  jako tekst nieufny ze znakami ukrytymi zapisanymi jawnie), `PUT` i `DELETE` pod `.../registry/servers/{serverId}/kill-switch` i
  `.../tools/{tool}/kill-switch`. Włączenie (`PUT`, ciało `{"reason"}` 1..200 znaków bez znaków ukrytych) nie wymaga świeżego MFA; zdjęcie
  (`DELETE`) wymaga go i bez niego daje `401 step_up_required` z `stepUpUrl` wracającym na stronę, z której poszło żądanie (U12). Zapis
  w gatewayu (`kill_switch_set`, `kill_switch_cleared`) jest źródłem prawdy; portal zapisuje `admin_change` tylko dla prób bez skutku
  (odmowa, brak MFA, awaria gatewaya) i nigdy nie przepisuje tekstu powodu do audytu.
- `approve` niesie `risk` i `action` dla narzędzia z adaptera (CC-193); BFF sprawdza wartości enum (`400`, opisane w kontrakcie od CC-210),
  a parę, to czy wpis jest z adaptera i że adapter przyjmuje tylko `READ_ONLY` (CC-227), zostawia gatewayowi (`422 classification_inconsistent`,
  `classification_required`, `classification_not_allowed` z `reason`).
- `PUT .../secret` przyjmuje `username` (CC-222): 1..255 znaków, bez `:` i znaków sterujących, formatujących, separatorów i wypełniaczy
  (to samo sito co `backendUser`); poza tym login przechodzi do brokera, który rozstrzyga, czy system go przyjmuje (`400`). Nie jest
  logowany, audytowany ani zwracany; `toString` rekordu go ukrywa. Katalog niesie `userSecretScheme` i `deployment` z `GET /v1/systems`
  (wartości spoza enum są pomijane).
  Obniżenie wcześniejszej klasyfikacji to `acceptRiskLowering` ze świeżym MFA, jak każde obniżenie.
- Widoki rejestru przyjmują wpis oczekujący z `source: adapter` bez `risk` i `action` (z pustym `resourceRefs`), `classifiedBy` i
  `classifiedAt`; wpis spoza adaptera dalej musi mieć obie wartości. Katalog przekazuje `disabledBy` tylko przy `disabled: true`.
- Wektory `http-broken-escape`, `http-lone-percent`, `http-half-escape` (CC-202) przechodzą przez HTTP jako surowe żądanie, bo
  `java.net.URI` nie zbuduje adresu z `%zz`; `TestBrowser.getRawTarget` wysyła je gniazdem.

| Test | Co sprawdza |
| --- | --- |
| `KillSwitchTest` | tylko admin, lista sprawdzana względem schematu, włączenie bez MFA, zdjęcie z MFA i `stepUpUrl` ze strony, ciało żądania, mapowanie odpowiedzi gatewaya, audyt prób bez skutku, brak powodu w audycie |
| `RegistryAdminTest` (dodane) | klasyfikacja przekazana gatewayowi, nieznane wartości, odmowy `422` z `reason`, obniżenie z MFA, wpis adaptera bez `risk` i `action`, `classifiedBy` |

## Struktura

```
src/main/java/pl/aiwcorpo/mcp/portal/bff/
  security/    logowanie OIDC, step-up, CSRF, sesja, wylogowanie
  token/       wymiana tokenu (RFC 8693) na aud brokera i gateway admin, cache w sesji
  upstream/    klienci C4/C5 (mTLS, przypięta nazwa TLS)
  catalog/     GET /api/v1/catalog (reguły CC-021)
  connection/  GET/PUT/DELETE połączeń
  mcpendpoint/ GET /api/v1/me/mcp-endpoint: adres /mcp z filtrem, clientConfigs, licznik narzędzi
  me/          GET /api/v1/me
  confirmation/ podgląd, viewed, cancel
  authenticator/ rejestracja Authenticatora (TOTP)
  activity/    GET /api/v1/activity/calls
  admin/       rejestr: widok, diff definicji, zatwierdzanie (grupa mcp-platform-admin)
  limits/      limity na sesję (429 z Retry-After)
  iga/         port C13, adaptery mock (dane: dev/iga-mock.yaml, tylko profil dev) i keycloak-groups, wnioski o dostęp
  audit/       zdarzenia C8
  spa/         serwowanie frontendu, fallback tras, CSP
  web/         błędy JSON, returnPath, requestId
```

## M5: jeden adres `/mcp` (kontrakty 5.1.0)

`GET /api/v1/me/mcp-endpoint?systems=&tools=&access=&exclude=` (CC-175, CC-182) zwraca znormalizowany adres
`<PORTAL_PUBLIC_BASE_URL>/mcp[?filtr]`, `filter` (gdy jest), `toolCount` i `clientConfigs`. Nic się nie zapisuje i nic
nie trafia do audytu. Szczegóły:

- Cztery parametry przychodzą już zdekodowane przez warstwę HTTP (`jira%2Cgitlab` to `jira,gitlab`). BFF składa z nich
  query sam (`nazwa=wartość` łączone `&`, `&` i `=` w wartości zapisane jako `%26` i `%3D`, bez ponownego kodowania)
  i parsuje je klasą `EndpointFilter` z `mcp-manifest` 5.1.0, czyli tymi samymi regułami co gateway. Parametr spoza czterech,
  powtórzony, wartość z `%` po dekodowaniu, `+` (spacja), pusta wartość i niepoprawny escape (`%zz`), bajty spoza UTF-8, parametr bez nazwy
  (`?=jira`), nazwa spoza czterech po dekodowaniu (`?systems%3Djira%26access=read`) i puste segmenty (`&&`, początkowe lub końcowe `&`;
  kontener pomijałby je po cichu, a gateway je odrzuca) to `400 invalid_request`, `reason: invalid_filter`; odmowa następuje przed
  wywołaniem gateway'a i nic nie mówi o narzędziach użytkownika.
- `toolCount`: płaska lista z `servers[].tools[]` odpowiedzi `GET /admin/v1/catalog` (C5, token wymieniony na
  `mcp-gateway-admin`), tylko `granted` i nie `disabled`, po filtrze (`EndpointFilter.allows`). To szacunek, wiążące jest
  `tools/list` gateway'a.
- `clientConfigs` z `PORTAL_PUBLIC_BASE_URL` (nigdy z żądania); adres jest w cudzysłowie, bo ma `&`; nazwa serwera w klientach to
  `aiwcorpo-mcp`. Flagi `--client-id` i `--callback-port` Claude Code jak dotąd z konfiguracji.
- Aktywność: wiersze mają `filter` zamiast `virtualServer` (CC-174); `filter` jest pokazywany tylko w postaci kanonicznej. Stary
  wynik `denied_link_scope` jest czytany jako `denied_filter_scope` (CC-188; gateway mapuje przy odczycie, BFF powtarza to dla
  starszego gateway'a), a pole `virtualServer` ze starego gateway'a jest odrzucane bez gubienia wiersza.
- `ReturnPath` nie dopuszcza `/mcp` ani `/mcp?...` (CC-169); `/mcp-docs` i `/f/...` są dozwolone. Fallback SPA nie odpowiada na `/mcp`.
- U12 (wznowienie po step-up bez drugiego kliknięcia): `401 step_up_required` niesie `stepUpUrl` z `returnPath` równym stronie, z której
  poszło żądanie (nagłówek `Referer` tego samego originu co `PORTAL_PUBLIC_BASE_URL`, ścieżka i query bez fragmentu, tylko
  gdy spełnia `ReturnPath`; inaczej stały `/authenticator` albo `/admin`). Kontrakt się nie zmienia (`stepUpUrl.returnPath` jest
  domyślny, frontend może go podmienić). Wznowienie samej akcji po powrocie jest po stronie web: strona rozpoznaje powrót
  (`Me.mfaFreshUntil`, query w `returnPath`) i wysyła zapisane żądanie jeszcze raz. BFF niczego nie odtwarza sam, bo nie wolno mu
  trzymać ciała żądania (sekret, kod TOTP).

## CI

`make ci` (czyli `ci/run.sh`) to jedyny punkt wejścia: sprawdza JDK 25, style (znaki, frazy), `./mvnw verify` i wypisuje
liczbę testów. Działa lokalnie bez żadnego systemu CI. W kontenerze: `ci/run.sh --container` buduje obraz z `ci/Dockerfile` i
uruchamia w nim ten sam skrypt (repozytorium i `~/.m2` jako wolumeny). Pliki `.gitlab-ci.yml`, `Jenkinsfile`
i `.github/workflows/ci.yml` w korzeniu `mcp-portal` to cienkie nakładki wołające `bff/ci/run.sh` i `web/ci/run.sh`.
Sekrety rejestru artefaktów (`MCP_MAVEN_REPOSITORY_URL`, `_USER`, `_PASSWORD`, token tylko do odczytu; ustawienia w `.ci/settings.xml`)
trafiają wyłącznie do zadań na gałęzi głównej, nigdy do pipeline'ów merge requestów i pull requestów, które dostają krok `style`.
Socket Dockera (zadanie `web`) tylko na gałęzi głównej i dedykowanym agencie.
Izolacja nie wynika z samych plików nakładek (gałąź może je zmienić), tylko z ustawień systemu CI: GitHub: bez sekretów rejestru; zadania na `main` czytają pakiety
`mcp-contracts` tokenem `GITHUB_TOKEN` z `permissions: packages: read`, a każdy pakiet musi dać temu repozytorium dostęp do odczytu
(ustawienia pakietu, "Manage Actions access"); pull requesty dostają tylko `style`. GitLab: zmienne masked, protected, tylko do odczytu. Jenkins: etykieta
`ci-style` to pula bez gniazda Dockera dla kroku `style`; poświadczenia `mcp-maven-registry` i `mcp-maven-registry-url` dostępne tylko dla
zadań gałęzi `main`; węzeł `docker` przyjmuje wyłącznie zadania `main`; dla pull requestów Jenkinsfile pochodzi z zaufanej gałęzi
(wtyczka z zaufanym źródłem Jenkinsfile), nie z gałęzi PR. `ci/run.sh` kończy się błędem przy nieznanym albo
pustym `CI_STEPS`, przy padniętym `mvnw` i przy zerze testów.

Stan prac i podział na kamienie: [STATUS.md](STATUS.md).
