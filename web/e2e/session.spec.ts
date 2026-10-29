import { expect, test } from './fixtures';

test('log out and log in again through the BFF endpoints', async ({ page }) => {
  await page.goto('/connections');
  await expect(page.getByText('Jan Kowalski')).toBeVisible();

  await page.getByRole('button', { name: 'Wyloguj' }).click();
  await expect(page.getByText('Wylogowano.')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Nawigacja główna' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Zaloguj przez konto firmowe' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Serwery MCP' })).toBeVisible();
});

const LOGIN_ERRORS = {
  cancelled: 'Logowanie anulowane.',
  idp_error: 'Usługa logowania nie odpowiada. Spróbuj za chwilę.',
  session_expired: 'Sesja wygasła. Zaloguj się ponownie.',
  step_up_failed: 'Nie udało się potwierdzić tożsamości. Spróbuj zarejestrować ponownie.',
};

for (const [code, message] of Object.entries(LOGIN_ERRORS)) {
  test(`login error ${code} is shown on the login screen`, async ({ page }) => {
    await page.goto(`/?mockSession=out&loginError=${code}`);
    await expect(page.getByRole('button', { name: 'Zaloguj przez konto firmowe' })).toBeVisible();
    await expect(page.getByText(message)).toBeVisible();
  });
}

test('an unknown loginError value shows nothing', async ({ page }) => {
  await page.goto('/?mockSession=out&loginError=%3Cb%3Eboom%3C%2Fb%3E');
  await expect(page.getByRole('button', { name: 'Zaloguj przez konto firmowe' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('connect GitLab through the provider: the result names the system and the account', async ({
  page,
}) => {
  await page.goto('/catalog');
  await page.getByRole('button', { name: 'Połącz (GitLab)' }).click();

  await expect(page.getByText('Połączono z GitLab jako jkowalski.')).toBeVisible();
  await expect(page).toHaveURL(/\/catalog$/);
  const row = page.locator('tbody', { has: page.getByRole('rowheader', { name: 'GitLab' }) });
  await expect(row).toContainText('Połączone');
});

const OAUTH_FAILURES = {
  cancelled: 'Łączenie z GitLab anulowane.',
  flow_invalid: 'Link połączenia wygasł albo był już użyty. Zacznij od nowa.',
  provider_error: 'GitLab nie odpowiedział poprawnie. Spróbuj za chwilę.',
};

for (const [outcome, message] of Object.entries(OAUTH_FAILURES)) {
  test(`return from the provider with ${outcome}`, async ({ page }) => {
    await page.goto(`/catalog?mockOAuth=${outcome}`);
    await page.getByRole('button', { name: 'Połącz (GitLab)' }).click();

    await expect(page.getByRole('alert')).toContainText(message);
    await expect(page).toHaveURL(/\/catalog$/);
    await page.getByRole('button', { name: 'Zamknij komunikat' }).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
  });
}

test('empty and error scenarios, with the request id next to the error', async ({ page }) => {
  await page.goto('/catalog?mockScenario=empty');
  await expect(page.getByText('Nie masz jeszcze dostępu do żadnego serwera MCP')).toBeVisible();

  await page.goto('/connections?mockScenario=errors');
  await expect(page.getByRole('alert')).toContainText('Nie udało się pobrać danych.');
  await expect(page.getByRole('alert')).toContainText('Usługa jest chwilowo niedostępna.');
  await expect(page.getByRole('alert')).toContainText('0192d1b2');
  await expect(page.getByRole('alert')).not.toContainText('0192d1b2-7c3a');
});

test('unknown address shows the 404 state', async ({ page }) => {
  await page.goto('/nie-ma-takiej-strony');
  await expect(page.getByText('Nie ma takiej strony.')).toBeVisible();
  await page.getByRole('link', { name: 'Wróć do serwerów' }).click();
  await expect(page).toHaveURL(/\/catalog$/);
});

test('dialog and snack bar work under the CSP: copy link and disconnect', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/catalog');
  await page.getByRole('button', { name: 'Kopiuj link (Service Desk)' }).click();
  await expect(page.getByText('Skopiowano adres serwera Service Desk.')).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    'https://mcp.aiwcorpo.pl/s/mcp-servicedesk/mcp',
  );

  await page.getByRole('link', { name: 'Połączenia z systemami' }).click();
  await page.getByRole('button', { name: 'Rozłącz (Jira)' }).click();
  const dialog = page.getByRole('dialog', { name: 'Rozłączyć konto Jira?' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Anuluj' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Rozłącz' }).click();
  await expect(page.getByText('Rozłączono konto Jira.')).toBeVisible();
  await expect(page.getByRole('row', { name: /Jira/ })).toContainText('Dodaj token');
});

test('the catalog filter finds a tool and opens its server', async ({ page }) => {
  await page.goto('/catalog');
  await page.getByRole('searchbox', { name: 'Szukaj serwera lub narzędzia' }).fill('delete_issue');
  await expect(page.getByText('jira__delete_issue')).toBeVisible();
  await expect(page.getByRole('rowheader', { name: 'GitLab' })).toHaveCount(0);
  await expect(page.getByText('Wymaga kodu z Authenticatora.')).toBeVisible();
});
