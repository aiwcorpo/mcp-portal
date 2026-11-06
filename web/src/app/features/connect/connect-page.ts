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
import { firstValueFrom } from 'rxjs';
import { CatalogService, Connection, PortalCatalogServer } from '../../api/generated';
import { ApiFailure, toApiFailure } from '../../core/api-error';
import { ConnectionActions } from '../../core/connection-actions.service';
import { LOADING, LoadState } from '../../core/load-state';
import { ErrorNotice } from '../../shared/error-notice';
import { catalogSystemName, isSystemId, systemName } from '../../shared/labels';
import { LoadError } from '../../shared/load-error';
import { Loading } from '../../shared/loading';
import { Notice } from '../../shared/notice';
import { hasUserCredential } from '../catalog/catalog-actions';
import { SecretForm } from './secret-form';
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
  connection: Connection | null | undefined,
): ConnectOptions {
  if (!hasUserCredential(server)) {
    return { oauth: false, token: false };
  }
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
  imports: [MatButtonModule, SecretForm, Notice, ErrorNotice, Loading, LoadError],
  templateUrl: './connect-page.html',
  styleUrl: './connect-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConnectPage {
  private readonly catalogApi = inject(CatalogService);
  private readonly connectionActions = inject(ConnectionActions);

  /** Route parameter and query (withComponentInputBinding). */
  readonly system = input.required<string>();

  protected readonly validSystem = computed<string | null>(() => {
    const system = this.system();
    return isSystemId(system) ? system : null;
  });
  /** The name the broker gave the system, once the catalog row is there; before that the identifier with a capital. */
  protected readonly name = computed(() => {
    const system = this.validSystem();
    const state = this.data();
    if (!system) {
      return '';
    }
    return state.status === 'ready' && state.value
      ? catalogSystemName(state.value.server)
      : systemName(system);
  });
  protected readonly instructions = computed(() => {
    const system = this.validSystem();
    return system ? tokenInstructions(this.name()) : [];
  });
  /**
   * Whether to warn before a token is stored: the system does not check tokens (`userSecretVerified` false in the
   * catalog, CC-248) or the connection that is being renewed was stored without a check.
   */
  protected readonly unverified = computed(() => {
    const state = this.data();
    return (
      state.status === 'ready' &&
      !!state.value &&
      (state.value.server.credential?.userSecretVerified === false ||
        state.value.server.connection?.verified === false)
    );
  });

  protected readonly data = signal<LoadState<PageData | null>>(LOADING);
  protected readonly oauthBusy = signal(false);
  protected readonly oauthFailure = signal<ApiFailure | null>(null);

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
      const catalog = await firstValueFrom(this.catalogApi.getPortalCatalog());
      const server = catalog.servers.find((candidate) => candidate.system === system);
      if (!server) {
        this.data.set({ status: 'error', failure: { code: 'not_found_or_denied', status: 404 } });
        return;
      }
      const options = connectOptions(server, server.connection);
      this.data.set({
        status: 'ready',
        value: options.oauth || options.token ? { server, options } : null,
      });
    } catch (error) {
      this.data.set({ status: 'error', failure: toApiFailure(error) });
    }
  }

  protected async startOAuth(system: string): Promise<void> {
    if (this.oauthBusy()) {
      return;
    }
    this.oauthBusy.set(true);
    this.oauthFailure.set(null);
    this.oauthFailure.set(await this.connectionActions.startOAuth(system, '/connections'));
    this.oauthBusy.set(false);
  }
}
