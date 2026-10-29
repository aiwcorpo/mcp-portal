import { expect, test } from './fixtures';

test('request an entitlement from a server row: choose it, see its description, follow the request', async ({
  page,
}) => {
  await page.goto('/catalog');
  await expect(page.getByRole('row', { name: /Confluence/ })).toContainText('Brak uprawnienia');
  await page.getByRole('button', { name: 'Złóż wniosek (Confluence)' }).click();

  const dialog = page.getByRole('dialog', { name: 'Złóż wniosek' });
  await expect(dialog.getByText('System: Confluence')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Złóż wniosek' })).toBeDisabled();
  await dialog.getByLabel('Uprawnienie').selectOption('mcp-confluence-read');
  await expect(dialog.getByText('Odczyt stron Confluence.')).toBeVisible();
  await expect(dialog.getByText('Opis z systemu uprawnień')).toBeVisible();
  await dialog.getByRole('button', { name: 'Złóż wniosek' }).click();

  await expect(page.getByText(/Wniosek REQ-2026-\d{4} jest w systemie uprawnień/)).toBeVisible();
  await expect(page.getByRole('row', { name: /Confluence/ })).toContainText('Wniosek oczekuje');
  await page.getByRole('button', { name: 'Zobacz wniosek (Confluence)' }).click();

  await expect(page).toHaveURL(/\/requests$/);
  const pending = page.getByRole('row', { name: /mcp-confluence-read/ });
  await expect(pending).toContainText('Oczekuje');
  await expect(pending.getByRole('link', { name: /Otwórz w systemie uprawnień/ })).toHaveAttribute(
    'href',
    /^https:\/\/iga\.internal\/requests\/REQ-/,
  );
  await expect(page.getByRole('row', { name: /mcp-jira-write.*Zaakceptowany/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /mcp-gitlab-write/ })).toContainText('Odrzucony');
});

test('a second request for the same entitlement does not create another one', async ({ page }) => {
  await page.goto('/requests');
  await expect(page.getByRole('row', { name: /mcp-jira-write/ }).first()).toBeVisible();
  const before = await page.getByRole('row').count();

  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.getByRole('button', { name: 'Złóż wniosek' }).click();
    const dialog = page.getByRole('dialog', { name: 'Złóż wniosek' });
    await dialog.getByLabel('System').selectOption('gitlab');
    await dialog.getByLabel('Uprawnienie').selectOption('mcp-gitlab-read');
    await dialog.getByRole('button', { name: 'Złóż wniosek' }).click();
    await expect(page.getByText(/Wniosek REQ-2026-\d{4} jest w systemie uprawnień/)).toBeVisible();
    await page.getByRole('button', { name: 'Zamknij komunikat' }).click();
  }
  await expect(page.getByRole('row')).toHaveCount(before + 1);
});

test('an IGA that answers with its own form sends the browser there and back to the list', async ({
  page,
}) => {
  await page.goto('/requests?mockIga=redirect');
  await page.getByRole('button', { name: 'Złóż wniosek' }).click();
  const dialog = page.getByRole('dialog', { name: 'Złóż wniosek' });
  await dialog.getByLabel('System').selectOption('opensearch');
  await dialog.getByLabel('Uprawnienie').selectOption('mcp-opensearch-read');
  await dialog.getByRole('button', { name: 'Złóż wniosek' }).click();

  await expect(page).toHaveURL(/\/requests$/);
  await expect(page.getByRole('row', { name: /mcp-opensearch-read/ })).toContainText('Oczekuje');
});

test('an IGA without a request flow and an IGA that is down are explained, not hidden', async ({
  page,
}) => {
  await page.goto('/requests?mockIga=groups');
  await page.getByRole('button', { name: 'Złóż wniosek' }).click();
  const dialog = page.getByRole('dialog', { name: 'Złóż wniosek' });
  await dialog.getByLabel('System').selectOption('jira');
  await expect(
    dialog.getByText('System uprawnień nie przyjmuje wniosków z portalu.'),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Anuluj' }).click();

  await page.goto('/requests?mockIga=down');
  await expect(page.getByText('Usługa jest chwilowo niedostępna.')).toBeVisible();
  await expect(page.getByText(/Identyfikator do zgłoszenia/)).toBeVisible();
});

test('a denied tool of a connected server can be requested from its row', async ({ page }) => {
  await page.goto('/catalog?mockScenario=mixed');
  const jira = page.getByRole('row', { name: /^\s*Pokaż narzędzia \(Jira\)/ });
  await expect(jira).toContainText('Połączone');
  await page.getByRole('button', { name: 'Pokaż narzędzia (Jira)' }).click();
  await page.getByRole('button', { name: 'Złóż wniosek (jira__delete_issue)' }).click();

  await expect(page.getByText(/Wniosek REQ-2026-\d{4} jest w systemie uprawnień/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Zobacz wniosek (Jira)' })).toBeVisible();
});
