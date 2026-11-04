import { initLocale } from './app/core/locale';

initLocale()
  .then(() => import('./app/bootstrap'))
  .then(({ bootstrap }) => bootstrap())
  .catch((error: unknown) => console.error(error));
