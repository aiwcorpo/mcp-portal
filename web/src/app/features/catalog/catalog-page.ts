import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Clipboard } from '@angular/cdk/clipboard';
import { MatSnackBar } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';
import { CatalogService, PortalCatalogServer, SystemId } from '../../api/generated';
import { ApiFailure, toApiFailure } from '../../core/api-error';
import { ConnectionActions, disconnectedMessage } from '../../core/connection-actions.service';
import { LOADING, LoadState } from '../../core/load-state';
import { ErrorNotice } from '../../shared/error-notice';
import { systemName } from '../../shared/labels';
import { LoadError } from '../../shared/load-error';
import { Loading } from '../../shared/loading';
import { Notice } from '../../shared/notice';
import { OAuthReturnBanner } from '../../shared/oauth-return';
import { CatalogActionEvent, CatalogTable, matchesServer } from './catalog-table';

type Banner = { kind: 'success'; text: string } | { kind: 'error'; failure: ApiFailure };

@Component({
  selector: 'app-catalog-page',
  imports: [CatalogTable, ErrorNotice, LoadError, Loading, Notice, OAuthReturnBanner],
  templateUrl: './catalog-page.html',
  styleUrl: './catalog-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CatalogPage {
  private readonly catalogApi = inject(CatalogService);
  private readonly connectionActions = inject(ConnectionActions);
  private readonly clipboard = inject(Clipboard);
  private readonly snackBar = inject(MatSnackBar);

  protected readonly catalog = signal<LoadState<PortalCatalogServer[]>>(LOADING);
  protected readonly banner = signal<Banner | null>(null);
  protected readonly busyServer = signal<string | null>(null);
  protected readonly query = signal('');

  protected readonly loadedServers = computed(() => {
    const state = this.catalog();
    return state.status === 'ready' ? state.value : null;
  });
  protected readonly visibleServers = computed(() =>
    (this.loadedServers() ?? []).filter((server) => matchesServer(server, this.query())),
  );

  constructor() {
    void this.load();
  }

  protected onQuery(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
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
    if (this.busyServer() === server.serverId) {
      return;
    }
    switch (action) {
      case 'copy_link':
        this.copyLink(server);
        return;
      case 'connect_oauth':
      case 'add_secret':
      case 'reconnect':
        await this.connect(server, action);
        return;
      case 'request_access':
        await this.requestAccess(server);
        return;
      case 'disconnect':
        await this.disconnect(server);
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

  private async connect(
    server: PortalCatalogServer,
    action: 'connect_oauth' | 'add_secret' | 'reconnect',
  ): Promise<void> {
    this.busyServer.set(server.serverId);
    const failure = await this.connectionActions.connect(server, action, '/catalog');
    this.busyServer.set(null);
    if (failure) {
      this.banner.set({ kind: 'error', failure });
    }
  }

  private async requestAccess(server: PortalCatalogServer): Promise<void> {
    this.busyServer.set(server.serverId);
    const result = await this.connectionActions.requestAccess(server);
    this.busyServer.set(null);
    switch (result.kind) {
      case 'created':
        this.banner.set({
          kind: 'success',
          text: $localize`:@@catalog.requestCreated:Wniosek złożony (${result.requestId}:id:).`,
        });
        await this.load();
        return;
      case 'failed':
        this.banner.set({ kind: 'error', failure: result.failure });
        return;
      case 'unavailable':
        this.banner.set({ kind: 'error', failure: { code: 'internal_error', status: 0 } });
        return;
      default:
        return;
    }
  }

  private async disconnect(server: PortalCatalogServer): Promise<void> {
    const system: SystemId = server.system;
    this.busyServer.set(server.serverId);
    const result = await this.connectionActions.confirmAndDisconnect(system);
    this.busyServer.set(null);
    if (result.kind === 'done') {
      this.banner.set({ kind: 'success', text: disconnectedMessage(system) });
      await this.load();
    } else if (result.kind === 'failed') {
      this.banner.set({ kind: 'error', failure: result.failure });
    }
  }
}
