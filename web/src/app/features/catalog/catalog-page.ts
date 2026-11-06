import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Clipboard } from '@angular/cdk/clipboard';
import { MatSnackBar } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';
import { Router } from '@angular/router';
import { CatalogService, PortalCatalogServer } from '../../api/generated';
import { ApiFailure, toApiFailure } from '../../core/api-error';
import { AccessRequestResult } from '../../core/access-request-flow';
import { neutraliseText } from '../../shared/untrusted-text';
import { ConnectionActions, disconnectedMessage } from '../../core/connection-actions.service';
import { LOADING, LoadState } from '../../core/load-state';
import { ErrorNotice } from '../../shared/error-notice';
import { catalogSystemName } from '../../shared/labels';
import { LoadError } from '../../shared/load-error';
import { Loading } from '../../shared/loading';
import { Notice } from '../../shared/notice';
import { OAuthReturnBanner } from '../../shared/oauth-return';
import { AuthenticatorBanner } from '../authenticator/authenticator-banner';
import { CatalogActionEvent, CatalogTable, ToolRequestEvent, matchesServer } from './catalog-table';

type Banner = { kind: 'success'; text: string } | { kind: 'error'; failure: ApiFailure };

@Component({
  selector: 'app-catalog-page',
  imports: [
    AuthenticatorBanner,
    CatalogTable,
    ErrorNotice,
    LoadError,
    Loading,
    Notice,
    OAuthReturnBanner,
  ],
  templateUrl: './catalog-page.html',
  styleUrl: './catalog-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CatalogPage {
  private readonly catalogApi = inject(CatalogService);
  private readonly connectionActions = inject(ConnectionActions);
  private readonly clipboard = inject(Clipboard);
  private readonly snackBar = inject(MatSnackBar);
  private readonly router = inject(Router);

  protected readonly catalog = signal<LoadState<PortalCatalogServer[]>>(LOADING);
  protected readonly banner = signal<Banner | null>(null);
  protected readonly busyServer = signal<string | null>(null);
  protected readonly busyTool = signal<string | null>(null);
  protected readonly query = signal('');

  protected readonly loadedServers = computed(() => {
    const state = this.catalog();
    return state.status === 'ready' ? state.value : null;
  });
  /** Tools the user can use but only with a code from the Authenticator (mockup 23). */
  protected readonly needsAuthenticator = computed(() =>
    (this.loadedServers() ?? []).some((server) =>
      server.tools.some(
        (tool) => tool.requiresConfirmation && !tool.disabled && tool.access === 'granted',
      ),
    ),
  );
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
      case 'view_request':
        await this.router.navigate(['/requests']);
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
        ? $localize`:@@catalog.linkCopied:Copied the address of the ${catalogSystemName(server)}:system: server.`
        : $localize`:@@catalog.linkCopyFailed:Could not copy the address. Address: ${server.url}:url:`,
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

  protected async onToolRequest({ tool }: ToolRequestEvent): Promise<void> {
    if (this.busyTool() !== null) {
      return;
    }
    this.busyTool.set(tool.name);
    const result = await this.connectionActions.requestAccess(tool);
    this.busyTool.set(null);
    await this.showRequestResult(result);
  }

  private async requestAccess(server: PortalCatalogServer): Promise<void> {
    this.busyServer.set(server.serverId);
    const result = await this.connectionActions.requestWithChoice(
      server.system,
      catalogSystemName(server),
    );
    this.busyServer.set(null);
    if (result) {
      await this.showRequestResult(result);
    }
  }

  private async showRequestResult(result: AccessRequestResult): Promise<void> {
    switch (result.kind) {
      case 'created':
        this.banner.set({
          kind: 'success',
          text: $localize`:@@catalog.requestCreated:Request ${neutraliseText(result.requestId).text}:id: is in the entitlement system. Check its status in the Requests tab.`,
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
    const system: string = server.system;
    this.busyServer.set(server.serverId);
    const result = await this.connectionActions.confirmAndDisconnect(
      system,
      catalogSystemName(server),
    );
    this.busyServer.set(null);
    if (result.kind === 'done') {
      this.banner.set({
        kind: 'success',
        text: disconnectedMessage(system, catalogSystemName(server)),
      });
      await this.load();
    } else if (result.kind === 'failed') {
      this.banner.set({ kind: 'error', failure: result.failure });
    }
  }
}
