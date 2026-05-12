// Playwright driver: launches a browser, opens harness.html, runs scenarios
// via window.__harness.runScenario, writes captured webm files to harness/output/.

import { chromium } from 'playwright';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Scenario } from '../src/ccapture.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const HARNESS_DIR = resolve(__dirname, '..');
const SCENARIOS_DIR = join(HARNESS_DIR, 'scenarios');
const OUTPUT_DIR = join(HARNESS_DIR, 'output');

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

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const all = args.includes('--all');
  const named = args.filter((a) => !a.startsWith('--'));
  const scenarios = await loadScenarios(all ? undefined : named.length ? named : undefined);

  if (scenarios.length === 0) {
    console.error(`No scenarios found in ${SCENARIOS_DIR}. Pass --all or a name.`);
    process.exit(1);
  }

  await mkdir(OUTPUT_DIR, { recursive: true });

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

      await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
      await page.evaluate(() => window.__harness!.ready);

      // Hard wall-clock ceiling per scenario — the in-page watchdog gives us
      // a nicer error, but if even *that* hangs we still want the runner to die.
      const wallTimeoutMs = Math.max(60_000, scenario.duration * 30);
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

      await ctx.close();
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
