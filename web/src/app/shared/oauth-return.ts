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
import { ConnectErrorCode, PortalCatalogServer, SystemId } from '../api/generated';
import { isConnectErrorCode } from '../core/api-error';
import { isSystemId, systemName } from './labels';
import { Notice } from './notice';

type OAuthReturn =
  | { kind: 'connected'; system: SystemId | null }
  | { kind: 'failed'; code: ConnectErrorCode; system: SystemId | null };

const QUERY_KEYS = ['connected', 'connectError', 'system'];
const SUCCESS_VISIBLE_MS = 10_000;

/**
 * What the BFF appended to the return path after the provider redirect (CC-022, CC-086). The BFF adds
 * only `connected=<system>` or `connectError=<code>`; the portal puts `system=<system>` into the
 * returnPath it sends, so a failure can still name the system.
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

export function oauthReturnPath(base: string, system: SystemId): string {
  return `${base}?system=${system}`;
}

export function oauthReturnMessage(result: OAuthReturn, backendUser: string | null): string {
  const named = result.system ? systemName(result.system) : null;
  if (result.kind === 'connected') {
    if (!named) {
      return $localize`:@@oauth.connectedUnknown:Konto zostało połączone.`;
    }
    return backendUser
      ? $localize`:@@oauth.connectedAs:Połączono z ${named}:system: jako ${backendUser}:user:.`
      : $localize`:@@oauth.connected:Połączono z ${named}:system:.`;
  }
  switch (result.code) {
    case 'identity_mismatch':
      return named
        ? $localize`:@@oauth.identityMismatch:Zalogowano się w ${named}:system: na inne konto niż Twoje. Wyloguj się z ${named}:system: i spróbuj ponownie.`
        : $localize`:@@oauth.identityMismatchUnknown:Zalogowano się w systemie na inne konto niż Twoje. Wyloguj się z systemu i spróbuj ponownie.`;
    case 'flow_invalid':
      return $localize`:@@oauth.flowInvalid:Link połączenia wygasł albo był już użyty. Zacznij od nowa.`;
    case 'cancelled':
      return named
        ? $localize`:@@oauth.cancelled:Łączenie z ${named}:system: anulowane.`
        : $localize`:@@oauth.cancelledUnknown:Łączenie anulowane.`;
    default:
      return named
        ? $localize`:@@oauth.providerError:${named}:system: nie odpowiedział poprawnie. Spróbuj za chwilę.`
        : $localize`:@@oauth.providerErrorUnknown:System nie odpowiedział poprawnie. Spróbuj za chwilę.`;
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

  /** Catalog rows, used to name the account the provider confirmed (connection.backendUser). */
  readonly servers = input<readonly PortalCatalogServer[] | null>(null);

  protected readonly result = signal<OAuthReturn | null>(
    readOAuthReturn(this.route.snapshot.queryParamMap),
  );
  protected readonly kind = computed(() =>
    this.result()?.kind === 'connected' ? 'success' : 'error',
  );
  protected readonly message = computed(() => {
    const result = this.result();
    if (!result) {
      return null;
    }
    const user =
      result.system && result.kind === 'connected'
        ? (this.servers()?.find((server) => server.system === result.system)?.connection
            ?.backendUser ?? null)
        : null;
    return oauthReturnMessage(result, user);
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
