import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { CatalogTool } from '../app/api/generated';
import { mcpEndpointAnswer } from './endpoint-mock';

const DIRECTORY = join(
  process.cwd(),
  'node_modules/@aiwcorpo/mcp-contracts/test-vectors/mcp-endpoint',
);

interface Vector {
  description: string;
  input: {
    publicBaseUrl: string;
    httpQuery?: string;
    rawQuery: string;
    catalog: { name: string; risk: string; access: string; disabled: boolean }[];
  };
  expected: { status: number; body: unknown };
}

const vectors = readdirSync(DIRECTORY)
  .filter((file) => file.endsWith('.json'))
  .map((file): [string, Vector] => [
    file,
    JSON.parse(readFileSync(join(DIRECTORY, file), 'utf8')) as Vector,
  ]);

describe('mock of getMcpEndpoint against the contract vectors (5.1.0)', () => {
  it('runs every vector of the directory', () => {
    expect(vectors.length).toBeGreaterThanOrEqual(15);
  });

  it.each(vectors)('%s', (_file, vector) => {
    // A vector with httpQuery goes through the HTTP layer; rawQuery is already what the BFF got after decoding.
    const params =
      vector.input.httpQuery !== undefined
        ? new URLSearchParams(vector.input.httpQuery)
        : new URLSearchParams(
            vector.input.rawQuery
              ? vector.input.rawQuery.split('&').map((part) => {
                  const equals = part.indexOf('=');
                  return [part.slice(0, equals), part.slice(equals + 1)];
                })
              : [],
          );
    const answer = mcpEndpointAnswer(params, vector.input.catalog as unknown as CatalogTool[]);
    expect(answer.status).toBe(vector.expected.status);
    expect(answer.body).toEqual(vector.expected.body);
  });
});
