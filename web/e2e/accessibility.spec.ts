import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './fixtures';

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
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      expect(
        results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`),
      ).toEqual([]);
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
