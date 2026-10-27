import { expect, test } from './fixtures';

test('log out and log in again through the BFF endpoints', async ({ page }) => {
  await page.goto('/connections');
  await expect(page.getByText('Jan Kowalski')).toBeVisible();

  await page.getByRole('button', { name: 'Wyloguj' }).click();
  await expect(page.getByText('Wylogowano.')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Nawigacja główna' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Zaloguj się' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Katalog serwerów MCP' })).toBeVisible();
});

test('OAuth callback result is shown in the catalog', async ({ page }) => {
  await page.goto('/catalog');
  await page.getByRole('button', { name: 'Połącz przez OAuth (GitLab)' }).click();
  await expect(page.getByText('Połączono konto GitLab.')).toBeVisible();
  await expect(page).toHaveURL(/\/catalog$/);
});

test('empty and error scenarios', async ({ page }) => {
  await page.goto('/catalog?mockScenario=empty');
  await expect(page.getByText('Nie ma serwerów MCP do wyświetlenia.')).toBeVisible();
  await page.goto('/connections?mockScenario=errors');
  await expect(page.getByRole('alert')).toContainText('Usługa jest chwilowo niedostępna.');
});

test('dialog and snack bar work under the CSP: disconnect and copy link', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/catalog');
  await page.getByRole('button', { name: 'Kopiuj link (Jira)' }).click();
  await expect(page.getByText('Skopiowano adres serwera Jira.')).toBeVisible();

  await page.getByRole('link', { name: 'Moje połączenia' }).click();
  await page.getByRole('button', { name: 'Odłącz (Jira)' }).click();
  const dialog = page.getByRole('dialog', { name: 'Odłączyć konto Jira?' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Anuluj' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Odłącz' }).click();
  await expect(page.getByText('Odłączono konto Jira.')).toBeVisible();
  await expect(page.getByText('Nie masz połączonych kont.')).toBeVisible();
});
