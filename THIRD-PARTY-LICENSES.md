# Third-Party Licenses

This project bundles or depends on the following third-party software.

## piexifjs

- Version: 1.0.6
- License: MIT
- Source: https://github.com/hMatoba/piexifjs
- Used by: screenshot-server Vite plugin (`vite.config.ts`) for embedding EXIF metadata in capture JPEGs

## @stryker-mutator/core, @stryker-mutator/vitest-runner, @stryker-mutator/typescript-checker

- Version: 9.6.1 (all three)
- License: Apache-2.0
- Source: https://github.com/stryker-mutator/stryker-js
- Used by: dev-only mutation testing pipeline (`npm run test:mutation`, configured via `stryker.conf.json`). Reports land in `reports/mutation/`.
