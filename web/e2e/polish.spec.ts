import { expect, test } from './fixtures';

// The only suite in Polish: the translation file loads, the texts come from it and the switch works both ways.
// Everything else runs in English, the source language.
test.use({ locale: 'pl-PL' });

test('a Polish browser gets the Polish texts, and the switch changes and remembers the language', async ({
  page,
}) => {
  // Angular logs a rendering error (a date pipe without locale data, a broken translation) to the console only.
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(message.text());
    }
  });
  await page.goto('/connections?mockAuthenticator=active');
  await expect(page.getByText(/Aktywny · od \d{2}\.\d{2}\.\d{4}/)).toBeVisible();
  await page.goto('/catalog');
  await expect(page.locator('html')).toHaveAttribute('lang', 'pl');
  const navigation = page.getByRole('navigation', { name: 'Nawigacja główna' });
  await expect(navigation.getByRole('link', { name: 'Połączenia z systemami' })).toBeVisible();
  await expect(page.getByRole('rowheader', { name: 'Gitlab' })).toBeVisible();

  await page.getByRole('link', { name: 'Wnioski' }).click();
  await expect(page.getByRole('button', { name: 'Złóż wniosek' })).toBeVisible();

  await page.getByRole('button', { name: 'English' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('button', { name: 'Submit request' })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('button', { name: 'Submit request' })).toBeVisible();
  await page.getByRole('button', { name: 'Polski' }).click();
  await expect(page.getByRole('button', { name: 'Złóż wniosek' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('the sign-in screen is translated and offers the switch', async ({ page }) => {
  await page.goto('/?mockSession=out');
  await expect(page.getByRole('button', { name: 'Zaloguj przez konto firmowe' })).toBeVisible();
  await page.getByRole('button', { name: 'English' }).click();
  await expect(
    page.getByRole('button', { name: 'Sign in with your company account' }),
  ).toBeVisible();
});

test('login errors and route titles are translated', async ({ page }) => {
  await page.goto('/?mockSession=out&loginError=cancelled');
  await expect(page.getByText('Logowanie anulowane.')).toBeVisible();
  await page.goto('/logs?mockSession=in');
  await expect(page).toHaveTitle(/Logi audytowe/);
});
