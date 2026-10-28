import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

async function expectNoViolations(page: Page): Promise<void> {
  // Material fades messages in; axe would measure contrast mid-transition.
  // Only finite animations are awaited (a looping one never finishes); one cancelled meanwhile rejects `finished`.
  // The wait is capped: an animation that is paused never finishes either.
  await page.evaluate(() =>
    Promise.race([
      Promise.all(
        document
          .getAnimations()
          .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
          .map((a) => a.finished.catch(() => undefined)),
      ),
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]),
  );

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

/** The portal is dark by default (mockups); light is an opt-in through the header button. */
async function useScheme(page: Page, scheme: 'light' | 'dark'): Promise<void> {
  const toggle = page.getByRole('button', { name: 'Tryb ciemny' });
  const isDark = (await toggle.getAttribute('aria-pressed')) === 'true';
  if ((scheme === 'dark') !== isDark) {
    await toggle.click();
  }
}

const PAGES = [
  { path: '/catalog', ready: 'Serwery MCP' },
  { path: '/connect/jira', ready: 'Połącz Jira' },
  { path: '/connections', ready: 'Połączenia z systemami' },
  { path: '/authenticator/register', ready: 'Zarejestruj Authenticator' },
  { path: '/links', ready: 'Moje linki' },
  { path: '/links/new', ready: 'Nowy link' },
  { path: '/links/przeglad-zgloszen', ready: 'Konfiguracja linku "Przegląd zgłoszeń"' },
];

for (const scheme of ['dark', 'light'] as const) {
  for (const { path, ready } of PAGES) {
    test(`${path} has no WCAG 2.1 AA violations (${scheme})`, async ({ page }) => {
      await page.goto(path);
      await useScheme(page, scheme);
      await expect(page.getByRole('heading', { level: 1, name: ready })).toBeVisible();
      const closed = page.getByRole('button', { name: /^Pokaż narzędzia/ });
      for (let left = await closed.count(); left > 0; left = await closed.count()) {
        await closed.first().click();
        await expect(closed).toHaveCount(left - 1);
      }
      await expectNoViolations(page);
    });
  }

  test(`the registration steps and every Authenticator state have no violations (${scheme})`, async ({
    page,
  }) => {
    await page.goto('/authenticator/register');
    await useScheme(page, scheme);
    await page.getByRole('button', { name: 'Dalej' }).click();
    await expect(page.getByTestId('enrollment-key')).toBeVisible();
    await expectNoViolations(page);
    await page.getByRole('button', { name: 'Dalej' }).click();
    await page.getByLabel('Kod z aplikacji (6 cyfr)').fill('000000');
    await page.getByRole('button', { name: 'Sprawdź' }).click();
    await expect(page.getByText('Kod nieprawidłowy.')).toBeVisible();
    await expectNoViolations(page);
    for (const state of ['none', 'active', 'locked', 'disabled']) {
      await page.goto(`/connections?mockAuthenticator=${state}`);
      await expect(page.getByRole('heading', { name: 'Authenticator' })).toBeVisible();
      await expectNoViolations(page);
    }
    await page.goto('/catalog?mockAuthenticator=none');
    await expect(page.getByText('Narzędzia "Usuwanie" wymagają kodu')).toBeVisible();
    await expectNoViolations(page);
  });

  test(`the tool step of the wizard and the ready step have no violations (${scheme})`, async ({
    page,
  }) => {
    await page.goto('/links/new');
    await useScheme(page, scheme);
    await page.getByLabel('Nazwa').fill('Zestaw a11y');
    await page.getByRole('button', { name: 'Dalej' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Wybierz narzędzia' })).toBeVisible();
    await page.getByRole('checkbox', { name: /jira__get_issue/ }).check();
    await expectNoViolations(page);

    await page.getByRole('button', { name: 'Utwórz link' }).click();
    await expect(page.getByRole('heading', { level: 1, name: /jest gotowy/ })).toBeVisible();
    await expectNoViolations(page);
  });

  test(`states without data have no violations (${scheme})`, async ({ page }) => {
    await page.goto('/catalog?mockScenario=errors');
    await useScheme(page, scheme);
    await expect(page.getByRole('alert')).toContainText('Nie udało się pobrać danych.');
    await expectNoViolations(page);

    await page.goto('/catalog?mockScenario=empty');
    await expect(page.getByText('Nie masz jeszcze dostępu do żadnego serwera MCP')).toBeVisible();
    await expectNoViolations(page);

    await page.goto('/links?mockScenario=nolinks');
    await expect(page.getByText('Nie masz jeszcze żadnych linków')).toBeVisible();
    await expectNoViolations(page);

    await page.goto('/nie-ma-takiej-strony');
    await expect(page.getByText('Nie ma takiej strony.')).toBeVisible();
    await expectNoViolations(page);

    await page.goto('/?mockSession=out&loginError=idp_error');
    await expect(page.getByText('Usługa logowania nie odpowiada.')).toBeVisible();
    await expectNoViolations(page);
  });

  test(`form errors, return banners and dialogs have no violations (${scheme})`, async ({
    page,
  }) => {
    await page.goto('/connect/jira');
    await useScheme(page, scheme);
    await page.getByRole('button', { name: 'Sprawdź i zapisz' }).click();
    await expect(page.getByText('Wklej token.')).toBeVisible();
    await expectNoViolations(page);

    await page.getByLabel('Token PAT', { exact: true }).fill('invalid-a11y');
    await page.getByRole('button', { name: 'Sprawdź i zapisz' }).click();
    await expect(page.getByText('Token nieprawidłowy albo wygasł.')).toBeVisible();
    await expectNoViolations(page);

    await page.goto('/catalog?mockOAuth=provider_error');
    await page.getByRole('button', { name: 'Połącz (GitLab)' }).click();
    await expect(page.getByRole('alert')).toContainText('GitLab nie odpowiedział poprawnie');
    await expectNoViolations(page);

    await page.goto('/connections');
    await page.getByRole('button', { name: 'Rozłącz (Jira)' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expectNoViolations(page);
  });
}

test('keyboard only: skip link, tabs, row toggle and an action', async ({ page }) => {
  await page.goto('/catalog');
  await expect(page.getByRole('rowheader', { name: 'GitLab' })).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Przejdź do treści' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main')).toBeFocused();

  const toggle = page.getByRole('button', { name: 'Pokaż narzędzia (Jira)' });
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Ukryj narzędzia (Jira)' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await expect(page.getByText('jira__search_issues')).toBeVisible();

  const renew = page.getByRole('button', { name: 'Odnów (Jira)' });
  await renew.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/connect\/jira$/);
});

test('keyboard only: the wizard can be completed', async ({ page }) => {
  await page.goto('/links/new');
  await page.getByLabel('Nazwa').focus();
  await page.keyboard.type('Z klawiatury');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'Wybierz narzędzia' })).toBeVisible();
  await page.getByRole('checkbox', { name: /jira__get_issue/ }).focus();
  await page.keyboard.press('Space');
  await expect(page.getByText('Wybrano: 1')).toBeVisible();
  await page.getByRole('button', { name: 'Utwórz link' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: /jest gotowy/ })).toBeVisible();
});

test('no horizontal scroll at 360 px and no cut-off tab names', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  for (const { path, ready } of PAGES) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: ready })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow, path).toBeLessThanOrEqual(0);

    const cutOff = await page.evaluate(
      () =>
        Array.from(document.querySelectorAll('nav a')).filter((a) => {
          const box = a.getBoundingClientRect();
          return box.right > window.innerWidth || a.scrollWidth > a.clientWidth + 1;
        }).length,
    );
    expect(cutOff, `${path}: tab names`).toBe(0);
  }
});

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
  await page.getByRole('link', { name: 'Połączenia z systemami' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Połączenia z systemami' }),
  ).toBeVisible();
  await expect(page.locator('#main')).toBeFocused();
});
