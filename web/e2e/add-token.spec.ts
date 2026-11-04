import { expect, test } from './fixtures';

const TOKEN = 'jira-pat-e2e-only-0000000000000000';

test('renew a Jira token without any MFA step and see it in the connections', async ({
  page,
  context,
}) => {
  await page.goto('/catalog');
  const jira = page.locator('tbody', { has: page.getByRole('rowheader', { name: 'Jira' }) });
  await expect(jira).toContainText('Token expires in 5 days');

  await jira.getByRole('button', { name: 'Renew (Jira)' }).click();
  await expect(page).toHaveURL(/\/connect\/jira$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Connect Jira' })).toBeVisible();
  await expect(page.getByText('MFA')).toHaveCount(0);

  const token = page.getByLabel('PAT token', { exact: true });
  await expect(token).toHaveAttribute('type', 'password');
  await expect(token).toHaveAttribute('autocomplete', 'off');
  await expect(page.getByText('We will mark the token as expiring 7 days before the date.')).toHaveCount(
    0,
  );

  await token.fill(TOKEN);
  await page.getByLabel('Token expiry date (optional)').fill('2099-01-31');
  await expect(
    page.getByText('We will mark the token as expiring 7 days before the date.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Check and save' }).click();

  await expect(page.getByText('Connected to Jira as jkowalski.')).toBeVisible();
  await expect(page.getByText('Token valid until 31.01.2099.')).toBeVisible();

  expect(await page.content()).not.toContain(TOKEN);
  const storage = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  expect(storage).not.toContain(TOKEN);
  expect(JSON.stringify(await context.cookies())).not.toContain(TOKEN);

  await page.getByRole('link', { name: 'Go to system connections' }).click();
  const row = page.getByRole('row', { name: /Jira/ });
  await expect(row).toContainText('PAT token');
  await expect(row).toContainText('jkowalski');
  await expect(row).toContainText('31.01.2099');
  await expect(row).not.toContainText('in 5 days');
});

test('a token the system rejects stays under the field', async ({ page }) => {
  await page.goto('/connect/jira');
  const token = page.getByLabel('PAT token', { exact: true });

  await token.fill('invalid-e2e-token');
  await page.getByRole('button', { name: 'Check and save' }).click();
  await expect(page.getByText('Token is invalid or expired.')).toBeVisible();
  await expect(token).toHaveValue('');
});

test('the token is optional-dated and required', async ({ page }) => {
  await page.goto('/connect/jira');
  await page.getByRole('button', { name: 'Check and save' }).click();
  await expect(page.getByText('Paste the token.')).toBeVisible();

  await page.getByLabel('PAT token', { exact: true }).fill('token-without-date');
  await page.getByRole('button', { name: 'Check and save' }).click();
  await expect(page.getByText('Connected to Jira as jkowalski.')).toBeVisible();
});

test('a system with a login: the form asks for the login next to the password or API token', async ({
  page,
}) => {
  await page.goto('/connect/jira?mockBasic=in');
  await page.getByLabel('Login in the system (for example the account email address)').fill('anna.nowak@firma.pl');
  await page.getByLabel('Password or API token').fill('test-only-api-token');
  await page.getByRole('button', { name: 'Check and save' }).click();
  await expect(page.getByText(/Connected to Jira as/)).toBeVisible();
  await expect(page.getByText('anna.nowak@firma.pl')).toHaveCount(0);
  await expect(page.getByText('test-only-api-token')).toHaveCount(0);
});
