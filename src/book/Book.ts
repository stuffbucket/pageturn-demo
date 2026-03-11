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
import { BookState } from './BookState';
import { generateBookTextures } from '../textures/atlas';

export interface BookParams {
  numLeaves: number;
  pageWidth?: number;
  pageHeight?: number;
  curlRadius?: number;   // kept for API compat, unused in flat-flip mode
  textureSize?: number;
}

// Inline vertex+fragment shaders that support two textures via gl_FrontFacing.
const FLIP_VERT = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
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
  }
`;

export class Book {
  private state: BookState;
  private group: THREE.Group;
  private textures: Map<string, THREE.Texture>;
  private pageWidth: number;
  private pageHeight: number;
  private numLeaves: number;

  // Two meshes that always show the current resting spread.
  private leftMesh: THREE.Mesh;
  private rightMesh: THREE.Mesh;

  // Turning page mesh — exists only during an animation.
  private turningPageMesh: THREE.Mesh | null = null;
  private isReverseTurn = false;

  constructor(params: BookParams) {
    this.numLeaves = params.numLeaves;
    this.pageWidth  = params.pageWidth  ?? 1.0;
    this.pageHeight = params.pageHeight ?? 1.4;

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

    this.syncDisplay();
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
  }

  /** Spawn a flipping-page mesh with its own two-sided shader. */
  private spawnFlipPage(
    frontTex: THREE.Texture,
    backTex: THREE.Texture,
    startRotation: number
  ): void {
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        frontTexture: { value: frontTex },
        backTexture:  { value: backTex  },
      },
      vertexShader:   FLIP_VERT,
      fragmentShader: FLIP_FRAG,
      side: THREE.DoubleSide,
    });

    // Right-page geometry: x = 0 … pageWidth.  Rotating around Y at x=0
    // means the page pivots around the spine — exactly what we want.
    const geo = new THREE.PlaneGeometry(this.pageWidth, this.pageHeight);
    geo.translate(this.pageWidth / 2, 0, 0);

    this.turningPageMesh = new THREE.Mesh(geo, mat);
    this.turningPageMesh.rotation.y = startRotation;
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
      // Negative rotation sweeps +X through +Z (toward viewer).
      this.turningPageMesh.rotation.y = this.isReverseTurn
        ? -Math.PI * (1 - progress)
        : -Math.PI * progress;
    }
  }

  completeTurn(): void {
    if (this.turningPageMesh) {
      this.group.remove(this.turningPageMesh);
      this.turningPageMesh.geometry.dispose();
      (this.turningPageMesh.material as THREE.Material).dispose();
      this.turningPageMesh = null;
    }
    this.syncDisplay();
  }

  getGroup(): THREE.Group  { return this.group; }
  getState(): BookState    { return this.state; }
  getStateDescription(): string { return this.state.getStateDescription(); }
}
