# Changelog

Format: wersje SemVer; kolejność od najnowszej. Do pierwszego wydania numery w `bff/pom.xml` i `web/package.json` są
robocze (`0.1.0-SNAPSHOT`, `0.1.0`); obrazy testowe mają tag `m<numer kamienia>-<sha>`.

## Nie wydane (M6, kontrakty 6.3.2)

- Kontrakty `mcp-contracts` 6.3.2 (BFF: jary z `~/.m2` albo z rejestru; web: tarball w `web/.contracts/`, katalog poza gitem).
- Wyłącznik awaryjny (A9, CC-194): lista aktywnych, włączenie serwera lub narzędzia bez MFA, zdjęcie po świeżym MFA
  (po powrocie z IdP zdjęcie wykonuje się samo), znacznik w rejestrze i katalogu (`disabledBy`).
- Klasyfikacja narzędzi adaptera (CC-193, CC-227): dialog tylko z Odczytem i `read` (adapter jest tylko do odczytu), podpowiedzi
  serwera jako tekst niezaufany, komunikaty `classification_*` w dialogu; ponowna klasyfikacja wpisu z unieważnioną klasyfikacją
  zapisu to obniżenie (`acceptRiskLowering`, świeże MFA, wznowienie po powrocie).
- Pole loginu w formularzu tokenu dla `userSecretScheme: Basic` (CC-222), `username` w `PUT .../secret` (nie logowany).
- `400` w `approveAdminTool` (CC-210) objęte testem kontraktowym; `503` katalogu przy nieczytelnych wyłącznikach (CC-224).
- `RegistryTool.risk` i `.action` opcjonalne (wpis adaptera czeka bez nich), `classifiedBy` i `classifiedAt`.
- Połączenie w stanie `error` (brak sekretu, CC-205): wiersz mówi, że przestało działać, i prosi o ponowne połączenie.
- Wektory `http-broken-escape`, `http-lone-percent` i `http-half-escape` (CC-202) sprawdzane surowym żądaniem.
- Opcjonalny TLS na porcie BFF (`PORTAL_SERVER_TLS_ENABLED`, `_CERTIFICATE`, `_PRIVATE_KEY`, `_PRIVATE_KEY_PASSWORD`; PEM, pakiet SSL
  Spring Boota), domyślnie wyłączony; bez zmian kontraktów i bez mTLS.
- Dockerfile w repozytorium (cele `bff`, `web`, `portal`), zrzuty ekranu w README, LICENSE (Apache-2.0), NOTICE,
  SECURITY.md, CONTRIBUTING.md.

## M5 - 2026-10-31

- Jeden adres `/mcp` z filtrem w query zamiast zapisanych linków (kontrakty 5.1.0), kreator adresu bez zapisu,
  licznik bajtów, ostrzeżenie o rozmiarze listy; `ci/run.sh` jako jedyny punkt wejścia CI.
