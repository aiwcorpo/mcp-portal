# Status ws-07 (mcp-portal/bff)

Brief ws-07 nie ma kamieni milowych. Podział ustalony z koordynatorem 2026-10-27:

| Kamień | Zakres | Stan |
| --- | --- | --- |
| M1 | logowanie OIDC, sesja `__Host-session`, CSRF, `GET /api/v1/me`, token exchange, `GET /api/v1/catalog`, `GET /api/v1/connections`, `PUT .../secret` ze step-up, `DELETE` połączenia, serwowanie SPA, CSP, HSTS, audyt C8 | zrobione |
| M2.1 | przejście na mcp-contracts 2.2.1; callback OIDC pod `/api/v1/auth/callback`, `__Host-XSRF-TOKEN`, `publicBaseUrl`; katalog wg CC-080..083 (tabela akcji, wektory `catalog-actions/`); `PUT secret` bez step-up (CC-090); `Error.requestId` (CC-087) | zrobione |
| M2.2 | połączenia OAuth: `POST .../oauth`, `GET /api/v1/oauth/callback` z `ConnectErrorCode`, `cancelled`, brak sesji -> `/?loginError=session_expired` (CC-086), cudzy link | zrobione |
| M2.3 | wirtualne serwery: lista, utworzenie, usunięcie, `409 slug_taken`, kolejność kontroli `resourceDefaults` (CC-085), `clientConfigs` | w toku |
| M2.4 | mocki WireMock C4/C5 jako proces hosta (adresy w konfiguracji), testy negatywne (sekret w logach, returnPath, cudza sesja, brak XSRF), README, raport | w toku |
| M3 (poza M2) | potwierdzenia (pivot TOTP, mcp-contracts 3.0.0), wnioski IGA (`/access-requests`), aktywność, admin; `ReturnPath` bez zarezerwowanych prefiksów (CC-099) | nie zaczęte |

## M1: wynik

Po poprawkach z przeglądu i testu integracyjnego koordynatora (niżej): `./mvnw test` 67 testów, 0 błędów (w tym `FrontendBuildTest` na prawdziwym
`../web/dist/portal` z ws-08); `./mvnw test -Pdev-env` (Keycloak i stuby z `mcp-platform-dev` 8d459c1,
`make up`): 6 testów, 0 błędów. Ręcznie: `./scripts/run-dev.sh` serwuje build `../web/dist/portal`
z ws-08, nonce CSP podstawiony w `index.html` (5 wystąpień = nonce z nagłówka).

DoD briefu:

| Punkt | Dowód |
| --- | --- |
| OpenAPI C12 przechodzi testy kontraktowe | `PortalApiTest`, `DevEnvironmentFlowTest`: każda odpowiedź API walidowana schematem operacji z `portal-bff.v1.bundled.yaml` (jar `mcp-contracts:1.1.0`), status spoza kontraktu przerywa test; `CatalogAssemblerTest` odtwarza przykład `mixed`; żądanie do brokera walidowane `PutSecretRequest` z C4 |
| żadna odpowiedź nie zawiera tokenu ani sekretu | `PortalApiTest.nothingLeaked`: wszystkie odpowiedzi (nagłówki + treść) i wszystkie linie logów kontra każdy token wydany przez IdP (access, refresh, ID, wymienione) i każdy wysłany sekret; `DevEnvironmentFlowTest`: brak `eyJ` i PAT w odpowiedziach |
| zapis sekretu bez świeżego MFA -> `step_up_required` | `secretWithoutFreshMfaNeedsStepUpThenSucceeds` (fałszywy IdP) i `aliceUsesThePortal...` (Keycloak, `max_age=0` wymusza formularz) |
| CSRF dla metod modyfikujących, ciasteczko `__Host-` | `modifyingCallsRequireTheCsrfHeader`, `loginCreatesHostPrefixedSessionAndCsrfCookie` |
| dowolna trasa SPA -> `index.html`, `/api/**` nigdy HTML | `spaRoutesServeIndexWithNonceAndSecurityHeaders`, `apiPathsNeverAnswerWithHtml` |

## Decyzje i odstępstwa

- Klienci C4/C5 napisani ręcznie (rekordy z polami kontraktu, nieznane pola ignorowane), bez
  openapi-generatora: generator `java`/`native` daje modele na Jacksonie 2, a Boot 4 używa Jacksona 3.
  Zgodność pilnują testy na stubach z kontraktu i walidacja żądania schematem C4.
- Callback logowania OIDC to `/login/oauth2/code/keycloak` (już zarejestrowany w realmie); nieudane logowanie
  kończy się 302 na `/?loginError=<kod>` z zamkniętej listy `cancelled`, `idp_error`, `session_expired`,
  `step_up_failed` (decyzja człowieka 2026-10-27, wejdzie do mcp-contracts 2.0.0; CC-051).
- `stepUpUrl` dla `PUT .../secret`: `returnPath` z nagłówka `Referer`, tylko gdy ten sam origin i poprawny
  `ReturnPath`, inaczej `/`. Zgodne z wariantem ws-08 (frontend i tak podmienia `returnPath`, CC zgłoszone
  przez ws-08).
- Step-up: świeże = `auth_time` nie starszy niż `PORTAL_STEP_UP_MAX_AGE` (5 min) i, jeśli skonfigurowano,
  `acr` z listy `PORTAL_STEP_UP_ACR_VALUES`. Realm `corp` nie ma jeszcze poziomów `acr` (STATUS ws-01), więc w
  dev lista jest pusta i liczy się samo ponowne logowanie hasłem. Żądanie step-up wysyła `max_age=0` i
  `acr_values` (gdy skonfigurowane).
- Wylogowanie: 204 i wylogowanie z IdP kanałem zwrotnym (POST na `end_session_endpoint` z refresh tokenem
  sesji, Keycloak to przyjmuje od klienta poufnego), bez przekierowania przeglądarki.
- Błąd C4/C5/IdP: `503 {error: "upstream_unavailable"}`; katalog nie jest zwracany częściowo. C12 nie ma 503:
  propozycja CC.
- Port C13 (decyzja człowieka 2026-10-27): `Requester(sub, username, email, claims)` z logowania; adapter wybiera
  identyfikator claimem `portal.iga.requester-id-claim` (domyślnie `preferred_username`), brak claimu = błąd
  adaptera (503). Adapter `mock` tylko w profilu `dev`, dane w `dev/iga-mock.yaml` poza jarem; poza `dev` brak
  adaptera = błąd startu.
- `X-Request-Id`: BFF generuje UUIDv7 na każde żądanie (identyfikator od przeglądarki ignoruje), odsyła go
  w odpowiedzi i przekazuje do C4/C5; ten sam `requestId` jest w audycie. Zgodne z CC-047 (ws-06).
- Akcje katalogu: `copy_link` gdy `connected`/`expiring`; `connect_oauth`/`add_secret` gdy `not_connected` i
  broker wspiera typ; `reconnect` gdy `reconnect_required`/`expiring`; `request_access` gdy odmówione narzędzie
  ma uprawnienie bez wniosku w toku; `view_request` gdy wniosek w toku; `disconnect` gdy broker ma połączenie.
  System nieznany brokerowi: `not_connected` bez akcji połączenia (fail-closed).
- `Me.groups`: tylko grupy z prefiksem `mcp-` (schemat `GroupName`).
- Wymagania ws-08 (koordynator, 2026-10-27) spełnione: pliki `web/dist/portal` pod `/` z fallbackiem SPA,
  `__CSP_NONCE__` -> nonce 128 bitów, CSP dokładnie jak w `web/README.md` (`script-src 'self'` bez nonce,
  `img-src 'self'`), `index.html` z `no-store`; `XSRF-TOKEN` (Path=/) najpóźniej przy `GET /api/v1/me`;
  `/api/**` bez sesji -> 401 JSON bez przekierowania; `returnPath` dekodowany raz (kontener) i walidowany
  wzorcem z kontraktu; `stepUpUrl` wskazuje ten sam origin i `/api/v1/auth/login`. Dev: opcjonalne
  `PORTAL_WEB_LOGIN_RETURN_ORIGIN` (np. `http://localhost:4200`), jedna wartość z konfiguracji, walidowana
  przy starcie jako `scheme://host[:port]`.
- `portal.web.dist-path` jest wiązany jako napis: konwersja Springa String -> Path przez `Resource` odrzuca
  ścieżki z `../` (wyszło w teście z prawdziwym buildem).
- Profil Spring `dev` (ustawia `run-dev.sh`) jest warunkiem ustawień tylko dla mcp-platform-dev: adapter IGA
  `mock`, step-up bez `acr`, `PORTAL_WEB_LOGIN_RETURN_ORIGIN`, http do stubów w testach.
- Sesje w pamięci procesu (jedna instancja). Środowisko nie ma użytkownika Redis dla BFF; patrz niżej.

## Przegląd M1 (2026-10-27): znaleziska i poprawki

| Znalezisko | Co zrobione |
| --- | --- |
| M1 step-up mógł zmienić `sub` sesji | `GET /api/v1/auth/login?stepUp=true` zapamiętuje `sub` sesji; inny `sub` w callbacku: sesja unieważniona, 302 `/?loginError=step_up_failed`. Po każdym logowaniu w sesji zostaje tylko kontekst bezpieczeństwa i tokeny. Testy: `stepUpAsAnotherUserEndsTheSession`, `ordinaryLoginAsAnotherUserKeepsNothingOfTheEarlierOne`, dev: `stepUpWithAnotherKeycloakAccountIsRejected` |
| M2 dopuszczony http do C4/C5, brak keystore/truststore po cichu | błąd startu; wyjątek tylko `portal.tls.insecure-plain-http-for-tests=true` razem z profilem `dev`; truststore wyłącznie CA wewnętrzne (bez cacerts). `UpstreamGuardsTest` |
| M3 step-up bez `acr` | puste `portal.step-up.acr-values` dozwolone tylko w profilu `dev`, inaczej błąd startu. `StepUpPolicyTest` |
| M4 `RestClient.create()` do IdP bez timeoutów | wspólny klient IdP (`IdpClientConfig`): connect 5 s, odczyt 10 s, bez przekierowań, HTTP/1.1; używany przez wymianę tokenu i wylogowanie |
| M5 mock IGA w jarze i domyślnie włączony | dane przeniesione do `dev/iga-mock.yaml`, adapter `mock` tylko w profilu `dev` (`application-dev.yml`), brak adaptera = błąd startu. `IgaConfigTest` |
| L DELETE z nieznanym systemem -> 400 spoza C12 | bez zmian do przejścia na 2.0.0; propozycja CC (400 dla DELETE) |
| L 503 bez `assertResponse` | bez zmian do przejścia na 2.0.0 (CC-050) |
| L `XSRF-TOKEN` kasowany w callbacku | nowy token zapisywany w odpowiedzi kończącej logowanie; test sprawdza ciasteczko na callbacku |
| L `returnPath` z `Referer` na `/api/...` | `/api` (bez względu na wielkość liter) daje `/`; test z obcym originem i `/api` |
| L `PORTAL_WEB_LOGIN_RETURN_ORIGIN` poza dev | błąd startu poza profilem `dev`. `LoginRedirectsTest` |
| L `Me.groups` tylko po prefiksie | wzorzec i długość `GroupName` z kontraktu |
| L dane C4/C5 bez walidacji (`tools == null`, nieznany status) | `BrokerData`: nieznane systemy, typy, ryzyka, akcje odrzucane; nieznany status połączenia -> `error`; `null` -> puste listy. `UpstreamGuardsTest` |
| L `_csrf` w parametrze, `XSRF-TOKEN` bez `__Host-` | token tylko z nagłówka (`HeaderOnlyCsrfTokenRequestHandler`), test `csrfTokenIsAcceptedOnlyFromTheHeader`; nazwa ciasteczka wg C12, propozycja CC `__Host-XSRF-TOKEN` |
| L `/oauth2/authorization/keycloak` drugim wejściem | resolver filtra nic nie rozwiązuje, ścieżka daje 404 JSON; test |
| L `forward-headers-strategy` ufa sieciom prywatnym | `server.tomcat.remoteip.internal-proxies` = `PORTAL_TRUSTED_PROXIES`, domyślnie tylko loopback |
| L `/actuator` i `/API/v1/me` dostawały `index.html` | wykluczenia bez względu na wielkość liter i bez końcowego `/`; wyłączone odkrywanie `/actuator`; test |
| L audyt: brak zdarzeń przy błędzie wymiany tokenu i walidacji 400, `allow` przy odrzuceniu, `ts` z `Instant.now()` | zdarzenia dla nieznanego systemu, złego body (body czytane w kontrolerze), błędu tokenu; odrzucenie = `deny`; `ts` z `Clock`. Test `rejectedInputIsAudited` |
| L martwy kod, pełne nazwy klas, etykiety w testach | usunięte |
| L odpowiedzi/żądania C4/C5 niewalidowane | `PortalApiTest` na końcu sprawdza każde żądanie BFF do stubów: operacja istnieje w C4/C5, body zgodne ze schematem, bearer z właściwym `aud`, `X-Request-Id` UUIDv7 |
| L brak testów rotacji sesji, login CSRF, obcy `Referer`, `Thread.sleep` w dev, cichy skip builda | testy `loginRotatesTheSessionId`, `loginFailuresUseTheClosedListOfCodes` (cudzy callback -> `session_expired`, anulowanie -> `cancelled`), `stepUpReturnPathIgnoresForeignAndApiReferers`; dev test na przesuwanym zegarze zamiast `sleep`; `-Dportal.test.require-web-dist=true` |
| L limit bezczynności 30 min bez testu | bez zmian (ustawienie kontenera, zegar Tomcata nie da się przesunąć w teście) |

## Test integracyjny koordynatora (2026-10-27): BFF nie wstawał przez `run-dev.sh`

| Błąd | Przyczyna | Poprawka |
| --- | --- | --- |
| `FileNotFoundException: ServletContext resource [.../dev/iga-mock.yaml]` | zmienna `PORTAL_IGA_MOCK_FILE` wiązała się przez relaxed binding wprost z `portal.iga.mock-file` (typ `Resource`) i nadpisywała wartość z `file:` w `application-dev.yml` | `portal.iga.mock-file` to zwykła ścieżka (`FileSystemResource`), brak pliku = czytelny błąd startu; test `RunDevConfigurationTest` startuje z wartościami skryptu podanymi jako zmienne środowiska i sprawdza dane mocka w katalogu |
| `class file version 69.0` przy Javie 21 w `PATH` | skrypt nie sprawdzał Javy | `run-dev.sh` sprawdza `java.specification.version` >= 25 i podaje `JAVA_HOME`; wymaganie także w README przy komendzie |

Sprawdzone ręcznie: `./scripts/run-dev.sh` z Javą 17 w `PATH` kończy się komunikatem (kod 1); z JDK 25 wstaje, `curl
http://localhost:18090/api/v1/me` daje `401 {"error":"unauthenticated"}`, proces zatrzymany.

## Potrzeby wobec innych strumieni

- ws-01: (1) poziomy `acr` w realmie (hasło / hasło+OTP), wtedy BFF dostaje `PORTAL_STEP_UP_ACR_VALUES`;
  (2) przy wielu instancjach BFF: użytkownik Redis `portal-bff`, klucze `portal:session:*` (Spring Session),
  komendy `@read @write @keyspace @hash @string @scripting` bez `@dangerous`, bez pub/sub; (3) w profilu
  `full` usługa BFF z obrazem i zmiennymi `PORTAL_*` z README (port 18090, montowane `certs/mcp-portal-bff`
  i `certs/ca`).
- ws-08: nic nowego poza tym, co już jest w `web/README.md`; po 401 `unauthenticated` przejście na
  `/api/v1/auth/login?returnPath=...`; `?loginError=<kod>` na `/` po nieudanym logowaniu (cztery kody wyżej); 503
  `upstream_unavailable` z katalogu i połączeń.

## Niesprawdzone

- Prawdziwy broker (ws-06) i gateway (ws-05): tylko stuby kontraktowe (stub `PUT secret` zawsze 200).
- Działanie za proxy TLS (`server.forward-headers-strategy=native`): redirect URI i `Secure` zależą od
  nagłówków `X-Forwarded-*`.
- Limit bezczynności 30 min (ustawienie kontenera) nie ma testu; limit 8 h ma.
- Wywołania IdP wykonywane przez samo Spring Security (wymiana kodu przy logowaniu, refresh) mają domyślne
  timeouty klienta HTTP; własne wywołania BFF (wymiana tokenu, wylogowanie) mają 5 s / 10 s.
- Keycloak przy step-upie w tej samej przeglądarce (ciasteczko SSO alice) nie przyjmuje innego konta; test
  `stepUpWithAnotherKeycloakAccountIsRejected` używa osobnej przeglądarki, żeby dojść do sprawdzenia w BFF.

## Otwarte pytania

- Czy po step-up frontend ma wracać do formularza z zachowaniem stanu (CC ws-08), czy wystarczy `Referer`.
- Docelowe wartości `acr` dla MFA (to samo pytanie co w ws-01 dla claimu `mfa` w C2).
