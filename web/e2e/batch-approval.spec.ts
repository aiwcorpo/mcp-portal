import { expect, test } from './fixtures';

const URL = '/admin?mockAdmin=in&mockAdapter=in&mockBatch=in';

test('approve the reading tools of a new server in one go', async ({ page }) => {
  await page.goto(URL);

  await expect(
    page.getByRole('checkbox', { name: 'Select gitlab__list_projects for approval' }),
  ).toBeVisible();
  await page.getByRole('button', { name: /^Select all read-only \(GitLab\)/ }).click();
  await expect(page.getByRole('button', { name: /^Approve selected \(3\)/ })).toBeVisible();
  await expect(
    page.getByRole('checkbox', { name: 'Select gitlab__create_issue for approval' }),
  ).not.toBeChecked();

  await page.getByRole('button', { name: /^Approve selected \(3\)/ }).click();
  await expect(page.getByRole('dialog')).toContainText('Approve the selected tools?');
  await page.getByRole('dialog').getByRole('button', { name: 'Approve 3' }).click();

  await expect(page.getByText(/^Approved 3 of 3 tools of GitLab\./)).toBeVisible();
  await expect(page.getByRole('row', { name: /gitlab__list_pipelines/ })).toContainText('Approved');
  await expect(page.getByRole('row', { name: /gitlab__create_issue/ })).toContainText('New');
  await expect(
    page.getByRole('button', { name: /^Approve selected \(0\) \(GitLab\)/ }),
  ).toBeVisible();
});

test('a tool that changed meanwhile is marked in its row and the others go through', async ({
  page,
}) => {
  await page.goto(URL);
  await page.getByRole('button', { name: /^Select all \(GitLab\)/ }).click();
  await expect(page.getByRole('button', { name: /^Approve selected \(6\)/ })).toBeVisible();

  await page.evaluate(() =>
    (
      window as unknown as {
        __portalMock: { changePendingDefinition: (server: string, tool: string) => void };
      }
    ).__portalMock.changePendingDefinition('mcp-gitlab', 'create_issue'),
  );
  await page.getByRole('button', { name: /^Approve selected \(6\)/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Approve 6' }).click();

  await expect(page.getByText(/^Approved 5 of 6 tools of GitLab\./)).toBeVisible();
  const failed = page.getByRole('row', { name: /gitlab__create_issue/ });
  await expect(failed).toContainText('The definition changed after you picked it');
  await expect(page.getByRole('row', { name: /gitlab__delete_branch/ })).toContainText('Approved');
});

test('a risk lowering and an adapter tool are not part of a batch and say why', async ({
  page,
}) => {
  await page.goto(URL);

  const lowering = page.getByRole('checkbox', { name: 'Select jira__delete_issue for approval' });
  await expect(lowering).toBeDisabled();
  await expect(page.getByRole('row', { name: /jira__delete_issue/ })).toContainText(
    'Lowers the risk: review and approve it on its own.',
  );
  const adapter = page.getByRole('checkbox', {
    name: 'Select jira__transition_issue for approval',
  });
  await expect(adapter).toBeDisabled();
  await expect(page.getByRole('row', { name: /jira__transition_issue/ })).toContainText(
    'Needs a classification: approve it on its own.',
  );

  await page.getByRole('button', { name: /^Select all \(Jira\)/ }).click();
  await expect(
    page.getByRole('button', { name: /^Approve selected \(1\) \(Jira\)/ }),
  ).toBeVisible();
});
