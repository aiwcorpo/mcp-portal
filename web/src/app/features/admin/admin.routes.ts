import { Routes } from '@angular/router';

/**
 * Lazy chunk behind the canMatch guard in app.routes.ts: admin code is never part of the initial bundle and
 * non-admins never download it. The BFF checks the admin right again on every admin endpoint.
 */
export const ADMIN_ROUTES: Routes = [
  {
    path: '',
    title: $localize`:@@route.admin:Administracja`,
    loadComponent: () => import('./admin-page').then((m) => m.AdminPage),
  },
];
