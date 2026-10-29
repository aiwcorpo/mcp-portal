/** A number as it was written in the JSON text, so that a value beyond 2^53 is compared as written. */
export class RawNumber {
  constructor(readonly source: string) {}
}

type Reviver = (key: string, value: unknown, context?: { source?: string }) => unknown;

/**
 * Parses JSON keeping every number as its source text where the engine reports it (the `source` of the JSON.parse
 * reviver context); otherwise numbers stay numbers. The definition hash covers these values, so the diff must
 * not round them.
 */
export function parseKeepingNumbers<T>(text: string): T {
  const reviver: Reviver = (_key, value, context) =>
    typeof value === 'number' && typeof context?.source === 'string'
      ? new RawNumber(context.source)
      : value;
  return JSON.parse(text, reviver as (key: string, value: unknown) => unknown) as T;
}
