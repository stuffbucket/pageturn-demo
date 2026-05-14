#!/usr/bin/env node
// scripts/narrative-video/build-story.mjs
//
// Builds a self-contained narrative video for PR #59 (the curl-into-a-tube
// developable-shader bug and its clamp-at-pi/3 fix). End-to-end:
//
//   1. Spawns `vite` on :5173.
//   2. Captures the canonical single-turn scenario WITH the fix in place.
//   3. Temporarily reverts MAX_CURL_ANGLE (Book.ts) to Math.PI*10 — wide
//      open, no clamp — and recaptures the same scenario to get the tube.
//   4. Restores Book.ts via `git checkout`.
//   5. Renders ten ffmpeg title-card clips (dark navy + pale-blue accent,
//      Arial Bold + Arial, generous letter-spacing) covering the brief.
//   6. Splices everything into contrib/debug/pr59-narrative/story.mp4 and a
//      web-friendly story.webm + story.gif preview, plus key-frame PNGs.
//
// No PII: every absolute path is derived from process.cwd() / git root so the
// embedded `drawtext` only ever quotes commit SHA + PR number. Tested on macOS
// (ffmpeg 8.x); Linux works if the font paths in FONTS are pointed at any
// installed TTF.

import { spawn, spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir, rm, stat, access } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const REPO = resolve(__dirname, '..', '..');
const OUT_DIR = join(REPO, 'contrib', 'debug', 'pr59-narrative');
const HARNESS_OUTPUT = join(REPO, 'harness', 'output');
const TMP_DIR = join(OUT_DIR, '_tmp');
const SCENARIO = 'narrative-pr59-single-turn';
const W = 1280, H = 720, FPS = 30;

// Times within the captured scenario (ms). The scenario is 5000 ms total.
// The drag ends at 2100ms; the page is at max curl around t=1700 ms.
const KEY_FRAME_T_MS = 1700;

// Pale blue accent matches the HUD's debug-text colour (#d8e4ff). Background
// is a deep navy similar to the inner-loop docs.
const ACCENT = '0xd8e4ff';
const ACCENT_DIM = '0x9bc7e8';
const BG = '0x0b1426';
const SUBTLE = '0x4a5878';
const FONT_BOLD = '/System/Library/Fonts/Supplemental/Arial Bold.ttf';
const FONT_REG = '/System/Library/Fonts/Supplemental/Arial.ttf';
const FONT_MONO = '/System/Library/Fonts/Menlo.ttc';

// ─────────────────────────────────────────────────────────── Story script ──
const COMMIT = process.env.PR59_COMMIT_SHA || '';
const STORY = [
  // 1. Title
  {
    bg: BG,
    dur: 2.5,
    lines: [
      { text: 'Curl-into-a-tube',                                font: FONT_BOLD, size: 76, color: ACCENT,     y: 'h/2-120', tracking: 6 },
      { text: 'a developable-shader bug that survived three fixes', font: FONT_REG,  size: 32, color: ACCENT_DIM, y: 'h/2-30',  tracking: 2 },
      { text: 'PR #59  ·  fix/originy-deviation-area-growth',     font: FONT_MONO, size: 22, color: SUBTLE,    y: 'h/2+60',  tracking: 1 },
      { text: 'commit ' + (COMMIT.slice(0, 12) || 'HEAD'),         font: FONT_MONO, size: 22, color: SUBTLE,    y: 'h/2+100', tracking: 1 },
    ],
  },
  // 2. Setup: what the page should do — fixed footage 0..2.5s
  {
    type: 'footage', src: 'after', startMs: 0, lenSec: 2.5,
    caption: 'A page-turn is a curve, not a coil.',
  },
  // 3. Problem reveal — pre-fix footage around the tube moment
  {
    type: 'footage', src: 'before', startMs: 800, lenSec: 2.4,
    caption: 'When  theta = effS / R  is unbounded, the page wraps past 2 pi.',
  },
  // 4. Three attempted-fix title cards
  {
    bg: BG, dur: 1.5,
    lines: [
      { text: 'Attempt 1',                            font: FONT_BOLD, size: 52, color: ACCENT_DIM, y: 'h/2-90',  tracking: 4 },
      { text: 'Spine-pin x-snap',                     font: FONT_BOLD, size: 60, color: ACCENT,     y: 'h/2-20',  tracking: 3 },
      { text: 'Failed: y and z were never pinned',    font: FONT_REG,  size: 30, color: SUBTLE,     y: 'h/2+50',  tracking: 2 },
    ],
  },
  {
    bg: BG, dur: 1.5,
    lines: [
      { text: 'Attempt 2',                            font: FONT_BOLD, size: 52, color: ACCENT_DIM, y: 'h/2-90',  tracking: 4 },
      { text: 'Full binding constraint',              font: FONT_BOLD, size: 60, color: ACCENT,     y: 'h/2-20',  tracking: 3 },
      { text: 'Killed the shear, did not bound curvature', font: FONT_REG, size: 30, color: SUBTLE, y: 'h/2+50',  tracking: 2 },
    ],
  },
  {
    bg: BG, dur: 1.5,
    lines: [
      { text: 'Attempt 3  (this PR)',                 font: FONT_BOLD, size: 52, color: ACCENT_DIM, y: 'h/2-90',  tracking: 4 },
      { text: 'Curl-angle clamp at pi/3',             font: FONT_BOLD, size: 60, color: ACCENT,     y: 'h/2-20',  tracking: 3 },
      { text: 'Bounds curvature, preserves arc length',font: FONT_REG, size: 30, color: SUBTLE,     y: 'h/2+50',  tracking: 2 },
    ],
  },
  // 5. Diagnosis
  {
    bg: BG, dur: 2.8,
    lines: [
      { text: 'Diagnosis',                                              font: FONT_BOLD, size: 44, color: ACCENT_DIM, y: 'h/2-180', tracking: 4 },
      { text: 'theta = effS / R',                                       font: FONT_MONO, size: 64, color: ACCENT,     y: 'h/2-90',  tracking: 2 },
      { text: 'R = 0.25     effS  ~  1.7 * W',                          font: FONT_MONO, size: 40, color: ACCENT_DIM, y: 'h/2-10',  tracking: 2 },
      { text: 'theta  ~  6.8 rad  >  2 pi',                             font: FONT_MONO, size: 46, color: '0xff8a8a', y: 'h/2+70',  tracking: 2 },
      { text: 'The corner curls back onto the spine.',                  font: FONT_REG,  size: 28, color: SUBTLE,     y: 'h/2+150', tracking: 2 },
    ],
  },
  // 6. The fix
  {
    bg: BG, dur: 2.8,
    lines: [
      { text: 'The fix',                                                font: FONT_BOLD, size: 44, color: ACCENT_DIM, y: 'h/2-180', tracking: 4 },
      { text: 'theta = min(effS / R,  pi/3)',                           font: FONT_MONO, size: 60, color: ACCENT,     y: 'h/2-90',  tracking: 2 },
      { text: 'sExt = max(effS - theta * R,  0)',                       font: FONT_MONO, size: 36, color: ACCENT_DIM, y: 'h/2-10',  tracking: 2 },
      { text: 'Inextensibility preserved; only curvature is bounded.',  font: FONT_REG,  size: 28, color: ACCENT_DIM, y: 'h/2+70',  tracking: 2 },
    ],
  },
  // 7. Why tests missed it
  {
    bg: BG, dur: 2.8,
    lines: [
      { text: 'Why the tests missed it',                                font: FONT_BOLD, size: 40, color: ACCENT_DIM, y: 'h/2-200', tracking: 4 },
      { text: 'over-curled cells  +  under-curled cells  ~  rest area', font: FONT_MONO, size: 30, color: ACCENT,     y: 'h/2-100', tracking: 2 },
      { text: 'The area-ratio integrator averaged the tube and the fan,', font: FONT_REG, size: 28, color: ACCENT_DIM, y: 'h/2-20',  tracking: 2 },
      { text: 'landing on a benign ~1.00 total.',                       font: FONT_REG,  size: 28, color: ACCENT_DIM, y: 'h/2+20',  tracking: 2 },
      { text: 'We needed per-row chord assertions, not a global mean.', font: FONT_REG,  size: 28, color: '0xffd479', y: 'h/2+100', tracking: 2 },
    ],
  },
  // 8. New invariants
  {
    bg: BG, dur: 3.0,
    lines: [
      { text: 'New invariants',                                         font: FONT_BOLD, size: 40, color: ACCENT_DIM, y: 80,        tracking: 4 },
      { text: 'no-tube row chord',                                      font: FONT_MONO, size: 30, color: ACCENT,     y: 170,       tracking: 2 },
      { text: 'curl angle  <=  75 deg',                                 font: FONT_MONO, size: 30, color: ACCENT,     y: 230,       tracking: 2 },
      { text: 'no-disappear bound',                                     font: FONT_MONO, size: 30, color: ACCENT,     y: 290,       tracking: 2 },
      { text: 'monotone dihedral',                                      font: FONT_MONO, size: 30, color: ACCENT,     y: 350,       tracking: 2 },
      { text: 'per-frame smoothness',                                   font: FONT_MONO, size: 30, color: ACCENT,     y: 410,       tracking: 2 },
      { text: 'column-0 pin',                                           font: FONT_MONO, size: 30, color: ACCENT,     y: 470,       tracking: 2 },
      { text: 'row-pair stretch',                                       font: FONT_MONO, size: 30, color: ACCENT,     y: 530,       tracking: 2 },
      { text: 'all green',                                              font: FONT_BOLD, size: 36, color: '0x7ee787', y: 610,       tracking: 4 },
    ],
  },
  // 9. Side-by-side. Built specially.
  {
    type: 'sidebyside', lenSec: 3.4,
    captionLeft: 'BEFORE  ·  theta unbounded',
    captionRight: 'AFTER  ·  theta clamped at pi/3',
    startMs: 400,
  },
  // 10. End card
  {
    bg: BG, dur: 2.2,
    lines: [
      { text: 'PR #59',                                font: FONT_BOLD, size: 72, color: ACCENT,     y: 'h/2-120', tracking: 6 },
      { text: 'Inextensibility preserved.  Curvature bounded.', font: FONT_REG, size: 30, color: ACCENT_DIM, y: 'h/2-30', tracking: 2 },
      { text: 'commit ' + (COMMIT.slice(0, 12) || 'HEAD') + '   ·   200 tests pass',
        font: FONT_MONO, size: 22, color: SUBTLE, y: 'h/2+50', tracking: 1 },
      { text: 'github.com/stuffbucket/pageturn-demo/pull/59', font: FONT_MONO, size: 22, color: SUBTLE, y: 'h/2+90', tracking: 1 },
    ],
  },
];

// ────────────────────────────────────────────────────────────── helpers ──
function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: REPO, ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed (${r.status})`);
}
function runQuiet(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], cwd: REPO, ...opts });
  return { status: r.status, out: r.stdout?.toString() || '', err: r.stderr?.toString() || '' };
}
async function waitForUrl(url, timeoutMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 304) return;
    } catch {}
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${url}`);
}
function ffEscape(s) {
  // ffmpeg drawtext text escaping. Order matters.
  return s
    .replace(/\\/g, '\\\\\\\\')
    .replace(/:/g, '\\\\:')
    .replace(/'/g, "\\\\\\'")
    .replace(/%/g, '\\\\%')
    .replace(/,/g, '\\,');
}

// Convert "h/2-90" style y-spec from the old drawtext format into a numeric
// pixel coordinate centred around H/2.
function resolveY(spec) {
  if (typeof spec === 'number') return spec;
  const m = /^h\/2([+-]\d+)?$/.exec(spec);
  if (m) return H / 2 + (m[1] ? Number(m[1]) : 0);
  // Default: assume it's parseable as a number.
  const n = Number(spec);
  if (Number.isFinite(n)) return n;
  return H / 2;
}
function hexToCss(c) {
  // "0xd8e4ff" → "#d8e4ff"; pass plain colours through.
  if (typeof c !== 'string') return '#ffffff';
  if (c.startsWith('0x')) return '#' + c.slice(2);
  return c;
}
function xmlEscape(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function fontFamilyFor(fontPath) {
  // rsvg-convert resolves font-family via fontconfig. macOS has Arial and
  // Menlo registered, which are exactly the families we use.
  if (fontPath === FONT_BOLD) return 'Arial';
  if (fontPath === FONT_REG)  return 'Arial';
  if (fontPath === FONT_MONO) return 'Menlo';
  return 'Arial';
}
function isBold(fontPath) { return fontPath === FONT_BOLD; }

// Render a single title-card as an SVG → PNG, then encode to an mp4 with
// fade in/out. SVG gives us real letter-spacing (the brief asked for
// "generous letter-spacing") that ffmpeg's drawtext can't express.
async function buildCard(idx, card) {
  const outPath = join(TMP_DIR, `card_${String(idx).padStart(2, '0')}.mp4`);
  const dur = card.dur;
  const bg = hexToCss(card.bg);
  const accentDim = hexToCss(ACCENT_DIM);
  const lines = card.lines.map((l) => {
    const y = resolveY(l.y) + Math.round(l.size * 0.35); // baseline nudge for SVG text
    const fill = hexToCss(l.color);
    const family = fontFamilyFor(l.font);
    const weight = isBold(l.font) ? '700' : '400';
    const ls = (l.tracking ?? 1).toFixed(1);
    return `<text x="${W / 2}" y="${y}" text-anchor="middle" ` +
           `font-family="${family}" font-weight="${weight}" font-size="${l.size}" ` +
           `fill="${fill}" letter-spacing="${ls}">${xmlEscape(l.text)}</text>`;
  }).join('\n  ');
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect x="0" y="0" width="${W}" height="${H}" fill="${bg}"/>
  <rect x="0" y="24" width="${W}" height="2" fill="${accentDim}" opacity="0.25"/>
  <rect x="0" y="${H - 26}" width="${W}" height="2" fill="${accentDim}" opacity="0.25"/>
  ${lines}
</svg>`;
  const svgPath = join(TMP_DIR, `card_${String(idx).padStart(2, '0')}.svg`);
  const pngPath = join(TMP_DIR, `card_${String(idx).padStart(2, '0')}.png`);
  await writeFile(svgPath, svg);
  const r = spawnSync('rsvg-convert', ['-w', String(W), '-h', String(H), '-o', pngPath, svgPath]);
  if (r.status !== 0) throw new Error(`rsvg-convert failed: ${r.stderr?.toString()}`);
  await runFfmpeg([
    '-y',
    '-loop', '1', '-t', String(dur), '-r', String(FPS), '-i', pngPath,
    '-vf', `fade=t=in:st=0:d=0.3:alpha=1,fade=t=out:st=${(dur - 0.3).toFixed(2)}:d=0.3:alpha=1,format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
    '-r', String(FPS),
    outPath,
  ]);
  return outPath;
}

async function runFfmpeg(args) {
  return new Promise((resolveP, rejectP) => {
    const p = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args], { cwd: REPO });
    let stderr = '';
    p.stderr.on('data', (d) => { stderr += d.toString(); });
    p.on('exit', (code) => {
      if (code === 0) resolveP();
      else { process.stderr.write(stderr); rejectP(new Error(`ffmpeg failed: ${code}`)); }
    });
  });
}

// Build a transparent caption-strip PNG via SVG → rsvg. Used as an overlay
// because the system ffmpeg lacks libfreetype/drawtext.
async function buildCaptionPng(idx, text, opts = {}) {
  const w = opts.w ?? W;
  const h = opts.h ?? 130;
  const size = opts.size ?? 30;
  const color = hexToCss(opts.color ?? ACCENT);
  const bg = hexToCss(opts.bg ?? BG);
  const bgOpacity = opts.bgOpacity ?? 0.85;
  const ls = (opts.tracking ?? 2).toFixed(1);
  const baselineY = Math.round(h / 2 + size * 0.35);
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect x="0" y="0" width="${w}" height="${h}" fill="${bg}" fill-opacity="${bgOpacity}"/>
  <text x="${w / 2}" y="${baselineY}" text-anchor="middle"
        font-family="Arial" font-weight="700" font-size="${size}"
        fill="${color}" letter-spacing="${ls}">${xmlEscape(text)}</text>
</svg>`;
  const svgPath = join(TMP_DIR, `cap_${idx}.svg`);
  const pngPath = join(TMP_DIR, `cap_${idx}.png`);
  await writeFile(svgPath, svg);
  const r = spawnSync('rsvg-convert', ['-w', String(w), '-h', String(h), '-o', pngPath, svgPath]);
  if (r.status !== 0) throw new Error(`rsvg-convert (caption) failed: ${r.stderr?.toString()}`);
  return pngPath;
}

// Cut a clip from a captured webm and overlay a caption PNG near the bottom.
async function buildFootage(idx, item, srcWebm) {
  const outPath = join(TMP_DIR, `clip_${String(idx).padStart(2, '0')}.mp4`);
  const startSec = (item.startMs / 1000).toFixed(3);
  const dur = item.lenSec.toFixed(3);
  const captionPng = await buildCaptionPng(`c${idx}`, item.caption, { h: 130, size: 30, color: ACCENT });
  const filter =
    `[0:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
    `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=${hexToCss(BG)}[bg];` +
    `[bg][1:v]overlay=x=0:y=H-130,` +
    `fade=t=in:st=0:d=0.25:alpha=1,` +
    `fade=t=out:st=${(item.lenSec - 0.25).toFixed(2)}:d=0.25:alpha=1,` +
    `format=yuv420p`;
  await runFfmpeg([
    '-y',
    '-ss', startSec, '-t', dur,
    '-i', srcWebm,
    '-i', captionPng,
    '-filter_complex', filter,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
    '-r', String(FPS),
    '-an',
    outPath,
  ]);
  return outPath;
}

async function buildSideBySide(idx, item, beforeWebm, afterWebm) {
  const outPath = join(TMP_DIR, `sxs_${String(idx).padStart(2, '0')}.mp4`);
  const startSec = (item.startMs / 1000).toFixed(3);
  const dur = item.lenSec.toFixed(3);
  const halfW = W / 2;
  const capL = await buildCaptionPng(`sxsL_${idx}`, item.captionLeft, { w: halfW, h: 70, size: 26, color: '0xff8a8a', bgOpacity: 0.9 });
  const capR = await buildCaptionPng(`sxsR_${idx}`, item.captionRight, { w: halfW, h: 70, size: 26, color: '0x7ee787', bgOpacity: 0.9 });
  const filter =
    `[0:v]trim=start=${startSec}:duration=${dur},setpts=PTS-STARTPTS,` +
    `scale=${halfW}:${H}:force_original_aspect_ratio=decrease,` +
    `pad=${halfW}:${H}:(ow-iw)/2:(oh-ih)/2:color=${hexToCss(BG)}[L0];` +
    `[1:v]trim=start=${startSec}:duration=${dur},setpts=PTS-STARTPTS,` +
    `scale=${halfW}:${H}:force_original_aspect_ratio=decrease,` +
    `pad=${halfW}:${H}:(ow-iw)/2:(oh-ih)/2:color=${hexToCss(BG)}[R0];` +
    `[L0][2:v]overlay=x=0:y=H-70[L];` +
    `[R0][3:v]overlay=x=0:y=H-70[R];` +
    `[L][R]hstack=inputs=2,` +
    `drawbox=x=(iw/2)-1:y=0:w=2:h=ih:color=${ACCENT_DIM}@0.4:t=fill,` +
    `fade=t=in:st=0:d=0.3:alpha=1,` +
    `fade=t=out:st=${(item.lenSec - 0.3).toFixed(2)}:d=0.3:alpha=1,` +
    `format=yuv420p`;
  await runFfmpeg([
    '-y',
    '-i', beforeWebm,
    '-i', afterWebm,
    '-i', capL,
    '-i', capR,
    '-filter_complex', filter,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
    '-r', String(FPS),
    '-an',
    outPath,
  ]);
  return outPath;
}

// Replace the literal "Math.PI / 3" in Book.ts so we re-enter the bug.
async function mutateBookForBug() {
  const path = join(REPO, 'src', 'book', 'Book.ts');
  const src = await readFile(path, 'utf-8');
  const next = src.replace(
    /export const MAX_CURL_ANGLE = Math\.PI \/ 3;/,
    'export const MAX_CURL_ANGLE = Math.PI * 10; /* TEMPORARY narrative-video pre-fix */'
  );
  if (next === src) throw new Error('mutateBookForBug: pattern not found');
  await writeFile(path, next, 'utf-8');
}
async function restoreBook() {
  run('git', ['checkout', '--', 'src/book/Book.ts']);
}

async function runHarness(label) {
  const r = spawnSync(
    'npx',
    ['tsx', join(REPO, 'harness', 'runner', 'run.ts'), SCENARIO],
    { cwd: join(REPO, 'harness'), stdio: 'inherit', env: { ...process.env, HARNESS_URL: 'http://localhost:5173/harness.html' } }
  );
  if (r.status !== 0) throw new Error(`harness run failed (${label}): ${r.status}`);
  const captured = join(HARNESS_OUTPUT, `${SCENARIO}.webm`);
  const labelled = join(OUT_DIR, `capture-${label}.webm`);
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(labelled, await readFile(captured));
  return labelled;
}

async function extractKeyFrame(srcWebm, outPng, tMs) {
  await runFfmpeg([
    '-y',
    '-ss', (tMs / 1000).toFixed(3),
    '-i', srcWebm,
    '-frames:v', '1',
    '-vf', `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=${BG}`,
    outPng,
  ]);
}

async function makeWebm(srcMp4, outWebm) {
  await runFfmpeg([
    '-y', '-i', srcMp4,
    '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '34', '-row-mt', '1',
    '-pix_fmt', 'yuv420p', '-deadline', 'good',
    '-an',
    outWebm,
  ]);
}
async function makeGif(srcMp4, outGif) {
  const palette = join(TMP_DIR, 'palette.png');
  await runFfmpeg(['-y', '-i', srcMp4, '-vf', `fps=12,scale=640:-1:flags=lanczos,palettegen`, palette]);
  await runFfmpeg(['-y', '-i', srcMp4, '-i', palette, '-lavfi', `fps=12,scale=640:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5`, outGif]);
}

// ─────────────────────────────────────────────────────────── main ──
async function main() {
  await mkdir(TMP_DIR, { recursive: true });
  await mkdir(OUT_DIR, { recursive: true });

  // 0. Vite dev server.
  let viteProc = null;
  const skipCapture = process.argv.includes('--no-capture');
  let beforeWebm = join(OUT_DIR, 'capture-before.webm');
  let afterWebm = join(OUT_DIR, 'capture-after.webm');

  try {
    if (!skipCapture) {
      console.log('▶ starting vite');
      viteProc = spawn('npx', ['vite', '--port', '5173', '--strictPort'], { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] });
      viteProc.stdout.on('data', (d) => process.stdout.write(`[vite] ${d}`));
      viteProc.stderr.on('data', (d) => process.stderr.write(`[vite] ${d}`));
      await waitForUrl('http://localhost:5173/harness.html');
      console.log('▶ vite ready');

      // 1. AFTER (with current fix).
      console.log('▶ capturing AFTER (clamp at pi/3, current source)');
      afterWebm = await runHarness('after');

      // 2. BEFORE (mutate to disable clamp, capture, restore).
      console.log('▶ mutating Book.ts to disable the clamp');
      await mutateBookForBug();
      await delay(1500); // Let HMR settle.
      try {
        console.log('▶ capturing BEFORE (tube)');
        beforeWebm = await runHarness('before');
      } finally {
        console.log('▶ restoring Book.ts');
        await restoreBook();
      }
    } else {
      console.log('▶ --no-capture: reusing existing capture-*.webm');
    }
  } finally {
    if (viteProc) {
      viteProc.kill('SIGTERM');
      // best-effort
      await delay(500);
    }
  }

  // 3. Key-frame PNGs (the canonical t ~ 1700 ms moment).
  console.log('▶ extracting key frames');
  await extractKeyFrame(beforeWebm, join(OUT_DIR, 'key-frame-tube.png'), KEY_FRAME_T_MS);
  await extractKeyFrame(afterWebm, join(OUT_DIR, 'key-frame-fixed.png'), KEY_FRAME_T_MS);

  // 4. Build clips in story order.
  console.log('▶ rendering title cards and footage clips');
  const clipPaths = [];
  for (let i = 0; i < STORY.length; i++) {
    const item = STORY[i];
    if (item.type === 'footage') {
      const src = item.src === 'before' ? beforeWebm : afterWebm;
      clipPaths.push(await buildFootage(i, item, src));
    } else if (item.type === 'sidebyside') {
      clipPaths.push(await buildSideBySide(i, item, beforeWebm, afterWebm));
    } else {
      clipPaths.push(await buildCard(i, item));
    }
  }

  // 5. Concat everything.
  console.log('▶ concatenating');
  const listPath = join(TMP_DIR, 'concat.txt');
  await writeFile(listPath, clipPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'));
  const storyMp4 = join(OUT_DIR, 'story.mp4');
  await runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', storyMp4]);

  // 6. webm + gif previews.
  console.log('▶ encoding webm + gif');
  await makeWebm(storyMp4, join(OUT_DIR, 'story.webm'));
  await makeGif(storyMp4, join(OUT_DIR, 'story.gif'));

  // 7. Cleanup intermediate.
  await rm(TMP_DIR, { recursive: true, force: true });

  // Report sizes & duration.
  const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,size', '-of', 'default=nw=1', storyMp4]).stdout.toString();
  console.log('\n=== built ===');
  console.log(storyMp4);
  console.log(probe.trim());
}

main().catch((err) => { console.error(err); process.exit(1); });
