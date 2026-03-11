/**
 * main.ts - Scene setup, renderer, animation loop
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import './style.css'
import { Book } from './book/Book';
import { getVimeoVideo } from './textures/atlas';

// ── Physics settle constants ────────────────────────────────────────────────
const GRAVITY    = 5.0;  // progress units/s² — constant pull toward settle target
const DRAG_COEFF = 6.5;  // velocity damping (air resistance)

// Tilt the book so the top leans away from the viewer, giving the natural
// "book lying on a desk" perspective where the bottom edge is the near edge.
const BOOK_TILT = 0.76; // radians (~44°)

// Spread index where the Vimeo video plays (j=4 → p8/p9).
const VIDEO_SPREAD = 4;

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

  constructor() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x12111f);

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
      numLeaves: 6,
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
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        this.turnNext(e.key === 'ArrowLeft');
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

  private onPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;  // primary button only
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

    this.fadeOutCredit();
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
    this.controls.enabled = true;
    this.renderer.domElement.releasePointerCapture(e.pointerId);
    this.renderer.domElement.style.cursor = 'default';
    this.beginSettle(this.dragProgress >= 0.5 ? 1 : 0);
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
    if (this.timedAnimating || this.dragging || this.settling) return;
    const state = this.book.getState();
    const started = reverse
      ? (state.canTurnBackward()  && this.book.startReverseTurn())
      : (state.canTurnForward()   && this.book.startTurn());
    if (!started) return;

    this.fadeOutCredit();
    this.timedAnimating = true;
    this.timedProgress  = 0;
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
        this.checkVideoSpread();
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
        this.checkVideoSpread();
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

    // Camera animation for video spread
    this.updateCameraAnimation(dt);

    if (this.cameraMode === 'idle') {
      this.controls.update();
    }

    this.book.update(dt);
    this.renderer.render(this.scene, this.camera);
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
    const ph = this.book.getPageHeight();
    const aspect = this.camera.aspect;
    const halfFov = THREE.MathUtils.degToRad(this.camera.fov / 2);

    // Distance so the spread fits vertically or horizontally (whichever is tighter).
    const distV = (ph / 2) / Math.tan(halfFov);
    const distH = pw / (Math.tan(halfFov) * aspect); // half-spread width = pw
    const dist = Math.max(distV, distH) * 1.05; // 5% margin

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
  new PageTurnDemo();
});
