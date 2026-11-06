import { PendingPolicies, ResourceTypeDeclaration } from '../../api/generated';
import { neutraliseText } from '../../shared/untrusted-text';
import { DiffLine } from './definition-diff';

export interface PolicyDiff {
  resourceTypes: { before: DiffLine[]; after: DiffLine[]; changed: boolean };
  policies: { before: DiffLine[]; after: DiffLine[]; changed: boolean };
  /** True when any shown text carried a hidden character that was replaced by a [U+XXXX] marker. */
  neutralised: boolean;
  /** Nothing was approved before: both sides of the diff start from nothing. */
  firstRegistration: boolean;
  /** Lines were left out of the view because a side was longer than the limit; the hash still covers all of it. */
  truncated: boolean;
}

/** Longest side shown; policies come from a repository or a running server and can be arbitrarily long. */
export const MAX_LINES = 1500;

function describeType(type: ResourceTypeDeclaration): string[] {
  const lines = [`type: ${type.type}`, `  attributes: ${type.attributes.join(', ')}`];
  if (type.parent) {
    lines.push(`  parent: ${type.parent} (attribute ${type.parentAttribute ?? 'missing'})`);
  }
  lines.push(`  idPattern: ${type.idPattern}`);
  lines.push(`  scopePattern: ${type.scopePattern ?? 'none (cannot be granted)'}`);
  lines.push(`  earlyScopeCheck: ${type.earlyScopeCheck === true}`);
  if (type.classification) {
    lines.push(
      `  classification: ${type.classification.attribute} (${type.classification.kind}${
        type.classification.required ? ', required' : ''
      })`,
    );
  }
  return lines;
}

function describePolicies(policies: PendingPolicies['pendingPolicies']): string[] {
  const lines = [`namespace: ${policies.namespace}`, 'schema:'];
  lines.push(...policies.schema.split(/\r?\n/).map((line) => `  ${line}`));
  for (const file of policies.files) {
    lines.push(`file: ${file.name}`);
    lines.push(...file.text.split(/\r?\n/).map((line) => `  ${line}`));
  }
  return lines;
}

/** Lines of `before` and `after` marked removed or added by a longest common subsequence, in the order of each side. */
export function markLines(
  before: readonly string[],
  after: readonly string[],
): { before: DiffLine[]; after: DiffLine[] } {
  const rows = before.length + 1;
  const columns = after.length + 1;
  const table = new Uint32Array(rows * columns);
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      table[i * columns + j] =
        before[i] === after[j]
          ? table[(i + 1) * columns + j + 1] + 1
          : Math.max(table[(i + 1) * columns + j], table[i * columns + j + 1]);
    }
  }
  const left: DiffLine[] = [];
  const right: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < before.length && j < after.length) {
    if (before[i] === after[j]) {
      left.push({ text: before[i], mark: 'same' });
      right.push({ text: after[j], mark: 'same' });
      i += 1;
      j += 1;
    } else if (table[(i + 1) * columns + j] >= table[i * columns + j + 1]) {
      left.push({ text: before[i], mark: 'removed' });
      i += 1;
    } else {
      right.push({ text: after[j], mark: 'added' });
      j += 1;
    }
  }
  for (; i < before.length; i += 1) {
    left.push({ text: before[i], mark: 'removed' });
  }
  for (; j < after.length; j += 1) {
    right.push({ text: after[j], mark: 'added' });
  }
  return { before: left, after: right };
}

/**
 * What an administrator approves is the policies and the resource type declarations together (the hash covers both), so
 * both are compared. Text comes from a manifest, so each line is neutralised before it is shown and a line break in a
 * value cannot start a line of its own (the text is split on breaks first).
 */
export function diffPolicies(pending: PendingPolicies): PolicyDiff {
  let neutralised = false;
  const safe = (lines: string[]): string[] =>
    lines.map((line) => {
      const result = neutraliseText(line);
      neutralised ||= result.neutralised;
      return result.text;
    });
  const cut = (lines: string[]): string[] => lines.slice(0, MAX_LINES);
  const approvedTypes = (pending.approvedResourceTypes ?? []).flatMap(describeType);
  const pendingTypes = pending.pendingResourceTypes.flatMap(describeType);
  const approvedPolicies = pending.approvedPolicies
    ? describePolicies(pending.approvedPolicies)
    : [];
  const pendingPolicies = describePolicies(pending.pendingPolicies);
  const truncated = [approvedTypes, pendingTypes, approvedPolicies, pendingPolicies].some(
    (lines) => lines.length > MAX_LINES,
  );
  const types = markLines(safe(cut(approvedTypes)), safe(cut(pendingTypes)));
  const policies = markLines(safe(cut(approvedPolicies)), safe(cut(pendingPolicies)));
  const changed = (side: { before: DiffLine[]; after: DiffLine[] }): boolean =>
    side.before.some((line) => line.mark !== 'same') ||
    side.after.some((line) => line.mark !== 'same');
  return {
    resourceTypes: { ...types, changed: changed(types) },
    policies: { ...policies, changed: changed(policies) },
    neutralised,
    firstRegistration: pending.approvedHash === null,
    truncated,
  };
}
