import { DOCUMENT } from '@angular/common';
import { InjectionToken, inject } from '@angular/core';

/**
 * From this many tools on one address the portal advises narrowing it. The value is not settled: it waits for the
 * measurement of the M5 load test (token cost of the list per client), so it is configuration and not a constant of
 * the code. Deployments set it with `<meta name="mcp-tool-list-warning" content="N">` in index.html.
 */
export const DEFAULT_TOOL_LIST_WARNING = 50;
export const TOOL_LIST_WARNING_META = 'mcp-tool-list-warning';

export function toolListWarningFrom(document: Document): number {
  const content = document
    .querySelector(`meta[name="${TOOL_LIST_WARNING_META}"]`)
    ?.getAttribute('content');
  const value =
    content !== undefined && content !== null && /^[0-9]{1,5}$/.test(content.trim())
      ? Number(content)
      : NaN;
  return Number.isSafeInteger(value) && value > 0 ? value : DEFAULT_TOOL_LIST_WARNING;
}

export const TOOL_LIST_WARNING_THRESHOLD = new InjectionToken<number>(
  'TOOL_LIST_WARNING_THRESHOLD',
  {
    providedIn: 'root',
    factory: () => toolListWarningFrom(inject(DOCUMENT)),
  },
);

/** The gateway pages `tools/list` by 100 (CC-181); a client that does not follow `nextCursor` sees only the first page. */
export const TOOLS_LIST_PAGE_SIZE = 100;
