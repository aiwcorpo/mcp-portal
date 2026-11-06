import { expect, test } from './fixtures';

test('switch a tool off without MFA, see it in the registry and the catalog, lift it after a fresh MFA', async ({
  page,
}) => {
  await page.goto('/admin?mockAdmin=in');
  await page.getByRole('link', { name: 'Emergency switches' }).click();
  await expect(page.getByText('No switch is on.')).toBeVisible();

  await page.getByLabel('Server', { exact: true }).selectOption('mcp-jira');
  await page.getByLabel('Tool', { exact: true }).selectOption('update_issue');
  await page.getByLabel('Reason', { exact: true }).fill('Writes break the workflow after the update');
  await page.getByRole('button', { name: 'Switch off', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: 'Switch off now?' });
  await expect(confirm).toContainText('Jira: update_issue');
  await confirm.getByRole('button', { name: 'Switch off' }).click();

  await expect(page.getByText('Switched off: Jira: update_issue.')).toBeVisible();
  const row = page.getByRole('row', { name: /jira__update_issue/ });
  await expect(row).toContainText('Writes break the workflow after the update');

  await page.getByRole('link', { name: 'Approvals' }).click();
  await expect(page.getByText('on: 1')).toBeVisible();
  await expect(page.getByRole('row', { name: /jira__update_issue/ })).toContainText(
    'Switched off',
  );

  await page.goto('/catalog');
  await page.getByRole('button', { name: /^Show tools \(Jira\)/ }).click();
  await expect(page.getByRole('row', { name: /jira__create_issue/ })).not.toContainText(
    'Switched off',
  );

  // Lifting needs a fresh MFA: the mock IdP gives it and the lift is carried out on return, without a second click (U12).
  await page.goto('/admin/kill-switches');
  await page.getByRole('button', { name: 'Lift (jira__update_issue)' }).click();
  await page
    .getByRole('dialog', { name: 'Lift the switch?' })
    .getByRole('button', { name: 'Lift switch' })
    .click();
  await expect(page.getByText('Lifted switch: jira__update_issue.')).toBeVisible();
  await expect(page.getByText('Identity confirmed. Lifting the switch')).toBeVisible();
  await expect(page.getByText('No switch is on.')).toBeVisible();
});

test('a whole server switched off turns every tool of it off in the catalog', async ({ page }) => {
  await page.goto('/admin/kill-switches?mockAdmin=in');
  await page.getByLabel('Server', { exact: true }).selectOption('mcp-jira');
  await page.getByLabel('Reason', { exact: true }).fill('Awaria dostawcy');
  await page.getByRole('button', { name: 'Switch off', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Switch off now?' })
    .getByRole('button', { name: 'Switch off' })
    .click();
  await expect(page.getByText('Switched off: Jira.')).toBeVisible();

  await page.goto('/catalog');
  await page.getByRole('button', { name: /^Show tools \(Jira\)/ }).click();
  await expect(page.getByText('Switched off in an emergency by an administrator.').first()).toBeVisible();
});

test('a user who is not an administrator does not reach the screen', async ({ page }) => {
  await page.goto('/admin/kill-switches');
  await expect(page.getByRole('heading', { level: 1, name: 'Emergency switches' })).toHaveCount(0);
});
