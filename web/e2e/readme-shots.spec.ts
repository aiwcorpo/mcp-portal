import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { MOCK_TOTP_SEED, JIRA_CONFIRMATION_ID } from '../src/mocks/m3-mock';
import { expect, startEnrollment, test } from './fixtures';

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

  // The documentation asks for the light theme; the portal opens dark by default (core/theme.service.ts).
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('mcp-portal-theme', 'light'));
  });

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

    await page.goto('/connect/jira?mockBasic=in');
    await page.getByLabel('Login w systemie (np. adres e-mail konta)').fill('anna.nowak@firma.pl');
    await expect(page.getByLabel('Hasło albo token API')).toBeVisible();
    await shot(page, '09-formularz-z-loginem');

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
    await dialog.getByLabel('Odczyt READ_ONLY').check();
    await expect(dialog.getByLabel('read: odczyt danych')).toBeVisible();
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

  test('confirmation screens', async ({ page }) => {
    // The key is the invented seed of the mock build (a made-up value, not a secret of any account).
    await page.goto('/authenticator/register?mockAuthenticator=none');
    await startEnrollment(page);
    await expect(page.getByTestId('enrollment-key')).toContainText(MOCK_TOTP_SEED.slice(0, 4));
    await shot(page, '10-rejestracja-authenticatora-qr');

    await page.getByRole('button', { name: 'Dalej' }).click();
    await page.getByLabel('Kod z aplikacji (6 cyfr)').fill('000000');
    await page.getByRole('button', { name: 'Sprawdź' }).click();
    await expect(page.getByText('Kod nieprawidłowy.')).toBeVisible();
    await shot(page, '11-rejestracja-authenticatora-kod');

    await page.goto('/connections?mockAuthenticator=active');
    await expect(page.getByText(/Aktywny · od \d{2}\.\d{2}\.\d{4}/)).toBeVisible();
    await shot(page, '12a-authenticator-aktywny');
    await page.goto('/connections?mockAuthenticator=locked');
    await expect(page.getByText('Blokadę zdejmuje tylko upływ czasu.')).toBeVisible();
    await shot(page, '12b-authenticator-zablokowany');
    await page.goto('/connections?mockAuthenticator=disabled');
    await expect(page.getByRole('link', { name: 'Zarejestruj ponownie' })).toBeVisible();
    await shot(page, '12c-authenticator-wylaczony');

    await page.goto(`/confirm/${JIRA_CONFIRMATION_ID}`);
    await expect(page.getByText('ABC-1182').first()).toBeVisible();
    await expect(page.getByText(/wygasa za 0[12]:\d{2}/)).toBeVisible();
    await shot(page, '13-podglad-operacji');

    await page.getByRole('button', { name: 'Anuluj operację' }).click();
    await expect(page.getByText('Operacja anulowana.')).toBeVisible();
    await shot(page, '14a-operacja-anulowana');

    // The mock keeps its state in a cookie; dropping it makes the cancelled operation pending again.
    await page.context().clearCookies();
    // Polling is paused on a hidden page; otherwise the mock answers 404 first and the page says "nieaktualny".
    await page.addInitScript(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    });
    await page.clock.install();
    await page.goto(`/confirm/${JIRA_CONFIRMATION_ID}`);
    await expect(page.getByText(/wygasa za/)).toBeVisible();
    await page.clock.fastForward('02:05');
    await expect(page.getByText('Czas minął.')).toBeVisible();
    await shot(page, '14b-czas-minal');
  });

  test('connection, log and request screens', async ({ page }) => {
    await page.goto('/connect/jira');
    await expect(page.getByLabel('Token PAT', { exact: true })).toBeVisible();
    await page.getByText('Jak utworzyć możliwie wąski token').click();
    await expect(page.getByText(/Tokeny dostępu osobistego/)).toBeVisible();
    await page.getByLabel('Data wygaśnięcia tokenu (opcjonalnie)').fill('2027-01-31');
    await expect(
      page.getByText('Oznaczymy token jako wygasający 7 dni przed terminem.'),
    ).toBeVisible();
    await shot(page, '15-dodaj-token-jira', true);

    await page.goto('/logs');
    await expect(page.getByText('Czeka na potwierdzenie')).toBeVisible();
    await page
      .getByRole('button', { name: 'Pokaż szczegóły: confluence__delete_page' })
      .first()
      .click();
    await expect(page.getByText('Identyfikator żądania').first()).toBeVisible();
    await shot(page, '16-logi-audytowe');

    await page.goto('/requests');
    await page.getByRole('button', { name: 'Złóż wniosek' }).click();
    const first = page.getByRole('dialog', { name: 'Złóż wniosek' });
    await first.getByLabel('System').selectOption('confluence');
    await first.getByLabel('Uprawnienie').selectOption('mcp-confluence-read');
    await first.getByRole('button', { name: 'Złóż wniosek' }).click();
    await page.getByRole('button', { name: 'Zamknij komunikat' }).click();
    await expect(page.getByRole('row', { name: /mcp-confluence-read/ })).toContainText('Oczekuje');
    await expect(page.getByRole('row', { name: /mcp-jira-write.*Zaakceptowany/ })).toBeVisible();
    await shot(page, '17a-wnioski-lista');
    await page.getByRole('button', { name: 'Złóż wniosek' }).click();
    const dialog = page.getByRole('dialog', { name: 'Złóż wniosek' });
    await dialog.getByLabel('System').selectOption('jira');
    await dialog.getByLabel('Uprawnienie').selectOption({ index: 1 });
    await shot(page, '17b-wnioski-formularz');

    await page.goto('/requests?mockIga=groups');
    await page.getByRole('button', { name: 'Złóż wniosek' }).click();
    const groups = page.getByRole('dialog', { name: 'Złóż wniosek' });
    await groups.getByLabel('System').selectOption('jira');
    await expect(
      groups.getByText('System uprawnień nie przyjmuje wniosków z portalu.'),
    ).toBeVisible();
    await shot(page, '17c-wnioski-bez-przyjmowania');
  });

  test('administration approval dialogs and the step-up return', async ({ page }) => {
    await page.goto('/admin?mockAdmin=in');
    await page.getByRole('button', { name: 'Pokaż różnice (gitlab__delete_branch)' }).click();
    await expect(page.getByText(/Ryzyko narzędzia spada z Usuwanie na Zapis/)).toBeVisible();
    await shot(page, '18a-obnizenie-ryzyka-lista');
    await page
      .getByRole('button', { name: 'Zatwierdź obniżenie ryzyka (gitlab__delete_branch)' })
      .click();
    await expect(page.getByRole('dialog', { name: 'Zatwierdzić obniżenie ryzyka?' })).toBeVisible();
    await shot(page, '18b-obnizenie-ryzyka-dialog');

    await page.goto('/admin?mockAdmin=in');
    await page.getByRole('button', { name: 'Pokaż różnice (jira__update_issue)' }).click();
    await expect(page.getByText('Źródło: serwer.')).toBeVisible();
    await page.getByRole('button', { name: 'Zatwierdź definicję (jira__update_issue)' }).click();
    await expect(
      page.getByRole('dialog', { name: 'Zatwierdzić definicję zgłoszoną przez serwer?' }),
    ).toBeVisible();
    await shot(page, '19-definicja-z-serwera');

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
    await page.goto('/admin/kill-switches');
    await page.getByRole('button', { name: 'Zdejmij (jira__update_issue)' }).click();
    await page
      .getByRole('dialog', { name: 'Zdjąć wyłącznik?' })
      .getByRole('button', { name: 'Zdejmij wyłącznik' })
      .click();
    await expect(page.getByText('Tożsamość potwierdzona. Zdejmuję wyłącznik')).toBeVisible();
    await shot(page, '20-powrot-po-potwierdzeniu');
  });
});
