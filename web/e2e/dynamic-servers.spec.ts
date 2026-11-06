import { expect, test } from './fixtures';

test('a new system and server are added and removed at runtime, with a fresh MFA for each write', async ({
  page,
}) => {
  await page.goto('/admin/systems?mockAdmin=in');
  await expect(page.getByRole('row', { name: /jira/ })).toContainText('Client secret stored');

  await page.getByRole('button', { name: 'Add system' }).click();
  await page.getByLabel('System identifier').fill('notes');
  await page.getByLabel('Base address').fill('https://notes.internal/api');
  // A generic REST system takes user secrets or a service account: no OAuth client, and an optional check of the token.
  await expect(page.getByLabel('Client secret')).toHaveCount(0);
  await expect(page.getByText('Without it the token is stored without a check')).toBeVisible();
  await page.getByLabel('Check path (optional)').fill('/api/me');
  await page.getByLabel('User name field of the answer').fill('login');
  // The mock IdP gives the MFA on the way; the form comes back after it.
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(
    page.getByText('Identity confirmed. Check the form, enter the client secret again'),
  ).toBeVisible();
  await expect(page.getByLabel('System identifier')).toHaveValue('notes');
  await expect(page.getByLabel('Check path (optional)')).toHaveValue('/api/me');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Added the system notes.')).toBeVisible();
  await expect(page.getByRole('row', { name: /notes/ })).toContainText('generic-rest');

  await page.getByRole('link', { name: 'Servers', exact: true }).click();
  await page.getByRole('button', { name: 'Add server' }).click();
  await page.getByLabel('System', { exact: true }).fill('notes');
  await expect(page.getByText('mcp-notes.internal')).toBeVisible();
  await page
    .getByLabel('Internal address of the MCP endpoint')
    .fill('https://mcp-notes.internal:8443/mcp');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Identity confirmed. Check the form and save again.')).toBeVisible();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Added the server mcp-notes.')).toBeVisible();
  await expect(page.getByRole('row', { name: /mcp-notes/ })).toContainText('Enabled');

  await page.getByRole('button', { name: 'Remove (mcp-notes)' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove server' }).click();
  await expect(page.getByText('Identity confirmed. Repeat the operation.')).toBeVisible();
  await page.getByRole('button', { name: 'Remove (mcp-notes)' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove server' }).click();
  await expect(page.getByText('Removed the server mcp-notes.')).toBeVisible();
  await expect(page.getByRole('row', { name: /mcp-notes/ })).toHaveCount(0);
});

test('a server is disabled without a second factor', async ({ page }) => {
  await page.goto('/admin/servers?mockAdmin=in');
  await page.getByRole('button', { name: 'Disable (mcp-gitlab)' }).click();
  await expect(page.getByText('Disabled the server mcp-gitlab.')).toBeVisible();
  await expect(page.getByRole('row', { name: /mcp-gitlab/ })).toContainText('Disabled');
});

test('the scope mapping shows the gateway reasons, keeps edits through the MFA and saves', async ({
  page,
}) => {
  await page.goto('/admin/scope-mapping?mockAdmin=in&mockPolicies=in');
  await expect(page.getByLabel('Group', { exact: true }).first()).toHaveValue('mcp-jira-proj-ABC');
  await page.getByText('Resource types declared by the registered servers').click();
  await expect(page.getByText('Confluence::Space')).toBeVisible();

  await page.getByRole('button', { name: 'Add group' }).click();
  await expect(page.getByLabel('Group', { exact: true })).toHaveCount(3);
  await page.getByLabel('Group', { exact: true }).last().fill('mcp-team-docs');
  await page.getByLabel('Scopes (one per line)').last().fill('Notes::Folder/docs');
  await page.getByRole('button', { name: 'Save mapping' }).click();
  await expect(page.getByText('No registered server declares the resource type')).toBeVisible();
  await expect(
    page.getByText('Notes::Folder/docs names a type that no registered server declares'),
  ).toBeVisible();

  await page.getByLabel('Scopes (one per line)').last().fill('Confluence::Space/DOCS');
  await page.getByRole('button', { name: 'Save mapping' }).click();
  await expect(page.getByText('Your changes are back in the form')).toBeVisible();
  await expect(page.getByLabel('Scopes (one per line)').last()).toHaveValue(
    'Confluence::Space/DOCS',
  );
  await page.getByRole('button', { name: 'Save mapping' }).click();
  await expect(page.getByText('Saved the scope mapping.')).toBeVisible();
  await expect(page.getByLabel('Group', { exact: true })).toHaveCount(3);
});

test('client side checks name the field before anything is sent', async ({ page }) => {
  await page.goto('/admin/scope-mapping?mockAdmin=in');
  await page.getByRole('button', { name: 'Add group' }).click();
  await expect(page.getByLabel('Group', { exact: true })).toHaveCount(3);
  await page.getByLabel('Group', { exact: true }).last().fill('docs');
  await page.getByLabel('Scopes (one per line)').last().fill('docs');
  await page.getByRole('button', { name: 'Save mapping' }).click();
  await expect(page.getByText('A group name starts with mcp-')).toBeVisible();
  await expect(page.getByText('is not a scope id')).toBeVisible();
});

test('overrides: add one for a server, see it, replace it, remove it after a fresh MFA', async ({
  page,
}) => {
  await page.goto('/admin/overrides?mockAdmin=in');
  await expect(page.getByRole('row', { name: /override-block-drop-table/ })).toContainText(
    'Gateway',
  );

  await page.getByRole('button', { name: 'Add override' }).click();
  await page.getByLabel('Identifier').fill('jira-quiet');
  await page.getByLabel('Target').selectOption('server');
  await page.getByLabel('Server', { exact: true }).selectOption('mcp-jira');
  await page.getByRole('button', { name: 'Start from a template' }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Added the override override-jira-quiet.')).toBeVisible();
  await expect(page.getByRole('row', { name: /override-jira-quiet/ })).toContainText('mcp-jira');

  await page.getByRole('button', { name: 'Edit (override-jira-quiet)' }).click();
  await page.getByLabel('Target').selectOption('all-servers');
  // Replacing an override widens access like a removal, so it needs a fresh MFA; the form comes back after the IdP.
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Identity confirmed. Check the form and save again.')).toBeVisible();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved the override override-jira-quiet.')).toBeVisible();
  await expect(page.getByRole('row', { name: /override-jira-quiet/ })).toContainText('All servers');

  await page.getByRole('button', { name: 'Remove (override-jira-quiet)' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove override' }).click();
  await expect(page.getByText('Identity confirmed. Repeat the operation.')).toBeVisible();
  await page.getByRole('button', { name: 'Remove (override-jira-quiet)' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove override' }).click();
  await expect(page.getByText('Removed the override override-jira-quiet.')).toBeVisible();
});

test('approval of policies: differences next to the tools, approval after a fresh MFA, mapping becomes possible', async ({
  page,
}) => {
  await page.goto('/admin?mockAdmin=in&mockPolicies=in');
  await expect(page.getByText('Servers with policies pending approval: 2')).toBeVisible();
  const notes = page.getByRole('row', { name: /mcp-notes/ });
  await expect(notes).toContainText('Pending approval');

  await page.getByRole('button', { name: 'Show differences (Notes, policies)' }).click();
  await expect(page.getByText('First registration')).toBeVisible();
  await expect(page.locator('.added', { hasText: 'type: Notes::Folder' })).toBeVisible();
  await expect(page.locator('.added', { hasText: 'namespace: Notes' })).toBeVisible();

  await page.getByRole('button', { name: 'Show differences (Jira, policies)' }).click();
  await expect(page.locator('.removed', { hasText: 'scopePattern: ^[A-Z]{2,10}$' })).toBeVisible();
  await expect(page.locator('.added', { hasText: 'scopePattern: ^[A-Z]{2,3}$' })).toBeVisible();

  // The IdP round trip carries out the approval of the same hash by itself (U12).
  await page.getByRole('button', { name: 'Approve policies (Notes)' }).click();
  await expect(page.getByText('Approved the policies of Notes.')).toBeVisible();
  await expect(page.getByText('Servers with policies pending approval: 1')).toBeVisible();

  await page.getByRole('link', { name: 'Scope mapping' }).click();
  await page.getByRole('button', { name: 'Add group' }).click();
  await expect(page.getByLabel('Group', { exact: true })).toHaveCount(3);
  await page.getByLabel('Group', { exact: true }).last().fill('mcp-team-docs');
  await page.getByLabel('Scopes (one per line)').last().fill('Notes::Folder/docs');
  await page.getByRole('button', { name: 'Save mapping' }).click();
  await expect(page.getByText('Your changes are back in the form')).toBeVisible();
  await page.getByRole('button', { name: 'Save mapping' }).click();
  await expect(page.getByText('Saved the scope mapping.')).toBeVisible();
});

test('a connection invalidated by a change of the system is shown and can be made again', async ({
  page,
}) => {
  await page.goto('/connections?mockAdmin=in');
  await page.getByRole('link', { name: 'Administration' }).click();
  await page.getByRole('link', { name: 'Systems', exact: true }).click();
  await page.getByRole('button', { name: 'Edit (jira)' }).click();
  await page.getByLabel('Base address').fill('https://jira2.internal');
  await page.getByLabel('Client secret').fill('another-secret');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(
    page.getByText('Identity confirmed. Check the form, enter the client secret again'),
  ).toBeVisible();
  await page.getByLabel('Client secret').fill('another-secret');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('The connections of its users were deleted')).toBeVisible();

  await page.goto('/connections');
  await expect(page.getByText('An administrator changed the settings of the system')).toBeVisible();
  await expect(page.getByRole('row', { name: /Jira/ })).toContainText(
    'the administrator changed the system settings, connect the account again',
  );
});

test('a user who is not an administrator does not reach the new screens', async ({ page }) => {
  for (const path of ['servers', 'systems', 'scope-mapping', 'overrides']) {
    await page.goto(`/admin/${path}`);
    await expect(page.getByRole('navigation', { name: 'Administration sections' })).toHaveCount(0);
  }
});

test('a token that the system does not verify is stored without an account and shown as not verified', async ({
  page,
}) => {
  await page.goto('/connect/notes?mockUnverified=in');
  // The catalog says before the very first token that this system does not check it (CC-248).
  await expect(
    page.getByText('This system does not check tokens when they are stored.'),
  ).toBeVisible();
  await page.getByLabel('PAT token', { exact: true }).fill('notes-token-typed-by-the-user');
  await page.getByRole('button', { name: 'Check and save' }).click();
  await expect(page.getByText('Token stored for Team notes.')).toBeVisible();
  await expect(page.getByText('(not verified)')).toBeVisible();

  await page.goto('/connections');
  await expect(page.getByRole('row', { name: /Team notes/ })).toContainText('Not verified');
  await expect(page.getByRole('row', { name: /Team notes/ })).not.toContainText('jkowalski');
});
