# Status ws-07 (mcp-portal/bff)

Brief ws-07 nie ma kamieni milowych. Podział ustalony z koordynatorem 2026-10-27:

| Kamień | Zakres | Stan |
| --- | --- | --- |
| M1 | logowanie OIDC, sesja `__Host-session`, CSRF, `GET /api/v1/me`, token exchange, `GET /api/v1/catalog`, `GET /api/v1/connections`, `PUT .../secret` ze step-up, `DELETE` połączenia, serwowanie SPA, CSP, HSTS, audyt C8 | zrobione |
| M2.1 | przejście na mcp-contracts 2.2.1; callback OIDC pod `/api/v1/auth/callback`, `__Host-XSRF-TOKEN`, `publicBaseUrl`; katalog wg CC-080..083 (tabela akcji, wektory `catalog-actions/`); `PUT secret` bez step-up (CC-090); `Error.requestId` (CC-087) | zrobione |
| M2.2 | połączenia OAuth: `POST .../oauth`, `GET /api/v1/oauth/callback` z `ConnectErrorCode`, `cancelled`, brak sesji -> `/?loginError=session_expired` (CC-086), cudzy link | zrobione |
| M2.3 | wirtualne serwery: lista, utworzenie, usunięcie, `409 slug_taken`, kolejność kontroli `resourceDefaults` (CC-085), `clientConfigs` | zrobione |
| M2.4 | mocki WireMock C4/C5 jako proces hosta (adresy w konfiguracji), testy negatywne (sekret w logach, returnPath, cudza sesja, brak XSRF), README, raport | zrobione |
| M2.5 | runda poprawek po przeglądzie Opus M2, smoke Haiku, decyzja o braku sprawdzania tożsamości (mcp-contracts 2.2.3) | zrobione |
| M3 (poza M2) | potwierdzenia (pivot TOTP), aktywność, Authenticator, `ReturnPath` CC-099 | zrobione w M3.1-M3.4; wnioski IGA i admin zostają na M4 |
| M3.1 | kontrakty 3.0.1, `ReturnPath` CC-099, `virtual_server_change`, potwierdzenia (podgląd, viewed, cancel), `activity/calls`, Authenticator ze step-up, `Me.mfaFreshUntil` | zrobione |
| M3.2 | osobne adresy token/JWKS przy `issuer-uri` (bez `idp-relay`), higiena znaków ukrytych (CC-121) w podglądzie | zrobione |
| M3.3 | brak koercji typów w ciałach żądań (`StrictJson`), test na żywo ze stosem po zmianie compose przez ws-01 | zrobione; test na żywo przy integracji |
| M3.4 | kontrakty 3.0.2 (czysty jar), poprawki przeglądu Opus M3 (L-1..L-8) | zrobione |
| M4.1 | kontrakty 4.0.0; port C13 i adaptery `mock` oraz `keycloak-groups`; `GET/POST /access-requests`, `GET /access-requests/entitlements`, `decidedAt`; tabela akcji katalogu wg CC-113 | zrobione |
| M4.2 | administracja rejestru: `GET /admin/registry`, `.../pending`, `POST .../approve` (source, `pendingVersion`, `409 hash_mismatch`, `422 ManifestRejected`), audyt `definition_approved` | zrobione |
| M4.3 | limity `429` z `Retry-After`: zapis tokenu i operacje Authenticatora na sesję, przekazanie `429` z brokera i gateway'a, `system_not_configured` w `oauth/*` | zrobione |
| M4.4 | aktywność wg CC-142 i CC-150, zgodność z przykładami C12 4.0.0, README, obraz `m4-<sha>` | zrobione |
| M5.1 | kontrakty 5.1.0; usunięcie proxy linków; `GET /api/v1/me/mcp-endpoint` (CC-175, CC-182); aktywność z `filter` i `denied_filter_scope` (CC-174, CC-188); `/mcp` zarezerwowane w `ReturnPath` | zrobione |
| M5.2 | wznowienie po step-up (U12): powrót na stronę, z której poszło żądanie | zrobione |
| M5.3 | `ci/run.sh` + `make ci`, obraz `m5-<sha>` bez wdrażania | zrobione |
| M6.1 | kontrakty 6.2.0 (jary), wektory `http-broken-escape` i pokrewne przez surowe żądanie | zrobione |
| M6.2 | wyłącznik awaryjny (A9): `GET /admin/kill-switches`, `PUT` i `DELETE` serwera i narzędzia, zdjęcie ze step-up; `approve` z `risk` i `action`, widoki rejestru dla wpisu adaptera, `disabledBy` w katalogu | zrobione |
| M6.3 | porządki do wydania: wyszukiwanie JDK 25, LICENSE, NOTICE, SECURITY, CONTRIBUTING, CHANGELOG, `Dockerfile` w korzeniu repozytorium, `scripts/build-images.sh`, workflow wydania (nie uruchomiony), README ze zrzutami; obraz `m6-ea6d179` bez wdrażania | zrobione |
| M6.4 | opcjonalny TLS na porcie BFF (`PORTAL_PUBLIC_TLS_*`, PEM, pakiet SSL Spring Boota), `ServerTlsTest`, README | zrobione; obraz w raporcie |
| M7 (2.0.0) | kontrakty 7.0.0 (CC-229..CC-240): bez list systemow, serwerow i typow zasobow; odbicia C12 serwerow, mapowania zakresow, nadpisan, zatwierdzenia polityk i systemow brokera; `needs_reconnect` | zrobione |

## M7: wersja 2.0.0, serwery i systemy jako dane (2026-11-06)

`mvn test`: 598 testow (526 z 1.0.0, `AdminMirrorsTest` 29, `DynamicSystemsTest` 43), 0 bledow. Jary 7.0.0 z `~/.m2` (po CC-240). Opis: sekcja "2.0.0" w README.

- Usuniete: `AdminTargets.SERVER_IDS`, `RegistryData.SERVER_IDS`, `BrokerData.SYSTEMS`, `GatewayData.RESOURCE_TYPES`, wzorzec nazw narzedzi z piecioma
  systemami. Zastapily je wzorce kontraktu w `ContractValues` (z listą zarezerwowanych id, CC-237). Port C13 ma `systems()` (klucze katalogu IGA).
  Atrapa IGA (`dev/iga-mock.yaml`) to dane tego adaptera, nie lista w kodzie; zostaje.
- Odbicia C12: `AdminOperations` (jedna sciezka: grupa, MFA, wywolanie z tokenem, `If-Match`/`If-None-Match`/`ETag` bez zmian, sprawdzenie odpowiedzi,
  mapowanie odmow), `AdminInput` (ciala zamkniete), `AdminViews` (odpowiedzi zamkniete, znaki ukryte zapisane), trzy kontrolery. `UpstreamCalls.admin`
  czyta odpowiedz do 8 MiB. Zasady MFA: patrz tabela w README; `PATCH` serwera bez MFA tylko dla ciala `{"enabled":false}` (CC-240).
- Decyzje wlasne: (1) `409` i `422` przechodza tylko z kodem, ktory operacja wymienia, reszta to `503`; (2) zatwierdzenie polityk wymaga
  `Sec-Fetch-Site: same-origin` jak zatwierdzenie narzedzia.
- CC-243 i CC-244: zastapienie nadpisania (`PUT` z `If-Match`) wymaga MFA, utworzenie nie; `DELETE` serwera i `PUT` nadpisania maja `401` ze step-upem w C12;
  zly wzorzec id w sciezce albo zly `If-Match` i `If-None-Match` to zawsze `400` (nigdy `404` ani `412`; poprawne id bez zasobu `404`, `DELETE` systemu bez systemu `204`);
  nowe lustro `GET .../registry/servers/{serverId}/policies` (`ApprovedPolicies`, null gdy nic nie zatwierdzono); `displayName` systemu (1..64, bez znakow sterujacych
  i formatujacych; w widoku zawsze, katalog C12 go nie ma, wiec `SystemInfo` go czyta i nie oddaje); cel nadpisania wg `ServerId` (bez zarezerwowanych id);
  `audience_not_allowed` z brokera przechodzi jako `system_rejected` z powodem.
- Ciala zadan administracji: kontrola grupy przed odczytem ciala (kontrolery czytaja strumien sami, bez `@RequestBody`), limit 64 KiB: `AdminBodyLimitFilter`
  odpowiada `400` po `Content-Length` przed odczytem (C12 nie ma `413`), a ciag bez dlugosci jest przerywany przy czytaniu. Limit na proxy opisany w README.
- Cache tokenow po wymianie jest czyszczony przez kazde logowanie (`LoginSuccessHandler` zostawia tylko kontekst i klientow OAuth), wiec po step-upie
  wymiana daje token z nowym `auth_time`; mapper IdP musi kopiowac ten claim (C4 i C5 liczą go same, brak = nieswiezy).

## M6: stan (2026-11-03)

`clean verify`: 503 testy, 0 błędów (`bff/ci/run.sh`). Opis: sekcja "M6" w README.

- Katalog mocka IGA (`dev/iga-mock.yaml`) zna grupę `mcp-opensearch-ops` (cluster health i wersja backendu; test na prawdziwym pliku). README i teksty UI nie obiecują Jira Cloud (serwer: tylko Data Center, Cloud później); obrazy bez zmian (plik dev i teksty nie wchodzą do obrazu).
- Kontrakty 6.2.0: jary `mcp-contracts`, `mcp-manifest` i `test-vectors` z `~/.m2`; z rejestru, gdy ustawione `MCP_MAVEN_REPOSITORY_URL`
  (GitHub Packages: `https://maven.pkg.github.com/aiwcorpo/mcp-contracts`, ustawienia w `.ci/settings.xml`, ten sam mechanizm co dotąd).
  Nie ma w gicie żadnego pliku z kontraktami.
- Wyłącznik: włączenie bez MFA, zdjęcie ze świeżym MFA (`StepUpPolicy.requireFresh`, `returnPath` ze strony, z której poszło żądanie: U12
  po stronie BFF bez zmian, wznowienie robi web). Decyzja własna: powód z ukrytymi znakami albo dłuższy niż 200 znaków to `400`; kontrakt
  nazywa go tekstem nieufnym i nie mówi, czy BFF ma go odrzucić (propozycja CC-210 w `mcp-contracts`).
- `approve`: BFF sprawdza tylko wartości `risk` i `action` (`400` dla nieznanej wartości albo połowy pary); zgodność pary i to, że
  wpis jest z adaptera, rozstrzyga gateway (`422` z `reason`). `400` nie występuje w kontrakcie `approveAdminTool` (CC-210).
- `adapter_mode_mismatch` i pozostałe powody `ManifestRejected` przechodzą bez zmian (wzorzec `^[a-z][a-z0-9_]*$`).
- Przegląd M6 e3: zdjęcie wyłącznika wymaga `Sec-Fetch-Site: same-origin` (jak `approve`); włączenie nie.
- Obraz: `mcp-portal-bff:m6-e72ccbf`, `mcp-portal:m6-e72ccbf` (BFF z aplikacją) i `mcp-portal-web:m6-e72ccbf` (poprzednie `m6-ea6d179` zastąpione), z `scripts/build-images.sh` i `Dockerfile`
  tego repozytorium (nie z `mcp-platform-dev`). Sprawdzone uruchomieniem: `portal` startuje w profilu `dev`, `/actuator/health` UP,
  `/api/v1/me` 401, trasa SPA 200 z CSP i nonce; `web` odpowiada na `/__web/health` i serwuje `index.html` z CSP. Nie wdrożone na stos.
- Obrazy bazowe w `Dockerfile`, `bff/ci/Dockerfile` i `web/ci/Dockerfile` są przypięte digestem (nginx `stable-alpine` sha256:0e52bd05..., temurin 25-jdk sha256:83f4a7fc...), odczytanym z rejestru przez `docker buildx imagetools inspect`; workflow wydania przerywa, gdy któryś `FROM` albo `ARG *_IMAGE` nie ma `@sha256`. Obraz `m6-e72ccbf` zbudowano z `NGINX_IMAGE=nginx:1.27-alpine@sha256:6564...` (przed odczytem digestu stable), więc obraz `web` trzeba zbudować ponownie z domyślnym nginx stable.
- Workflow wydania ma trzy zadania: `verify` i `build` (obrazy, SBOM, `docker save` do artefaktu) z `packages: read`, oraz `push` z `packages: write`, które nie uruchamia kodu projektu: pobiera artefakt, `docker load`, `docker login` (token w `env` kroku), `docker push`.
- Workflow wydania czyta pakiety `mcp-contracts` tokenem `GITHUB_TOKEN` (`packages: read`), bez osobistego tokenu: każdy z pakietów (Maven `mcp-contracts` i `mcp-manifest`, npm `@aiwcorpo/mcp-contracts`) musi w ustawieniach dać temu repozytorium dostęp do odczytu ("Manage Actions access"). `ci.yml` robi to samo (`packages: read`, `GITHUB_TOKEN`), bez Environment `ci-main` i bez sekretów rejestru; zadanie `web` dostało `NODE_AUTH_TOKEN` z `GITHUB_TOKEN`, bo wcześniej nie miało skąd wziąć paczki.
- Nie sprawdzone: workflow `.github/workflows/release.yml` (nie ma repozytorium ani paczek), `ci/run.sh --container` w całości (krok
  `npm ci` w kontenerze potrzebuje sieci, a ta maszyna jej nie ma), pobranie jarów z GitHub Packages.

## M6: kontrakty 6.3.2 (2026-11-03)

`clean verify`: 502 testy. Jary 6.3.2 z `~/.m2`. `PUT .../secret` przyjmuje `username` (sito znaków jak `backendUser`, bez `:`; null to 400;
nie jest logowany, audytowany ani zwracany); katalog niesie `userSecretScheme` i `deployment` (wartości spoza enum pomijane). `400` w
`approve` (CC-210) i `503` katalogu przy nieczytelnych wyłącznikach są sprawdzane względem C12. Obrazy: `mcp-portal-bff:m6-9a9a80d`,
`mcp-portal:m6-9a9a80d`, `mcp-portal-web:m6-9a9a80d` (bez wdrażania, nginx stable z digestem z rejestru).

## M2: wynik (2026-10-28)

`./mvnw test`: 131 testów, 0 błędów. `-Pdev-env`: `DevEnvironmentFlowTest` pomija się (realm `corp` nie ma redirect URI
`/api/v1/auth/callback`, patrz niżej); `UpstreamTlsDevEnvironmentTest` wymaga stubów mTLS na 18443, których w stosie
`full` nie ma (stan sprzed M2). Ręcznie: `run-mocks.sh start` + `PORTAL_MOCKS=1 ./scripts/run-dev.sh` na 18720,
`/api/v1/me` 401, `auth/login` przekierowuje do Keycloaka z `redirect_uri=.../api/v1/auth/callback`.

Decyzje M2:
- Tabela akcji katalogu dokładnie wg CC-083: `request_access` przy `no_access` także bez `requiredEntitlements`, przy
  `connected` gdy któreś narzędzie odmówione; `view_request` tylko przy `request_pending`; `disconnect` tylko przy
  `connection` != null. `credential` pomijane, gdy broker nie zna systemu. `requiresConfirmation` wymuszone dla `DESTRUCTIVE`.
- `Location` przekierowań jest względny (Tomcat budował absolutny z `Host`); callback OAuth ma `Referrer-Policy: no-referrer`
  i `Cache-Control: no-store`.
- Błędy Tomcata sprzed servletu (zakodowane `/`, `..`) są JSON (`JsonErrorReportValve`): wcześniej HTML pod `/api/**`.
- `expiresAt` w `PUT secret`: tylko składnia `Timestamp`, bez oceny daty.
- Audyt wirtualnych serwerów: `admin_change` z `virtualServer`.
- CSRF to nadal double-submit (ciasteczko = nagłówek); ochronę przed podrzuceniem ciasteczka daje prefiks `__Host-` (CC-055).
  Wiązanie tokenu z sesją serwera możliwe, jeśli koordynator chce mocniej.
- Step-up zostaje tylko w `GET /auth/login?stepUp=true` (potwierdzenia wracają w M3 z pivotem); `StepUpPolicy.isFresh` i
  `stepUpUrl` nieużywane do tego czasu.

## Runda poprawek M2 (2026-10-28)

Kontrakty 2.2.3. `./mvnw test`: 139 testów, 0 błędów, 1 pominięty (`DevEnvironmentFlowTest`).

| Znalezisko | Status |
| --- | --- |
| L1 `SpaFallbackFilter` na surowym URI (`/%61pi/...` dawał HTML) | poprawione: filtr sprawdza ścieżkę surową i zdekodowaną z kontenera; testy `anEncodedApiPrefixIsNotAnSpaRoute` i dwa nowe wiersze w `apiPathsNeverAnswerWithHtml` |
| L2 brak audytu przy `error` w callbacku OAuth | poprawione: `connection_change` z powodem `cancelled` / `provider_error`; test `aRefusalAtTheProviderIsAudited` |
| L3 `defaultType` z C4 niewalidowany | poprawione: system z `defaultType` spoza `supportedTypes` (po odfiltrowaniu nieznanych typów) jest odrzucany jak nieznany brokerowi (bez `credential` i akcji połączenia); `BrokerDataTest` |
| L4 `Pending` zmieniany w miejscu bez `setAttribute` | poprawione: `setAttribute` po `add` i `take`. Sesje nadal w pamięci jednej instancji; przy replikacji potrzebny magazyn z atomowym zużyciem `state` |
| L5 luka testów tabeli CC-083 (m7, m15) | poprawione lokalnie: `aDeniedToolOffersRequestAccessOnlyWhenConnected`, `aServiceAccountSystemShowsNoConnectionEvenIfTheBrokerListsOne`. Wektory w kontrakcie (b): do ws-00, bez zmian poniżej |
| L6 `request_access` bez `POST /access-requests` | uzgodnione z web: akcja ukryta w M2 po stronie web (wnioski w M4); BFF dalej zwraca `request_access` zgodnie z CC-083 |
| Smoke Haiku FAIL: `PORTAL_MOCKS=1 ./scripts/run-dev.sh` wymagał `mcp-platform-dev` | poprawione: w trybie mocków skrypt nie czyta `mcp-platform-dev`, gdy go nie ma (sekret klienta generowany lokalnie, issuer z stubu discovery na :18723 startowanego przez `run-mocks.sh`, bez certyfikatów); tryb ze stosem dalej czyta `.env` i `.secrets` skryptem, brak katalogu lub klucza kończy się czytelnym błędem, ścieżka przez `MCP_PLATFORM_DEV_DIR`; każdą wartość można nadpisać zmienną `PORTAL_*`. Ograniczenie: bez Keycloaka nie da się zalogować |
| L4 web (reguły http w dev) | po stronie BFF: `authorizeUrl` z http tylko dla loopback w profilu dev (jak `isAllowedRedirect` w web); `plainHttpAuthorizeUrlIsAcceptedOnlyForLoopbackInTheDevProfile` |
| Decyzja człowieka: bez sprawdzania tożsamości | przejście na 2.2.3; BFF nie przekazuje `identity_mismatch` (`PUT secret` -> 503, callback OAuth -> `provider_error`), `PUT secret` zwraca `backendUser` z brokera, callback `connected=<system>` (konto widać w katalogu i połączeniach) |

Gateway 8dc1d7a (komunikat koordynatora): C5 wymaga `azp=mcp-portal-bff` i odrzuca `aud` zawierające `mcp-gateway`. BFF wymienia token na samo `aud=mcp-gateway-admin` przez klienta `mcp-portal-bff`, więc `azp` pochodzi od IdP; nie sprawdzałem tego na żywo (procesy gateway'a zatrzymane). Limit 50 linków: 400 `invalid_request` z C5 jest przekazywany (z `requestId`), web pokazuje wskazówkę.

Integracja z gateway'em M2 (C5): BFF składa katalog C12 sam: z C5 `GET /admin/v1/catalog` bierze tylko serwery i narzędzia
(`description`, `risk`, `action`, `access`, `requiredEntitlements`, `title`, `disabled`, `requiresConfirmation`), a
`credential` (C4 `/v1/systems`), `connection` (C4 `/v1/connections`), `status` i `actions` (tabela CC-083) wylicza
`CatalogAssembler`. Na polach, których C5 nie ma, nic nie polega. Test na żywo z gateway'em na https://localhost:18701 nie
był wykonany: wymaga zalogowanej sesji Keycloak i certyfikatu klienta z hasłem ze `.secrets`; do wykonania przez koordynatora
(`./mvnw test -Pdev-env` z `PORTAL_GATEWAY_ADMIN_URL`).

## Domknięcie M2: contracts 2.2.5 (2026-10-28)

Kontrakty 2.2.5. `./mvnw test`: 177 testów, 0 błędów.

- CC-119: `409 virtual_server_limit_reached` z C5 -> własny `409` z tym samym kodem i `requestId`; audyt `admin_change` z
  powodem `virtual_server_limit` (słownik C8, kod błędu API jest inny). Test sprawdza `requestId` w ciele, nagłówek do C5,
  `decision` i `outcome`.
- CC-117: `connection_change` niesie `backendUser` (odpowiedź brokera na `PUT secret` i `completeOAuth`). Pole przechodzi
  wzorzec ze schematu C8 (bez C0/C1, DEL, U+2028/2029, bidi U+202A-202E i U+2066-2069, 1..255 code pointów) oraz bez
  samotnych surogatów; inaczej jest pomijane, a `WARN` (bez wartości, osobny logger od audytu) zostawia ślad. Testy:
  `BackendUserAuditTest` i ścieżka odrzucenia w `OAuthConnectTest`. Dla `disconnect` brak (broker nie zwraca konta).
- CC-111 (2.2.4, wcześniej niezrobione): przekierowanie po błędzie OAuth dokleja `&system=<system>`, gdy przepływ jest
  znany; web nie dokleja już własnego `system` do `returnPath`.
- Komenda Claude Code: `portal.client-configs.claude-code.client-id` i `.callback-port` (env
  `PORTAL_CLIENT_CONFIGS_CLAUDE_CODE_CLIENT_ID`, `..._CALLBACK_PORT`). Puste = brak flagi, niezależnie. Profil `dev`:
  `claude-code` i `33418`. Walidacja przy starcie (client id `[A-Za-z0-9._-]{1,128}`, port 1024-65535); gotowa komenda
  jest dodatkowo sprawdzana wzorcem `^[A-Za-z0-9 ._:/=-]+$` (powłoka bez cytowania). `publicBaseUrl` z literałem IPv6
  jest błędem startu (nawiasy to znaki glob). Schemat `ClientConfigs` (C12) to trzy zwykłe stringi, więc CC nie trzeba.
  Testy: `ClientConfigsTest` (wartości graniczne całej komendy, metaznaki), `ClientConfigsBindingTest` (binder bez
  profilu `dev` z shipped `application.yml`: puste = bez flag, zła wartość = kontekst nie wstaje).
- Copilot (`mcp.json`) i Codex (`config.toml`): bez zmian, brak potwierdzonego pola na identyfikator klienta; do
  sprawdzenia na żywo.
- Do sprawdzenia przez ws-01 (klient `claude-code` w realmie `corp`, redirect `http://localhost:33418/callback`) i
  na żywo `claude mcp add ...` z tej komendy do końca Authenticate; do tego czasu komenda w dev jest sprawdzona tylko
  co do kształtu.

## Propozycje CC

1. C12 `deleteMyVirtualServer` i `disconnect`: dopisać `400 invalid_request` dla zakodowanych ścieżek odrzuconych przez firewall.
2. C12: dopisać `503 upstream_unavailable` do `oauthCallback`? (nie dotyczy: callback przekierowuje) - zamiast tego opisać w
   `oauthCallback`, że błąd brokera daje `connectError=provider_error`.
3. Tabela CC-083: rozstrzygnąć `request_access` przy `no_access` bez `requiredEntitlements` i `view_request` przy `connected`
   z oczekującym wnioskiem na odmówione narzędzie (dziś niedostępne).
4. Audyt: wartość `event` dla zmian wirtualnych serwerów (dziś `admin_change`).

## Potrzeby wobec innych strumieni (M2)

- ws-01: w realmie `corp` redirect URI klienta `mcp-portal-bff` `<publicBaseUrl>/api/v1/auth/callback` (dla portu 18720 i
  dla adresu nginx) oraz `post.logout`; nginx z trasami z README kontraktów; przekazanie `PORTAL_PUBLIC_BASE_URL`.
- ws-05: `GET/POST/DELETE /admin/v1/virtual-servers` z kodami `slug_taken`, `access_denied`, 404 dla cudzego linku;
  katalog z `title`, `disabled`, `requiresConfirmation`.
- ws-06: `authorizeUrl` z parametrem `state` (BFF szuka przepływu po nim); `422 flow_invalid|identity_mismatch`.
- ws-08: ciasteczko CSRF `__Host-XSRF-TOKEN`; po callbacku `?connected=<system>` lub `?connectError=<kod>` doklejane do
  `returnPath` (`&` gdy ma query); `/?loginError=session_expired` bez sesji; 400 `resource_defaults_unsupported` nie
  występuje przy kreatorze bez zawężenia.

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

## M3.1: kontrakty 3.0.1, potwierdzenia, Authenticator (2026-10-28)

Zależność `mcp-contracts` 3.0.1 (3.0.0 ma lukę G-H1). Szczegóły zachowania w README, sekcja M3.

Decyzje:
- Brak zdarzeń `confirmation` po stronie BFF: pisze je gateway (`cancelled_by_owner`, `user_confirmed*`), kontrakt oznacza je jako
  zdarzenia gatewaya. BFF audytuje `authenticator` i `virtual_server_change`. `upstream_unavailable` jako powód
  `virtual_server_change` i `authenticator` nie jest na liście znanych wartości C8 (pole nie ma enum, tylko wzorzec); do
  rozważenia przez ws-00.
- `Sec-Fetch-Site` inny niż `same-origin` albo brak nagłówka przy `viewed` to `403 csrf_invalid` (C12 nie podaje kodu; wybrany ten,
  który C12 ma dla `CsrfInvalid`). Żądanie z `Sec-Purpose`/`Purpose: prefetch` dostaje 204 bez przekazania (idempotentne,
  nic nie zostało zapisane).
- `422 invalid_code` / `enrollment_invalid` mają ciało bez `requestId` (schemat `AuthenticatorEnrollmentError` jest zamknięty),
  id żądania jest w nagłówku.
- Kod pierwszego potwierdzenia jako liczba JSON (`"code":123456`) jest odrzucany (bez koercji skalarów); `PUT .../secret` (M2)
  koercował liczbę na tekst; poprawione w M3.3 (`StrictJson` dla `PUT secret`, startu OAuth i potwierdzenia rejestracji; ciała wirtualnych serwerów były sprawdzane po typie węzła od M2).
- Domyślna strona rejestracji do powrotu ze step-up: `/authenticator` (`portal.step-up.authenticator-return-path`); web ma ją
  ustawić w trasach albo podać własny `returnPath` (C12 na to pozwala).
- Step-up w dev: realm `corp` nie ma poziomu `acr` dla MFA (STATUS mcp-platform-dev: "Poza M1", `acr` = `1`). Dopóki ws-01
  go nie doda, `PORTAL_STEP_UP_ACR_VALUES` zostaje puste i o świeżości decyduje `auth_time` z `max_age=0` (ponowne hasło).
  Prośba do ws-01: poziom `acr` dla hasło+OTP w realmie i ustalenie wartości (BFF czyta ją z `PORTAL_STEP_UP_ACR_VALUES`).

Znalezisko w artefaktach: `mcp-contracts-3.0.1-test-vectors.jar` w `~/.m2` zawiera jeszcze `connect-redirects/valid-identity-mismatch*.json`
(w repozytorium i tagu są tylko `invalid-identity-mismatch*.json`; jar zbudowany bez `clean`). `ConnectRedirectVectorsTest` pomija te
dwa pliki. Wydanie jest niezmienne, więc do zgłoszenia ws-00 (kolejne wydanie albo przebudowa jara).

Testy: `./mvnw test`: 314 testów, 0 błędów (po M3.3).

Poprawka po przeglądzie bezpieczeństwa (GatewayData): nazwa argumentu podglądu musi pasować do `^[A-Za-z_$][A-Za-z0-9_$.-]{0,127}$`
(inaczej cały podgląd to 503); w `value` znaki bidi (U+202A-202E, U+2066-2069, U+200E/200F, U+061C), sterujące C0/C1 poza
`\n` i `\t`, U+2028/2029 i samotne surogaty zamieniają się na widoczny zapis `<U+202E>`; `ActivityCall.client` musi pasować do
`^[A-Za-z0-9._:-]{1,255}$` (inaczej wiersz jest pomijany). Schemat `ConfirmationArgument` jest zamknięty (nie ma pola na
oznaczenie), więc znacznikiem jest sam widoczny zapis, a `truncated` zostaje tylko dla przycięcia. Kontrakt nie podaje limitu
długości `value`, więc BFF go nie wymyśla.

## M3.2: OIDC bez discovery, higiena tekstu (2026-10-28)

- `portal.oidc.*` (README, "OIDC z osobnymi adresami"): rejestracja klienta z jawnych adresów, `iss` nadal porównywany z `issuer-uri`.
  Spring Boot 4.1 przy `issuer-uri` zawsze robi discovery i nadpisuje je jawnymi polami, więc samo ustawienie `token-uri` i
  `jwk-set-uri` nie wystarcza; stąd własny `ClientRegistrationRepository`. Test: logowanie, wymiana tokenu i wylogowanie bez żadnego
  żądania discovery; token z innym `iss` odrzucony. Nie sprawdzone na żywo z Keycloakiem (compose zmienia tylko ws-01).
- `TextHygiene` wg CC-121 (wektory `text-hygiene/` w teście) zamiast ręcznej listy: Cf (zero-width, bidi, BOM, tag), Cc poza `\n`
  i `\t`, separatory, surogaty, nieznaki, prywatne i nieprzypisane, selektory wariantu poza U+FE0F po emoji, wypełniacze. Ostrzejsza
  od kontraktu o U+200C..U+200F i CR. `resource.id`/`parent` z takimi znakami: podgląd odrzucony (503), wiersz aktywności pominięty.

## Propozycje CC

- C12/C5 `ConfirmationArgument`: opcjonalne pole (np. `neutralized: boolean`), by UI mogło oznaczyć argument, w którym BFF
  zamienił znaki ukryte na zapis `<U+XXXX>`; oraz limit długości `value` i wzorzec `name` w schemacie.
- C8/C5 `resource.id`, `resource.parent`, `ActivityCall.client`: wzorzec zakazuje bidi U+202A..202E i U+2066..2069, ale przepuszcza
  U+200B..U+200F, U+061C, U+2060, U+FEFF i znaki tag; sugerowane wspólne odwołanie do higieny tekstu z CC-121 (3.0.2). Tak samo
  U+200C..U+200F w higienie argumentów (LRM/RLM przestawiają kolejność wyświetlania).
- Brak innych. Uwaga do C8: powody `upstream_unavailable` dla `virtual_server_change` i `authenticator` (zob. wyżej).

Obrazy: `mcp-portal-bff:m3-dd0ddff` (M3.1), `mcp-portal-bff:m3-c668b1e` (M3.2), skrypt `scripts/build-image.sh [ref]`.

## M3.4: kontrakty 3.0.2, poprawki przeglądu M3 (2026-10-28)

Zależność `mcp-contracts` 3.0.2 (czyste jary, zaostrzone wzorce C8, `503` w `viewed`). `./mvnw clean test`: 340 testów, 0 błędów;
obejście stałych plików `valid-identity-mismatch*` w `ConnectRedirectVectorsTest` usunięte razem ze starym jarem.

| Znalezisko | Poprawka |
| --- | --- |
| L-1 notacja `<U+XXXX>` niejednoznaczna | literalne `<` przed `U+` w wartości zamienia się na `<U+003C>`; test, że literał różni się od prawdziwego znaku |
| L-2 brak limitu podglądu | najwyżej 64 argumenty (więcej: 503), wartość po neutralizacji najwyżej 8192 znaki, dłuższa jest cięta na granicy zapisu i dostaje `truncated: true` |
| L-3 pola spoza schematu | `ConfirmationView` i `ActivityCall` (z `resource`) czytane jako zamknięte obiekty: nadmiarowe pole lub zły typ to 503 dla podglądu, pominięty wiersz dla aktywności; wektory `activity-calls/valid-*` i `invalid-*` w teście |
| L-4 400 gateway'a jako 503 | każde 400 z `activity/calls` to `400 invalid_request` (BFF wysyła tylko sprawdzone filtry) |
| L-5 end-session | pusty `PORTAL_OIDC_TOKEN_URI` oznacza discovery; brak `end-session-uri` w trybie jawnym daje ostrzeżenie przy starcie (README opisuje skutek) |
| L-6 MFA tylko z `acr` | `portal.step-up.amr-values` (`PORTAL_STEP_UP_AMR_VALUES`): `amr` z ID tokenu zawierający wartość liczy się jak poziom `acr`; wystarczy jedno ze źródeł; poza `dev` któraś lista jest obowiązkowa. Nie sprawdzone z żywym Entra |
| L-7 brak śladu odrzuceń | cudzy `enrollmentId` to zdarzenie `authenticator` (`authenticator_enrollment_failed`, `not_found_or_denied`); `viewed` odrzucone przez `Sec-Fetch-Site` to zdarzenie `confirmation` portalu (`fetch_site_not_same_origin`, deny) |
| L-8 STATUS | jedna sekcja M3.2, zaktualizowana tabela |


## M4.1: kontrakty 4.0.0, IGA, tabela akcji CC-113 (2026-10-29)

Zależność `mcp-contracts` 4.0.0 (testowe wektory i mocki WireMock z jara). Przed zmianami `./mvnw test` na 4.0.0 padał tylko na trzech
wektorach `catalog-actions/` (CC-113), reszta bez zmian.

Zachowanie:
- Port C13 zgodny z README kontraktów: `catalog(system)` zwraca `Entitlement(name, description)`, `AccessRequest` ma `decidedAt`.
  `request` rzuca `NotRequestableException` (adapter bez obiegu wniosków albo nieznane uprawnienie) -> `422 not_requestable`.
- Adaptery: `mock` (tylko `dev`; dane i opisy w `dev/iga-mock.yaml`; wniosek tylko na uprawnienie z katalogu) i `keycloak-groups`
  (katalog z pliku `portal.iga.catalog-file` / `PORTAL_IGA_CATALOG_FILE`, brak wniosków, `request` zawsze odmawia). Portal nie ma
  poświadczenia do listowania grup przez Admin API Keycloaka, więc katalog jest plikiem wdrożenia; lista grup z API to następny
  krok (potrzebne konto serwisowe od ws-01).
- `POST /access-requests`: ciało czytane ściśle; wniosek już oczekujący na to uprawnienie = `200` z jego `requestId` (bez drugiego
  wniosku); uprawnienie spoza katalogu IGA albo już posiadane przez użytkownika (grupy z logowania) = `422 not_requestable`, więc
  portal nie służy do proszenia o `mcp-platform-admin`. Wynik adaptera musi mieć dokładnie jedno pole (`requestUrl` albo `requestId`).
- `requestUrl` z IGA to adres spoza platformy, do którego przeglądarka przechodzi albo który pokazuje: tylko `https` (w profilu `dev`
  także `http`), host, bez danych logowania i fragmentu, drukowalny ASCII, do 2048 znaków. Inaczej wynik jest błędem adaptera (503),
  a wiersz listy jest pomijany.
- `GET /access-requests/entitlements?system=`: dokładnie jeden znany system (inaczej 400); wynik bez uprawnień, które użytkownik już
  ma; `description` z IGA jako tekst nieufny: znaki ukryte zapisane jako `<U+XXXX>` (`TextHygiene`), ucięte do 500 znaków bez
  rozcinania zapisu; pozycje z nazwą spoza `GroupName` pomijane z ostrzeżeniem bez wartości.
- Lista wniosków: pozycje spoza kontraktu (status, znaczniki czasu, `requestId` ze znakami ukrytymi) są pomijane; `decidedAt` przy
  `pending` jest pomijane (kontrakt: nieobecne do rozstrzygnięcia). Katalog używa tej samej walidowanej listy.
- Katalog (CC-113): `request_access` tylko gdy odmówione narzędzie ma niepuste `requiredEntitlements`; `view_request` także przy
  `connected`, gdy oczekujący wniosek dotyczy uprawnienia wymaganego przez odmówione narzędzie (zamiast `request_access`); wniosek na
  uprawnienie narzędzia już dozwolonego się nie liczy. Wszystkie 19 wektorów `catalog-actions/` przechodzi.
- Audyt wniosków: C8 nie ma `event` dla wniosków o dostęp (zamknięte enum), więc BFF niczego nie zapisuje. Propozycja CC niżej.

Testy: `./mvnw test`: 379 testów, 0 błędów (nowe: `AccessRequestsTest`, `AccessRequestsAdapterTest` z adapterem skryptowanym,
`IgaDataTest`, `KeycloakGroupsAccessGovernanceTest`, rozszerzone `CatalogAssemblerTest`, `IgaConfigTest`).

## M4.2: administracja rejestru (2026-10-29)

Do M3 BFF nie miał tras `/api/v1/admin/registry*` (brief ws-07 punkt 8), więc M4.2 dodaje je w całości.

- `GET /api/v1/admin/registry`, `GET .../servers/{serverId}/tools/{tool}/pending`, `POST .../approve`: proxy do C5 z tokenem
  `aud=mcp-gateway-admin`. BFF sprawdza grupę `mcp-platform-admin` z logowania przed wywołaniem gateway'a (nie-admin: `403
  access_denied`, bez żadnego żądania do C5); gateway sprawdza ją jeszcze raz na wymienionym tokenie (jego `403` też daje `403`).
- Odpowiedzi C5 są sprawdzane względem zamkniętych schematów `RegistryServer` i `PendingTool` (`RegistryData`): pola spoza schematu,
  `change`/`source` poza `pending_approval`, `pendingHash` różny od `pendingEntry.definitionHash`, zły `serverId` dla `system` itp.
  to naruszenie kontraktu i cały widok jest odrzucony (`503`), bez widoków częściowych.
- Definicje narzędzi pochodzą z potoku repozytorium albo (`source: server`) z działającego serwera, więc każdy tekst w odpowiedzi (opisy,
  `inputSchema`, nazwy pól) przechodzi przez `TextHygiene`: znaki ukryte zapisane jako `<U+XXXX>`; hashe przekazywane bez zmian
  (należą do oryginalnego tekstu). To jest "diff definicji dla web": `approvedEntry`, `pendingEntry`, `approvedInVersion`,
  `pendingVersion`, `source`.
- `approve`: ciało czytane ściśle (`definitionHash` wg wzorca); `409 hash_mismatch` z C5 -> `409`; `422 manifest_rejected` z C5 ->
  `422` z `ManifestRejected` (`reason` tylko gdy pasuje do wzorca `^[a-z][a-z0-9_]{0,63}$`, `message` max 500 znaków po neutralizacji; to
  jedyne pola ciała C5 przekazywane dalej); inne statusy C5 -> `503`.
- Ścieżka z `serverId` spoza pięciu serwerów albo `tool` spoza `ToolName`: `404 not_found_or_denied` (kontrakt nie ma `400` dla tych tras).
- Audyt: `admin_change` (`component: portal`) z `reason: definition_approved`, `server`, `tool`, `definitionHash` (pola dodane do
  `AuditEvent`), `sub` administratora; wynik `ok` albo odmowa/błąd z kodem. Gateway zapisuje swoje zdarzenie niezależnie.
- `UpstreamException` niesie teraz także `reason`, `message` (422) i `Retry-After` (liczba sekund, min. 1), pod M4.3.

Testy: `./mvnw test`: 390 testów, 0 błędów (nowy `RegistryAdminTest`, 11 testów, z przykładem `changed_on_server` z kontraktu).

## M4.3: limity i `429` (2026-10-29)

- Limity własne BFF, na sesję (`SessionRateLimiter`, okno przesuwne trzymane w sesji, więc znika razem z nią): zapis tokenu (`PUT
  .../secret`) i zapisy Authenticatora (start rejestracji, usunięcie, potwierdzenie pierwszego kodu; jedno wspólne okno). Konfiguracja:
  `portal.limits.secret-write` (domyślnie 10 na 1 min) i `portal.limits.authenticator` (10 na 10 min), zmienne
  `PORTAL_LIMIT_SECRET_WRITE_MAX|WINDOW`, `PORTAL_LIMIT_AUTHENTICATOR_MAX|WINDOW`. Wartości są wyborem BFF (kontrakt ich nie podaje):
  zapis tokenu to sprawdzenie ważności tokenu w systemie docelowym, więc chodzi o to, by nie dało się go powtarzać bez końca.
- Liczone są tylko żądania, które doszłyby do brokera: błędne ciało, nieznany system, brak świeżego MFA i cudzy `enrollmentId` limitu
  nie zużywają. Odmowa: `429 {error: rate_limited, requestId}` z `Retry-After` (sekundy, min. 1, do wygaśnięcia najstarszego wpisu), bez
  żadnego nagłówka `X-RateLimit-*`; odmowa nie jest liczona; żądanie nie dociera do brokera. Audyt: `connection_change` albo
  `authenticator` z `decision: deny`, `reason: rate_limited`, `errorCode: rate_limited`.
- Limit na sesję znaczy, że nowe logowanie zaczyna nowe okno; per użytkownik pilnują broker i gateway (start OAuth, rejestracja
  Authenticatora 10 na godzinę, `tools/call`). To zgodne z CC-156 ("na sesję").
- `429` z brokera i gateway'a: każde `429` od C4/C5 wraca jako `429 rate_limited`, z `Retry-After` tylko gdy upstream podał liczbę
  sekund (data HTTP, liczba ujemna lub zbyt duża jest traktowana jak brak, nagłówka nie wymyślam; `0` -> `1`). Dotyczy też start OAuth
  (`POST .../oauth`), którego C12 nie wylicza z `429` (propozycja CC niżej); callback OAuth dalej kończy się `connectError=provider_error`
  (CC-107), z powodem `rate_limited` w audycie.
- `422 system_not_configured` z brokera (CC-158): start OAuth -> `503 upstream_unavailable`; zakończenie przepływu -> `provider_error`
  (`ConnectErrorCode` jest zamknięte, usterka instalacji to nie błąd użytkownika), audyt `connection_change` z powodem
  `system_not_configured`, `outcome: error`.

Testy: `./mvnw test`: 398 testów, 0 błędów (nowy `RateLimitsTest` na zmniejszonych limitach przez `@TestPropertySource`, rozszerzony
`OAuthConnectTest`).

## M4.4: aktywność, zgodność z przykładami 4.0.0 (2026-10-29)

- Aktywność (CC-142): wiersze z wynikiem `rate_limited` (kod `rate_limited`) i `credential_required` przechodzą walidację wierszy bez zmian
  (oba były już na liście kodów BFF); wszystkie cztery grupy filtra `result` (`ok`, `denied`, `error`, `confirmation`) są przekazywane
  gateway'owi bez zmian, który je rozwija. BFF niczego nie grupuje.
- "Ostatnie użycie" konta serwisowego (CC-150): bez nowego pola i bez logiki w BFF; web liczy z wierszy `activity/calls` o wyniku `ok`,
  `confirmed` i `error`. Test `theRowsOfAServiceAccountSystemCarryWhatTheLastUseIsReadFrom` pilnuje, że wiersze Service Desku (także
  odmowy i `expired`, które się nie liczą) docierają bez zmian i że filtr `q` jest przekazywany.
- Przykłady C12: odpowiedzi BFF są równe przykładom kontraktu dla listy wniosków (`pending`, `approved`), uprawnień (`confluence`),
  rejestru (`jira`, `opensearch_disabled`) i diffu (`new_tool`, `changed_on_server`); kody `429`, `422 not_requestable`, `422` z
  `ManifestRejected`, `503` przechodzą walidację operacji.
- Mocki MSW (`mocks/msw`) to dane dla web; po stronie BFF ich odpowiednikiem są przykłady OpenAPI sprawdzone wyżej oraz mapowania WireMock z
  jara 4.0.0 (`run-mocks.sh` bierze wersję z `pom.xml`). Stuby 4.0.0 mają `pendingVersion` i `source` (gateway) oraz `Retry-After` w odpowiedziach `429` brokera
  (start OAuth, rejestracja Authenticatora), więc BFF 4.0.0 przechodzi na nich bez zmian w stubach.
- `scripts/build-image.sh` taguje `mcp-portal-bff:m4-<sha>` (przedrostek z `IMAGE_TAG_PREFIX`). Obraz zawiera sam jar BFF; zbudowany
  frontend nie wchodzi do obrazu, tylko jest montowany i wskazywany przez `PORTAL_WEB_DIST` (jak w M3, po stronie compose ws-01).

Testy: `./mvnw test`: 402 testy, 0 błędów, 0 pominiętych (testy `-Pdev-env` na stosie nie były uruchamiane: wymagają Keycloaka i certyfikatów
ze `.secrets`, nie czytam ich; do wykonania przez koordynatora).

## Propozycje CC (M4)

3. C12 `startOAuth`: dopisać `429 rate_limited` z `Retry-After` (broker limituje start OAuth, CC-156). Do czasu zmiany BFF odpowiada tu `503`.
   Gateway admin API nie ma limitów w C5, więc `429` z C5 też jest `503`.
4. C8: `reason` dla `admin_change` portalu przy zatwierdzeniu, które nie doszło do skutku (odmowa nie-admina, `hash_mismatch`, `risk_lowered`);
   dziś słownik zna tylko `definition_approved`, więc takie zdarzenia nie mają `reason`.

2. C12 `approveAdminTool`: dopisać `400 invalid_request` dla ciała spoza schematu (dziś BFF zwraca `400`, którego operacja nie wymienia).

1. C8: osobne zdarzenie (np. `access_request_change`) albo znana wartość `reason` dla `admin_change` przy złożeniu wniosku o dostęp z
   portalu; dziś portal nie ma jak zapisać tej akcji w audycie.

Obraz: `mcp-portal-bff:m4-66121db` (po poprawkach z przeglądu, bez wdrożenia na stos; wcześniejszy `m4-6c73f1b` zastąpiony).

## Runda poprawek po przeglądzie Opus M4 (2026-10-29)

| Znalezisko | Status |
| --- | --- |
| M-1 audyt approve | `definition_approved` tylko w zdarzeniu gateway'a (źródło prawdy dla udanego zatwierdzenia, `sub` administratora, `definitionHash`). Portal zapisuje `admin_change` wyłącznie dla prób bez skutku (odmowa, `404`, zły `Sec-Fetch-Site`, `409`, `422`, błąd), bez `reason` (słownik C8 nie ma pasującej wartości, propozycja CC 4), z `outcome`, `errorCode`, `server`, `tool`, `definitionHash`. Udane zatwierdzenie nie ma drugiego zdarzenia portalu, więc liczba zatwierdzeń nie jest podwojona. Opis w README |
| M-2 entitlements z `keycloak-groups` | port ma `supportsRequests()`; adapter bez obiegu wniosków daje `422 not_requestable` także dla `entitlements` i `POST`; test |
| L-1 | `approve` wymaga `Sec-Fetch-Site: same-origin` (jak `viewed`), inaczej `403 csrf_invalid` i zdarzenie; świeże MFA nie dodane (kontrakt go nie wymaga; do decyzji koordynatora) |
| L-2 | `mcp-platform-admin` i uprawnienia spoza `mcp-<system>-` odrzucane twardo (lista i `POST`), niezależnie od katalogu IGA |
| L-3 | `approvedInVersion: null` przy istniejącym `approvedEntry` nie odrzuca diffu |
| L-4 | diff odrzucany, gdy `pendingEntry` lub `approvedEntry` dotyczy innego narzędzia niż w ścieżce |
| L-5 | `429` od C4/C5 przekazywane tylko dla `PUT secret` i operacji Authenticatora (te C12 opisuje); gdzie indziej `503` zgodnie z kontraktem; propozycja CC 3 (konkretnie `startOAuth`) |
| L-6 | `429` z brokera bez użytecznego `Retry-After` dostaje 60 s (C12 obiecuje nagłówek); wartość z upstreamu bez zmian |
| L-8 | `system_not_configured` przy `PUT secret` w audycie jako przyczyna; DELETE i `PUT` uwzględniają też `429` |
| L-11 | plik katalogu IGA: nieznany klucz albo pusty katalog `keycloak-groups` = błąd startu |
| L-7, L-9, L-10, L-12, L-13 | bez zmian: L-7 to konsekwencja "na sesję" z CC-156 (broker nie ma limitu zapisu tokenu na `sub`, do rozważenia po stronie ws-06); L-9 w propozycji CC 1; L-10 (wyścig dwóch POST) zostaje na adapterze IGA; L-12 (lista hostów IGA) nie dodana; L-13 uwaga do kontraktu |

Testy: `./mvnw test`: 410 testów, 0 błędów.

## Kontrakty 4.1.0 (2026-10-29)

Zależność `mcp-contracts` 4.1.0 (gateway 4.1.0 i BFF 4.1.0 wchodzą razem: schematy `RegistryTool`/`PendingTool` są zamknięte).
- `approve` przyjmuje `acceptRiskLowering` (ścisły boolean). Przy `true` BFF wymaga świeżego MFA administratora tym samym mechanizmem i
  oknem co rejestracja Authenticatora; bez niego `401 step_up_required` ze `stepUpUrl`, `returnPath` = `portal.step-up.admin-return-path`
  (`/admin`; web podmienia go na `/admin?mfa=ok`, co C12 dopuszcza, `ReturnPath` ma query), zdarzenie `admin_change` z `outcome: denied`, bez wywołania gateway'a. Pole idzie do gateway'a tylko przy `true`
  (`false`/brak/`null` = zwykłe zatwierdzenie, bez MFA).
- `riskLowered` (pending, `RegistryTool`, `PendingTool`) jest przekazywane do web; musi być booleanem, a w zatwierdzonym wpisie nie może być `true`.
- Aktywność (CC-165): gateway zmienia wynik wierszy (m.in. `rate_limited`, `tool_disabled`, `denied_*` w grupie `denied`); BFF przekazuje
  wiersze i grupy filtra bez zmian, więc nic do zmiany. Web nie proponuje `request_access` na podstawie samego `result`.
- Testy: 412, 0 błędów (nowe: MFA przy obniżaniu ryzyka, pole tylko przy `true`, `riskLowered`).

## M5: jeden adres `/mcp`, CI (2026-10-31)

Kontrakty 5.1.0 (`mcp-contracts` i nowa zależność `mcp-manifest` dla `EndpointFilter`, tej samej klasy co w gateway'u).
`clean verify`: 467 testów, 0 błędów (13 testów `VirtualServersTest` usunięto razem z linkami).

- Usunięte: `GET|POST|DELETE /api/v1/virtual-servers*`, proxy `/admin/v1/virtual-servers`, `ClientConfigs` per link, audyt
  `virtual_server_change`, pole `virtualServer` zdarzenia C8, `PublicUrls.virtualServer`. `/v/` nie ma w BFF.
- `GET /api/v1/me/mcp-endpoint` (CC-175, CC-182): parametry jako wartości zdekodowane, `composeQuery` bez ponownego kodowania
  (`&`, `=` w wartości -> `%26`, `%3D`, parser je odrzuca), parsowanie `EndpointFilter.parse`, `toolCount` z płaskiej listy
  `servers[].tools[]` katalogu C5 (`granted` i nie `disabled`, po filtrze), `clientConfigs` z `publicBaseUrl` w cudzysłowie.
  Wszystkie 15 wektorów `mcp-endpoint/` przechodzi dwa razy: na czystej klasie i przez HTTP (z zapytaniem tak, jak wysyła klient:
  `%2C`, `%252C`, `%26`, `+`). Decyzja własna: niepoprawny escape (`%zz`) jest `invalid_filter`, bo kontener (Tomcat) odrzuca taki
  kontener rzuca wyjątek przy takim parametrze (nie gubi go), więc złapany wyjątek też daje `invalid_filter`, a nie 500; kontrakt tego przypadku nie wylicza. Odrzucane są też: parametr bez nazwy, nazwa spoza czterech po dekodowaniu, puste segmenty (`&&`).
- Aktywność: `ActivityCall.filter` tylko w postaci kanonicznej (inaczej wiersz odrzucony), `denied_link_scope` czytane jako
  `denied_filter_scope`, `virtualServer` ze starego gateway'a ignorowane bez gubienia wiersza (CC-188; właściwe mapowanie jest po
  stronie gateway'a, tu tylko zabezpieczenie na czas aktualizacji).
- `ReturnPath`: `mcp` dochodzi do zarezerwowanych pierwszych segmentów (wektory `invalid-gateway-mcp*`, `valid-mcp-docs`,
  `valid-f-prefix`); `SpaFallbackFilter` nie oddaje `index.html` pod `/mcp`.
- U12: `stepUpUrl` z `returnPath` = strona, z której poszło żądanie (`Referer` tego samego originu co `publicBaseUrl`, ścieżka i
  query, tylko gdy spełnia `ReturnPath`; inaczej `/authenticator` albo `/admin`). Dotyczy rejestracji, usunięcia i potwierdzenia
  Authenticatora oraz zatwierdzenia z `acceptRiskLowering`. Kontrakt bez zmian (`returnPath` w `stepUpUrl` jest domyślny).
  Sama akcja wznawia się w web po powrocie (BFF nie trzyma ciała żądania).
- Obraz: `mcp-portal-bff:m5-94118ff` (`scripts/build-image.sh`, bez wdrażania; stos dev zostaje na M4).
- CI: `ci/run.sh` (style: znaki ukryte i frazy; `./mvnw verify`; liczba testów), `make ci`, `ci/run.sh --container` z
  `ci/Dockerfile`. Sprawdzone: lokalnie pełny przebieg; w kontenerze krok `style` na lokalnym obrazie `eclipse-temurin:25-jre`
  (`CI_BASE_IMAGE`). Krok `build` w kontenerze niesprawdzony: wymaga obrazu `eclipse-temurin:25-jdk`, którego nie ma lokalnie, a
  pobranie obcego obrazu wymaga zgody człowieka. Nakładki `.gitlab-ci.yml`, `Jenkinsfile`, `.github/workflows/ci.yml` w korzeniu mcp-portal wołają `bff/ci/run.sh` i `web/ci/run.sh`
  (składnia nieuruchamiana na żadnym runnerze); registry artefaktów przez `MCP_MAVEN_REPOSITORY_*` i `.ci/settings.xml`, sekrety tylko na gałęzi głównej.

### Propozycje CC

- Brak nowych. Uwaga do CC-182: kontrakt nie mówi, co z niepoprawnym escape'em w query (`%zz`); BFF traktuje go jako
  `invalid_filter`. Warto dopisać wektor `http-broken-escape`.
- Uwaga do C12 (`stepUpUrl`): opis mówi, że frontend może podmienić `returnPath`; BFF dodatkowo ustawia go na stronę wysyłającą
  żądanie. Jeśli ws-08 woli stały adres, wystarczy go podmienić; nic nie zależy od wartości domyślnej.

M5: w toku. Linia `M5: osiągnięty` wróci po przebiegu na prawdziwym runnerze (przegląd Opus: H1-H2, M1-M4 poprawione 2026-10-31).

## TLS na porcie BFF (2026-11-04)

Decyzja człowieka z 2026-11-03: opcjonalny TLS na publicznym porcie, bez zmian kontraktów i bez mTLS.

- Zmienne: `PORTAL_PUBLIC_TLS_ENABLED` (domyślnie `false`), `PORTAL_PUBLIC_TLS_CERTIFICATE`, `PORTAL_PUBLIC_TLS_PRIVATE_KEY`
  (ścieżki plików), `PORTAL_PUBLIC_TLS_PRIVATE_KEY_PASSWORD`. Pakiet SSL `portal-server` w `application.yml`; połączenia wychodzące
  (broker, gateway) nie używają pakietów SSL Spring Boota (własny `SSLContext` z `PORTAL_TLS_*`), więc to jedyny pakiet.
- Nazwy zrównane z gatewayem (`MCP_PUBLIC_TLS_*`, commit 87b34af): `PORTAL_PUBLIC_TLS_*` z tymi samymi sufiksami, gołe ścieżki plików
  (prefiks `file:` dodaje `PublicTlsEnvironment`). Ta sama klasa odmawia startu, gdy klucz jest czytelny dla "others" poza profilem `dev`.
- Ciasteczka: bez zmian. `__Host-session` i tak ma `Secure`, `HttpOnly`, `Path=/`, `SameSite=Lax`, bez `Domain`; `__Host-XSRF-TOKEN`
  `Secure`. Sprawdza to `ServerTlsTest`.
- `entrypoint.sh` i `PORTAL_TRUSTED_PROXY_HOST` bez zmian. Obraz nie ma `HEALTHCHECK`; sonda stosu (wget na http) przy TLS musi iść
  na https (opis w README). Obraz `web` (nginx, statyczny, za proxy) bez TLS: opis w README głównym.
- Testy: `ServerTlsTest` (4) i `ServerTlsStartTest` (5, start/odmowy): klient z testowym CA, klient bez CA, zwykłe HTTP na porcie TLS (400), ciasteczko, brak plików i brak
  ustawień przy włączeniu = błąd startu. Wyłączone TLS to pozostałe testy.
- Po przeglądzie Opus: flaga czytana konwerterem Springa (`yes`/`on`/`1`), jawne TLS 1.3 i 1.2 w pakiecie, `PublicTlsEnvironmentTest`, brak ustawień
  przy włączeniu to czytelny błąd (Tomcat bez tego szuka `~/.keystore`), `ServerTlsTest` bez `System.setProperty`.
