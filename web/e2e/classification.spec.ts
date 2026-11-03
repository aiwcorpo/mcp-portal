import { expect, test } from './fixtures';

test('classify a tool of an adapter: nothing is preselected, only fitting pairs are offered', async ({
  page,
}) => {
  await page.goto('/admin?mockAdmin=in&mockAdapter=in');
  await expect(page.getByRole('row', { name: /jira__delete_comment/ })).toContainText(
    'Źródło: adapter',
  );
  await page.getByRole('button', { name: 'Pokaż różnice (jira__delete_comment)' }).click();
  await expect(page.getByText('ryzyko i akcja: do nadania przez administratora')).toBeVisible();
  await page
    .getByRole('button', { name: 'Sklasyfikuj i zatwierdź (jira__delete_comment)' })
    .click();

  const dialog = page.getByRole('dialog', { name: 'Klasyfikacja narzędzia' });
  // The server claims readOnlyHint: true for a tool that deletes; the dialog shows it as an untrusted hint.
  await expect(dialog).toContainText('readOnlyHint: true');
  await expect(dialog.getByRole('radio', { checked: true })).toHaveCount(0);
  const confirm = dialog.getByRole('button', { name: 'Zatwierdź z tą klasyfikacją' });
  await expect(confirm).toBeDisabled();

  // An adapter is read only (CC-227): the dialog offers Odczyt and read, nothing that writes or deletes.
  await expect(dialog.getByRole('radio')).toHaveCount(1);
  await dialog.getByLabel('Odczyt READ_ONLY').check();
  await expect(dialog.getByRole('radio', { name: /^read:/ })).toBeChecked();
  await expect(dialog.getByRole('radio', { name: /^(update|delete|admin):/ })).toHaveCount(0);
  await confirm.click();

  await expect(page.getByText('Zatwierdzono definicję jira__delete_comment.')).toBeVisible();
  await expect(page.getByRole('row', { name: /jira__delete_comment/ })).toContainText(
    'Zatwierdzone · Odczyt',
  );
});

test('an entry whose stored classification was voided needs the lowering dialog and a fresh MFA, then resumes by itself', async ({
  page,
}) => {
  await page.goto('/admin?mockAdmin=in&mockAdapter=in');
  await page.getByRole('button', { name: 'Pokaż różnice (jira__link_issues)' }).click();
  await expect(page.getByText('Obniżenie ryzyka.')).toBeVisible();
  await page.getByRole('button', { name: 'Sklasyfikuj i zatwierdź (jira__link_issues)' }).click();
  const dialog = page.getByRole('dialog', { name: 'Klasyfikacja narzędzia' });
  await dialog.getByLabel('Odczyt READ_ONLY').check();
  await dialog.getByRole('button', { name: 'Zatwierdź z tą klasyfikacją' }).click();
  await page
    .getByRole('dialog', { name: 'Zatwierdzić obniżenie ryzyka?' })
    .getByRole('button', { name: 'Zatwierdź obniżenie ryzyka' })
    .click();

  await expect(page.getByText('Zatwierdzono definicję jira__link_issues.')).toBeVisible();
});

test('a lower classification than before needs the dialogs and a fresh MFA, then resumes by itself', async ({
  page,
}) => {
  await page.goto('/admin?mockAdmin=in&mockAdapter=in');
  await page.getByRole('button', { name: 'Pokaż różnice (jira__transition_issue)' }).click();
  await page
    .getByRole('button', { name: 'Sklasyfikuj i zatwierdź (jira__transition_issue)' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Klasyfikacja narzędzia' });
  await expect(dialog).toContainText('Poprzednia klasyfikacja: Zapis (UPDATE, update).');
  await dialog.getByLabel('Odczyt READ_ONLY').check();
  await dialog.getByRole('button', { name: 'Zatwierdź z tą klasyfikacją' }).click();
  await page
    .getByRole('dialog', { name: 'Zatwierdzić obniżenie ryzyka?' })
    .getByRole('button', { name: 'Zatwierdź obniżenie ryzyka' })
    .click();

  await expect(page.getByText('Zatwierdzono definicję jira__transition_issue.')).toBeVisible();
  await expect(page.getByRole('row', { name: /jira__transition_issue/ })).toContainText(
    'Zatwierdzone · Odczyt',
  );
});

test('a connection whose secret is gone says so and offers to connect again', async ({ page }) => {
  await page.goto('/connections?mockSecretMissing=in');
  const row = page.getByRole('row', { name: /Jira/ });
  await expect(row).toContainText('przestało działać, połącz konto ponownie');
  await expect(row.getByRole('button', { name: 'Odnów (Jira)' })).toBeVisible();

  await page.goto('/catalog');
  await expect(page.getByRole('row', { name: /Jira/ }).first()).toContainText(
    'Połączenie przestało działać, połącz konto ponownie',
  );
});

test('a gateway that does not flag a voided classification: the 422 risk_lowered turns into the lowering dialog and the MFA', async ({
  page,
}) => {
  await page.goto('/admin?mockAdmin=in&mockAdapter=in');
  await page.getByRole('button', { name: 'Pokaż różnice (jira__merge_issues)' }).click();
  await expect(page.getByText('Obniżenie ryzyka.')).toHaveCount(0);
  await page.getByRole('button', { name: 'Sklasyfikuj i zatwierdź (jira__merge_issues)' }).click();
  const dialog = page.getByRole('dialog', { name: 'Klasyfikacja narzędzia' });
  await dialog.getByLabel('Odczyt READ_ONLY').check();
  await dialog.getByRole('button', { name: 'Zatwierdź z tą klasyfikacją' }).click();
  await page
    .getByRole('dialog', { name: 'Zatwierdzić obniżenie ryzyka?' })
    .getByRole('button', { name: 'Zatwierdź obniżenie ryzyka' })
    .click();

  await expect(page.getByText('Zatwierdzono definicję jira__merge_issues.')).toBeVisible();
});
