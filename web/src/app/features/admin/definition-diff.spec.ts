import { ToolEntry } from '../../api/generated';
import { describeEntry, diffDefinitions, riskChange, riskChangeText } from './definition-diff';

function entry(overrides: Partial<ToolEntry> = {}, description = 'Updates a page.'): ToolEntry {
  return {
    name: 'update_page',
    risk: 'UPDATE',
    action: 'update',
    resourceRefs: [{ argument: 'pageId', type: 'Confluence::Page' }],
    definition: {
      name: 'update_page',
      title: 'Update page',
      description,
      inputSchema: {
        type: 'object',
        properties: { pageId: { type: 'string', maxLength: 12 }, body: { type: 'string' } },
        required: ['pageId', 'body'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false },
    },
    definitionHash: 'sha256:' + 'a'.repeat(64),
    ...overrides,
  };
}

describe('describeEntry', () => {
  it('lists description, risk, resources, every schema leaf and the hints', () => {
    const lines = describeEntry(entry());
    expect(lines).toContain('opis: Updates a page.');
    expect(lines).toContain('ryzyko: Zapis (UPDATE)');
    expect(lines).toContain('akcja: update');
    expect(lines).toContain('zasób: argument pageId (Confluence::Page)');
    expect(lines).toContain('schemat.properties.pageId.maxLength: 12');
    expect(lines).toContain('schemat.required: pageId, body');
    expect(lines).toContain('schemat.additionalProperties: false');
    expect(lines).toContain('wskazówki.readOnlyHint: false');
  });

  it('is the same for equal definitions whatever the key order', () => {
    const reordered = entry();
    reordered.definition = {
      ...reordered.definition,
      inputSchema: {
        additionalProperties: false,
        required: ['pageId', 'body'],
        properties: { body: { type: 'string' }, pageId: { maxLength: 12, type: 'string' } },
        type: 'object',
      },
    };
    expect(describeEntry(reordered)).toEqual(describeEntry(entry()));
  });
});

describe('diffDefinitions', () => {
  it('marks only what changed: description, a new parameter, a looser limit', () => {
    const next = entry({}, 'Updates a page and its parent.');
    next.definition = {
      ...next.definition,
      inputSchema: {
        type: 'object',
        properties: {
          pageId: { type: 'string', maxLength: 64 },
          body: { type: 'string' },
          parentId: { type: 'string' },
        },
        required: ['pageId', 'body'],
        additionalProperties: false,
      },
    };

    const { before, after } = diffDefinitions(entry(), next);

    expect(before.filter((line) => line.mark === 'removed').map((line) => line.text)).toEqual([
      'opis: Updates a page.',
      'schemat.properties.pageId.maxLength: 12',
    ]);
    expect(after.filter((line) => line.mark === 'added').map((line) => line.text)).toEqual([
      'opis: Updates a page and its parent.',
      'schemat.properties.pageId.maxLength: 64',
      'schemat.properties.parentId.type: string',
    ]);
  });

  it('has nothing to compare with for a new tool: everything is added', () => {
    const { before, after } = diffDefinitions(null, entry());
    expect(before).toEqual([]);
    expect(after.every((line) => line.mark === 'added')).toBe(true);
  });

  it('shows a change in the risk, the action or the resources as lines', () => {
    const next = entry({ risk: 'DESTRUCTIVE', action: 'delete', resourceRefs: [] });
    const { before, after } = diffDefinitions(entry(), next);
    expect(before.filter((line) => line.mark === 'removed').map((line) => line.text)).toEqual([
      'ryzyko: Zapis (UPDATE)',
      'akcja: update',
      'zasób: argument pageId (Confluence::Page)',
    ]);
    expect(after.filter((line) => line.mark === 'added').map((line) => line.text)).toEqual([
      'ryzyko: Usuwanie (DESTRUCTIVE)',
      'akcja: delete',
    ]);
  });

  it('makes hidden characters visible and reports it', () => {
    const { after, neutralised } = diffDefinitions(
      null,
      entry({}, 'Safe\u202E text\u200B and <b>markup</b>'),
    );
    expect(neutralised).toBe(true);
    expect(after.map((line) => line.text)).toContain(
      'opis: Safe[U+202E] text[U+200B] and <b>markup</b>',
    );
  });

  it('does not report an ordinary definition', () => {
    expect(diffDefinitions(entry(), entry()).neutralised).toBe(false);
  });
});

describe('riskChange', () => {
  it('tells raised, lowered and same, and a new tool has nothing to compare', () => {
    expect(riskChange(entry(), entry({ risk: 'DESTRUCTIVE' }))).toBe('raised');
    expect(riskChange(entry(), entry({ risk: 'READ_ONLY' }))).toBe('lowered');
    expect(riskChange(entry(), entry())).toBe('same');
    expect(riskChange(null, entry())).toBe('same');
  });

  it('words the change for the approver', () => {
    const approved = entry();
    const raised = entry({ risk: 'DESTRUCTIVE' });
    expect(riskChangeText('raised', approved, raised)).toBe('Ryzyko rośnie: Zapis na Usuwanie.');
    expect(riskChangeText('lowered', raised, approved)).toContain('Ryzyko maleje');
    expect(riskChangeText('same', approved, approved)).toBeNull();
  });
});
