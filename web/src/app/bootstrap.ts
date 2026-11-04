import { bootstrapApplication } from '@angular/platform-browser';
import { App } from './app';
import { appConfig } from './app.config';
import { startMockApi } from './core/mock-api';

/** Loaded by main.ts after the translations are registered, because the modules below evaluate $localize. */
export async function bootstrap(): Promise<void> {
  const mockProviders = await startMockApi();
  await bootstrapApplication(App, { providers: [...appConfig.providers, ...mockProviders] });
}
