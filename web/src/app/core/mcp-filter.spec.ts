import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  InvalidFilterError,
  applyFilter,
  composeFilter,
  endpointParameters,
  parseFilter,
} from './mcp-filter';

const VECTORS = join(
  process.cwd(),
  'node_modules/@aiwcorpo/mcp-contracts/test-vectors/endpoint-filter',
);

interface Vector {
  description: string;
  kind?: string;
  input: Record<string, unknown>;
  expected: Record<string, unknown>;
}

function vectors(prefix: string): [string, Vector][] {
  return readdirSync(VECTORS)
    .filter((file) => file.startsWith(prefix))
    .map((file) => [file, JSON.parse(readFileSync(join(VECTORS, file), 'utf8')) as Vector]);
}

describe('mcp filter against the contract vectors (7.0.0)', () => {
  const parse = vectors('parse-');
  const apply = vectors('apply-');

  it('reads the vectors it claims to run', () => {
    expect(parse.length).toBeGreaterThan(40);
    expect(apply.length).toBeGreaterThan(15);
  });

  it.each(parse)('%s', (_file, vector) => {
    const query = vector.input['query'] as string;
    if (vector.expected['valid']) {
      const parsed = parseFilter(query);
      expect(parsed.canonical).toBe(vector.expected['canonical']);
      expect(parsed.filter).toEqual(vector.expected['filter']);
    } else {
      expect(() => parseFilter(query)).toThrow(InvalidFilterError);
      try {
        parseFilter(query);
      } catch (error) {
        expect((error as InvalidFilterError).problem).toBe(vector.expected['cause']);
      }
    }
  });

  it.each(apply)('%s', (_file, vector) => {
    const tools = vector.input['tools'] as { name: string; risk: string }[];
    const { filter, canonical } = parseFilter(vector.input['query'] as string);
    expect(canonical).toBe(vector.expected['canonical']);
    expect(applyFilter(filter, tools).map((tool) => tool.name)).toEqual(vector.expected['visible']);
  });
});

describe('composeFilter', () => {
  it('builds the canonical query in the order of the gateway', () => {
    const composed = composeFilter({
      systems: ['jira', 'gitlab'],
      tools: [],
      access: 'read',
      exclude: ['jira__delete_issue'],
    });
    expect(composed).toEqual({
      query: 'systems=gitlab,jira&access=read&exclude=jira__delete_issue',
      bytes: 'systems=gitlab,jira&access=read&exclude=jira__delete_issue'.length,
      problem: null,
    });
  });

  it('has no query and no problem without a choice', () => {
    expect(composeFilter({ systems: [], tools: [], access: null, exclude: [] })).toEqual({
      query: '',
      bytes: 0,
      problem: null,
    });
  });

  it('counts bytes and reports the limit that is reached first: 512 bytes, not 100 tools (CC-185)', () => {
    const names = Array.from(
      { length: 20 },
      (_, index) => `jira__tool_${String(index).padStart(2, '0')}_abcdefghijklmn`,
    );
    const composed = composeFilter({ systems: [], tools: names, access: null, exclude: [] });
    expect(composed.bytes).toBeGreaterThan(512);
    expect(composed.problem).toBe('query_too_long');
  });

  it('refuses more than twenty systems', () => {
    const composed = composeFilter({
      systems: Array.from({ length: 21 }, (_, index) => `s${String.fromCharCode(97 + index)}`),
      tools: [],
      access: null,
      exclude: [],
    });
    expect(composed.problem).toBe('too_many_entries');
  });

  it('refuses a name that the gateway would not parse', () => {
    const composed = composeFilter({ systems: ['Jira-1'], tools: [], access: null, exclude: [] });
    expect(composed.problem).toBe('forbidden_character');
  });
});

describe('endpointParameters', () => {
  it('splits a canonical query into the typed parameters of getMcpEndpoint', () => {
    expect(endpointParameters('systems=gitlab,jira&access=read')).toEqual({
      systems: 'gitlab,jira',
      tools: undefined,
      access: 'read',
      exclude: undefined,
    });
    expect(endpointParameters('')).toEqual({
      systems: undefined,
      tools: undefined,
      access: undefined,
      exclude: undefined,
    });
  });
});
