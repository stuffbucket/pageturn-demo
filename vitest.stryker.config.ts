import { defineConfig } from 'vitest/config'

// Stryker-specific vitest config.
// Excludes Book.test.ts because 8 pre-existing popup-related tests fail
// (tracked by issue #20). Stryker requires a green initial test run, so we
// drop the whole Book.test.ts file from the dry run. As a consequence,
// Book.ts is also excluded from `mutate` in stryker.conf.json — we cannot
// reliably mutation-test code whose unit tests are already broken.
export default defineConfig({
  test: {
    globals: true,
    environment: 'happy-dom',
    setupFiles: ['src/vitest.setup.ts'],
    include: ['src/**/*.test.ts'],
    exclude: ['src/book/Book.test.ts', '**/node_modules/**'],
  },
})
