import { defineConfig } from 'vitest/config'

// Stryker-specific vitest config.
//
// Historical note: this previously excluded `Book.test.ts` because eight
// popup-related tests failed at baseline (issue #20). Per ADR-0001, the
// popup feature is now disabled-by-design and those tests are
// `describe.skip(...)` — the file is green, so Book.test.ts is back in
// the Stryker dry run and Book.ts is back in the `mutate` set.
export default defineConfig({
  test: {
    globals: true,
    environment: 'happy-dom',
    setupFiles: ['src/vitest.setup.ts'],
    include: ['src/**/*.test.ts'],
    exclude: ['**/node_modules/**'],
  },
})
