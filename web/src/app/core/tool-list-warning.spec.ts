import { DEFAULT_TOOL_LIST_WARNING, toolListWarningFrom } from './tool-list-warning';

function documentWith(content: string | null): Document {
  const doc = document.implementation.createHTMLDocument('');
  if (content !== null) {
    const meta = doc.createElement('meta');
    meta.name = 'mcp-tool-list-warning';
    meta.content = content;
    doc.head.append(meta);
  }
  return doc;
}

describe('tool list warning threshold', () => {
  it('is 50 until the load test settles it', () => {
    expect(DEFAULT_TOOL_LIST_WARNING).toBe(50);
    expect(toolListWarningFrom(documentWith(null))).toBe(50);
  });

  it('is read from the meta tag of index.html', () => {
    expect(toolListWarningFrom(documentWith('120'))).toBe(120);
    expect(toolListWarningFrom(documentWith(' 30 '))).toBe(30);
  });

  it.each(['', '0', '-5', 'abc', '1.5', '1e3', '999999'])('ignores %j', (value) => {
    expect(toolListWarningFrom(documentWith(value))).toBe(50);
  });
});
