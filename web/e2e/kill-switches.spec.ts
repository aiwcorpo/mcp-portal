import { expect, test } from './fixtures';

test('switch a tool off without MFA, see it in the registry and the catalog, lift it after a fresh MFA', async ({
  page,
}) => {
  await page.goto('/admin?mockAdmin=in');
  await page.getByRole('link', { name: 'Wyłączniki awaryjne' }).click();
  await expect(page.getByText('Żaden wyłącznik nie jest włączony.')).toBeVisible();

  await page.getByLabel('Serwer', { exact: true }).selectOption('mcp-jira');
  await page.getByLabel('Narzędzie', { exact: true }).selectOption('update_issue');
  await page.getByLabel('Powód', { exact: true }).fill('Zapisy psują workflow po aktualizacji');
  await page.getByRole('button', { name: 'Wyłącz', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: 'Wyłączyć awaryjnie?' });
  await expect(confirm).toContainText('Jira: update_issue');
  await confirm.getByRole('button', { name: 'Wyłącz' }).click();

  await expect(page.getByText('Wyłączono: Jira: update_issue.')).toBeVisible();
  const row = page.getByRole('row', { name: /jira__update_issue/ });
  await expect(row).toContainText('Zapisy psują workflow po aktualizacji');

  await page.getByRole('link', { name: 'Rejestr serwerów' }).click();
  await expect(page.getByText('włączone: 1')).toBeVisible();
  await expect(page.getByRole('row', { name: /jira__update_issue/ })).toContainText(
    'Wyłączone awaryjnie',
  );

  await page.goto('/catalog');
  await page.getByRole('button', { name: /^Pokaż narzędzia \(Jira\)/ }).click();
  await expect(page.getByRole('row', { name: /jira__create_issue/ })).not.toContainText(
    'Wyłączone awaryjnie',
  );

  // Lifting needs a fresh MFA: the mock IdP gives it and the lift is carried out on return, without a second click (U12).
  await page.goto('/admin/kill-switches');
  await page.getByRole('button', { name: 'Zdejmij (jira__update_issue)' }).click();
  await page
    .getByRole('dialog', { name: 'Zdjąć wyłącznik?' })
    .getByRole('button', { name: 'Zdejmij wyłącznik' })
    .click();
  await expect(page.getByText('Zdjęto wyłącznik: jira__update_issue.')).toBeVisible();
  await expect(page.getByText('Tożsamość potwierdzona. Zdejmuję wyłącznik')).toBeVisible();
  await expect(page.getByText('Żaden wyłącznik nie jest włączony.')).toBeVisible();
});

test('a whole server switched off turns every tool of it off in the catalog', async ({ page }) => {
  await page.goto('/admin/kill-switches?mockAdmin=in');
  await page.getByLabel('Serwer', { exact: true }).selectOption('mcp-jira');
  await page.getByLabel('Powód', { exact: true }).fill('Awaria dostawcy');
  await page.getByRole('button', { name: 'Wyłącz', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Wyłączyć awaryjnie?' })
    .getByRole('button', { name: 'Wyłącz' })
    .click();
  await expect(page.getByText('Wyłączono: Jira.')).toBeVisible();

  await page.goto('/catalog');
  await page.getByRole('button', { name: /^Pokaż narzędzia \(Jira\)/ }).click();
  await expect(page.getByText('Wyłączone awaryjnie przez administratora.').first()).toBeVisible();
});

test('a user who is not an administrator does not reach the screen', async ({ page }) => {
  await page.goto('/admin/kill-switches');
  await expect(page.getByRole('heading', { level: 1, name: 'Wyłączniki awaryjne' })).toHaveCount(0);
});
