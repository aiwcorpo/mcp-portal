# STATUS: mcp-portal/web (ws-08)

Stan na 2026-10-28. Kontrakty: `mcp-contracts` 3.0.1 (paczka `release/aiwcorpo-mcp-contracts-3.0.1.tgz`, tag
`v3.0.1`; zalezność od 3.0.0 jest wykluczona, luka CC-127). Angular 22.2.3 / CLI 22.2.4, Angular Material 22.2.4 (wersje z `package.json`).
Wzorzec wyglądu: makiety człowieka w `mcp-platform-plan/design/` (README.md, `ekrany-authenticator-i-poprawki.txt`).

## Kamienie M3

| Kamień | Zakres | Stan |
| --- | --- | --- |
| K1 | Kontrakty 3.0.1, klient i mock (Authenticator, potwierdzenia, logi); Authenticator: status w Połączeniach (brak, aktywny, zablokowany, wyłączony z banerem), kreator rejestracji 4 kroki z QR rysowanym lokalnie, błędy rejestracji, usunięcie, baner w katalogu i kreatorze linków (23-30, m33, m36-m39) | zrobiony |
| K2 | Podgląd operacji `/confirm/<id>` (14, 15, m35): tylko odczyt, licznik, `viewed`, odpytywanie, "Anuluj operację", stany końcowe, argumenty jako niezaufany tekst | w toku |
| K3 | Zakładka Logi (06): filtry, "Pokaż więcej", etykiety wyników, błędne kody w szczegółach | do zrobienia |
| K4 | a11y AA, 360 px, e2e na MSW 3.0.1, README i STATUS | do zrobienia |

## Kamienie M2

| Kamień | Zakres | Stan |
| --- | --- | --- |
| K1 | Kontrakty 2.2.1 i regeneracja klienta; mock stanowy na `states`; motyw z makiet; powłoka (zakładki, Wyloguj); logowanie i `loginError` (00, 23, 25); katalog z 6 statusami i akcjami z tabeli (01, 02, 26); połączenia z "Ostatnie użycie" (03); formularz PAT bez MFA (04, 05); powroty z OAuth z `ConnectErrorCode` (21, 22) | zrobiony (commit 31c23d8) |
| K2 | Moje linki: lista, pusty stan, usuwanie, kreator Nazwa -> Narzędzia -> Gotowe z konfiguracją Claude Code / Copilot / Codex, 409, konfiguracja istniejącego linku (08-12, 14, 27) | zrobiony (ten sam commit co K1, bo powłoka, trasy i warstwa mocków są wspólne) |
| K3 | Stany ogólne z `requestId` (24), e2e na mockach, axe, zrzuty 1280 i 360 px, README, STATUS | zrobiony |

Poza M2 (nie ma w kodzie): potwierdzenia akcji i rejestracja Authenticatora (3.0.0, M3), logi z filtrami (M3),
wnioski (ekran, M4), administracja (M4), zawężenie zasobów (uśpione, CC-085).

## Weryfikacja (2026-10-28, Node 24.18.0, npm 11.16.0)

```
npm ci                 OK (czysty node_modules, paczka 2.2.3 z release/)
npm test               Test Files 17 passed (17), Tests 149 passed (149)
npm run lint           All files pass linting.
npm run build          OK (bez MSW w bundlu)
npm run e2e            88 passed, 2 skipped (zrzuty: tylko z SHOTS_DIR); Chromium, projekty desktop 1280 px i mobile-360
npm run i18n:check     bez różnic (252 komunikaty)
```

Zrzuty ekranów (1280 i 360 px, nazwy z numerem makiety): `<scratchpad>/m2-web-shots/`
(52 pliki; generuje je `e2e/screenshots.spec.ts` przy ustawionym `SHOTS_DIR`).

## Co działa z kryterium M2 (zakres web, na mockach)

- Logowanie przez BFF (`/api/v1/auth/login`), błędy `/?loginError=<kod>` z zamkniętej listy (cancelled, idp_error,
  session_expired, step_up_failed), wylogowanie, wygasła sesja.
- Katalog: sześć statusów, tekst stanu (wygasający token: "Token wygasa za 5 dni" z `connection.expiresAt`),
  przyciski z `actions[]` wg tabeli CC-083, rozwijane wiersze z narzędziami (identyfikator czcionką stałą, tytuł,
  uprawnienie, ryzyko Odczyt/Zapis/Usuwanie, "Wymaga kodu z Authenticatora", "Wyłączone przez administratora"),
  szukanie po serwerze i narzędziu, kopiowanie linku, "Połącz przez OAuth" (przekierowanie na `authorizeUrl`),
  "Złóż wniosek" jest ukryte w M2 (patrz runda poprawek): wnioski wracają w M4.
- Połączenia z systemami: jeden wiersz na system z jednego odczytu katalogu (CC-080): sposób, konto, ważne do,
  ostatnie użycie, Odnów / Połącz / Dodaj token / Rozłącz (dialog).
- Dodaj PAT: `type="password"`, `autocomplete="off"`, pole czyszczone przy każdym wysłaniu, bez MFA (CC-090),
  data opcjonalna (bez walidacji zakresu, CC-084), zdanie "Oznaczymy token jako wygasający 7 dni przed terminem."
  tylko przy podanej dacie, `secret_invalid` pod polem, po zapisie "Połączono z <system> jako <backendUser>"; token poza `localStorage`,
  `sessionStorage`, ciasteczkami i DOM (test e2e).
- Powrót z OAuth: `?connected=` i `?connectError=` (flow_invalid, provider_error, cancelled),
  komunikat z nazwą systemu i kontem, parametry znikają z adresu, sukces znika po 10 s.
- Moje linki: lista, pusty stan, usuwanie z dialogiem, kreator 3-krokowy (slug z nazwy, lokalna kontrola własnych
  linków, 409 wraca do kroku 1, narzędzia zablokowane z przyczyną i akcją, bez `resourceDefaults`), URL i
  konfiguracje klientów z kopiowaniem, ekran konfiguracji istniejącego linku.
- Stany ogólne: ładowanie (szkielet), 503 z "Identyfikator do zgłoszenia" (8 znaków `requestId`), 404, 403, pusta
  lista.
- Router nie ma tras `/api`, `/s/`, `/v/`, `/.well-known/` (test).
- Dostępność: axe WCAG 2.1 AA (ciemny i jasny; 1280, 360, 320 px), klawiatura, brak przewijania poziomego, nazwy
  zakładek nieucięte na 360 px.

## Runda poprawek M2 (2026-10-28)

Kontrakty 2.2.3, klient API wygenerowany ponownie. `npm test`: 149 testów, e2e: 88 przeszło, 2 pominięte.

| Znalezisko | Status |
| --- | --- |
| M1 "Złóż wniosek" bez operacji w BFF | poprawione: `request_access` poza `SUPPORTED_ACTIONS` jak `view_request`; w katalogu, połączeniach i kreatorze nie ma przycisku (kreator pokazuje samo "Brak uprawnienia"). Przepływ zostaje w `ConnectionActions`, włączenie to jedna linia w `catalog-actions.ts`. Testy: katalog, połączenia, kreator, e2e |
| M2 wniosek z kreatora o uprawnienie innego narzędzia | poprawione: `requestAccess(server, tool)` używa uprawnienia klikniętego narzędzia (`entitlementToRequest`), test z dwoma odmowionymi narzędziami (`connection-actions.service.spec.ts`); w kreatorze działa po włączeniu akcji w M4. Przy wierszu serwera (katalog) bez narzędzia nadal pierwsze odmowione: do rozstrzygnięcia w M4 (wybór uprawnienia przed wysłaniem) |
| L1 narzędzie zablokowane po `access_denied` zostaje zaznaczone | poprawione: `selectedNames` pomija narzędzia z blokadą; test z przeładowaniem katalogu |
| L2 nazwa z samych spacji | poprawione: `nonBlankValidator` na polu nazwy; test |
| L3 komunikat sukcesu z samego `?connected=` | poprawione: tekst "Połączono z <system> jako <backendUser>" tylko gdy katalog pokazuje wiersz `connected`/`expiring` z kontem; inaczej brak komunikatu; test |
| L4 różne reguły http web i BFF | poprawione po obu stronach: http tylko dla loopback (`localhost`, `127.0.0.1`, `[::1]`); mock GitLaba z mcp-platform-dev stoi na `http://localhost:18741`, więc dev działa. BFF: `OAuthConnectTest` |
| L5 nieznany `loginError`, mock `connectError` | poprawione: `readLoginError` wyeksportowane i przetestowane (`session.service.spec.ts`), mock MSW kończy nieznany przepływ na `/?connectError=flow_invalid` jak BFF (test w `portal-mock.spec.ts`) |
| Decyzja: bez sprawdzania tożsamości (2.2.3) | usunięte: komunikat przy tokenie, ekran 22 `identity_mismatch`, mock `other-user`, tekst w `error-messages.ts` i `oauth-return.ts`; obcy `identity_mismatch` traktowany jak nieznany kod (`invalid_request` / `provider_error`). "Połączono z <system> jako <backendUser>" po zapisie tokenu, po OAuth i kolumna "Konto w systemie" w Połączeniach (była) |
| e2e mobile-360 `/catalog` (niestabilne także na kodzie sprzed zmian: AbortError z `getAnimations().finished`, zawieszona pętla rozwijania wierszy) | helper a11y czeka tylko na skończone animacje, z limitem 2 s, a rozwijanie wierszy potwierdza każdy klik; 3 przebiegi z rzędu 88/88 |
| Gateway po M2 (8dc1d7a): limit 50 linków daje 400 `invalid_request` | kreator pokazuje przy 400 `invalid_request` na utworzeniu wskazówkę o limicie 50 linków obok `requestId` (bez zgadywania po treści); test |

## Scenariusz na żywym stosie M2 (2026-10-28)

Osobny projekt Playwright bez MSW: `playwright.live.config.ts`, `e2e-live/scenario.spec.ts` (nie wchodzi do
`npm run e2e`). Uruchomienie: `LIVE_ALICE_PASSWORD=<hasło z make users> LIVE_SHOTS_DIR=<katalog> npx playwright test -c playwright.live.config.ts`.
Baza: `http://localhost:18740` (`LIVE_BASE_URL`). Przechodzi: logowanie Keycloak (alice), katalog z 5 systemami,
rozłączenie i ponowny zapis PAT Jiry (`alice-pat`, "Połączono z Jira jako alice"), OAuth GitLab z odmową
(`cancelled`) i powodzeniem, kreator Nazwa -> Narzędzia -> Gotowe z komendą Claude Code, usunięcie linku,
rozłączenie GitLaba, wylogowanie. Sprawdza też: brak błędów konsoli i naruszeń CSP, brak odpowiedzi API >= 400
(poza anonimowym `/api/v1/me` -> 401 na ekranie logowania), ciasteczka portalu tylko `__Host-*`, brak tokenów w
storage i w DOM.

Ustalenia: ze statusem `connected` katalog nie oferuje ponownego zapisu PAT (akcje `copy_link`, `disconnect`), więc
scenariusz najpierw rozłącza Jirę w Połączeniach i zapisuje PAT od nowa (stan końcowy: Jira połączona). OpenSearch
jest `not_connected` bez akcji (token-exchange w brokerze jeszcze nie istnieje, wg docs/m2.md). Poprawka w web:
na 360 px drugi przycisk w wierszu serwera był przesunięty o 8 px (flex + gap w `catalog-table.scss`); proxy
serwuje starszy build, więc zrzuty sprzed poprawki.

## Różnice względem makiet

1. Przełącznik "Tryb ciemny" w nagłówku (makiety są tylko ciemne; domyślnie ciemny, jasny opcjonalnie).
2. Zakładki: tylko Serwery MCP, Połączenia z systemami, Moje linki. Wnioski, Logi audytowe i Administracja dojdą z
   M3/M4. Na ekranie 02 nie ma przycisku "Złóż wniosek" (prowadziłby do ekranu Wnioski).
3. Formularz PAT (04, 05) to osobna strona `/connect/<system>` w formie karty, nie okno modalne nad tabelą; ma
   rozwijaną instrukcję tworzenia wąskiego tokenu (wymóg briefu) i, gdy system oferuje OAuth, sekcję OAuth.
4. Kreator: krok "Narzędzia" kończy się przyciskiem "Utwórz link" (zamiast "Dalej", bo nie ma kroku Zawężenie),
   numeracja 1. Nazwa, 2. Narzędzia, 3. Gotowe.
5. Dane: z przykładu `states` kontraktu (Jira = wygasający token PAT, GitLab = wymaga ponownego połączenia,
   Confluence = brak uprawnień, Service Desk = konto serwisowe, OpenSearch = wymiana tokenu), użytkownik "Jan
   Kowalski" z przykładu `me`; jest 5 systemów, bez SonarQube. Przykład `mixed` pod `?mockScenario=mixed`.
   Do Jiry i GitLaba dodałem kilka narzędzi w warstwie mocków, żeby lista wyglądała jak w makiecie.
6. Wiersz `expiring` w katalogu ma obok "Odnów" także "Kopiuj link" (tabela CC-083 daje oba); katalog nie ma
   "Rozłącz" (jest w Połączeniach, jak w makiecie).
7. Połączenia (03) są liczone z katalogu, więc pokazują też systemy bez połączenia; kolumna "Ważne do" ma datę
   dd.mm.rrrr i "za N dni" dla wygasającego.
8. Cudzysłowy proste (`"Code review"`) zamiast typograficznych; strzałka "<-" w linku powrotu rysowana jako
   `&larr;`.
9. Pole wyboru narzędzia to Material (MatCheckbox), obwódka pól formularza ciemniejsza o jeden ton niż w
   makiecie (kontrast 3:1 dla granicy kontrolki).
10. Na 360 px zakładki zawijają się do drugiej linii zamiast przewijać (nazwy nie są ucinane, wymóg z poprawek);
    w katalogu znikają kolumny Logowanie i Narzędzia (jak w makiecie 26).
11. Ekran logowania ma mniejszy odstęp pionowy (treść wyśrodkowana w ok. 60% wysokości), bez ramki.
12. "Sesja wygasła" (24) to ekran logowania z tym komunikatem, a nie osobna karta w treści strony.

## Odstępstwa i decyzje

- Zmiany kontraktu 2.2.1 zastosowane (obowiązują też w 2.2.3): pola z `default` opcjonalne (`disabled`, `requiresConfirmation`, `enabled`),
  `credential` i `connection` w katalogu, `title` narzędzia, `ConnectErrorCode` z `cancelled`, `X-Request-Id`
  i `Error.requestId`, brak `step_up_required` w `putMySecret`, brak `expires_at_invalid`.
- Ciasteczko CSRF: kontrakt mówi `__Host-XSRF-TOKEN`, BFF (ws-07) w M1 ustawia `XSRF-TOKEN`. Interceptor
  (`core/xsrf.interceptor.ts`) czyta pierwszą nazwę, a gdy jej nie ma, drugą, więc działa z oboma. Wbudowany
  mechanizm Angulara (jedna nazwa) wyłączony.
- Powrót z OAuth po błędzie nie niesie nazwy systemu (kontrakt: tylko `connectError=<kod>`), więc frontend
  wysyła `returnPath=/catalog?system=<system>` (BFF dopisuje swoje parametry po `&`), co pozwala napisać
  "GitLab nie odpowiedział poprawnie". Wartość `system` jest sprawdzana względem listy systemów.
- `reconnect` na połączeniu OAuth idzie od razu do dostawcy; z tokenem (`add_secret` przy istniejącym połączeniu
  albo `reconnect` na tokenie) otwiera formularz. Przy istniejącym połączeniu `add_secret` ma etykietę "Odnów".
- Kreator blokuje narzędzia systemów w stanie `not_connected` i `reconnect_required` (makieta 12: "Konto
  niepołączone · Połącz"), choć kontrakt tego w POST nie odrzuca: do potwierdzenia, czy to zamierzona reguła.
- `autocomplete="off"` na polu tokenu i formularzu (wymóg M2) zamiast `new-password` z M1; zostają atrybuty
  `data-1p-ignore`, `data-lpignore`, `data-bwignore`, `data-form-type`. Przeglądarki mogą ignorować `off` dla
  `type="password"`; token i tak jest czyszczony po wysłaniu i nie ma pola loginu. Do ręcznej weryfikacji w
  Chrome, Edge, Firefox z menedżerem haseł.
- Klient API jest generowany z poprawką: generator 7.26.0 zapisuje `Null` zamiast `null` w unii z `oneOf`;
  skrypt `generate:api` zamienia to `perl`em (bez tego `tsc` nie przechodzi).
- Port dev: `ng serve` na 18730, serwer e2e na 18731 (zakres ws-08: 18730-18739).
- `node_modules` w katalogu miał podkatalog `@aiwcorpo` należący do roota, więc `npm install` nie mógł go
  podmienić; stary katalog przeniosłem poza repo (scratchpad) i zainstalowałem od zera.
- Kod nieużywany w M2, a potrzebny w M3: `stepUpUrlFor` w `core/auth-urls.ts` (potwierdzenia, wymagają step-up
  przy GET, CC-034).

## Czego potrzebuję od innych strumieni

- ws-07 (BFF): nazwa ciasteczka CSRF (kontrakt `__Host-XSRF-TOKEN`); `Set-Cookie` najpóźniej przy `GET /me`;
  `requestId` w ciele błędów i `X-Request-Id` na każdej odpowiedzi (frontend pokazuje 8 znaków); przyjęcie
  `returnPath` z zapytaniem (`/catalog?system=gitlab`) i doklejanie `&connected=`/`&connectError=`; `__CSP_NONCE__`
  w `index.html` (jak w README).
- ws-01 / proxy: trasy jak w CC-089 (`/` web, `/api` BFF); po M2 backendu ten sam zestaw Playwright z `baseURL` na
  BFF (obecny zestaw używa MSW w przeglądarce, więc wymaga osobnego projektu bez mocków).
- ws-00: decyzja o regule kreatora (narzędzia systemów bez połączenia) i o tekstach "Przypomnimy o odnowieniu" (nie
  ma ich w M2; zostało "Oznaczymy token jako wygasający 7 dni przed terminem").

## Domknięcie M2: contracts 2.2.5 (2026-10-28)

Kontrakty 2.2.5 (tarball w `package.json`, klient wygenerowany ponownie).

- CC-119: `409 virtual_server_limit_reached` w kreatorze: komunikat "Osiągnięto limit linków. Usuń nieużywany link." z
  odnośnikiem "Przejdź do listy linków" (`/links`), kreator zostaje na kroku narzędzi z zachowanym wyborem. Dawna
  wskazówka dla `400` usunięta: od 2.2.5 limit ma własny kod. MSW odpowiada limitem od 50 linków (`LINK_LIMIT`).
- Komenda Claude Code jest pokazywana tak, jak przyszła z BFF (`clientConfigs.claudeCode`), także z `--client-id` i
  `--callback-port`; mock MSW ma kształt komendy z dev BFF.
- CC-111: `system` w przekierowaniu po błędzie OAuth pochodzi wyłącznie z BFF (`connectError=<kod>&system=<system>`).
  Web nie dokleja już `system` do `returnPath` (był duplikat); mock MSW odwzorowuje kształt BFF.

## Propozycje CC

1. (zamknięta, CC-111 w 2.2.4) `system=<system>` w przekierowaniu po błędzie OAuth.
2. `PutSecretRequest`: nadal brak formatu dla poświadczenia Basic (jak w propozycji z M1); formularz obsługuje jeden
   token.
3. `CatalogTool.title` jest opcjonalne i w przykładach prawie nigdy nie ma go poza Jirą; opis (`description`) bywa
   angielski. UI pokazuje `title`, a bez niego `description`. Do rozważenia: wymagać `title` w manifeście.

## Otwarte pytania

1. CSP: czy BFF przyjmuje podmianę `__CSP_NONCE__` w `index.html` na każdą odpowiedź (opis w README)?
2. Dev: redirect URI Keycloak wskazuje na :18090, więc po logowaniu z `ng serve` trzeba wrócić ręcznie na
   :18730. Jeśli to przeszkadza, BFF mógłby mieć w profilu dev konfigurowalny adres frontendu dla `returnPath`.
3. Czy "Wnioski" i "Logi audytowe" mają być w nawigacji już w M2 jako zablokowane pozycje? Obecnie ich nie ma.

## Zostało (M3 i dalej)

- Potwierdzenia akcji z kodem z Authenticatora (podgląd `/confirm/<id>`, rejestracja, baner "Zarejestruj
  Authenticator", wersje 360 px) po wydaniu kontraktów 3.0.0.
- Logi audytowe z filtrami (szukaj, okres, wynik, "Pokaż więcej").
- Wnioski (lista, złożenie, `view_request` w katalogu).
- Administracja (rejestr, różnice definicji, zatwierdzanie).
