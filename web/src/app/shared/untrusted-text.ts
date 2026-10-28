/**
 * Text that comes from an AI agent or a target system and is shown in a trusted page. Control and
 * bidirectional format characters are replaced by a visible [U+XXXX] marker, so that what is drawn is
 * in the same order as what was sent and nothing can reorder the surrounding page (CC-031).
 * Line breaks and tabs stay, the caller renders them with white-space: pre-wrap.
 */
const INVISIBLE_RANGES = [
  '\\u0000-\\u0008',
  '\\u000B\\u000C',
  '\\u000E-\\u001F',
  '\\u007F-\\u009F',
  '\\u061C',
  '\\u200B-\\u200F',
  '\\u2028-\\u202E',
  '\\u2060-\\u206F',
  '\\uFEFF',
  '\\uFFF9-\\uFFFB',
];
const INVISIBLE = new RegExp(`[${INVISIBLE_RANGES.join('')}]`, 'gu');

export interface SafeText {
  text: string;
  /** True when at least one character was replaced by a marker. */
  neutralised: boolean;
}

/** The BFF may already have written a neutralised character as <U+202E>; that counts as neutralised too. */
const WRITTEN_MARKER = /<U\+[0-9A-F]{4,6}>/;

export function neutraliseText(value: string): SafeText {
  let neutralised = WRITTEN_MARKER.test(value);
  const text = value.replace(INVISIBLE, (char) => {
    neutralised = true;
    return `[U+${char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}]`;
  });
  return { text, neutralised };
}
