import { TestBed } from '@angular/core/testing';
import { RouteConfigLoadEnd, Router } from '@angular/router';
import { http } from 'msw';
import { portalBffExample } from '@aiwcorpo/mcp-contracts/msw';
import { useMockApi } from '../../testing/mock-api';
import { configureTestApp, openRoute, text, until } from '../../testing/test-app';
import { SessionService } from './session.service';

describe('adminGuard', () => {
  const { server } = useMockApi();

  it('does not match /admin for a regular user', async () => {
    configureTestApp();
    await TestBed.inject(SessionService).load();
    await openRoute('/admin');
    await until(() => expect(text()).toContain('Page not found'));
  });

  it('lets an admin load the lazy admin routes', async () => {
    server.use(http.get('/api/v1/me', () => portalBffExample('getMe', 'admin')));
    configureTestApp();
    await TestBed.inject(SessionService).load();
    const loaded: string[] = [];
    const router = TestBed.inject(Router);
    router.events.subscribe((event) => {
      if (event instanceof RouteConfigLoadEnd) {
        loaded.push(String(event.route.path));
      }
    });
    await openRoute('/admin');
    expect(loaded).toContain('admin');
  });
});
