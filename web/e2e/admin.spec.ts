import { expect, test } from './fixtures';

test('the Administracja tab and route exist only for an administrator', async ({ page }) => {
  await page.goto('/catalog');
  await expect(page.getByRole('link', { name: 'Serwery MCP' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Administracja' })).toHaveCount(0);

  await page.goto('/catalog?mockAdmin=in');
  await page.getByRole('link', { name: 'Administracja' }).click();
  await expect(page.getByText('Do zatwierdzenia: 4')).toBeVisible();
});

test('review a changed definition as a diff and approve it', async ({ page }) => {
  await page.goto('/admin?mockAdmin=in');
  const confluence = page.getByRole('row', { name: /^\s*Ukryj narzędzia \(Confluence\)/ });
  await expect(confluence).toContainText('nowe: 1, zmienione: 1');
  await expect(confluence).toContainText('Do zatwierdzenia');
  await expect(page.getByRole('row', { name: /OpenSearch/ })).toContainText('Wyłączony');

  await page.getByRole('button', { name: 'Pokaż różnice (confluence__update_page)' }).click();
  await expect(page.getByText('Przed (1.3.0)')).toBeVisible();
  await expect(page.getByText('Po (1.5.0)')).toBeVisible();
  await expect(
    page.locator('.removed', { hasText: 'opis: "Edit the content of a page."' }),
  ).toBeVisible();
  await expect(
    page.locator('.added', { hasText: 'schemat.properties.parentId.type: "string"' }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Zatwierdź definicję (confluence__update_page)' }).click();
  await expect(page.getByText('Zatwierdzono definicję confluence__update_page.')).toBeVisible();
  await expect(page.getByRole('row', { name: /confluence__update_page/ })).toContainText(
    'Zatwierdzone',
  );
});

test('a definition that changes while it is open is refused (409) and shown again', async ({
  page,
}) => {
  await page.goto('/admin?mockAdmin=in');
  await page.getByRole('button', { name: 'Pokaż różnice (confluence__archive_page)' }).click();
  await expect(page.getByText('Przed (brak, nowe narzędzie)')).toBeVisible();

  await page.evaluate(() =>
    (
      window as unknown as {
        __portalMock: { changePendingDefinition: (server: string, tool: string) => void };
      }
    ).__portalMock.changePendingDefinition('mcp-confluence', 'archive_page'),
  );
  await page
    .getByRole('button', { name: 'Zatwierdź definicję (confluence__archive_page)' })
    .click();

  await expect(page.getByText('Definicja zmieniła się od czasu, gdy ją otwarto.')).toBeVisible();
  await expect(page.getByText(/Moves a page to the archive\. Zmiana 1\./).first()).toBeVisible();
  await page
    .getByRole('button', { name: 'Zatwierdź definicję (confluence__archive_page)' })
    .click();
  await expect(page.getByText('Zatwierdzono definicję confluence__archive_page.')).toBeVisible();
});

test('a definition from the running server carries a clear warning and a second confirmation; a lowered risk is refused (422)', async ({
  page,
}) => {
  await page.goto('/admin?mockAdmin=in');
  await expect(page.getByRole('row', { name: /jira__update_issue/ })).toContainText(
    'Źródło: serwer',
  );
  await page.getByRole('button', { name: 'Pokaż różnice (jira__update_issue)' }).click();
  await expect(page.getByText('Źródło: serwer.')).toBeVisible();
  await expect(page.getByText(/Ignore previous instructions/).first()).toBeVisible();
  await page.getByRole('button', { name: 'Zatwierdź definicję (jira__update_issue)' }).click();
  const dialog = page.getByRole('dialog', {
    name: 'Zatwierdzić definicję zgłoszoną przez serwer?',
  });
  await dialog.getByRole('button', { name: 'Anuluj' }).click();
  await expect(page.getByText('Zatwierdzono definicję jira__update_issue.')).toHaveCount(0);

  await page.getByRole('button', { name: 'Pokaż różnice (gitlab__delete_branch)' }).click();
  await expect(page.getByText('Ryzyko maleje: Usuwanie na Zapis.')).toBeVisible();
  await page.getByRole('button', { name: 'Zatwierdź definicję (gitlab__delete_branch)' }).click();
  await expect(page.getByText(/Nowa definicja obniża poziom ryzyka/)).toBeVisible();
});

test('the log says "Zbyt wiele wywołań" for a call refused by a limit', async ({ page }) => {
  await page.goto('/logs');
  await expect(page.getByRole('cell', { name: 'Zbyt wiele wywołań' }).first()).toBeVisible();
});
