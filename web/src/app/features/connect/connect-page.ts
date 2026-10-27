import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { RouterLink } from '@angular/router';
import { firstValueFrom, forkJoin } from 'rxjs';
import {
  CatalogService,
  Connection,
  ConnectionsService,
  PortalCatalogServer,
  SystemId,
} from '../../api/generated';
import { ApiFailure, toApiFailure } from '../../core/api-error';
import { isHttpUrl } from '../../core/auth-urls';
import { BrowserNavigation } from '../../core/browser-navigation';
import { LOADING, LoadState } from '../../core/load-state';
import { ErrorNotice } from '../../shared/error-notice';
import { isSystemId, systemName } from '../../shared/labels';
import { Notice } from '../../shared/notice';
import { SecretForm, isDateOnly } from './secret-form';
import { tokenInstructions } from './token-instructions';

interface ConnectOptions {
  oauth: boolean;
  token: boolean;
}

/**
 * Which ways of connecting to offer. `reconnect` does not say how, so the type of the existing
 * connection decides; without one both are offered and the BFF rejects what the system lacks.
 */
export function connectOptions(
  server: PortalCatalogServer,
  connection: Connection | undefined,
): ConnectOptions {
  const reconnect = server.actions.includes('reconnect');
  const viaOAuth = connection?.type === 'user-oauth';
  return {
    oauth: server.actions.includes('connect_oauth') || (reconnect && (viaOAuth || !connection)),
    token: server.actions.includes('add_secret') || (reconnect && !viaOAuth),
  };
}

interface PageData {
  server: PortalCatalogServer;
  options: ConnectOptions;
}

@Component({
  selector: 'app-connect-page',
  imports: [MatButtonModule, MatProgressBarModule, RouterLink, SecretForm, Notice, ErrorNotice],
  templateUrl: './connect-page.html',
  styleUrl: './connect-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConnectPage {
  private readonly catalogApi = inject(CatalogService);
  private readonly connectionsApi = inject(ConnectionsService);
  private readonly navigation = inject(BrowserNavigation);

  /** Route parameter and query (withComponentInputBinding). */
  readonly system = input.required<string>();
  readonly stepUp = input<string | undefined>();
  readonly expiresAt = input<string | undefined>();

  protected readonly validSystem = computed<SystemId | null>(() => {
    const system = this.system();
    return isSystemId(system) ? system : null;
  });
  protected readonly name = computed(() => {
    const system = this.validSystem();
    return system ? systemName(system) : '';
  });
  protected readonly instructions = computed(() => {
    const system = this.validSystem();
    return system ? tokenInstructions(system) : [];
  });
  protected readonly initialExpiresAt = computed(() => {
    const value = this.expiresAt() ?? null;
    return isDateOnly(value) ? value : null;
  });
  protected readonly returnedFromStepUp = computed(() => this.stepUp() === 'done');

  protected readonly data = signal<LoadState<PageData | null>>(LOADING);
  protected readonly oauthBusy = signal(false);
  protected readonly oauthFailure = signal<ApiFailure | null>(null);
  protected readonly connectedOk = signal(false);

  constructor() {
    // Runs again when the router reuses this component for another system.
    effect(() => {
      this.validSystem();
      untracked(() => void this.load());
    });
  }

  protected async load(): Promise<void> {
    const system = this.validSystem();
    if (!system) {
      this.data.set({ status: 'error', failure: { code: 'not_found_or_denied', status: 404 } });
      return;
    }
    this.data.set(LOADING);
    try {
      const { catalog, connections } = await firstValueFrom(
        forkJoin({
          catalog: this.catalogApi.getPortalCatalog(),
          connections: this.connectionsApi.listMyConnections(),
        }),
      );
      const server = catalog.servers.find((candidate) => candidate.system === system);
      if (!server) {
        this.data.set({ status: 'error', failure: { code: 'not_found_or_denied', status: 404 } });
        return;
      }
      const connection = connections.find((candidate) => candidate.system === system);
      const options = connectOptions(server, connection);
      this.data.set({
        status: 'ready',
        value: options.oauth || options.token ? { server, options } : null,
      });
    } catch (error) {
      this.data.set({ status: 'error', failure: toApiFailure(error) });
    }
  }

  protected async startOAuth(system: SystemId): Promise<void> {
    this.oauthBusy.set(true);
    this.oauthFailure.set(null);
    try {
      const { authorizeUrl } = await firstValueFrom(
        this.connectionsApi.startConnectOAuth(system, { returnPath: '/catalog' }),
      );
      if (isHttpUrl(authorizeUrl)) {
        this.navigation.assign(authorizeUrl);
      } else {
        this.oauthFailure.set({ code: 'internal_error', status: 200 });
      }
    } catch (error) {
      this.oauthFailure.set(toApiFailure(error));
    } finally {
      this.oauthBusy.set(false);
    }
  }
}
