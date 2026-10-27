import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { Connection, ConnectionsService, SystemId } from '../../api/generated';
import { ApiFailure, toApiFailure } from '../../core/api-error';
import { LOADING, LoadState } from '../../core/load-state';
import { ConfirmDialog, ConfirmDialogData } from '../../shared/confirm-dialog';
import { ErrorNotice } from '../../shared/error-notice';
import {
  connectionStatusLabel,
  connectionStatusTone,
  credentialTypeLabel,
  systemName,
} from '../../shared/labels';
import { Notice } from '../../shared/notice';
import { StatusBadge } from '../../shared/status-badge';

/** Connections the user made in the portal; service accounts and token exchange are not theirs to remove. */
function canDisconnect(connection: Connection): boolean {
  return connection.type === 'user-oauth' || connection.type === 'user-secret';
}

@Component({
  selector: 'app-connections-page',
  imports: [
    DatePipe,
    MatButtonModule,
    MatProgressBarModule,
    RouterLink,
    ErrorNotice,
    Notice,
    StatusBadge,
  ],
  templateUrl: './connections-page.html',
  styleUrl: './connections-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConnectionsPage {
  private readonly connectionsApi = inject(ConnectionsService);
  private readonly dialog = inject(MatDialog);

  protected readonly connections = signal<LoadState<Connection[]>>(LOADING);
  protected readonly busy = signal<SystemId | null>(null);
  protected readonly actionFailure = signal<ApiFailure | null>(null);
  protected readonly actionDone = signal<string | null>(null);

  protected readonly systemName = systemName;
  protected readonly typeLabel = credentialTypeLabel;
  protected readonly statusLabel = connectionStatusLabel;
  protected readonly statusTone = connectionStatusTone;
  protected readonly canDisconnect = canDisconnect;

  constructor() {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.connections.set(LOADING);
    try {
      const list = await firstValueFrom(this.connectionsApi.listMyConnections());
      this.connections.set({ status: 'ready', value: list });
    } catch (error) {
      this.connections.set({ status: 'error', failure: toApiFailure(error) });
    }
  }

  protected async disconnect(system: SystemId): Promise<void> {
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
      return;
    }
    this.busy.set(system);
    this.actionFailure.set(null);
    this.actionDone.set(null);
    try {
      await firstValueFrom(this.connectionsApi.disconnect(system));
      this.actionDone.set($localize`:@@disconnect.done:Odłączono konto ${name}:system:.`);
      await this.load();
    } catch (error) {
      this.actionFailure.set(toApiFailure(error));
    } finally {
      this.busy.set(null);
    }
  }
}
