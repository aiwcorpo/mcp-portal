import { AdapterToolEntry, Risk, ToolEntry } from '../../api/generated';
import { riskLabel } from '../../shared/labels';
import { neutraliseText } from '../../shared/untrusted-text';
import { RawNumber } from './raw-json';

export type DiffMark = 'same' | 'removed' | 'added';

export interface DiffLine {
  text: string;
  mark: DiffMark;
}

export interface DefinitionDiff {
  before: DiffLine[];
  after: DiffLine[];
  /** True when any shown text carried a hidden character that was replaced by a [U+XXXX] marker. */
  neutralised: boolean;
  /** False when no shown line differs; for an approved tool whose hash differs that means the change is outside the view. */
  changed: boolean;
}

/** The pending entry of an adapter tool has no risk and action until an administrator classifies it (CC-193). */
export type EntryLike = ToolEntry | AdapterToolEntry;

export const RISK_ORDER: Record<Risk, number> = { READ_ONLY: 0, UPDATE: 1, DESTRUCTIVE: 2 };

export type RiskChange = 'raised' | 'lowered' | 'same';

/**
 * How the risk moves from the approved entry to the pending one; a new tool has nothing to compare with, and neither
 * has an adapter entry that is not classified yet (its classification is chosen in the dialog, not read from the entry).
 */
export function riskChange(approved: ToolEntry | null, pending: EntryLike): RiskChange {
  if (!approved?.risk || !pending.risk || approved.risk === pending.risk) {
    return 'same';
  }
  return RISK_ORDER[pending.risk] > RISK_ORDER[approved.risk] ? 'raised' : 'lowered';
}

/**
 * Own notation for line breaks (square brackets): a literal "[U+" in a value is already written as "[U+005B]U+"
 * by neutraliseText, so these markers cannot be imitated, unlike the BFF's <U+XXXX>.
 */
const LINE_BREAKS: Record<string, string> = {
  '\n': '[U+000A]',
  '\r': '[U+000D]',
  '\t': '[U+0009]',
};

/** More than two combining marks in a row (stacked marks that overlap other lines) are shown as markers. */
const MARK_RUN = /(\p{M}{2})(\p{M}+)/gu;

function markers(extra: string): string {
  return Array.from(
    extra,
    (char) => `[U+${char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}]`,
  ).join('');
}

/**
 * Untrusted text as one quoted token: hidden characters, line breaks, CR and tabs become visible [U+XXXX]
 * markers and the result is JSON-quoted, so a value can neither start a line of its own
 * nor imitate `path: value` of the diff.
 */
function quoted(value: string): string {
  const { text } = neutraliseText(value);
  const limited = text.replace(
    MARK_RUN,
    (_all, kept: string, extra: string) => kept + markers(extra),
  );
  return JSON.stringify(limited.replace(/[\n\r\t]/g, (char) => LINE_BREAKS[char]));
}

/** A marker for a hidden character; the markers for ordinary line breaks do not count. */
const MARKER = /\[U\+(?!000A\]|000D\]|0009\])[0-9A-F]{4,6}\]|<U\+[0-9A-F]{4,6}>/;

const PLAIN_KEY = /^[A-Za-z0-9_$-]+$/;

function key(name: string): string {
  return PLAIN_KEY.test(name) ? name : quoted(name);
}

function scalar(value: unknown): string {
  if (value instanceof RawNumber) {
    return value.source;
  }
  return typeof value === 'string' ? quoted(value) : JSON.stringify(value);
}

/**
 * Every leaf of a JSON value as `path: value`, objects in key order so that equal schemas give equal lines.
 * A schema is the thing an administrator approves, so nothing is summarised: a changed `maxLength`, a new
 * `enum` value or a loosened `additionalProperties` all show up as lines.
 */
const isLeaf = (value: unknown): boolean =>
  value === null || typeof value !== 'object' || value instanceof RawNumber;

function flatten(value: unknown, path: string, out: string[]): void {
  if (Array.isArray(value)) {
    if (value.every(isLeaf)) {
      out.push(`${path}: ${value.map(scalar).join(', ')}`);
    } else {
      value.forEach((item, index) => flatten(item, `${path}[${index}]`, out));
    }
    return;
  }
  if (!isLeaf(value)) {
    const entries = Object.entries(value as Record<string, unknown>).sort(([first], [second]) =>
      first < second ? -1 : first > second ? 1 : 0,
    );
    if (!entries.length) {
      out.push(`${path}: {}`);
    }
    for (const [name, child] of entries) {
      flatten(child, path ? `${path}.${key(name)}` : key(name), out);
    }
    return;
  }
  out.push(`${path}: ${scalar(value)}`);
}

/** The reviewable text of a tool entry, one line per fact (description, risk, resources, schema, hints). */
export function describeEntry(entry: EntryLike): string[] {
  const lines = [
    $localize`:@@admin.diff.entryName:entry: ${quoted(entry.name)}:name:`,
    $localize`:@@admin.diff.defName:name: ${quoted(entry.definition.name)}:name:`,
    $localize`:@@admin.diff.title:title: ${quoted(entry.definition.title)}:title:`,
    $localize`:@@admin.diff.description:description: ${quoted(entry.definition.description)}:description:`,
    ...(entry.risk && entry.action
      ? [
          $localize`:@@admin.diff.risk:risk: ${riskLabel(entry.risk)}:label: (${quoted(entry.risk)}:risk:)`,
          $localize`:@@admin.diff.action:action: ${quoted(entry.action)}:action:`,
        ]
      : [$localize`:@@admin.diff.unclassified:risk and action: to be assigned by an administrator`]),
  ];
  for (const ref of entry.resourceRefs) {
    lines.push(
      $localize`:@@admin.diff.resource:resource: argument ${quoted(ref.argument)}:argument: (${quoted(ref.type)}:type:)`,
    );
  }
  const schema: string[] = [];
  flatten(entry.definition.inputSchema, '', schema);
  lines.push(...schema.map((line) => $localize`:@@admin.diff.schema:schema.${line}:line:`));
  if (entry.definition.outputSchema) {
    const output: string[] = [];
    flatten(entry.definition.outputSchema, '', output);
    lines.push(
      ...output.map((line) => $localize`:@@admin.diff.outputSchema:output schema.${line}:line:`),
    );
  }
  if (entry.definition.annotations) {
    const hints: string[] = [];
    flatten(entry.definition.annotations, '', hints);
    lines.push(
      ...hints.map((line) => $localize`:@@admin.diff.annotations:hints.${line}:line:`),
    );
  }
  return lines;
}

/**
 * What a foreign server says about a tool in `annotations` (readOnlyHint, destructiveHint, ...), one `name: value`
 * line each, with hidden characters written out. Offered to the administrator as text to read when classifying;
 * the portal never turns a hint into a risk (CC-193).
 */
export function annotationHints(entry: EntryLike): string[] {
  const hints: string[] = [];
  if (entry.definition.annotations) {
    flatten(entry.definition.annotations, '', hints);
  }
  return hints;
}

/** Longest common subsequence of two line lists, as the matching index pairs. */
function commonLines(before: string[], after: string[]): [number, number][] {
  const lengths: number[][] = Array.from({ length: before.length + 1 }, () =>
    new Array<number>(after.length + 1).fill(0),
  );
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      lengths[i][j] =
        before[i] === after[j]
          ? lengths[i + 1][j + 1] + 1
          : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
    }
  }
  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < before.length && j < after.length) {
    if (before[i] === after[j]) {
      pairs.push([i, j]);
      i += 1;
      j += 1;
    } else if (lengths[i + 1][j] >= lengths[i][j + 1]) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return pairs;
}

/**
 * Old and new definition side by side (mockup 07): lines present only in the old one are `removed`, lines
 * present only in the new one `added`. A new tool has an empty "before".
 */
export function diffDefinitions(approved: ToolEntry | null, pending: EntryLike): DefinitionDiff {
  // describeEntry already neutralised every untrusted value; a second pass would rewrite its own markers.
  const before = approved ? describeEntry(approved) : [];
  const after = describeEntry(pending);
  const neutralised = [...before, ...after].some((line) => MARKER.test(line));
  const pairs = commonLines(before, after);
  const keptBefore = new Set(pairs.map(([index]) => index));
  const keptAfter = new Set(pairs.map(([, index]) => index));
  return {
    before: before.map((text, index) => ({
      text,
      mark: keptBefore.has(index) ? 'same' : 'removed',
    })),
    after: after.map((text, index) => ({ text, mark: keptAfter.has(index) ? 'same' : 'added' })),
    neutralised,
    changed: keptBefore.size !== before.length || keptAfter.size !== after.length,
  };
}

/** Sentence for the difference that matters most to the approver: the risk of the tool. */
export function riskChangeText(
  change: RiskChange,
  approved: ToolEntry | null,
  pending: EntryLike,
): string | null {
  if (!approved?.risk || !pending.risk || change === 'same') {
    return null;
  }
  const from = riskLabel(approved.risk);
  const to = riskLabel(pending.risk);
  return change === 'raised'
    ? $localize`:@@admin.riskRaised:Risk goes up: ${from}:from: to ${to}:to:.`
    : $localize`:@@admin.riskLowered:Risk goes down: ${from}:from: to ${to}:to:. The gateway does not approve risk lowering.`;
}
