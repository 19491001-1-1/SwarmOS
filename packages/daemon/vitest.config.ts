import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    env: {
      CREWDEN_DB_PATH: ':memory:',
    },
  },
  resolve: {
    alias: {
      '@crewden/shared': resolve(__dirname, '../shared/src/index.ts'),
    },
  },
});
