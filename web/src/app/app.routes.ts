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
    title: $localize`:@@route.catalog:Katalog`,
    loadComponent: () => import('./features/catalog/catalog-page').then((m) => m.CatalogPage),
  },
  {
    path: 'connect/:system',
    title: $localize`:@@route.connect:Połącz konto`,
    loadComponent: () => import('./features/connect/connect-page').then((m) => m.ConnectPage),
  },
  {
    path: 'connections',
    title: $localize`:@@route.connections:Moje połączenia`,
    loadComponent: () =>
      import('./features/connections/connections-page').then((m) => m.ConnectionsPage),
  },
  {
    path: 'endpoint',
    title: $localize`:@@route.endpoint:Adres MCP`,
    loadComponent: () => import('./features/endpoint/endpoint-page').then((m) => m.EndpointPage),
  },
  // The saved links of 4.x are gone (CC-175); bookmarks land on the single address page.
  { path: 'links', pathMatch: 'full', redirectTo: 'endpoint' },
  { path: 'links/:slug', redirectTo: 'endpoint' },
  {
    path: 'requests',
    title: $localize`:@@route.requests:Wnioski`,
    loadComponent: () => import('./features/requests/requests-page').then((m) => m.RequestsPage),
  },
  {
    path: 'logs',
    title: $localize`:@@route.logs:Logi audytowe`,
    loadComponent: () => import('./features/logs/logs-page').then((m) => m.LogsPage),
  },
  {
    path: 'authenticator',
    pathMatch: 'full',
    title: $localize`:@@route.authenticatorMfa:Rejestracja Authenticatora`,
    loadComponent: () =>
      import('./features/authenticator/register-page').then((m) => m.AuthenticatorRegisterPage),
  },
  {
    path: 'authenticator/register',
    title: $localize`:@@route.authenticatorRegister:Rejestracja Authenticatora`,
    loadComponent: () =>
      import('./features/authenticator/register-page').then((m) => m.AuthenticatorRegisterPage),
  },
  {
    path: 'confirm/:id',
    title: $localize`:@@route.confirm:Operacja czeka na kod`,
    loadComponent: () => import('./features/confirm/confirm-page').then((m) => m.ConfirmPage),
  },
  {
    path: 'admin',
    canMatch: [adminGuard],
    loadChildren: () => import('./features/admin/admin.routes').then((m) => m.ADMIN_ROUTES),
  },
  {
    path: '**',
    title: $localize`:@@route.notFound:Nie znaleziono`,
    loadComponent: () => import('./features/not-found/not-found-page').then((m) => m.NotFoundPage),
  },
];
