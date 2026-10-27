import { Injectable, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { ConnectionsService, SystemId } from '../api/generated';
import { ConfirmDialog, ConfirmDialogData } from '../shared/confirm-dialog';
import { systemName } from '../shared/labels';
import { ApiFailure, toApiFailure } from './api-error';
import { isAllowedRedirect } from './auth-urls';
import { BrowserNavigation } from './browser-navigation';

export type DisconnectResult =
  { kind: 'cancelled' } | { kind: 'done' } | { kind: 'failed'; failure: ApiFailure };

/** Connect and disconnect flows shared by the catalog, the connect page and My connections. */
@Injectable({ providedIn: 'root' })
export class ConnectionActions {
  private readonly connectionsApi = inject(ConnectionsService);
  private readonly dialog = inject(MatDialog);
  private readonly navigation = inject(BrowserNavigation);

  /** Sends the browser to the provider; returns a failure only when it stays on the page. */
  async startOAuth(system: SystemId, returnPath: string): Promise<ApiFailure | null> {
    try {
      const { authorizeUrl } = await firstValueFrom(
        this.connectionsApi.startConnectOAuth(system, { returnPath }),
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

  async confirmAndDisconnect(system: SystemId): Promise<DisconnectResult> {
    const name = systemName(system);
    const confirmed = await firstValueFrom(
      this.dialog
        .open<ConfirmDialog, ConfirmDialogData, boolean>(ConfirmDialog, {
          data: {
            title: $localize`:@@disconnect.title:Odłączyć konto ${name}:system:?`,
            message: $localize`:@@disconnect.message:Portal usunie zapisane poświadczenie. Narzędzia tego systemu przestaną działać, dopóki nie połączysz konta ponownie.`,
            confirmLabel: $localize`:@@disconnect.confirm:Odłącz`,
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
  return $localize`:@@disconnect.done:Odłączono konto ${systemName(system)}:system:.`;
}
