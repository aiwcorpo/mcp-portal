import {
  CatalogAction,
  CatalogStatus,
  Connection,
  ConnectionStatus,
  CredentialType,
  Risk,
  SystemId,
} from '../api/generated';

const SYSTEM_NAMES: Record<SystemId, string> = {
  jira: 'Jira',
  confluence: 'Confluence',
  gitlab: 'GitLab',
  servicedesk: $localize`:@@system.servicedesk:Service Desk`,
  opensearch: 'OpenSearch',
};

export const SYSTEM_IDS: readonly SystemId[] = Object.values(SystemId);

export function isSystemId(value: unknown): value is SystemId {
  return typeof value === 'string' && (SYSTEM_IDS as readonly string[]).includes(value);
}

export function systemName(system: SystemId): string {
  return SYSTEM_NAMES[system];
}

const STATUS_LABELS: Record<CatalogStatus, string> = {
  connected: $localize`:@@catalogStatus.connected:Połączone`,
  expiring: $localize`:@@catalogStatus.expiring:Wkrótce wygasa`,
  reconnect_required: $localize`:@@catalogStatus.reconnect_required:Wymaga ponownego połączenia`,
  not_connected: $localize`:@@catalogStatus.not_connected:Niepołączone`,
  request_pending: $localize`:@@catalogStatus.request_pending:Wniosek oczekuje`,
  no_access: $localize`:@@catalogStatus.no_access:Brak uprawnienia`,
};

export function catalogStatusLabel(status: CatalogStatus): string {
  return STATUS_LABELS[status];
}

const DAY_MS = 86_400_000;

/** Whole days from `now` to `iso`, never negative; null when the date is missing or unreadable. */
export function daysUntil(iso: string | null | undefined, now: number = Date.now()): number | null {
  const time = iso ? Date.parse(iso) : Number.NaN;
  return Number.isNaN(time) ? null : Math.max(0, Math.ceil((time - now) / DAY_MS));
}

export function daysText(days: number): string {
  if (days === 0) {
    return $localize`:@@days.today:dziś`;
  }
  return days === 1
    ? $localize`:@@days.one:za 1 dzień`
    : $localize`:@@days.many:za ${days}:days: dni`;
}

/** Status line of a catalog row; an expiring connection says when (mockup 01: "Token wygasa za 5 dni"). */
export function catalogStatusText(
  status: CatalogStatus,
  connection: Connection | null | undefined,
  now: number = Date.now(),
): string {
  if (status === 'expiring') {
    const days = daysUntil(connection?.expiresAt, now);
    if (days !== null) {
      const when = daysText(days);
      return connection?.type === 'user-secret'
        ? $localize`:@@catalogStatus.tokenExpiresIn:Token wygasa ${when}:when:`
        : $localize`:@@catalogStatus.connectionExpiresIn:Połączenie wygasa ${when}:when:`;
    }
  }
  return STATUS_LABELS[status];
}

const ACTION_LABELS: Record<CatalogAction, string> = {
  copy_link: $localize`:@@action.copy_link:Kopiuj link`,
  connect_oauth: $localize`:@@action.connect_oauth:Połącz przez OAuth`,
  add_secret: $localize`:@@action.add_secret:Dodaj token`,
  reconnect: $localize`:@@action.reconnect:Odnów`,
  request_access: $localize`:@@action.request_access:Złóż wniosek`,
  view_request: $localize`:@@action.view_request:Zobacz wniosek`,
  disconnect: $localize`:@@action.disconnect:Rozłącz`,
};

export function actionLabel(action: CatalogAction, connection?: Connection | null): string {
  if (action === 'reconnect' && connection?.type === 'user-oauth') {
    return $localize`:@@action.reconnectOAuth:Połącz`;
  }
  // add_secret next to an existing connection means replacing an expiring or revoked token.
  if (action === 'add_secret' && connection) {
    return $localize`:@@action.renewSecret:Odnów`;
  }
  return ACTION_LABELS[action];
}

const RISK_LABELS: Record<Risk, string> = {
  READ_ONLY: $localize`:@@risk.READ_ONLY:Odczyt`,
  UPDATE: $localize`:@@risk.UPDATE:Zapis`,
  DESTRUCTIVE: $localize`:@@risk.DESTRUCTIVE:Usuwanie`,
};

export function riskLabel(risk: Risk): string {
  return RISK_LABELS[risk];
}

const CREDENTIAL_TYPE_LABELS: Record<CredentialType, string> = {
  'user-oauth': 'OAuth',
  'user-secret': $localize`:@@credentialType.user-secret:Token PAT`,
  'token-exchange': $localize`:@@credentialType.token-exchange:Wymiana tokenu`,
  'service-account': $localize`:@@credentialType.service-account:Konto serwisowe`,
};

export function credentialTypeLabel(type: CredentialType): string {
  return CREDENTIAL_TYPE_LABELS[type];
}

const CONNECTION_STATUS_LABELS: Record<ConnectionStatus, string> = {
  connected: $localize`:@@connectionStatus.connected:Aktywne`,
  expiring: $localize`:@@connectionStatus.expiring:Wkrótce wygasa`,
  expired: $localize`:@@connectionStatus.expired:Wygasło`,
  revoked: $localize`:@@connectionStatus.revoked:Unieważnione`,
  error: $localize`:@@connectionStatus.error:Błąd`,
};

export function connectionStatusLabel(status: ConnectionStatus): string {
  return CONNECTION_STATUS_LABELS[status];
}

export type Tone = 'ok' | 'warn' | 'error' | 'info' | 'neutral';

const CATALOG_STATUS_TONES: Record<CatalogStatus, Tone> = {
  connected: 'ok',
  expiring: 'warn',
  reconnect_required: 'warn',
  not_connected: 'neutral',
  request_pending: 'neutral',
  no_access: 'neutral',
};

export function catalogStatusTone(status: CatalogStatus): Tone {
  return CATALOG_STATUS_TONES[status];
}

const CONNECTION_STATUS_TONES: Record<ConnectionStatus, Tone> = {
  connected: 'ok',
  expiring: 'warn',
  expired: 'warn',
  revoked: 'warn',
  error: 'warn',
};

export function connectionStatusTone(status: ConnectionStatus): Tone {
  return CONNECTION_STATUS_TONES[status];
}
