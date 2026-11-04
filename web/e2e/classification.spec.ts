import { expect, test } from './fixtures';

test('classify a tool of an adapter: nothing is preselected, only fitting pairs are offered', async ({
  page,
}) => {
  await page.goto('/admin?mockAdmin=in&mockAdapter=in');
  await expect(page.getByRole('row', { name: /jira__delete_comment/ })).toContainText(
    'Source: adapter',
  );
  await page.getByRole('button', { name: 'Show differences (jira__delete_comment)' }).click();
  await expect(page.getByText('risk and action: to be assigned by an administrator')).toBeVisible();
  await page
    .getByRole('button', { name: 'Classify and approve (jira__delete_comment)' })
    .click();

  const dialog = page.getByRole('dialog', { name: 'Tool classification' });
  // The server claims readOnlyHint: true for a tool that deletes; the dialog shows it as an untrusted hint.
  await expect(dialog).toContainText('readOnlyHint: true');
  await expect(dialog.getByRole('radio', { checked: true })).toHaveCount(0);
  const confirm = dialog.getByRole('button', { name: 'Approve with this classification' });
  await expect(confirm).toBeDisabled();

  // An adapter is read only (CC-227): the dialog offers Read and read, nothing that writes or deletes.
  await expect(dialog.getByRole('radio')).toHaveCount(1);
  await dialog.getByLabel('Read READ_ONLY').check();
  await expect(dialog.getByRole('radio', { name: /^read:/ })).toBeChecked();
  await expect(dialog.getByRole('radio', { name: /^(update|delete|admin):/ })).toHaveCount(0);
  await confirm.click();

  await expect(page.getByText('Approved the definition of jira__delete_comment.')).toBeVisible();
  await expect(page.getByRole('row', { name: /jira__delete_comment/ })).toContainText(
    'Approved · Read',
  );
});

test('an entry whose stored classification was voided needs the lowering dialog and a fresh MFA, then resumes by itself', async ({
  page,
}) => {
  await page.goto('/admin?mockAdmin=in&mockAdapter=in');
  await page.getByRole('button', { name: 'Show differences (jira__link_issues)' }).click();
  await expect(page.getByText('Risk lowering.')).toBeVisible();
  await page.getByRole('button', { name: 'Classify and approve (jira__link_issues)' }).click();
  const dialog = page.getByRole('dialog', { name: 'Tool classification' });
  await dialog.getByLabel('Read READ_ONLY').check();
  await dialog.getByRole('button', { name: 'Approve with this classification' }).click();
  await page
    .getByRole('dialog', { name: 'Approve risk lowering?' })
    .getByRole('button', { name: 'Approve risk lowering' })
    .click();

  await expect(page.getByText('Approved the definition of jira__link_issues.')).toBeVisible();
});

test('a lower classification than before needs the dialogs and a fresh MFA, then resumes by itself', async ({
  page,
}) => {
  await page.goto('/admin?mockAdmin=in&mockAdapter=in');
  await page.getByRole('button', { name: 'Show differences (jira__transition_issue)' }).click();
  await page
    .getByRole('button', { name: 'Classify and approve (jira__transition_issue)' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Tool classification' });
  await expect(dialog).toContainText('Previous classification: Write (UPDATE, update).');
  await dialog.getByLabel('Read READ_ONLY').check();
  await dialog.getByRole('button', { name: 'Approve with this classification' }).click();
  await page
    .getByRole('dialog', { name: 'Approve risk lowering?' })
    .getByRole('button', { name: 'Approve risk lowering' })
    .click();

  await expect(page.getByText('Approved the definition of jira__transition_issue.')).toBeVisible();
  await expect(page.getByRole('row', { name: /jira__transition_issue/ })).toContainText(
    'Approved · Read',
  );
});

test('a connection whose secret is gone says so and offers to connect again', async ({ page }) => {
  await page.goto('/connections?mockSecretMissing=in');
  const row = page.getByRole('row', { name: /Jira/ });
  await expect(row).toContainText('stopped working, reconnect the account');
  await expect(row.getByRole('button', { name: 'Renew (Jira)' })).toBeVisible();

  await page.goto('/catalog');
  await expect(page.getByRole('row', { name: /Jira/ }).first()).toContainText(
    'Connection stopped working, connect the account again',
  );
});

test('a gateway that does not flag a voided classification: the 422 risk_lowered turns into the lowering dialog and the MFA', async ({
  page,
}) => {
  await page.goto('/admin?mockAdmin=in&mockAdapter=in');
  await page.getByRole('button', { name: 'Show differences (jira__merge_issues)' }).click();
  await expect(page.getByText('Risk lowering.')).toHaveCount(0);
  await page.getByRole('button', { name: 'Classify and approve (jira__merge_issues)' }).click();
  const dialog = page.getByRole('dialog', { name: 'Tool classification' });
  await dialog.getByLabel('Read READ_ONLY').check();
  await dialog.getByRole('button', { name: 'Approve with this classification' }).click();
  await page
    .getByRole('dialog', { name: 'Approve risk lowering?' })
    .getByRole('button', { name: 'Approve risk lowering' })
    .click();

  await expect(page.getByText('Approved the definition of jira__merge_issues.')).toBeVisible();
});
