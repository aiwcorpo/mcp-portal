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
  ActivityCall,
  ActivityService,
  AuthenticatorService,
  AuthenticatorStatus,
  CatalogAction,
  CatalogService,
  PortalCatalogServer,
} from '../../api/generated';
import { ApiFailure, toApiFailure } from '../../core/api-error';
import { neutraliseText } from '../../shared/untrusted-text';
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
  /** The broker stored the token without a check (no whoami in the system): no account to show, and no reason to worry. */
  unverified: boolean;
  validity: { text: string; date: string | null; tone: Tone };
  lastUsed: string | null;
  actions: CatalogAction[];
}

function validityOf(server: PortalCatalogServer): ConnectionRow['validity'] {
  const connection = server.connection;
  switch (server.status) {
    case 'reconnect_required':
      return {
        text:
          connection?.status === 'error'
            ? $localize`:@@conn.brokenReconnect:stopped working, reconnect the account`
            : connection?.status === 'needs_reconnect'
              ? $localize`:@@conn.invalidated:the administrator changed the system settings, connect the account again`
              : $localize`:@@conn.reconnectNeeded:needs reconnecting`,
        date: null,
        tone: 'warn',
      };
    case 'request_pending':
      return { text: $localize`:@@conn.pending:request pending`, date: null, tone: 'neutral' };
    case 'no_access':
      return { text: $localize`:@@conn.noAccess:no entitlement`, date: null, tone: 'neutral' };
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
        ? $localize`:@@conn.autoRefreshed:refreshed automatically`
        : $localize`:@@conn.noExpiry:no expiry`,
    date: null,
    tone: 'neutral',
  };
}

/** How many newest calls are read to find the last one that really used the system. */
const LAST_CALL_LOOKUP = 20;

/**
 * Results that mean the call reached the system (CC-150): executed, confirmed with a code, or failed in
 * the system itself. Refusals, limits, expired or unconfirmed operations and everything else do not count;
 * an error that says the system could not be reached (`upstream_unavailable`) is not a use either.
 */
const REACHED_SYSTEM: ReadonlySet<string> = new Set(['ok', 'confirmed', 'error']);

/**
 * `q` of the API also matches resource ids, so the tool name is checked here: a GitLab project called
 * "servicedesk__x" must not count as a use of Service Desk.
 */
export function reachedSystem(call: ActivityCall, system: string): boolean {
  return (
    call.tool.startsWith(`${system}__`) &&
    REACHED_SYSTEM.has(call.result) &&
    call.errorCode !== 'upstream_unavailable'
  );
}

interface ConnectionsData {
  servers: PortalCatalogServer[];
  /** Time of the newest call per system without a user connection (service account), from the activity log. */
  lastCalls: Partial<Record<string, string>>;
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
  private readonly activityApi = inject(ActivityService);
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
  private readonly lastCalls = computed(() => {
    const state = this.catalog();
    return state.status === 'ready' ? state.value.lastCalls : {};
  });
  /** Systems whose connection the administrator invalidated by changing where the system points (7.0.0). */
  protected readonly invalidated = computed(() =>
    (this.servers() ?? [])
      .filter((server) => server.connection?.status === 'needs_reconnect')
      .map((server) => systemName(server.system))
      .join(', '),
  );
  protected readonly rows = computed<ConnectionRow[]>(() =>
    (this.servers() ?? []).map((server) => {
      const type = server.connection?.type ?? server.credential?.defaultType;
      return {
        server,
        name: systemName(server.system),
        type: type ? credentialTypeLabel(type) : '',
        account: server.connection?.backendUser ?? null,
        unverified: server.connection?.verified === false,
        validity: validityOf(server),
        lastUsed: server.connection?.lastUsedAt ?? this.lastCalls()[server.system] ?? null,
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
      const lastCalls = await this.loadLastCalls(catalog.servers);
      this.catalog.set({
        status: 'ready',
        value: { servers: catalog.servers, authenticator, lastCalls },
      });
    } catch (error) {
      this.catalog.set({ status: 'error', failure: toApiFailure(error) });
    }
  }

  /**
   * A service account has no connection record, so "Last used" comes from the newest call in the
   * activity log (decision of 2026-10-28). The column is extra information: when the log cannot be read the
   * cell stays empty and the rest of the page is shown.
   */
  private async loadLastCalls(
    servers: PortalCatalogServer[],
  ): Promise<Partial<Record<string, string>>> {
    const result: Partial<Record<string, string>> = {};
    await Promise.all(
      servers
        .filter(
          (server) => !server.connection && server.credential?.defaultType === 'service-account',
        )
        .map(async (server) => {
          try {
            const calls = await firstValueFrom(
              this.activityApi.listMyActivityCalls(
                LAST_CALL_LOOKUP,
                undefined,
                undefined,
                undefined,
                `${server.system}__`,
              ),
            );
            const latest = calls.find((call) => reachedSystem(call, server.system));
            if (latest) {
              result[server.system] = latest.ts;
            }
          } catch {
            // Left empty on purpose, see above.
          }
        }),
    );
    return result;
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
          const result = await this.connectionActions.requestWithChoice(server.system);
          if (result?.kind === 'created') {
            this.actionDone.set(
              $localize`:@@conn.requestCreated:Request ${neutraliseText(result.requestId).text}:id: is in the entitlement system. You can check its status in the Requests tab.`,
            );
            await this.load();
          }
          return;
        }
        case 'view_request':
          await this.router.navigate(['/requests']);
          return;
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
