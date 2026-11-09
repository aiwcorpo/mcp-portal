import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Clipboard } from '@angular/cdk/clipboard';
import { firstValueFrom } from 'rxjs';
import { Router } from '@angular/router';
import {
  AuthenticatorService,
  AuthenticatorStatus,
  CatalogService,
  PortalCatalogServer,
} from '../../api/generated';
import { toApiFailure } from '../../core/api-error';
import { AccessRequestResult } from '../../core/access-request-flow';
import { neutraliseText } from '../../shared/untrusted-text';
import { ConnectionActions, disconnectedMessage } from '../../core/connection-actions.service';
import { LOADING, LoadState } from '../../core/load-state';
import { NotificationService } from '../../core/notification.service';
import { catalogSystemName } from '../../shared/labels';
import { LoadError } from '../../shared/load-error';
import { Loading } from '../../shared/loading';
import { OAuthReturnBanner } from '../../shared/oauth-return';
import { readAuthenticatorStatus } from '../authenticator/authenticator-state';
import { CatalogActionEvent, CatalogTable, ToolRequestEvent, matchesServer } from './catalog-table';

@Component({
  selector: 'app-catalog-page',
  imports: [CatalogTable, LoadError, Loading, OAuthReturnBanner],
  templateUrl: './catalog-page.html',
  styleUrl: './catalog-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CatalogPage {
  private readonly catalogApi = inject(CatalogService);
  private readonly authenticatorApi = inject(AuthenticatorService);
  private readonly connectionActions = inject(ConnectionActions);
  private readonly clipboard = inject(Clipboard);
  private readonly notifications = inject(NotificationService);
  private readonly router = inject(Router);

  protected readonly catalog = signal<LoadState<PortalCatalogServer[]>>(LOADING);
  protected readonly busyServer = signal<string | null>(null);
  protected readonly busyTool = signal<string | null>(null);
  protected readonly query = signal('');

  protected readonly loadedServers = computed(() => {
    const state = this.catalog();
    return state.status === 'ready' ? state.value : null;
  });
  /** For the return from OAuth: null while loading, empty when the list could not be loaded. */
  protected readonly returnServers = computed(() => {
    const state = this.catalog();
    return state.status === 'loading' ? null : (this.loadedServers() ?? []);
  });
  /** For the tool rows that need a code from the Authenticator; null until read or when it cannot be read. */
  protected readonly authenticator = signal<AuthenticatorStatus | null>(null);
  protected readonly visibleServers = computed(() =>
    (this.loadedServers() ?? []).filter((server) => matchesServer(server, this.query())),
  );

  constructor() {
    void readAuthenticatorStatus(this.authenticatorApi).then((status) =>
      this.authenticator.set(status),
    );
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
    if (copied) {
      this.notifications.success(
        $localize`:@@catalog.linkCopied:Copied the address of the ${catalogSystemName(server)}:system: server.`,
      );
    } else {
      this.notifications.error(
        $localize`:@@catalog.linkCopyFailed:Could not copy the address. Address: ${server.url}:url:`,
      );
    }
  }

  private async connect(
    server: PortalCatalogServer,
    action: 'connect_oauth' | 'add_secret' | 'reconnect',
  ): Promise<void> {
    this.busyServer.set(server.serverId);
    const failure = await this.connectionActions.connect(server, action, '/catalog');
    this.busyServer.set(null);
    if (failure) {
      this.notifications.failure(failure);
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
        this.notifications.success(
          $localize`:@@catalog.requestCreated:Request ${neutraliseText(result.requestId).text}:id: submitted.`,
        );
        await this.load();
        return;
      case 'failed':
        this.notifications.failure(result.failure);
        return;
      case 'unavailable':
        this.notifications.failure({ code: 'internal_error', status: 0 });
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
      this.notifications.success(disconnectedMessage(system, catalogSystemName(server)));
      await this.load();
    } else if (result.kind === 'failed') {
      this.notifications.failure(result.failure);
    }
  }
}
