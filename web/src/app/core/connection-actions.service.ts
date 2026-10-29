import { Injectable, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { CatalogTool, ConnectionsService, PortalCatalogServer, SystemId } from '../api/generated';
import { ConfirmDialog, ConfirmDialogData } from '../shared/confirm-dialog';
import { systemName } from '../shared/labels';
import { ApiFailure, toApiFailure } from './api-error';
import { isAllowedRedirect } from './auth-urls';
import { BrowserNavigation } from './browser-navigation';
import { AccessRequestFlow, AccessRequestResult } from './access-request-flow';
import { RequestDialog, RequestDialogData } from '../features/requests/request-dialog';

/** Any one of the entitlements a tool names grants it, so the first is asked for. */
export function entitlementToRequest(tool: CatalogTool): string | null {
  return tool.requiredEntitlements[0] ?? null;
}

export type DisconnectResult =
  { kind: 'cancelled' } | { kind: 'done' } | { kind: 'failed'; failure: ApiFailure };

/** Connect and disconnect flows shared by the catalog, the connect page and My connections. */
@Injectable({ providedIn: 'root' })
export class ConnectionActions {
  private readonly connectionsApi = inject(ConnectionsService);
  private readonly requests = inject(AccessRequestFlow);
  private readonly dialog = inject(MatDialog);
  private readonly navigation = inject(BrowserNavigation);
  private readonly router = inject(Router);

  /**
   * Sends the browser to the provider; returns a failure only when it stays on the page. The BFF adds
   * `system` to the return path after a failed OAuth connection (CC-111).
   */
  async startOAuth(system: SystemId, returnPage: string): Promise<ApiFailure | null> {
    try {
      const { authorizeUrl } = await firstValueFrom(
        this.connectionsApi.startConnectOAuth(system, {
          returnPath: returnPage,
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

  /** Request from a tool row: the entitlement of the tool that was clicked, no choice to make. */
  async requestAccess(tool: CatalogTool): Promise<AccessRequestResult> {
    const entitlement = entitlementToRequest(tool);
    return entitlement ? this.requests.createRequest(entitlement) : { kind: 'unavailable' };
  }

  /**
   * Request from a server row (or from the requests page, `system` null): there is no single obvious
   * entitlement, so the dialog lets the user pick one of those the IGA offers (CC-154). Null when the
   * dialog was dismissed.
   */
  async requestWithChoice(system: SystemId | null): Promise<AccessRequestResult | null> {
    const result = await firstValueFrom(
      this.dialog
        .open<RequestDialog, RequestDialogData, AccessRequestResult>(RequestDialog, {
          data: { system },
          width: '480px',
          maxWidth: '95vw',
        })
        .afterClosed(),
    );
    return result ?? null;
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
