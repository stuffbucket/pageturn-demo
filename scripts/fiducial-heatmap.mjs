#!/usr/bin/env node
/**
 * fiducial-heatmap.mjs — analytic heat map of FR-P1 area-ratio peak
 * deviation for the 280 fiducial-grid-sweep scenarios.
 *
 * No browser, no Playwright, no GPU — we replay each scenario's pointer
 * keyframes against the same analytic FLIP_VERT model the harness uses
 * for its trajectory baselines (see harness/src/bootstrap.ts). For each
 * scenario we sweep the dihedral from 0..π, compute the FR-P1 area ratio
 * at each step, and record the maximum |ratio - 1|.
 *
 * Output:
 *   - docs/diagnostic-heatmap-2026-05-14.html
 *       Standalone single-file HTML page; open in any browser. Two 5x7
 *       heat maps (right page, left page), one column per drag direction
 *       (±x, ±y), cells colored by peak FR-P1 deviation.
 *
 * The heat map is the user's "if it's patchy, that's the bug" diagnostic
 * — patches indicate regions of (i,j,direction) space where the live
 * shader stretches the page beyond the inextensibility budget.
 *
 * Run:   node scripts/fiducial-heatmap.mjs
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const FIDUCIAL_US = [0.1, 0.3, 0.5, 0.7, 0.9];
const FIDUCIAL_VS = [0.08, 0.22, 0.36, 0.50, 0.64, 0.78, 0.92];
const PAGE_WIDTH = 1.0;
const PAGE_HEIGHT = 1.4;
const BEND_AMOUNT = 0.4;
const BOOK_TILT = 0.76;

// Analytic mirror of harness/src/bootstrap.ts:fiducialWorldPosition
// (sin2phi path). The developable path is omitted from the heat map for
// scope; FR-P1 was supposed to be enforced in that path by PR #59. The
// sin2phi path is the classic offender (issue #18, #50).
function fiducialWorldPosition(uAngle, u, v) {
  const origX = u * PAGE_WIDTH;
  const phi = uAngle + BEND_AMOUNT * u * Math.sin(2 * uAngle);
  const localX = origX * Math.cos(phi);
  const localZ = -origX * Math.sin(phi);
  const localY = (v - 0.5) * PAGE_HEIGHT;
  const c = Math.cos(-BOOK_TILT);
  const s = Math.sin(-BOOK_TILT);
  return { x: localX, y: localY * c - localZ * s, z: localY * s + localZ * c };
}

function areaRatio(uAngle) {
  // Mirror of FiducialPositions.approxAreaRatio (sin2phi path).
  let totalSpan = 0;
  for (let j = 0; j < FIDUCIAL_VS.length; j++) {
    let row = 0;
    for (let i = 1; i < FIDUCIAL_US.length; i++) {
      const a = fiducialWorldPosition(uAngle, FIDUCIAL_US[i - 1], FIDUCIAL_VS[j]);
      const b = fiducialWorldPosition(uAngle, FIDUCIAL_US[i],     FIDUCIAL_VS[j]);
      row += Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    }
    totalSpan += row;
  }
  const meanSpan = totalSpan / FIDUCIAL_VS.length;
  const widthFrac = FIDUCIAL_US[FIDUCIAL_US.length - 1] - FIDUCIAL_US[0];
  const spanArea = (meanSpan / widthFrac) * PAGE_WIDTH * PAGE_HEIGHT;
  return spanArea / (PAGE_WIDTH * PAGE_HEIGHT);
}

// In the sin2phi path the per-row area ratio is U-independent and depends
// only on uAngle. So the heat-map "drag origin (i,j)" + direction story
// only varies through the *gesture's induced uAngle trajectory* — which
// for the analytic model peaks at uAngle = π (full turn). The interesting
// asymmetry between origin cells comes from the live shader's tilted-
// crease snap, which the bootstrap.ts model approximates as a uniform
// global rotation. This is the headline diagnostic finding: FR-P1 is
// invariant under the analytic rest-frame model, so any patchiness in the
// LIVE-captured heat map is a GPU-vs-analytic divergence (most likely
// the originY snapping behaviour called out in issue #50).

function peakDeviationForCell() {
  // Sweep dihedral 0..π in 0.01-rad steps; report worst |ratio - 1|.
  let worst = 0;
  for (let phi = 0; phi <= Math.PI; phi += 0.01) {
    const r = areaRatio(-phi);
    const dev = Math.abs(r - 1);
    if (dev > worst) worst = dev;
  }
  return worst;
}

const ANALYTIC_PEAK_DEV = peakDeviationForCell();

// Build the (page, i, j, dir) cells. For the analytic model these are
// all identical — the heat map exists to be DIFFED against the live
// captures (when the harness runs the 280 scenarios), so we publish the
// analytic baseline as "expected: uniform" + a placeholder live column.
function buildCells() {
  const cells = [];
  for (const page of ['r', 'l']) {
    for (let i = 0; i < FIDUCIAL_US.length; i++) {
      for (let j = 0; j < FIDUCIAL_VS.length; j++) {
        for (const dir of ['px', 'mx', 'py', 'my']) {
          cells.push({
            page, i, j, dir,
            analyticPeakDev: ANALYTIC_PEAK_DEV,
            liveStatus: 'pending', // populated by a separate harness-run pipeline
          });
        }
      }
    }
  }
  return cells;
}

function devColor(dev) {
  if (dev <= 0.01) return '#1e6f3a'; // green
  if (dev <= 0.05) return '#a07a1f'; // yellow
  return '#7a1f1f';                   // red
}

function html(cells) {
  const dirs = ['px', 'mx', 'py', 'my'];
  const dirLabel = { px: '+x', mx: '-x', py: '+y', my: '-y' };
  const renderTable = (page, label) => {
    let out = `<h2>${label} page</h2>\n<table>\n<thead><tr><th>i\\j</th>`;
    for (let j = 0; j < FIDUCIAL_VS.length; j++) {
      out += `<th>j=${j}<br><small>v=${FIDUCIAL_VS[j]}</small></th>`;
    }
    out += '</tr></thead>\n<tbody>\n';
    for (let i = 0; i < FIDUCIAL_US.length; i++) {
      out += `<tr><th>i=${i}<br><small>u=${FIDUCIAL_US[i]}</small></th>`;
      for (let j = 0; j < FIDUCIAL_VS.length; j++) {
        out += '<td>';
        for (const dir of dirs) {
          const c = cells.find(x => x.page === page && x.i === i && x.j === j && x.dir === dir);
          out += `<span class="cell" style="background:${devColor(c.analyticPeakDev)}" title="${dirLabel[dir]} peak |Δ|=${c.analyticPeakDev.toFixed(4)}">${dirLabel[dir]}</span>`;
        }
        out += '</td>';
      }
      out += '</tr>\n';
    }
    out += '</tbody>\n</table>\n';
    return out;
  };

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>FR-P1 fiducial-grid heat map (2026-05-14)</title>
<style>
  body { font: 13px/1.4 ui-sans-serif, system-ui; padding: 20px; max-width: 1100px; margin: 0 auto; color: #1a1a1a; }
  h1, h2 { margin-bottom: 8px; }
  table { border-collapse: collapse; margin-bottom: 24px; }
  th, td { border: 1px solid #ddd; padding: 4px 6px; text-align: center; vertical-align: middle; }
  th { background: #f6f6f6; font-weight: 600; }
  small { color: #666; font-weight: 400; }
  .cell { display: inline-block; width: 28px; height: 22px; line-height: 22px; color: #fff; font-size: 11px; margin: 1px; border-radius: 3px; cursor: help; }
  .legend { font-size: 12px; margin-bottom: 16px; }
  .legend span { display: inline-block; width: 16px; height: 16px; vertical-align: middle; margin-right: 4px; border-radius: 3px; }
  .note { background: #fffced; border-left: 3px solid #d4a574; padding: 10px 12px; margin: 12px 0; border-radius: 4px; }
</style></head>
<body>
<h1>FR-P1 fiducial-grid heat map &mdash; analytic baseline (2026-05-14)</h1>
<p class="legend">
  <span style="background:#1e6f3a"></span> &le; 1% peak |area_ratio &minus; 1|
  &nbsp;&nbsp;
  <span style="background:#a07a1f"></span> 1&ndash;5%
  &nbsp;&nbsp;
  <span style="background:#7a1f1f"></span> &gt; 5%
</p>
<p class="note"><strong>How to read this.</strong> Each cell shows the four cardinal-direction drags from a single fiducial origin, color-coded by the worst-case FR-P1 area ratio deviation observed during a sin2phi-path drag from 0 to &pi;. The analytic model is U-independent &mdash; every cell shows the same value (${ANALYTIC_PEAK_DEV.toFixed(4)}) &mdash; because <em>in the rest-frame model the rotation is rigid</em>. <strong>If the live (GPU) heat map produced from the 280 scenarios in <code>harness/scenarios/fiducial-grid-sweep/</code> shows patchy values, the patchiness is the bug.</strong> See <code>docs/diagnostic-2026-05-14.md</code>.</p>
<p>Analytic peak deviation: <strong>${(ANALYTIC_PEAK_DEV * 100).toFixed(2)}%</strong></p>
${renderTable('r', 'Right')}
${renderTable('l', 'Left')}
</body></html>
`;
}

const cells = buildCells();
const out = resolve(__dirname, '..', 'docs', 'diagnostic-heatmap-2026-05-14.html');
writeFileSync(out, html(cells));
console.log(`Wrote ${out}`);
console.log(`Analytic peak FR-P1 deviation across [0, π]: ${(ANALYTIC_PEAK_DEV * 100).toFixed(2)}%`);
