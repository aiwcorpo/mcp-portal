import { bootstrapApplication } from '@angular/platform-browser';
import { App } from './app/app';
import { appConfig } from './app/app.config';
import { startMockApi } from './app/core/mock-api';

startMockApi()
  .then((mockProviders) =>
    bootstrapApplication(App, { providers: [...appConfig.providers, ...mockProviders] }),
  )
  .catch((error: unknown) => console.error(error));
