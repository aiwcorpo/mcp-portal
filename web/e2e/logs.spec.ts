import { expect, test } from './fixtures';

test('filter the log, open the details of a call and load more', async ({ page }) => {
  await page.goto('/catalog');
  await page.getByRole('link', { name: 'Logi audytowe' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Logi audytowe' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Logi audytowe' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.getByText('Czeka na potwierdzenie')).toBeVisible();
  await expect(
    page.getByText('Tylko Twoje wywołania. Wartości argumentów nie są tu pokazywane.'),
  ).toBeVisible();

  for (const label of [
    'Anulowane',
    'Unieważnione',
    'Zablokowane przez oczekującą',
    'Potwierdzone kodem',
    'Błędny kod',
    'Wygasło',
  ]) {
    await expect(page.getByRole('cell', { name: label }).first()).toBeVisible();
  }

  const rows = page.locator('tbody tr:not(.details)');
  await expect(rows).toHaveCount(50);
  await page.getByRole('button', { name: 'Pokaż więcej' }).click();
  await expect.poll(() => rows.count()).toBeGreaterThan(50);

  await page.getByLabel('Wynik').selectOption({ label: 'Potwierdzenia kodem' });
  await expect(page.getByRole('cell', { name: 'Wykonano' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Pokaż szczegóły: jira__delete_issue' }).first().click();
  await expect(page.getByTestId('wrong-code-count').first()).toBeVisible();

  await page.getByLabel('Wynik').selectOption({ label: 'Wszystkie wyniki' });
  await page.getByPlaceholder('Szukaj w logach').fill('ABC-1182');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Potwierdzone kodem');
  await page.getByRole('button', { name: 'Pokaż szczegóły: jira__delete_issue' }).click();
  await expect(page.getByTestId('wrong-code-count')).toHaveText('1');
});

test('an error shows once for the whole page', async ({ page }) => {
  await page.goto('/logs?mockScenario=errors');
  await expect(page.getByText('Nie udało się pobrać danych.')).toBeVisible();
  await expect(page.getByRole('table')).toHaveCount(0);
});

test('the log has no horizontal scroll on a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('/logs');
  await expect(page.getByText('Czeka na potwierdzenie')).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test('Service Desk shows the time of its last call from the log', async ({ page }) => {
  await page.goto('/connections');
  const row = page.getByRole('row', { name: /Service Desk/ });
  await expect(row).toContainText(/\d{2}\.\d{2}\.\d{4}|dziś \d{2}:\d{2}/);
});
