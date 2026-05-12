/**
 * Book.ts - Book orchestrator
 *
 * Maintains two static spread meshes (leftMesh, rightMesh) that always reflect
 * the current resting state.  During an animation a third turningPageMesh is
 * spawned, rotated around the spine (Y-axis), and destroyed when the flip
 * completes.  syncDisplay() updates the two spread meshes from BookState after
 * every transition.
 */

import * as THREE from 'three';
import { BookState, DEFAULT_BOOK_MATERIAL, maxFanCount } from './BookState';
import type { BookMaterial } from './BookState';
import { generateBookTextures, TexturePool } from '../textures/atlas';

export interface BookParams {
  numLeaves: number;
  pageWidth?: number;
  pageHeight?: number;
  curlRadius?: number;   // kept for API compat, unused in flat-flip mode
  textureSize?: number;
  material?: BookMaterial;
}

// Vertex shader: per-vertex Y-rotation with gravity-based free-edge lag.
//
// phi(t) = phi_spine + bendAmount * t * sin(-2 * phi_spine)
//
// sin(-2*phi) provides the correct signed envelope for the full arc:
//   phi in (0,  -π/2): sin > 0 → vertex angle less negative → edge lags behind spine
//   phi = -π/2:        sin = 0 → no correction, page straight while vertical
//   phi in (-π/2, -π): sin < 0 → vertex angle more negative → edge leads (falls ahead)
// This is the same formula for both forward and reverse turns.
const FLIP_VERT = /* glsl */`
  uniform float uAngle;      // spine angle: 0 → -π (forward) or -π → 0 (reverse)
  uniform float uBendAmount;
  uniform float uPageWidth;
  varying vec2 vUv;

  void main() {
    vUv = uv;
    vec3 pos = position;

    float t = pos.x / uPageWidth;  // 0 at spine, 1 at free edge

    // Center-of-gravity bending: edge sags toward nearest surface.
    //
    // sin(2*phi) flips sign at phi=-PI/2 (90 deg):
    //   Lift (0 to -PI/2): negative correction → edge leads → sags toward right  (
    //   Fall (-PI/2 to -PI): positive correction → edge lags → sags toward left  )
    // Together: ( ) shape throughout the turn.
    //
    // bendAmount must be < 0.5 so the edge velocity never reverses:
    //   d(phi_edge)/d(phi_spine) = 1 + 2*A*cos(2*phi) >= 1 - 2*A > 0
    //   With A=0.4: minimum velocity = 0.2 > 0. No stall, no wag.
    float phi = uAngle + uBendAmount * t * sin(2.0 * uAngle);

    float origX = pos.x;
    pos.x =  origX * cos(phi);
    pos.z = -origX * sin(phi);

    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;
const FLIP_FRAG = /* glsl */`
  uniform sampler2D frontTexture;
  uniform sampler2D backTexture;
  varying vec2 vUv;
  void main() {
    if (gl_FrontFacing) {
      gl_FragColor = texture2D(frontTexture, vUv);
    } else {
      gl_FragColor = texture2D(backTexture, vec2(1.0 - vUv.x, vUv.y));
    }
    #include <colorspace_fragment>
  }
`;

// Crease shadow — a thin vertical line along the spine.
const CREASE_FRAG = /* glsl */`
  uniform float uOpacity;
  varying vec2 vUv;
  void main() {
    float d = abs(vUv.x - 0.5) * 2.0;   // 0 at center, 1 at edges
    float line = exp(-d * d * 80.0);     // tight Gaussian ≈ 1-pixel line
    gl_FragColor = vec4(0.0, 0.0, 0.0, line * uOpacity * 0.3);
  }
`;

export class Book {
  private state: BookState;
  private group: THREE.Group;
  private textures: TexturePool;
  private pageWidth: number;
  private pageHeight: number;
  private numLeaves: number;
  private material: BookMaterial;

  // Two meshes that always show the current resting spread.
  private leftMesh: THREE.Mesh;
  private rightMesh: THREE.Mesh;

  // Turning page mesh — exists only during an animation.
  private turningPageMesh: THREE.Mesh | null = null;
  private isReverseTurn = false;

  // Fan turn: multiple pages turning simultaneously with stagger.
  private fanPages: Array<{ mesh: THREE.Mesh; delay: number }> = [];
  private fanReverse = false;

  // Spine crease shadow — fades in/out with page turns.
  private creaseMesh: THREE.Mesh;

  // Popup diorama — paper mountains that pop up from the page on a specific spread.
  private popupGroup: THREE.Group | null = null;
  private readonly POPUP_SPREAD = 7;  // j=7 → p14/p15
  private popupFoldProgress = 0;       // 0 = flat on page, 1 = fully upright
  private popupLeavingSpread = false;  // true during a turn away from popup spread
  private popupArrivingSpread = false; // true during a turn toward the popup spread

  // Clipping plane at the page surface (z=0 in book-group local space,
  // transformed to world space each frame).  Prevents popup geometry from
  // rendering below the page.
  private popupClipPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

  constructor(params: BookParams) {
    this.numLeaves = params.numLeaves;
    this.pageWidth  = params.pageWidth  ?? 1.0;
    this.pageHeight = params.pageHeight ?? 1.4;
    this.material   = params.material   ?? DEFAULT_BOOK_MATERIAL;

    this.state    = new BookState(this.numLeaves);
    this.group    = new THREE.Group();
    this.textures = generateBookTextures(this.numLeaves * 2, params.textureSize ?? 512);

    // Left page: x = -pageWidth … 0
    const leftGeo = new THREE.PlaneGeometry(this.pageWidth, this.pageHeight);
    leftGeo.translate(-this.pageWidth / 2, 0, 0);
    this.leftMesh = new THREE.Mesh(leftGeo, new THREE.MeshBasicMaterial({ side: THREE.FrontSide }));
    this.leftMesh.position.z = -0.001;
    this.group.add(this.leftMesh);

    // Right page: x = 0 … pageWidth
    const rightGeo = new THREE.PlaneGeometry(this.pageWidth, this.pageHeight);
    rightGeo.translate(this.pageWidth / 2, 0, 0);
    this.rightMesh = new THREE.Mesh(rightGeo, new THREE.MeshBasicMaterial({ side: THREE.FrontSide }));
    this.rightMesh.position.z = 0;
    this.group.add(this.rightMesh);

    // Crease shadow strip: 10% of page width, centered on spine
    const creaseWidth = this.pageWidth * 0.1;
    const creaseGeo = new THREE.PlaneGeometry(creaseWidth, this.pageHeight);
    const creaseMat = new THREE.ShaderMaterial({
      uniforms: { uOpacity: { value: 0 } },
      vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: CREASE_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.FrontSide,
    });
    this.creaseMesh = new THREE.Mesh(creaseGeo, creaseMat);
    this.creaseMesh.position.z = 0.002;
    this.group.add(this.creaseMesh);

    this.syncDisplay();
    // Popup diorama temporarily disabled.
    // this.createPopup();
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** Mirror of BookState.getVisibleContent but accepts an arbitrary j. */
  private contentAt(j: number): { left: string | null; right: string | null } {
    const n = this.numLeaves;
    if (j === -1)              return { left: null,             right: 'cover_front_ext' };
    if (j === 0)               return { left: 'cover_front_int', right: 'p1' };
    if (j >= 1 && j <= n - 1) return { left: `p${2 * j}`,       right: `p${2 * j + 1}` };
    if (j === n)               return { left: `p${2 * n}`,       right: 'cover_back_int' };
    if (j === n + 1)           return { left: 'cover_back_ext',  right: null };
    return { left: null, right: null };
  }

  private tex(name: string | null): THREE.Texture | null {
    return name ? (this.textures.get(name) ?? null) : null;
  }

  private applyToMesh(mesh: THREE.Mesh, name: string | null): void {
    const mat = mesh.material as THREE.MeshBasicMaterial;
    mat.map = this.tex(name);
    mat.needsUpdate = true;
    mesh.visible = mat.map !== null;
  }

  /** Refresh the two spread meshes to match the current resting state. */
  private syncDisplay(): void {
    const { left, right } = this.contentAt(this.state.getStateIndex());
    this.applyToMesh(this.leftMesh,  left);
    this.applyToMesh(this.rightMesh, right);
    // Evict distant textures to free GPU memory
    this.textures.retainWindow(this.state.getStateIndex(), this.numLeaves);
    if (this.popupGroup) {
      const atPopup = !this.state.getIsTurning() &&
        this.state.getStateIndex() === this.POPUP_SPREAD;
      this.popupArrivingSpread = false;
      this.popupLeavingSpread = false;
      if (atPopup) {
        this.popupGroup.visible = true;
        this.popupFoldProgress = 1;
        this.applyPopupFold();
      } else {
        this.popupFoldProgress = 0;
        this.applyPopupFold();
        this.popupGroup.visible = false;
      }
    }
  }

  /**
   * Create a paper-craft popup diorama of mountains and trees.
   * Elements start flat (rotation.x = 0); applyPopupFold() drives them
   * upright.  Trees and the sun use sub-groups so their elevated parts
   * pivot correctly around their base on the page.
   */
  private createPopup(): void {
    this.popupGroup = new THREE.Group();

    const paper = (color: number) =>
      new THREE.MeshBasicMaterial({
        color,
        side: THREE.DoubleSide,
        clippingPlanes: [this.popupClipPlane],
      });

    // Mountains — ShapeGeometry base at y=0, peak at y=h.
    // rotation.x driven by applyPopupFold(); no preset rotation.
    const addMountain = (w: number, h: number, px: number, py: number, color: number) => {
      const shape = new THREE.Shape();
      shape.moveTo(-w / 2, 0);
      shape.lineTo(0, h);
      shape.lineTo(w / 2, 0);
      shape.closePath();
      const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), paper(color));
      mesh.position.set(px, py, 0);
      this.popupGroup!.add(mesh);
    };

    addMountain(1.4, 0.38, 0, 0.15, 0x7a9d8a);      // distant range
    addMountain(0.9, 0.58, -0.15, 0, 0x3a6d4a);      // main peak
    addMountain(0.65, 0.45, 0.45, -0.08, 0x4a7d5a);   // side peak
    addMountain(0.5, 0.26, -0.55, -0.18, 0x5a8d6a);   // foothill

    // Sun — group so y-offset rotates into z when folded up
    const sunGroup = new THREE.Group();
    sunGroup.position.set(0.55, 0.2, 0);
    const sun = new THREE.Mesh(new THREE.CircleGeometry(0.09, 32), paper(0xf5d76e));
    sun.position.y = 0.5;
    sunGroup.add(sun);
    this.popupGroup.add(sunGroup);

    // Trees — each in a group so trunk + canopy pivot together
    const addTree = (tx: number, ty: number, h: number, foliageColor: number) => {
      const treeGroup = new THREE.Group();
      treeGroup.position.set(tx, ty, 0);

      const trunk = new THREE.Mesh(
        new THREE.PlaneGeometry(h * 0.08, h * 0.35),
        paper(0x6b4226),
      );
      trunk.position.y = h * 0.175;
      treeGroup.add(trunk);

      const canopyShape = new THREE.Shape();
      canopyShape.moveTo(-h * 0.2, 0);
      canopyShape.lineTo(0, h * 0.5);
      canopyShape.lineTo(h * 0.2, 0);
      canopyShape.closePath();
      const canopy = new THREE.Mesh(new THREE.ShapeGeometry(canopyShape), paper(foliageColor));
      canopy.position.y = h * 0.3;
      treeGroup.add(canopy);

      this.popupGroup!.add(treeGroup);
    };

    addTree(-0.72, -0.25, 0.32, 0x2d5a35);
    addTree(0.68, -0.2, 0.28, 0x3d6a45);
    addTree(-0.3, -0.3, 0.22, 0x2d5535);

    this.popupGroup.visible = false;
    this.popupGroup.position.z = 0.003;
    this.group.add(this.popupGroup);
  }

  /** Spawn a flipping-page mesh with per-vertex bending shader. */
  private spawnFlipPage(
    frontTex: THREE.Texture,
    backTex: THREE.Texture,
    startAngle: number,  // 0 for forward, -Math.PI for reverse
  ): void {
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        frontTexture: { value: frontTex },
        backTexture:  { value: backTex  },
        uAngle:       { value: startAngle },
        uBendAmount:  { value: 0.4 },
        uPageWidth:   { value: this.pageWidth },
      },
      vertexShader:   FLIP_VERT,
      fragmentShader: FLIP_FRAG,
      side: THREE.DoubleSide,
    });

    // 64 X segments for smooth curvature along the page width.
    const geo = new THREE.PlaneGeometry(this.pageWidth, this.pageHeight, 64, 1);
    geo.translate(this.pageWidth / 2, 0, 0);

    this.turningPageMesh = new THREE.Mesh(geo, mat);
    this.turningPageMesh.position.z = 0.001;
    this.group.add(this.turningPageMesh);

  }

  // ── Public API ────────────────────────────────────────────────────────────

  startTurn(): boolean {
    if (!this.state.canTurnForward()) return false;

    const j   = this.state.getStateIndex();
    const cur = this.contentAt(j);
    const nxt = this.contentAt(j + 1);

    const frontTex = this.tex(cur.right);
    const backTex  = this.tex(nxt.left);
    if (!frontTex || !backTex) return false;

    // V-fold: track whether we're arriving at or leaving the popup spread.
    if (j === this.POPUP_SPREAD) {
      this.popupLeavingSpread = true;
    }
    if (j + 1 === this.POPUP_SPREAD && this.popupGroup) {
      this.popupArrivingSpread = true;
      this.popupGroup.visible = true;
      this.popupFoldProgress = 0;
      this.applyPopupFold();
    }

    this.state.startTurn();
    this.isReverseTurn = false;

    // The flip lifts the right page — the destination right is immediately
    // visible underneath it from the very first frame.
    this.applyToMesh(this.rightMesh, nxt.right);

    this.spawnFlipPage(frontTex, backTex, 0);
    return true;
  }

  startReverseTurn(): boolean {
    if (!this.state.canTurnBackward()) return false;

    const j   = this.state.getStateIndex();   // before decrement
    const cur = this.contentAt(j);
    const prv = this.contentAt(j - 1);

    // Front face (visible at rot=0, right side at end) → prv.right.
    // Back face  (visible at rot=-π, left side at start) → cur.left.
    const frontTex = this.tex(prv.right);
    const backTex  = this.tex(cur.left);
    if (!frontTex || !backTex) return false;

    // V-fold: track whether we're arriving at or leaving the popup spread.
    if (j === this.POPUP_SPREAD) {
      this.popupLeavingSpread = true;
    }
    if (j - 1 === this.POPUP_SPREAD && this.popupGroup) {
      this.popupArrivingSpread = true;
      this.popupGroup.visible = true;
      this.popupFoldProgress = 0;
      this.applyPopupFold();
    }

    this.state.startReverseTurn();   // decrements j
    this.isReverseTurn = true;

    // The flip lifts the left page — the destination left is immediately
    // visible underneath it from the very first frame.
    // rightMesh is NOT touched: cur.right stays visible throughout.
    // completeTurn() → syncDisplay() will finalise both meshes once the
    // flip has landed and been removed.
    this.applyToMesh(this.leftMesh, prv.left);

    this.spawnFlipPage(frontTex, backTex, -Math.PI);
    return true;
  }

  updateTurningPage(progress: number): void {
    this.state.setTurningProgress(progress);
    if (this.turningPageMesh) {
      const angle = this.isReverseTurn
        ? -Math.PI * (1 - progress)
        : -Math.PI * progress;
      (this.turningPageMesh.material as THREE.ShaderMaterial).uniforms.uAngle.value = angle;
    }
    // Crease shadow: bell curve peaking at mid-turn, zero when flat
    const creaseOpacity = Math.sin(Math.PI * progress);
    (this.creaseMesh.material as THREE.ShaderMaterial).uniforms.uOpacity.value = creaseOpacity;

    // V-fold: popup fold angle is mechanically linked to turn progress,
    // like a real popup book where the fold is driven by the page opening.
    if (this.popupGroup) {
      if (this.popupArrivingSpread) {
        // Page lifting reveals the popup — fold up in sync with progress
        this.popupFoldProgress = progress;
        this.applyPopupFold();
      } else if (this.popupLeavingSpread) {
        // Page descending covers the popup — fold down in sync
        this.popupFoldProgress = Math.max(0, 1 - progress);
        this.applyPopupFold();
        if (this.popupFoldProgress <= 0.001) {
          this.popupGroup.visible = false;
        }
      }
    }
  }

  completeTurn(): void {
    if (this.turningPageMesh) {
      this.group.remove(this.turningPageMesh);
      this.turningPageMesh.geometry.dispose();
      (this.turningPageMesh.material as THREE.Material).dispose();
      this.turningPageMesh = null;
    }
    (this.creaseMesh.material as THREE.ShaderMaterial).uniforms.uOpacity.value = 0;
    this.popupLeavingSpread = false;
    this.popupArrivingSpread = false;
    this.state.completeTurn();
    this.syncDisplay();
  }

  /**
   * Cancel an in-progress drag turn and restore the book to its pre-turn state.
   * The BookState internal j/phi are reset via the public reset helper.
   */
  cancelTurn(): void {
    if (this.turningPageMesh) {
      this.group.remove(this.turningPageMesh);
      this.turningPageMesh.geometry.dispose();
      (this.turningPageMesh.material as THREE.Material).dispose();
      this.turningPageMesh = null;
    }
    (this.creaseMesh.material as THREE.ShaderMaterial).uniforms.uOpacity.value = 0;
    this.popupLeavingSpread = false;
    this.popupArrivingSpread = false;
    this.state.cancelTurn();
    this.syncDisplay();
  }

  // ── Fan turn API ──────────────────────────────────────────────────────────

  /**
   * Maximum pages a fan gesture can turn from the current position,
   * computed from impulse propagation through page-to-page friction.
   */
  getMaxFanCount(reverse: boolean): number {
    return maxFanCount(
      this.state.getStateIndex(),
      this.numLeaves,
      !reverse,
      this.material,
    );
  }

  /**
   * Start a fan turn: multiple pages turning simultaneously with stagger.
   * Count is clamped to the impulse-derived maximum — the cover’s inertia
   * naturally prevents the fan from closing the book.
   */
  startFanTurn(count: number, reverse: boolean): boolean {
    const j = this.state.getStateIndex();
    const STAGGER = 0.12; // delay between successive pages
    const physicsMax = this.getMaxFanCount(reverse);

    if (reverse) {
      // Clamp to impulse-derived max (covers are too heavy to fan).
      const c = Math.min(count, physicsMax);
      if (c < 1) return false;
      if (!this.state.startReverseFanTurn(c)) return false;

      this.fanReverse = true;

      // V-fold: detect popup spread crossing
      const dest_j = j - c;
      if (j === this.POPUP_SPREAD) {
        this.popupLeavingSpread = true;
      }
      if (dest_j === this.POPUP_SPREAD && this.popupGroup) {
        this.popupArrivingSpread = true;
        this.popupGroup.visible = true;
        this.popupFoldProgress = 0;
        this.applyPopupFold();
      }

      // Destination spread under all the turning pages
      const dest = this.contentAt(dest_j);
      this.applyToMesh(this.leftMesh,  dest.left);
      this.applyToMesh(this.rightMesh, dest.right);

      for (let i = 0; i < c; i++) {
        const srcJ = j - 1 - i;  // each leaf we're peeling back
        const prv = this.contentAt(srcJ);
        const cur = this.contentAt(srcJ + 1);
        const frontTex = this.tex(prv.right);
        const backTex = this.tex(cur.left);
        if (!frontTex || !backTex) continue;
        this.spawnFanPage(frontTex, backTex, -Math.PI, i * STAGGER, i);
      }
    } else {
      // Forward fan — clamp to impulse-derived max.
      const c = Math.min(count, physicsMax);
      if (c < 1) return false;
      if (!this.state.startFanTurn(c)) return false;

      this.fanReverse = false;

      // V-fold: detect popup spread crossing
      const dest_j = j + c;
      if (j === this.POPUP_SPREAD) {
        this.popupLeavingSpread = true;
      }
      if (dest_j === this.POPUP_SPREAD && this.popupGroup) {
        this.popupArrivingSpread = true;
        this.popupGroup.visible = true;
        this.popupFoldProgress = 0;
        this.applyPopupFold();
      }

      // Destination spread shown underneath
      const dest = this.contentAt(dest_j);
      this.applyToMesh(this.leftMesh,  dest.left);
      this.applyToMesh(this.rightMesh, dest.right);

      for (let i = 0; i < c; i++) {
        const srcJ = j + i;
        const cur = this.contentAt(srcJ);
        const nxt = this.contentAt(srcJ + 1);
        const frontTex = this.tex(cur.right);
        const backTex = this.tex(nxt.left);
        if (!frontTex || !backTex) continue;
        this.spawnFanPage(frontTex, backTex, 0, i * STAGGER, i);
      }
    }
    return true;
  }

  /** Spawn one page in a fan, at a given z-depth layer. */
  private spawnFanPage(
    frontTex: THREE.Texture,
    backTex: THREE.Texture,
    startAngle: number,
    delay: number,
    layer: number,
  ): void {
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        frontTexture: { value: frontTex },
        backTexture:  { value: backTex  },
        uAngle:       { value: startAngle },
        uBendAmount:  { value: 0.4 },
        uPageWidth:   { value: this.pageWidth },
      },
      vertexShader:   FLIP_VERT,
      fragmentShader: FLIP_FRAG,
      side: THREE.DoubleSide,
    });

    const geo = new THREE.PlaneGeometry(this.pageWidth, this.pageHeight, 64, 1);
    geo.translate(this.pageWidth / 2, 0, 0);

    const mesh = new THREE.Mesh(geo, mat);
    // Stack pages with slight z offsets so they don't z-fight
    mesh.position.z = 0.001 + layer * 0.002;
    this.group.add(mesh);
    this.fanPages.push({ mesh, delay });
  }

  /** Update all fan pages with stagger-delayed progress. */
  updateFanTurn(progress: number): void {
    this.state.setTurningProgress(progress);

    for (const page of this.fanPages) {
      const p = Math.max(0, Math.min(1, (progress - page.delay) / (1 - page.delay)));
      const angle = this.fanReverse
        ? -Math.PI * (1 - p)
        : -Math.PI * p;
      (page.mesh.material as THREE.ShaderMaterial).uniforms.uAngle.value = angle;
    }

    // Crease shadow: bell curve based on mean page progress
    const meanP = this.fanPages.length > 0
      ? this.fanPages.reduce((sum, fp) => {
          return sum + Math.max(0, Math.min(1, (progress - fp.delay) / (1 - fp.delay)));
        }, 0) / this.fanPages.length
      : progress;
    (this.creaseMesh.material as THREE.ShaderMaterial).uniforms.uOpacity.value =
      Math.sin(Math.PI * meanP);

    // V-fold: drive popup fold in sync with fan progress
    if (this.popupGroup) {
      if (this.popupArrivingSpread) {
        this.popupFoldProgress = progress;
        this.applyPopupFold();
      } else if (this.popupLeavingSpread) {
        this.popupFoldProgress = Math.max(0, 1 - progress);
        this.applyPopupFold();
        if (this.popupFoldProgress <= 0.001) {
          this.popupGroup.visible = false;
        }
      }
    }
  }

  /** Complete the fan turn — dispose all fan page meshes, advance state. */
  completeFanTurn(): void {
    for (const page of this.fanPages) {
      this.group.remove(page.mesh);
      page.mesh.geometry.dispose();
      (page.mesh.material as THREE.Material).dispose();
    }
    this.fanPages = [];
    (this.creaseMesh.material as THREE.ShaderMaterial).uniforms.uOpacity.value = 0;
    this.popupLeavingSpread = false;
    this.popupArrivingSpread = false;
    this.state.completeTurn();
    this.syncDisplay();
  }

  /** Cancel an in-progress fan turn and restore the book to its pre-turn state. */
  cancelFanTurn(): void {
    for (const page of this.fanPages) {
      this.group.remove(page.mesh);
      page.mesh.geometry.dispose();
      (page.mesh.material as THREE.Material).dispose();
    }
    this.fanPages = [];
    (this.creaseMesh.material as THREE.ShaderMaterial).uniforms.uOpacity.value = 0;
    this.popupLeavingSpread = false;
    this.popupArrivingSpread = false;
    this.state.cancelTurn();
    this.syncDisplay();
  }

  /** Tick the popup fold animation and update the clip plane. Call every frame. */
  update(_dt: number): void {
    // Update the clipping plane from book-group local space to world space.
    // Page surface is z=0 in local space; normal (0,0,1) clips away z<0.
    this.group.updateMatrixWorld(true);
    this.popupClipPlane.set(new THREE.Vector3(0, 0, 1), 0);
    this.popupClipPlane.applyMatrix4(this.group.matrixWorld);

    // V-fold is driven directly by updateTurningPage(); nothing to do here
    // during active turns. Only handle the resting state.
    if (!this.popupGroup) return;
    if (this.popupLeavingSpread || this.popupArrivingSpread) return;
  }

  private applyPopupFold(): void {
    if (!this.popupGroup) return;
    const angle = this.popupFoldProgress * Math.PI / 2;
    for (const child of this.popupGroup.children) {
      child.rotation.x = angle;
    }
  }

  /** Expose page dimensions for hit-testing in the scene layer. */
  getPageWidth():  number { return this.pageWidth; }
  getPageHeight(): number { return this.pageHeight; }

  getGroup(): THREE.Group  { return this.group; }
  getState(): BookState    { return this.state; }
  getStateDescription(): string { return this.state.getStateDescription(); }

  /** Current popup fold angle: 0 = flat, 1 = fully upright. For testing. */
  getPopupFoldProgress(): number { return this.popupFoldProgress; }
  /** Whether the popup group exists and is visible. */
  isPopupVisible(): boolean { return this.popupGroup?.visible ?? false; }
}
