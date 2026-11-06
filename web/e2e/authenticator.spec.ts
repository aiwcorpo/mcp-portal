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
  await expect(page.getByRole('rowheader', { name: 'Gitlab' })).toBeVisible();
  await page
    .getByRole('link', { name: 'Register Authenticator' })
    .filter({ hasText: 'Register Authenticator' })
    .click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Register Authenticator' }),
  ).toBeVisible();

  await startEnrollment(page);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Add the account in the app' }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/authenticator\/register$/);
  await expect(page.getByRole('img', { name: /QR code/ })).toBeVisible();
  const key = (await page.getByTestId('enrollment-key').innerText()).replace(/\s/g, '');
  expect(key).toBe(MOCK_TOTP_SEED);
  await expect(page.getByText('The QR code and key are shown only now.')).toBeVisible();
  await expect(page.getByRole('button', { name: /show again/i })).toHaveCount(0);
  expect(page.url()).not.toContain(key);
  expect(await page.title()).not.toContain(key);

  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Enter the first code' })).toBeVisible();
  await expectSeedNowhere(page);

  await page.getByLabel('Code from the app (6 digits)').fill('000000');
  await page.getByRole('button', { name: 'Check' }).click();
  await expect(page.getByText('Invalid code.')).toBeVisible();

  await page.getByLabel('Code from the app (6 digits)').fill(await currentCode(MOCK_TOTP_SEED));
  await page.getByRole('button', { name: 'Check' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Authenticator registered' }),
  ).toBeVisible();
  await expectSeedNowhere(page);

  await page.getByRole('link', { name: 'Back to connections' }).click();
  await expect(page.getByText(/Active · since \d{2}\.\d{2}\.\d{4}/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'System connections' })).toHaveAttribute(
    'aria-current',
    'page',
  );

  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Remove the Authenticator?');
  await page.getByRole('dialog').getByRole('button', { name: 'Remove' }).click();
  // After the MFA the removal is carried out by itself (U12), with no second click.
  await expect(page).toHaveURL(/\/connections$/);
  await expect(page.getByText('Authenticator removed.')).toBeVisible();
  await expect(page.getByText('Not registered')).toBeVisible();
});

test('a reload during step 2 comes back to step 1 without the key', async ({ page }) => {
  await page.goto('/authenticator/register');
  await startEnrollment(page);
  await expect(page.getByTestId('enrollment-key')).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Register Authenticator' }),
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
  await page.getByRole('button', { name: 'Next' }).click();
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await page.getByLabel('Code from the app (6 digits)').fill('000000');
    await page.getByRole('button', { name: 'Check' }).click();
    if (attempt < 3) {
      await expect(page.getByText('Invalid code.')).toBeVisible();
    }
  }
  await expect(page.getByText('The registration expired or 3 wrong codes were entered.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start over' })).toBeVisible();
});

test('a registration that runs past ten minutes ends by itself', async ({ page }) => {
  await page.clock.install();
  await page.goto('/authenticator/register');
  await startEnrollment(page);
  await expect(page.getByTestId('enrollment-key')).toBeVisible();
  await page.clock.fastForward('10:05');
  await expect(page.getByText('The registration expired or 3 wrong codes were entered.')).toBeVisible();
  await expect(page.getByTestId('enrollment-key')).toHaveCount(0);
});

test('active, locked and switched-off states in My connections', async ({ page }) => {
  await page.goto('/connections?mockAuthenticator=locked');
  await expect(
    page.getByText(/Locked until \d{2}:\d{2} · 5 wrong codes in 15 minutes/),
  ).toBeVisible();
  await expect(page.getByText('A lock is lifted only by time.')).toBeVisible();
  await expect(page.getByRole('button', { name: /unlock/i })).toHaveCount(0);

  await page.goto('/connections?mockAuthenticator=disabled');
  await expect(
    page.getByText('The Authenticator was switched off after 20 wrong codes'),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Register again' })).toBeVisible();

  await page.goto('/catalog');
  await expect(page.getByText('The Authenticator is switched off after 20 wrong codes')).toBeVisible();
});

test('the address page warns about tools that need a code', async ({ page }) => {
  await page.goto('/endpoint');
  await expect(page.getByText('"Delete" tools need a code from the Authenticator')).toBeVisible();
  await expect(page.getByText('Requires a code from the Authenticator.').first()).toBeVisible();
});
