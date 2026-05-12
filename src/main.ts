/**
 * main.ts - Scene setup, renderer, animation loop
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import './style.css'
import { Book } from './book/Book';
import { getVimeoVideo, fiducialsEnabled } from "./textures/atlas";
import { emit as emitTelemetry, installErrorReporting } from "./telemetry";
import { DebugHud, debugEnabled } from "./debug";

// ── Physics settle constants ────────────────────────────────────────────────
const GRAVITY    = 5.0;  // progress units/s² — constant pull toward settle target
const DRAG_COEFF = 6.5;  // velocity damping (air resistance)

// Energy-based stop condition:  E = ½v² + G·|p − target| < ε
// This replaces the old magic-epsilon position check.  The energy formulation
// correctly detects convergence even when position is close but velocity is
// nonzero, and vice-versa.
const SETTLE_ENERGY_EPS = 0.005;

// Maximum dt clamp — prevents physics explosions after tab-switch or GC pause.
const MAX_DT = 1 / 20;  // 50 ms

// Tilt the book so the top leans away from the viewer, giving the natural
// "book lying on a desk" perspective where the bottom edge is the near edge.
const BOOK_TILT = 0.76; // radians (~44°)

// Spread index where the Vimeo video plays (j=4 → p8/p9).
const VIDEO_SPREAD = 7;

class PageTurnDemo {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  public book!: Book;
  private controls: OrbitControls;

  // ── Timed / button animation ──────────────────────────────────────────────
  private timedAnimating = false;
  private timedProgress  = 0;
  private timedDuration  = 1.2; // seconds

  // ── Drag animation ────────────────────────────────────────────────────────
  private dragging       = false;
  private dragProgress   = 0;   // [0,1] controlled by mouse
  private dragVelocity   = 0;   // rate of change per second — handed off to settle
  private dragReverse    = false;
  private settling       = false;
  private settleTarget   = 0;   // 0 (cancel) or 1 (complete)
  private settleVelocity = 0;
  private dragStartX     = 0;   // world X at drag start (projected onto XZ plane)
  private dragStartY     = 0;   // page-local Y at drag start (for tilted-crease drag)
  private dragPageWidth  = 1.0;
  private dragPointerId  = -1;   // pointer ID for releasing capture on cancel
  private lastDragTime   = 0;   // timestamp of last pointermove (for velocity)

  // Hit-test plane — matches the tilted book surface so drag X is accurate.
  private hitPlane = new THREE.Plane(
    new THREE.Vector3(0, Math.sin(BOOK_TILT), Math.cos(BOOK_TILT)).normalize(), 0
  );
  private raycaster = new THREE.Raycaster();
  private pointer   = new THREE.Vector2();
  // Scratch vector reused by pointerWorldXY to avoid per-move allocations.
  private _hitVec   = new THREE.Vector3();

  private frameCount    = 0;
  private fps           = 0;
  private lastFpsUpdate = Date.now();
  private prevTimestamp = 0; // previous rAF timestamp for real dt

  // ── Fan turn (shift + arrow) ──────────────────────────────────────────────
  private fanAnimating    = false;
  private fanProgress     = 0;
  private fanDuration     = 1.4; // slightly longer for multi-page

  // ── Vimeo video (rendered into page textures via atlas.ts) ──────────────
  private vimeoVideo: HTMLVideoElement | null = null;
  private vimeoVisible = false;
  private vimeoFirstPlay = true;
  private videoCreditEl: HTMLAnchorElement;
  private videoCreditTimer: ReturnType<typeof setTimeout> | null = null;

  // ── Camera animation (synced with video playback) ─────────────────────
  private cameraMode: 'idle' | 'video-driven' | 'returning' = 'idle';
  private cameraOrigPos = new THREE.Vector3();
  private cameraOrigTarget = new THREE.Vector3();
  private cameraFillPos = new THREE.Vector3();
  private cameraFillTarget = new THREE.Vector3();
  private cameraReturnStart = new THREE.Vector3();
  private cameraReturnTargetStart = new THREE.Vector3();
  private cameraReturnProgress = 0;

  // ── Debug HUD ──────────────────────────────────────────────────────────────
  private debugHud: DebugHud | null = null;
  private debugScratchTarget = new THREE.Vector3();

  constructor() {
    // Telemetry boot hook — installs error listeners and emits a boot event
    // when the page is loaded with `?telemetry=1`.  No-op otherwise.  Kept as
    // a single inline block so the surrounding constructor logic is untouched.
    installErrorReporting();
    emitTelemetry('boot', {
      commit: (import.meta as unknown as { env?: { VITE_COMMIT?: string } }).env?.VITE_COMMIT ?? 'dev',
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      viewport: { w: window.innerWidth, h: window.innerHeight },
    });

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x12111f);

    const canvas = document.getElementById('canvas-container');
    if (!canvas) throw new Error('Canvas container not found');

    const width  = window.innerWidth;
    const height = window.innerHeight;

    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    // Face-on, slightly elevated — the book tilt provides all the perspective
    this.camera.position.set(0, 0.6, 2.6);
    this.camera.lookAt(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.shadowMap.enabled = true;
    this.renderer.localClippingEnabled = true;
    canvas.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping  = true;
    this.controls.dampingFactor  = 0.08;
    this.controls.minDistance    = 1.5;
    this.controls.maxDistance    = 8;
    // Constrain polar angle so the camera stays between ~11° from directly
    // overhead and just past the horizon (≈5° below).  The book tilts at
    // BOOK_TILT ≈ 44°, so 1.65 rad lets the user look almost edge-on
    // without going underneath the desk surface.
    this.controls.minPolarAngle  = 0.2;
    this.controls.maxPolarAngle  = 1.65;
    this.controls.target.set(0, 0, 0);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    this.scene.add(ambientLight);
    const dirLight = new THREE.DirectionalLight(0xfff5e6, 0.9);
    dirLight.position.set(5, 5, 8);
    dirLight.castShadow = true;
    this.scene.add(dirLight);

    // Dark desk surface beneath the book
    const deskGeo = new THREE.PlaneGeometry(20, 20);
    const deskMat = new THREE.MeshStandardMaterial({
      color: 0x1a1820, roughness: 0.75, metalness: 0.1,
    });
    const desk = new THREE.Mesh(deskGeo, deskMat);
    desk.rotation.x = -Math.PI / 2;
    desk.position.y = -0.55;
    desk.receiveShadow = true;
    this.scene.add(desk);

    this.book = new Book({
      numLeaves: 10,
      pageWidth: 1.0,
      pageHeight: 1.4,
      curlRadius: 0.15,
      textureSize: 1024,
    });
    this.dragPageWidth = this.book.getPageWidth();
    this.scene.add(this.book.getGroup());
    // Tilt the book group so the top leans away — bottom becomes the near edge
    this.book.getGroup().rotation.x = -BOOK_TILT;

    // Vimeo video element: created by atlas.ts, available after Book construction.
    this.vimeoVideo = getVimeoVideo();

    // Credit link — hidden by default, fades in after 3 s on video spread.
    this.videoCreditEl = document.createElement('a');
    this.videoCreditEl.id = 'video-credit';
    this.videoCreditEl.href = 'https://myshli.com/project/freight-rail';
    this.videoCreditEl.target = '_blank';
    this.videoCreditEl.rel = 'noopener noreferrer';
    this.videoCreditEl.textContent = 'myshli.com/project/freight-rail';
    canvas.appendChild(this.videoCreditEl);

    this.setupEventHandlers();
    this.setupDebugUI();
    this.prevTimestamp = performance.now();
    this.animate();
    window.addEventListener('resize', () => this.onWindowResize());
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /**
   * Project pointer onto the tilted book surface and return the result in
   * the book group's local (un-tilted) page-plane coords: x along the spine-
   * to-edge axis, y along the spine.  Null if the ray misses the plane.
   */
  private pointerPageLocal(clientX: number, clientY: number): { x: number; y: number } | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(
      ((clientX - rect.left)  / rect.width)  * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.ray.intersectPlane(this.hitPlane, this._hitVec);
    if (!hit) return null;
    // Book group rotation is -BOOK_TILT around X.  For a point on the tilted
    // page plane (local z = 0), local.y = world.y / cos(BOOK_TILT).
    const cosT = Math.cos(BOOK_TILT);
    return { x: this._hitVec.x, y: this._hitVec.y / cosT };
  }

  // ── Event handlers ─────────────────────────────────────────────────────────

  private setupEventHandlers(): void {
    const prevBtn = document.getElementById('prev-btn');
    const nextBtn = document.getElementById('next-btn');
    prevBtn?.addEventListener('click', () => this.turnNext(true));
    nextBtn?.addEventListener('click', () => this.turnNext(false));

    document.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        if (e.shiftKey) {
          this.fanTurnNext(e.key === 'ArrowLeft');
        } else {
          this.turnNext(e.key === 'ArrowLeft');
        }
      } else if (e.key === 'Escape') {
        this.cancelCurrentAnimation();
      } else if (e.key === 'h' || e.key === 'H') {
        document.getElementById('ui-overlay')?.classList.toggle('visible');
      }
    });

    const el = this.renderer.domElement;
    // Capture phase so our handler runs before OrbitControls' bubble-phase
    // handler. When we grab a page we call stopImmediatePropagation() so
    // OrbitControls never sees the event and can't enter a conflicting drag state.
    el.addEventListener('pointerdown', (e) => this.onPointerDown(e), true);
    el.addEventListener('pointermove', (e) => this.onPointerMove(e));
    el.addEventListener('pointerup',   (e) => this.onPointerUp(e));
    el.addEventListener('pointercancel', () => this.onPointerCancel());
    el.addEventListener('lostpointercapture', () => this.onLostCapture());
  }

  // ── Debug HUD + help-menu toggles ─────────────────────────────────────────
  private setupDebugUI(): void {
    const initialDebug = debugEnabled();
    this.debugHud = new DebugHud(this.book, initialDebug);

    const hudCheckbox = document.getElementById('toggle-debug-hud') as HTMLInputElement | null;
    const fidCheckbox = document.getElementById('toggle-fiducials') as HTMLInputElement | null;
    if (hudCheckbox) {
      hudCheckbox.checked = initialDebug;
      hudCheckbox.addEventListener('change', () => {
        this.debugHud?.setVisible(hudCheckbox.checked);
      });
    }
    if (fidCheckbox) {
      fidCheckbox.checked = fiducialsEnabled();
      fidCheckbox.addEventListener('change', () => {
        // Fiducials are baked into page textures at generateBookTextures()
        // time, so toggling at runtime requires regenerating ~24 canvas
        // textures or maintaining a parallel overlay-mesh hierarchy. To keep
        // this PR scoped (no edits to atlas.ts or Book.ts texture plumbing),
        // we update the URL flag and reload — the user gets a clean restart
        // with the new fiducials setting in <300 ms on dev server.
        const params = new URLSearchParams(location.search);
        if (fidCheckbox.checked) params.set('fiducials', '1');
        else params.delete('fiducials');
        const qs = params.toString();
        location.search = qs ? `?${qs}` : '';
      });
    }
  }

  private onPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;  // primary button only
    if (this.timedAnimating || this.dragging || this.settling || this.fanAnimating) return;

    const wp = this.pointerPageLocal(e.clientX, e.clientY);
    if (wp === null) return;
    const wx = wp.x;

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

    this.fadeOutCredit();
    e.stopImmediatePropagation(); // prevent OrbitControls from entering drag state
    this.dragging     = true;
    this.dragProgress = 0;
    this.dragVelocity = 0;
    this.dragStartX   = wx;
    this.dragStartY   = wp.y;
    this.dragPointerId = e.pointerId;
    this.lastDragTime = performance.now();
    this.controls.enabled = false;
    this.renderer.domElement.setPointerCapture(e.pointerId);
    this.renderer.domElement.style.cursor = 'grabbing';
    emitTelemetry('drag-start', {
      dragPoint: { x: wx, y: wp.y },
      dragProgress: 0,
      dragVelocity: 0,
      reverse: this.dragReverse,
      j: this.book.getState().getStateIndex(),
    });
  }

  private onPointerMove(e: PointerEvent): void {
    const wp = this.pointerPageLocal(e.clientX, e.clientY);

    if (!this.dragging) {
      // Update hover cursor when nothing is animated
      if (wp !== null && !this.timedAnimating && !this.settling) {
        const hw    = this.dragPageWidth;
        const state = this.book.getState();
        const over  = (wp.x >= 0 && wp.x <= hw && state.canTurnForward()) ||
                      (wp.x >= -hw && wp.x < 0  && state.canTurnBackward());
        this.renderer.domElement.style.cursor = over ? 'grab' : 'default';
      }
      return;
    }

    if (wp === null) return;

    // Tilted-crease drag: track the actual 2D pointer offset and translate it
    // into a page-local drag point.  The conceptual corner being grabbed is
    // (+W, H/2) for forward and (−W, H/2) for reverse — this maps "no motion"
    // to the correct starting dihedral (0 for forward, π for reverse).
    const W = this.dragPageWidth;
    const dx = wp.x - this.dragStartX;
    const dy = wp.y - this.dragStartY;
    const cornerX = this.dragReverse ? -W : W;
    const dragPx = cornerX + dx;
    const dragPy = (this.book.getPageHeight() / 2) + dy;

    this.book.updateTurningDrag(dragPx, dragPy);

    // Velocity for flick detection — derived from progress (phi/π) deltas.
    const prev = this.dragProgress;
    this.dragProgress = this.book.getState().getTurningProgress();
    const now = performance.now();
    const elapsed = (now - this.lastDragTime) / 1000;
    this.lastDragTime = now;
    this.dragVelocity = elapsed > 0.001 ? (this.dragProgress - prev) / elapsed : 0;

    // Telemetry: rate-limited to ~10Hz inside emit() for the 'pointer-move'
    // type, so this is safe to call on every move event.
    const crease = this.book.getState().getCrease();
    emitTelemetry('pointer-move', {
      dragPoint: { x: dragPx, y: dragPy },
      crease: { alpha: crease.alpha, originY: crease.originOnEdge.y, dihedral: crease.dihedral },
      dragProgress: this.dragProgress,
    });

    this.updateUI();
  }

  private onPointerUp(e: PointerEvent): void {
    if (!this.dragging) return;
    this.dragging = false;
    this.controls.enabled = true;
    this.renderer.domElement.releasePointerCapture(e.pointerId);
    this.renderer.domElement.style.cursor = 'default';
    emitTelemetry('drag-end', {
      dragProgress: this.dragProgress,
      dragVelocity: this.dragVelocity,
      reverse: this.dragReverse,
    });
    // Flick detection: if velocity is fast enough, complete/cancel regardless
    // of position.  This gives responsive touch behavior on mobile.
    const FLICK_THRESHOLD = 1.5; // progress units / second
    if (Math.abs(this.dragVelocity) > FLICK_THRESHOLD) {
      this.beginSettle(this.dragVelocity > 0 ? 1 : 0);
    } else {
      this.beginSettle(this.dragProgress >= 0.5 ? 1 : 0);
    }
  }

  private onPointerCancel(): void {
    if (!this.dragging) return;
    this.dragging = false;
    this.controls.enabled = true;
    this.renderer.domElement.style.cursor = 'default';
    this.beginSettle(0);
  }

  /** Safety net: if pointer capture is lost unexpectedly, restore controls. */
  private onLostCapture(): void {
    if (!this.dragging) return;
    this.dragging = false;
    this.controls.enabled = true;
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
    if (this.timedAnimating || this.dragging || this.settling || this.fanAnimating) return;
    const state = this.book.getState();
    const started = reverse
      ? (state.canTurnBackward()  && this.book.startReverseTurn())
      : (state.canTurnForward()   && this.book.startTurn());
    if (!started) return;

    this.fadeOutCredit();
    this.timedAnimating = true;
    this.timedProgress  = 0;
  }

  // ── Fan turn (shift + arrow) ───────────────────────────────────────────────

  private fanTurnNext(reverse: boolean): void {
    if (this.timedAnimating || this.dragging || this.settling || this.fanAnimating) return;
    const count = this.book.getMaxFanCount(reverse);
    if (count < 1) return;
    const started = this.book.startFanTurn(count, reverse);
    if (!started) return;

    this.fadeOutCredit();
    this.fanAnimating = true;
    this.fanProgress  = 0;
  }

  // ── Cancel ─────────────────────────────────────────────────────────────────

  /** Cancel any in-progress animation (timed turn, fan turn, settle, or drag). */
  private cancelCurrentAnimation(): void {
    if (this.dragging) {
      this.dragging = false;
      this.book.cancelTurn();
      this.controls.enabled = true;
      try { this.renderer.domElement.releasePointerCapture(this.dragPointerId); } catch (_) { /* already released */ }
      this.renderer.domElement.style.cursor = 'default';
      this.updateUI();
    } else if (this.fanAnimating) {
      this.book.cancelFanTurn();
      this.fanAnimating = false;
      this.controls.enabled = true;
      this.updateUI();
    } else if (this.timedAnimating) {
      this.book.cancelTurn();
      this.timedAnimating = false;
      this.controls.enabled = true;
      this.updateUI();
    } else if (this.settling) {
      this.settling = false;
      this.book.cancelTurn();
      this.controls.enabled = true;
      this.renderer.domElement.style.cursor = 'default';
      this.updateUI();
    }
  }

  // ── Accessibility ───────────────────────────────────────────────────────────

  /** Push a page-change announcement into the live region for screen readers. */
  private announcePageChange(): void {
    const liveRegion = document.getElementById('sr-announcer');
    if (!liveRegion) return;
    const desc = this.book.getState().getStateDescription();
    liveRegion.textContent = desc;
  }

  // ── UI ─────────────────────────────────────────────────────────────────────

  private updateUI(): void {
    const state   = this.book.getState();
    const busy    = this.timedAnimating || this.dragging || this.settling || this.fanAnimating;

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

    // Real elapsed time with clamp to avoid physics explosions after tab-switch
    const now = performance.now();
    const dt = Math.min((now - this.prevTimestamp) / 1000, MAX_DT);
    this.prevTimestamp = now;

    // Timed animation (buttons / keyboard)
    if (this.timedAnimating) {
      this.timedProgress += dt / this.timedDuration;
      if (this.timedProgress >= 1.0) {
        this.timedProgress = 1.0;
        this.book.updateTurningPage(1.0);
        this.book.completeTurn();
        this.timedAnimating = false;
        this.controls.enabled = true;
        this.checkVideoSpread();
        this.announcePageChange();
        this.updateUI();
      } else {
        this.book.updateTurningPage(this.timedProgress);
      }
    }

    // Fan animation (shift + arrow: multiple pages turning with stagger)
    if (this.fanAnimating) {
      this.fanProgress += dt / this.fanDuration;
      if (this.fanProgress >= 1.0) {
        this.fanProgress = 1.0;
        this.book.updateFanTurn(1.0);
        this.book.completeFanTurn();
        this.fanAnimating = false;
        this.controls.enabled = true;
        this.checkVideoSpread();
        this.announcePageChange();
        this.updateUI();
      } else {
        this.book.updateFanTurn(this.fanProgress);
      }
    }

    // Physics settle — gravity + air resistance, energy-based stop condition
    if (this.settling) {
      const dir = this.settleTarget >= 1 ? 1 : -1;
      this.settleVelocity += dir * GRAVITY * dt;
      this.settleVelocity *= Math.max(0, 1 - DRAG_COEFF * dt);
      const rawP = this.dragProgress + this.settleVelocity * dt;
      this.dragProgress = Math.max(0, Math.min(1, rawP));
      // Inelastic wall: zero velocity when p clamps at [0,1] boundary,
      // otherwise gravity keeps pumping energy into a pinned page.
      if (rawP !== this.dragProgress) this.settleVelocity = 0;

      this.book.updateTurningPage(this.dragProgress);

      // Energy-based stop: E = ½v² + G·|p − target|
      // This correctly detects convergence regardless of whether position
      // or velocity is the dominant residual.
      const energy = 0.5 * this.settleVelocity * this.settleVelocity
                   + GRAVITY * Math.abs(this.dragProgress - this.settleTarget);
      if (energy < SETTLE_ENERGY_EPS) {
        this.dragProgress = this.settleTarget;
        this.book.updateTurningPage(this.dragProgress);
        this.settling     = false;
        this.controls.enabled = true;
        if (this.settleTarget >= 1) {
          this.book.completeTurn();
        } else {
          this.book.cancelTurn();
        }
        this.checkVideoSpread();
        this.announcePageChange();
        this.updateUI();
      }
    }

    // FPS counter
    this.frameCount++;
    const fpsNow = Date.now();
    if (fpsNow - this.lastFpsUpdate >= 1000) {
      this.fps = (this.frameCount * 1000) / (fpsNow - this.lastFpsUpdate);
      this.frameCount   = 0;
      this.lastFpsUpdate = fpsNow;
      this.updateUI();
      emitTelemetry('fps-sample', { fps: Math.round(this.fps * 10) / 10 });
    }

    // Camera animation for video spread
    this.updateCameraAnimation(dt);

    if (this.cameraMode === 'idle') {
      this.controls.update();
    }

    this.book.update(dt);
    this.renderer.render(this.scene, this.camera);

    // Debug HUD — update once per rAF, no-op when hidden.
    if (this.debugHud && this.debugHud.isVisible()) {
      const dp = this.book.getState().getDragPoint();
      this.debugHud.update({
        isDragging: this.dragging,
        dragPointX: dp ? dp.x : null,
        dragPointY: dp ? dp.y : null,
        dragProgress: this.dragProgress,
        dragVelocity: this.dragVelocity,
        settling: this.settling,
        settleTarget: this.settleTarget,
        fps: this.fps,
        camera: this.camera,
        controlsTarget: this.debugScratchTarget.copy(this.controls.target),
      });
    }
  };

  // ── Vimeo video overlay ─────────────────────────────────────────────────────

  /** Show or hide the Vimeo overlay based on current spread. */
  private checkVideoSpread(): void {
    const j = this.book.getState().getStateIndex();
    if (j === VIDEO_SPREAD && !this.book.getState().getIsTurning()) {
      this.showVimeo();
      // Re-schedule the credit fade-in after the page settles.
      this.fadeOutCredit();
      this.videoCreditTimer = setTimeout(() => {
        if (this.vimeoVisible) this.videoCreditEl.style.opacity = '1';
      }, 3000);
    } else if (this.vimeoVisible && j !== VIDEO_SPREAD) {
      this.hideVimeo();
    }
  }

  /** Cancel any pending credit fade-in and hide it immediately. */
  private fadeOutCredit(): void {
    if (this.videoCreditTimer) { clearTimeout(this.videoCreditTimer); this.videoCreditTimer = null; }
    this.videoCreditEl.style.opacity = '0';
  }

  private showVimeo(): void {
    if (this.vimeoVisible || !this.vimeoVideo) return;
    this.vimeoVisible = true;

    // Store the current camera pose so we can return to it.
    this.cameraOrigPos.copy(this.camera.position);
    this.cameraOrigTarget.copy(this.controls.target);
    this.computeCameraFillPosition();
    this.cameraMode = 'video-driven';
    this.controls.enabled = false;

    // Fade in credit link after a 3 s delay.
    if (this.videoCreditTimer) clearTimeout(this.videoCreditTimer);
    this.videoCreditTimer = setTimeout(() => {
      if (this.vimeoVisible) this.videoCreditEl.style.opacity = '1';
    }, 3000);

    const video = this.vimeoVideo;
    video.currentTime = 0;
    if (this.vimeoFirstPlay) {
      this.vimeoFirstPlay = false;
      video.muted = false;
      video.volume = 1;
    } else {
      video.muted = true;
    }
    video.addEventListener('ended', this.onVideoEnded);
    video.play().catch(() => {
      // Autoplay with sound blocked — retry muted.
      video.muted = true;
      video.play().catch(() => {});
    });
  }

  private hideVimeo(): void {
    if (!this.vimeoVisible) return;
    this.vimeoVisible = false;

    if (this.vimeoVideo) {
      this.vimeoVideo.pause();
      this.vimeoVideo.muted = true;
      this.vimeoVideo.removeEventListener('ended', this.onVideoEnded);
    }

    this.fadeOutCredit();

    // Begin a quick camera return if mid-animation.
    if (this.cameraMode !== 'idle') {
      this.cameraReturnStart.copy(this.camera.position);
      this.cameraReturnTargetStart.copy(this.controls.target);
      this.cameraReturnProgress = 0;
      this.cameraMode = 'returning';
    }
  }

  /** Video finished naturally — snap camera home. */
  private onVideoEnded = () => {
    if (this.cameraMode === 'video-driven') {
      this.camera.position.copy(this.cameraOrigPos);
      this.controls.target.copy(this.cameraOrigTarget);
      this.camera.lookAt(this.controls.target);
      this.cameraMode = 'idle';
      this.controls.enabled = true;
    }
    if (this.vimeoVideo) {
      this.vimeoVideo.removeEventListener('ended', this.onVideoEnded);
    }
  };

  /** Compute the camera position that fills the viewport with the spread. */
  private computeCameraFillPosition(): void {
    const pw = this.book.getPageWidth();
    const aspect = this.camera.aspect;
    const halfFov = THREE.MathUtils.degToRad(this.camera.fov / 2);

    // Distance so the video content fills the viewport in at least one direction.
    // Video is 16:9 across a spread of 2×pw wide, so its world-space height is
    // 2*pw * (9/16) = pw * 9/8 — significantly shorter than the full page height.
    const videoH = pw * 9 / 8;   // world-space height of 16:9 content on spread
    const distV = (videoH / 2) / Math.tan(halfFov);
    const distH = pw / (Math.tan(halfFov) * aspect); // half-spread width = pw
    const dist = Math.max(distV, distH);

    const group = this.book.getGroup();
    group.updateMatrixWorld(true);

    // Spread center in world space.
    this.cameraFillTarget.set(0, 0, 0).applyMatrix4(group.matrixWorld);

    // Normal of the spread surface in world space.
    const normal = new THREE.Vector3(0, 0, 1);
    normal.transformDirection(group.matrixWorld);

    this.cameraFillPos.copy(this.cameraFillTarget).addScaledVector(normal, dist);
  }

  /** Drives camera position each frame based on video elapsed time. */
  private updateCameraAnimation(dt: number): void {
    if (this.cameraMode === 'video-driven') {
      const video = this.vimeoVideo;
      if (!video) return;
      const elapsed = video.currentTime;
      const dur = (video.duration && isFinite(video.duration)) ? video.duration : 30;
      let factor: number;

      if (elapsed <= 3) {
        // Ease-out cubic into the fill position over 0–3 s.
        const p = Math.min(1, elapsed / 3);
        factor = 1 - Math.pow(1 - p, 3);
      } else if (dur <= 22 || elapsed < 22) {
        factor = 1;
      } else {
        // Ease-in-out cubic back to the original position from 22 s to end.
        const p = Math.min(1, (elapsed - 22) / (dur - 22));
        const ease = p < 0.5
          ? 4 * p * p * p
          : 1 - Math.pow(-2 * p + 2, 3) / 2;
        factor = 1 - ease;
      }

      this.camera.position.lerpVectors(this.cameraOrigPos, this.cameraFillPos, factor);
      this.controls.target.lerpVectors(this.cameraOrigTarget, this.cameraFillTarget, factor);
      this.camera.lookAt(this.controls.target);
    } else if (this.cameraMode === 'returning') {
      this.cameraReturnProgress += dt / 0.5; // 0.5 s return
      if (this.cameraReturnProgress >= 1) {
        this.camera.position.copy(this.cameraOrigPos);
        this.controls.target.copy(this.cameraOrigTarget);
        this.cameraMode = 'idle';
        if (!this.dragging && !this.settling && !this.timedAnimating) {
          this.controls.enabled = true;
        }
      } else {
        const e = 1 - Math.pow(1 - this.cameraReturnProgress, 3); // ease-out cubic
        this.camera.position.lerpVectors(this.cameraReturnStart, this.cameraOrigPos, e);
        this.controls.target.lerpVectors(this.cameraReturnTargetStart, this.cameraOrigTarget, e);
      }
      this.camera.lookAt(this.controls.target);
    }
  }

  private onWindowResize(): void {
    const width  = window.innerWidth;
    const height = window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    if (this.cameraMode === 'video-driven') this.computeCameraFillPosition();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const demo = new PageTurnDemo();
  // Expose the book for the harness (trajectory capture mode). Always
  // attached — guarded behind a non-typical property name to avoid clashing
  // with user-page scripts.
  (window as unknown as { __pageturn?: { book: Book } }).__pageturn = {
    book: (demo as unknown as { book: Book }).book,
  };
});
