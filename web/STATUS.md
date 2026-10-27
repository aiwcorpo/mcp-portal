# STATUS: mcp-portal/web (ws-08)

Stan na 2026-10-27. Kontrakty: `mcp-contracts` 1.1.0 (paczka `release/aiwcorpo-mcp-contracts-1.1.0.tgz`,
zgodna z tagiem `v1.1.0`). Brief ws-08 nie ma kamieni milowych; podział poniżej ustalił koordynator.

## M1: zrobione

| Element | Gdzie |
| --- | --- |
| Szkielet: Angular 22.2.3 / CLI 22.2.4, standalone, signals, zoneless, Router z lazy loading, Angular Material 22.2.4 (M3), tryb ciemny (systemowy + przełącznik), teksty po polsku przez `$localize`/`i18n` | `src/app`, `angular.json` |
| Klient i modele z `portal-bff.v1.bundled.yaml` (openapi-generator 7.26.0, `typescript-angular`); brak ręcznych typów API | `src/app/api/generated`, `npm run generate:api` |
| MSW w dev (`npm run start:mocks`), w testach jednostkowych (`msw/node`) i w e2e; warstwa stanowa nad handlerami z kontraktów | `src/mocks`, `src/testing` |
| Logowanie i wylogowanie przez `GET /api/v1/auth/login` i `POST /api/v1/auth/logout`; wygasła sesja (401 z dowolnego wywołania) przełącza na ekran logowania | `core/session.service.ts`, `core/session-expiry.interceptor.ts` |
| Katalog: sześć statusów (tekst + kolor), główna akcja wg statusu i `actions[]`, akcje dodatkowe, rozwinięcie narzędzi (ryzyko, dostęp, wymagane uprawnienie), komunikat z `?connected=` / `?connectError=` | `features/catalog` |
| Połącz konto: przycisk OAuth (przekierowanie na `authorizeUrl`, tylko https, http tylko loopback), formularz tokenu z instrukcją per system i datą wygaśnięcia, obsługa `step_up_required` z powrotem do formularza, czyszczenie pola tokenu przy każdym wysłaniu | `features/connect` |
| Moje połączenia: tabela (system, typ, konto, stan, wygasa, ostatnie użycie) z "Odłącz" i potwierdzeniem | `features/connections` |
| Stany błędów z kodów C10/C12 (bez tekstu backendu), puste listy, ponawianie | `core/api-error.ts`, `core/error-messages.ts` |
| Routing pod M2+: trasa `admin` z `canMatch` (czeka na `/me`) i osobnym chunkiem; trasa `**` | `app.routes.ts`, `features/admin/admin.routes.ts` |
| Bezpieczeństwo: CSRF domyślnym mechanizmem Angulara, względne URL-e, brak tokenów w `localStorage`/`sessionStorage` (jedyny wpis to wybór motywu), CSP bez `unsafe-inline` (nonce tylko dla stylów, `inlineCritical: false`, bez SRI-importmap inline) | `app.config.ts`, `angular.json`, `scripts/serve-csp.mjs` |

Weryfikacja (2026-10-27, Node 24.18.0, npm 11.16.0):

```
npm ci          (czysty node_modules, paczka mcp-contracts 1.1.0 z release/) OK
npm test        Test Files 8 passed (8), Tests 51 passed (51)
npm run lint    All files pass linting.
npm run build   Output location: .../mcp-portal/web/dist/portal
npm run e2e     38 passed (Chromium; projekty desktop 1280 px i mobile-360)
npm run i18n:check  bez różnic
```

E2E obejmuje ścieżkę "dodaj token ze step-up" (`e2e/add-token-step-up.spec.ts`): katalog -> Dodaj token ->
PUT -> `401 step_up_required` -> pole wyczyszczone -> ponowne MFA (mock IdP) -> powrót do formularza z datą
-> zapis -> token nie występuje w DOM, storage ani ciasteczkach -> wiersz w Moich połączeniach -> status w
katalogu. Poza tym: wylogowanie/logowanie, połączenie przez OAuth na mockach (start -> mock dostawcy ->
`?connected=` -> komunikat), scenariusze puste i błędne, dialog i snackbar pod CSP, axe-core WCAG 2.1 AA
(ekrany z danymi, błąd, pusta lista, błędy walidacji, step-up, otwarty dialog; jasny/ciemny; 1280, 360 i
320 px), obsługa klawiaturą, fokus po zmianie trasy, brak poziomego przewijania przy 360 i 320 px. Każdy test e2e failuje przy naruszeniu CSP (sprawdzone: zły nonce daje 11 naruszeń).

## Podział na kamienie (M2+, nie zaimplementowane)

| Ekran (brief) | Trasa do dodania w `app.routes.ts` | API C12 | Uwagi |
| --- | --- | --- | --- |
| 4. Moje linki (kreator wirtualnych serwerów) | `links`, `links/new` | `GET/POST /virtual-servers`, `DELETE /virtual-servers/{slug}` | wynik z `clientConfigs` i kopiowaniem; e2e "utwórz link i skopiuj konfigurację" |
| 5. Wnioski | `requests` | `GET/POST /access-requests` | po nim w katalogu włączyć akcje `request_access` i `view_request` (`SUPPORTED_ACTIONS` w `catalog-actions.ts`); e2e "złóż wniosek" |
| 6. Aktywność | `activity` | `GET /activity?limit=` | |
| 6a. Potwierdzenie akcji | `confirm/:id` | `GET/POST /confirmations/{id}` | step-up już przy GET (CC-034); użyć `stepUpUrlFor` z `core/auth-urls.ts` |
| 7. Admin | dzieci w `features/admin/admin.routes.ts` | `/admin/registry`, `.../pending`, `.../approve` | lazy chunk i `adminGuard` już są; link w nawigacji tylko dla `isAdmin` |
| e2e "połącz OAuth" z prawdziwym dostawcą | | | na mockach jest w `e2e/session.spec.ts`; z mockiem GitLaba z ws-01 po M2 backendu |
| e2e na ws-01 profilu `full` | | | po M2 backendu: ten sam zestaw Playwright z `baseURL` na BFF |

## Odstępstwa i decyzje

- Akcje katalogu `request_access` i `view_request` nie są pokazywane w M1 (wymagają ekranu Wnioski). Status
  `request_pending` / `no_access` jest widoczny z opisem.
- Po `step_up_required` frontend nie przekierowuje automatycznie: pokazuje komunikat i przycisk
  "Uwierzytelnij ponownie", bo token i tak trzeba wkleić drugi raz. `returnPath` w `stepUpUrl` jest podmieniany
  na `/connect/<system>?stepUp=done&expiresAt=<data>` (tylko dane niepoufne); obcy origin albo inna ścieżka niż
  `/api/v1/auth/login` są ignorowane. Propozycja CC w `mcp-contracts/CONTRACT_CHANGES.md` (ws-08, `returnPath`
  w `stepUpUrl`).
- Logowanie nie startuje samo: przy braku sesji ekran z przyciskiem "Zaloguj się" (po wylogowaniu nie ma
  pętli z powrotem do IdP).
- `expiresAt` z formularza to `<data>T00:00:00Z` (jak w przykładzie kontraktu).
- Instrukcje tworzenia tokenu są statyczne per system (C12 nie ma takich danych). Dla Jiry, Confluence i GitLaba
  opisują konkretne miejsca w UI; dla service desku i OpenSearch są ogólne, bo produkt nie jest ustalony.
  Do weryfikacji z właścicielami systemów.
- Formularz obsługuje jeden token (PAT/klucz API). Format Basic w `PutSecretRequest` jest nieokreślony:
  propozycja CC (ws-08, "Poświadczenie typu Basic").
- Wygenerowany klient jest w repozytorium (build bez Javy i sieci). Testy jednostkowe używają MSW zamiast
  `HttpTestingController`, żeby sprawdzać też regułę CSRF z handlerów kontraktu.
- W testach jednostkowych (jsdom) ciasteczka trafiają do MSW przez `request:start` w `src/testing/mock-api.ts`,
  bo XHR jsdom dokłada je dopiero po przechwyceniu.

## Pole tokenu a menedżery haseł (przegląd M1, M-2)

Wybór: zostaje `type="password"` z `autocomplete="new-password"` oraz `data-1p-ignore`, `data-lpignore="true"`,
`data-bwignore`, `data-form-type="other"` (1Password, LastPass, Bitwarden, Dashlane); formularz ma
`autocomplete="off"`. Powody:

- `type="text"` z maskowaniem `-webkit-text-security` czytniki ekranu odczytują na głos (wartość nie jest
  traktowana jako hasło), a przeglądarki bez tej właściwości pokazałyby token jawnie;
- `autocomplete="off"` przeglądarki ignorują dla haseł, `new-password` mówi, że to nie jest zapisane hasło do
  podpowiadania; formularz nie ma pola loginu, a po wysłaniu pole jest czyszczone, więc heurystyki "zapisz
  hasło" nie mają pary login/hasło.

Nie da się tego sprawdzić w trybie headless (monity menedżerów się nie pokazują); testy sprawdzają atrybuty.
Do ręcznej weryfikacji w Chrome, Edge i Firefox z włączonym menedżerem haseł.

## Przegląd M1 (2026-10-27): co zrobione

| Znalezisko | Stan |
| --- | --- |
| M-1 brak paczki 1.1.0 | ws-00 przywrócił `release/aiwcorpo-mcp-contracts-1.1.0.tgz`; `rm -rf node_modules && npm ci` OK, zawartość = tag `v1.1.0`, regeneracja klienta bez różnic |
| M-2 menedżery haseł | jak wyżej |
| LOW-1 sekret przed step-up | czeka na decyzję człowieka (kontrakt) |
| LOW-2 `?loginError=true` | czeka na decyzję człowieka; 503 `upstream_unavailable` z katalogu i połączeń obsłużone (także bez JSON), testy |
| LOW-3 `http:` w `authorizeUrl` | tylko `https:`, `http:` wyłącznie dla hostów loopback (`isAllowedRedirect`) |
| LOW-4 `min` daty | `min` = jutro (UTC), zgodnie z walidatorem |
| LOW-5 `maxlength` | atrybut usunięty, walidator pokazuje błąd; token przycinany (`trim`), same spacje = puste |
| LOW-6 ręczne kody | C10 i błędy `PUT secret` z enumów klienta; ręcznie tylko kody CC-012 (schemat `Error` ma `error: string`) i CC-022 |
| LOW-7 `messages.xlf` | wygenerowany ponownie; `npm run i18n:check` |
| LOW-8 `LOCALE_ID` | usunięty, locale z `i18n.sourceLocale` |
| LOW-9 `aria-controls` | tylko gdy lista jest rozwinięta |
| LOW-10 fokus | po nawigacji w aplikacji fokus na `<main>`; zajęte przyciski `disabledInteractive` (aria-disabled, fokus zostaje), handlery sprawdzają stan |
| LOW-11 tabela | jawne role tabeli przy układzie blokowym, etykiety `::before` z pustym tekstem alternatywnym |
| LOW-12 `title` | tekst `visually-hidden` |
| LOW-13 axe | dodane stany: błąd, pusta lista, walidacja, step-up, dialog; przebieg 320 px |
| LOW-14 duplikacja | `core/connection-actions.service.ts` (start OAuth, odłączenie z dialogiem) |
| LOW-15 drobne | `JAVA_HOME` ogólnie w README, `reuseExistingServer: false`, `worker-src` opisany jako wyłącznie e2e, STATUS poprawiony |

## Otwarte pytania

1. CSP: czy BFF (ws-07) przyjmuje podmianę `__CSP_NONCE__` w `index.html` na każdą odpowiedź (opis w
   README)? Alternatywą byłoby `style-src 'unsafe-inline'`, czego brief zabrania.
2. Kiedy BFF ustawia `XSRF-TOKEN`? Frontend zakłada, że najpóźniej przy `GET /api/v1/me` (tak robi mock z
   kontraktów); pierwszy POST/PUT/DELETE zawsze następuje po `/me`.
3. Dev: redirect URI Keycloak wskazuje na :18090, więc po logowaniu z `ng serve` trzeba wrócić ręcznie na
   :4200. Jeśli to przeszkadza, BFF mógłby mieć w profilu dev konfigurowalny adres frontendu dla `returnPath`.
