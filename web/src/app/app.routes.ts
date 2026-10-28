import { Routes } from '@angular/router';
import { adminGuard } from './core/admin.guard';

/**
 * No route starts with /api, /s/, /v/ or /.well-known/: the reverse proxy sends those to the BFF and the
 * gateway (CC-089). Later milestones add requests and admin children.
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
    path: 'links',
    title: $localize`:@@route.links:Moje linki`,
    loadComponent: () => import('./features/links/links-page').then((m) => m.LinksPage),
  },
  {
    path: 'links/new',
    title: $localize`:@@route.linksNew:Nowy link`,
    loadComponent: () => import('./features/links/link-wizard-page').then((m) => m.LinkWizardPage),
  },
  {
    path: 'links/:slug',
    title: $localize`:@@route.linkConfig:Konfiguracja linku`,
    loadComponent: () => import('./features/links/link-config-page').then((m) => m.LinkConfigPage),
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
