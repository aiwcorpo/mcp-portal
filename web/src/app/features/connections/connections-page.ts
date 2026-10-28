import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { firstValueFrom } from 'rxjs';
import {
  AuthenticatorService,
  AuthenticatorStatus,
  CatalogAction,
  CatalogService,
  PortalCatalogServer,
} from '../../api/generated';
import { ApiFailure, toApiFailure } from '../../core/api-error';
import { ConnectionActions, disconnectedMessage } from '../../core/connection-actions.service';
import { LOADING, LoadState } from '../../core/load-state';
import { ErrorNotice } from '../../shared/error-notice';
import {
  actionLabel,
  catalogStatusTone,
  credentialTypeLabel,
  daysText,
  daysUntil,
  systemName,
  Tone,
} from '../../shared/labels';
import { LoadError } from '../../shared/load-error';
import { Loading } from '../../shared/loading';
import { Notice } from '../../shared/notice';
import { OAuthReturnBanner } from '../../shared/oauth-return';
import { AuthenticatorSection, MFA_RETURN_QUERY } from '../authenticator/authenticator-section';
import { connectionRowActions, isEmphasised } from '../catalog/catalog-actions';

interface ConnectionRow {
  server: PortalCatalogServer;
  name: string;
  type: string;
  account: string | null;
  validity: { text: string; date: string | null; tone: Tone };
  lastUsed: string | null;
  actions: CatalogAction[];
}

function validityOf(server: PortalCatalogServer): ConnectionRow['validity'] {
  const connection = server.connection;
  switch (server.status) {
    case 'reconnect_required':
      return {
        text: $localize`:@@conn.reconnectNeeded:wymaga ponownego połączenia`,
        date: null,
        tone: 'warn',
      };
    case 'request_pending':
      return { text: $localize`:@@conn.pending:wniosek oczekuje`, date: null, tone: 'neutral' };
    case 'no_access':
      return { text: $localize`:@@conn.noAccess:brak uprawnienia`, date: null, tone: 'neutral' };
    default:
  }
  if (!connection) {
    return { text: '', date: null, tone: 'neutral' };
  }
  if (connection.expiresAt) {
    const days = daysUntil(connection.expiresAt);
    return {
      text: server.status === 'expiring' && days !== null ? daysText(days) : '',
      date: connection.expiresAt,
      tone: server.status === 'expiring' ? 'warn' : 'neutral',
    };
  }
  return {
    text:
      connection.type === 'user-oauth'
        ? $localize`:@@conn.autoRefreshed:odświeżane automatycznie`
        : $localize`:@@conn.noExpiry:bez terminu`,
    date: null,
    tone: 'neutral',
  };
}

interface ConnectionsData {
  servers: PortalCatalogServer[];
  authenticator: AuthenticatorStatus;
}

/**
 * One row per system, from one consistent catalog read: connection, credential type and actions (CC-080),
 * and below them the Authenticator registration. If either read fails the whole page shows the error, not
 * a partly filled table (C12 returns no partial answers).
 */
@Component({
  selector: 'app-connections-page',
  imports: [
    AuthenticatorSection,
    DatePipe,
    MatButtonModule,
    ErrorNotice,
    LoadError,
    Loading,
    Notice,
    OAuthReturnBanner,
  ],
  templateUrl: './connections-page.html',
  styleUrl: './connections-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConnectionsPage implements OnInit {
  private readonly catalogApi = inject(CatalogService);
  private readonly authenticatorApi = inject(AuthenticatorService);
  private readonly connectionActions = inject(ConnectionActions);
  private readonly router = inject(Router);

  /** Query parameter `mfa=ok` after the IdP returned from the fresh MFA that removing the Authenticator needs. */
  readonly mfa = input<string | undefined>();

  protected readonly catalog = signal<LoadState<ConnectionsData>>(LOADING);
  protected readonly mfaConfirmed = signal(false);
  protected readonly busy = signal<string | null>(null);
  protected readonly actionFailure = signal<ApiFailure | null>(null);
  protected readonly actionDone = signal<string | null>(null);

  protected readonly servers = computed(() => {
    const state = this.catalog();
    return state.status === 'ready' ? state.value.servers : null;
  });
  protected readonly authenticator = computed(() => {
    const state = this.catalog();
    return state.status === 'ready' ? state.value.authenticator : null;
  });
  protected readonly rows = computed<ConnectionRow[]>(() =>
    (this.servers() ?? []).map((server) => {
      const type = server.connection?.type ?? server.credential?.defaultType;
      return {
        server,
        name: systemName(server.system),
        type: type ? credentialTypeLabel(type) : '',
        account: server.connection?.backendUser ?? null,
        validity: validityOf(server),
        lastUsed: server.connection?.lastUsedAt ?? null,
        actions: connectionRowActions(server),
      };
    }),
  );

  protected readonly actionLabel = actionLabel;
  protected readonly isEmphasised = isEmphasised;
  protected readonly statusTone = catalogStatusTone;
  protected readonly today = new Date().toDateString();

  ngOnInit(): void {
    this.mfaConfirmed.set(this.mfa() === 'ok');
    void this.load();
    if (this.mfaConfirmed()) {
      void this.router.navigate([], {
        queryParams: { [MFA_RETURN_QUERY]: null },
        replaceUrl: true,
      });
    }
  }

  protected isToday(iso: string): boolean {
    return new Date(iso).toDateString() === this.today;
  }

  protected async load(): Promise<void> {
    this.catalog.set(LOADING);
    try {
      const [catalog, authenticator] = await Promise.all([
        firstValueFrom(this.catalogApi.getPortalCatalog()),
        firstValueFrom(this.authenticatorApi.getMyAuthenticator()),
      ]);
      this.catalog.set({ status: 'ready', value: { servers: catalog.servers, authenticator } });
    } catch (error) {
      this.catalog.set({ status: 'error', failure: toApiFailure(error) });
    }
  }

  /** After a removal: only the registration is read again, so the section keeps its confirmation message. */
  protected async reloadAuthenticator(): Promise<void> {
    try {
      const authenticator = await firstValueFrom(this.authenticatorApi.getMyAuthenticator());
      const state = this.catalog();
      if (state.status === 'ready') {
        this.catalog.set({ status: 'ready', value: { ...state.value, authenticator } });
      }
    } catch (error) {
      this.catalog.set({ status: 'error', failure: toApiFailure(error) });
    }
  }

  protected async run(server: PortalCatalogServer, action: CatalogAction): Promise<void> {
    if (this.busy()) {
      return;
    }
    this.actionFailure.set(null);
    this.actionDone.set(null);
    this.busy.set(server.serverId);
    try {
      switch (action) {
        case 'connect_oauth':
        case 'add_secret':
        case 'reconnect':
          this.actionFailure.set(
            await this.connectionActions.connect(server, action, '/connections'),
          );
          return;
        case 'request_access': {
          const result = await this.connectionActions.requestAccess(server);
          if (result.kind === 'created') {
            this.actionDone.set(
              $localize`:@@conn.requestCreated:Wniosek złożony (${result.requestId}:id:).`,
            );
            await this.load();
          } else if (result.kind === 'failed') {
            this.actionFailure.set(result.failure);
          } else if (result.kind === 'unavailable') {
            this.actionFailure.set({ code: 'internal_error', status: 0 });
          }
          return;
        }
        case 'disconnect': {
          const result = await this.connectionActions.confirmAndDisconnect(server.system);
          if (result.kind === 'done') {
            this.actionDone.set(disconnectedMessage(server.system));
            await this.load();
          } else if (result.kind === 'failed') {
            this.actionFailure.set(result.failure);
          }
          return;
        }
        default:
          return;
      }
    } finally {
      this.busy.set(null);
    }
  }
}
