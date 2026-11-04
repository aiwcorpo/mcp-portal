import { Routes } from '@angular/router';
import { adminGuard } from './core/admin.guard';

/**
 * No route starts with /api, /mcp, /s/, /v/ or /.well-known/: the reverse proxy sends those to the BFF and the
 * gateway (CC-089, CC-169).
 */
export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'catalog' },
  {
    path: 'catalog',
    title: $localize`:@@route.catalog:MCP servers`,
    loadComponent: () => import('./features/catalog/catalog-page').then((m) => m.CatalogPage),
  },
  {
    path: 'connect/:system',
    title: $localize`:@@route.connect:Connect account`,
    loadComponent: () => import('./features/connect/connect-page').then((m) => m.ConnectPage),
  },
  {
    path: 'connections',
    title: $localize`:@@route.connections:My connections`,
    loadComponent: () =>
      import('./features/connections/connections-page').then((m) => m.ConnectionsPage),
  },
  {
    path: 'endpoint',
    title: $localize`:@@route.endpoint:MCP address`,
    loadComponent: () => import('./features/endpoint/endpoint-page').then((m) => m.EndpointPage),
  },
  // The saved links of 4.x are gone (CC-175); bookmarks land on the single address page.
  { path: 'links', pathMatch: 'full', redirectTo: 'endpoint' },
  { path: 'links/:slug', redirectTo: 'endpoint' },
  {
    path: 'requests',
    title: $localize`:@@route.requests:Requests`,
    loadComponent: () => import('./features/requests/requests-page').then((m) => m.RequestsPage),
  },
  {
    path: 'logs',
    title: $localize`:@@route.logs:Audit logs`,
    loadComponent: () => import('./features/logs/logs-page').then((m) => m.LogsPage),
  },
  {
    path: 'authenticator',
    pathMatch: 'full',
    title: $localize`:@@route.authenticatorMfa:Authenticator registration`,
    loadComponent: () =>
      import('./features/authenticator/register-page').then((m) => m.AuthenticatorRegisterPage),
  },
  {
    path: 'authenticator/register',
    title: $localize`:@@route.authenticatorRegister:Authenticator registration`,
    loadComponent: () =>
      import('./features/authenticator/register-page').then((m) => m.AuthenticatorRegisterPage),
  },
  {
    path: 'confirm/:id',
    title: $localize`:@@route.confirm:Operation waiting for a code`,
    loadComponent: () => import('./features/confirm/confirm-page').then((m) => m.ConfirmPage),
  },
  {
    path: 'admin',
    canMatch: [adminGuard],
    loadChildren: () => import('./features/admin/admin.routes').then((m) => m.ADMIN_ROUTES),
  },
  {
    path: '**',
    title: $localize`:@@route.notFound:Not found`,
    loadComponent: () => import('./features/not-found/not-found-page').then((m) => m.NotFoundPage),
  },
];
