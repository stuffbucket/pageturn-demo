#!/usr/bin/env node
// scripts/real-paper-story/build.mjs
//
// Builds an annotated reconstruction video for the 29-frame HEIC dataset
// analysed in docs/real-paper-observations-2026-05-15.md. End-to-end:
//
//   1. Reads contrib/captures-derived/IMG_41{13..41}.jpg.
//   2. Renders SVG overlays (anchor dot, radial cone-fan, binding-tangent
//      annotation) and rasterises them via rsvg-convert.
//   3. Builds short ffmpeg clips: a dataset montage, an anchor pan, a
//      cone-reveal beat, a binding-tangent beat, a side-by-side photo vs
//      synthetic, three next-step cards, plus title + end cards.
//   4. Concatenates into contrib/debug/real-paper-reconstruction/story.mp4
//      and a ≤5 MB story.gif preview.
//
// The synthetic frame for the side-by-side is sourced from the pre-existing
// contrib/debug/multi-angle/front__t1600.png artifact (PR #81). To re-render
// the synthetic frame with a custom drag path, run
// `npm run multi-angle:capture --presets front` and replace that file.

import { spawn, spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const REPO = resolve(__dirname, '..', '..');
const SRC_RAW = join(REPO, 'contrib', 'captures-derived');
// We bake EXIF orientation into rotated copies under TMP_DIR so SVG overlay
// coordinates match the displayed pixel grid. All source frames have EXIF
// orientation=6 (rotate 90° CW), turning 1200×900 raw into 900×1200 displayed.
const SRC_W = 900;
const SRC_H = 1200;
const OUT_DIR = join(REPO, 'contrib', 'debug', 'real-paper-reconstruction');
const TMP_DIR = join(OUT_DIR, '_tmp');
const W = 1280, H = 720, FPS = 30;

const ACCENT = '#d8e4ff';
const ACCENT_DIM = '#9bc7e8';
const BG = '#0b1426';
const SUBTLE = '#4a5878';
const HOT = '#ffb74a';     // anchor dot / annotation
const HOT2 = '#ff8a8a';    // diverge
const GOOD = '#7ee787';    // agree / landed

// All 29 frame names.
const FRAMES = [];
for (let i = 4113; i <= 4141; i++) FRAMES.push(`IMG_${i}.jpg`);

// --- annotation coordinates (in 900x1200 EXIF-corrected portrait coords) ---
// After ffmpeg applies EXIF orientation=6, every frame becomes 900 wide x
// 1200 tall. The page binding ("spine") shows as a vertical line on the
// right half of the frame; the curling leaf extends to the left.
const ANCHOR_MARKS = {
  'IMG_4115.jpg': { x: 540, y: 280 },
  'IMG_4117.jpg': { x: 540, y: 305 },
  'IMG_4118.jpg': { x: 555, y: 350 },
  'IMG_4119.jpg': { x: 560, y: 380 },
};

// Cone-reveal radial overlays. Apex on the binding/spine; rays through
// interior gridline endpoints on the curled flap.
const CONE_OVERLAYS = {
  'IMG_4117.jpg': {
    apex: { x: 540, y: 305 },
    rays: [
      { x: 100, y: 520 },
      { x: 130, y: 700 },
      { x: 190, y: 870 },
      { x: 280, y: 990 },
      { x: 400, y: 1060 },
      { x: 520, y: 1090 },
    ],
  },
  'IMG_4126.jpg': {
    apex: { x: 580, y: 320 },
    rays: [
      { x: 130, y: 410 },
      { x: 130, y: 570 },
      { x: 160, y: 740 },
      { x: 240, y: 880 },
      { x: 360, y: 970 },
    ],
  },
  'IMG_4140.jpg': {
    apex: { x: 580, y: 580 },
    rays: [
      { x: 220, y: 320 },
      { x: 230, y: 500 },
      { x: 250, y: 720 },
      { x: 320, y: 900 },
      { x: 440, y: 1010 },
    ],
  },
};

// Binding-tangent annotation: page in IMG_4129 is lifted nearly vertical;
// the hand is forced to rotate around the top binding corner. Top edge of
// the standing page sits at roughly (490, 230) in the portrait orientation.
const BINDING = {
  'IMG_4129.jpg': {
    cornerX: 490, cornerY: 230,
    arcCx: 490, arcCy: 230, arcR: 130,
  },
};

// ---------- helpers ----------
function runQuiet(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], cwd: REPO, ...opts });
}
async function runFfmpeg(args) {
  return new Promise((res, rej) => {
    const p = spawn('ffmpeg', ['-hide_banner', '-loglevel', process.env.FFLOG || 'error', ...args], { cwd: REPO });
    let err = '';
    p.stderr.on('data', (d) => { err += d.toString(); });
    p.on('exit', (c) => { c === 0 ? res() : (process.stderr.write(err), rej(new Error(`ffmpeg ${c}`))); });
  });
}
function xmlEscape(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

async function rsvg(svg, outPng, w, h) {
  const svgPath = outPng + '.svg';
  await writeFile(svgPath, svg);
  const r = spawnSync('rsvg-convert', ['-w', String(w), '-h', String(h), '-o', outPng, svgPath]);
  if (r.status !== 0) throw new Error('rsvg-convert: ' + r.stderr?.toString());
}

// Bake EXIF orientation: every source frame has orientation=6, which ffmpeg
// applies during decode to produce a 900x1200 portrait. We materialise that
// as a PNG once so the rest of the pipeline operates on a single, consistent
// orientation and overlay coords match the displayed pixel grid.
async function normalizeFrame(srcJpg, outPng) {
  await runFfmpeg(['-y', '-i', srcJpg, '-frames:v', '1', '-update', '1', outPng]);
}

// Build an annotated frame: source png + svg overlay → 1280x720 padded png.
async function buildAnnotatedFrame(srcPng, overlaySvg, outPng) {
  // The overlay svg's coordinate system matches the (already-rotated) source
  // (900x1200). Rasterize overlay at source resolution, then overlay onto
  // image and pad to 1280x720.
  const overlayPng = outPng + '.overlay.png';
  if (overlaySvg) await rsvg(overlaySvg, overlayPng, SRC_W, SRC_H);

  const filter = overlaySvg
    ? `[0:v][1:v]overlay=0:0,scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=${BG.slice(1)}`
    : `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=${BG.slice(1)}`;

  if (overlaySvg) {
    await runFfmpeg([
      '-y',
      '-i', srcPng,
      '-i', overlayPng,
      '-filter_complex', filter,
      '-frames:v', '1',
      outPng,
    ]);
  } else {
    await runFfmpeg([
      '-y',
      '-i', srcPng,
      '-vf', filter,
      '-frames:v', '1',
      outPng,
    ]);
  }
}

// Generic caption strip (PNG) for overlay on a clip.
async function captionStrip(text, opts = {}) {
  const w = opts.w ?? W;
  const h = opts.h ?? 110;
  const size = opts.size ?? 28;
  const color = opts.color ?? ACCENT;
  const bg = opts.bg ?? BG;
  const bgOp = opts.bgOpacity ?? 0.85;
  const ls = (opts.tracking ?? 2).toFixed(1);
  const baselineY = Math.round(h / 2 + size * 0.35);
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="${bg}" fill-opacity="${bgOp}"/>
  <text x="${w/2}" y="${baselineY}" text-anchor="middle" font-family="Arial" font-weight="700"
        font-size="${size}" fill="${color}" letter-spacing="${ls}">${xmlEscape(text)}</text>
</svg>`;
  const outPng = join(TMP_DIR, `cap_${Math.random().toString(36).slice(2, 8)}.png`);
  await rsvg(svg, outPng, w, h);
  return outPng;
}

// Title-style multi-line card.
async function buildCard(idx, dur, lines) {
  const out = join(TMP_DIR, `card_${String(idx).padStart(2,'0')}.mp4`);
  const accentDim = ACCENT_DIM;
  const texts = lines.map((l) => {
    const y = l.y;
    const size = l.size;
    const baseY = y + Math.round(size * 0.35);
    const fill = l.color ?? ACCENT;
    const weight = l.bold === false ? '400' : '700';
    const ls = (l.tracking ?? 2).toFixed(1);
    const family = l.mono ? 'Menlo' : 'Arial';
    return `<text x="${W/2}" y="${baseY}" text-anchor="middle" font-family="${family}" font-weight="${weight}" font-size="${size}" fill="${fill}" letter-spacing="${ls}">${xmlEscape(l.text)}</text>`;
  }).join('\n  ');
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${BG}"/>
  <rect x="0" y="24" width="${W}" height="2" fill="${accentDim}" opacity="0.25"/>
  <rect x="0" y="${H-26}" width="${W}" height="2" fill="${accentDim}" opacity="0.25"/>
  ${texts}
</svg>`;
  const png = join(TMP_DIR, `card_${String(idx).padStart(2,'0')}.png`);
  await rsvg(svg, png, W, H);
  await runFfmpeg([
    '-y', '-loop', '1', '-t', String(dur), '-r', String(FPS), '-i', png,
    '-vf', `fade=t=in:st=0:d=0.25:alpha=1,fade=t=out:st=${(dur-0.25).toFixed(2)}:d=0.25:alpha=1,format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-r', String(FPS), out,
  ]);
  return out;
}

// Static annotated photo for `dur` seconds, with caption strip overlay.
async function buildPhotoClip(idx, srcJpg, overlaySvg, caption, dur, opts = {}) {
  const annot = join(TMP_DIR, `annot_${String(idx).padStart(2,'0')}.png`);
  await buildAnnotatedFrame(srcJpg, overlaySvg, annot);
  const capPng = await captionStrip(caption, { h: 110, size: 28 });
  const out = join(TMP_DIR, `clip_${String(idx).padStart(2,'0')}.mp4`);
  const fadeIn = opts.fadeIn ?? 0.2;
  const fadeOut = opts.fadeOut ?? 0.2;
  const filter =
    `[0:v][1:v]overlay=x=0:y=H-110,` +
    `fade=t=in:st=0:d=${fadeIn}:alpha=1,` +
    `fade=t=out:st=${(dur-fadeOut).toFixed(2)}:d=${fadeOut}:alpha=1,` +
    `format=yuv420p`;
  await runFfmpeg([
    '-y',
    '-loop', '1', '-t', String(dur), '-r', String(FPS), '-i', annot,
    '-loop', '1', '-t', String(dur), '-r', String(FPS), '-i', capPng,
    '-filter_complex', filter,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-r', String(FPS),
    out,
  ]);
  return out;
}

// --- overlay SVG builders ---
function anchorOverlaySvg(mark) {
  const r = 22;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200" viewBox="0 0 900 1200">
  <circle cx="${mark.x}" cy="${mark.y}" r="${r+10}" fill="${HOT}" fill-opacity="0.18"/>
  <circle cx="${mark.x}" cy="${mark.y}" r="${r}" fill="none" stroke="${HOT}" stroke-width="4"/>
  <circle cx="${mark.x}" cy="${mark.y}" r="6" fill="${HOT}"/>
</svg>`;
}

function coneOverlaySvg({ apex, rays }) {
  const lines = rays.map((p) => {
    // Extend rays past their endpoint a bit, for visibility.
    const dx = p.x - apex.x, dy = p.y - apex.y;
    const len = Math.hypot(dx, dy);
    const ex = apex.x + dx * 1.06;
    const ey = apex.y + dy * 1.06;
    return `<line x1="${apex.x}" y1="${apex.y}" x2="${ex.toFixed(1)}" y2="${ey.toFixed(1)}" stroke="${HOT}" stroke-width="3" stroke-opacity="0.85" stroke-linecap="round"/>`;
  }).join('\n  ');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200" viewBox="0 0 900 1200">
  ${lines}
  <circle cx="${apex.x}" cy="${apex.y}" r="14" fill="${HOT}" stroke="#000" stroke-width="2"/>
</svg>`;
}

function bindingOverlaySvg(b) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200" viewBox="0 0 900 1200">
  <circle cx="${b.cornerX}" cy="${b.cornerY}" r="36" fill="none" stroke="${HOT}" stroke-width="5"/>
  <circle cx="${b.cornerX}" cy="${b.cornerY}" r="8" fill="${HOT}"/>
  <path d="M ${b.arcCx + b.arcR} ${b.arcCy}
           A ${b.arcR} ${b.arcR} 0 0 1 ${b.arcCx} ${b.arcCy + b.arcR}"
        fill="none" stroke="${HOT}" stroke-width="4" stroke-dasharray="10 8"/>
  <polygon points="${b.arcCx-8},${b.arcCy + b.arcR - 18} ${b.arcCx+8},${b.arcCy + b.arcR - 18} ${b.arcCx},${b.arcCy + b.arcR + 4}" fill="${HOT}"/>
</svg>`;
}

// Side-by-side: left = annotated photo, right = synthetic png.
async function buildSideBySide(idx, leftJpg, rightPng, capL, capR, dur) {
  const halfW = W / 2;
  const out = join(TMP_DIR, `sxs_${String(idx).padStart(2,'0')}.mp4`);
  const capLPng = await captionStrip(capL, { w: halfW, h: 62, size: 22, color: HOT2, tracking: 2 });
  const capRPng = await captionStrip(capR, { w: halfW, h: 62, size: 22, color: GOOD, tracking: 2 });
  const filter =
    `[0:v]scale=${halfW}:${H}:force_original_aspect_ratio=decrease,pad=${halfW}:${H}:(ow-iw)/2:(oh-ih)/2:color=${BG.slice(1)}[L0];` +
    `[1:v]scale=${halfW}:${H}:force_original_aspect_ratio=decrease,pad=${halfW}:${H}:(ow-iw)/2:(oh-ih)/2:color=${BG.slice(1)}[R0];` +
    `[L0][2:v]overlay=x=0:y=H-62[L];` +
    `[R0][3:v]overlay=x=0:y=H-62[R];` +
    `[L][R]hstack=inputs=2,` +
    `drawbox=x=(iw/2)-1:y=0:w=2:h=ih:color=${ACCENT_DIM.slice(1)}@0.4:t=fill,` +
    `fade=t=in:st=0:d=0.3:alpha=1,fade=t=out:st=${(dur-0.3).toFixed(2)}:d=0.3:alpha=1,format=yuv420p`;
  await runFfmpeg([
    '-y',
    '-loop', '1', '-t', String(dur), '-r', String(FPS), '-i', leftJpg,
    '-loop', '1', '-t', String(dur), '-r', String(FPS), '-i', rightPng,
    '-loop', '1', '-t', String(dur), '-r', String(FPS), '-i', capLPng,
    '-loop', '1', '-t', String(dur), '-r', String(FPS), '-i', capRPng,
    '-filter_complex', filter,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-r', String(FPS),
    out,
  ]);
  return out;
}

// Dataset montage: concat N normalized PNG frames at ~10 fps for ~3s.
async function buildMontage(idx, dur, normalizedFrames) {
  // duration per frame: dur / FRAMES.length seconds.
  const perFrame = dur / normalizedFrames.length;
  const partList = [];
  for (let i = 0; i < normalizedFrames.length; i++) {
    const src = normalizedFrames[i];
    const out = join(TMP_DIR, `mont_${String(i).padStart(2,'0')}.mp4`);
    await runFfmpeg([
      '-y',
      '-loop', '1', '-t', perFrame.toFixed(4), '-r', String(FPS), '-i', src,
      '-vf', `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=${BG.slice(1)},format=yuv420p`,
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '22', '-r', String(FPS),
      out,
    ]);
    partList.push(out);
  }
  const listPath = join(TMP_DIR, 'mont_list.txt');
  await writeFile(listPath, partList.map((p) => `file '${p}'`).join('\n'));
  const concatOut = join(TMP_DIR, `montage_concat.mp4`);
  await runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', concatOut]);
  // Add caption overlay + fade.
  const cap = await captionStrip('Hand-turned page  ·  gridlines + circle/X fiducials  ·  29 frames @ ~10 fps', { h: 90, size: 24 });
  const out = join(TMP_DIR, `clip_${String(idx).padStart(2,'0')}.mp4`);
  const filter =
    `[0:v][1:v]overlay=x=0:y=H-90,` +
    `fade=t=in:st=0:d=0.25:alpha=1,fade=t=out:st=${(dur-0.25).toFixed(2)}:d=0.25:alpha=1,format=yuv420p`;
  await runFfmpeg([
    '-y',
    '-i', concatOut,
    '-loop', '1', '-t', String(dur), '-r', String(FPS), '-i', cap,
    '-filter_complex', filter,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-r', String(FPS),
    out,
  ]);
  return out;
}

// ---------- main ----------
async function main() {
  await mkdir(TMP_DIR, { recursive: true });
  await mkdir(OUT_DIR, { recursive: true });

  // Resolve current git SHA for the title card.
  const sha = runQuiet('git', ['rev-parse', '--short=12', 'HEAD']).stdout.toString().trim() || 'HEAD';

  // Normalize every frame once (bake EXIF orientation) so overlay coords
  // match the displayed pixel grid.
  console.log('▶ 0: normalising frames');
  const NORM = {};
  for (const f of FRAMES) {
    const out = join(TMP_DIR, `norm_${f.replace('.jpg', '.png')}`);
    await normalizeFrame(join(SRC_RAW, f), out);
    NORM[f] = out;
  }

  const clips = [];
  let i = 0;

  console.log('▶ 1: title');
  // 1. Title (2s)
  clips.push(await buildCard(i++, 2.0, [
    { text: 'How real paper folds',                  size: 70, y: 240, tracking: 6 },
    { text: 'a 29-frame reconstruction',             size: 36, y: 320, tracking: 3, color: ACCENT_DIM, bold: false },
    { text: 'Closing the loop on PRD #11',           size: 28, y: 420, tracking: 2, color: SUBTLE,    bold: false },
    { text: 'commit ' + sha,                         size: 20, y: 480, tracking: 1, color: SUBTLE,    bold: false, mono: true },
  ]));

  console.log('▶ 2: dataset montage (29 frames)');
  // 2. Dataset montage (3s)
  clips.push(await buildMontage(i++, 3.0, FRAMES.map((f) => NORM[f])));

  console.log('▶ 3: anchor-point frames');
  // 3. Anchor point (8s) — 4 frames × 2s, with dot annotation
  const anchorFrames = ['IMG_4115.jpg', 'IMG_4117.jpg', 'IMG_4118.jpg', 'IMG_4119.jpg'];
  for (let k = 0; k < anchorFrames.length; k++) {
    const name = anchorFrames[k];
    const mark = ANCHOR_MARKS[name] ?? { x: 460, y: 250 };
    const svg = anchorOverlaySvg(mark);
    const caption = k === 0
      ? 'Anchor: pinned once at gesture start, ~mid-spine'
      : `Same anchor as the gesture progresses  ·  ${name.replace('.jpg','')}`;
    clips.push(await buildPhotoClip(i++, NORM[name], svg, caption, 2.0));
  }

  // 4. Cone reveal (12s) — 3 frames; pause 2s extra on IMG_4117 (strongest)
  const coneFrames = [
    { name: 'IMG_4117.jpg', dur: 5.0, cap: 'Gridlines fan radially from one spine apex.  The fold is a CONE, not a cylinder.' },
    { name: 'IMG_4126.jpg', dur: 3.5, cap: 'Sharper pinch  ·  same cone, curvature concentrated at the crease' },
    { name: 'IMG_4140.jpg', dur: 3.5, cap: 'Hard fold  ·  the developable-cone limit  ·  apex + two planar panels' },
  ];
  for (const cf of coneFrames) {
    const svg = coneOverlaySvg(CONE_OVERLAYS[cf.name]);
    clips.push(await buildPhotoClip(i++, NORM[cf.name], svg, cf.cap, cf.dur));
  }

  // 5. Binding-tangent moment (10s) — IMG_4129
  {
    const name = 'IMG_4129.jpg';
    const svg = bindingOverlaySvg(BINDING[name]);
    clips.push(await buildPhotoClip(i++, NORM[name], svg,
      'Tangency at corner  ·  hand must rotate around this point to continue', 10.0));
  }

  // 6. Side-by-side (10s) — IMG_4117 vs synthetic
  {
    const synth = join(REPO, 'contrib', 'debug', 'multi-angle', 'front__t1600.png');
    if (!existsSync(synth)) {
      throw new Error(`Missing synthetic frame: ${synth}. Run npm run multi-angle:capture --presets front.`);
    }
    // Build sxs without annotation, just a plain photo on the left.
    const photoPng = join(TMP_DIR, `sxs_photo.png`);
    await buildAnnotatedFrame(NORM['IMG_4117.jpg'], null, photoPng);
    clips.push(await buildSideBySide(
      i++, photoPng, synth,
      'REAL  ·  cone-fan, mid-spine anchor',
      'SYNTHETIC  ·  cylinder + spine pin (PR #82)',
      10.0,
    ));
  }

  // 7. Next steps (8s) — three 2s+ cards, plus a short transition pad totalling ~8s
  clips.push(await buildCard(i++, 2.5, [
    { text: 'Next steps',                                size: 36, y: 110, tracking: 4, color: ACCENT_DIM, bold: false },
    { text: 'Per-gesture pin',                           size: 48, y: 280, tracking: 3 },
    { text: 'landed  ·  PR #82, PR #87',                 size: 26, y: 360, tracking: 2, color: GOOD, bold: false },
  ]));
  clips.push(await buildCard(i++, 2.5, [
    { text: 'Next steps',                                size: 36, y: 110, tracking: 4, color: ACCENT_DIM, bold: false },
    { text: 'Cone-curl geometry',                        size: 48, y: 280, tracking: 3 },
    { text: 'deferred  ·  derivation needed',            size: 26, y: 360, tracking: 2, color: HOT, bold: false },
  ]));
  clips.push(await buildCard(i++, 2.5, [
    { text: 'Next steps',                                size: 36, y: 110, tracking: 4, color: ACCENT_DIM, bold: false },
    { text: 'Binding-tangent regime',                    size: 48, y: 280, tracking: 3 },
    { text: 'documented  ·  PR #88  ·  wiring deferred', size: 26, y: 360, tracking: 2, color: HOT, bold: false },
  ]));

  // 8. End card (2s)
  clips.push(await buildCard(i++, 2.5, [
    { text: '29 frames',                                                  size: 48, y: 200, tracking: 4 },
    { text: '3 insights',                                                 size: 48, y: 280, tracking: 4 },
    { text: '2 closed bugs',                                              size: 48, y: 360, tracking: 4 },
    { text: '1 deferred model',                                           size: 48, y: 440, tracking: 4, color: HOT },
    { text: 'github.com/stuffbucket/pageturn-demo',                       size: 20, y: 560, tracking: 1, color: SUBTLE, mono: true, bold: false },
  ]));

  // Concat
  const listPath = join(TMP_DIR, 'concat.txt');
  await writeFile(listPath, clips.map((p) => `file '${p}'`).join('\n'));
  const storyMp4 = join(OUT_DIR, 'story.mp4');
  await runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', storyMp4]);

  // GIF preview. We first transcode to a uniform-parameter intermediate
  // (some ffmpeg builds hit an "Error while filtering: Internal bug" when
  // paletteuse encounters a parameter change between concat segments).
  const palette = join(TMP_DIR, 'palette.png');
  const interMp4 = join(TMP_DIR, 'inter.mp4');
  const gifOut = join(OUT_DIR, 'story.gif');
  await runFfmpeg([
    '-y', '-i', storyMp4,
    '-vf', `fps=10,scale=560:-2:flags=lanczos,format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '22', '-an',
    interMp4,
  ]);
  await runFfmpeg(['-y', '-i', interMp4, '-vf', 'palettegen', palette]);
  await runFfmpeg(['-y', '-i', interMp4, '-i', palette, '-lavfi', '[0:v][1:v]paletteuse=dither=bayer:bayer_scale=5', gifOut]);

  // Also save an annotated key still for the PR body.
  const keyStillTmp = join(TMP_DIR, 'key-frame-cone.png');
  await buildAnnotatedFrame(NORM['IMG_4117.jpg'], coneOverlaySvg(CONE_OVERLAYS['IMG_4117.jpg']), keyStillTmp);
  await writeFile(join(OUT_DIR, 'key-frame-cone.png'), await readFile(keyStillTmp));

  await rm(TMP_DIR, { recursive: true, force: true });

  const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,size', '-of', 'default=nw=1', storyMp4]).stdout.toString();
  const gifStat = await stat(gifOut);
  const mp4Stat = await stat(storyMp4);
  console.log('=== built ===');
  console.log('story.mp4', storyMp4);
  console.log(probe.trim());
  console.log('mp4 size:', (mp4Stat.size / 1024 / 1024).toFixed(2), 'MB');
  console.log('gif size:', (gifStat.size / 1024 / 1024).toFixed(2), 'MB');
}

main().catch((err) => { console.error(err); process.exit(1); });
