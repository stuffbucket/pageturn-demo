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
- Used by: screenshot-server Vite plugin (`vite.config.ts`) — builds the
  TIFF/EXIF binary blob embedded in capture PNGs via the W3C PNG 3rd
  Edition `eXIf` chunk. piexifjs was originally chosen for JPEG EXIF
  insertion; we now use only its `dump()` to produce the raw EXIF bytes
  and inject them into PNGs ourselves.

## astro

- Version: 6.3.1
- License: MIT
- Source: https://github.com/withastro/astro
- Used by: docs-site (`docs-site/`), the Starlight-based documentation site deployed to GitHub Pages from `.github/workflows/deploy-docs.yml`.

## @astrojs/starlight

- Version: 0.39.2
- License: MIT
- Source: https://github.com/withastro/starlight
- Used by: docs-site (`docs-site/astro.config.mjs`) — provides the documentation theme, sidebar, search, and content schema.

## @astrojs/check

- Version: 0.9.9
- License: MIT
- Source: https://github.com/withastro/language-tools
- Used by: docs-site `npm run build` (`astro check && astro build`) for type-checking content frontmatter and TypeScript inside the docs project.

## sharp

- Version: 0.34.5
- License: Apache-2.0
- Source: https://github.com/lovell/sharp
- Used by: docs-site image optimization (Astro's `<Image>` component invoked from MDX pages embedding screenshots from `contrib/debug/`).
