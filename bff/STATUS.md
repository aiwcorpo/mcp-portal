# Status ws-07 (mcp-portal/bff)

Brief ws-07 nie ma kamieni milowych. Podział ustalony z koordynatorem 2026-10-27:

| Kamień | Zakres | Stan |
| --- | --- | --- |
| M1 | logowanie OIDC (`/api/v1/auth/login`, `logout`, callback), sesja `__Host-session`, CSRF `XSRF-TOKEN`/`X-XSRF-TOKEN`, `GET /api/v1/me`, token exchange na `aud` brokera i gateway admin, `GET /api/v1/catalog` (C5 + C4 + IGA mock, CC-021), `GET /api/v1/connections`, `PUT .../secret` ze step-up, `DELETE` połączenia, serwowanie SPA z fallbackiem, CSP bez `unsafe-inline`, HSTS, audyt C8; testy z DoD | zrobione |
| M2+ | OAuth connect (`POST .../oauth`, `GET /api/v1/oauth/callback`), wnioski (`/api/v1/access-requests`), wirtualne serwery z `clientConfigs`, aktywność, potwierdzenia (`/api/v1/confirmations/{id}` ze step-up), admin (rejestr, pending, approve) | nie zaczęte |

## M1: wynik

`./mvnw test`: 45 testów, 0 błędów (w tym `FrontendBuildTest` na prawdziwym `../web/dist/portal` z ws-08). `./mvnw test -Pdev-env` (Keycloak i stuby z `mcp-platform-dev`
8d459c1, `make up`): 5 testów, 0 błędów. Ręcznie: `./scripts/run-dev.sh` serwuje build `../web/dist/portal`
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
  kończy się 302 na `/?loginError=true`. Propozycja CC (callback i błąd logowania).
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
- Port C13: `Requester(sub, username)` zamiast samego `sub` (adapter mock dopasowuje po loginie, bo `sub`
  w dev zmienia się przy imporcie realmu). Propozycja CC.
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
- Sesje w pamięci procesu (jedna instancja). Środowisko nie ma użytkownika Redis dla BFF; patrz niżej.

## Potrzeby wobec innych strumieni

- ws-01: (1) poziomy `acr` w realmie (hasło / hasło+OTP), wtedy BFF dostaje `PORTAL_STEP_UP_ACR_VALUES`;
  (2) przy wielu instancjach BFF: użytkownik Redis `portal-bff`, klucze `portal:session:*` (Spring Session),
  komendy `@read @write @keyspace @hash @string @scripting` bez `@dangerous`, bez pub/sub; (3) w profilu
  `full` usługa BFF z obrazem i zmiennymi `PORTAL_*` z README (port 18090, montowane `certs/mcp-portal-bff`
  i `certs/ca`).
- ws-08: nic nowego poza tym, co już jest w `web/README.md`; po 401 `unauthenticated` przejście na
  `/api/v1/auth/login?returnPath=...`; `?loginError=true` na `/` po nieudanym logowaniu; 503
  `upstream_unavailable` z katalogu i połączeń.

## Niesprawdzone

- Prawdziwy broker (ws-06) i gateway (ws-05): tylko stuby kontraktowe (stub `PUT secret` zawsze 200).
- Działanie za proxy TLS (`server.forward-headers-strategy=native`): redirect URI i `Secure` zależą od
  nagłówków `X-Forwarded-*`.
- Limit bezczynności 30 min (ustawienie kontenera) nie ma testu; limit 8 h ma.

## Otwarte pytania

- Czy po step-up frontend ma wracać do formularza z zachowaniem stanu (CC ws-08), czy wystarczy `Referer`.
- Docelowe wartości `acr` dla MFA (to samo pytanie co w ws-01 dla claimu `mfa` w C2).
