# mcp-portal-bff

Backend portalu MCP (strumień ws-07): logowanie OIDC i sesja po stronie serwera, API C12 dla frontendu,
agregacja C5 (gateway admin), C4 (credential broker) i C13 (IGA). Przeglądarka nigdy nie dostaje tokenów
ani sekretów. BFF serwuje też zbudowany frontend Angular (`../web`) z tego samego originu.

Stos: Java 25, Spring Boot 4.1.0 (Spring Security 7.1), Maven wrapper. Kontrakty: `mcp-contracts` 1.1.0.

## Uruchomienie lokalne (z mcp-platform-dev)

Wymagane: uruchomione środowisko `../../mcp-platform-dev` (`make up`: Keycloak na :18080, stuby C4 :18443 i
C5 :18444 z mTLS) oraz JDK 25.

```bash
export JAVA_HOME=/opt/homebrew/Cellar/openjdk@25/25.0.4.1/libexec/openjdk.jdk/Contents/Home   # wymagana Java 25
./scripts/run-dev.sh            # BFF na http://localhost:18090
```

Skrypt sprawdza wersję Javy (z `JAVA_HOME` albo `PATH`) i kończy się czytelnym komunikatem, gdy nie jest to 25.
Skrypt włącza profil Spring `dev` i przy każdym starcie czyta z `mcp-platform-dev/.env` i `.secrets/dev.env` sekret klienta
`mcp-portal-bff`, hasło keystore'ów i porty; nic nie jest kopiowane do tego repozytorium. Inny katalog
środowiska: `MCP_PLATFORM_DEV_DIR=...`. Prawdziwy broker zamiast stuba:
`PORTAL_BROKER_URL=https://localhost:18100 ./scripts/run-dev.sh`.

Frontend: `cd ../web && npx ng build`, wynik w `../web/dist/portal` (domyślne `PORTAL_WEB_DIST`). Bez
builda API działa, a trasy SPA odpowiadają 404.

Szybkie sprawdzenie:

```bash
curl -i http://localhost:18090/api/v1/me                         # 401 {"error":"unauthenticated"}
open 'http://localhost:18090/api/v1/auth/login?returnPath=/'     # logowanie alice (hasło: make users)
```

## Testy

```bash
./mvnw test             # jednostkowe + API (profil dev) przez HTTP (fałszywy IdP, stuby WireMock C4/C5 z mcp-contracts)
./mvnw test -Pdev-env   # z prawdziwym Keycloakiem i stubami mTLS z mcp-platform-dev (make up, port 18090 wolny)
```

| Test | Co sprawdza |
| --- | --- |
| `PortalApiTest` | każda odpowiedź API walidowana schematem C12 (`portal-bff.v1.bundled.yaml` z jara kontraktów, status spoza kontraktu = błąd); logowanie z PKCE i nonce; ciasteczka `__Host-session` i `XSRF-TOKEN`; CSRF dla PUT/DELETE/POST; step-up (`step_up_required` + `stepUpUrl`, `max_age=0`, powrót); wymiana tokenów na `aud` brokera i gateway admin; audyt C8 walidowany `audit-event.schema.json`; SPA z fallbackiem, CSP z nonce, HSTS; `/api/**` nigdy HTML; na końcu: żadna odpowiedź ani linia logu nie zawiera tokenu IdP ani sekretu |
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
| `PORTAL_PORT` | port HTTP | `18090` (redirect URI w realmie) |
| `PORTAL_OIDC_ISSUER_URI` | issuer OIDC (discovery) | `http://localhost:18080/realms/corp` |
| `PORTAL_OIDC_CLIENT_ID`, `PORTAL_OIDC_CLIENT_SECRET` | klient poufny | `mcp-portal-bff`, `KC_CLIENT_MCP_PORTAL_BFF_SECRET` |
| `PORTAL_BROKER_URL`, `PORTAL_BROKER_TLS_NAME` | C4 i nazwa w certyfikacie brokera | `https://localhost:18443`, `MCP_BROKER_TLS_NAME` |
| `PORTAL_GATEWAY_ADMIN_URL`, `PORTAL_GATEWAY_ADMIN_TLS_NAME` | C5 i nazwa w certyfikacie | `https://localhost:18444`, `MCP_GATEWAY_INTERNAL_TLS_NAME` |
| `PORTAL_GATEWAY_PUBLIC_URL` | adres gateway'a dla klientów MCP (link `copy_link`) | `http://localhost:18000` |
| `PORTAL_TLS_KEYSTORE`, `PORTAL_TLS_KEYSTORE_PASSWORD` | certyfikat klienta `CN=mcp-portal-bff` (PKCS12) | `certs/mcp-portal-bff/keystore.p12` |
| `PORTAL_TLS_TRUSTSTORE`, `PORTAL_TLS_TRUSTSTORE_PASSWORD` | CA wewnętrzne | `certs/ca/truststore.p12` |
| `PORTAL_WEB_DIST` | katalog z `index.html` zbudowanego frontendu | `../web/dist/portal` |
| `PORTAL_WEB_LOGIN_RETURN_ORIGIN` | tylko dev: origin frontendu z `ng serve`, na który BFF wraca po logowaniu (`scheme://host:port`, z konfiguracji, nigdy z żądania) | puste; z `npm start` w `web/`: `http://localhost:4200` |
| `SPRING_PROFILES_ACTIVE` | `dev` tylko dla mcp-platform-dev; bez niego BFF nie wstanie z adapterem IGA `mock`, step-up bez `acr`, `PORTAL_WEB_LOGIN_RETURN_ORIGIN` ani `portal.tls.insecure-plain-http-for-tests` | `dev` (ustawia `run-dev.sh`) |
| `PORTAL_IGA_ADAPTER` | adapter C13; brak = błąd startu | `mock` (profil `dev`) |
| `PORTAL_IGA_MOCK_FILE` | dane adaptera `mock` (poza jarem): zwykła ścieżka w systemie plików, bez `file:` | `dev/iga-mock.yaml` |
| `PORTAL_IGA_REQUESTER_ID_CLAIM` | claim logowania identyfikujący wnioskodawcę w IGA; brak claimu u użytkownika = błąd adaptera (503) | `preferred_username` |
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
bezwzględny 8 h, sesje w pamięci procesu. CSRF: ciasteczko `XSRF-TOKEN` (Secure, SameSite=Strict, czytelne
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

## Struktura

```
src/main/java/pl/aiwcorpo/mcp/portal/bff/
  security/    logowanie OIDC, step-up, CSRF, sesja, wylogowanie
  token/       wymiana tokenu (RFC 8693) na aud brokera i gateway admin, cache w sesji
  upstream/    klienci C4/C5 (mTLS, przypięta nazwa TLS)
  catalog/     GET /api/v1/catalog (reguły CC-021)
  connection/  GET/PUT/DELETE połączeń
  me/          GET /api/v1/me
  iga/         port C13 i adapter mock (dane: dev/iga-mock.yaml, tylko profil dev)
  audit/       zdarzenia C8
  spa/         serwowanie frontendu, fallback tras, CSP
  web/         błędy JSON, returnPath, requestId
```

Stan prac i podział na kamienie: [STATUS.md](STATUS.md).
