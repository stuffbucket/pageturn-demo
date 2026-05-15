#!/usr/bin/env node
// Convert HEIC captures to downscaled JPEG using macOS `sips`.
// Usage: node scripts/heic-to-jpg.mjs <src-dir> <dst-dir> [maxDim]
//
// Originals stay put; only derived JPEGs end up under <dst-dir>.
// Default max dimension is 1600 px to keep the repo small while preserving
// gridline / fiducial detail.

import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, basename, extname } from 'node:path';

const [, , srcArg, dstArg, maxArg] = process.argv;
if (!srcArg || !dstArg) {
  console.error('usage: heic-to-jpg.mjs <src> <dst> [maxDim]');
  process.exit(2);
}
const maxDim = Number(maxArg ?? 1600);
mkdirSync(dstArg, { recursive: true });

// sort by mtime so the output ordering matches the capture sequence
const entries = readdirSync(srcArg)
  .filter((f) => /\.heic$/i.test(f))
  .map((f) => {
    const p = join(srcArg, f);
    return { f, p, mtime: statSync(p).mtimeMs };
  })
  .sort((a, b) => a.mtime - b.mtime);

for (const { f, p } of entries) {
  const out = join(dstArg, basename(f, extname(f)) + '.jpg');
  execFileSync('sips', [
    '-s', 'format', 'jpeg',
    '-s', 'formatOptions', '80',
    '-Z', String(maxDim),
    p, '--out', out,
  ], { stdio: 'pipe' });
  console.log(out);
}
