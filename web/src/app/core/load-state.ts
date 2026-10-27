import { ApiFailure } from './api-error';

export type LoadState<T> =
  { status: 'loading' } | { status: 'ready'; value: T } | { status: 'error'; failure: ApiFailure };

export const LOADING = { status: 'loading' } as const;
