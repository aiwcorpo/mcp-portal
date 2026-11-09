import { expect, test } from './fixtures';

test('request an entitlement from a server row: choose it, see its description, follow the request', async ({
  page,
}) => {
  await page.goto('/catalog');
  await expect(page.getByRole('row', { name: /Confluence/ })).toContainText('No entitlement');
  await page.getByRole('button', { name: 'Submit request (Confluence)' }).click();

  const dialog = page.getByRole('dialog', { name: 'Submit request' });
  await expect(dialog.getByText('System: Confluence')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Submit request' })).toBeDisabled();
  await dialog.getByLabel('Entitlement').selectOption('mcp-confluence-read');
  await expect(dialog.getByText('Read access to Confluence spaces')).toBeVisible();
  await expect(dialog.getByText('Description from the entitlement system')).toBeVisible();
  await dialog.getByRole('button', { name: 'Submit request' }).click();

  await expect(page.getByText(/Request REQ-2026-\d{4} submitted/)).toBeVisible();
  await expect(page.getByRole('row', { name: /Confluence/ })).toContainText('Request pending');
  await page.getByRole('button', { name: 'View request (Confluence)' }).click();

  await expect(page).toHaveURL(/\/requests$/);
  const pending = page.getByRole('row', { name: /mcp-confluence-read/ });
  await expect(pending).toContainText('Pending');
  await expect(
    pending.getByRole('link', { name: /Open in the entitlement system/ }),
  ).toHaveAttribute('href', /^https:\/\/iga\.internal\/requests\/REQ-/);
  await expect(page.getByRole('row', { name: /mcp-jira-write.*Approved/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /mcp-gitlab-write/ })).toContainText('Rejected');
});

test('a second request for the same entitlement does not create another one', async ({ page }) => {
  await page.goto('/requests');
  await expect(page.getByRole('row', { name: /mcp-jira-write/ }).first()).toBeVisible();
  const before = await page.getByRole('row').count();

  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.getByRole('button', { name: 'Submit request' }).click();
    const dialog = page.getByRole('dialog', { name: 'Submit request' });
    await dialog.getByLabel('System').selectOption('gitlab');
    await dialog.getByLabel('Entitlement').selectOption('mcp-gitlab-read');
    await dialog.getByRole('button', { name: 'Submit request' }).click();
    await expect(page.getByText(/Request REQ-2026-\d{4} submitted/)).toBeVisible();
    await page.getByRole('button', { name: 'Close message' }).click();
  }
  await expect(page.getByRole('row')).toHaveCount(before + 1);
});

test('an IGA that answers with its own form sends the browser there and back to the list', async ({
  page,
}) => {
  await page.goto('/requests?mockIga=redirect');
  await page.getByRole('button', { name: 'Submit request' }).click();
  const dialog = page.getByRole('dialog', { name: 'Submit request' });
  await dialog.getByLabel('System').selectOption('opensearch');
  await dialog.getByLabel('Entitlement').selectOption('mcp-opensearch-read');
  await dialog.getByRole('button', { name: 'Submit request' }).click();

  await expect(page).toHaveURL(/\/requests$/);
  await expect(page.getByRole('row', { name: /mcp-opensearch-read/ })).toContainText('Pending');
});

test('an IGA without a request flow offers no request, an IGA that is down is explained', async ({
  page,
}) => {
  await page.goto('/catalog?mockIga=groups&mockScenario=mixed');
  await expect(
    page.getByText('Access is granted by the platform administrator.').first(),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: /^Submit request/ })).toHaveCount(0);

  await page.goto('/requests?mockIga=groups');
  await expect(page.getByText('Access is granted by the platform administrator.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Submit request' })).toHaveCount(0);

  await page.goto('/requests?mockIga=down');
  await expect(page.getByText('The service is temporarily unavailable.')).toBeVisible();
  await expect(page.getByText(/Reference for support/)).toBeVisible();
});

test('a denied tool of a connected server can be requested from its row', async ({ page }) => {
  await page.goto('/catalog?mockScenario=mixed');
  const jira = page.getByRole('row', { name: /^\s*Show tools \(Jira\)/ });
  await expect(jira).toContainText('Connected');
  await page.getByRole('button', { name: 'Show tools (Jira)' }).click();
  await page.getByRole('button', { name: 'Submit request (jira__delete_issue)' }).click();

  await expect(page.getByText(/Request REQ-2026-\d{4} submitted/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'View request (Jira)' })).toBeVisible();
});
