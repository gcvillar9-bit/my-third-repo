import { defineConfig } from 'vitest/config';

// Unit tests are GPU-free and run in Node. GLSL '?raw' imports work here too.
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
  },
});
