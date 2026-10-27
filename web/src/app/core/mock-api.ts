import { EnvironmentProviders, Provider } from '@angular/core';

/**
 * Production variant: no mock API. The `mocks` and `e2e` build configurations replace this file with
 * src/mocks/mock-api.msw.ts (angular.json fileReplacements), so MSW never reaches the production bundle.
 */
export async function startMockApi(): Promise<(Provider | EnvironmentProviders)[]> {
  return [];
}
