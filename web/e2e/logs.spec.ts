import { expect, test } from './fixtures';

test('filter the log, open the details of a call and load more', async ({ page }) => {
  await page.goto('/catalog');
  await page.getByRole('link', { name: 'Audit logs' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Audit logs' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Audit logs' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.getByText('Waiting for confirmation')).toBeVisible();
  await expect(
    page.getByText('Only your calls. Argument values are not shown here.'),
  ).toBeVisible();

  for (const label of [
    'Cancelled',
    'Invalidated',
    'Blocked by a pending operation',
    'Confirmed with a code',
    'Wrong code',
    'Expired',
  ]) {
    await expect(page.getByRole('cell', { name: label }).first()).toBeVisible();
  }

  const rows = page.locator('tbody tr:not(.details)');
  await expect(rows).toHaveCount(50);
  await page.getByRole('button', { name: 'Show more' }).click();
  await expect.poll(() => rows.count()).toBeGreaterThan(50);

  await page.getByLabel('Result').selectOption({ label: 'Code confirmations' });
  await expect(page.getByRole('cell', { name: 'Done' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Show details: jira__delete_issue' }).first().click();
  await expect(page.getByTestId('wrong-code-count').first()).toBeVisible();

  await page.getByLabel('Result').selectOption({ label: 'All results' });
  await page.getByPlaceholder('Search logs').fill('ABC-1182');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Confirmed with a code');
  await page.getByRole('button', { name: 'Show details: jira__delete_issue' }).click();
  await expect(page.getByTestId('wrong-code-count')).toHaveText('1');
});

test('an error shows once for the whole page', async ({ page }) => {
  await page.goto('/logs?mockScenario=errors');
  await expect(page.getByText('Could not load the data.')).toBeVisible();
  await expect(page.getByRole('table')).toHaveCount(0);
});

test('the log has no horizontal scroll on a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('/logs');
  await expect(page.getByText('Waiting for confirmation')).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test('Servicedesk shows the time of its last call from the log', async ({ page }) => {
  await page.goto('/connections');
  const row = page.getByRole('row', { name: /Servicedesk/ });
  await expect(row).toContainText(/\d{2}\.\d{2}\.\d{4}|today \d{2}:\d{2}/);
});

test('the filter column shows the address filter and the call cut by it', async ({ page }) => {
  await page.goto('/logs');
  await expect(page.getByRole('columnheader', { name: 'Filter' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'systems=confluence,jira' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'systems=opensearch&access=write' })).toBeVisible();
  await expect(
    page.getByRole('cell', { name: 'Refused (outside the address filter)' }).first(),
  ).toBeVisible();
  await expect(page.getByRole('cell', { name: 'no filter' }).first()).toBeVisible();

  await page.getByLabel('Result').selectOption({ label: 'Refusals' });
  await expect(
    page.getByRole('cell', { name: 'Refused (outside the address filter)' }).first(),
  ).toBeVisible();
});
