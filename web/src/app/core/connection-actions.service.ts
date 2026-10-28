import { Injectable, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import {
  AccessRequestsService,
  CatalogTool,
  ConnectionsService,
  PortalCatalogServer,
  SystemId,
} from '../api/generated';
import { ConfirmDialog, ConfirmDialogData } from '../shared/confirm-dialog';
import { systemName } from '../shared/labels';
import { oauthReturnPath } from '../shared/oauth-return';
import { ApiFailure, toApiFailure } from './api-error';
import { isAllowedRedirect } from './auth-urls';
import { BrowserNavigation } from './browser-navigation';

export type AccessRequestResult =
  | { kind: 'redirected' }
  | { kind: 'created'; requestId: string }
  | { kind: 'unavailable' }
  | { kind: 'failed'; failure: ApiFailure };

/**
 * The entitlement to ask for. With a tool (the wizard: the one that was clicked) it is that tool's;
 * without one (a whole server row) the first denied tool's. Any one of a tool's entitlements grants it.
 */
export function entitlementToRequest(
  server: PortalCatalogServer,
  tool?: CatalogTool,
): string | null {
  if (tool) {
    return tool.requiredEntitlements[0] ?? null;
  }
  for (const candidate of server.tools) {
    if (candidate.access === 'denied' && candidate.requiredEntitlements.length) {
      return candidate.requiredEntitlements[0];
    }
  }
  return null;
}

export type DisconnectResult =
  { kind: 'cancelled' } | { kind: 'done' } | { kind: 'failed'; failure: ApiFailure };

/** Connect and disconnect flows shared by the catalog, the connect page and My connections. */
@Injectable({ providedIn: 'root' })
export class ConnectionActions {
  private readonly connectionsApi = inject(ConnectionsService);
  private readonly accessRequestsApi = inject(AccessRequestsService);
  private readonly dialog = inject(MatDialog);
  private readonly navigation = inject(BrowserNavigation);
  private readonly router = inject(Router);

  /**
   * Sends the browser to the provider; returns a failure only when it stays on the page. The return
   * path carries the system so that the page can name it when the provider reports a failure.
   */
  async startOAuth(system: SystemId, returnPage: string): Promise<ApiFailure | null> {
    try {
      const { authorizeUrl } = await firstValueFrom(
        this.connectionsApi.startConnectOAuth(system, {
          returnPath: oauthReturnPath(returnPage, system),
        }),
      );
      if (!isAllowedRedirect(authorizeUrl)) {
        return { code: 'internal_error', status: 200 };
      }
      this.navigation.assign(authorizeUrl);
      return null;
    } catch (error) {
      return toApiFailure(error);
    }
  }

  /**
   * Connect, renew or reconnect: an OAuth connection goes straight to the provider (the catalog says
   * `reconnect` without saying how, so the connection type decides); a token needs the form.
   */
  async connect(
    server: PortalCatalogServer,
    action: 'connect_oauth' | 'add_secret' | 'reconnect',
    returnPage: string,
  ): Promise<ApiFailure | null> {
    const viaOAuth =
      action === 'connect_oauth' ||
      (action === 'reconnect' && server.connection?.type === 'user-oauth');
    if (viaOAuth) {
      return this.startOAuth(server.system, returnPage);
    }
    await this.router.navigate(['/connect', server.system]);
    return null;
  }

  /** The IGA either hands back a form to open (https only) or creates the request itself (C13). */
  async requestAccess(
    server: PortalCatalogServer,
    tool?: CatalogTool,
  ): Promise<AccessRequestResult> {
    const entitlement = entitlementToRequest(server, tool);
    if (!entitlement) {
      return { kind: 'unavailable' };
    }
    try {
      const result = await firstValueFrom(
        this.accessRequestsApi.createAccessRequest({ entitlement }),
      );
      if ('requestUrl' in result) {
        if (!isAllowedRedirect(result.requestUrl)) {
          return { kind: 'failed', failure: { code: 'internal_error', status: 200 } };
        }
        this.navigation.assign(result.requestUrl);
        return { kind: 'redirected' };
      }
      return { kind: 'created', requestId: result.requestId };
    } catch (error) {
      return { kind: 'failed', failure: toApiFailure(error) };
    }
  }

  async confirmAndDisconnect(system: SystemId): Promise<DisconnectResult> {
    const name = systemName(system);
    const confirmed = await firstValueFrom(
      this.dialog
        .open<ConfirmDialog, ConfirmDialogData, boolean>(ConfirmDialog, {
          data: {
            title: $localize`:@@disconnect.title:Rozłączyć konto ${name}:system:?`,
            message: $localize`:@@disconnect.message:Portal usunie zapisane poświadczenie. Narzędzia tego systemu przestaną działać, dopóki nie połączysz konta ponownie.`,
            confirmLabel: $localize`:@@disconnect.confirm:Rozłącz`,
            destructive: true,
          },
        })
        .afterClosed(),
    );
    if (!confirmed) {
      return { kind: 'cancelled' };
    }
    try {
      await firstValueFrom(this.connectionsApi.disconnect(system));
      return { kind: 'done' };
    } catch (error) {
      return { kind: 'failed', failure: toApiFailure(error) };
    }
  }
}

export function disconnectedMessage(system: SystemId): string {
  return $localize`:@@disconnect.done:Rozłączono konto ${systemName(system)}:system:.`;
}
