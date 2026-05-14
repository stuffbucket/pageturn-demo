/**
 * settle-tail-evidence.ts
 *
 * Standalone simulator that runs the aerodynamic settle ODE under BOTH
 * parameter sets (pre-PR-60 vs post-PR-60) from the SAME release state and
 * renders a side-by-side animation showing phi/b/phiDot decay and a
 * stylized page-edge silhouette. The previous PR comparison GIFs were
 * captured with the harness scenario "aerodynamic-settle.json" — that
 * scenario releases the page with near-zero velocity, so both parameter
 * sets converge in well under one frame; the visible difference between
 * before/after webms ends up being a per-frame YAVG diff of ~1 luma which
 * isn't perceptible.
 *
 * Output:
 *   contrib/debug/settle-tuning/comparison.mp4
 *   contrib/debug/settle-tuning/comparison.gif
 *   contrib/debug/settle-tuning/comparison-data.json
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AeroSettleParams,
  AeroSettleState,
  DEFAULT_AERO_PARAMS,
  entry as aeroEntry,
  step as aeroStep,
  targetPhi,
} from '../src/book/SettlePhysics.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const REPO_ROOT  = resolve(__dirname, '..');
const OUT_DIR    = resolve(REPO_ROOT, 'contrib/debug/settle-tuning');

// Pre-PR-60 parameters — the PRD "Math sketch" starting values.
const OLD_PARAMS: AeroSettleParams = {
  G:     5.0,
  D:     6.5,
  omega: 12,
  Db:    6,
  kappa: 0.05,
  b0:    0.4,
  bMax:  0.7,
};
const NEW_PARAMS = DEFAULT_AERO_PARAMS;

// Pre-PR-60 convergence test — pure energy stop, no visual-quiescence
// shortcut and no b residual term.
function isConvergedOld(s: AeroSettleState, dir: 1 | -1, eps = 0.005): boolean {
  const target = targetPhi(dir);
  const dPhi = s.phi - target;
  const energy = 0.5 * s.phiDot * s.phiDot + OLD_PARAMS.G * (1 - Math.cos(dPhi));
  return energy < eps;
}
function isConvergedNew(s: AeroSettleState, dir: 1 | -1, eps = 0.005): boolean {
  const target = targetPhi(dir);
  const dPhi = s.phi - target;
  const energy = 0.5 * s.phiDot * s.phiDot + NEW_PARAMS.G * (1 - Math.cos(dPhi));
  if (energy < eps) return true;
  return (
    Math.abs(dPhi) < 0.03 &&
    Math.abs(s.phiDot) < 0.3 &&
    Math.abs(s.b - NEW_PARAMS.b0) < 0.02
  );
}

interface Sample {
  t: number;
  phi: number;
  phiDot: number;
  b: number;
  settled: boolean;
}

function simulate(
  params: AeroSettleParams,
  convergedFn: (s: AeroSettleState, dir: 1 | -1) => boolean,
  release: { phi: number; phiDot: number },
  dir: 1 | -1,
  duration: number,
  sampleHz: number,
): Sample[] {
  // Tight inner-step dt for stability, then downsample to the frame rate.
  const innerDt = 1 / 240;
  const outDt   = 1 / sampleHz;
  // Seed b with κ·φ̇²/ω² (the analytic puff equilibrium at constant φ̇)
  // so we start with the bump the user can already see at release.
  const bSeed   = params.b0 + params.kappa * release.phiDot * release.phiDot / (params.omega * params.omega);
  let state: AeroSettleState = {
    phi:    release.phi,
    phiDot: release.phiDot,
    b:      Math.min(bSeed, params.bMax),
    bDot:   0,
  };
  const out: Sample[] = [];
  let firstSettledAt: number | null = null;
  let t = 0;
  let nextSampleT = 0;
  const steps = Math.ceil(duration / innerDt);
  for (let i = 0; i <= steps; i++) {
    if (t >= nextSampleT - 1e-9) {
      const settled = firstSettledAt !== null;
      out.push({ t, phi: state.phi, phiDot: state.phiDot, b: state.b, settled });
      nextSampleT += outDt;
    }
    // Detect first-settle BEFORE stepping further (so the recorded settled
    // time matches when the renderer would have removed the integrator).
    if (firstSettledAt === null && convergedFn(state, dir)) {
      firstSettledAt = t;
    }
    state = aeroStep(state, dir, innerDt, params);
    t += innerDt;
  }
  // Stamp the settled flag retroactively on all samples after first-settle.
  if (firstSettledAt !== null) {
    for (const s of out) if (s.t >= firstSettledAt) s.settled = true;
  }
  return out;
}

// ─── PPM frame renderer (640x480) ─────────────────────────────────────────
const W = 1280;
const H = 720;
const HALF = W / 2;

interface Frame { buf: Buffer; }

function newFrame(): Frame {
  const buf = Buffer.alloc(W * H * 3);
  // Fill with #0e1116 (near-black) background
  for (let i = 0; i < buf.length; i += 3) {
    buf[i] = 0x0e; buf[i + 1] = 0x11; buf[i + 2] = 0x16;
  }
  return { buf };
}

function px(f: Frame, x: number, y: number, r: number, g: number, b: number) {
  x = x | 0; y = y | 0;
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  f.buf[i] = r; f.buf[i + 1] = g; f.buf[i + 2] = b;
}

function rect(f: Frame, x0: number, y0: number, x1: number, y1: number, r: number, g: number, b: number) {
  for (let y = y0 | 0; y < (y1 | 0); y++) {
    for (let x = x0 | 0; x < (x1 | 0); x++) {
      px(f, x, y, r, g, b);
    }
  }
}

function lineThick(f: Frame, x0: number, y0: number, x1: number, y1: number, thick: number, r: number, g: number, b: number) {
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  const steps = Math.max(2, Math.ceil(len * 2));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = x0 + dx * t;
    const y = y0 + dy * t;
    for (let oy = -thick; oy <= thick; oy++) {
      for (let ox = -thick; ox <= thick; ox++) {
        if (ox * ox + oy * oy <= thick * thick) px(f, x + ox, y + oy, r, g, b);
      }
    }
  }
}

// ─── 5x7 monospace font for the readout ───────────────────────────────────
// Each glyph: 5 wide x 7 tall, bitfield row-major (LSB = leftmost pixel).
const GLYPHS: Record<string, number[]> = {
  ' ': [0,0,0,0,0,0,0],
  '-': [0,0,0,0b01110,0,0,0],
  '.': [0,0,0,0,0,0,0b00100],
  ',': [0,0,0,0,0,0b00100,0b01000],
  ':': [0,0b00100,0,0,0,0b00100,0],
  '/': [0b10000,0b10000,0b01000,0b00100,0b00010,0b00001,0b00001],
  '=': [0,0,0b11111,0,0b11111,0,0],
  '(': [0b00100,0b01000,0b01000,0b01000,0b01000,0b01000,0b00100],
  ')': [0b00100,0b00010,0b00010,0b00010,0b00010,0b00010,0b00100],
  '°': [0b00110,0b01001,0b00110,0,0,0,0],
  'φ': [0,0b01110,0b10101,0b10101,0b10101,0b01110,0b00100],
  'b': [0b00001,0b00001,0b01111,0b10001,0b10001,0b10001,0b01110],
  '0': [0b01110,0b10001,0b10001,0b10001,0b10001,0b10001,0b01110],
  '1': [0b00100,0b00110,0b00100,0b00100,0b00100,0b00100,0b01110],
  '2': [0b01110,0b10001,0b10000,0b01000,0b00100,0b00010,0b11111],
  '3': [0b01110,0b10001,0b10000,0b01100,0b10000,0b10001,0b01110],
  '4': [0b01000,0b01100,0b01010,0b01001,0b11111,0b01000,0b01000],
  '5': [0b11111,0b00001,0b01111,0b10000,0b10000,0b10001,0b01110],
  '6': [0b01110,0b10001,0b00001,0b01111,0b10001,0b10001,0b01110],
  '7': [0b11111,0b10000,0b01000,0b00100,0b00010,0b00010,0b00010],
  '8': [0b01110,0b10001,0b10001,0b01110,0b10001,0b10001,0b01110],
  '9': [0b01110,0b10001,0b10001,0b11110,0b10000,0b10001,0b01110],
  'A': [0b01110,0b10001,0b10001,0b11111,0b10001,0b10001,0b10001],
  'B': [0b01111,0b10001,0b10001,0b01111,0b10001,0b10001,0b01111],
  'C': [0b01110,0b10001,0b00001,0b00001,0b00001,0b10001,0b01110],
  'D': [0b01111,0b10001,0b10001,0b10001,0b10001,0b10001,0b01111],
  'E': [0b11111,0b00001,0b00001,0b01111,0b00001,0b00001,0b11111],
  'F': [0b11111,0b00001,0b00001,0b01111,0b00001,0b00001,0b00001],
  'G': [0b01110,0b10001,0b00001,0b11101,0b10001,0b10001,0b01110],
  'H': [0b10001,0b10001,0b10001,0b11111,0b10001,0b10001,0b10001],
  'I': [0b01110,0b00100,0b00100,0b00100,0b00100,0b00100,0b01110],
  'L': [0b00001,0b00001,0b00001,0b00001,0b00001,0b00001,0b11111],
  'M': [0b10001,0b11011,0b10101,0b10101,0b10001,0b10001,0b10001],
  'N': [0b10001,0b10011,0b10101,0b11001,0b10001,0b10001,0b10001],
  'O': [0b01110,0b10001,0b10001,0b10001,0b10001,0b10001,0b01110],
  'P': [0b01111,0b10001,0b10001,0b01111,0b00001,0b00001,0b00001],
  'R': [0b01111,0b10001,0b10001,0b01111,0b00101,0b01001,0b10001],
  'S': [0b01110,0b10001,0b00001,0b01110,0b10000,0b10001,0b01110],
  'T': [0b11111,0b00100,0b00100,0b00100,0b00100,0b00100,0b00100],
  'U': [0b10001,0b10001,0b10001,0b10001,0b10001,0b10001,0b01110],
  'V': [0b10001,0b10001,0b10001,0b10001,0b10001,0b01010,0b00100],
  'W': [0b10001,0b10001,0b10001,0b10101,0b10101,0b10101,0b01010],
  'X': [0b10001,0b10001,0b01010,0b00100,0b01010,0b10001,0b10001],
  'Y': [0b10001,0b10001,0b10001,0b01010,0b00100,0b00100,0b00100],
  'Z': [0b11111,0b10000,0b01000,0b00100,0b00010,0b00001,0b11111],
};

function drawChar(f: Frame, x: number, y: number, ch: string, scale: number, r: number, g: number, b: number) {
  const upper = ch.toUpperCase();
  const glyph = GLYPHS[ch] ?? GLYPHS[upper] ?? GLYPHS[' '];
  for (let row = 0; row < 7; row++) {
    const bits = glyph[row];
    for (let col = 0; col < 5; col++) {
      if (bits & (1 << col)) {
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            px(f, x + col * scale + dx, y + row * scale + dy, r, g, b);
          }
        }
      }
    }
  }
}

function drawText(f: Frame, x: number, y: number, s: string, scale: number, r: number, g: number, b: number) {
  let cursor = x;
  for (const ch of s) {
    drawChar(f, cursor, y, ch, scale, r, g, b);
    cursor += 6 * scale;
  }
}

// ─── Page-edge silhouette panel ───────────────────────────────────────────
// Draws a stylized side view: the spine sits at (originX, spineY); the page
// rotates with dihedral phi and curls with bend amount b. Length L pixels.
function drawPagePanel(
  f: Frame,
  panelX0: number,
  title: string,
  phi: number,
  b: number,
  isLeft: boolean,
  highlight: boolean,
) {
  const W2 = HALF;
  // Panel chrome.
  rect(f, panelX0 + 4, 4, panelX0 + W2 - 4, H - 4, 0x1a, 0x1f, 0x28);
  // Title bar.
  const titleColor: [number, number, number] = isLeft ? [0xff, 0x9b, 0x6b] : [0x66, 0xd9, 0xa1];
  rect(f, panelX0 + 4, 4, panelX0 + W2 - 4, 56, titleColor[0] / 4 | 0, titleColor[1] / 4 | 0, titleColor[2] / 4 | 0);
  drawText(f, panelX0 + 16, 20, title, 3, titleColor[0], titleColor[1], titleColor[2]);

  // Page-edge rendering area.
  const ax = panelX0 + W2 / 2;
  const ay = H / 2 + 80;
  // Resting page extends to the right from the spine.
  const L = 240;

  // Spine marker.
  for (let dy = -40; dy <= 40; dy++) {
    px(f, ax, ay + dy, 0xaa, 0xaa, 0xaa);
    px(f, ax + 1, ay + dy, 0xaa, 0xaa, 0xaa);
  }

  // Ghost reference (the resting target — left page flat).
  // Target φ = π means the page is flipped to the left.
  for (let i = 0; i <= L; i++) {
    px(f, ax - i, ay, 0x3a, 0x3a, 0x3a);
  }
  // Light grey for the current-spread reference (right page resting).
  for (let i = 0; i <= L; i++) {
    px(f, ax + i, ay, 0x33, 0x33, 0x33);
  }

  // Draw the turning page as a curved arc. Parametrize by arc-length s ∈ [0, L].
  // Local angle along the strip: theta(s) = phi - (b * sin(2*phi)) * (s / L)
  // — same shape as the FLIP_VERT shader's φ(t) curl-along-crease term.
  // Sweep from spine outward.
  const samples = 80;
  let px0 = ax, py0 = ay;
  for (let i = 1; i <= samples; i++) {
    const sFrac = i / samples;
    // Local tangent direction: rotate by phi minus the bend bump.
    const theta = phi - b * Math.sin(2 * phi) * sFrac;
    // Cumulative position via small straight segments.
    const segLen = L / samples;
    // We integrate by stepping at the current theta.
    // phi=0 → page rests pointing +x (right). phi=π → flipped to −x (left).
    // Sweep CCW upward through phi=π/2 ≡ page sticking straight up.
    const px1 = px0 + Math.cos(theta) * segLen;
    const py1 = py0 - Math.sin(theta) * segLen;
    const col = highlight ? [0xff, 0xc8, 0x66] : [0xe0, 0xe0, 0xe0];
    lineThick(f, px0, py0, px1, py1, 2, col[0], col[1], col[2]);
    px0 = px1; py0 = py1;
  }
}

// ─── Stat panel (the numerical readout) ───────────────────────────────────
function drawStats(
  f: Frame,
  panelX0: number,
  isLeft: boolean,
  phi: number,
  phiDot: number,
  b: number,
  t: number,
  settled: boolean,
  settledAt: number | null,
  paramsDesc: string[],
) {
  const x = panelX0 + 28;
  let y = 80;
  const lineHeight = 28;
  const c1: [number, number, number] = [0xbb, 0xbb, 0xbb];
  const c2: [number, number, number] = [0xff, 0xff, 0xff];

  const fmt = (n: number, w = 2) => {
    const v = (Math.abs(n) < 1e-4 ? 0 : n).toFixed(w);
    return n >= 0 ? ` ${v}` : v;
  };

  drawText(f, x, y, paramsDesc[0], 2, c1[0], c1[1], c1[2]); y += lineHeight - 6;
  drawText(f, x, y, paramsDesc[1], 2, c1[0], c1[1], c1[2]); y += lineHeight + 10;
  drawText(f, x, y, `T     ${fmt(t, 3)} S`, 2, c2[0], c2[1], c2[2]); y += lineHeight;
  drawText(f, x, y, `PHI   ${fmt(phi, 3)} RAD`, 2, c2[0], c2[1], c2[2]); y += lineHeight;
  drawText(f, x, y, `PHID  ${fmt(phiDot, 3)} R/S`, 2, c2[0], c2[1], c2[2]); y += lineHeight;
  drawText(f, x, y, `B     ${fmt(b, 3)}`, 2, c2[0], c2[1], c2[2]); y += lineHeight + 10;
  if (settled && settledAt !== null) {
    const sc: [number, number, number] = isLeft ? [0x66, 0xd9, 0xa1] : [0x66, 0xd9, 0xa1];
    drawText(f, x, y, `SETTLED AT ${settledAt.toFixed(2)} S`, 2, sc[0], sc[1], sc[2]);
  } else {
    drawText(f, x, y, `STILL SETTLING`, 2, 0xff, 0xa6, 0x66);
  }
}

// ─── Top label strip + timeline ───────────────────────────────────────────
function drawHeader(f: Frame, t: number, duration: number) {
  rect(f, 0, 0, W, 4, 0x33, 0x33, 0x33);
  // Timeline scrubber at bottom.
  const tlY = H - 18;
  rect(f, 0, tlY, W, tlY + 4, 0x33, 0x33, 0x33);
  const tx = (t / duration) * W;
  rect(f, tx - 2, tlY - 4, tx + 2, tlY + 8, 0xff, 0xc8, 0x66);
}

// ─── Main: simulate, render frames, encode with ffmpeg ────────────────────
async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  // Release condition: significant in-flight velocity (a flick).
  // Page is mid-flip (phi ≈ 1.4 rad ≈ 80°) with healthy positive phiDot.
  const release = { phi: 1.4, phiDot: 3.5 };
  const dir: 1 | -1 = 1;
  const fps = 30;
  const duration = 3.0; // seconds
  const sampleHz = fps;

  const oldSamples = simulate(OLD_PARAMS, isConvergedOld, release, dir, duration, sampleHz);
  const newSamples = simulate(NEW_PARAMS, isConvergedNew, release, dir, duration, sampleHz);

  // Find each side's first-settled time for reporting.
  const settledAt = (s: Sample[]) => {
    const f = s.find((x) => x.settled);
    return f ? f.t : null;
  };
  const oldSettled = settledAt(oldSamples);
  const newSettled = settledAt(newSamples);

  const summary = {
    release,
    dir,
    duration,
    fps,
    oldParams: OLD_PARAMS,
    newParams: NEW_PARAMS,
    oldSettledAt: oldSettled,
    newSettledAt: newSettled,
    oldFinal: oldSamples[oldSamples.length - 1],
    newFinal: newSamples[newSamples.length - 1],
  };
  console.log(JSON.stringify({
    release,
    oldSettledAt: oldSettled,
    newSettledAt: newSettled,
    speedup_x: oldSettled && newSettled ? (oldSettled / newSettled).toFixed(2) : 'n/a',
    oldFinalPhi: oldSamples[oldSamples.length - 1].phi,
    newFinalPhi: newSamples[newSamples.length - 1].phi,
  }, null, 2));

  await writeFile(resolve(OUT_DIR, 'comparison-data.json'), JSON.stringify(summary, null, 2));

  const N = Math.min(oldSamples.length, newSamples.length);

  // Spawn ffmpeg reading PPM frames from stdin.
  const outPathMp4 = resolve(OUT_DIR, 'comparison.mp4');
  const ff = spawn('ffmpeg', [
    '-y',
    '-f', 'image2pipe',
    '-vcodec', 'ppm',
    '-r', String(fps),
    '-i', '-',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-crf', '20',
    '-movflags', '+faststart',
    outPathMp4,
  ], { stdio: ['pipe', 'inherit', 'inherit'] });

  const header = Buffer.from(`P6\n${W} ${H}\n255\n`, 'ascii');

  for (let i = 0; i < N; i++) {
    const f = newFrame();
    const o = oldSamples[i];
    const n = newSamples[i];

    drawHeader(f, o.t, duration);

    // LEFT: pre-PR-60 (OLD)
    drawPagePanel(f, 0, 'BEFORE  PRE-PR60', o.phi, o.b, true, !o.settled);
    drawStats(f, 0, true, o.phi, o.phiDot, o.b, o.t, o.settled, oldSettled, [
      'G=5  D=6.5  W=12',
      'DB=6 K=0.05  EPS=ENERGY',
    ]);

    // RIGHT: post-PR-60 (NEW)
    drawPagePanel(f, HALF, 'AFTER   POST-PR60', n.phi, n.b, false, !n.settled);
    drawStats(f, HALF, false, n.phi, n.phiDot, n.b, n.t, n.settled, newSettled, [
      'G=10 D=4   W=18',
      'DB=18 K=0.08  EPS=ENERGY OR VISUAL',
    ]);

    // Center divider.
    rect(f, HALF - 1, 0, HALF + 1, H, 0x44, 0x44, 0x44);

    // Header strip with the release-state description.
    rect(f, 0, H - 56, W, H - 22, 0x1a, 0x1f, 0x28);
    drawText(
      f,
      24,
      H - 48,
      `RELEASE PHI=${release.phi}  PHIDOT=${release.phiDot}  TARGET=PI  T=${o.t.toFixed(2)}S`,
      2,
      0xcc,
      0xcc,
      0xcc,
    );

    ff.stdin.write(header);
    ff.stdin.write(f.buf);
  }
  ff.stdin.end();
  await new Promise<void>((resolveP, rejectP) => {
    ff.on('close', (code) => (code === 0 ? resolveP() : rejectP(new Error(`ffmpeg exit ${code}`))));
    ff.on('error', rejectP);
  });

  // Convert to GIF too (smaller, embeds inline in PR comments).
  const outPathGif = resolve(OUT_DIR, 'comparison.gif');
  await new Promise<void>((resolveP, rejectP) => {
    const conv = spawn('ffmpeg', [
      '-y', '-i', outPathMp4,
      '-vf', `fps=${fps},scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`,
      '-loop', '0',
      outPathGif,
    ], { stdio: ['ignore', 'inherit', 'inherit'] });
    conv.on('close', (code) => (code === 0 ? resolveP() : rejectP(new Error(`gif convert exit ${code}`))));
  });

  console.log(`wrote ${outPathMp4}`);
  console.log(`wrote ${outPathGif}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
