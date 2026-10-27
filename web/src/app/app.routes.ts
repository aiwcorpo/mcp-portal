import { Routes } from '@angular/router';
import { adminGuard } from './core/admin.guard';

/**
 * Next milestones add: links (virtual servers), requests, activity, confirm/:id and admin children.
 * Each one is a lazy route here; see STATUS.md.
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
