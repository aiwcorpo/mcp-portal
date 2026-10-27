import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Clipboard } from '@angular/cdk/clipboard';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { CatalogService, PortalCatalogServer, SystemId } from '../../api/generated';
import { ApiFailure, isOAuthCallbackErrorCode, toApiFailure } from '../../core/api-error';
import { ConnectionActions, disconnectedMessage } from '../../core/connection-actions.service';
import { LOADING, LoadState } from '../../core/load-state';
import { ErrorNotice } from '../../shared/error-notice';
import { isSystemId, systemName } from '../../shared/labels';
import { Notice } from '../../shared/notice';
import { CatalogActionEvent, CatalogServerCard } from './catalog-server-card';

type Banner = { kind: 'success'; text: string } | { kind: 'error'; failure: ApiFailure };

@Component({
  selector: 'app-catalog-page',
  imports: [CatalogServerCard, ErrorNotice, Notice, MatProgressBarModule],
  templateUrl: './catalog-page.html',
  styleUrl: './catalog-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CatalogPage {
  private readonly catalogApi = inject(CatalogService);
  private readonly connectionActions = inject(ConnectionActions);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly clipboard = inject(Clipboard);
  private readonly snackBar = inject(MatSnackBar);

  protected readonly catalog = signal<LoadState<PortalCatalogServer[]>>(LOADING);
  protected readonly banner = signal<Banner | null>(null);
  protected readonly busyServer = signal<string | null>(null);

  constructor() {
    this.readCallbackResult();
    void this.load();
  }

  protected async load(): Promise<void> {
    this.catalog.set(LOADING);
    try {
      const catalog = await firstValueFrom(this.catalogApi.getPortalCatalog());
      this.catalog.set({ status: 'ready', value: catalog.servers });
    } catch (error) {
      this.catalog.set({ status: 'error', failure: toApiFailure(error) });
    }
  }

  protected async onAction({ server, action }: CatalogActionEvent): Promise<void> {
    if (this.busyServer() === server.system) {
      return;
    }
    switch (action) {
      case 'copy_link':
        this.copyLink(server);
        return;
      case 'connect_oauth':
        await this.startOAuth(server.system);
        return;
      case 'add_secret':
      case 'reconnect':
        await this.router.navigate(['/connect', server.system]);
        return;
      case 'disconnect':
        await this.disconnect(server.system);
        return;
      default:
        return;
    }
  }

  private copyLink(server: PortalCatalogServer): void {
    const copied = this.clipboard.copy(server.url);
    this.snackBar.open(
      copied
        ? $localize`:@@catalog.linkCopied:Skopiowano adres serwera ${systemName(server.system)}:system:.`
        : $localize`:@@catalog.linkCopyFailed:Nie udało się skopiować adresu. Adres: ${server.url}:url:`,
      undefined,
      { duration: 5000 },
    );
  }

  private async startOAuth(system: SystemId): Promise<void> {
    this.busyServer.set(system);
    const failure = await this.connectionActions.startOAuth(system, '/catalog');
    this.busyServer.set(null);
    if (failure) {
      this.banner.set({ kind: 'error', failure });
    }
  }

  private async disconnect(system: SystemId): Promise<void> {
    this.busyServer.set(system);
    const result = await this.connectionActions.confirmAndDisconnect(system);
    this.busyServer.set(null);
    if (result.kind === 'done') {
      this.banner.set({ kind: 'success', text: disconnectedMessage(system) });
      await this.load();
    } else if (result.kind === 'failed') {
      this.banner.set({ kind: 'error', failure: result.failure });
    }
  }

  /** Result of the OAuth callback redirect (CC-022), shown once and then removed from the URL. */
  private readCallbackResult(): void {
    const params = this.route.snapshot.queryParamMap;
    const connected = params.get('connected');
    const connectError = params.get('connectError');
    if (connected === null && connectError === null) {
      return;
    }
    if (connectError !== null) {
      const code = isOAuthCallbackErrorCode(connectError) ? connectError : 'internal_error';
      this.banner.set({ kind: 'error', failure: { code, status: 0 } });
    } else if (isSystemId(connected)) {
      this.banner.set({
        kind: 'success',
        text: $localize`:@@catalog.oauthConnected:Połączono konto ${systemName(connected)}:system:.`,
      });
    }
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { connected: null, connectError: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
