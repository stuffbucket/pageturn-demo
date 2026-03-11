/**
 * main.ts - Scene setup, renderer, animation loop
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import './style.css'
import { Book } from './book/Book';

// ── Physics settle constants ────────────────────────────────────────────────
const GRAVITY    = 5.0;  // progress units/s² — constant pull toward settle target
const DRAG_COEFF = 6.5;  // velocity damping (air resistance)

// Tilt the book so the top leans away from the viewer, giving the natural
// "book lying on a desk" perspective where the bottom edge is the near edge.
const BOOK_TILT = 0.76; // radians (~44°)

class PageTurnDemo {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private book: Book;
  private controls: OrbitControls;

  // ── Timed / button animation ──────────────────────────────────────────────
  private timedAnimating = false;
  private timedProgress  = 0;
  private timedDuration  = 1.2; // seconds
  private timedReverse   = false;

  // ── Drag animation ────────────────────────────────────────────────────────
  private dragging       = false;
  private dragProgress   = 0;   // [0,1] controlled by mouse
  private dragVelocity   = 0;   // rate of change per second — handed off to settle
  private dragReverse    = false;
  private settling       = false;
  private settleTarget   = 0;   // 0 (cancel) or 1 (complete)
  private settleVelocity = 0;
  private dragStartX     = 0;   // world X at drag start (projected onto XZ plane)
  private dragPageWidth  = 1.0;

  // Hit-test plane — matches the tilted book surface so drag X is accurate.
  private hitPlane = new THREE.Plane(
    new THREE.Vector3(0, Math.sin(BOOK_TILT), Math.cos(BOOK_TILT)).normalize(), 0
  );
  private raycaster = new THREE.Raycaster();
  private pointer   = new THREE.Vector2();

  private frameCount    = 0;
  private fps           = 0;
  private lastFpsUpdate = Date.now();

  constructor() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x2d2d44);

    const canvas = document.getElementById('canvas-container');
    if (!canvas) throw new Error('Canvas container not found');

    const width  = window.innerWidth;
    const height = window.innerHeight;

    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    // Face-on, slightly elevated — the book tilt provides all the perspective
    this.camera.position.set(0, 0.8, 3.4);
    this.camera.lookAt(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.shadowMap.enabled = true;
    canvas.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping  = true;
    this.controls.dampingFactor  = 0.08;
    this.controls.minDistance    = 1.5;
    this.controls.maxDistance    = 8;
    this.controls.target.set(0, 0, 0);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    this.scene.add(ambientLight);
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(5, 5, 8);
    dirLight.castShadow = true;
    this.scene.add(dirLight);

    this.book = new Book({
      numLeaves: 3,
      pageWidth: 1.0,
      pageHeight: 1.4,
      curlRadius: 0.15,
      textureSize: 512,
    });
    this.dragPageWidth = this.book.getPageWidth();
    this.scene.add(this.book.getGroup());
    // Tilt the book group so the top leans away — bottom becomes the near edge
    this.book.getGroup().rotation.x = -BOOK_TILT;

    this.setupEventHandlers();
    this.animate();
    window.addEventListener('resize', () => this.onWindowResize());
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /** Project pointer onto the book's XY plane; returns world X or null. */
  private pointerWorldX(clientX: number, clientY: number): number | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(
      ((clientX - rect.left)  / rect.width)  * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const target = new THREE.Vector3();
    const hit = this.raycaster.ray.intersectPlane(this.hitPlane, target);
    return hit ? target.x : null;
  }

  // ── Event handlers ─────────────────────────────────────────────────────────

  private setupEventHandlers(): void {
    const prevBtn = document.getElementById('prev-btn');
    const nextBtn = document.getElementById('next-btn');
    prevBtn?.addEventListener('click', () => this.turnNext(true));
    nextBtn?.addEventListener('click', () => this.turnNext(false));

    document.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft')  this.turnNext(true);
      if (e.key === 'ArrowRight') this.turnNext(false);
    });

    const el = this.renderer.domElement;
    // Capture phase so our handler runs before OrbitControls' bubble-phase
    // handler. When we grab a page we call stopImmediatePropagation() so
    // OrbitControls never sees the event and can't enter a conflicting drag state.
    el.addEventListener('pointerdown', (e) => this.onPointerDown(e), true);
    el.addEventListener('pointermove', (e) => this.onPointerMove(e));
    el.addEventListener('pointerup',   (e) => this.onPointerUp(e));
    el.addEventListener('pointercancel', () => this.onPointerCancel());
  }

  private onPointerDown(e: PointerEvent): void {
    if (this.timedAnimating || this.dragging || this.settling) return;

    const wx = this.pointerWorldX(e.clientX, e.clientY);
    if (wx === null) return;

    const hw = this.dragPageWidth;
    const state = this.book.getState();

    // Right half → forward turn; left half → reverse turn
    let started = false;
    if (wx >= 0 && wx <= hw && state.canTurnForward()) {
      started = this.book.startTurn();
      this.dragReverse = false;
    } else if (wx >= -hw && wx < 0 && state.canTurnBackward()) {
      started = this.book.startReverseTurn();
      this.dragReverse = true;
    }

    if (!started) return;

    e.stopImmediatePropagation(); // prevent OrbitControls from entering drag state
    this.dragging     = true;
    this.dragProgress = 0;
    this.dragVelocity = 0;
    this.dragStartX   = wx;
    this.controls.enabled = false;
    this.renderer.domElement.setPointerCapture(e.pointerId);
    this.renderer.domElement.style.cursor = 'grabbing';
  }

  private onPointerMove(e: PointerEvent): void {
    const wx = this.pointerWorldX(e.clientX, e.clientY);

    if (!this.dragging) {
      // Update hover cursor when nothing is animated
      if (wx !== null && !this.timedAnimating && !this.settling) {
        const hw    = this.dragPageWidth;
        const state = this.book.getState();
        const over  = (wx >= 0 && wx <= hw && state.canTurnForward()) ||
                      (wx >= -hw && wx < 0  && state.canTurnBackward());
        this.renderer.domElement.style.cursor = over ? 'grab' : 'default';
      }
      return;
    }

    if (wx === null) return;

    const delta = this.dragStartX - wx;
    const raw   = this.dragReverse
      ? (wx - this.dragStartX) / this.dragPageWidth
      : delta / this.dragPageWidth;

    const prev = this.dragProgress;
    this.dragProgress = Math.max(0, Math.min(1, raw));
    this.dragVelocity = (this.dragProgress - prev) * 60; // approximate per-second rate
    this.book.updateTurningPage(this.dragProgress);
    this.updateUI();
  }

  private onPointerUp(e: PointerEvent): void {
    if (!this.dragging) return;
    this.dragging = false;
    this.renderer.domElement.releasePointerCapture(e.pointerId);
    this.renderer.domElement.style.cursor = 'default';
    this.beginSettle(this.dragProgress >= 0.5 ? 1 : 0);
  }

  private onPointerCancel(): void {
    if (!this.dragging) return;
    this.dragging = false;
    this.renderer.domElement.style.cursor = 'default';
    this.beginSettle(0);
  }

  private beginSettle(target: number): void {
    this.settling       = true;
    this.settleTarget   = target;
    // Seed velocity with drag momentum, but always ensure at least a minimum
    // in the settle direction so the page never appears to stall from rest
    // at the midpoint (where the bend envelope is also zero).
    const dir    = target >= 1 ? 1 : -1;
    const minVel = 0.8;
    this.settleVelocity = (dir * this.dragVelocity > 0)
      ? Math.max(Math.abs(this.dragVelocity), minVel) * dir
      : minVel * dir;
  }

  // ── Timed button/keyboard turn ─────────────────────────────────────────────

  private turnNext(reverse: boolean): void {
    if (this.timedAnimating || this.dragging || this.settling) return;
    const state = this.book.getState();
    const started = reverse
      ? (state.canTurnBackward()  && this.book.startReverseTurn())
      : (state.canTurnForward()   && this.book.startTurn());
    if (!started) return;

    this.timedAnimating = true;
    this.timedProgress  = 0;
    this.timedReverse   = reverse;
  }

  // ── UI ─────────────────────────────────────────────────────────────────────

  private updateUI(): void {
    const state   = this.book.getState();
    const busy    = this.timedAnimating || this.dragging || this.settling;

    const stateDisplay  = document.getElementById('state-display');
    const currentPageEl = document.getElementById('current-page');
    const fpsEl         = document.getElementById('fps');
    const prevBtn = document.getElementById('prev-btn') as HTMLButtonElement | null;
    const nextBtn = document.getElementById('next-btn') as HTMLButtonElement | null;

    if (stateDisplay)  stateDisplay.textContent  = `State: ${state.getStateDescription()}`;
    if (currentPageEl) currentPageEl.textContent = `${state.getStateIndex()} / ${state.getTotalStates() - 1}`;
    if (fpsEl)         fpsEl.textContent          = Math.round(this.fps).toString();
    if (prevBtn) prevBtn.disabled = !state.canTurnBackward() || busy;
    if (nextBtn) nextBtn.disabled = !state.canTurnForward()  || busy;
  }

  // ── Animation loop ─────────────────────────────────────────────────────────

  private animate = (): void => {
    requestAnimationFrame(this.animate);

    const dt = 1 / 60; // fixed timestep approximation

    // Timed animation (buttons / keyboard)
    if (this.timedAnimating) {
      this.timedProgress += dt / this.timedDuration;
      if (this.timedProgress >= 1.0) {
        this.timedProgress = 1.0;
        this.book.updateTurningPage(1.0);
        this.book.completeTurn();
        this.timedAnimating = false;
        this.controls.enabled = true;
        this.updateUI();
      } else {
        this.book.updateTurningPage(this.timedProgress);
      }
    }

    // Physics settle — gravity (constant acceleration toward target) + air resistance
    if (this.settling) {
      const dir = this.settleTarget >= 1 ? 1 : -1;
      this.settleVelocity += dir * GRAVITY * dt;
      this.settleVelocity *= Math.max(0, 1 - DRAG_COEFF * dt);
      this.dragProgress    = Math.max(0, Math.min(1, this.dragProgress + this.settleVelocity * dt));

      this.book.updateTurningPage(this.dragProgress);

      const done = (this.settleTarget >= 1 && this.dragProgress >= 1 - 0.001) ||
                   (this.settleTarget <= 0 && this.dragProgress <= 0.001);
      if (done) {
        this.dragProgress = this.settleTarget;
        this.settling     = false;
        this.controls.enabled = true;
        if (this.settleTarget >= 1) {
          this.book.completeTurn();
        } else {
          this.book.cancelTurn();
        }
        this.updateUI();
      }
    }

    // FPS counter
    this.frameCount++;
    const now = Date.now();
    if (now - this.lastFpsUpdate >= 1000) {
      this.fps = (this.frameCount * 1000) / (now - this.lastFpsUpdate);
      this.frameCount   = 0;
      this.lastFpsUpdate = now;
      this.updateUI();
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  private onWindowResize(): void {
    const width  = window.innerWidth;
    const height = window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new PageTurnDemo();
});
