import { expect, test } from './fixtures';

const TOKEN = 'glpat-e2e-only-0000000000000000';

test('add a token with step-up MFA and see it in My connections', async ({ page, context }) => {
  await page.goto('/catalog');
  const gitlab = page.getByRole('article', { name: 'GitLab' });
  await expect(gitlab.getByText('Niepołączone')).toBeVisible();

  await gitlab.getByRole('button', { name: 'Dodaj token (GitLab)' }).click();
  await expect(page).toHaveURL(/\/connect\/gitlab$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Połącz konto: GitLab' })).toBeVisible();
  await expect(page.getByText('Jak utworzyć możliwie wąski token')).toBeVisible();

  const token = page.getByLabel('Token', { exact: true });
  await token.fill(TOKEN);
  await page.getByLabel('Data wygaśnięcia tokenu').fill('2099-01-31');
  await page.getByRole('button', { name: 'Zapisz token' }).click();

  // First PUT: the mock BFF answers 401 step_up_required.
  await expect(page.getByText('wymaga świeżego uwierzytelnienia (MFA)')).toBeVisible();
  await expect(token).toHaveValue('');

  await page.getByRole('button', { name: 'Uwierzytelnij ponownie' }).click();

  // The mock IdP grants fresh MFA and the BFF login redirects back to the form.
  await expect(page).toHaveURL(/\/connect\/gitlab\?stepUp=done&expiresAt=2099-01-31$/);
  await expect(page.getByText('Uwierzytelnienie odświeżone.')).toBeVisible();
  await expect(page.getByLabel('Data wygaśnięcia tokenu')).toHaveValue('2099-01-31');
  await expect(token).toHaveValue('');

  await token.fill(TOKEN);
  await page.getByRole('button', { name: 'Zapisz token' }).click();
  await expect(page.getByText('Połączono jako jkowalski.')).toBeVisible();
  await expect(page.getByText('Token ważny do 31 stycznia 2099.')).toBeVisible();
  await expect(token).toHaveValue('');

  // The secret is nowhere in the page, the browser storage or the cookies.
  expect(await page.content()).not.toContain(TOKEN);
  const storage = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  expect(storage).not.toContain(TOKEN);
  expect(JSON.stringify(await context.cookies())).not.toContain(TOKEN);

  await page.getByRole('link', { name: 'Przejdź do Moich połączeń' }).click();
  const row = page.getByRole('row', { name: /GitLab/ });
  await expect(row).toContainText('Token');
  await expect(row).toContainText('jkowalski');
  await expect(row).toContainText('31 sty 2099');

  await page.getByRole('link', { name: 'Katalog' }).click();
  await expect(page.getByRole('article', { name: 'GitLab' }).getByText('Połączono')).toBeVisible();
});
