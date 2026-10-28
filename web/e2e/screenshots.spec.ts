import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { BIDI_CONFIRMATION_ID, DEMO_CONFIRMATION_ID, MOCK_TOTP_SEED } from '../src/mocks/m3-mock';
import { currentCode } from '../src/mocks/totp';
import { expect, startEnrollment, test } from './fixtures';

/**
 * Screenshots of the key screens for comparison with the mockups in mcp-platform-plan/design.
 * Off by default; run with `SHOTS_DIR=<directory> npx playwright test e2e/screenshots.spec.ts`.
 * File names carry the number of the mockup they correspond to and the project (desktop = 1280 px,
 * mobile-360 = 360 px).
 */
const DIRECTORY = process.env['SHOTS_DIR'];

test.describe('screenshots', () => {
  test.skip(!DIRECTORY, 'set SHOTS_DIR to take screenshots');

  async function shot(page: Page, project: string, name: string): Promise<void> {
    await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
    await page.screenshot({
      path: join(DIRECTORY ?? '.', `${name}-${project}.png`),
      fullPage: true,
    });
  }

  test('screens', async ({ page, context }, info) => {
    const project = info.project.name;
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    await page.goto('/?mockSession=out');
    await expect(page.getByRole('button', { name: 'Zaloguj przez konto firmowe' })).toBeVisible();
    await shot(page, project, '00-logowanie');

    for (const code of ['cancelled', 'idp_error', 'session_expired', 'step_up_failed']) {
      await page.goto(`/?loginError=${code}`);
      await expect(page.getByRole('alert')).toBeVisible();
      await shot(page, project, `23-blad-logowania-${code}`);
    }

    await page.goto('/catalog?mockSession=in');
    await page.goto('/catalog');
    await expect(page.getByRole('rowheader', { name: 'GitLab' })).toBeVisible();
    await shot(page, project, '01-serwery-mcp-zwiniete');
    await page.getByRole('button', { name: /^Pokaż narzędzia \(Jira\)/ }).click();
    await shot(page, project, '01-serwery-mcp-rozwiniete');

    await page.goto('/catalog?mockScenario=mixed');
    await expect(page.getByRole('rowheader', { name: 'GitLab' })).toBeVisible();
    await shot(page, project, '01-serwery-mcp-stany-mixed');

    await page.goto('/catalog?mockScenario=empty');
    await expect(page.getByText('Nie masz jeszcze dostępu do żadnego serwera MCP')).toBeVisible();
    await shot(page, project, '02-brak-dostepu');

    await page.goto('/connections?mockScenario=default');
    await expect(page.getByRole('rowheader', { name: 'Jira' })).toBeVisible();
    await shot(page, project, '03-polaczenia-z-systemami');

    await page.goto('/connect/jira?mockScenario=default');
    await expect(page.getByLabel('Token PAT', { exact: true })).toBeVisible();
    await shot(page, project, '04-token-pat');
    await page.getByLabel('Data wygaśnięcia tokenu (opcjonalnie)').fill('2027-01-31');
    await page.getByLabel('Token PAT', { exact: true }).fill('invalid-token');
    await page.getByRole('button', { name: 'Sprawdź i zapisz' }).click();
    await expect(page.getByText('Token nieprawidłowy albo wygasł.')).toBeVisible();
    await shot(page, project, '05-token-pat-secret-invalid');

    await page.goto('/catalog?mockScenario=default&mockOAuth=ok');
    await page.getByRole('button', { name: 'Połącz (GitLab)' }).click();
    await expect(page.getByText('Połączono z GitLab jako jkowalski.')).toBeVisible();
    await shot(page, project, '21-powrot-z-oauth-sukces');
    for (const outcome of ['flow_invalid', 'provider_error', 'cancelled']) {
      await page.goto(`/catalog?mockScenario=default&mockOAuth=${outcome}`);
      await page.getByRole('button', { name: /^(Połącz|Połącz przez OAuth) \(GitLab\)$/ }).click();
      await expect(page.getByRole('alert')).toBeVisible();
      await shot(page, project, `22-powrot-z-oauth-${outcome}`);
    }

    await page.goto('/links?mockScenario=default');
    await expect(page.getByRole('rowheader', { name: 'Przegląd zgłoszeń' })).toBeVisible();
    await shot(page, project, '08-moje-linki-lista');

    await page.getByRole('button', { name: 'Usuń (Przegląd zgłoszeń)' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await shot(page, project, '10-moje-linki-usuwanie');
    await page.getByRole('button', { name: 'Anuluj' }).click();

    await page.goto('/links?mockScenario=nolinks');
    await expect(page.getByText('Nie masz jeszcze żadnych linków')).toBeVisible();
    await shot(page, project, '09-moje-linki-pusta-lista');

    await page.goto('/links/new?mockScenario=default');
    await page.getByLabel('Nazwa').fill('Przegląd zgłoszeń');
    await page.getByRole('button', { name: 'Dalej' }).click();
    await expect(page.getByText('Ten identyfikator jest już zajęty. Wybierz inny.')).toBeVisible();
    await shot(page, project, '11-kreator-nazwa-slug-zajety');

    await page.getByLabel('Identyfikator').fill('moj-zestaw');
    await page.getByRole('button', { name: 'Dalej' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Wybierz narzędzia' })).toBeVisible();
    await page.getByRole('checkbox', { name: /jira__search_issues/ }).check();
    await page.getByRole('checkbox', { name: /jira__get_issue/ }).check();
    await page.getByRole('checkbox', { name: /jira__add_comment/ }).check();
    await shot(page, project, '12-kreator-narzedzia');

    await page.getByRole('button', { name: 'Utwórz link' }).click();
    await expect(page.getByRole('heading', { level: 1, name: /jest gotowy/ })).toBeVisible();
    await shot(page, project, '14-kreator-gotowe');

    await page.goto('/catalog?mockScenario=errors');
    await expect(page.getByText('Nie udało się pobrać danych.')).toBeVisible();
    await shot(page, project, '24-stan-blad-503');

    await page.goto('/nie-ma-takiej-strony');
    await expect(page.getByText('Nie ma takiej strony.')).toBeVisible();
    await shot(page, project, '24-stan-404');
  });

  test('authenticator (M3)', async ({ page, context }, info) => {
    const project = info.project.name;
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    await page.goto('/catalog?mockScenario=default');
    await page.getByRole('button', { name: /^Pokaż narzędzia \(Jira\)/ }).click();
    await expect(page.getByText('Narzędzia "Usuwanie" wymagają kodu')).toBeVisible();
    await shot(page, project, '23-baner-zarejestruj-authenticator');

    for (const [state, name] of [
      ['none', '24-authenticator-nie-zarejestrowano'],
      ['active', '24-authenticator-aktywny'],
      ['locked', '24-authenticator-zablokowany'],
      ['disabled', '24-authenticator-wylaczony'],
    ] as const) {
      await page.goto(`/connections?mockAuthenticator=${state}`);
      await expect(page.getByRole('heading', { name: 'Authenticator' })).toBeVisible();
      await shot(page, project, name);
    }

    await page.goto('/catalog?mockAuthenticator=locked');
    await expect(page.getByText(/Authenticator jest zablokowany do/)).toBeVisible();
    await shot(page, project, '23-baner-zablokowany');
    await page.goto('/catalog?mockAuthenticator=disabled');
    await expect(page.getByText(/Authenticator jest wyłączony/)).toBeVisible();
    await shot(page, project, '23-baner-wylaczony');

    await page.goto('/authenticator/register?mockAuthenticator=none');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Zarejestruj Authenticator' }),
    ).toBeVisible();
    await shot(page, project, '25-rejestracja-1-informacja');
    await startEnrollment(page);
    await expect(page.getByTestId('enrollment-key')).toBeVisible();
    await shot(page, project, '26-rejestracja-2-qr-i-klucz');
    const key = (await page.getByTestId('enrollment-key').innerText()).replace(/\s/g, '');
    expect(key).toBe(MOCK_TOTP_SEED);
    await page.getByRole('button', { name: 'Dalej' }).click();
    await expect(page.getByLabel('Kod z aplikacji (6 cyfr)')).toBeVisible();
    await page.getByLabel('Kod z aplikacji (6 cyfr)').fill('481');
    await page.getByRole('button', { name: 'Sprawdź' }).click();
    await expect(page.getByText('Kod ma 6 cyfr.')).toBeVisible();
    await page.getByLabel('Kod z aplikacji (6 cyfr)').fill('481000');
    await page.getByRole('button', { name: 'Sprawdź' }).click();
    await expect(page.getByText('Kod nieprawidłowy.')).toBeVisible();
    await shot(page, project, '27-rejestracja-3-pierwszy-kod-blad');
    await page.getByLabel('Kod z aplikacji (6 cyfr)').fill(await currentCode(MOCK_TOTP_SEED));
    await page.getByRole('button', { name: 'Sprawdź' }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Authenticator zarejestrowany' }),
    ).toBeVisible();
    await shot(page, project, '28-rejestracja-4-gotowe');

    await page.goto('/authenticator/register?mockAuthenticator=none');
    await startEnrollment(page);
    await page.getByRole('button', { name: 'Dalej' }).click();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await page.getByLabel('Kod z aplikacji (6 cyfr)').fill('000000');
      await page.getByRole('button', { name: 'Sprawdź' }).click();
      if (attempt === 0) {
        await expect(page.getByText('Kod nieprawidłowy.')).toBeVisible();
      }
    }
    await expect(page.getByText('Rejestracja wygasła albo wpisano 3 błędne kody.')).toBeVisible();
    await shot(page, project, '29-rejestracja-wygasla-lub-3-bledne-kody');

    await page.goto('/authenticator/register?mockAuthenticator=active');
    await expect(page.getByText('Authenticator jest już zarejestrowany')).toBeVisible();
    await shot(page, project, '29-rejestracja-already-registered');

    await page.goto('/connections?mockAuthenticator=active');
    await page.getByRole('button', { name: 'Usuń', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await shot(page, project, '30-usuniecie-authenticatora');
    await page.getByRole('button', { name: 'Anuluj' }).click();

    await page.goto('/links/new?mockScenario=default&mockAuthenticator=none');
    await page.getByLabel('Nazwa').fill('Zestaw');
    await page.getByRole('button', { name: 'Dalej' }).click();
    await expect(page.getByText('Narzędzia "Usuwanie" wymagają kodu')).toBeVisible();
    await shot(page, project, '12-kreator-narzedzia-baner');
  });

  test('preview (M3)', async ({ page }, info) => {
    const project = info.project.name;
    const preview = `/confirm/${DEMO_CONFIRMATION_ID}`;

    await page.goto(preview);
    await expect(page.getByRole('button', { name: 'Anuluj operację' })).toBeVisible();
    await shot(page, project, '14-podglad-operacji');

    await page.getByRole('button', { name: 'Anuluj operację' }).click();
    await expect(page.getByText('Operacja anulowana.')).toBeVisible();
    await shot(page, project, '15-podglad-anulowana');

    await page.goto('/confirm/cnf_does_not_exist');
    await expect(page.getByText('Ten link jest nieaktualny.')).toBeVisible();
    await shot(page, project, '15-podglad-nieaktualny');

    await page.goto(`/confirm/${BIDI_CONFIRMATION_ID}?mockSession=in`);
    await expect(page.getByText('Wartości zawierają znaki sterujące.')).toBeVisible();
    await shot(page, project, '14-podglad-znaki-sterujace');
  });

  test('logs (M3)', async ({ page }, info) => {
    const project = info.project.name;
    await page.goto('/logs?mockScenario=default');
    await expect(page.getByText('Czeka na potwierdzenie')).toBeVisible();
    await shot(page, project, '06-logi-audytowe');
    await page.getByRole('button', { name: 'Pokaż szczegóły: jira__delete_issue' }).first().click();
    await shot(page, project, '06-logi-szczegoly-bledne-kody');
    await page.getByLabel('Wynik').selectOption({ label: 'Potwierdzenia kodem' });
    await expect(page.getByRole('cell', { name: 'Wykonano' })).toHaveCount(0);
    await shot(page, project, '06-logi-filtr-potwierdzenia');
    await page.getByPlaceholder('Szukaj w logach').fill('nothing-called-this');
    await expect(page.getByText('Żadne wywołanie nie pasuje do filtrów.')).toBeVisible();
    await shot(page, project, '06-logi-brak-wynikow');
    await page.goto('/logs?mockScenario=errors');
    await expect(page.getByText('Nie udało się pobrać danych.')).toBeVisible();
    await shot(page, project, '06-logi-blad-503');
    await page.goto('/connections?mockScenario=default');
    await expect(page.getByRole('rowheader', { name: 'Service Desk' })).toBeVisible();
    await shot(page, project, '03-polaczenia-ostatnie-uzycie-z-logow');
  });
});
