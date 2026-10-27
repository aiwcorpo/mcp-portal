import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

async function expectNoViolations(page: Page): Promise<void> {
  // Material fades messages in; axe would measure contrast mid-transition.
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(
    results.violations.map(
      (v) =>
        `${v.id}: ${v.nodes.map((n) => `${String(n.target)} ${n.any.map((c) => c.message).join(' ')}`).join(', ')}`,
    ),
  ).toEqual([]);
}

const PAGES = [
  { path: '/catalog', ready: 'Katalog serwerów MCP' },
  { path: '/connect/gitlab', ready: 'Połącz konto: GitLab' },
  { path: '/connections', ready: 'Moje połączenia' },
];

for (const scheme of ['light', 'dark'] as const) {
  for (const { path, ready } of PAGES) {
    test(`${path} has no WCAG 2.1 AA violations (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1, name: ready })).toBeVisible();
      const toggle = page.getByRole('button', { name: /^Pokaż narzędzia/ }).first();
      if (await toggle.isVisible()) {
        await toggle.click();
      }
      await expectNoViolations(page);
    });
  }
}

test('keyboard only: skip link, catalog action and token form', async ({ page }) => {
  await page.goto('/catalog');
  await expect(page.getByRole('heading', { level: 2, name: 'GitLab' })).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Przejdź do treści' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main')).toBeFocused();

  const addToken = page.getByRole('button', { name: 'Dodaj token (GitLab)' });
  for (
    let i = 0;
    i < 20 && !(await addToken.evaluate((el) => el === document.activeElement));
    i++
  ) {
    await page.keyboard.press('Tab');
  }
  await expect(addToken).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/connect\/gitlab$/);
});

test('no horizontal scroll at 360 px', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  for (const { path, ready } of PAGES) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: ready })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow, path).toBeLessThanOrEqual(0);
  }
});

for (const scheme of ['light', 'dark'] as const) {
  test(`states without data have no WCAG 2.1 AA violations (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });

    await page.goto('/catalog?mockScenario=errors');
    await expect(page.getByRole('alert')).toContainText('Usługa jest chwilowo niedostępna.');
    await expectNoViolations(page);

    await page.goto('/connections?mockScenario=empty');
    await expect(page.getByText('Nie masz połączonych kont.')).toBeVisible();
    await expectNoViolations(page);
    await page.goto('/catalog?mockScenario=default');
    await expect(page.getByRole('heading', { level: 2, name: 'GitLab' })).toBeVisible();
  });

  test(`form states and the dialog have no WCAG 2.1 AA violations (${scheme})`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('/connect/gitlab');
    await page.getByRole('button', { name: 'Zapisz token' }).click();
    await expect(page.getByText('Wklej token.')).toBeVisible();
    await expectNoViolations(page);

    await page.getByLabel('Token', { exact: true }).fill('glpat-e2e-a11y');
    await page.getByRole('button', { name: 'Zapisz token' }).click();
    await expect(page.getByRole('button', { name: 'Uwierzytelnij ponownie' })).toBeVisible();
    await expectNoViolations(page);

    await page.goto('/connections');
    await page.getByRole('button', { name: 'Odłącz (Jira)' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expectNoViolations(page);
  });
}

test('320 px: no WCAG 2.1 AA violations and no horizontal scroll', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  for (const { path, ready } of PAGES) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: ready })).toBeVisible();
    await expectNoViolations(page);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow, path).toBeLessThanOrEqual(0);
  }
});

test('focus moves to the main content after an in-app navigation', async ({ page }) => {
  await page.goto('/catalog');
  await page.getByRole('link', { name: 'Moje połączenia' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Moje połączenia' })).toBeVisible();
  await expect(page.locator('#main')).toBeFocused();
});
