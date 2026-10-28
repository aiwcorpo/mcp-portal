import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

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
    await page.getByLabel('Token PAT', { exact: true }).fill('other-user-token');
    await page.getByRole('button', { name: 'Sprawdź i zapisz' }).click();
    await expect(page.getByText('Token należy do innego konta.')).toBeVisible();
    await shot(page, project, '05-token-pat-identity-mismatch');

    await page.goto('/catalog?mockScenario=default&mockOAuth=ok');
    await page.getByRole('button', { name: 'Połącz (GitLab)' }).click();
    await expect(page.getByText('Połączono z GitLab jako jkowalski.')).toBeVisible();
    await shot(page, project, '21-powrot-z-oauth-sukces');
    for (const outcome of ['identity_mismatch', 'flow_invalid', 'provider_error', 'cancelled']) {
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
});
