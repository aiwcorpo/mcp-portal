import { MOCK_TOTP_SEED } from '../src/mocks/m3-mock';
import { currentCode } from '../src/mocks/totp';
import { expect, startEnrollment, test } from './fixtures';

async function expectSeedNowhere(page: import('@playwright/test').Page): Promise<void> {
  const everywhere = [
    await page.content(),
    page.url(),
    await page.title(),
    await page.evaluate(() =>
      JSON.stringify({ ...localStorage, ...sessionStorage, state: history.state }),
    ),
    await page.evaluate(() => document.cookie),
  ].join('\n');
  expect(everywhere).not.toContain(MOCK_TOTP_SEED);
  expect(everywhere).not.toContain('otpauth');
}

test('register the Authenticator with a fresh MFA, then remove it with another one', async ({
  page,
}) => {
  await page.goto('/catalog');
  await expect(page.getByRole('rowheader', { name: 'GitLab' })).toBeVisible();
  await page
    .getByRole('link', { name: 'Zarejestruj Authenticator' })
    .filter({ hasText: 'Zarejestruj Authenticator' })
    .click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Zarejestruj Authenticator' }),
  ).toBeVisible();

  await startEnrollment(page);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Dodaj konto w aplikacji' }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/authenticator\/register$/);
  await expect(page.getByRole('img', { name: /Kod QR/ })).toBeVisible();
  const key = (await page.getByTestId('enrollment-key').innerText()).replace(/\s/g, '');
  expect(key).toBe(MOCK_TOTP_SEED);
  await expect(page.getByText('Kod QR i klucz pokazujemy tylko teraz.')).toBeVisible();
  await expect(page.getByRole('button', { name: /pokaż ponownie/i })).toHaveCount(0);
  expect(page.url()).not.toContain(key);
  expect(await page.title()).not.toContain(key);

  await page.getByRole('button', { name: 'Dalej' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Wpisz pierwszy kod' })).toBeVisible();
  await expectSeedNowhere(page);

  await page.getByLabel('Kod z aplikacji (6 cyfr)').fill('000000');
  await page.getByRole('button', { name: 'Sprawdź' }).click();
  await expect(page.getByText('Kod nieprawidłowy.')).toBeVisible();

  await page.getByLabel('Kod z aplikacji (6 cyfr)').fill(await currentCode(MOCK_TOTP_SEED));
  await page.getByRole('button', { name: 'Sprawdź' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Authenticator zarejestrowany' }),
  ).toBeVisible();
  await expectSeedNowhere(page);

  await page.getByRole('link', { name: 'Wróć do połączeń' }).click();
  await expect(page.getByText(/Aktywny · od \d{2}\.\d{2}\.\d{4}/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Połączenia z systemami' })).toHaveAttribute(
    'aria-current',
    'page',
  );

  await page.getByRole('button', { name: 'Usuń', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Usunąć Authenticator?');
  await page.getByRole('dialog').getByRole('button', { name: 'Usuń' }).click();
  // After the MFA the removal is carried out by itself (U12), with no second click.
  await expect(page).toHaveURL(/\/connections$/);
  await expect(page.getByText('Authenticator usunięty.')).toBeVisible();
  await expect(page.getByText('Nie zarejestrowano')).toBeVisible();
});

test('a reload during step 2 comes back to step 1 without the key', async ({ page }) => {
  await page.goto('/authenticator/register');
  await startEnrollment(page);
  await expect(page.getByTestId('enrollment-key')).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Zarejestruj Authenticator' }),
  ).toBeVisible();
  await expect(page.getByTestId('enrollment-key')).toHaveCount(0);
  await expectSeedNowhere(page);
});

test('going back in history after step 2 does not bring the key back', async ({ page }) => {
  await page.goto('/catalog');
  await page.goto('/authenticator/register');
  await startEnrollment(page);
  await expect(page.getByTestId('enrollment-key')).toBeVisible();
  await page.goto('/connections');
  await page.goBack();
  await expect(page.getByTestId('enrollment-key')).toHaveCount(0);
  await expectSeedNowhere(page);
});

test('three wrong codes end the registration', async ({ page }) => {
  await page.goto('/authenticator/register');
  await startEnrollment(page);
  await page.getByRole('button', { name: 'Dalej' }).click();
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await page.getByLabel('Kod z aplikacji (6 cyfr)').fill('000000');
    await page.getByRole('button', { name: 'Sprawdź' }).click();
    if (attempt < 3) {
      await expect(page.getByText('Kod nieprawidłowy.')).toBeVisible();
    }
  }
  await expect(page.getByText('Rejestracja wygasła albo wpisano 3 błędne kody.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Zacznij od nowa' })).toBeVisible();
});

test('a registration that runs past ten minutes ends by itself', async ({ page }) => {
  await page.clock.install();
  await page.goto('/authenticator/register');
  await startEnrollment(page);
  await expect(page.getByTestId('enrollment-key')).toBeVisible();
  await page.clock.fastForward('10:05');
  await expect(page.getByText('Rejestracja wygasła albo wpisano 3 błędne kody.')).toBeVisible();
  await expect(page.getByTestId('enrollment-key')).toHaveCount(0);
});

test('active, locked and switched-off states in My connections', async ({ page }) => {
  await page.goto('/connections?mockAuthenticator=locked');
  await expect(
    page.getByText(/Zablokowany do \d{2}:\d{2} · 5 błędnych kodów w 15 minut/),
  ).toBeVisible();
  await expect(page.getByText('Blokadę zdejmuje tylko upływ czasu.')).toBeVisible();
  await expect(page.getByRole('button', { name: /odblokuj/i })).toHaveCount(0);

  await page.goto('/connections?mockAuthenticator=disabled');
  await expect(
    page.getByText('Authenticator został wyłączony po 20 błędnych kodach'),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Zarejestruj ponownie' })).toBeVisible();

  await page.goto('/catalog');
  await expect(page.getByText('Authenticator jest wyłączony po 20 błędnych kodach')).toBeVisible();
});

test('the address page warns about tools that need a code', async ({ page }) => {
  await page.goto('/endpoint');
  await expect(page.getByText('Narzędzia "Usuwanie" wymagają kodu z Authenticatora')).toBeVisible();
  await expect(page.getByText('Wymaga kodu z Authenticatora.').first()).toBeVisible();
});
