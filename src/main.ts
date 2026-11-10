import { boot } from './app/boot';
import { createSplash } from './app/splash';

boot().catch((err: unknown) => {
  console.error('[cosmos] boot failed', err);
  const splash = createSplash();
  // A WebGL2 failure already put its own message up; anything else gets a generic one.
  if (!document.getElementById('boot')?.classList.contains('failed'))
    splash.fail(
      `Cosmos could not start: ${err instanceof Error ? err.message : String(err)}. Reloading usually helps.`,
    );
});
