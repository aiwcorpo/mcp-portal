import { expect, test } from './fixtures';

test('the Administration tab and route exist only for an administrator', async ({ page }) => {
  await page.goto('/catalog');
  await expect(page.getByRole('link', { name: 'MCP servers' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Administration' })).toHaveCount(0);

  await page.goto('/catalog?mockAdmin=in');
  await page.getByRole('link', { name: 'Administration' }).click();
  await expect(page.getByText('Pending approval: 4')).toBeVisible();
});

test('review a changed definition as a diff and approve it', async ({ page }) => {
  await page.goto('/admin?mockAdmin=in');
  const confluence = page.getByRole('row', { name: /^\s*Hide tools \(Confluence\)/ });
  await expect(confluence).toContainText('new: 1, changed: 1');
  await expect(confluence).toContainText('Pending approval');
  await expect(page.getByRole('row', { name: /OpenSearch/ })).toContainText('Disabled');

  await page.getByRole('button', { name: 'Show differences (confluence__update_page)' }).click();
  await expect(page.getByText('Before (1.3.0)')).toBeVisible();
  await expect(page.getByText('After (1.5.0)')).toBeVisible();
  await expect(
    page.locator('.removed', { hasText: 'description: "Edit the content of a page."' }),
  ).toBeVisible();
  await expect(
    page.locator('.added', { hasText: 'schema.properties.parentId.type: "string"' }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Approve definition (confluence__update_page)' }).click();
  await expect(page.getByText('Approved the definition of confluence__update_page.')).toBeVisible();
  await expect(page.getByRole('row', { name: /confluence__update_page/ })).toContainText(
    'Approved',
  );
});

test('a definition that changes while it is open is refused (409) and shown again', async ({
  page,
}) => {
  await page.goto('/admin?mockAdmin=in');
  await page.getByRole('button', { name: 'Show differences (confluence__archive_page)' }).click();
  await expect(page.getByText('Before (none, new tool)')).toBeVisible();

  await page.evaluate(() =>
    (
      window as unknown as {
        __portalMock: { changePendingDefinition: (server: string, tool: string) => void };
      }
    ).__portalMock.changePendingDefinition('mcp-confluence', 'archive_page'),
  );
  await page
    .getByRole('button', { name: 'Approve definition (confluence__archive_page)' })
    .click();

  await expect(page.getByText('The definition changed since it was opened.')).toBeVisible();
  await expect(page.getByText(/Moves a page to the archive\. Zmiana 1\./).first()).toBeVisible();
  await page
    .getByRole('button', { name: 'Approve definition (confluence__archive_page)' })
    .click();
  await expect(page.getByText('Approved the definition of confluence__archive_page.')).toBeVisible();
});

test('a definition from the running server carries a clear warning and a second confirmation; a risk lowering needs a dialog and a fresh MFA, then resumes without a second click', async ({
  page,
}) => {
  await page.goto('/admin?mockAdmin=in');
  await expect(page.getByRole('row', { name: /jira__update_issue/ })).toContainText(
    'Source: server',
  );
  await page.getByRole('button', { name: 'Show differences (jira__update_issue)' }).click();
  await expect(page.getByText('Source: server.')).toBeVisible();
  await expect(page.getByText(/Ignore previous instructions/).first()).toBeVisible();
  await page.getByRole('button', { name: 'Approve definition (jira__update_issue)' }).click();
  const dialog = page.getByRole('dialog', {
    name: 'Approve a definition reported by the server?',
  });
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByText('Approved the definition of jira__update_issue.')).toHaveCount(0);

  await page.getByRole('button', { name: 'Show differences (gitlab__delete_branch)' }).click();
  await expect(page.getByText(/The tool risk drops from Delete to Write/)).toBeVisible();
  await page
    .getByRole('button', { name: 'Approve risk lowering (gitlab__delete_branch)' })
    .click();
  const lowering = page.getByRole('dialog', { name: 'Approve risk lowering?' });
  await lowering.getByRole('button', { name: 'Approve risk lowering' }).click();

  // The mock IdP gives a fresh MFA and returns to the admin page, where the approval is carried out by itself (U12).
  await expect(page.getByText('Approved the definition of gitlab__delete_branch.')).toBeVisible();
});

test('the log says "Too many calls" for a call refused by a limit', async ({ page }) => {
  await page.goto('/logs');
  await expect(page.getByRole('cell', { name: 'Too many calls' }).first()).toBeVisible();
});
