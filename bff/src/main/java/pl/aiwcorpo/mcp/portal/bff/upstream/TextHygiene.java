package pl.aiwcorpo.mcp.portal.bff.upstream;

/**
 * Hidden or misleading characters in text the BFF shows in a trusted page. It follows the text hygiene of the
 * contract (CC-121, {@code test-vectors/text-hygiene/}): controls, line and paragraph separators, unpaired
 * surrogates, noncharacters, format characters (Cf, which covers bidi controls, zero-width characters, BOM and tag
 * characters), variation selectors except one U+FE0F after an emoji, and the invisible fillers. It is stricter in
 * two places on purpose: the contract lets U+200C..U+200F through, which here would still let a right-to-left mark
 * reorder a displayed name, and private-use and unassigned code points have no agreed look.
 */
public final class TextHygiene {

    private TextHygiene() {
    }

    /** {@code text} with every hidden character written as {@code <U+XXXX>}; newline and tab stay. */
    public static String neutralize(String text) {
        StringBuilder out = null;
        int index = 0;
        int previous = -1;
        while (index < text.length()) {
            int cp = text.codePointAt(index);
            int width = Character.charCount(cp);
            if (hidden(cp, previous, true)) {
                if (out == null) {
                    out = new StringBuilder(text.length() + 16).append(text, 0, index);
                }
                out.append(String.format("<U+%04X>", cp));
            } else if (out != null) {
                out.appendCodePoint(cp);
            }
            previous = cp;
            index += width;
        }
        return out == null ? text : out.toString();
    }

    /** True when {@code text} has no hidden character; with {@code lineBreaksAllowed} false newline and tab count too. */
    public static boolean isClean(String text, boolean lineBreaksAllowed) {
        int previous = -1;
        for (int index = 0; index < text.length(); ) {
            int cp = text.codePointAt(index);
            if (hidden(cp, previous, lineBreaksAllowed)) {
                return false;
            }
            previous = cp;
            index += Character.charCount(cp);
        }
        return true;
    }

    private static boolean hidden(int cp, int previous, boolean lineBreaksAllowed) {
        if (cp == '\n' || cp == '\t') {
            return !lineBreaksAllowed;
        }
        if (cp == 0xfe0f && previous >= 0 && Character.isExtendedPictographic(previous)) {
            return false;
        }
        if (cp >= 0xfe00 && cp <= 0xfe0f || cp >= 0xe0100 && cp <= 0xe01ef || cp >= 0x180b && cp <= 0x180f) {
            return true;
        }
        if (cp == 0x034f || cp == 0x115f || cp == 0x1160 || cp == 0x3164 || cp == 0xffa0 || cp == 0x2800
                || cp == 0x17b4 || cp == 0x17b5) {
            return true;
        }
        if (cp >= 0xfdd0 && cp <= 0xfdef || (cp & 0xfffe) == 0xfffe) {
            return true;
        }
        return switch (Character.getType(cp)) {
            case Character.CONTROL, Character.FORMAT, Character.LINE_SEPARATOR, Character.PARAGRAPH_SEPARATOR,
                    Character.PRIVATE_USE, Character.UNASSIGNED, Character.SURROGATE -> true;
            default -> false;
        };
    }
}
