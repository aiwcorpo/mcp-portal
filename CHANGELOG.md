# Changelog

Format: wersje SemVer; kolejność od najnowszej. Do pierwszego wydania numery w `bff/pom.xml` i `web/package.json` są
robocze (`0.1.0-SNAPSHOT`, `0.1.0`); obrazy testowe mają tag `m<numer kamienia>-<sha>`.

## Nie wydane (M6, kontrakty 6.2.0)

- Kontrakty `mcp-contracts` 6.2.0 (BFF: jary z `~/.m2` albo z rejestru; web: tarball w `web/.contracts/`, katalog poza gitem).
- Wyłącznik awaryjny (A9, CC-194): lista aktywnych, włączenie serwera lub narzędzia bez MFA, zdjęcie po świeżym MFA
  (po powrocie z IdP zdjęcie wykonuje się samo), znacznik w rejestrze i katalogu (`disabledBy`).
- Klasyfikacja narzędzi adaptera (CC-193, CC-207): dialog z parami ryzyka i akcji, które przyjmuje gateway, podpowiedzi
  serwera jako tekst niezaufany, komunikat `classification_inconsistent` w dialogu, obniżenie klasyfikacji ze świeżym MFA.
- `RegistryTool.risk` i `.action` opcjonalne (wpis adaptera czeka bez nich), `classifiedBy` i `classifiedAt`.
- Połączenie w stanie `error` (brak sekretu, CC-205): wiersz mówi, że przestało działać, i prosi o ponowne połączenie.
- Wektory `http-broken-escape`, `http-lone-percent` i `http-half-escape` (CC-202) sprawdzane surowym żądaniem.
- Dockerfile w repozytorium (cele `bff`, `web`, `portal`), zrzuty ekranu w README, LICENSE (Apache-2.0), NOTICE,
  SECURITY.md, CONTRIBUTING.md.

## M5 - 2026-10-31

- Jeden adres `/mcp` z filtrem w query zamiast zapisanych linków (kontrakty 5.1.0), kreator adresu bez zapisu,
  licznik bajtów, ostrzeżenie o rozmiarze listy; `ci/run.sh` jako jedyny punkt wejścia CI.
