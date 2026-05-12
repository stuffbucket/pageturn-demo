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
import { creaseFromDrag, type Crease, type Vec2 } from './CreaseGeometry';
import { generateBookTextures, TexturePool } from '../textures/atlas';

export interface BookParams {
  numLeaves: number;
  pageWidth?: number;
  pageHeight?: number;
  curlRadius?: number;   // kept for API compat, unused in flat-flip mode
  textureSize?: number;
  material?: BookMaterial;
}

// Vertex shader: tilted-crease (turn.js-inspired) page fold.
//
// The folded "flap" is the half-plane on the corner-side of the crease line
// (uCreaseOrigin, uCreaseDir).  Vertices on the spine-side stay flat; flap
// vertices are rotated about the crease axis (in 3D, a horizontal line through
// uCreaseOrigin in the page plane, direction uCreaseDir, k.z = 0).
//
// The bend envelope sin(2·dihedral) is preserved from the original model but
// applied to a per-vertex t = (signed flap distance) / uMaxFlapDist, so the
// free edge lags / leads as before.
//
// Rotation by -phi is applied (matches the original "lift toward +z" sign
// convention for forward turns).  uCreaseDir always has y >= 0.
const FLIP_VERT = /* glsl */`
  uniform vec2 uCreaseOrigin;
  uniform vec2 uCreaseDir;
  uniform vec2 uCornerDir;     // unit, points from crease toward grabbed corner
  uniform float uMaxFlapDist;
  uniform float uDihedral;
  uniform float uBendAmount;
  varying vec2 vUv;

  void main() {
    vUv = uv;
    vec3 pos = position;

    vec2 rel2 = pos.xy - uCreaseOrigin;
    float s = dot(rel2, uCornerDir);

    if (s > 0.0 && uDihedral > 0.0) {
      float t = clamp(s / max(uMaxFlapDist, 1e-6), 0.0, 1.0);
      // Same gravity-bend envelope as the legacy model — but measured from
      // the (tilted) crease line rather than the spine.
      float phi = uDihedral + uBendAmount * t * sin(2.0 * uDihedral);

      vec3 k = vec3(uCreaseDir, 0.0);
      vec3 rel = pos - vec3(uCreaseOrigin, 0.0);

      // Negative angle so the flap lifts toward +z (matches the legacy
      // forward-turn convention; uCreaseDir.y >= 0).
      float ang = -phi;
      float c = cos(ang);
      float si = sin(ang);
      vec3 rotated = rel * c + cross(k, rel) * si + k * dot(k, rel) * (1.0 - c);

      pos = vec3(uCreaseOrigin, 0.0) + rotated;
    }

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
    this.state.setPageSize(this.pageWidth, this.pageHeight);
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

  /** Spawn a flipping-page mesh with the tilted-crease bending shader. */
  private spawnFlipPage(
    frontTex: THREE.Texture,
    backTex: THREE.Texture,
    _startAngle: number,  // legacy: 0 = forward start, -π = reverse start (consumed implicitly via state.phi)
  ): void {
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        frontTexture:   { value: frontTex },
        backTexture:    { value: backTex  },
        uCreaseOrigin:  { value: new THREE.Vector2(this.pageWidth, this.pageHeight / 2) },
        uCreaseDir:     { value: new THREE.Vector2(0, 1) },
        uCornerDir:     { value: new THREE.Vector2(1, 0) },
        uMaxFlapDist:   { value: 0 },
        uDihedral:      { value: 0 },
        uBendAmount:    { value: 0.4 },
      },
      vertexShader:   FLIP_VERT,
      fragmentShader: FLIP_FRAG,
      side: THREE.DoubleSide,
      // Bias the turning page toward the camera in depth-buffer space so it
      // wins the depth test against the static spread when the two surfaces
      // are nearly co-planar (e.g. at φ≈0 / φ≈π, or where the bend envelope
      // brings the curl close to z=0). Without this, sub-mm differences in
      // world-space z (turning at +0.001, static at 0 / −0.001) fall below
      // depth-buffer precision and one face's content bleeds through the
      // other.
      polygonOffset:      true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits:  -2,
    });

    // Tessellation along both X and Y so a tilted crease deforms smoothly
    // across the whole page surface, not just along the spine direction.
    const geo = new THREE.PlaneGeometry(this.pageWidth, this.pageHeight, 48, 24);
    geo.translate(this.pageWidth / 2, 0, 0);

    this.turningPageMesh = new THREE.Mesh(geo, mat);
    this.turningPageMesh.position.z = 0.001;
    this.group.add(this.turningPageMesh);

    // Initialise uniforms from current crease so the first rendered frame is
    // already correctly oriented.
    this.applyCreaseUniforms(mat, this.state.getCrease());
  }

  /**
   * Push a Crease (from BookState) into the per-page shader uniforms.
   * Computes the corner-side direction and a max-flap-distance for bend
   * normalisation.  Called every frame for the turning page(s).
   */
  private applyCreaseUniforms(mat: THREE.ShaderMaterial, crease: Crease): void {
    // Max projection of any of the four page corners onto cornerDir, measured
    // from the (spine-pinned) crease origin.  Bounds the flap region for the
    // shader's per-vertex bend normalisation.
    const W = this.pageWidth;
    const H = this.pageHeight;
    const pageCorners: Vec2[] = [
      { x: 0, y: -H / 2 }, { x: 0, y: H / 2 },
      { x: W, y: -H / 2 }, { x: W, y: H / 2 },
    ];
    let maxFlap = 0;
    const cd = crease.cornerDir;
    for (const pc of pageCorners) {
      const s = (pc.x - crease.originOnEdge.x) * cd.x + (pc.y - crease.originOnEdge.y) * cd.y;
      if (s > maxFlap) maxFlap = s;
    }
    if (maxFlap < 1e-6) maxFlap = 1e-6;

    const u = mat.uniforms;
    (u.uCreaseOrigin.value as THREE.Vector2).set(crease.originOnEdge.x, crease.originOnEdge.y);
    (u.uCreaseDir.value as THREE.Vector2).set(crease.creaseDir.x, crease.creaseDir.y);
    (u.uCornerDir.value as THREE.Vector2).set(cd.x, cd.y);
    u.uMaxFlapDist.value = maxFlap;
    u.uDihedral.value = crease.dihedral;
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

    // The flip lifts the right page — the destination right is immediately
    // visible underneath it from the very first frame.
    this.applyToMesh(this.rightMesh, nxt.right);

    this.spawnFlipPage(frontTex, backTex, 0);
    return true;
  }

  /**
   * Drive a turn from a 2D drag point (in page-local coords for the right
   * page: spine at x=0, free edge at x=pageWidth, top at y=+pageHeight/2).
   * Used by the interactive drag handler to get true tilted-crease curl.
   */
  updateTurningDrag(pageLocalX: number, pageLocalY: number): void {
    this.state.setDragPoint(pageLocalX, pageLocalY);
    if (this.turningPageMesh) {
      this.applyCreaseUniforms(
        this.turningPageMesh.material as THREE.ShaderMaterial,
        this.state.getCrease(),
      );
    }
    const creaseOpacity = Math.sin(Math.PI * this.state.getTurningProgress());
    (this.creaseMesh.material as THREE.ShaderMaterial).uniforms.uOpacity.value = creaseOpacity;
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
      this.applyCreaseUniforms(
        this.turningPageMesh.material as THREE.ShaderMaterial,
        this.state.getCrease(),
      );
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
    _startAngle: number,
    delay: number,
    layer: number,
  ): void {
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        frontTexture:   { value: frontTex },
        backTexture:    { value: backTex  },
        uCreaseOrigin:  { value: new THREE.Vector2(this.pageWidth, this.pageHeight / 2) },
        uCreaseDir:     { value: new THREE.Vector2(0, 1) },
        uCornerDir:     { value: new THREE.Vector2(1, 0) },
        uMaxFlapDist:   { value: this.pageWidth },
        uDihedral:      { value: 0 },
        uBendAmount:    { value: 0.4 },
      },
      vertexShader:   FLIP_VERT,
      fragmentShader: FLIP_FRAG,
      side: THREE.DoubleSide,
      // Same depth-bias as the single turning page (see spawnFlipPage).
      // Each fan layer also gets a stacking offset on its position.z below.
      polygonOffset:      true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits:  -2,
    });

    const geo = new THREE.PlaneGeometry(this.pageWidth, this.pageHeight, 48, 24);
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

    const W = this.pageWidth;
    const H = this.pageHeight;
    const corner: Vec2 = { x: W, y: H / 2 };
    for (const page of this.fanPages) {
      const p = Math.max(0, Math.min(1, (progress - page.delay) / (1 - page.delay)));
      const phi = this.fanReverse ? Math.PI * (1 - p) : Math.PI * p;
      // Synthesise a spine-pinned vertical-crease drag at the same horizontal
      // pull (forward span = W, reverse span = 2W) so the crease reaches the
      // spine at p = 1 and the dihedral monotonically tracks phi.
      const span = this.fanReverse ? 2 * W : W;
      const dragX = corner.x - span * (phi / Math.PI);
      const synthCrease = creaseFromDrag(
        corner,
        { x: dragX, y: corner.y },
        { x: W, y: H },
        this.fanReverse,
      );
      this.applyCreaseUniforms(page.mesh.material as THREE.ShaderMaterial, synthCrease);
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
