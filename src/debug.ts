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

export class DebugHud {
  private el: HTMLDivElement;
  private body: HTMLDivElement;
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
      pointerEvents: 'none',
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

    const body = document.createElement('div');
    el.appendChild(title);
    el.appendChild(body);
    document.body.appendChild(el);

    this.el = el;
    this.body = body;
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
