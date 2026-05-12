// Playwright driver: launches a browser, opens harness.html, runs scenarios
// via window.__harness.runScenario, writes captured webm files to harness/output/.
//
// Modes (mutually exclusive, picked from the scenario JSON or CLI flags):
//   • video      — default; uses MediaRecorder, writes <name>.webm
//   • trajectory — --trajectories or scenario.trajectories=true; writes
//                  <name>.json with fiducial world-space samples
//   • assertion  — scenario has an `assertions` array. Captures whichever of
//                  {telemetry, trajectory, screenshots} the assertions need,
//                  evaluates each, and exits non-zero if any fail. Always
//                  the regression-test pathway.
// A scenario in assertion mode that requests a trajectory ALSO writes the
// trajectory JSON. Likewise, screenshots taken for pixel assertions are
// also saved as PNGs alongside <name>.<atT>.png for later eyeballing.

import { chromium, Page } from 'playwright';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  Scenario,
  Assertion,
  CapturedTelemetryEvent,
  TrajectoryResult,
  PixelLumaAssertion,
  PixelMaxLumaAssertion,
  PixelVarianceAssertion,
  PixelEdgeTransitionsAssertion,
} from '../src/ccapture.js';
import { evaluate as evalAssertion, AssertionContext } from './assertions.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const HARNESS_DIR = resolve(__dirname, '..');
const SCENARIOS_DIR = join(HARNESS_DIR, 'scenarios');
const OUTPUT_DIR = join(HARNESS_DIR, 'output');
const TRAJECTORIES_DIR = join(OUTPUT_DIR, 'trajectories');
const SCREENSHOTS_DIR = join(OUTPUT_DIR, 'screenshots');

const BASE_URL = process.env.HARNESS_URL ?? 'http://localhost:5173/harness.html';

async function loadScenarios(only?: string[]): Promise<Scenario[]> {
  const files = await readdir(SCENARIOS_DIR);
  const wanted = only && only.length > 0
    ? files.filter((f) => only.some((name) => f === name || f === `${name}.json`))
    : files.filter((f) => f.endsWith('.json'));
  const out: Scenario[] = [];
  for (const f of wanted) {
    const raw = await readFile(join(SCENARIOS_DIR, f), 'utf-8');
    out.push(JSON.parse(raw));
  }
  return out;
}

/**
 * Read the canvas at "atT" (scenario time) into an RGBA buffer prefixed by
 * width/height. Done in-page via getImageData on a 2D copy of the WebGL
 * canvas. To avoid an empty buffer (WebGL clears its drawing buffer after
 * compositing unless preserveDrawingBuffer is true), the copy runs inside
 * a requestAnimationFrame callback BEFORE the next paint.
 *
 * Layout matches what assertions.ts/unpackRGBA reads.
 */
async function captureCanvasRGBA(page: Page): Promise<Buffer> {
  const result = await page.evaluate(() => new Promise<{ width: number; height: number; bytes: number[] }>((resolve, reject) => {
    requestAnimationFrame(() => {
      try {
        const c = document.querySelector('#canvas-container canvas') as HTMLCanvasElement | null;
        if (!c) { reject(new Error('canvas not found')); return; }
        const tmp = document.createElement('canvas');
        tmp.width = c.width;
        tmp.height = c.height;
        const ctx2 = tmp.getContext('2d');
        if (!ctx2) { reject(new Error('2D context not available')); return; }
        ctx2.drawImage(c, 0, 0);
        const id = ctx2.getImageData(0, 0, c.width, c.height);
        resolve({ width: c.width, height: c.height, bytes: Array.from(id.data) });
      } catch (e) { reject(e); }
    });
  }));
  const header = Buffer.alloc(8);
  header.writeUInt32BE(result.width, 0);
  header.writeUInt32BE(result.height, 4);
  return Buffer.concat([header, Buffer.from(result.bytes)]);
}

async function urlForScenario(s: Scenario): Promise<string> {
  if (s.url) {
    // Allow scenarios to specify the URL with localhost; rebase the host
    // onto $HARNESS_URL so docker-compose / alternate ports keep working.
    try {
      const scenarioUrl = new URL(s.url);
      const baseUrl = new URL(BASE_URL);
      scenarioUrl.host = baseUrl.host;
      scenarioUrl.protocol = baseUrl.protocol;
      return scenarioUrl.toString();
    } catch {
      return s.url;
    }
  }
  return BASE_URL;
}

interface ScenarioOutcome {
  name: string;
  passed: boolean;
  results: { ok: boolean; description: string; detail?: string }[];
}

async function runAssertionScenario(
  page: Page,
  scenario: Scenario,
  wallTimeoutMs: number,
): Promise<ScenarioOutcome> {
  // Decide which artifacts to gather.
  const needTrajectory = scenario.assertions!.some((a) => a.type === 'trajectory') ||
                         scenario.trajectories === true;
  const pixelAssertions = scenario.assertions!.filter(
    (a): a is PixelLumaAssertion | PixelMaxLumaAssertion | PixelVarianceAssertion =>
      a.type === 'pixel-min-luma' || a.type === 'pixel-max-luma' || a.type === 'pixel-max-variance',
  );

  let telemetry: CapturedTelemetryEvent[] = [];
  let trajectories: TrajectoryResult | undefined;
  const screenshots = new Map<number, Buffer>();

  if (needTrajectory) {
    // Trajectory mode also accumulates telemetry via the bootstrap interceptor.
    const start = Date.now();
    // Kick off scenario; concurrently take screenshots at the requested atT.
    const scenarioPromise = page.evaluate(
      async (s) => window.__harness!.runScenarioTrajectories!(s),
      scenario,
    );
    for (const pa of pixelAssertions) {
      // Wait on the page's scenario clock, then snap.
      await page.evaluate((t) => window.__harness!.waitUntilT!(t), pa.atT);
      screenshots.set(pa.atT, await captureCanvasRGBA(page));
    }
    trajectories = await Promise.race([
      scenarioPromise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`runner timeout: ${scenario.name} > ${wallTimeoutMs}ms`)), wallTimeoutMs),
      ),
    ]);
    // Drain pending sendBeacon Blob.text() promises before snapshotting telemetry.
    await page.evaluate(async () => {
      const pending = (window as unknown as { __pendingTelemetry?: Promise<void>[] }).__pendingTelemetry;
      if (pending && pending.length > 0) {
        await Promise.allSettled(pending);
        (window as unknown as { __pendingTelemetry?: Promise<void>[] }).__pendingTelemetry = [];
      }
    });
    telemetry = await page.evaluate(() => window.__harness!.drainTelemetry!());
    console.log(`  · scenario ran in ${Date.now() - start}ms (trajectory mode)`);
  } else {
    const start = Date.now();
    const scenarioPromise = page.evaluate(
      async (s) => window.__harness!.runScenarioPlain!(s),
      scenario,
    );
    for (const pa of pixelAssertions) {
      await page.evaluate((t) => window.__harness!.waitUntilT!(t), pa.atT);
      screenshots.set(pa.atT, await captureCanvasRGBA(page));
    }
    const plain = await Promise.race([
      scenarioPromise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`runner timeout: ${scenario.name} > ${wallTimeoutMs}ms`)), wallTimeoutMs),
      ),
    ]);
    telemetry = plain.telemetry;
    console.log(`  · scenario ran in ${Date.now() - start}ms (plain mode), ${telemetry.length} telemetry events`);
    if (telemetry.length > 0) {
      console.log(`    telemetry types: ${telemetry.map((t) => `${t.type}@${t.tScenarioMs.toFixed(0)}`).join(', ')}`);
    }
  }

  // Save the trajectory JSON (for debugging) when produced.
  if (trajectories) {
    await mkdir(TRAJECTORIES_DIR, { recursive: true });
    const outPath = join(TRAJECTORIES_DIR, `${scenario.name}.json`);
    await writeFile(outPath, JSON.stringify(trajectories, null, 2));
  }
  // Save raw screenshots as a small debug aid.
  if (screenshots.size > 0) {
    await mkdir(SCREENSHOTS_DIR, { recursive: true });
    for (const [atT, buf] of screenshots) {
      const outPath = join(SCREENSHOTS_DIR, `${scenario.name}.${atT}.rgba`);
      await writeFile(outPath, buf);
    }
  }

  // Evaluate assertions.
  const ctx: AssertionContext = {
    scenarioName: scenario.name,
    telemetry,
    trajectories,
    screenshots,
    viewport: scenario.viewport,
  };
  const results: ScenarioOutcome['results'] = [];
  for (const a of scenario.assertions!) {
    const r = await evalAssertion(ctx, a);
    results.push({ ok: r.ok, description: r.description, detail: r.detail });
    const mark = r.ok ? '✓' : '✗';
    console.log(`  ${mark} ${a.type}: ${r.description}`);
    if (r.detail) console.log(`      ${r.detail}`);
  }
  const passed = results.every((r) => r.ok);
  return { name: scenario.name, passed, results };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const all = args.includes('--all');
  const trajectoriesMode = args.includes('--trajectories');
  const named = args.filter((a) => !a.startsWith('--'));
  // Default to horizontal-pull when running trajectories with no specific scenario.
  const defaultName = trajectoriesMode && named.length === 0 && !all
    ? ['horizontal-pull']
    : undefined;
  const scenarios = await loadScenarios(
    all ? undefined : named.length ? named : defaultName,
  );

  if (scenarios.length === 0) {
    console.error(`No scenarios found in ${SCENARIOS_DIR}. Pass --all or a name.`);
    process.exit(1);
  }

  await mkdir(OUTPUT_DIR, { recursive: true });
  if (trajectoriesMode) await mkdir(TRAJECTORIES_DIR, { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    args: [
      // Explicitly opt in to SwiftShader software WebGL. Chromium has
      // deprecated the silent auto-fallback; without this flag, future
      // versions will refuse to create a WebGL context. SwiftShader is
      // "unsafe" only against Spectre-style cross-origin reads via
      // malicious GLSL — we run trusted content in an isolated container,
      // so the label doesn't apply to our threat model.
      '--enable-unsafe-swiftshader',
    ],
  });
  const outcomes: ScenarioOutcome[] = [];
  try {
    for (const scenario of scenarios) {
      console.log(`▶ ${scenario.name}  (${scenario.duration}ms @ ${scenario.fps}fps)`);
      const ctx = await browser.newContext({ viewport: scenario.viewport });
      const page = await ctx.newPage();
      page.on('console', (msg) => {
        const t = msg.type();
        const prefix = t === 'error' ? '✗' : t === 'warning' ? '!' : '·';
        console.log(`  ${prefix} [page:${t}] ${msg.text()}`);
      });
      page.on('pageerror', (err) => console.error(`  ✗ [pageerror] ${err.message}`));

      const url = await urlForScenario(scenario);
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.evaluate(() => window.__harness!.ready);

      // Hard wall-clock ceiling per scenario — the in-page watchdog gives us
      // a nicer error, but if even *that* hangs we still want the runner to die.
      const wallTimeoutMs = Math.max(60_000, scenario.duration * 30);

      const hasAssertions = Array.isArray(scenario.assertions) && scenario.assertions.length > 0;

      if (hasAssertions) {
        const outcome = await runAssertionScenario(page, scenario, wallTimeoutMs);
        outcomes.push(outcome);
      } else if (trajectoriesMode || scenario.trajectories) {
        const result = await Promise.race([
          page.evaluate(async (s) => window.__harness!.runScenarioTrajectories!(s), scenario),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`runner timeout: ${scenario.name} > ${wallTimeoutMs}ms`)), wallTimeoutMs),
          ),
        ]);
        const outPath = join(TRAJECTORIES_DIR, `${scenario.name}.json`);
        await writeFile(outPath, JSON.stringify(result, null, 2));
        const ids = Object.keys(result.fiducials);
        const samplesPerId = ids[0] ? result.fiducials[ids[0]].length : 0;
        console.log(`  ✓ wrote ${outPath}  (${ids.length} fiducials, ${samplesPerId} samples each)`);
      } else {
        const result = await Promise.race([
          page.evaluate(async (s) => window.__harness!.runScenario(s), scenario),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`runner timeout: ${scenario.name} > ${wallTimeoutMs}ms`)), wallTimeoutMs),
          ),
        ]);

        const outPath = join(OUTPUT_DIR, `${scenario.name}.webm`);
        await writeFile(outPath, Buffer.from(result.base64, 'base64'));
        const sizeKB = ((result.base64.length * 0.75) / 1024).toFixed(1);
        console.log(`  ✓ wrote ${outPath}  (~${sizeKB} KB, ${result.mimeType})`);
      }

      await ctx.close();
    }
  } finally {
    await browser.close();
  }

  // Summary + non-zero exit on assertion failure.
  if (outcomes.length > 0) {
    const failed = outcomes.filter((o) => !o.passed);
    console.log(`\nAssertion summary: ${outcomes.length - failed.length}/${outcomes.length} scenarios passed.`);
    for (const f of failed) {
      console.log(`  ✗ ${f.name}`);
      for (const r of f.results.filter((r) => !r.ok)) {
        console.log(`      - ${r.description}: ${r.detail ?? ''}`);
      }
    }
    if (failed.length > 0) process.exit(2);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
