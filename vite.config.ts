import { defineConfig } from 'vite';

/**
 * Public base path. GitHub Pages serves the site from /<repo>/.
 * Priority: env BASE > GITHUB_REPOSITORY (CI) > '/my-third-repo/'.
 * Runtime asset URLs must always go through import.meta.env.BASE_URL.
 */
function resolveBase(): string {
  const fromEnv = process.env.BASE;
  if (fromEnv) return fromEnv.endsWith('/') ? fromEnv : `${fromEnv}/`;
  const repo = process.env.GITHUB_REPOSITORY?.split('/')[1];
  return repo ? `/${repo}/` : '/my-third-repo/';
}

export default defineConfig({
  base: resolveBase(),
  // GLSL is imported as text with the '?raw' suffix (typed by vite/client).
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1200,
    rolldownOptions: {
      output: {
        // three.js (and its postprocessing companion) live in their own long-cached chunk.
        manualChunks(id: string) {
          if (/[\\/]node_modules[\\/](\.pnpm[\\/])?(three|postprocessing)[@\\/]/.test(id)) return 'three';
          return undefined;
        },
      },
    },
  },
  server: { strictPort: true },
  preview: { strictPort: true },
});
