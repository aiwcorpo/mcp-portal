/**
 * Filter in the query of the aggregate MCP endpoint (CC-170, CC-185). A port of
 * `scripts/lib/endpoint-filter.mjs` from mcp-contracts 7.0.0, pinned by `test-vectors/endpoint-filter/`.
 * The portal uses it to count the bytes of the query before it asks the BFF for an address (the BFF and the
 * gateway stay the authority), and the dev mock uses it to answer `getMcpEndpoint`.
 */

export const FILTER_PARAMETERS = ['systems', 'tools', 'access', 'exclude'] as const;
export type FilterParameter = (typeof FILTER_PARAMETERS)[number];

/** The query is limited in bytes, not in entries: 16 names of 30 characters fit, not 100 (CC-185). */
export const MAX_QUERY_BYTES = 512;
export const MAX_SYSTEMS = 20;
export const MAX_TOOLS = 100;
export const MAX_EXCLUDE = 100;

export type FilterAccess = 'read' | 'write';

export interface McpFilter {
  systems: string[] | null;
  tools: string[] | null;
  access: FilterAccess | null;
  exclude: string[] | null;
}

export type FilterProblem =
  | 'query_too_long'
  | 'percent_encoding'
  | 'forbidden_character'
  | 'empty_parameter'
  | 'malformed_parameter'
  | 'unknown_parameter'
  | 'repeated_parameter'
  | 'invalid_access'
  | 'empty_value'
  | 'empty_entry'
  | 'invalid_entry'
  | 'too_many_entries';

export class InvalidFilterError extends Error {
  constructor(readonly problem: FilterProblem) {
    super(problem);
  }
}

const SYSTEM = /^[a-z][a-z0-9]*$/;
const TOOL = /^[a-z][a-z0-9]*__[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
const ALLOWED_CHARACTERS = /^[A-Za-z0-9_,=&]*$/;
const MAX_TOOL_LENGTH = 80;
const MAX_SYSTEM_LENGTH = 32;
const LIMITS = { systems: MAX_SYSTEMS, tools: MAX_TOOLS, exclude: MAX_EXCLUDE } as const;

const isSystem = (entry: string) => entry.length <= MAX_SYSTEM_LENGTH && SYSTEM.test(entry);
const isTool = (entry: string) => entry.length <= MAX_TOOL_LENGTH && TOOL.test(entry);

export const bytewise = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(bytewise);
}

export function emptyFilter(): McpFilter {
  return { systems: null, tools: null, access: null, exclude: null };
}

function entries(name: 'systems' | 'tools' | 'exclude', value: string): string[] {
  if (value === '') {
    throw new InvalidFilterError('empty_value');
  }
  const parts = value.split(',');
  if (parts.some((part) => part === '')) {
    throw new InvalidFilterError('empty_entry');
  }
  const unique = sortedUnique(parts);
  for (const entry of unique) {
    const ok =
      name === 'systems'
        ? isSystem(entry)
        : name === 'tools'
          ? isTool(entry)
          : isSystem(entry) || isTool(entry);
    if (!ok) {
      throw new InvalidFilterError('invalid_entry');
    }
  }
  if (unique.length > LIMITS[name]) {
    throw new InvalidFilterError('too_many_entries');
  }
  return unique;
}

/** Parses a query without the leading "?". An empty query is no filter (canonical ""). */
export function parseFilter(rawQuery: string): { filter: McpFilter; canonical: string } {
  if (rawQuery === '') {
    return { filter: emptyFilter(), canonical: '' };
  }
  if (new TextEncoder().encode(rawQuery).length > MAX_QUERY_BYTES) {
    throw new InvalidFilterError('query_too_long');
  }
  if (rawQuery.includes('%')) {
    throw new InvalidFilterError('percent_encoding');
  }
  if (!ALLOWED_CHARACTERS.test(rawQuery)) {
    throw new InvalidFilterError('forbidden_character');
  }
  const filter = emptyFilter();
  const seen = new Set<string>();
  for (const part of rawQuery.split('&')) {
    if (part === '') {
      throw new InvalidFilterError('empty_parameter');
    }
    const equals = part.indexOf('=');
    if (equals <= 0 || part.indexOf('=', equals + 1) !== -1) {
      throw new InvalidFilterError('malformed_parameter');
    }
    const name = part.slice(0, equals).toLowerCase();
    const value = part.slice(equals + 1).toLowerCase();
    if (!(FILTER_PARAMETERS as readonly string[]).includes(name)) {
      throw new InvalidFilterError('unknown_parameter');
    }
    if (seen.has(name)) {
      throw new InvalidFilterError('repeated_parameter');
    }
    seen.add(name);
    if (name === 'access') {
      if (value !== 'read' && value !== 'write') {
        throw new InvalidFilterError('invalid_access');
      }
      filter.access = value;
    } else {
      filter[name as 'systems' | 'tools' | 'exclude'] = entries(
        name as 'systems' | 'tools' | 'exclude',
        value,
      );
    }
  }
  return { filter, canonical: canonicalText(filter) };
}

export function canonicalText(filter: McpFilter): string {
  const parts: string[] = [];
  if (filter.systems) {
    parts.push(`systems=${filter.systems.join(',')}`);
  }
  if (filter.tools) {
    parts.push(`tools=${filter.tools.join(',')}`);
  }
  if (filter.access) {
    parts.push(`access=${filter.access}`);
  }
  if (filter.exclude) {
    parts.push(`exclude=${filter.exclude.join(',')}`);
  }
  return parts.join('&');
}

export interface FilterableTool {
  name: string;
  risk: string;
}

/** The tools that the filter leaves visible; a risk outside the closed set is in neither access group (CC-186). */
export function applyFilter<T extends FilterableTool>(filter: McpFilter, tools: readonly T[]): T[] {
  return tools.filter((tool) => {
    const system = tool.name.slice(0, tool.name.indexOf('__'));
    if (filter.systems && !filter.systems.includes(system)) {
      return false;
    }
    if (filter.tools && !filter.tools.includes(tool.name)) {
      return false;
    }
    if (filter.access === 'read' && tool.risk !== 'READ_ONLY') {
      return false;
    }
    if (filter.access === 'write' && tool.risk !== 'UPDATE' && tool.risk !== 'DESTRUCTIVE') {
      return false;
    }
    return !(
      filter.exclude &&
      (filter.exclude.includes(system) || filter.exclude.includes(tool.name))
    );
  });
}

/** What the user chose in the wizard; an empty list or `null` access means "no restriction". */
export interface FilterChoice {
  systems: readonly string[];
  tools: readonly string[];
  access: FilterAccess | null;
  exclude: readonly string[];
}

export interface ComposedFilter {
  /** Canonical query, "" without a filter. */
  query: string;
  bytes: number;
  /** Why the BFF would refuse this query; null when it can be asked for. */
  problem: FilterProblem | null;
}

/** Builds the canonical query from a choice and checks it with the rules of the gateway. */
export function composeFilter(choice: FilterChoice): ComposedFilter {
  const filter: McpFilter = {
    systems: choice.systems.length ? sortedUnique(choice.systems) : null,
    tools: choice.tools.length ? sortedUnique(choice.tools) : null,
    access: choice.access,
    exclude: choice.exclude.length ? sortedUnique(choice.exclude) : null,
  };
  const query = canonicalText(filter);
  const bytes = new TextEncoder().encode(query).length;
  try {
    parseFilter(query);
    return { query, bytes, problem: null };
  } catch (error) {
    if (error instanceof InvalidFilterError) {
      return { query, bytes, problem: error.problem };
    }
    throw error;
  }
}

/** Typed parameters of getMcpEndpoint from a canonical query (values are comma separated, not encoded). */
export function endpointParameters(query: string): Record<FilterParameter, string | undefined> {
  const values: Record<FilterParameter, string | undefined> = {
    systems: undefined,
    tools: undefined,
    access: undefined,
    exclude: undefined,
  };
  for (const part of query ? query.split('&') : []) {
    const equals = part.indexOf('=');
    values[part.slice(0, equals) as FilterParameter] = part.slice(equals + 1);
  }
  return values;
}
