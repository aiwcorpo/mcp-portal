import { RegistryTool } from '../../api/generated';
import { ApiFailure } from '../../core/api-error';

/**
 * Why a pending definition is not part of a batch. Both keep their own review: a risk lowering needs the fresh MFA and a
 * confirmation of its own, and a definition of an adapter needs a classification that only the administrator can give.
 */
export type BatchExclusion = 'risk-lowered' | 'needs-classification';

export function batchExclusion(tool: RegistryTool): BatchExclusion | null {
  if (tool.status !== 'pending_approval') {
    return null;
  }
  if (tool.riskLowered === true) {
    return 'risk-lowered';
  }
  // Same test as the single approval (ToolDiff.fromAdapter): an adapter entry is approved only together with a classification.
  if (tool.source === 'adapter' || tool.risk === undefined || tool.action === undefined) {
    return 'needs-classification';
  }
  return null;
}

export function inBatch(tool: RegistryTool): boolean {
  return tool.status === 'pending_approval' && batchExclusion(tool) === null;
}

export interface BatchItem {
  key: string;
  serverId: string;
  tool: string;
  /** The hash the administrator saw in the list; the gateway refuses it if the definition changed since. */
  hash: string;
}

export interface BatchFailure {
  key: string;
  failure: ApiFailure;
}

export interface BatchResult {
  approved: string[];
  failed: BatchFailure[];
  /** The BFF asked for a fresh MFA: the rest was not tried, because the confirmation would end the page. */
  stoppedForStepUp: boolean;
  /** Items that were not tried because of that. */
  skipped: string[];
}

/**
 * Approves one by one, in the order given. A failure of one item never stops the others, except a request for a fresh MFA:
 * the same answer would follow every other call, and the redirect to the IdP would lose the rest of the run.
 */
export async function approveSequentially(
  items: readonly BatchItem[],
  approve: (item: BatchItem) => Promise<void>,
  toFailure: (error: unknown) => ApiFailure,
  progress: (done: number, total: number) => void,
): Promise<BatchResult> {
  const result: BatchResult = { approved: [], failed: [], stoppedForStepUp: false, skipped: [] };
  progress(0, items.length);
  for (const [index, item] of items.entries()) {
    try {
      await approve(item);
      result.approved.push(item.key);
    } catch (error) {
      const failure = toFailure(error);
      if (failure.code === 'step_up_required') {
        result.stoppedForStepUp = true;
        result.skipped = items.slice(index).map((rest) => rest.key);
        progress(index, items.length);
        return result;
      }
      result.failed.push({ key: item.key, failure });
    }
    progress(index + 1, items.length);
  }
  return result;
}
