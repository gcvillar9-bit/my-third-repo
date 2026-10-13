import { boot } from './app/boot';

boot().catch((err: unknown) => {
  console.error('[cosmos] boot failed', err);
});
