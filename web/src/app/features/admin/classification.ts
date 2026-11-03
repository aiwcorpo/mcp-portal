import { Risk, ToolAction } from '../../api/generated';

/** What an administrator gives a tool of an adapter (CC-193): the gateway keeps both and Cedar takes them from there. */
export interface Classification {
  risk: Risk;
  action: ToolAction;
}

/**
 * An adapter is read only (CC-227): the gateway refuses any other classification of an adapter tool with
 * 422 classification_not_allowed, so the dialog offers READ_ONLY and read and nothing else. A tool that writes or deletes
 * is not run through an adapter until a later contract version says otherwise.
 */
export const RISKS: readonly Risk[] = ['READ_ONLY'];

export const ALLOWED_ACTIONS: Record<Risk, readonly ToolAction[]> = {
  READ_ONLY: ['read'],
  UPDATE: [],
  DESTRUCTIVE: [],
};

export function allowedPair(risk: Risk | null, action: ToolAction | null): boolean {
  return risk !== null && action !== null && ALLOWED_ACTIONS[risk].includes(action);
}
