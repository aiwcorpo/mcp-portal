export type ResultTone = 'plain' | 'warn' | 'danger' | 'muted';

interface ResultInfo {
  label: string;
  tone: ResultTone;
  /** One sentence for the details of a row; absent when the label says it all. */
  explanation?: string;
}

/** Labels of `ActivityCall.result` (contract CC-095 table plus the auxiliary results of C10). */
const RESULTS: Record<string, () => ResultInfo> = {
  ok: () => ({ label: $localize`:@@logs.result.ok:Done`, tone: 'plain' }),
  error: () => ({ label: $localize`:@@logs.result.error:Error`, tone: 'danger' }),
  denied_not_granted: () => ({
    label: $localize`:@@logs.result.denied_not_granted:Refused (no entitlement)`,
    tone: 'danger',
  }),
  denied_filter_scope: () => ({
    label: $localize`:@@logs.result.denied_filter_scope:Refused (outside the address filter)`,
    tone: 'danger',
    explanation: $localize`:@@logs.explain.denied_filter_scope:You have an entitlement for this tool, but the address the client used excludes it. A filter in the address only narrows the list.`,
  }),
  denied_policy: () => ({
    label: $localize`:@@logs.result.denied_policy:Refused (policy)`,
    tone: 'danger',
  }),
  tool_disabled: () => ({
    label: $localize`:@@logs.result.tool_disabled:Tool switched off`,
    tone: 'danger',
  }),
  credential_required: () => ({
    label: $localize`:@@logs.result.credential_required:No connection to the system`,
    tone: 'danger',
  }),
  rate_limited: () => ({
    label: $localize`:@@logs.result.rate_limited:Too many calls`,
    tone: 'danger',
    explanation: $localize`:@@logs.explain.rate_limited:Call rejected by the rate limit. Wait a moment and try again.`,
  }),
  step_up_required: () => ({
    label: $localize`:@@logs.result.step_up_required:Identity confirmation required`,
    tone: 'danger',
  }),
  confirmation_pending: () => ({
    label: $localize`:@@logs.result.confirmation_pending:Waiting for confirmation`,
    tone: 'warn',
    explanation: $localize`:@@logs.explain.confirmation_pending:The operation is waiting for a code from the Authenticator (120 s).`,
  }),
  confirmed: () => ({
    label: $localize`:@@logs.result.confirmed:Confirmed with a code`,
    tone: 'plain',
  }),
  expired: () => ({
    label: $localize`:@@logs.result.expired:Expired`,
    tone: 'muted',
    explanation: $localize`:@@logs.explain.expired:A valid code was not entered within 120 s.`,
  }),
  confirmation_failed: () => ({
    label: $localize`:@@logs.result.confirmation_failed:Wrong code`,
    tone: 'danger',
    explanation: $localize`:@@logs.explain.confirmation_failed:All 3 attempts to enter the code were used.`,
  }),
  superseded: () => ({
    label: $localize`:@@logs.result.superseded:Invalidated`,
    tone: 'muted',
    explanation: $localize`:@@logs.explain.superseded:Replaced by a newer irreversible operation.`,
  }),
  cancelled: () => ({
    label: $localize`:@@logs.result.cancelled:Cancelled`,
    tone: 'muted',
    explanation: $localize`:@@logs.explain.cancelled:Cancelled in the operation preview.`,
  }),
  blocked_by_pending: () => ({
    label: $localize`:@@logs.result.blocked_by_pending:Blocked by a pending operation`,
    tone: 'danger',
    explanation: $localize`:@@logs.explain.blocked_by_pending:Rejected because another irreversible operation with an open preview was waiting for a code.`,
  }),
};

/** A result this version does not know is shown as a generic label (contract: never hide or reject the row). */
export function resultInfo(result: string): ResultInfo {
  const known = Object.hasOwn(RESULTS, result) ? RESULTS[result] : undefined;
  return known ? known() : { label: $localize`:@@logs.result.unknown:Other result`, tone: 'muted' };
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
      return $localize`:@@logs.group.ok:Completed`;
    case 'denied':
      return $localize`:@@logs.group.denied:Refusals`;
    case 'error':
      return $localize`:@@logs.group.error:Errors`;
    case 'confirmation':
      return $localize`:@@logs.group.confirmation:Code confirmations`;
    default:
      return $localize`:@@logs.group.all:All results`;
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
      return $localize`:@@logs.period.day:Last 24 hours`;
    case '30d':
      return $localize`:@@logs.period.month:Last 30 days`;
    default:
      return $localize`:@@logs.period.week:Last 7 days`;
  }
}

export function periodStart(period: Period, now: number = Date.now()): string {
  return new Date(now - PERIOD_MS[period]).toISOString();
}
