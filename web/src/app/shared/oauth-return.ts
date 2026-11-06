import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { ActivatedRoute, ParamMap, Router } from '@angular/router';
import { PortalCatalogServer } from '../api/generated';
import { ReturnErrorCode, isConnectErrorCode } from '../core/api-error';
import { isSystemId, systemName } from './labels';
import { Notice } from './notice';

type OAuthReturn =
  | { kind: 'connected'; system: string | null }
  | { kind: 'failed'; code: ReturnErrorCode; system: string | null };

const QUERY_KEYS = ['connected', 'connectError', 'system'];
const SUCCESS_VISIBLE_MS = 10_000;

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
  const named = result.system ? systemName(result.system) : null;
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

/** Banner for the return from an OAuth provider; shown once, then the parameters leave the URL. */
@Component({
  selector: 'app-oauth-return',
  imports: [Notice],
  template: `
    @if (message(); as text) {
      <app-notice [kind]="kind()" [dismissible]="true" (dismiss)="result.set(null)">{{
        text
      }}</app-notice>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OAuthReturnBanner {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  /** Catalog rows: they confirm the connection and name the account (connection.backendUser). */
  readonly servers = input<readonly PortalCatalogServer[] | null>(null);

  protected readonly result = signal<OAuthReturn | null>(
    readOAuthReturn(this.route.snapshot.queryParamMap),
  );
  protected readonly kind = computed(() =>
    this.result()?.kind === 'connected' ? 'success' : 'error',
  );
  protected readonly message = computed(() => {
    const result = this.result();
    return result ? oauthReturnMessage(result, this.servers()) : null;
  });

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
    if (result.kind === 'connected') {
      const timer = setTimeout(() => this.result.set(null), SUCCESS_VISIBLE_MS);
      inject(DestroyRef).onDestroy(() => clearTimeout(timer));
    }
  }
}
