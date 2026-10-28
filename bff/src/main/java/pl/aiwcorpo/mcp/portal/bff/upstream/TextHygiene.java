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

    /**
     * {@code text} with every hidden character written as {@code <U+XXXX>}; newline and tab stay. A literal
     * {@code <} before {@code U+} is written as {@code <U+003C>}, so the notation always means a character that was there.
     */
    public static String neutralize(String text) {
        StringBuilder out = null;
        int index = 0;
        int previous = -1;
        while (index < text.length()) {
            int cp = text.codePointAt(index);
            int width = Character.charCount(cp);
            // A literal "<U+" would read like the notation below; its "<" is written out too.
            if (hidden(cp, previous, true) || cp == '<' && text.startsWith("U+", index + 1)) {
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

    /**
     * Cuts text produced by {@link #neutralize} to at most {@code max} chars without splitting a surrogate pair or a
     * {@code <U+XXXX>} notation.
     */
    public static String cutAtNotation(String neutralized, int max) {
        if (neutralized.length() <= max) {
            return neutralized;
        }
        int end = max;
        int open = neutralized.lastIndexOf('<', end - 1);
        if (open >= 0 && neutralized.startsWith("<U+", open) && neutralized.indexOf('>', open) >= end) {
            end = open;
        }
        if (end > 0 && Character.isHighSurrogate(neutralized.charAt(end - 1))) {
            end--;
        }
        return neutralized.substring(0, end);
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
