#!/usr/bin/env node
// scripts/multi-angle-capture.mjs
//
// Replays harness/scenarios/multi-angle-pivot.json from each of the 8 camera
// presets, snapping a screenshot at each "dihedral checkpoint" time (7 per
// preset). Writes:
//   contrib/debug/multi-angle/<preset>__t<ms>.png       (56 frames)
//   contrib/debug/multi-angle/grid-by-moment-<ms>.html  (one row per moment)
//   contrib/debug/multi-angle/grid-by-angle-<preset>.html
//   contrib/debug/multi-angle/index.html                (everything + narrative)
//
// We do NOT depend on ffmpeg. The "grids" are CSS grids over the per-frame
// PNGs — fine for human-eyeball review, no extra build step.
//
// Pre-reqs: a vite dev server on $HARNESS_URL (default http://localhost:5173).
// CI / scripted use can spawn one first; locally just `npm run dev` in
// another terminal.
//
// Usage:
//   node scripts/multi-angle-capture.mjs
//   HARNESS_URL=http://localhost:5173 node scripts/multi-angle-capture.mjs
//   node scripts/multi-angle-capture.mjs --presets front,top,iso

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
// Resolve playwright from harness/node_modules so we don't require root-level
// `npm install`. The harness already lists playwright as a devDependency.
const playwrightUrl = pathToFileURL(
  join(REPO, 'harness', 'node_modules', 'playwright', 'index.mjs'),
).href;
const { chromium } = await import(playwrightUrl);
const SCENARIO_PATH = join(REPO, 'harness', 'scenarios', 'multi-angle-pivot.json');
const OUT_DIR = join(REPO, 'contrib', 'debug', 'multi-angle');

const ALL_PRESETS = [
  'front',
  'top',
  'side-spine',
  'side-corner',
  'three-quarter',
  'worm',
  'behind',
  'iso',
];

const PRESET_DESCRIPTIONS = {
  front:
    'Default head-on. Best for back-face bleed and cover gradient continuity. Hides pivot defects and z-axis drift.',
  top:
    'Top-down. Spine is a vertical line; off-spine pivot bugs (#68/#76) are immediate.',
  'side-spine':
    'Spine-edge view. Curl-into-tube shows as a coil; z-axis drift during settle is visible.',
  'side-corner':
    'Down the drag-axis. Shows whether dihedral aligns with drag direction.',
  'three-quarter':
    '30/45 thumbnail angle. Useful default for evidence captures.',
  worm:
    'From below. Reveals back-face issues and missing n+1 leaf (#54/#58).',
  behind:
    'From behind the spine. Confirms back-face texture sampling and mirror-flip orientation.',
  iso:
    'Isometric. Equal-axis foreshortening — best for cross-run side-by-side comparisons.',
};

function arg(name, defVal) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0 || i + 1 >= process.argv.length) return defVal;
  return process.argv[i + 1];
}

async function main() {
  const baseUrl = process.env.HARNESS_URL ?? 'http://localhost:5173';
  const presetArg = arg('presets', null);
  const presets = presetArg ? presetArg.split(',') : ALL_PRESETS;
  for (const p of presets) {
    if (!ALL_PRESETS.includes(p)) {
      console.error(`Unknown preset: ${p}. Known: ${ALL_PRESETS.join(', ')}`);
      process.exit(1);
    }
  }

  const scenario = JSON.parse(await readFile(SCENARIO_PATH, 'utf-8'));
  const checkpoints = scenario._dihedralCheckpointsMs;
  if (!Array.isArray(checkpoints) || checkpoints.length === 0) {
    throw new Error('Scenario must include _dihedralCheckpointsMs[]');
  }

  await mkdir(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    args: ['--enable-unsafe-swiftshader'],
  });
  try {
    // ── Pass 1: front view, record the actual book-local drag trajectory.
    // We replay via book API on the other presets so OrbitControls (which
    // intercepts off-page pointer events in non-front views) cannot rotate
    // the camera. Without this, top/worm/behind/side-spine views miss the
    // book in screen-space and the synthesized drag does nothing useful.
    console.log('▶ pass 1: recording book-local drag trajectory from front view');
    const trajectory = await recordTrajectory(browser, baseUrl, scenario);
    console.log(`  · recorded ${trajectory.length} updateTurningDrag samples`);

    // ── Pass 2: per-preset replay via book API + screenshot at each checkpoint.
    for (const preset of presets) {
      console.log(`▶ preset=${preset}`);
      await replayAndCapture(browser, baseUrl, preset, scenario, trajectory, checkpoints);
    }
  } finally {
    await browser.close();
  }

  await writeIndexHtml(presets, checkpoints);
  console.log(`\n✓ wrote ${OUT_DIR}/index.html`);
}

/**
 * Replay the scenario in front-view via real pointer events (which exercise
 * the actual main.ts hit-testing + drag math), and on every animation frame
 * record (t, dragPx, dragPy, isReverse, isTurning) read off the live book.
 * The result is a deterministic list we can replay via book API on other
 * camera presets — the renderer behaves identically because Book ignores the
 * camera; only the captured pixels change.
 */
async function recordTrajectory(browser, baseUrl, scenario) {
  const ctx = await browser.newContext({ viewport: scenario.viewport });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error(`  ✗ ${e.message}`));
  const url = new URL('/harness.html', baseUrl);
  url.searchParams.set('camera', 'front');
  await page.goto(url.toString(), { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => window.__harness?.ready);

  // Sampler: grab dragPoint once per rAF while the scenario runs.
  await page.evaluate((duration) => {
    window.__captureSamples = [];
    const t0 = performance.now();
    const tick = () => {
      const elapsed = performance.now() - t0;
      const state = window.__pageturn.book.getState();
      const dp = state.getDragPoint();
      window.__captureSamples.push({
        t: elapsed,
        isTurning: state.getIsTurning(),
        isReverse: state.getIsReverseTurn(),
        dragPx: dp ? dp.x : null,
        dragPy: dp ? dp.y : null,
      });
      if (elapsed < duration) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, scenario.duration + 200);

  await page.evaluate(s => window.__harness.runScenarioPlain(s), scenario);
  // Give the sampler a beat to finish.
  await page.waitForTimeout(250);
  const samples = await page.evaluate(() => window.__captureSamples);
  await ctx.close();
  return samples;
}

async function replayAndCapture(browser, baseUrl, preset, scenario, trajectory, checkpoints) {
  const ctx = await browser.newContext({ viewport: scenario.viewport });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error(`  ✗ ${e.message}`));
  const url = new URL('/harness.html', baseUrl);
  url.searchParams.set('camera', preset);
  url.searchParams.set('debug', '1');
  url.searchParams.set('fiducials', '1');
  await page.goto(url.toString(), { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => window.__harness?.ready);

  // Drive the book API per recorded sample, taking screenshots at checkpoints.
  // Replays in real time so the viewer perceives a continuous gesture and the
  // settle physics (if a pointerup were here) would behave naturally.
  const driverPromise = page.evaluate(async (samples) => {
    const book = window.__pageturn.book;
    const t0 = performance.now();
    let started = false;
    let reverse = false;
    let lastTurning = false;
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    for (const s of samples) {
      const wait = s.t - (performance.now() - t0);
      if (wait > 0) await sleep(wait);
      if (!s.isTurning && lastTurning) {
        // Trajectory dropped the turn (drag-end → settle complete or cancel).
        // No-op here: the front pass already drove the state machine; we
        // only want to mirror the *visible* turning portion.
        lastTurning = false;
        continue;
      }
      if (!s.isTurning) continue;
      if (!started) {
        reverse = s.isReverse;
        if (reverse) book.startReverseTurn(); else book.startTurn();
        started = true;
      }
      if (s.dragPx !== null && s.dragPy !== null) {
        book.updateTurningDrag(s.dragPx, s.dragPy);
      }
      lastTurning = true;
    }
  }, trajectory);

  // Snap a screenshot at each checkpoint.
  for (const t of checkpoints) {
    await page.evaluate((tt) => new Promise(r => {
      const t0 = performance.now();
      const tick = () => {
        const start = (window.__captureT0 ??= t0);
        if (performance.now() - start >= tt) return r();
        requestAnimationFrame(tick);
      };
      tick();
    }), t);
    const out = join(OUT_DIR, `${preset}__t${t}.png`);
    await page.screenshot({ path: out, type: 'png', fullPage: false });
    console.log(`  · ${preset}@${t}ms → ${out}`);
  }
  await driverPromise;
  await ctx.close();
}

async function writeIndexHtml(presets, checkpoints) {
  // Per-moment grids (one row of presets per moment) and per-angle grids
  // (one row of moments per angle) are inlined as CSS grids in index.html.
  // Keeps the artifact a single file the user can scp / open locally.
  const cell = (src, label) => `
    <figure>
      <img src="${src}" alt="${label}" loading="lazy" />
      <figcaption>${label}</figcaption>
    </figure>`;

  const byMomentRows = checkpoints.map((t) => `
    <section>
      <h3>moment t=${t}ms</h3>
      <div class="grid by-angle">
        ${presets.map((p) => cell(`${p}__t${t}.png`, `${p}`)).join('')}
      </div>
    </section>`).join('\n');

  const byAngleRows = presets.map((p) => `
    <section>
      <h3>angle ${p}</h3>
      <p class="desc">${PRESET_DESCRIPTIONS[p] ?? ''}</p>
      <div class="grid by-moment">
        ${checkpoints.map((t) => cell(`${p}__t${t}.png`, `t=${t}ms`)).join('')}
      </div>
    </section>`).join('\n');

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>multi-angle pivot capture</title>
<style>
  body { margin: 0; padding: 24px; background: #12111f; color: #d8e4ff;
         font: 14px/1.5 -apple-system, system-ui, sans-serif; }
  h1, h2, h3 { color: #e9f0ff; }
  h1 { font-size: 22px; margin-top: 0; }
  h2 { font-size: 18px; margin-top: 32px; }
  h3 { font-size: 15px; margin: 20px 0 6px; color: #9bc7e8; }
  p.desc { color: #9bc7e8; margin: 0 0 8px; max-width: 80ch; }
  .grid { display: grid; gap: 6px; }
  .grid.by-angle { grid-template-columns: repeat(${presets.length}, 1fr); }
  .grid.by-moment { grid-template-columns: repeat(${checkpoints.length}, 1fr); }
  figure { margin: 0; }
  img { width: 100%; height: auto; display: block; border: 1px solid #2a2740; }
  figcaption { font-size: 11px; color: #6a7898; margin-top: 2px; text-align: center; }
  nav a { color: #9bc7e8; margin-right: 12px; }
</style>
</head>
<body>
<h1>multi-angle pivot capture</h1>
<p>Replay of <code>harness/scenarios/multi-angle-pivot.json</code> (a vertical-biased drag from the top-right corner) seen from ${presets.length} camera presets at ${checkpoints.length} dihedral checkpoints.</p>
<p><strong>What to look for in each angle:</strong></p>
<ul>
${presets.map((p) => `  <li><code>${p}</code> — ${PRESET_DESCRIPTIONS[p] ?? ''}</li>`).join('\n')}
</ul>

<nav><a href="#by-moment">by moment</a><a href="#by-angle">by angle</a></nav>

<h2 id="by-moment">grids by moment (one row of all angles per dihedral checkpoint)</h2>
${byMomentRows}

<h2 id="by-angle">grids by angle (one row of all moments per camera angle)</h2>
${byAngleRows}
</body>
</html>
`;
  await writeFile(join(OUT_DIR, 'index.html'), html);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
