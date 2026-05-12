# Third-Party Licenses

This project bundles or depends on the following third-party software.

## piexifjs

- Version: 1.0.6
- License: MIT
- Source: https://github.com/hMatoba/piexifjs
- Used by: screenshot-server Vite plugin (`vite.config.ts`) — builds the
  TIFF/EXIF binary blob embedded in capture PNGs via the W3C PNG 3rd
  Edition `eXIf` chunk. piexifjs was originally chosen for JPEG EXIF
  insertion; we now use only its `dump()` to produce the raw EXIF bytes
  and inject them into PNGs ourselves.
