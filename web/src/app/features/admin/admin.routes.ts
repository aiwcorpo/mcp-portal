import { Routes } from '@angular/router';

/**
 * Admin views (registry, pending tool definitions with diff, approval) come in a later milestone.
 * The lazy chunk and the canMatch guard in app.routes.ts already exist, so admin code will never be
 * part of the initial bundle and non-admins never download it.
 */
export const ADMIN_ROUTES: Routes = [];
