import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { ActivatedRoute, ParamMap, Router } from '@angular/router';
import { PortalCatalogServer } from '../api/generated';
import { ReturnErrorCode, isConnectErrorCode } from '../core/api-error';
import { ConnectionActions } from '../core/connection-actions.service';
import { NotificationService } from '../core/notification.service';
import { catalogSystemName, isSystemId } from './labels';

type OAuthReturn =
  | { kind: 'connected'; system: string | null }
  | { kind: 'failed'; code: ReturnErrorCode; system: string | null };

const QUERY_KEYS = ['connected', 'connectError', 'system'];

/**
 * What the BFF appended to the return path after the provider redirect (CC-022, CC-086, CC-111): `connected=<system>`,
 * or `connectError=<code>` followed by `system=<system>` (absent when no flow was known). The portal adds nothing to
 * the returnPath it sends, so there is a single source of `system`.
 */
export function readOAuthReturn(params: ParamMap): OAuthReturn | null {
  const system = params.get('system');
  const knownSystem = isSystemId(system) ? system : null;
  const connected = params.get('connected');
  if (connected !== null) {
    return { kind: 'connected', system: isSystemId(connected) ? connected : knownSystem };
  }
  const code = params.get('connectError');
  if (code !== null) {
    return {
      kind: 'failed',
      code: isConnectErrorCode(code) ? code : 'provider_error',
      system: knownSystem,
    };
  }
  return null;
}

/**
 * Text of the banner. A success is worded only from the catalog (the URL alone proves nothing, anyone can
 * send a link with `?connected=`): null while the catalog is missing or does not show the connection.
 */
export function oauthReturnMessage(
  result: OAuthReturn,
  servers: readonly PortalCatalogServer[] | null,
): string | null {
  // The name of a system from the URL is shown only when the catalog the user got contains that system: a link that
  // anyone can send must not put words of its own into the page.
  const listed = servers?.find((server) => server.system === result.system);
  const named = result.system && listed ? catalogSystemName(listed) : null;
  if (result.kind === 'connected') {
    const row = servers?.find((server) => server.system === result.system);
    const backendUser = row?.connection?.backendUser;
    const alive = row?.status === 'connected' || row?.status === 'expiring';
    if (!named || !alive || !backendUser) {
      return null;
    }
    return $localize`:@@oauth.connectedAs:Connected to ${named}:system: as ${backendUser}:user:.`;
  }
  switch (result.code) {
    case 'flow_invalid':
      return $localize`:@@oauth.flowInvalid:The connection link expired or was already used. Start again.`;
    case 'cancelled':
      return named
        ? $localize`:@@oauth.cancelled:Connecting to ${named}:system: cancelled.`
        : $localize`:@@oauth.cancelledUnknown:Connection cancelled.`;
    default:
      return named
        ? $localize`:@@oauth.providerError:${named}:system: did not respond correctly. Try again in a moment.`
        : $localize`:@@oauth.providerErrorUnknown:The system did not respond correctly. Try again in a moment.`;
  }
}

/** Notification for the return from an OAuth provider; shown once, then the parameters leave the URL. */
@Component({
  selector: 'app-oauth-return',
  template: '',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OAuthReturnBanner {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly notifications = inject(NotificationService);
  private readonly connectionActions = inject(ConnectionActions);

  /** Catalog rows: they confirm the connection and name the account (connection.backendUser). Null while they load; empty when they could not be loaded. */
  readonly servers = input<readonly PortalCatalogServer[] | null>(null);

  protected readonly result = signal<OAuthReturn | null>(
    readOAuthReturn(this.route.snapshot.queryParamMap),
  );

  constructor() {
    const result = this.result();
    if (!result) {
      return;
    }
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: Object.fromEntries(QUERY_KEYS.map((key) => [key, null])),
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
    const returnPage = this.router.url.split(/[?#]/)[0];
    effect(() => {
      const shown = this.result();
      const text = shown ? oauthReturnMessage(shown, this.servers()) : null;
      // A failure names its system from the catalog, so it waits until the catalog has answered.
      if (!shown || !text || (shown.system && this.servers() === null)) {
        return;
      }
      untracked(() => {
        this.result.set(null);
        if (shown.kind === 'connected') {
          this.notifications.success(text);
          return;
        }
        const system = shown.system;
        const retry =
          shown.code === 'flow_invalid' &&
          system &&
          this.servers()?.some((s) => s.system === system);
        this.notifications.error(
          text,
          retry
            ? {
                action: {
                  label: $localize`:@@oauth.connectAgain:Connect again`,
                  run: () => void this.connectAgain(system, returnPage),
                },
              }
            : {},
        );
      });
    });
  }

  private async connectAgain(system: string, returnPage: string): Promise<void> {
    const failure = await this.connectionActions.startOAuth(system, returnPage);
    if (failure) {
      this.notifications.failure(failure);
    }
  }
}
