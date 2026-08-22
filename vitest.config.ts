import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // `npm test` is the judge's command on a clean clone. It must be fully
    // offline and must read only files that are committed in this repo.
    globals: false,
  },
});
