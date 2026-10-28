import { expect, test } from './fixtures';

test('create a link, then copy the Claude Code, Copilot and Codex configuration', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/links');
  await expect(page.getByRole('rowheader', { name: 'Przegląd zgłoszeń' })).toBeVisible();
  await page.getByRole('link', { name: 'Nowy link' }).click();

  await page.getByLabel('Nazwa').fill('Mój zestaw');
  await expect(page.getByLabel('Identyfikator')).toHaveValue('moj-zestaw');
  await page.getByRole('button', { name: 'Dalej' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Wybierz narzędzia' })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /gitlab__get_project/ })).toBeDisabled();
  await expect(page.getByText('Narzędzie wyłączone przez administratora.')).toBeVisible();
  await expect(
    page.getByText('Konto niepołączone').or(page.getByText('Wymaga ponownego połączenia')).first(),
  ).toBeVisible();
  await page.getByRole('checkbox', { name: /jira__search_issues/ }).check();
  await page.getByRole('checkbox', { name: /jira__get_issue/ }).check();
  await expect(page.getByText('Wybrano: 2')).toBeVisible();
  await page.getByRole('button', { name: 'Utwórz link' }).click();

  await expect(
    page.getByRole('heading', { level: 1, name: 'Link "Mój zestaw" jest gotowy' }),
  ).toBeVisible();
  const url = 'https://mcp.aiwcorpo.pl/v/moj-zestaw/mcp';
  await expect(page.getByLabel('Adres linku')).toHaveValue(url);
  await expect(page.getByText('Konfiguracja nie zawiera tokenu ani hasła.')).toBeVisible();

  await page.getByRole('button', { name: 'Kopiuj adres linku' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);

  await page.getByRole('button', { name: 'Kopiuj (Claude Code)' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    `claude mcp add --transport http --client-id claude-code --callback-port 33418 moj-zestaw ${url}`,
  );

  await page.getByRole('tab', { name: 'Copilot' }).click();
  await page.getByRole('button', { name: 'Kopiuj (Copilot)' }).click();
  expect(JSON.parse(await page.evaluate(() => navigator.clipboard.readText()))).toEqual({
    servers: { 'moj-zestaw': { type: 'http', url } },
  });

  await page.getByRole('tab', { name: 'Codex' }).click();
  await page.getByRole('button', { name: 'Kopiuj (Codex)' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    `[mcp_servers.moj-zestaw]\nurl = "${url}"\n`,
  );

  await page.getByRole('button', { name: 'Wróć do listy' }).click();
  await expect(page.getByRole('rowheader', { name: 'Mój zestaw' })).toBeVisible();
  await page.getByRole('link', { name: 'Pokaż konfigurację (Mój zestaw)' }).click();
  await expect(page.getByLabel('Adres linku')).toHaveValue(url);
});

test("a taken identifier is caught locally and, for somebody else's link, by the 409", async ({
  page,
}) => {
  await page.goto('/links/new');
  await page.getByLabel('Nazwa').fill('Przegląd zgłoszeń');
  await page.getByRole('button', { name: 'Dalej' }).click();
  await expect(page.getByText('Ten identyfikator jest już zajęty. Wybierz inny.')).toBeVisible();

  await page.getByLabel('Identyfikator').fill('team-a-dev');
  await page.getByRole('button', { name: 'Dalej' }).click();
  await page.getByRole('checkbox', { name: /jira__get_issue/ }).check();
  await page.getByRole('button', { name: 'Utwórz link' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Nowy link' })).toBeVisible();
  await expect(page.getByText('Ten identyfikator jest już zajęty. Wybierz inny.')).toBeVisible();
  await page.getByLabel('Identyfikator').fill('team-a-dev-2');
  await page.getByRole('button', { name: 'Dalej' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Wybierz narzędzia' })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /jira__get_issue/ })).toBeChecked();
});

test('delete a link after confirmation; an empty list invites to create one', async ({ page }) => {
  await page.goto('/links?mockScenario=nolinks');
  await expect(page.getByText('Nie masz jeszcze żadnych linków')).toBeVisible();

  await page.goto('/links?mockScenario=default');
  await page.getByRole('button', { name: 'Usuń (Podgląd zgłoszeń serwisowych)' }).click();
  const dialog = page.getByRole('dialog', { name: 'Usunąć link "Podgląd zgłoszeń serwisowych"?' });
  await expect(dialog).toContainText('/v/podglad-serwisowy/mcp');
  await dialog.getByRole('button', { name: 'Usuń link' }).click();
  await expect(page.getByText('Usunięto link "Podgląd zgłoszeń serwisowych".')).toBeVisible();
  await expect(page.getByRole('rowheader', { name: 'Podgląd zgłoszeń serwisowych' })).toHaveCount(
    0,
  );

  await page.getByRole('button', { name: 'Usuń (Przegląd zgłoszeń)' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Usuń link' }).click();
  await expect(page.getByText('Nie masz jeszcze żadnych linków')).toBeVisible();
});
