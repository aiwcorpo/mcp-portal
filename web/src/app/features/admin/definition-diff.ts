import { Risk, ToolEntry } from '../../api/generated';
import { riskLabel } from '../../shared/labels';
import { neutraliseText } from '../../shared/untrusted-text';

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
}

const RISK_ORDER: Record<Risk, number> = { READ_ONLY: 0, UPDATE: 1, DESTRUCTIVE: 2 };

export type RiskChange = 'raised' | 'lowered' | 'same';

/** How the risk moves from the approved entry to the pending one; a new tool has nothing to compare with. */
export function riskChange(approved: ToolEntry | null, pending: ToolEntry): RiskChange {
  if (!approved || approved.risk === pending.risk) {
    return 'same';
  }
  return RISK_ORDER[pending.risk] > RISK_ORDER[approved.risk] ? 'raised' : 'lowered';
}

const LINE_BREAKS: Record<string, string> = {
  '\n': '<U+000A>',
  '\r': '<U+000D>',
  '\t': '<U+0009>',
};

/**
 * Untrusted text as one quoted token: hidden characters, line breaks, CR and tabs become visible <U+XXXX>
 * markers (the BFF's notation) and the result is JSON-quoted, so a value can neither start a line of its own
 * nor imitate `path: value` of the diff.
 */
function quoted(value: string): string {
  const { text } = neutraliseText(value);
  return JSON.stringify(text.replace(/[\n\r\t]/g, (char) => LINE_BREAKS[char]));
}

const MARKER = /\[U\+[0-9A-F]{4,6}\]|<U\+[0-9A-F]{4,6}>/;

const PLAIN_KEY = /^[A-Za-z0-9_$-]+$/;

function key(name: string): string {
  return PLAIN_KEY.test(name) ? name : quoted(name);
}

function scalar(value: unknown): string {
  return typeof value === 'string' ? quoted(value) : JSON.stringify(value);
}

/**
 * Every leaf of a JSON value as `path: value`, objects in key order so that equal schemas give equal lines.
 * A schema is the thing an administrator approves, so nothing is summarised: a changed `maxLength`, a new
 * `enum` value or a loosened `additionalProperties` all show up as lines.
 */
function flatten(value: unknown, path: string, out: string[]): void {
  if (Array.isArray(value)) {
    if (value.every((item) => item === null || typeof item !== 'object')) {
      out.push(`${path}: ${value.map(scalar).join(', ')}`);
    } else {
      value.forEach((item, index) => flatten(item, `${path}[${index}]`, out));
    }
    return;
  }
  if (value !== null && typeof value === 'object') {
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
export function describeEntry(entry: ToolEntry): string[] {
  const lines = [
    $localize`:@@admin.diff.title:tytuł: ${quoted(entry.definition.title)}:title:`,
    $localize`:@@admin.diff.description:opis: ${quoted(entry.definition.description)}:description:`,
    $localize`:@@admin.diff.risk:ryzyko: ${riskLabel(entry.risk)}:label: (${quoted(entry.risk)}:risk:)`,
    $localize`:@@admin.diff.action:akcja: ${quoted(entry.action)}:action:`,
  ];
  for (const ref of entry.resourceRefs) {
    lines.push(
      $localize`:@@admin.diff.resource:zasób: argument ${quoted(ref.argument)}:argument: (${quoted(ref.type)}:type:)`,
    );
  }
  const schema: string[] = [];
  flatten(entry.definition.inputSchema, '', schema);
  lines.push(...schema.map((line) => $localize`:@@admin.diff.schema:schemat.${line}:line:`));
  if (entry.definition.outputSchema) {
    const output: string[] = [];
    flatten(entry.definition.outputSchema, '', output);
    lines.push(
      ...output.map((line) => $localize`:@@admin.diff.outputSchema:schemat wyniku.${line}:line:`),
    );
  }
  if (entry.definition.annotations) {
    const hints: string[] = [];
    flatten(entry.definition.annotations, '', hints);
    lines.push(
      ...hints.map((line) => $localize`:@@admin.diff.annotations:wskazówki.${line}:line:`),
    );
  }
  return lines;
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
export function diffDefinitions(approved: ToolEntry | null, pending: ToolEntry): DefinitionDiff {
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
  };
}

/** Sentence for the difference that matters most to the approver: the risk of the tool. */
export function riskChangeText(
  change: RiskChange,
  approved: ToolEntry | null,
  pending: ToolEntry,
): string | null {
  if (!approved || change === 'same') {
    return null;
  }
  const from = riskLabel(approved.risk);
  const to = riskLabel(pending.risk);
  return change === 'raised'
    ? $localize`:@@admin.riskRaised:Ryzyko rośnie: ${from}:from: na ${to}:to:.`
    : $localize`:@@admin.riskLowered:Ryzyko maleje: ${from}:from: na ${to}:to:. Obniżenia ryzyka gateway nie zatwierdza.`;
}
