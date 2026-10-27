# mcp-portal/web

Frontend portalu platformy MCP (strumień ws-08): Angular 22.2 (standalone, signals, zoneless), Angular
Material 22.2, teksty po polsku przez `$localize`. Rozmawia wyłącznie z BFF przez API C12
(`/api/v1`, kontrakt `portal-bff.v1.yaml` z `mcp-contracts` 1.1.0). BFF (`../bff`, ws-07) serwuje zbudowane
pliki z tego samego originu.

Zakres obecnej wersji i podział na kamienie: [STATUS.md](STATUS.md).

## Wymagania

- Node 24, npm 11.
- Repozytorium `mcp-contracts` obok `mcp-portal` (`../../mcp-contracts` względem `web/`): paczka
  `release/aiwcorpo-mcp-contracts-1.1.0.tgz` jest zależnością deweloperską (OpenAPI, handlery MSW).
- Java 25 tylko do ponownego wygenerowania klienta API (`npm run generate:api`).
- Chromium dla Playwright: `npx playwright install chromium` (raz).

```bash
npm ci
```

## Uruchomienie lokalne

Na mockach (bez BFF), MSW w przeglądarce:

```bash
npm run start:mocks          # http://localhost:4200
```

Mock jest stanowy: logowanie, wylogowanie, step-up MFA, zapis i usunięcie połączenia, powrót z OAuth.
Odpowiedzi pochodzą z przykładów C12 (`@aiwcorpo/mcp-contracts/msw`), ich handlery pilnują też CSRF.
Inny zestaw danych: `?mockScenario=empty` (puste listy), `?mockScenario=errors` (`503 upstream_unavailable`),
`?mockScenario=default`. Wybór trzyma ciasteczko `mcp-portal-mock` do końca sesji przeglądarki. Token zaczynający
się od `invalid` daje `422 secret_invalid`.

Z prawdziwym BFF (ws-01, port 18090):

```bash
npm start                    # http://localhost:4200, proxy /api -> http://localhost:18090 (proxy.conf.json)
```

Klient `mcp-portal-bff` w Keycloak ma redirect URI na `http://localhost:18090`, więc po zalogowaniu
przeglądarka wraca na port 18090. Ciasteczka na `localhost` nie zależą od portu: wystarczy wrócić na
`http://localhost:4200`, sesja działa przez proxy.

## Build dla BFF (ws-07)

```bash
npm ci && npm run build
```

Wynik: `mcp-portal/web/dist/portal/` (płasko, bez podkatalogu `browser/`): `index.html`, `main-<hash>.js`,
`polyfills-<hash>.js`, `chunk-<hash>.js`, `styles-<hash>.css`, `favicon.svg`, `3rdpartylicenses.txt`.
Build produkcyjny nie zawiera MSW ani `mockServiceWorker.js`.

Co BFF musi zrobić przy serwowaniu:

1. Pliki z `dist/portal/` pod `/`. Każda ścieżka spoza `/api/**`, która nie jest plikiem, dostaje
   `index.html` (trasy SPA: `/catalog`, `/connect/jira`, `/connections`, ...).
2. W `index.html` zamienić każde wystąpienie `__CSP_NONCE__` na losowy nonce na każdą odpowiedź (co najmniej
   128 bitów, base64) i wysłać nagłówek:

   ```
   Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'nonce-<nonce>';
     img-src 'self'; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self';
     form-action 'self'; frame-ancestors 'none'
   ```

   Nonce jest potrzebny tylko dla stylów: Angular wstawia style komponentów (także Angular Material) jako
   elementy `<style>` i nadaje im nonce z atrybutu `ngCspNonce` na `<app-root>`. Skrypty to wyłącznie pliki
   (`script-src 'self'`), krytyczny CSS nie jest wstawiany inline (`inlineCritical: false`), czcionki są
   systemowe. Bez podmiany nonce przeglądarka zablokuje style komponentów i strona będzie wyraźnie rozsypana, więc
   błąd widać od razu.
3. `index.html` z `Cache-Control: no-store`; pliki z hashem w nazwie można cache'ować jako niezmienne.
4. Reszta jak w C12: ciasteczko `XSRF-TOKEN` czytelne dla JS (nie HttpOnly, `Path=/`), ustawione najpóźniej
   przy `GET /api/v1/me`; `401 {"error":"unauthenticated"}` dla `/api/**` zamiast przekierowania do IdP.

`scripts/serve-csp.mjs` to referencyjna implementacja punktów 1-3 (Node, bez zależności); na niej działają
testy e2e. Jedyna różnica to `worker-src 'self'`, potrzebne tylko service workerowi MSW w buildzie e2e.

Przekierowanie do dostawcy OAuth (`authorizeUrl`) frontend wykonuje tylko dla `https:`; `http:` wyłącznie dla
`localhost`, `127.0.0.1` i `[::1]` (mocki ws-01).

Frontend buduje `GET /api/v1/auth/login?returnPath=<ścieżka>&stepUp=true` przez `URLSearchParams`, więc
`returnPath` przychodzi zakodowany w query (np. `%2Fconnect%2Fgitlab%3FstepUp%3Ddone`). BFF dekoduje parametr
raz, standardowo, i waliduje wynik wzorcem `ReturnPath` (CC-032). W `stepUpUrl` z odpowiedzi
`401 step_up_required` frontend podmienia `returnPath` na ścieżkę formularza (propozycja CC w
`mcp-contracts/CONTRACT_CHANGES.md`).

## Testy i lint

```bash
npm test                     # Vitest + jsdom, MSW (msw/node) z tymi samymi handlerami co tryb mocków
npm run lint                 # angular-eslint, w tym reguły dostępności szablonów
npm run e2e                  # build konfiguracji e2e + Playwright (Chromium, 1280 px i 360 px)
```

`npm run e2e` buduje aplikację w trybie zoptymalizowanym z MSW (`dist/e2e/`) i serwuje ją przez
`scripts/serve-csp.mjs` z powyższą polityką CSP. Każdy test e2e kończy się błędem, jeśli przeglądarka zgłosi
naruszenie CSP albo nieobsłużony wyjątek. Testy dostępności używają axe-core (WCAG 2.1 A/AA) w trybie
jasnym i ciemnym.

## Klient API

`src/app/api/generated/` jest generowany z `portal-bff.v1.bundled.yaml` (openapi-generator 7.26.0,
`typescript-angular`, `openapitools.json`) i trzymany w repozytorium, żeby build nie wymagał Javy ani sieci.
Nie edytować ręcznie.

```bash
export JAVA_HOME="$(/usr/libexec/java_home -v 25)"   # macOS; gdzie indziej katalog dowolnego JDK 25
npm run generate:api
git diff --stat src/app/api/generated     # zmiany tylko po aktualizacji kontraktu
```

`--type-mappings set=Array`: tablice z `uniqueItems` przychodzą w JSON jako tablice, a domyślny `Set` w
typach kłamałby. `basePath` klienta jest pusty (`provideApi({ basePath: '' })`), więc wywołania są względne
i `HttpClient` dokleja `X-XSRF-TOKEN` z ciasteczka `XSRF-TOKEN` (domyślny mechanizm Angulara).

Zmiana wersji kontraktów: podmienić ścieżkę paczki w `package.json` (`@aiwcorpo/mcp-contracts`),
`npm install`, `npm run generate:api`, testy.

## Teksty i i18n

Teksty są w kodzie po polsku z identyfikatorami (`i18n="@@..."`, `` $localize`:@@...:` ``), `sourceLocale`
to `pl` (z niego pochodzi też `LOCALE_ID`, np. format dat). Plik źródłowy do tłumaczeń:
`npm run i18n:extract` -> `src/locale/messages.xlf` (XLIFF 2). `npm run i18n:check` kończy się błędem, gdy
plik w repozytorium nie odpowiada tekstom w kodzie (do uruchamiania w CI).
Komunikaty błędów pochodzą wyłącznie z kodów (C10 i kody C12 z CC-012/CC-022, `src/app/core/error-messages.ts`);
pole `message` z odpowiedzi BFF nigdy nie jest wyświetlane.

## Struktura

```
src/app/
  api/generated/        klient C12 (generowany)
  core/                 sesja, mapowanie błędów, URL-e logowania, guard admina, motyw, interceptor
  shared/               komunikaty, etykiety, odznaka stanu, dialog potwierdzenia
  features/catalog/     Katalog
  features/connect/     Połącz konto (OAuth, token ze step-up)
  features/connections/ Moje połączenia
  features/admin/       trasy admina (lazy, na razie puste)
src/mocks/              warstwa stanowa nad handlerami MSW z kontraktów; start MSW w przeglądarce
src/testing/            pomocnicze dla testów jednostkowych (MSW w Node, TestBed)
e2e/                    Playwright
scripts/serve-csp.mjs   serwer statyczny z CSP i nonce (wzorzec dla BFF, używany w e2e)
```

`src/app/core/mock-api.ts` w buildzie produkcyjnym nic nie robi; konfiguracje `mocks` i `e2e` podmieniają go
na `src/mocks/mock-api.msw.ts` (`fileReplacements` w `angular.json`).
