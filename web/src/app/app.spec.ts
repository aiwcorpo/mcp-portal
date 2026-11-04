import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { HttpResponse, http } from 'msw';
import { useMockApi } from '../testing/mock-api';
import { button, configureTestApp, text, until } from '../testing/test-app';
import { App } from './app';
import { routes } from './app.routes';

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
    expect(text(nav)).toContain('MCP servers');
    expect(text(nav)).toContain('System connections');
    expect(text(nav)).toContain('MCP address');
    expect(text(nav)).toContain('Requests');
    expect(text(nav)).not.toContain('Administration');
    expect(button('Sign out', fixture.nativeElement)).toBeTruthy();
  });

  it('shows the login screen without a session and redirects to the BFF login', async () => {
    store.update({ session: false });
    const navigation = configureTestApp();
    const fixture = await render();
    await until(() =>
      expect(text(fixture.nativeElement)).toContain('Sign in with your company account.'),
    );
    expect(fixture.nativeElement.querySelector('nav')).toBeNull();

    button('Sign in with your company account', fixture.nativeElement).click();
    expect(navigation.assign).toHaveBeenCalledWith('/api/v1/auth/login?returnPath=%2F');
  });

  it('logs out through POST /auth/logout with the CSRF header', async () => {
    configureTestApp();
    const fixture = await render();
    await until(() => expect(text(fixture.nativeElement)).toContain('Jan Kowalski'));

    button('Sign out', fixture.nativeElement).click();

    await until(() => expect(text(fixture.nativeElement)).toContain('Signed out.'));
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

    await until(() => expect(text(fixture.nativeElement)).toContain('Session expired.'));
  });

  it('defines no route under the paths the reverse proxy gives to the BFF and the gateway (CC-089)', () => {
    const reserved = ['api', 's', 'v', '.well-known'];
    const first = (path: string | undefined) => (path ?? '').split('/')[0];
    for (const route of routes) {
      expect(reserved).not.toContain(first(route.path));
    }
  });

  it('shows a C10 message when GET /me fails for another reason', async () => {
    server.use(
      http.get('/api/v1/me', () => HttpResponse.json({ error: 'internal_error' }, { status: 500 })),
    );
    configureTestApp();
    const fixture = await render();
    await until(() =>
      expect(text(fixture.nativeElement)).toContain('An unexpected error occurred.'),
    );
  });
});
