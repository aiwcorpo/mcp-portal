export type ResultTone = 'plain' | 'warn' | 'danger' | 'muted';

interface ResultInfo {
  label: string;
  tone: ResultTone;
  /** One sentence for the details of a row; absent when the label says it all. */
  explanation?: string;
}

/** Labels of `ActivityCall.result` (contract CC-095 table plus the auxiliary results of C10). */
const RESULTS: Record<string, () => ResultInfo> = {
  ok: () => ({ label: $localize`:@@logs.result.ok:Wykonano`, tone: 'plain' }),
  error: () => ({ label: $localize`:@@logs.result.error:Błąd`, tone: 'danger' }),
  denied_not_granted: () => ({
    label: $localize`:@@logs.result.denied_not_granted:Odmowa (brak uprawnienia)`,
    tone: 'danger',
  }),
  denied_link_scope: () => ({
    label: $localize`:@@logs.result.denied_link_scope:Odmowa (poza zakresem linku)`,
    tone: 'danger',
  }),
  denied_policy: () => ({
    label: $localize`:@@logs.result.denied_policy:Odmowa (polityka)`,
    tone: 'danger',
  }),
  tool_disabled: () => ({
    label: $localize`:@@logs.result.tool_disabled:Narzędzie wyłączone`,
    tone: 'danger',
  }),
  credential_required: () => ({
    label: $localize`:@@logs.result.credential_required:Brak połączenia z systemem`,
    tone: 'danger',
  }),
  rate_limited: () => ({
    label: $localize`:@@logs.result.rate_limited:Przekroczony limit`,
    tone: 'danger',
  }),
  step_up_required: () => ({
    label: $localize`:@@logs.result.step_up_required:Wymaga potwierdzenia tożsamości`,
    tone: 'danger',
  }),
  confirmation_pending: () => ({
    label: $localize`:@@logs.result.confirmation_pending:Czeka na potwierdzenie`,
    tone: 'warn',
    explanation: $localize`:@@logs.explain.confirmation_pending:Operacja czeka na kod z Authenticatora (120 s).`,
  }),
  confirmed: () => ({
    label: $localize`:@@logs.result.confirmed:Potwierdzone kodem`,
    tone: 'plain',
  }),
  expired: () => ({
    label: $localize`:@@logs.result.expired:Wygasło`,
    tone: 'muted',
    explanation: $localize`:@@logs.explain.expired:Poprawny kod nie został wpisany w ciągu 120 s.`,
  }),
  confirmation_failed: () => ({
    label: $localize`:@@logs.result.confirmation_failed:Błędny kod`,
    tone: 'danger',
    explanation: $localize`:@@logs.explain.confirmation_failed:Wyczerpano 3 próby wpisania kodu.`,
  }),
  superseded: () => ({
    label: $localize`:@@logs.result.superseded:Unieważnione`,
    tone: 'muted',
    explanation: $localize`:@@logs.explain.superseded:Zastąpione nowszą operacją nieodwracalną.`,
  }),
  cancelled: () => ({
    label: $localize`:@@logs.result.cancelled:Anulowane`,
    tone: 'muted',
    explanation: $localize`:@@logs.explain.cancelled:Anulowane w podglądzie operacji.`,
  }),
  blocked_by_pending: () => ({
    label: $localize`:@@logs.result.blocked_by_pending:Zablokowane przez oczekującą`,
    tone: 'danger',
    explanation: $localize`:@@logs.explain.blocked_by_pending:Odrzucone, bo inna operacja nieodwracalna z otwartym podglądem czekała na kod.`,
  }),
};

/** A result this version does not know is shown as a generic label (contract: never hide or reject the row). */
export function resultInfo(result: string): ResultInfo {
  const known = Object.hasOwn(RESULTS, result) ? RESULTS[result] : undefined;
  return known ? known() : { label: $localize`:@@logs.result.unknown:Inny wynik`, tone: 'muted' };
}

const CLIENT_NAMES: Record<string, string> = {
  'claude-code': 'Claude Code',
  copilot: 'Copilot',
  codex: 'Codex',
};

export function clientName(client: string | undefined): string {
  if (!client) {
    return '';
  }
  return Object.hasOwn(CLIENT_NAMES, client) ? CLIENT_NAMES[client] : client;
}

export type ResultGroup = '' | 'ok' | 'denied' | 'error' | 'confirmation';
export const RESULT_GROUPS: readonly ResultGroup[] = ['', 'ok', 'denied', 'error', 'confirmation'];

export function groupLabel(group: ResultGroup): string {
  switch (group) {
    case 'ok':
      return $localize`:@@logs.group.ok:Wykonane`;
    case 'denied':
      return $localize`:@@logs.group.denied:Odmowy`;
    case 'error':
      return $localize`:@@logs.group.error:Błędy`;
    case 'confirmation':
      return $localize`:@@logs.group.confirmation:Potwierdzenia kodem`;
    default:
      return $localize`:@@logs.group.all:Wszystkie wyniki`;
  }
}

export type Period = '24h' | '7d' | '30d';
export const PERIODS: readonly Period[] = ['24h', '7d', '30d'];
const PERIOD_MS: Record<Period, number> = {
  '24h': 86_400_000,
  '7d': 7 * 86_400_000,
  '30d': 30 * 86_400_000,
};

export function periodLabel(period: Period): string {
  switch (period) {
    case '24h':
      return $localize`:@@logs.period.day:Ostatnie 24 godziny`;
    case '30d':
      return $localize`:@@logs.period.month:Ostatnie 30 dni`;
    default:
      return $localize`:@@logs.period.week:Ostatnie 7 dni`;
  }
}

export function periodStart(period: Period, now: number = Date.now()): string {
  return new Date(now - PERIOD_MS[period]).toISOString();
}
