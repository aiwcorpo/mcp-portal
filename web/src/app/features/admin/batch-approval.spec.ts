import { RegistryTool } from '../../api/generated';
import { ApiFailure } from '../../core/api-error';
import { BatchItem, approveSequentially, batchExclusion, inBatch } from './batch-approval';

function pendingTool(overrides: Partial<RegistryTool> = {}): RegistryTool {
  return {
    name: 'list_projects',
    risk: 'READ_ONLY',
    action: 'read',
    resourceRefs: [],
    definition: {
      name: 'list_projects',
      title: 'List projects',
      description: 'x',
      inputSchema: {},
    },
    definitionHash: 'sha256:' + 'a'.repeat(64),
    status: 'pending_approval',
    change: 'new',
    source: 'manifest',
    ...overrides,
  } as RegistryTool;
}

describe('batchExclusion', () => {
  it('lets a plain pending definition into a batch, read or not', () => {
    expect(batchExclusion(pendingTool())).toBeNull();
    expect(batchExclusion(pendingTool({ risk: 'DESTRUCTIVE', action: 'delete' }))).toBeNull();
    expect(inBatch(pendingTool({ source: 'server', change: 'changed' }))).toBe(true);
  });

  it('keeps a risk lowering out, as the single approval treats it on its own', () => {
    const lowered = pendingTool({ riskLowered: true });
    expect(batchExclusion(lowered)).toBe('risk-lowered');
    expect(inBatch(lowered)).toBe(false);
  });

  it('keeps out what needs a classification: an adapter entry, or one without risk and action', () => {
    expect(
      batchExclusion(pendingTool({ source: 'adapter', risk: undefined, action: undefined })),
    ).toBe('needs-classification');
    expect(batchExclusion(pendingTool({ source: 'adapter' }))).toBe('needs-classification');
    expect(batchExclusion(pendingTool({ action: undefined }))).toBe('needs-classification');
  });

  it('names the lowering first when both apply, since that one also needs the MFA', () => {
    expect(batchExclusion(pendingTool({ source: 'adapter', riskLowered: true }))).toBe(
      'risk-lowered',
    );
  });

  it('has nothing to say about an approved tool and never batches it', () => {
    const approved = pendingTool({ status: 'approved', change: undefined, source: undefined });
    expect(batchExclusion(approved)).toBeNull();
    expect(inBatch(approved)).toBe(false);
  });
});

describe('approveSequentially', () => {
  const items: BatchItem[] = ['a', 'b', 'c', 'd'].map((tool) => ({
    key: `mcp-gitlab/${tool}`,
    serverId: 'mcp-gitlab',
    tool,
    hash: `sha256:${tool}`,
  }));
  const failureOf = (error: unknown): ApiFailure => error as ApiFailure;
  const failure = (code: ApiFailure['code'], status: number): ApiFailure => ({ code, status });

  it('calls one at a time in the given order, with the hash of each item', async () => {
    const calls: string[] = [];
    let running = 0;
    let overlapped = false;
    const result = await approveSequentially(
      items,
      async (item) => {
        running += 1;
        overlapped ||= running > 1;
        calls.push(`${item.tool}:${item.hash}`);
        await Promise.resolve();
        running -= 1;
      },
      failureOf,
      () => undefined,
    );
    expect(calls).toEqual(['a:sha256:a', 'b:sha256:b', 'c:sha256:c', 'd:sha256:d']);
    expect(overlapped).toBe(false);
    expect(result.approved).toHaveLength(4);
    expect(result.failed).toEqual([]);
  });

  it('goes on after a failure and reports each one, a hash_mismatch among them', async () => {
    const result = await approveSequentially(
      items,
      async (item) => {
        if (item.tool === 'b') {
          throw failure('hash_mismatch', 409);
        }
        if (item.tool === 'c') {
          throw failure('upstream_unavailable', 503);
        }
      },
      failureOf,
      () => undefined,
    );
    expect(result.approved).toEqual(['mcp-gitlab/a', 'mcp-gitlab/d']);
    expect(result.failed.map((entry) => [entry.key, entry.failure.code])).toEqual([
      ['mcp-gitlab/b', 'hash_mismatch'],
      ['mcp-gitlab/c', 'upstream_unavailable'],
    ]);
    expect(result.stoppedForStepUp).toBe(false);
  });

  it('stops at a request for a fresh MFA and leaves the rest untried', async () => {
    const tried: string[] = [];
    const result = await approveSequentially(
      items,
      async (item) => {
        tried.push(item.tool);
        if (item.tool === 'b') {
          throw failure('step_up_required', 401);
        }
      },
      failureOf,
      () => undefined,
    );
    expect(tried).toEqual(['a', 'b']);
    expect(result.approved).toEqual(['mcp-gitlab/a']);
    expect(result.skipped).toEqual(['mcp-gitlab/b', 'mcp-gitlab/c', 'mcp-gitlab/d']);
    expect(result.stoppedForStepUp).toBe(true);
  });

  it('reports progress from 0 to the total', async () => {
    const seen: string[] = [];
    await approveSequentially(
      items.slice(0, 2),
      async () => undefined,
      failureOf,
      (done, total) => seen.push(`${done}/${total}`),
    );
    expect(seen).toEqual(['0/2', '1/2', '2/2']);
  });
});
