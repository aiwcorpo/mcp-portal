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
  connected: $localize`:@@catalogStatus.connected:Connected`,
  expiring: $localize`:@@catalogStatus.expiring:Expires soon`,
  reconnect_required: $localize`:@@catalogStatus.reconnect_required:Needs reconnecting`,
  not_connected: $localize`:@@catalogStatus.not_connected:Not connected`,
  request_pending: $localize`:@@catalogStatus.request_pending:Request pending`,
  no_access: $localize`:@@catalogStatus.no_access:No entitlement`,
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
    return $localize`:@@days.today:today`;
  }
  return days === 1
    ? $localize`:@@days.one:in 1 day`
    : $localize`:@@days.many:in ${days}:days: days`;
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
        ? $localize`:@@catalogStatus.tokenExpiresIn:Token expires ${when}:when:`
        : $localize`:@@catalogStatus.connectionExpiresIn:Connection expires ${when}:when:`;
    }
  }
  // error: the secret of the connection is gone from the store or a rotated token was lost (CC-205, CC-196). It
  // does not heal itself, so the row says what to do, not only that something is wrong.
  if (status === 'reconnect_required' && connection?.status === 'error') {
    return $localize`:@@catalogStatus.connectionBroken:Connection stopped working, connect the account again`;
  }
  return STATUS_LABELS[status];
}

const ACTION_LABELS: Record<CatalogAction, string> = {
  copy_link: $localize`:@@action.copy_link:Copy link`,
  connect_oauth: $localize`:@@action.connect_oauth:Connect with OAuth`,
  add_secret: $localize`:@@action.add_secret:Add token`,
  reconnect: $localize`:@@action.reconnect:Renew`,
  request_access: $localize`:@@action.request_access:Submit request`,
  view_request: $localize`:@@action.view_request:View request`,
  disconnect: $localize`:@@action.disconnect:Disconnect`,
};

export function actionLabel(action: CatalogAction, connection?: Connection | null): string {
  if (action === 'reconnect' && connection?.type === 'user-oauth') {
    return $localize`:@@action.reconnectOAuth:Connect`;
  }
  // add_secret next to an existing connection means replacing an expiring or revoked token.
  if (action === 'add_secret' && connection) {
    return $localize`:@@action.renewSecret:Renew`;
  }
  return ACTION_LABELS[action];
}

const RISK_LABELS: Record<Risk, string> = {
  READ_ONLY: $localize`:@@risk.READ_ONLY:Read`,
  UPDATE: $localize`:@@risk.UPDATE:Write`,
  DESTRUCTIVE: $localize`:@@risk.DESTRUCTIVE:Delete`,
};

export function riskLabel(risk: Risk): string {
  return RISK_LABELS[risk];
}

/** An entry of an adapter has no risk until an administrator classifies it (CC-193). */
export function riskOrUnclassified(risk: Risk | undefined): string {
  return risk ? RISK_LABELS[risk] : $localize`:@@risk.unclassified:To classify`;
}

const CREDENTIAL_TYPE_LABELS: Record<CredentialType, string> = {
  'user-oauth': 'OAuth',
  'user-secret': $localize`:@@credentialType.user-secret:PAT token`,
  'token-exchange': $localize`:@@credentialType.token-exchange:Token exchange`,
  'service-account': $localize`:@@credentialType.service-account:Service account`,
};

export function credentialTypeLabel(type: CredentialType): string {
  return CREDENTIAL_TYPE_LABELS[type];
}

const CONNECTION_STATUS_LABELS: Record<ConnectionStatus, string> = {
  connected: $localize`:@@connectionStatus.connected:Active`,
  expiring: $localize`:@@connectionStatus.expiring:Expires soon`,
  expired: $localize`:@@connectionStatus.expired:Expired`,
  revoked: $localize`:@@connectionStatus.revoked:Revoked`,
  error: $localize`:@@connectionStatus.error:Stopped working`,
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
