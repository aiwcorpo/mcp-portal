import { expect, test } from './fixtures';

const KEY = 'test-only-service-token-0000000000';

test('the key of a service-account system is set after a fresh MFA, replaced, and deleted, and never shown again', async ({
  page,
}) => {
  await page.goto('/admin/systems?mockAdmin=in');
  const row = page.getByRole('row', { name: /servicedesk/ });
  await expect(row).toContainText('Service account key: not set');
  await expect(page.getByRole('row', { name: /jira/ })).not.toContainText('Service account key');

  await row.getByRole('button', { name: 'Set key (servicedesk)' }).click();
  const field = page.getByLabel('Key', { exact: true });
  await expect(field).toHaveAttribute('type', 'password');
  await expect(field).toHaveAttribute('autocomplete', 'off');
  await field.fill(KEY);
  await page.getByRole('button', { name: 'Save key' }).click();

  // The mock IdP gives the MFA on the way; the key is not carried over, so it is typed again.
  await expect(page.getByText('Identity confirmed. Enter the key again and save')).toBeVisible();
  await expect(page.getByLabel('Key', { exact: true })).toHaveValue('');
  await page.getByLabel('Key', { exact: true }).fill(KEY);
  await page.getByLabel('Expires (optional)').fill('2099-03-01T10:00');
  await page.getByRole('button', { name: 'Save key' }).click();

  await expect(page.getByText('Saved the service account key of servicedesk.')).toBeVisible();
  await expect(row).toContainText('Service account key: set, expires 2099-03-01');
  await expect(page.getByLabel('Key', { exact: true })).toHaveCount(0);
  const kept = await page.evaluate(() =>
    JSON.stringify([{ ...localStorage }, { ...sessionStorage }]),
  );
  expect(kept).not.toContain(KEY);
  expect(await page.content()).not.toContain(KEY);

  await row.getByRole('button', { name: 'Replace key (servicedesk)' }).click();
  await expect(page.getByLabel('Key', { exact: true })).toHaveValue('');
  await page.getByRole('button', { name: 'Cancel' }).click();

  await row.getByRole('button', { name: 'Delete key (servicedesk)' }).click();
  const dialog = page.getByRole('dialog', {
    name: 'Delete the service account key of servicedesk?',
  });
  await dialog.getByRole('button', { name: 'Delete key' }).click();
  await expect(page.getByText('Identity confirmed. Repeat the operation.')).toBeVisible();
  await row.getByRole('button', { name: 'Delete key (servicedesk)' }).click();
  await dialog.getByRole('button', { name: 'Delete key' }).click();
  await expect(page.getByText('Deleted the service account key of servicedesk.')).toBeVisible();
  await expect(row).toContainText('Service account key: not set');
});

test('removing a system says that its service account key goes with it', async ({ page }) => {
  await page.goto('/admin/systems?mockAdmin=in');
  await page.getByRole('button', { name: 'Remove (servicedesk)' }).click();
  await expect(page.getByRole('dialog')).toContainText('the service account key (if one is set)');
});
