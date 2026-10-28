/**
 * Text that comes from an AI agent or a target system and is shown in a trusted page. Hidden or misleading
 * characters are replaced by a visible [U+XXXX] marker, so that what is drawn is in the same order as what was
 * sent and nothing can reorder the surrounding page. The set follows the contract's text hygiene (CC-121,
 * test-vectors/text-hygiene) and is as strict as the BFF's: controls, line and paragraph separators, format
 * characters (bidi controls, zero-width, BOM, tags), private-use, unassigned and noncharacter code points,
 * unpaired surrogates, variation selectors (except one U+FE0F after an emoji) and the invisible fillers.
 * Newline, tab and CR before LF stay; the caller renders them with white-space: pre-wrap.
 *
 * A literal "[U+" in the value is written as "[U+005B]U+", so the notation always stands for a character that
 * was there. The BFF writes its own neutralisation as <U+XXXX> with the same rule for a literal "<U+", so
 * its notation passes through unchanged and is only reported.
 */
const HIDDEN_CLASSES = [
  '\\p{Cc}',
  '\\p{Cf}',
  '\\p{Zl}',
  '\\p{Zp}',
  '\\p{Co}',
  '\\p{Cn}',
  '\\p{Cs}',
  '\\u180B-\\u180F',
  '\\uFE00-\\uFE0F',
  '\\u{E0100}-\\u{E01EF}',
  '\\u034F\\u115F\\u1160\\u3164\\uFFA0\\u2800\\u17B4\\u17B5',
].join('');
const NEUTRALISED = new RegExp(`\\[(?=U\\+)|[${HIDDEN_CLASSES}]`, 'gu');
const PICTOGRAPH = /\p{Extended_Pictographic}$/u;
const WRITTEN_BY_BFF = /<U\+[0-9A-F]{4,6}>/;

export interface SafeText {
  text: string;
  /** True when a character was replaced by a marker here, or the BFF already wrote one. */
  neutralised: boolean;
}

export function neutraliseText(value: string): SafeText {
  let neutralised = WRITTEN_BY_BFF.test(value);
  const text = value.replace(NEUTRALISED, (match, offset: number, whole: string) => {
    if (match === '\n' || match === '\t' || (match === '\r' && whole[offset + 1] === '\n')) {
      return match;
    }
    if (match === '️' && PICTOGRAPH.test(whole.slice(0, offset))) {
      return match;
    }
    neutralised = true;
    return `[U+${match.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}]`;
  });
  return { text, neutralised };
}
