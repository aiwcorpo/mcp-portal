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
    await expect(page.getByRole('button', { name: 'Sign in with your company account' })).toBeVisible();
    await shot(page, project, '00-logowanie');

    for (const code of ['cancelled', 'idp_error', 'session_expired', 'step_up_failed']) {
      await page.goto(`/?loginError=${code}`);
      await expect(page.getByRole('alert')).toBeVisible();
      await shot(page, project, `23-blad-logowania-${code}`);
    }

    await page.goto('/catalog?mockSession=in');
    // Leaving before the mock session state is saved would drop the session set by the query.
    await expect(page.getByRole('rowheader', { name: 'Gitlab' })).toBeVisible();
    await page.goto('/catalog');
    await expect(page.getByRole('rowheader', { name: 'Gitlab' })).toBeVisible();
    await shot(page, project, '01-serwery-mcp-zwiniete');
    await page.getByRole('button', { name: /^Show tools \(Jira\)/ }).click();
    await shot(page, project, '01-serwery-mcp-rozwiniete');

    await page.goto('/catalog?mockScenario=mixed');
    await expect(page.getByRole('rowheader', { name: 'Gitlab' })).toBeVisible();
    await shot(page, project, '01-serwery-mcp-stany-mixed');

    await page.goto('/catalog?mockScenario=empty');
    await expect(page.getByText('You do not have access to any MCP server yet')).toBeVisible();
    await shot(page, project, '02-brak-dostepu');

    await page.goto('/connections?mockScenario=default');
    await expect(page.getByRole('rowheader', { name: 'Jira' })).toBeVisible();
    await shot(page, project, '03-polaczenia-z-systemami');

    await page.goto('/connect/jira?mockScenario=default');
    await expect(page.getByLabel('PAT token', { exact: true })).toBeVisible();
    await shot(page, project, '04-token-pat');
    await page.getByLabel('Token expiry date (optional)').fill('2027-01-31');
    await page.getByLabel('PAT token', { exact: true }).fill('invalid-token');
    await page.getByRole('button', { name: 'Check and save' }).click();
    await expect(page.getByText('Token is invalid or expired.')).toBeVisible();
    await shot(page, project, '05-token-pat-secret-invalid');

    await page.goto('/catalog?mockScenario=default&mockOAuth=ok');
    await page.getByRole('button', { name: 'Connect (Gitlab)' }).click();
    await expect(page.getByText('Connected to Gitlab as jkowalski.')).toBeVisible();
    await shot(page, project, '21-powrot-z-oauth-sukces');
    for (const outcome of ['flow_invalid', 'provider_error', 'cancelled']) {
      await page.goto(`/catalog?mockScenario=default&mockOAuth=${outcome}`);
      await page.getByRole('button', { name: /^(Connect|Connect with OAuth) \(Gitlab\)$/ }).click();
      await expect(page.getByRole('alert')).toBeVisible();
      await shot(page, project, `22-powrot-z-oauth-${outcome}`);
    }

    await page.goto('/endpoint?mockScenario=default');
    await expect(page.getByLabel('MCP address', { exact: true })).toBeVisible();
    await shot(page, project, '08-adres-mcp');

    await page.getByRole('checkbox', { name: /^Jira/ }).check();
    await page.getByLabel('Read-only').check();
    await page.getByRole('checkbox', { name: /jira__get_issue/ }).check();
    await expect(page.getByLabel('MCP address', { exact: true })).toHaveValue(/systems=jira/);
    await shot(page, project, '12-adres-mcp-filtr');

    await page.goto('/catalog?mockScenario=errors');
    await expect(page.getByText('Could not load the data.')).toBeVisible();
    await shot(page, project, '24-stan-blad-503');

    await page.goto('/nie-ma-takiej-strony');
    await expect(page.getByText('Page not found.')).toBeVisible();
    await shot(page, project, '24-stan-404');
  });

  test('authenticator (M3)', async ({ page, context }, info) => {
    const project = info.project.name;
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    await page.goto('/catalog?mockScenario=default');
    await page.getByRole('button', { name: /^Show tools \(Jira\)/ }).click();
    await expect(page.getByText('You have no Authenticator').first()).toBeVisible();
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
    await expect(page.getByText(/The Authenticator is locked until/)).toBeVisible();
    await shot(page, project, '23-baner-zablokowany');
    await page.goto('/catalog?mockAuthenticator=disabled');
    await expect(page.getByText(/The Authenticator is switched off/)).toBeVisible();
    await shot(page, project, '23-baner-wylaczony');

    await page.goto('/authenticator/register?mockAuthenticator=none');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Register Authenticator' }),
    ).toBeVisible();
    await shot(page, project, '25-rejestracja-1-informacja');
    await startEnrollment(page);
    await expect(page.getByTestId('enrollment-key')).toBeVisible();
    await shot(page, project, '26-rejestracja-2-qr-i-klucz');
    const key = (await page.getByTestId('enrollment-key').innerText()).replace(/\s/g, '');
    expect(key).toBe(MOCK_TOTP_SEED);
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByLabel('Code from the app (6 digits)')).toBeVisible();
    await page.getByLabel('Code from the app (6 digits)').fill('481');
    await page.getByRole('button', { name: 'Check' }).click();
    await expect(page.getByText('The code has 6 digits.')).toBeVisible();
    await page.getByLabel('Code from the app (6 digits)').fill('481000');
    await page.getByRole('button', { name: 'Check' }).click();
    await expect(page.getByText('Invalid code.')).toBeVisible();
    await shot(page, project, '27-rejestracja-3-pierwszy-kod-blad');
    await page.getByLabel('Code from the app (6 digits)').fill(await currentCode(MOCK_TOTP_SEED));
    await page.getByRole('button', { name: 'Check' }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Authenticator registered' }),
    ).toBeVisible();
    await shot(page, project, '28-rejestracja-4-gotowe');

    await page.goto('/authenticator/register?mockAuthenticator=none');
    await startEnrollment(page);
    await page.getByRole('button', { name: 'Next' }).click();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await page.getByLabel('Code from the app (6 digits)').fill('000000');
      await page.getByRole('button', { name: 'Check' }).click();
      if (attempt === 0) {
        await expect(page.getByText('Invalid code.')).toBeVisible();
      }
    }
    await expect(page.getByText('Registration expired or 3 wrong codes were entered.')).toBeVisible();
    await shot(page, project, '29-rejestracja-wygasla-lub-3-bledne-kody');

    await page.goto('/authenticator/register?mockAuthenticator=active');
    await expect(page.getByText('Authenticator is already registered')).toBeVisible();
    await shot(page, project, '29-rejestracja-already-registered');

    await page.goto('/connections?mockAuthenticator=active');
    await page.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await shot(page, project, '30-usuniecie-authenticatora');
    await page.getByRole('button', { name: 'Cancel' }).click();

    await page.goto('/endpoint?mockScenario=default&mockAuthenticator=none');
    await expect(page.getByText('You have no Authenticator').first()).toBeVisible();
    await shot(page, project, '12-adres-mcp-baner');
  });

  test('preview (M3)', async ({ page }, info) => {
    const project = info.project.name;
    const preview = `/confirm/${DEMO_CONFIRMATION_ID}`;

    await page.goto(preview);
    await expect(page.getByRole('button', { name: 'Cancel operation' })).toBeVisible();
    await shot(page, project, '14-podglad-operacji');

    await page.getByRole('button', { name: 'Cancel operation' }).click();
    await expect(page.getByText('Operation cancelled.')).toBeVisible();
    await shot(page, project, '15-podglad-anulowana');

    await page.goto('/confirm/cnf_does_not_exist');
    await expect(page.getByText('This link is out of date.')).toBeVisible();
    await shot(page, project, '15-podglad-nieaktualny');

    await page.goto(`/confirm/${BIDI_CONFIRMATION_ID}?mockSession=in`);
    await expect(page.getByText('Values contain control characters')).toBeVisible();
    await shot(page, project, '14-podglad-znaki-sterujace');
  });

  test('logs (M3)', async ({ page }, info) => {
    const project = info.project.name;
    await page.goto('/logs?mockScenario=default');
    await expect(page.getByText('Waiting for confirmation')).toBeVisible();
    await shot(page, project, '06-logi-audytowe');
    await page.getByRole('button', { name: 'Show details: jira__delete_issue' }).first().click();
    await shot(page, project, '06-logi-szczegoly-bledne-kody');
    await page.getByLabel('Result').selectOption({ label: 'Code confirmations' });
    await expect(page.getByRole('cell', { name: 'Done' })).toHaveCount(0);
    await shot(page, project, '06-logi-filtr-potwierdzenia');
    await page.getByPlaceholder('Search logs').fill('nothing-called-this');
    await expect(page.getByText('No call matches the filters.')).toBeVisible();
    await shot(page, project, '06-logi-brak-wynikow');
    await page.goto('/logs?mockScenario=errors');
    await expect(page.getByText('Could not load the data.')).toBeVisible();
    await shot(page, project, '06-logi-blad-503');
    await page.goto('/connections?mockScenario=default');
    await expect(page.getByRole('rowheader', { name: 'Servicedesk' })).toBeVisible();
    await shot(page, project, '03-polaczenia-ostatnie-uzycie-z-logow');
  });
});
