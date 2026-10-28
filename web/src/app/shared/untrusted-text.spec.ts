import argumentInvalidArabicLetterMark from '@aiwcorpo/mcp-contracts/test-vectors/text-hygiene/argument-invalid-arabic-letter-mark.json';
import argumentInvalidBell from '@aiwcorpo/mcp-contracts/test-vectors/text-hygiene/argument-invalid-bell.json';
import argumentInvalidBidiIsolate from '@aiwcorpo/mcp-contracts/test-vectors/text-hygiene/argument-invalid-bidi-isolate.json';
import argumentInvalidBidiOverride from '@aiwcorpo/mcp-contracts/test-vectors/text-hygiene/argument-invalid-bidi-override.json';
import argumentInvalidBom from '@aiwcorpo/mcp-contracts/test-vectors/text-hygiene/argument-invalid-bom.json';
import argumentInvalidBrailleBlank from '@aiwcorpo/mcp-contracts/test-vectors/text-hygiene/argument-invalid-braille-blank.json';
import argumentInvalidC1Last from '@aiwcorpo/mcp-contracts/test-vectors/text-hygiene/argument-invalid-c1-last.json';
import argumentInvalidC1NextLine from '@aiwcorpo/mcp-contracts/test-vectors/text-hygiene/argument-invalid-c1-next-line.json';
import argumentInvalidCombiningGraphemeJoiner from '@aiwcorpo/mcp-contracts/test-vectors/text-hygiene/argument-invalid-combining-grapheme-joiner.json';
import argumentInvalidDelete from '@aiwcorpo/mcp-contracts/test-vectors/text-hygiene/argument-invalid-delete.json';
import argumentInvalidDoubleVariationSelector from '@aiwcorpo/mcp-contracts/test-vectors/text-hygiene/argument-invalid-double-variation-selector.json';
import argumentInvalidEscape from '@aiwcorpo/mcp-contracts/test-vectors/text-hygiene/argument-invalid-escape.json';
import argumentInvalidHalfwidthHangulFiller from '@aiwcorpo/mcp-contracts/test-vectors/text-hygiene/argument-invalid-halfwidth-hangul-filler.json';
import argumentInvalidHangulChoseongFiller from '@aiwcorpo/mcp-contracts/test-vectors/text-hygiene/argument-invalid-hangul-choseong-filler.json';
import argumentInvalidHangulFiller from '@aiwcorpo/mcp-contracts/test-vectors/text-hygiene/argument-invalid-hangul-filler.json';
import argumentInvalidHangulJungseongFiller from '@aiwcorpo/mcp-contracts/test-vectors/text-hygiene/argument-invalid-hangul-jungseong-filler.json';
import argumentInvalidLineSeparator from '@aiwcorpo/mcp-contracts/test-vectors/text-hygiene/argument-invalid-line-separator.json';
import argumentInvalidNoncharacter10ffff from '@aiwcorpo/mcp-contracts/test-vectors/text-hygiene/argument-invalid-noncharacter-10ffff.json';
import argumentInvalidNoncharacterFdd0 from '@aiwcorpo/mcp-contracts/test-vectors/text-hygiene/argument-invalid-noncharacter-fdd0.json';
import argumentInvalidNoncharacterFffe from '@aiwcorpo/mcp-contracts/test-vectors/text-hygiene/argument-invalid-noncharacter-fffe.json';
import argumentInvalidNoncharacterFfff from '@aiwcorpo/mcp-contracts/test-vectors/text-hygiene/argument-invalid-noncharacter-ffff.json';
import argumentInvalidNul from '@aiwcorpo/mcp-contracts/test-vectors/text-hygiene/argument-invalid-nul.json';
import argumentInvalidParagraphSeparator from '@aiwcorpo/mcp-contracts/test-vectors/text-hygiene/argument-invalid-paragraph-separator.json';
import argumentInvalidRunOfInvisible from '@aiwcorpo/mcp-contracts/test-vectors/text-hygiene/argument-invalid-run-of-invisible.json';
import argumentInvalidSoftHyphen from '@aiwcorpo/mcp-contracts/test-vectors/text-hygiene/argument-invalid-soft-hyphen.json';
import argumentInvalidTagCharacter from '@aiwcorpo/mcp-contracts/test-vectors/text-hygiene/argument-invalid-tag-character.json';
import argumentInvalidVariationSelector1 from '@aiwcorpo/mcp-contracts/test-vectors/text-hygiene/argument-invalid-variation-selector-1.json';
import argumentInvalidVariationSelectorAfterLetter from '@aiwcorpo/mcp-contracts/test-vectors/text-hygiene/argument-invalid-variation-selector-after-letter.json';
import argumentInvalidVariationSelectorAtStart from '@aiwcorpo/mcp-contracts/test-vectors/text-hygiene/argument-invalid-variation-selector-at-start.json';
import argumentInvalidVariationSelectorSupplement from '@aiwcorpo/mcp-contracts/test-vectors/text-hygiene/argument-invalid-variation-selector-supplement.json';
import argumentInvalidWordJoiner from '@aiwcorpo/mcp-contracts/test-vectors/text-hygiene/argument-invalid-word-joiner.json';
import argumentInvalidZeroWidthSpace from '@aiwcorpo/mcp-contracts/test-vectors/text-hygiene/argument-invalid-zero-width-space.json';
import argumentValidAsciiAtAll from '@aiwcorpo/mcp-contracts/test-vectors/text-hygiene/argument-valid-ascii-at-all.json';
import argumentValidAscii from '@aiwcorpo/mcp-contracts/test-vectors/text-hygiene/argument-valid-ascii.json';
import argumentValidEmojiVariationSelector from '@aiwcorpo/mcp-contracts/test-vectors/text-hygiene/argument-valid-emoji-variation-selector.json';
import argumentValidEmpty from '@aiwcorpo/mcp-contracts/test-vectors/text-hygiene/argument-valid-empty.json';
import argumentValidFullWidthOutsideMentionFilter from '@aiwcorpo/mcp-contracts/test-vectors/text-hygiene/argument-valid-full-width-outside-mention-filter.json';
import argumentValidLrmRlm from '@aiwcorpo/mcp-contracts/test-vectors/text-hygiene/argument-valid-lrm-rlm.json';
import argumentValidNewlineTabCr from '@aiwcorpo/mcp-contracts/test-vectors/text-hygiene/argument-valid-newline-tab-cr.json';
import argumentValidNfkcSensitiveText from '@aiwcorpo/mcp-contracts/test-vectors/text-hygiene/argument-valid-nfkc-sensitive-text.json';
import argumentValidPolish from '@aiwcorpo/mcp-contracts/test-vectors/text-hygiene/argument-valid-polish.json';
import argumentValidZwjSequence from '@aiwcorpo/mcp-contracts/test-vectors/text-hygiene/argument-valid-zwj-sequence.json';
import argumentValidZwnj from '@aiwcorpo/mcp-contracts/test-vectors/text-hygiene/argument-valid-zwnj.json';
import { neutraliseText } from './untrusted-text';

describe('neutraliseText', () => {
  it('leaves ordinary text, line breaks, tabs and an emoji presentation selector alone', () => {
    for (const value of ['Zażółć gęślą jaźń\n\tok', 'ABC-123', '❤️ ok', '']) {
      expect(neutraliseText(value)).toEqual({ text: value, neutralised: false });
    }
  });

  it.each([
    0x202e, 0x2066, 0x200f, 0x200b, 0x2028, 0x0000, 0x0007, 0x0085, 0x007f, 0xfeff, 0x00ad, 0x034f,
    0x115f, 0x3164, 0xffa0, 0x2800, 0xfe00, 0xe0001, 0xe0100, 0x0600, 0x180e, 0xe000, 0xfdd0,
    0xfffe,
  ])('replaces U+%s by a visible marker', (code) => {
    const marker = `[U+${code.toString(16).toUpperCase().padStart(4, '0')}]`;
    expect(neutraliseText(`a${String.fromCodePoint(code)}b`)).toEqual({
      text: `a${marker}b`,
      neutralised: true,
    });
  });

  it('replaces a variation selector that does not follow an emoji, and an unpaired surrogate', () => {
    expect(neutraliseText('a️').text).toBe('a[U+FE0F]');
    expect(neutraliseText('a\uD800b').text).toBe('a[U+D800]b');
  });

  it('writes a literal "[U+" so that it cannot pass for a marker', () => {
    expect(neutraliseText('page[U+002F]x')).toEqual({
      text: 'page[U+005B]U+002F]x',
      neutralised: true,
    });
    expect(neutraliseText('[U+202E]').text).toBe('[U+005B]U+202E]');
    expect(neutraliseText('[ U+1] [x]').neutralised).toBe(false);
  });

  it('only reports the markers the BFF wrote itself', () => {
    expect(neutraliseText('a<U+202E>b')).toEqual({ text: 'a<U+202E>b', neutralised: true });
    expect(neutraliseText('<U+1F600> and <U+12>').neutralised).toBe(true);
    expect(neutraliseText('<U+12>').neutralised).toBe(false);
  });

  describe('contract vectors (test-vectors/text-hygiene, mode argument)', () => {
    const vectors: { file: string; input: string; expected: { valid: boolean } }[] = [
      { file: 'argument-invalid-arabic-letter-mark.json', ...argumentInvalidArabicLetterMark },
      { file: 'argument-invalid-bell.json', ...argumentInvalidBell },
      { file: 'argument-invalid-bidi-isolate.json', ...argumentInvalidBidiIsolate },
      { file: 'argument-invalid-bidi-override.json', ...argumentInvalidBidiOverride },
      { file: 'argument-invalid-bom.json', ...argumentInvalidBom },
      { file: 'argument-invalid-braille-blank.json', ...argumentInvalidBrailleBlank },
      { file: 'argument-invalid-c1-last.json', ...argumentInvalidC1Last },
      { file: 'argument-invalid-c1-next-line.json', ...argumentInvalidC1NextLine },
      {
        file: 'argument-invalid-combining-grapheme-joiner.json',
        ...argumentInvalidCombiningGraphemeJoiner,
      },
      { file: 'argument-invalid-delete.json', ...argumentInvalidDelete },
      {
        file: 'argument-invalid-double-variation-selector.json',
        ...argumentInvalidDoubleVariationSelector,
      },
      { file: 'argument-invalid-escape.json', ...argumentInvalidEscape },
      {
        file: 'argument-invalid-halfwidth-hangul-filler.json',
        ...argumentInvalidHalfwidthHangulFiller,
      },
      {
        file: 'argument-invalid-hangul-choseong-filler.json',
        ...argumentInvalidHangulChoseongFiller,
      },
      { file: 'argument-invalid-hangul-filler.json', ...argumentInvalidHangulFiller },
      {
        file: 'argument-invalid-hangul-jungseong-filler.json',
        ...argumentInvalidHangulJungseongFiller,
      },
      { file: 'argument-invalid-line-separator.json', ...argumentInvalidLineSeparator },
      { file: 'argument-invalid-noncharacter-10ffff.json', ...argumentInvalidNoncharacter10ffff },
      { file: 'argument-invalid-noncharacter-fdd0.json', ...argumentInvalidNoncharacterFdd0 },
      { file: 'argument-invalid-noncharacter-fffe.json', ...argumentInvalidNoncharacterFffe },
      { file: 'argument-invalid-noncharacter-ffff.json', ...argumentInvalidNoncharacterFfff },
      { file: 'argument-invalid-nul.json', ...argumentInvalidNul },
      { file: 'argument-invalid-paragraph-separator.json', ...argumentInvalidParagraphSeparator },
      { file: 'argument-invalid-run-of-invisible.json', ...argumentInvalidRunOfInvisible },
      { file: 'argument-invalid-soft-hyphen.json', ...argumentInvalidSoftHyphen },
      { file: 'argument-invalid-tag-character.json', ...argumentInvalidTagCharacter },
      { file: 'argument-invalid-variation-selector-1.json', ...argumentInvalidVariationSelector1 },
      {
        file: 'argument-invalid-variation-selector-after-letter.json',
        ...argumentInvalidVariationSelectorAfterLetter,
      },
      {
        file: 'argument-invalid-variation-selector-at-start.json',
        ...argumentInvalidVariationSelectorAtStart,
      },
      {
        file: 'argument-invalid-variation-selector-supplement.json',
        ...argumentInvalidVariationSelectorSupplement,
      },
      { file: 'argument-invalid-word-joiner.json', ...argumentInvalidWordJoiner },
      { file: 'argument-invalid-zero-width-space.json', ...argumentInvalidZeroWidthSpace },
      { file: 'argument-valid-ascii-at-all.json', ...argumentValidAsciiAtAll },
      { file: 'argument-valid-ascii.json', ...argumentValidAscii },
      {
        file: 'argument-valid-emoji-variation-selector.json',
        ...argumentValidEmojiVariationSelector,
      },
      { file: 'argument-valid-empty.json', ...argumentValidEmpty },
      {
        file: 'argument-valid-full-width-outside-mention-filter.json',
        ...argumentValidFullWidthOutsideMentionFilter,
      },
      { file: 'argument-valid-lrm-rlm.json', ...argumentValidLrmRlm },
      { file: 'argument-valid-newline-tab-cr.json', ...argumentValidNewlineTabCr },
      { file: 'argument-valid-nfkc-sensitive-text.json', ...argumentValidNfkcSensitiveText },
      { file: 'argument-valid-polish.json', ...argumentValidPolish },
      { file: 'argument-valid-zwj-sequence.json', ...argumentValidZwjSequence },
      { file: 'argument-valid-zwnj.json', ...argumentValidZwnj },
    ];

    it('has vectors', () => {
      expect(vectors.length).toBeGreaterThan(20);
    });

    it.each(vectors)('$file', (vector) => {
      if (vector.expected.valid) {
        // The contract lets U+200C..U+200F through; this page is stricter on purpose, like the BFF.
        const lenient = /[‌-‏]/.test(vector.input);
        if (!lenient) {
          expect(neutraliseText(vector.input).neutralised).toBe(false);
        }
      } else {
        expect(neutraliseText(vector.input).neutralised).toBe(true);
      }
    });
  });
});
