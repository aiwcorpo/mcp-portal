import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { HttpResponse, http } from 'msw';
import { useMockApi } from '../../../testing/mock-api';
import { button, configureTestApp, openRoute, text, until } from '../../../testing/test-app';

function row(name: string): HTMLElement {
  const header = Array.from(document.querySelectorAll('tbody th')).find(
    (th) => th.textContent?.trim() === name,
  );
  const tr = header?.closest('tr');
  if (!tr) {
    throw new Error(`no row ${name}`);
  }
  return tr;
}

describe('LinksPage', () => {
  const { server, store } = useMockApi();

  it('lists the links with identifier and tool count', async () => {
    configureTestApp();
    await openRoute('/links');
    await until(() => expect(text()).toContain('Przegląd zgłoszeń'));

    expect(text()).toContain('Własne zestawy narzędzi pod jednym adresem dla agenta.');
    expect(text(row('Przegląd zgłoszeń'))).toContain('przeglad-zgloszen');
    expect(row('Przegląd zgłoszeń').querySelector('.slug')?.className).toContain('mono');
    expect(text(row('Przegląd zgłoszeń'))).toContain('4');
    expect(text(row('Przegląd zgłoszeń'))).toContain('Pokaż konfigurację');
    expect(text()).not.toContain('Zawężenie');
  });

  it('shows the empty state with a way to create the first link', async () => {
    store.update({ scenario: 'nolinks' });
    configureTestApp();
    await openRoute('/links');
    await until(() => expect(text()).toContain('Nie masz jeszcze żadnych linków'));
    expect(text()).toContain('Wklejasz jego adres w Claude Code, Copilot albo Codex.');
    expect(document.querySelector('a[href="/links/new"]')).toBeTruthy();
  });

  it('deletes after confirmation, naming the path that stops working', async () => {
    configureTestApp();
    const harness = await openRoute('/links');
    await until(() => expect(text()).toContain('Przegląd zgłoszeń'));

    button('Usuń (Przegląd zgłoszeń)').click();
    await harness.fixture.whenStable();
    const dialog = document.querySelector('mat-dialog-container')!;
    expect(text(dialog)).toContain('Usunąć link "Przegląd zgłoszeń"?');
    expect(text(dialog)).toContain('/v/przeglad-zgloszen/mcp');
    expect(text(dialog)).toContain('Tego nie można cofnąć.');
    button('Usuń link', dialog).click();

    await until(() => expect(text()).toContain('Usunięto link "Przegląd zgłoszeń".'));
    await until(() => expect(text()).not.toContain('przeglad-zgloszen'));
    expect(store.state.links?.map((link) => link.slug)).toEqual(['podglad-serwisowy']);
  });

  it('keeps the link when the dialog is cancelled', async () => {
    configureTestApp();
    const harness = await openRoute('/links');
    await until(() => expect(text()).toContain('Przegląd zgłoszeń'));

    button('Usuń (Przegląd zgłoszeń)').click();
    await harness.fixture.whenStable();
    button('Anuluj', document.querySelector('mat-dialog-container')!).click();

    await until(() => expect(document.querySelector('mat-dialog-container')).toBeNull());
    expect(store.state.links).toBeNull();
  });

  it('shows the failure of a delete', async () => {
    server.use(
      http.delete('/api/v1/virtual-servers/:slug', () =>
        HttpResponse.json({ error: 'upstream_unavailable' }, { status: 503 }),
      ),
    );
    configureTestApp();
    const harness = await openRoute('/links');
    await until(() => expect(text()).toContain('Przegląd zgłoszeń'));

    button('Usuń (Przegląd zgłoszeń)').click();
    await harness.fixture.whenStable();
    button('Usuń link', document.querySelector('mat-dialog-container')!).click();

    await until(() => expect(text()).toContain('Usługa jest chwilowo niedostępna.'));
    expect(text()).toContain('Przegląd zgłoszeń');
  });

  it('shows a load failure and retries', async () => {
    store.update({ scenario: 'errors' });
    configureTestApp();
    await openRoute('/links');
    await until(() => expect(text()).toContain('Nie udało się pobrać danych.'));
    expect(text()).toContain('0192d1b2');
  });
});

describe('LinkConfigPage', () => {
  useMockApi();

  it('shows the URL and the three client configurations of an existing link', async () => {
    configureTestApp();
    await openRoute('/links/przeglad-zgloszen');
    await until(() => expect(text()).toContain('Konfiguracja linku "Przegląd zgłoszeń"'));

    expect(document.querySelector<HTMLInputElement>('#link-url')?.value).toBe(
      'https://mcp.aiwcorpo.pl/v/przeglad-zgloszen/mcp',
    );
    expect(text()).toContain('Claude Code');
    expect(text()).toContain('Copilot');
    expect(text()).toContain('Codex');
    expect(text()).toContain(
      'claude mcp add --transport http przeglad-zgloszen https://mcp.aiwcorpo.pl/v/przeglad-zgloszen/mcp',
    );
    expect(text()).toContain('Konfiguracja nie zawiera tokenu ani hasła.');
    expect(text()).toContain('jira__search_issues, jira__get_issue');
  });

  it('says so when the link does not exist', async () => {
    configureTestApp();
    await openRoute('/links/nie-ma-takiego');
    await until(() => expect(text()).toContain('Nie ma takiej strony.'));
    expect(TestBed.inject(Router).url).toBe('/links/nie-ma-takiego');
  });
});
