import {
  Access,
  CatalogAction,
  CatalogStatus,
  ConnectionStatus,
  CredentialType,
  Risk,
  SystemId,
} from '../api/generated';

const SYSTEM_NAMES: Record<SystemId, string> = {
  jira: 'Jira',
  confluence: 'Confluence',
  gitlab: 'GitLab',
  servicedesk: $localize`:@@system.servicedesk:Service desk`,
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
  connected: $localize`:@@catalogStatus.connected:Połączono`,
  expiring: $localize`:@@catalogStatus.expiring:Wkrótce wygasa`,
  reconnect_required: $localize`:@@catalogStatus.reconnect_required:Wymaga ponownego połączenia`,
  not_connected: $localize`:@@catalogStatus.not_connected:Niepołączone`,
  request_pending: $localize`:@@catalogStatus.request_pending:Wniosek w toku`,
  no_access: $localize`:@@catalogStatus.no_access:Brak dostępu`,
};

const STATUS_HINTS: Record<CatalogStatus, string> = {
  connected: $localize`:@@catalogHint.connected:Konto jest połączone. Skopiuj adres serwera do konfiguracji klienta AI.`,
  expiring: $localize`:@@catalogHint.expiring:Połączenie wygasa w ciągu 7 dni. Odnów je, żeby uniknąć przerwy.`,
  reconnect_required: $localize`:@@catalogHint.reconnect_required:Połączenie wygasło, zostało unieważnione albo zgłasza błąd. Połącz konto ponownie.`,
  not_connected: $localize`:@@catalogHint.not_connected:Masz dostęp, ale konto w tym systemie nie jest jeszcze połączone.`,
  request_pending: $localize`:@@catalogHint.request_pending:Twój wniosek o dostęp czeka na decyzję.`,
  no_access: $localize`:@@catalogHint.no_access:Nie masz uprawnień do żadnego narzędzia tego serwera.`,
};

export function catalogStatusLabel(status: CatalogStatus): string {
  return STATUS_LABELS[status];
}

export function catalogStatusHint(status: CatalogStatus): string {
  return STATUS_HINTS[status];
}

const ACTION_LABELS: Record<CatalogAction, string> = {
  copy_link: $localize`:@@action.copy_link:Kopiuj link`,
  connect_oauth: $localize`:@@action.connect_oauth:Połącz przez OAuth`,
  add_secret: $localize`:@@action.add_secret:Dodaj token`,
  reconnect: $localize`:@@action.reconnect:Odnów`,
  request_access: $localize`:@@action.request_access:Złóż wniosek`,
  view_request: $localize`:@@action.view_request:Zobacz wniosek`,
  disconnect: $localize`:@@action.disconnect:Odłącz`,
};

export function actionLabel(action: CatalogAction): string {
  return ACTION_LABELS[action];
}

const RISK_LABELS: Record<Risk, string> = {
  READ_ONLY: $localize`:@@risk.READ_ONLY:Odczyt`,
  UPDATE: $localize`:@@risk.UPDATE:Zmiana`,
  DESTRUCTIVE: $localize`:@@risk.DESTRUCTIVE:Destrukcyjne`,
};

export function riskLabel(risk: Risk): string {
  return RISK_LABELS[risk];
}

const ACCESS_LABELS: Record<Access, string> = {
  granted: $localize`:@@access.granted:Przyznany`,
  denied: $localize`:@@access.denied:Brak`,
};

export function accessLabel(access: Access): string {
  return ACCESS_LABELS[access];
}

const CREDENTIAL_TYPE_LABELS: Record<CredentialType, string> = {
  'user-oauth': 'OAuth',
  'user-secret': $localize`:@@credentialType.user-secret:Token`,
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
  reconnect_required: 'error',
  not_connected: 'neutral',
  request_pending: 'info',
  no_access: 'neutral',
};

export function catalogStatusTone(status: CatalogStatus): Tone {
  return CATALOG_STATUS_TONES[status];
}

const CONNECTION_STATUS_TONES: Record<ConnectionStatus, Tone> = {
  connected: 'ok',
  expiring: 'warn',
  expired: 'error',
  revoked: 'error',
  error: 'error',
};

export function connectionStatusTone(status: ConnectionStatus): Tone {
  return CONNECTION_STATUS_TONES[status];
}
