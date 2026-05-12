/**
 * debug.ts — On-screen debug HUD for the page-turn prototype.
 *
 * Exposes:
 *   • debugEnabled()      — true when ?debug=1 is in URL
 *   • DebugHud            — fixed-position top-right HUD with live state
 *
 * The HUD reads state via read-only accessors on Book/BookState plus snapshot
 * data passed in from main.ts (drag point, dragging flag, settle target,
 * camera, fps).  It writes a single textContent per rAF tick (no per-frame
 * object allocations beyond the formatted string itself).
 *
 * Toggle visibility via setVisible(); the help-menu checkbox in main.ts
 * drives this.  ?debug=1 just sets the initial visibility.
 */

import type * as THREE from 'three';
import QRCode from 'qrcode';
import { buildInfo } from 'virtual:build-info';
import type { Book } from './book/Book';

/** Whether the ?debug=1 URL flag is set. */
export function debugEnabled(): boolean {
  if (typeof location === 'undefined') return false;
  try {
    return new URLSearchParams(location.search).get('debug') === '1';
  } catch {
    return false;
  }
}

export interface DebugSnapshot {
  isDragging: boolean;
  dragPointX: number | null;
  dragPointY: number | null;
  dragProgress: number;
  dragVelocity: number;
  settling: boolean;
  settleTarget: number;
  fps: number;
  camera: THREE.PerspectiveCamera;
  controlsTarget: THREE.Vector3;
}

const fmt = (n: number, p = 3): string => {
  if (!Number.isFinite(n)) return String(n);
  return n.toFixed(p);
};

const rad2deg = (r: number): string => fmt((r * 180) / Math.PI, 1);

const truncate = (s: string, n: number): string =>
  s.length > n ? `${s.slice(0, Math.max(0, n - 1))}…` : s;

export class DebugHud {
  private el: HTMLDivElement;
  private body: HTMLDivElement;
  private buildSection: HTMLDivElement;
  private qrToast: HTMLDivElement;
  private qrPayload: string;
  private visible: boolean;
  private book: Book;

  constructor(book: Book, initialVisible: boolean) {
    this.book = book;
    this.visible = initialVisible;

    const el = document.createElement('div');
    el.id = 'debug-hud';
    el.setAttribute('aria-hidden', 'true');
    Object.assign(el.style, {
      position: 'fixed',
      top: '12px',
      right: '12px',
      maxWidth: '320px',
      padding: '10px 12px',
      background: 'rgba(0, 0, 0, 0.78)',
      color: '#d8e4ff',
      font: '11px/1.35 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      borderRadius: '6px',
      border: '1px solid rgba(255, 255, 255, 0.15)',
      backdropFilter: 'blur(6px)',
      pointerEvents: 'auto',
      whiteSpace: 'pre',
      zIndex: '50',
      display: initialVisible ? 'block' : 'none',
    } as Partial<CSSStyleDeclaration>);

    const title = document.createElement('div');
    title.textContent = 'DEBUG HUD';
    Object.assign(title.style, {
      color: '#ffd479',
      fontWeight: '700',
      letterSpacing: '0.08em',
      marginBottom: '6px',
    } as Partial<CSSStyleDeclaration>);

    // ── Build section (above FPS / above the live state body) ───────────────
    const buildSection = document.createElement('div');
    Object.assign(buildSection.style, {
      whiteSpace: 'pre',
      marginBottom: '8px',
      paddingBottom: '8px',
      borderBottom: '1px solid rgba(255, 255, 255, 0.12)',
    } as Partial<CSSStyleDeclaration>);

    const body = document.createElement('div');

    // ── QR row (canvas + toast) ─────────────────────────────────────────────
    const qrWrap = document.createElement('div');
    Object.assign(qrWrap.style, {
      marginTop: '8px',
      paddingTop: '8px',
      borderTop: '1px solid rgba(255, 255, 255, 0.12)',
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
    } as Partial<CSSStyleDeclaration>);

    const qrCol = document.createElement('div');
    const qrLabel = document.createElement('div');
    qrLabel.textContent = 'scan to reproduce';
    Object.assign(qrLabel.style, {
      fontSize: '10px',
      color: '#9aa6c2',
      marginBottom: '4px',
    } as Partial<CSSStyleDeclaration>);

    const qrCanvas = document.createElement('canvas');
    qrCanvas.width = 160;
    qrCanvas.height = 160;
    Object.assign(qrCanvas.style, {
      width: '160px',
      height: '160px',
      cursor: 'pointer',
      borderRadius: '3px',
      background: '#fff',
      display: 'block',
    } as Partial<CSSStyleDeclaration>);
    qrCanvas.title = 'Click to copy repro JSON';

    qrCol.appendChild(qrLabel);
    qrCol.appendChild(qrCanvas);

    const qrToast = document.createElement('div');
    qrToast.textContent = 'Copied!';
    Object.assign(qrToast.style, {
      color: '#7ee787',
      fontSize: '11px',
      opacity: '0',
      transition: 'opacity 180ms ease',
    } as Partial<CSSStyleDeclaration>);

    qrWrap.appendChild(qrCol);
    qrWrap.appendChild(qrToast);

    el.appendChild(title);
    el.appendChild(buildSection);
    el.appendChild(body);
    el.appendChild(qrWrap);
    document.body.appendChild(el);

    this.el = el;
    this.body = body;
    this.buildSection = buildSection;
    this.qrToast = qrToast;

    // QR payload — the agent-readable repro recipe.
    this.qrPayload = JSON.stringify({
      v: 1,
      kind: 'pageturn-repro',
      repo: 'https://github.com/stuffbucket/pageturn-demo',
      commit: buildInfo.commit,
      branch: buildInfo.branch,
      dirty: buildInfo.dirty,
      pr: buildInfo.pr ? buildInfo.pr.number : null,
      url: typeof window !== 'undefined' ? window.location.href : '',
    });

    // Render Build section + QR up front (fire-and-forget).  These don't
    // change during a session.
    this.renderBuildSection();
    void QRCode.toCanvas(qrCanvas, this.qrPayload, { width: 160, margin: 1 })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.warn('[debug-hud] QR render failed', err);
      });

    qrCanvas.addEventListener('click', () => {
      void this.copyQrPayload();
    });
  }

  private async copyQrPayload(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.qrPayload);
      this.flashToast();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[debug-hud] clipboard write failed', err);
    }
  }

  private flashToast(): void {
    this.qrToast.style.opacity = '1';
    window.setTimeout(() => {
      this.qrToast.style.opacity = '0';
    }, 1200);
  }

  private renderBuildSection(): void {
    const isAgent = /^agent-/.test(buildInfo.worktreeLabel);
    const sectionColor = isAgent ? '#d4a574' : '#d8e4ff';
    const dirtyMark = buildInfo.dirty ? ' ✱' : '';
    const commitColor = buildInfo.dirty ? '#d4a574' : sectionColor;

    const prText = buildInfo.pr
      ? `#${buildInfo.pr.number} ${truncate(buildInfo.pr.title, 30)}`
      : '(none)';

    // Use a small structured DOM so we can color individual lines without
    // sacrificing the monospace alignment (whiteSpace: pre on each row).
    this.buildSection.innerHTML = '';
    const header = document.createElement('div');
    header.textContent = 'Build';
    Object.assign(header.style, {
      color: sectionColor,
      fontWeight: '700',
    } as Partial<CSSStyleDeclaration>);
    this.buildSection.appendChild(header);

    const row = (label: string, value: string, color: string): HTMLDivElement => {
      const d = document.createElement('div');
      d.textContent = `  ${label.padEnd(10)} ${value}`;
      d.style.color = color;
      d.style.whiteSpace = 'pre';
      return d;
    };

    this.buildSection.appendChild(row('branch', buildInfo.branch, sectionColor));
    this.buildSection.appendChild(row('commit', `${buildInfo.commitShort}${dirtyMark}`, commitColor));
    this.buildSection.appendChild(row('worktree', buildInfo.worktreeLabel, sectionColor));
    this.buildSection.appendChild(row('PR', prText, sectionColor));
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.el.style.display = v ? 'block' : 'none';
  }

  isVisible(): boolean {
    return this.visible;
  }

  /** Update the HUD text from the latest snapshot.  Call once per rAF. */
  update(snap: DebugSnapshot): void {
    if (!this.visible) return;

    const state = this.book.getState();
    const c = state.getCrease();
    const j = state.getStateIndex();
    const phi = state.getRotationAngle();
    const isTurning = state.getIsTurning();
    const isReverse = state.getIsReverseTurn();
    const turnProgress = state.getTurningProgress();
    const dp = snap.dragPointX !== null && snap.dragPointY !== null
      ? `(${fmt(snap.dragPointX)}, ${fmt(snap.dragPointY)})`
      : '—';
    const cam = snap.camera.position;
    const tgt = snap.controlsTarget;

    // Build a single string per tick (no DOM allocations beyond textContent).
    this.body.textContent =
`Drag
  isDragging   ${snap.isDragging}
  dragPoint    ${dp}
  dragProgress ${fmt(snap.dragProgress)}
  dragVelocity ${fmt(snap.dragVelocity)}

Crease
  alpha        ${fmt(c.alpha)} rad  (${rad2deg(c.alpha)} deg)
  originY      ${fmt(c.originOnEdge.y)}
  dihedral     ${fmt(c.dihedral)} rad  (${rad2deg(c.dihedral)} deg)
  creaseDir    (${fmt(c.creaseDir.x)}, ${fmt(c.creaseDir.y)})
  cornerDir    (${fmt(c.cornerDir.x)}, ${fmt(c.cornerDir.y)})

Turn state
  j            ${j}
  phi          ${fmt(phi)} rad  (${rad2deg(phi)} deg)
  progress     ${fmt(turnProgress)}
  isTurning    ${isTurning}
  isReverse    ${isReverse}
  settling     ${snap.settling}
  settleTarget ${snap.settleTarget}

Camera
  pos  (${fmt(cam.x)}, ${fmt(cam.y)}, ${fmt(cam.z)})
  tgt  (${fmt(tgt.x)}, ${fmt(tgt.y)}, ${fmt(tgt.z)})

FPS  ${Math.round(snap.fps)}`;
  }
}
