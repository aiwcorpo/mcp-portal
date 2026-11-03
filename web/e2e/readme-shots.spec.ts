import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * Screenshots for the README of the repository, taken from the mock build: the data are the examples of the contracts
 * (a made-up user, made-up systems), no real account and no token appears. Off by default:
 * `npm run screenshots` writes them to ../docs/screenshots.
 */
const DIRECTORY = process.env['README_SHOTS_DIR'];

test.describe('README screenshots', () => {
  test.skip(!DIRECTORY, 'set README_SHOTS_DIR to take screenshots');
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'the README shows the desktop layout');

  async function shot(page: Page, name: string, fullPage = false): Promise<void> {
    await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
    await page.screenshot({ path: join(DIRECTORY ?? '.', `${name}.png`), fullPage });
  }

  test.use({ viewport: { width: 1280, height: 800 } });

  test('user screens', async ({ page }) => {
    await page.goto('/?mockSession=out');
    await expect(page.getByRole('button', { name: 'Zaloguj przez konto firmowe' })).toBeVisible();
    await shot(page, '01-logowanie');

    await page.goto('/catalog?mockSession=in');
    await expect(page.getByRole('rowheader', { name: 'GitLab' })).toBeVisible();
    await page.getByRole('button', { name: /^Pokaż narzędzia \(Jira\)/ }).click();
    await shot(page, '02-serwery-mcp');

    await page.goto('/connections?mockAuthenticator=active');
    await expect(page.getByRole('heading', { name: 'Authenticator' })).toBeVisible();
    await shot(page, '03-polaczenia-z-systemami');

    await page.goto('/connections?mockSecretMissing=in');
    await expect(page.getByText('przestało działać, połącz konto ponownie')).toBeVisible();
    await shot(page, '04-polaczenie-w-bledzie');

    await page.goto('/endpoint');
    await page.getByRole('checkbox', { name: /^Jira/ }).check();
    await page.getByLabel('Tylko odczyt').check();
    await expect(page.getByLabel('Adres MCP', { exact: true })).toHaveValue(/systems=jira/);
    await shot(page, '05-adres-mcp');
  });

  test('administration screens', async ({ page }) => {
    await page.goto('/admin?mockAdmin=in');
    await page.getByRole('button', { name: 'Pokaż różnice (confluence__update_page)' }).click();
    await expect(page.getByText('Przed (1.3.0)')).toBeVisible();
    await shot(page, '06-administracja-roznice');

    await page.goto('/admin?mockAdmin=in&mockAdapter=in');
    await page.getByRole('button', { name: 'Pokaż różnice (jira__delete_comment)' }).click();
    await page
      .getByRole('button', { name: 'Sklasyfikuj i zatwierdź (jira__delete_comment)' })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Klasyfikacja narzędzia' });
    await dialog.getByLabel('Usuwanie DESTRUCTIVE').check();
    await expect(dialog.getByLabel('delete: usunięcie danych')).toBeVisible();
    await shot(page, '07-klasyfikacja-narzedzia');
    await dialog.getByRole('button', { name: 'Anuluj' }).click();

    await page.goto('/admin/kill-switches?mockAdmin=in');
    await page.getByLabel('Serwer', { exact: true }).selectOption('mcp-jira');
    await page.getByLabel('Narzędzie', { exact: true }).selectOption('update_issue');
    await page
      .getByLabel('Powód', { exact: true })
      .fill('Zapisy psują workflow po aktualizacji Jiry');
    await page.getByRole('button', { name: 'Wyłącz', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Wyłączyć awaryjnie?' })
      .getByRole('button', { name: 'Wyłącz' })
      .click();
    await expect(page.getByText('Wyłączono: Jira: update_issue.')).toBeVisible();
    await shot(page, '08-wylacznik-awaryjny');
  });
});
