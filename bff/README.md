# mcp-portal-bff

Backend portalu MCP (strumień ws-07): logowanie OIDC i sesja po stronie serwera, API C12 dla frontendu,
agregacja C5 (gateway admin), C4 (credential broker) i C13 (IGA). Przeglądarka nigdy nie dostaje tokenów
ani sekretów. BFF serwuje też zbudowany frontend Angular (`../web`) z tego samego originu.

Stos: Java 25, Spring Boot 4.1.0 (Spring Security 7.1), Maven wrapper. Kontrakty: `mcp-contracts` 3.0.2 (jar w `~/.m2`, z repozytorium `mcp-contracts`).

## Uruchomienie lokalne

Wymagane: JDK 25 i `mcp-contracts` 3.0.2 w `~/.m2`. Dwa tryby.

Z mockami (bez `mcp-platform-dev`; dane C4/C5 z mocków WireMock z jara kontraktów):

```bash
export JAVA_HOME=/opt/homebrew/Cellar/openjdk@25/25.0.4.1/libexec/openjdk.jdk/Contents/Home   # wymagana Java 25
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

Skrypt sprawdza wersję Javy (z `JAVA_HOME` albo `PATH`) i kończy się czytelnym komunikatem, gdy nie jest to 25, oraz
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
| `PORTAL_PUBLIC_BASE_URL` | origin jednej domeny (portal, `/api`, `/s/`, `/v/`): z niego redirect URI OIDC `<url>/api/v1/auth/callback`, linki `copy_link` i `clientConfigs`; nigdy z `Host`; poza `dev` tylko https, bez literału IPv6 (dawna nazwa: `PORTAL_GATEWAY_PUBLIC_URL`) | `http://localhost:18720` |
| `PORTAL_TLS_KEYSTORE`, `PORTAL_TLS_KEYSTORE_PASSWORD` | certyfikat klienta `CN=mcp-portal-bff` (PKCS12) | `certs/mcp-portal-bff/keystore.p12` |
| `PORTAL_TLS_TRUSTSTORE`, `PORTAL_TLS_TRUSTSTORE_PASSWORD` | CA wewnętrzne | `certs/ca/truststore.p12` |
| `PORTAL_WEB_DIST` | katalog z `index.html` zbudowanego frontendu | `../web/dist/portal` |
| `PORTAL_WEB_LOGIN_RETURN_ORIGIN` | tylko dev: origin frontendu z `ng serve`, na który BFF wraca po logowaniu (`scheme://host:port`, z konfiguracji, nigdy z żądania) | puste; z `npm start` w `web/`: `http://localhost:4200` |
| `SPRING_PROFILES_ACTIVE` | `dev` tylko dla mcp-platform-dev; bez niego BFF nie wstanie z adapterem IGA `mock`, step-up bez `acr`, `PORTAL_WEB_LOGIN_RETURN_ORIGIN` ani `portal.tls.insecure-plain-http-for-tests` | `dev` (ustawia `run-dev.sh`) |
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
`cancelled`, `provider_error`, `flow_invalid` (`identity_mismatch` usunięte w kontraktach 3.0.0). Wirtualne serwery: proxy do C5 z kontrolą
`resourceDefaults` (CC-085) i `clientConfigs` z `PORTAL_PUBLIC_BASE_URL`.

`clientConfigs.claudeCode` to `claude mcp add --transport http [--client-id <id>] [--callback-port <port>] <slug> <url>`.
Keycloak w mcp-platform-dev nie pozwala na dynamiczną rejestrację klienta, więc bez obu flag Authenticate w Claude Code
nie działa; profil `dev` ustawia `claude-code` i `33418` (klient `claude-code` w realmie musi mieć redirect URI
`http://localhost:33418/callback`). Produkcja z Entra ID może potrzebować innego klienta albo żadnego, dlatego domyślnie
flag nie ma. Copilot i Codex dostają tylko link: nie ma potwierdzonego pola na identyfikator klienta w ich konfiguracji
(patrz STATUS.md). Przy `409 virtual_server_limit_reached` z C5 BFF odpowiada własnym `409` z tym samym kodem (CC-119),
a zdarzenie `connection_change` niesie `backendUser` połączonego konta (CC-117; brak, gdy broker go nie zwrócił).

| Test | Co sprawdza |
| --- | --- |
| `OAuthConnectTest`, `ConnectRedirectVectorsTest` | start i callback, wszystkie kody, cudzy link, powtórzenie, brak sesji, wektory `connect-redirects/` |
| `VirtualServersTest` | lista, utworzenie, usunięcie, 409/403/503, kolejność kontroli `resourceDefaults`, `clientConfigs` |
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
  `virtual_server_change` zamiast `admin_change` (`vs_created`, `vs_deleted`, `slug_taken`, `not_granted`, `invalid_request`,
  `virtual_server_limit`, `not_found_or_denied`). Zdarzenia `confirmation` (w tym `cancelled_by_owner`) pisze gateway.
- Podgląd: odpowiedź gateway'a jest czytana jako obiekt zamknięty (pole spoza schematu: 503), najwyżej 64 argumenty, wartość po
  neutralizacji najwyżej 8192 znaki (dłuższa cięta, `truncated: true`).
- Tekst w podglądzie: wartości argumentów ze znakami ukrytymi (`TextHygiene`: bidi, zero-width, tag, wypełniacze, sterujące poza
  `\n` i `\t`, separatory, samotne surogaty, prywatne i nieprzypisane) trafiają do przeglądarki jako `<U+202E>` (literalne `<U+` w wartości dostaje `<U+003C>`, więc zapis zawsze znaczy znak, który tam był); nazwa
  argumentu, `resource.id`, `resource.parent` i `client` z takimi znakami powodują odrzucenie (podglądu albo wiersza). Definicja
  wg CC-121, ostrzejsza o U+200C..U+200F i CR.
- `ReturnPath` (CC-099): bez średnika; pierwszy segment nie jest `api`, `s`, `v` ani `.well-known`; żaden segment ścieżki
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

## Struktura

```
src/main/java/pl/aiwcorpo/mcp/portal/bff/
  security/    logowanie OIDC, step-up, CSRF, sesja, wylogowanie
  token/       wymiana tokenu (RFC 8693) na aud brokera i gateway admin, cache w sesji
  upstream/    klienci C4/C5 (mTLS, przypięta nazwa TLS)
  catalog/     GET /api/v1/catalog (reguły CC-021)
  connection/  GET/PUT/DELETE połączeń
  virtualserver/ wirtualne serwery i clientConfigs
  me/          GET /api/v1/me
  confirmation/ podgląd, viewed, cancel
  authenticator/ rejestracja Authenticatora (TOTP)
  activity/    GET /api/v1/activity/calls
  admin/       rejestr: widok, diff definicji, zatwierdzanie (grupa mcp-platform-admin)
  iga/         port C13, adaptery mock (dane: dev/iga-mock.yaml, tylko profil dev) i keycloak-groups, wnioski o dostęp
  audit/       zdarzenia C8
  spa/         serwowanie frontendu, fallback tras, CSP
  web/         błędy JSON, returnPath, requestId
```

Stan prac i podział na kamienie: [STATUS.md](STATUS.md).
