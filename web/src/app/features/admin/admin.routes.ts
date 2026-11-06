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
  {
    path: 'servers',
    title: $localize`:@@route.adminServers:Servers`,
    loadComponent: () => import('./servers-page').then((m) => m.ServersPage),
  },
  {
    path: 'systems',
    title: $localize`:@@route.adminSystems:Systems`,
    loadComponent: () => import('./systems-page').then((m) => m.SystemsPage),
  },
  {
    path: 'scope-mapping',
    title: $localize`:@@route.scopeMapping:Scope mapping`,
    loadComponent: () => import('./scope-mapping-page').then((m) => m.ScopeMappingPage),
  },
  {
    path: 'overrides',
    title: $localize`:@@route.overrides:Overrides`,
    loadComponent: () => import('./overrides-page').then((m) => m.OverridesPage),
  },
  {
    path: 'kill-switches',
    title: $localize`:@@route.killSwitches:Emergency switches`,
    loadComponent: () => import('./kill-switches-page').then((m) => m.KillSwitchesPage),
  },
];
