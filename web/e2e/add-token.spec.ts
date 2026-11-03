import { expect, test } from './fixtures';

const TOKEN = 'jira-pat-e2e-only-0000000000000000';

test('renew a Jira token without any MFA step and see it in the connections', async ({
  page,
  context,
}) => {
  await page.goto('/catalog');
  const jira = page.locator('tbody', { has: page.getByRole('rowheader', { name: 'Jira' }) });
  await expect(jira).toContainText('Token wygasa za 5 dni');

  await jira.getByRole('button', { name: 'Odnów (Jira)' }).click();
  await expect(page).toHaveURL(/\/connect\/jira$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Połącz Jira' })).toBeVisible();
  await expect(page.getByText('MFA')).toHaveCount(0);

  const token = page.getByLabel('Token PAT', { exact: true });
  await expect(token).toHaveAttribute('type', 'password');
  await expect(token).toHaveAttribute('autocomplete', 'off');
  await expect(page.getByText('Oznaczymy token jako wygasający 7 dni przed terminem.')).toHaveCount(
    0,
  );

  await token.fill(TOKEN);
  await page.getByLabel('Data wygaśnięcia tokenu (opcjonalnie)').fill('2099-01-31');
  await expect(
    page.getByText('Oznaczymy token jako wygasający 7 dni przed terminem.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Sprawdź i zapisz' }).click();

  await expect(page.getByText('Połączono z Jira jako jkowalski.')).toBeVisible();
  await expect(page.getByText('Token ważny do 31.01.2099.')).toBeVisible();

  expect(await page.content()).not.toContain(TOKEN);
  const storage = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  expect(storage).not.toContain(TOKEN);
  expect(JSON.stringify(await context.cookies())).not.toContain(TOKEN);

  await page.getByRole('link', { name: 'Przejdź do połączeń z systemami' }).click();
  const row = page.getByRole('row', { name: /Jira/ });
  await expect(row).toContainText('Token PAT');
  await expect(row).toContainText('jkowalski');
  await expect(row).toContainText('31.01.2099');
  await expect(row).not.toContainText('za 5 dni');
});

test('a token the system rejects stays under the field', async ({ page }) => {
  await page.goto('/connect/jira');
  const token = page.getByLabel('Token PAT', { exact: true });

  await token.fill('invalid-e2e-token');
  await page.getByRole('button', { name: 'Sprawdź i zapisz' }).click();
  await expect(page.getByText('Token nieprawidłowy albo wygasł.')).toBeVisible();
  await expect(token).toHaveValue('');
});

test('the token is optional-dated and required', async ({ page }) => {
  await page.goto('/connect/jira');
  await page.getByRole('button', { name: 'Sprawdź i zapisz' }).click();
  await expect(page.getByText('Wklej token.')).toBeVisible();

  await page.getByLabel('Token PAT', { exact: true }).fill('token-bez-daty');
  await page.getByRole('button', { name: 'Sprawdź i zapisz' }).click();
  await expect(page.getByText('Połączono z Jira jako jkowalski.')).toBeVisible();
});

test('a system with a login: the form asks for the login next to the password or API token', async ({
  page,
}) => {
  await page.goto('/connect/jira?mockBasic=in');
  await page.getByLabel('Login w systemie (np. adres e-mail konta)').fill('anna.nowak@firma.pl');
  await page.getByLabel('Hasło albo token API').fill('test-only-api-token');
  await page.getByRole('button', { name: 'Sprawdź i zapisz' }).click();
  await expect(page.getByText(/Połączono z Jira jako/)).toBeVisible();
  await expect(page.getByText('anna.nowak@firma.pl')).toHaveCount(0);
  await expect(page.getByText('test-only-api-token')).toHaveCount(0);
});
