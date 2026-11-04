# STATUS: mcp-portal/web (ws-08)

M6 (etap 3): osiągnięty (2026-11-03) - kontrakty 6.2.0, wyłącznik awaryjny, dialog klasyfikacji narzędzi adaptera, stan `error` połączenia, wznawianie po MFA dla wyłącznika i klasyfikacji. Obraz `mcp-portal-web:m6-e72ccbf` (bez wdrażania). Szczegóły w sekcji "M6: stan".

M5: osiągnięty (2026-10-31) - kontrakty 5.1.0, adres `/mcp` z kreatorem bez zapisu, kolumna filtra w aktywności, wznawianie akcji po MFA (U12), `ci/run.sh`. Dowód: `ci/run.sh --container` w obrazie Playwright 1.64.1 (lokalny Docker) `ci: OK`; przebieg na runnerze systemu CI (nakładki ws-07 w korzeniu) jeszcze nie wykonany.

## Język UI: angielski źródłowy, polski jako tłumaczenie (2026-11-04)

Obrazy `mcp-portal-bff`, `mcp-portal-web`, `mcp-portal:m6-cb8ed65` (bez wdrażania; w `web` i `portal` jest `i18n/messages.pl.json`).
`npm test`: 30 plików, 544 testy; `ci/run.sh`: `ci: OK`, e2e 206 przeszło, 28 pominiętych (zrzuty); `bff make ci`: `ci: OK`, 525 testów.
- Mechanizm: jedna kompilacja, tłumaczenia w czasie działania. `src/main.ts` woła `initLocale()` (`core/locale.ts`): zapisany wybór
  (`localStorage`, klucz `mcp-portal-locale`), potem `navigator.languages` (`pl` albo `en`), domyślnie angielski. Dla `pl` pobiera
  `/i18n/messages.pl.json`, rejestruje je przez `loadTranslations`, ładuje dane lokalne `pl` (data pipe) i ustawia `$localize.locale`
  oraz `<html lang>`; dopiero potem `import()` modułów aplikacji (`$localize` liczy się przy wczytaniu modułu). Nieudane pobranie
  zostawia angielski. Przełącznik (`shared/locale-switch.ts`) w nagłówku i na ekranie logowania zapisuje wybór i przeładowuje stronę.
- Dlaczego nie `--localize` (/en/, /pl/): wymagałoby zmian w BFF (`SpaFallbackFilter`, nonce, ścieżki) i w nginx; tu BFF, nginx i CSP
  bez zmian (`i18n/messages.pl.json` to zwykły plik statyczny, `connect-src 'self'`). Cena: przeładowanie strony przy zmianie języka.
- `messages.xlf` (en, źródło), `messages.pl.xlf` (579 tekstów, polskie z poprzedniego źródła). `scripts/i18n.mjs json` (przed `build`,
  `start`) robi z niego `public/i18n/messages.pl.json` (poza gitem); `i18n:check` = zgodność `messages.xlf` z kodem + każdy tekst
  przetłumaczony + te same znaczniki i interpolacje.
- Teksty z kontraktu i BFF (kody błędów, opisy serwerów, dane mocków) bez zmian; komunikaty mapowane z kodów są w obu językach.
- e2e po angielsku (`locale: 'en-US'`), po polsku `e2e/polish.spec.ts` (3 testy, m.in. brak błędów w konsoli: wcześniej brakujące dane
  `pl` dla date pipe dawały `NG02100`). `PW_PORT` zmienia port serwera Playwrighta (porty 18744/18745 zajmuje Docker stosu).
- Zrzuty: `docs/screenshots/en/` i `pl/`, 26 plików o angielskich nazwach, `npm run screenshots`. README portalu po angielsku.
- CI: `ci.yml` tylko `style` (`contents: read`, bez tokenu, `actions/checkout` przypięty do SHA v4.2.2, `persist-credentials: false`);
  build i testy wrócą do GitHub Actions po wydaniu kontraktów w npmjs i Maven Central. Bez GitHub Packages w `.npmrc`,
  `contracts.sh` i dokumentach. `release.yml`: bez `packages: read` i tokenów odczytu, więc do wydania kontraktów nie pobierze artefaktów
  (wydanie obrazów robi `scripts/build-images.sh`).
- Do zrobienia: `web/README.md` i `bff/README.md` zostały po polsku (poza sekcją i18n); `index.html` ma opis (`meta description`)
  tylko po angielsku.

## Porządki do wydania: zrzuty i session.spec (2026-11-04)

- Zrzuty README: `e2e/readme-shots.spec.ts` robi 26 obrazów (9 dotychczasowych ponownie, w jasnym motywie, jak wymaga `screenshots-needed.md`, i 17 nowych,
  pozycje 1 do 11 listy), wszystkie z mocka, bez stosu i bez kont. Nowy mock `JIRA_CONFIRMATION_ID` (`jira__delete_issue`, ABC-1182) dla podglądu operacji.
  Klucz na zrzucie rejestracji to wymyślone ziarno mocka. Pozycje 12 do 15 listy (Claude Code, Claude Desktop, rysunek) nie są zrzutami portalu.
- `session.spec.ts` "log out and log in again": test klikał "Zaloguj" po tekście "Wylogowano.", zanim `logout()` skończył `navigateByUrl('/')`.
  Wtedy `router.url` wciąż było `/connections`, więc powrót po logowaniu kończył na połączeniach, nie w katalogu. Pod obciążeniem (24 workery i 12 pętli
  zajmujących CPU) 3 z 80 przebiegów padły przed poprawką. Poprawka w teście: czeka na URL `/catalog` przed kliknięciem. Kod produktu bez zmian
  (powrót na stronę, z której wylogowano, nie jest błędem bezpieczeństwa).

## M6: kontrakty 6.3.2 (2026-11-03)

Paczka `aiwcorpo-mcp-contracts-6.3.2.tgz` zrobiona `npm pack` z checkoutu `mcp-contracts` na `v6.3.2` do `web/.contracts/` (sha256 1811f148..., identyczny z plikiem
wydania), klient i mocki z niej. `npm test`: 539 testów; `npm run e2e`: 198 przeszło, 12 pominiętych. Zmiany:
- Formularz tokenu: pole loginu przy `CatalogCredential.userSecretScheme === 'Basic'` (tekst, bez `:` i znaków ukrytych, do 255 znaków, obcinany); login
  wychodzi w `PUT .../secret`, nigdy nie jest wyświetlany po odpowiedzi. Mock: `?mockBasic=in` (Jira), 400 gdy login nie pasuje do schematu.
- Dialog klasyfikacji: tylko Odczyt i `read` (adapter jest tylko do odczytu, CC-227); mock odpowiada `422 classification_not_allowed` na inne.
- Wpis adaptera z unieważnioną klasyfikacją (`riskLowered` bez `approvedEntry`): ponowna klasyfikacja to obniżenie, `acceptRiskLowering`, dialog, świeże MFA,
  wznowienie po powrocie (mock: narzędzie `link_issues`).
- 503 katalogu: ogólny komunikat z ponowieniem (istniejący).
- Obraz `mcp-portal-web:m6-9a9a80d`. Zrzut 09 w README (formularz z loginem).

- Przegląd migracji 6.3.2: `422 risk_lowered` przy `approve` wpisu adaptera (gateway bez flagi `riskLowered`) jest traktowane jak obniżenie: dialog obniżenia, `acceptRiskLowering`, świeże MFA i wznowienie (U12); mock `merge_issues` jest nieoflagowany. `classification_not_allowed` ma jeden tekst o tym, że adapter przyjmuje tylko Odczyt (`read`). Test jednostkowy i e2e.

## M6: stan

Liczby: `npm test` 29 plików, 535 testów; `npm run e2e` 194 przeszły, 12 pominiętych (zrzuty, tylko z `SHOTS_DIR` albo `README_SHOTS_DIR`); `ci/run.sh` bez kroku kontenerowego: OK.

- Dane mocka i testy formularza z loginem (`Basic`) mówią o Jira Data Center (`deployment: dc`), nie o Cloud; logika bez zmian. Obraz bez zmian.
- Kontrakty 6.2.0: paczka npm w `web/.contracts/` (poza gitem), `scripts/contracts.sh` (plik, adres z sumą, checkout na tagu z `npm pack`, GitHub Packages
  przez `NODE_AUTH_TOKEN`). `npm pack` z rozpakowanej paczki daje identyczne bajty (sha256 `3e244f22...`), więc checkout na tagu `v6.2.0` odtwarza tę samą paczkę.
  Przejście na rejestr: wpis `"6.2.0"` w `package.json` i `~/.npmrc` z tokenem (README, "Paczka kontraktów"). Klient API wygenerowany ponownie.
- Wyłącznik awaryjny: `/admin/kill-switches` (lista włączonych, włączenie serwera lub narzędzia z powodem do 200 znaków i potwierdzeniem, zdjęcie z
  potwierdzeniem i świeżym MFA); rejestr pokazuje "Wyłączony awaryjnie" i link do ekranu; katalog mówi "Wyłączone awaryjnie przez administratora" dla `disabledBy: kill_switch`.
  Nie ma makiety tego ekranu (makiety w `design/` go nie mają); układ jest wzorowany na "Administracji" (makieta 07).
- Klasyfikacja (CC-193, CC-207): dialog z ryzykiem (Odczyt, Zapis, Usuwanie) i akcją ograniczoną do par, które przyjmuje gateway; nic nie jest
  zaznaczone z góry, podpowiedzi z `annotations` i poprzednia klasyfikacja są tylko tekstem (`neutraliseText`); `422 classification_*` otwiera
  dialog ponownie z wyborem i komunikatem. Klasyfikacja niższa niż dotychczasowa to obniżenie (dialog, MFA, `acceptRiskLowering`).
- `RegistryTool.risk` i `.action` opcjonalne (także `ToolEntry` w wygenerowanych typach: generator gubi `required` z `allOf`, patrz CC-210).
- Stan `error` połączenia: wiersz katalogu "Połączenie przestało działać, połącz konto ponownie", wiersz połączeń "przestało działać, połącz konto ponownie",
  przycisk jak dla `reconnect_required` (OAuth: "Połącz", token: "Odnów").
- Przegląd M6 e3: intencja zdjęcia niesie `setAt` widzianego wyłącznika; wyłącznik zdjęty i włączony od nowa w czasie MFA nie jest zdejmowany, strona to mówi.
- U12: `ResumeIntentStore` zna `lift-kill-switch` i `approve-tool` z klasyfikacją; po `?mfa=ok` wyłącznik jest zdejmowany tylko wtedy, gdy nadal działa, a
  zatwierdzenie z klasyfikacją tylko dla tego samego skrótu. Test: drugi `step_up_required` po powrocie to błąd, nie pętla.
- Mock: `?mockAdapter=in` (trzy narzędzia adaptera: nowe, nowe z mylącą adnotacją `readOnlyHint: true`, sklasyfikowane i zmienione), `?mockSecretMissing=in`,
  stanowe wyłączniki.
- Teksty: `src/locale/messages.xlf` wyekstrahowany.
- Zrzuty do README: `npm run screenshots` (`e2e/readme-shots.spec.ts`, 8 zrzutów 1280 px w `../docs/screenshots`, dane z mocków).

## Kamienie M5

| Kamień | Zakres | Stan |
| --- | --- | --- |
| K1 | Kontrakty 5.1.0 (paczka `release/aiwcorpo-mcp-contracts-5.1.0.tgz`), klient wygenerowany ponownie; mock stanowy `getMcpEndpoint` z parserem filtra z kontraktu; lista "Moje linki", API linków, `slug`, scenariusz `nolinks` usunięte | zrobiony |
| K2 | Strona `/endpoint` ("Adres MCP"): adres `<publicBaseUrl>/mcp` domyślnie, filtr (systemy, rodzaj narzędzi, narzędzia "tylko zaznaczone" albo "wszystkie oprócz"), licznik bajtów query, ostrzeżenie o rozmiarze listy, krótkie ostrzeżenie o prompt injection; aktywność: kolumna "Filtr", etykieta `denied_filter_scope`; `/mcp` zarezerwowane w `ReturnPath` | zrobiony |
| K3 | U12: po step-up MFA akcja wznawia się bez drugiego kliknięcia; `ci/run.sh`, `make ci`, `ci/Dockerfile` | zrobiony |

## M5: stan

Liczby: `npm test` 27 plików, 497 testów (m.in. wektory `endpoint-filter/`, `mcp-endpoint/` i `return-paths/` z kontraktów); `npm run e2e` 174 przeszły, 8 pominiętych (zrzuty, tylko z `SHOTS_DIR`), desktop 1280 px i mobile-360, axe AA ciemny i jasny; `npm run lint`, `npm run i18n:check` czyste. `ci/run.sh` lokalnie i `ci/run.sh --container` (obraz `mcr.microsoft.com/playwright:v1.64.1-noble`, źródła tylko `web/` i paczka kontraktów, oba tylko do odczytu): `ci: OK`, 497 testów jednostkowych, 174 e2e. Pod dużym obciążeniem hosta (load ok. 20) pierwsze testy plików przekraczały 5 s, stąd `testTimeout` 20 s w `useMockApi` i `PW_WORKERS=4` w kontenerze. `confirm.spec` (odliczanie) bywa niestabilny pod obciążeniem i przechodzi na powtórzeniu (CI=1 daje 1 powtórzenie).

- Kreator (CC-175, CC-182, CC-185): jedna strona, nic nie jest zapisywane. Filtr składa `composeFilter` (port `scripts/lib/endpoint-filter.mjs`, test na wszystkich wektorach `parse-*` i `apply-*`). Licznik "Filtr w adresie: N z 512 bajtów"; gdy wybór nie mieści się (512 B, 5 systemów, 100 wpisów), zapytanie do BFF nie jest wysyłane, widać powód i podpowiedź (systemy i wykluczenia). Parametry idą jako typowane wartości `getMcpEndpoint`; odpowiedź `400 invalid_filter` ma własny komunikat (bez tekstu z BFF). Wykluczenie całego systemu wyraża się wyborem `systems` (osobnego wykluczania systemu w UI nie ma).
- Próg ostrzeżenia o rozmiarze listy: nieustalony (czeka na pomiar kosztu tokenów w teście obciążeniowym), więc konfigurowalny: `<meta name="mcp-tool-list-warning" content="N">` w `index.html`, domyślnie 50 (`core/tool-list-warning.ts`). Powyżej 100 narzędzi dodatkowa uwaga o `nextCursor` (CC-181).
- Stare zakładki `/links`, `/links/new`, `/links/<slug>` przekierowują na `/endpoint`.
- Aktywność: kolumna "Filtr" (znormalizowany filtr adresu albo "bez filtra"), `denied_filter_scope` = "Odmowa (poza filtrem adresu)" w grupie "Odmowy" z wyjaśnieniem; stary `denied_link_scope` byłby "Inny wynik" (mapowanie przy odczycie robi gateway/BFF).
- U12: `ResumeIntentStore` (sessionStorage karty, jeden wpis, 5 minut, tylko identyfikatory, związany z `username` użytkownika, czyszczony przy wylogowaniu, wygaśnięciu sesji i `loginError`; usunięcie Authenticatora tylko dla tej samej rejestracji `registeredAt`). Zatwierdzenie definicji wznawia się tylko, gdy skrót po powrocie jest ten sam, który administrator widział (inaczej komunikat i nic nie zatwierdzone); start rejestracji Authenticatora i usunięcie Authenticatora (po ostrzeżeniu zatwierdzonym przed MFA) wykonują się same. Samo `?mfa=ok` bez wpisu nic nie uruchamia, drugi `step_up_required` po powrocie to błąd, nie pętla. Formularza z tokenem nie wznawiam: sekretu nie wolno zapisać. Zmiana względem M3: usunięcie Authenticatora nie wymaga już ponownego kliknięcia, a wpis pochodzi z kliknięcia użytkownika, nie z adresu.
- `stepUpUrlFor` nadal podmienia `returnPath` (portal dodaje `?mfa=ok`), komentarz poprawiony zgodnie z BFF (Referer).

Obraz: `mcp-portal-web:m5-<sha>` (budowa jak w M3/M4, bez wdrażania; stos dev zostaje na M4).

## Propozycje CC

- Bez nowych względem M4 (blok `credential` w `PendingTool` nadal otwarty, patrz niżej).

## Stan z M4

Stan na 2026-10-29 (M4 zrobiony). Kontrakty: `mcp-contracts` 4.0.0 (paczka `release/aiwcorpo-mcp-contracts-4.0.0.tgz`, klient wygenerowany ponownie z `portal-bff.v1.bundled.yaml` 4.0.0, zero ręcznych typów API). Angular 22.2.3 / CLI 22.2.4, Angular Material 22.2.4 (wersje z `package.json`).
Wzorzec wyglądu: makiety człowieka w `mcp-platform-plan/design/` (README.md, `ekrany-authenticator-i-poprawki.txt`).

## Kamienie M4

| Kamień | Zakres | Stan |
| --- | --- | --- |
| K2 | Kontrakty 4.0.0 i regeneracja klienta; wnioski IGA: zakładka "Wnioski" (lista ze statusem i `decidedAt`), "Złóż wniosek" przy narzędziu i przy wierszu serwera (wybór uprawnienia z `GET /access-requests/entitlements`, opis z IGA jako niezaufany tekst), "Zobacz wniosek" także przy `connected`, tabela akcji CC-113, 503/422 `not_requestable`/idempotencja; Service Desk i OpenSearch bez przycisków podpinania; "ostatnie użycie" konta serwisowego wg B13; mock MSW 4.0.0 (wnioski, tryby IGA) | zrobiony |
| K3 | Administracja rejestru (lazy route, `isAdmin`): narzędzia `pending_approval`, diff definicji (każdy liść schematu, opis, ryzyko, zasoby), źródło CI/serwer z ostrzeżeniem i dodatkowym potwierdzeniem dla serwera, "Zatwierdź" z 409 (odświeżenie różnic) i 422 `manifest_rejected`/`risk_lowered` | zrobiony |
| K4 | Limity: "Zbyt wiele wywołań" w aktywności, grupy filtra `result` wg B4 (mock), 429 z `Retry-After` (token, Authenticator, start OAuth); a11y, e2e, README, obraz | zrobiony |

## M4: stan

Wnioski: zakładka `/requests` (lista od najnowszych, status i data rozpatrzenia, "Otwórz w systemie uprawnień" tylko dla https), dialog "Złóż wniosek" (system -> uprawnienie z `GET /access-requests/entitlements`, opis z IGA jako tekst z markerami `[U+XXXX]`), "Złóż wniosek" przy zablokowanym narzędziu (tylko gdy serwer ma `request_access`), "Zobacz wniosek" także przy `connected`; powtórzony wniosek o to samo uprawnienie daje ten sam `requestId` (komunikat neutralny: "jest w systemie uprawnień"). Systemy z kontem serwisowym i wymianą tokenu nie dostają przycisków podpinania nawet przy błędnej odpowiedzi BFF. "Ostatnie użycie" konta serwisowego: tylko `ok`, `confirmed` i `error` poza `upstream_unavailable` (B13).
Administracja: `/admin` (lazy, `canMatch` + `isAdmin`), brak "Odrzuć". Teksty definicji przechodzą `neutraliseText`, który nie zmienia notacji `<U+XXXX>` z BFF.
Limity: "Zbyt wiele wywołań" dla `rate_limited` w aktywności; 429 z `Retry-After` pokazuje czas oczekiwania w formularzu tokenu, rejestracji Authenticatora i przy starcie OAuth.
Mock MSW 4.0.0: wnioski ze stanem (`mockIga`), rejestr z oczekującymi definicjami (`mockAdmin`), grupy `result` wg CC-142.

Różnice względem makiet: "Zatwierdź" jest per narzędzie (endpoint jest per narzędzie), nie "Zatwierdź zmiany" per serwer; dialog wniosku zaczyna od wyboru systemu.

## Kontrakty 4.1.0

Klient zregenerowany. Obniżenie ryzyka (CC-167): `riskLowered` z `PendingTool` i `RegistryTool` pokazane jako "Obniżenie ryzyka" (stare i nowe ryzyko, ostrzeżenie o znikającym kodzie z Authenticatora, ukryte przed agentami), przycisk "Zatwierdź obniżenie ryzyka" wysyła `acceptRiskLowering: true` tylko po potwierdzeniu w dialogu (zwykłe zatwierdzenie nie wysyła pola); `401 step_up_required` przekierowuje na MFA z powrotem na `/admin?mfa=ok` (drugi raz z rzędu to błąd, nie pętla), po powrocie zatwierdzenie trzeba powtórzyć. Aktywność wg CC-165: brak nowych etykiet, wyniki i grupy jak dotąd (`tool_disabled`, `rate_limited` w "Odmowy"); `request_access` nie jest proponowane na podstawie samego wyniku. Mock 4.1.0: `riskLowered`, 422 bez `acceptRiskLowering`, 401 bez świeżego MFA.

## Poprawki po przeglądzie M4 (kontrakty 4.0.1)

Kontrakty 4.0.1, klient po regeneracji bez zmian. M1: diff pokazuje też nazwę wpisu i nazwę z definicji; odpowiedź "pending" czytana jako tekst, a liczby porównywane tak, jak zapisano (`JSON.parse` z `context.source`, bez zaokrągleń powyżej 2^53); gdy skrót zatwierdzonego wpisu jest inny, a żadna linia się nie zmieniła, ekran ostrzega i wymaga jawnego potwierdzenia; niezgodność `pendingHash` z wpisem blokuje przycisk. LOW: linie diffu bez zawijania (przewijanie poziome, brak podrobionych linii), znaczniki łamań linii `[U+000A]` (nie do podrobienia, w przeciwieństwie do `<U+XXXX>` z BFF), serie znaków łączących ograniczone do dwóch, komunikat o ukrytych znakach tylko gdy były, `isAllowedRedirect` odrzuca dane logowania i fragment, blokada podwójnego kliknięcia w kreatorze, `safeText` dla identyfikatorów i wersji, przycisk wyłączony od razu przy obniżeniu ryzyka, h2 zamiast h3, martwy kod usunięty.
Świadomie nie zrobione: `http://localhost` zostaje dozwolone w buildzie produkcyjnym, bo obraz z buildu produkcyjnego obsługuje stos dev z mockami OAuth na http (ws-01); BFF i tak odrzuca takie adresy poza dev.

## Propozycje CC

- `PendingTool` powinien nosić blok `credential` (i `system`) serwera, które wchodzą do `definitionHash`, żeby diff mógł pokazać każdą zmianę objętą skrótem (przegląd M4, M1). Do czasu zmiany ekran tylko ostrzega o zmianie niewidocznej.

## Kamienie M3

| Kamień | Zakres | Stan |
| --- | --- | --- |
| K1 | Kontrakty 3.0.1, klient i mock (Authenticator, potwierdzenia, logi); Authenticator: status w Połączeniach (brak, aktywny, zablokowany, wyłączony z banerem), kreator rejestracji 4 kroki z QR rysowanym lokalnie, błędy rejestracji, usunięcie, baner w katalogu i kreatorze linków (23-30, m33, m36-m39) | zrobiony |
| K2 | Podgląd operacji `/confirm/<id>` (14, 15, m35): tylko odczyt, licznik, `viewed`, odpytywanie, "Anuluj operację", stany końcowe, argumenty jako niezaufany tekst | zrobiony |
| K3 | Zakładka Logi (06): filtry, "Pokaż więcej", etykiety wyników, błędne kody w szczegółach; "Ostatnie użycie" konta serwisowego z logów | zrobiony |
| K4 | a11y AA, 360 px, e2e na MSW 3.0.2, README i STATUS | zrobiony |
| K5 | Poprawki po przeglądzie Opus (M-1, L-1..L-9), patrz niżej | zrobiony |

## M3: stan (2026-10-28)

Kontrakty 3.0.2, klient wygenerowany ponownie (`npm run generate:api`), mock MSW rozszerzony o Authenticator,
podgląd potwierdzeń i logi (`src/mocks/m3-mock.ts`, TOTP z ziarna w `src/mocks/totp.ts`, sprawdzony na wektorach
RFC 6238). Usunięte: ekran decyzji i `identity_mismatch`, `confirmation_declined`.

```
npm test               Test Files 22 passed, Tests 294 passed
npm run lint           All files pass linting.
npm run i18n:check     bez różnic
npm run e2e            146 passed, 8 skipped (zrzuty: tylko z SHOTS_DIR); desktop 1280 px i mobile-360; axe AA ciemny i jasny
```

Zrzuty (poza repozytorium): katalog `SHOTS_DIR` z `e2e/screenshots.spec.ts` (kamień M3).
(`SHOTS_DIR=... npx playwright test e2e/screenshots.spec.ts` po `npm run build:e2e`). Obrazy: `mcp-portal-web:m3-<sha>`
(skrypt w scratchpadzie koordynatora: `build-web-image.sh`, buduje z `git archive HEAD`).

Co działa (zakres web, na mockach):
- Authenticator (23-30, m33, m36-m39): sekcja w Połączeniach (brak, aktywny, zablokowany do HH:MM, wyłączony po
  limicie dziennym z banerem i akcją "Zarejestruj ponownie"; bez odblokowania), kreator 4 kroków pod
  `/authenticator/register` (i alias `/authenticator`), QR rysowany lokalnie jako SVG (biblioteka `qrcode-generator`
  2.0.4; CSP blokuje obrazy `data:`), klucz i QR tylko w pamięci komponentu: czyszczone przy opuszczeniu kroku 2,
  po zakończeniu, po wygaśnięciu, przy zniszczeniu komponentu i przy `pagehide`; po odświeżeniu kroku 2 wraca krok 1.
  Klucza nie ma w URL, tytule, powiadomieniu, storage ani `history.state` (testy jednostkowe i e2e). Brak "pokaż
  ponownie". Step-up MFA: `401 step_up_required` -> przekierowanie z `returnPath=/authenticator/register?mfa=ok`,
  po powrocie przycisk "Kontynuuj rejestrację"; drugi `step_up_required` zaraz po powrocie to błąd, nie pętla. Usunięcie:
  ostrzeżenie, MFA, powrót na `/connections?mfa=ok` i ponowne kliknięcie "Usuń" (celowo bez automatycznego
  wykonania destrukcyjnej akcji z parametru adresu). Błędy: wygasła / 3 błędne kody (`enrollment_invalid`),
  `invalid_code`, `already_registered`, 429, 503.
- Baner "Zarejestruj Authenticator" w katalogu i w kroku narzędzi kreatora linków (warianty: brak, wyłączony,
  zablokowany); tylko gdy jest użyteczne narzędzie z `requiresConfirmation`. Nieczytelny status Authenticatora nie
  psuje katalogu (baner tylko podpowiada), a w Połączeniach daje błąd całej strony.
- Podgląd `/confirm/<id>` (14, 15, m35): tylko odczyt; system, narzędzie, zasób, argumenty posortowane po nazwie
  (także po stronie klienta), licznik, instrukcja "wpisz kod w sesji agenta", "Anuluj operację" (bez dialogu, bez
  MFA; 404 -> komunikat z linkiem do logów; 503 -> nic nie anulowane), `viewed` jawnym POST dopiero po
  wyrenderowaniu, gdy `document.visibilityState === 'visible'` i nie ma `prerendering`, ponawiany co poll przy błędzie
  (ostrzeżenie, że "pierwsza wygrywa" nie działa), odpytywanie co 5 s i po powrocie na kartę, 404 -> "Ten link jest
  nieaktualny.", po `expiresAt` "Czas minął." z "nie wpisuj kodu dla tej operacji". Bez nawigacji zakładkami (jak
  makieta 14). Wartości od agenta: tylko interpolacja tekstu, `dir="ltr"`, `unicode-bidi: isolate`, `white-space:
  pre-wrap`; znaki sterujące i bidi zamieniane na widoczne `[U+XXXX]`, a zapis `<U+XXXX>` z BFF też daje ostrzeżenie.
  Test e2e z U+202E sprawdza, że kolejność wyświetlana zgadza się z logiczną.
- Logi (06): filtry szukaj (debounce 300 ms, do 64 znaków), okres (24 h, 7 dni, 30 dni), grupa wyniku; "Pokaż
  więcej" po `X-Next-Cursor`; etykiety z kontraktu (w tym Anulowane, Zablokowane przez oczekującą, Unieważnione),
  nieznany wynik jako "Inny wynik" z surową wartością w szczegółach; szczegóły wiersza: liczba błędnych kodów,
  ryzyko, link, kod błędu, identyfikator żądania; odpowiedź na nieaktualny filtr jest ignorowana; błąd całej strony.
  "Ostatnie użycie" konta serwisowego w Połączeniach z najnowszego wywołania w logach (decyzja z 2026-10-28).
- Katalog i kreator: "Wymaga kodu z Authenticatora", "Wyłączone przez administratora" (ten sam tekst w obu).

## Poprawki po przeglądzie Opus (K5)

| Znalezisko | Poprawka |
| --- | --- |
| M-1 wygaśnięcie zegarem przeglądarki, `viewed` na stronie "Czas minął" | czas pozostały liczony względem zegara serwera (różnica z nagłówka `Date` odpowiedzi podglądu, odświeżana przy każdym odczycie); `viewed` nie idzie, gdy `expired()`; testy z przesuniętym zegarem (+130 s: strona nie wygasa i wysyła `viewed`; serwer mówi "po terminie": brak `viewed`) |
| L-2 `?mfa=ok` startował rejestrację | po powrocie z MFA krok 1 z komunikatem i przyciskiem "Kontynuuj rejestrację"; start tylko z kliknięcia (test: `enrollStarts` zostaje 0 do kliknięcia) |
| L-1 czyszczenie przy `pagehide` | `detectChanges()` synchronicznie w `pagehide` i `pageshow` z `persisted`; test jednostkowy bez czekania. Ograniczenie: e2e nie obejmuje prawdziwego bfcache, bo Playwright uruchamia Chromium z wyłączonym back-forward cache |
| L-3 zbiór znaków | `neutraliseText` wg CC-121 jak BFF (Cc, Cf, Zl, Zp, Co, Cn, Cs, selektory wariantów poza U+FE0F po emoji, wypełniacze), wektory `text-hygiene/argument-*` w teście (bez dwóch wektorów z niesparowanym surogatem, których nie da się wczytać jako JSON); też dla nazwy narzędzia, linku, kodu błędu i surowego wyniku w logach oraz nazwy narzędzia w podglądzie |
| L-4 podrobiony `[U+` | literalne `[U+` zapisywane jako `[U+005B]U+` (jak BFF dla `<U+`); zapis BFF `<U+XXXX>` przechodzi bez zmian i daje ostrzeżenie |
| L-5 wygasły kursor | 400 przy "Pokaż więcej" daje "Lista jest nieaktualna." z przyciskiem "Wczytaj od początku" (pierwsza strona) |
| L-6 ostatnie użycie z innego systemu | odczyt 20 najnowszych wywołań, filtr po stronie klienta: nazwa narzędzia z prefiksem systemu i wynik, który dotarł do systemu (bez odmów, limitów, anulowanych, zastąpionych) |
| L-7 test U+202E | e2e porównuje położenie prostokątów kolejnych znaków (rysowana kolejność), z uwzględnieniem zawinięć |
| L-8 fokus po nawigacji | przyczyna: `skip(1)` pomijał pierwsze `NavigationEnd`, także gdy pochodziło z kliknięcia przerywającego wolne ładowanie; teraz pomijana jest tylko nawigacja nr 1; dodany test z kliknięciem przed końcem ładowania |
| L-9 schowek | po opuszczeniu kroku 2 (i przy anulowaniu, wygaśnięciu, zniszczeniu strony) schowek nadpisywany pustym tekstem, jeśli zawiera dokładnie ten klucz; bez uprawnień do odczytu albo zapisu komunikat "Wyczyść schowek" |

## Różnice względem makiet v3 (M3)

1. Zgodnie z decyzjami: bez `identity_mismatch`; "Połączono jako <konto>" także po zapisie PAT; bez "Odrzuć", za to
   "Anuluj operację" w podglądzie; błąd całej strony; jeden wiersz logu na wywołanie; argumenty po nazwie (R-6).
2. Argumenty w podglądzie pokazują serializację JSON z gatewaya (z cudzysłowami, np. `"DEV"`), nie wartość bez
   cudzysłowów: odróżnia tekst od liczby i pokazuje spacje na brzegach.
3. Etykiety wyników wg tabeli kontraktu (np. "Odmowa (brak uprawnienia)" zamiast samego "Odmowa"); wyniki
   pomocnicze (`tool_disabled`, `credential_required`, `rate_limited`, `step_up_required`) mają własne etykiety.
4. Krok 3 kreatora: "Wstecz" prowadzi do kroku 1 (klucza z kroku 2 nie da się pokazać drugi raz).
5. Dodane stany spoza makiet: baner "zablokowany do HH:MM" (L-4), "już zarejestrowany" (L-7), powrót z MFA, 429.
6. Logi: na 360 px wiersze są kartami z etykietami pól, szczegóły pod przyciskiem na prawej krawędzi karty.

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

Zrzuty ekranów (1280 i 360 px, nazwy z numerem makiety): `SHOTS_DIR` z `e2e/screenshots.spec.ts` (kamień M2, poza repozytorium).
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

0. (M3) `ConfirmationArgument` nie ma pola o zneutralizowanych znakach; BFF zapisuje je w tekście jako `<U+XXXX>`
   (ustalenie z koordynatorem), a web wykrywa wzorzec. Do rozważenia: pole `neutralised: boolean` albo opis wzorca
   w kontrakcie, żeby nie zależeć od konwencji tekstowej. Ta sama uwaga dla `ActivityCall.resource.id`.
0a. (M3) `ActivityCall` nie mówi, czy wywołanie dotarło do systemu docelowego; "Ostatnie użycie" konta serwisowego
   liczone z najnowszego wywołania w logach obejmuje też odmowy i wygasłe potwierdzenia.

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

## Zostało (po M3)

- Wnioski (lista, złożenie, `view_request` w katalogu).
- Administracja (rejestr, różnice definicji, zatwierdzanie).
