import { Risk, ToolAction } from '../../api/generated';

/** What an administrator gives a tool of an adapter (CC-193): the gateway keeps both and Cedar takes them from there. */
export interface Classification {
  risk: Risk;
  action: ToolAction;
}

export const RISKS: readonly Risk[] = ['READ_ONLY', 'UPDATE', 'DESTRUCTIVE'];

/**
 * The pairs the gateway accepts (CC-207): read only for READ_ONLY, update for UPDATE, delete for DESTRUCTIVE, and admin
 * for UPDATE or DESTRUCTIVE. Anything else is 422 classification_inconsistent, so the dialog offers no other pair.
 */
export const ALLOWED_ACTIONS: Record<Risk, readonly ToolAction[]> = {
  READ_ONLY: ['read'],
  UPDATE: ['update', 'admin'],
  DESTRUCTIVE: ['delete', 'admin'],
};

export function allowedPair(risk: Risk | null, action: ToolAction | null): boolean {
  return risk !== null && action !== null && ALLOWED_ACTIONS[risk].includes(action);
}
