import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { HttpResponse, http } from 'msw';
import { useMockApi } from '../testing/mock-api';
import { button, configureTestApp, text, until } from '../testing/test-app';
import { App } from './app';

describe('App shell', () => {
  const { server, store } = useMockApi();

  async function render() {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    return fixture;
  }

  it('loads the user and shows navigation', async () => {
    configureTestApp();
    const fixture = await render();
    await until(() => expect(text(fixture.nativeElement)).toContain('Jan Kowalski'));
    const nav = fixture.nativeElement.querySelector('nav');
    expect(text(nav)).toContain('Katalog');
    expect(text(nav)).toContain('Moje połączenia');
  });

  it('shows the login screen without a session and redirects to the BFF login', async () => {
    store.update({ session: false });
    const navigation = configureTestApp();
    const fixture = await render();
    await until(() => expect(text(fixture.nativeElement)).toContain('Zaloguj się do Portalu MCP'));
    expect(fixture.nativeElement.querySelector('nav')).toBeNull();

    button('Zaloguj się', fixture.nativeElement).click();
    expect(navigation.assign).toHaveBeenCalledWith('/api/v1/auth/login?returnPath=%2F');
  });

  it('logs out through POST /auth/logout with the CSRF header', async () => {
    configureTestApp();
    const fixture = await render();
    await until(() => expect(text(fixture.nativeElement)).toContain('Jan Kowalski'));

    button('Wyloguj', fixture.nativeElement).click();

    await until(() => expect(text(fixture.nativeElement)).toContain('Wylogowano.'));
    expect(store.state.session).toBe(false);
  });

  it('switches to the login screen when an API call reports an expired session', async () => {
    configureTestApp();
    const fixture = await render();
    await until(() => expect(text(fixture.nativeElement)).toContain('Jan Kowalski'));
    server.use(
      http.get('/api/v1/catalog', () =>
        HttpResponse.json({ error: 'unauthenticated' }, { status: 401 }),
      ),
    );

    await TestBed.inject(Router).navigateByUrl('/catalog');

    await until(() => expect(text(fixture.nativeElement)).toContain('Sesja wygasła.'));
  });

  it('shows a C10 message when GET /me fails for another reason', async () => {
    server.use(
      http.get('/api/v1/me', () => HttpResponse.json({ error: 'internal_error' }, { status: 500 })),
    );
    configureTestApp();
    const fixture = await render();
    await until(() =>
      expect(text(fixture.nativeElement)).toContain('Wystąpił nieoczekiwany błąd.'),
    );
  });
});
