import { AdapterToolEntry, ToolEntry } from '../../api/generated';
import { parseKeepingNumbers } from './raw-json';
import {
  annotationHints,
  describeEntry,
  diffDefinitions,
  riskChange,
  riskChangeText,
} from './definition-diff';

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
    expect(lines).toContain('description: "Updates a page."');
    expect(lines).toContain('risk: Write ("UPDATE")');
    expect(lines).toContain('action: "update"');
    expect(lines).toContain('resource: argument "pageId" ("Confluence::Page")');
    expect(lines).toContain('schema.properties.pageId.maxLength: 12');
    expect(lines).toContain('schema.required: "pageId", "body"');
    expect(lines).toContain('schema.additionalProperties: false');
    expect(lines).toContain('hints.readOnlyHint: false');
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
      'description: "Updates a page."',
      'schema.properties.pageId.maxLength: 12',
    ]);
    expect(after.filter((line) => line.mark === 'added').map((line) => line.text)).toEqual([
      'description: "Updates a page and its parent."',
      'schema.properties.pageId.maxLength: 64',
      'schema.properties.parentId.type: "string"',
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
      'risk: Write ("UPDATE")',
      'action: "update"',
      'resource: argument "pageId" ("Confluence::Page")',
    ]);
    expect(after.filter((line) => line.mark === 'added').map((line) => line.text)).toEqual([
      'risk: Delete ("DESTRUCTIVE")',
      'action: "delete"',
    ]);
  });

  it('makes hidden characters visible and reports it', () => {
    const { after, neutralised } = diffDefinitions(
      null,
      entry({}, 'Safe\u202E text\u200B and <b>markup</b>'),
    );
    expect(neutralised).toBe(true);
    expect(after.map((line) => line.text)).toContain(
      'description: "Safe[U+202E] text[U+200B] and <b>markup</b>"',
    );
  });

  it('does not report an ordinary definition', () => {
    expect(diffDefinitions(entry(), entry()).neutralised).toBe(false);
  });
});

describe('hostile text', () => {
  const forged = 'ok\nrisk: Read ("READ_ONLY")\r\n\tschema.additionalProperties: false';

  it('keeps line breaks, CR and tabs of a value inside one quoted line', () => {
    const lines = describeEntry(entry({}, forged));
    expect(lines.every((line) => !/[\n\r\t]/.test(line))).toBe(true);
    expect(lines.filter((line) => line.startsWith('risk:'))).toEqual([
      'risk: Write ("UPDATE")',
    ]);
    expect(lines[3]).toBe(
      'description: "ok[U+000A]risk: Read (\\"READ_ONLY\\")[U+000D][U+000A][U+0009]schema.additionalProperties: false"',
    );
  });

  it('cannot hide a risk change behind a forged line', () => {
    const { after } = diffDefinitions(entry(), entry({ risk: 'DESTRUCTIVE' }, forged));
    expect(after.filter((line) => line.mark === 'added').map((line) => line.text)).toContain(
      'risk: Delete ("DESTRUCTIVE")',
    );
  });

  it('quotes schema keys and string values that try to forge a path', () => {
    const hostile = entry();
    hostile.definition = {
      ...hostile.definition,
      inputSchema: {
        properties: { 'a\nschema.required: x': { description: 'v\nw', enum: ['1\n2'] } },
      },
    };
    const lines = describeEntry(hostile).filter((line) => line.startsWith('schema.'));
    expect(lines).toEqual([
      'schema.properties."a[U+000A]schema.required: x".description: "v[U+000A]w"',
      'schema.properties."a[U+000A]schema.required: x".enum: "1[U+000A]2"',
    ]);
  });
});

describe('what the hash covers', () => {
  it('shows the name of the definition and of the entry', () => {
    const renamed = entry();
    renamed.definition = { ...renamed.definition, name: 'other_name' };
    const { before, after, changed } = diffDefinitions(entry(), renamed);
    expect(changed).toBe(true);
    expect(before.filter((line) => line.mark === 'removed').map((line) => line.text)).toEqual([
      'name: "update_page"',
    ]);
    expect(after.filter((line) => line.mark === 'added').map((line) => line.text)).toEqual([
      'name: "other_name"',
    ]);
  });

  it('compares numbers as written, also beyond 2^53', () => {
    const parse = (limit: string) =>
      parseKeepingNumbers<ToolEntry>(
        JSON.stringify(entry()).replace('"maxLength":12', `"maxLength":${limit}`),
      );
    const { changed, after } = diffDefinitions(
      parse('9007199254740992'),
      parse('9007199254740993'),
    );
    expect(changed).toBe(true);
    expect(after.some((line) => line.text.endsWith('maxLength: 9007199254740993'))).toBe(true);
  });

  it('reports no change for equal definitions (the caller then knows a hash difference is hidden)', () => {
    expect(diffDefinitions(entry(), entry()).changed).toBe(false);
  });

  it('cannot be fooled by the notation of the BFF: a literal marker differs from a real line break', () => {
    const real = describeEntry(entry({}, 'a\nb'));
    const typed = describeEntry(entry({}, 'a<U+000A>b'));
    const bracket = describeEntry(entry({}, 'a[U+000A]b'));
    expect(real).not.toEqual(typed);
    expect(real).not.toEqual(bracket);
  });

  it('limits stacked combining marks and reports hidden characters only when there were some', () => {
    const stacked = diffDefinitions(null, entry({}, 'x\u0301\u0302\u0303\u0304'));
    expect(stacked.after.some((line) => line.text.includes('[U+0303][U+0304]'))).toBe(true);
    expect(diffDefinitions(null, entry({}, 'two\nlines')).neutralised).toBe(false);
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
    expect(riskChangeText('raised', approved, raised)).toBe('Risk goes up: Write to Delete.');
    expect(riskChangeText('lowered', raised, approved)).toContain('Risk goes down');
    expect(riskChangeText('same', approved, approved)).toBeNull();
  });
});

describe('an entry of an adapter', () => {
  function adapterEntry(): AdapterToolEntry {
    const classified = entry({}, 'Removes a comment.');
    return {
      name: classified.name,
      resourceRefs: [],
      definition: { ...classified.definition, annotations: { readOnlyHint: true } },
      definitionHash: classified.definitionHash,
    };
  }

  it('is described without a risk and says the administrator gives it', () => {
    const lines = describeEntry(adapterEntry());
    expect(lines).toContain('risk and action: to be assigned by an administrator');
    expect(lines.some((line) => line.startsWith('risk:'))).toBe(false);
  });

  it('has no risk change to compare, so nothing is read as a lowering', () => {
    expect(riskChange(entry(), adapterEntry())).toBe('same');
    expect(riskChangeText('same', entry(), adapterEntry())).toBeNull();
  });

  it('gives the hints of the server as text lines, hidden characters written out', () => {
    const hinted = adapterEntry();
    hinted.definition = {
      ...hinted.definition,
      annotations: { readOnlyHint: true, title: 'a\u202Eb' },
    };

    expect(annotationHints(hinted)).toEqual(['readOnlyHint: true', 'title: "a[U+202E]b"']);
    expect(
      annotationHints(entry({ definition: { ...entry().definition, annotations: undefined } })),
    ).toEqual([]);
  });
});
