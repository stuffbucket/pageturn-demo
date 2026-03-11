/**
 * main.ts - Scene setup, renderer, animation loop from Section 7.5
 */

import * as THREE from 'three';
import './style.css'
import { Book } from './book/Book';

class PageTurnDemo {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private book: Book;
  private animationDuration = 1.2;  // seconds
  private animationProgress = 0;
  private isAnimating = false;
  private frameCount = 0;
  private fps = 0;
  private lastFpsUpdate = Date.now();

  constructor() {
    // Scene setup
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x2d2d44);

    // Camera setup
    const canvas = document.getElementById('canvas-container');
    if (!canvas) throw new Error('Canvas container not found');

    const width = window.innerWidth;
    const height = window.innerHeight;

    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    this.camera.position.set(0, 0, 3.5);
    this.camera.lookAt(0, 0, 0);

    // Renderer setup
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.shadowMap.enabled = true;
    canvas.appendChild(this.renderer.domElement);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    this.scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(5, 5, 8);
    directionalLight.castShadow = true;
    this.scene.add(directionalLight);

    // Create book
    this.book = new Book({
      numLeaves: 3,           // 3 leaves = 6 interior pages + 2 covers
      pageWidth: 1.0,
      pageHeight: 1.4,
      curlRadius: 0.15,
      textureSize: 512,
    });

    this.scene.add(this.book.getGroup());

    // Event handlers
    this.setupEventHandlers();

    // Start animation loop
    this.animate();

    // Handle window resize
    window.addEventListener('resize', () => this.onWindowResize());
  }

  private setupEventHandlers(): void {
    const prevBtn = document.getElementById('prev-btn');
    const nextBtn = document.getElementById('next-btn');

    prevBtn?.addEventListener('click', () => this.turnPrevious());
    nextBtn?.addEventListener('click', () => this.turnNext());

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') this.turnPrevious();
      if (e.key === 'ArrowRight') this.turnNext();
    });
  }

  private turnNext(): void {
    if (!this.isAnimating && this.book.getState().canTurnForward()) {
      this.book.startTurn();
      this.animationProgress = 0;
      this.isAnimating = true;
    }
  }

  private turnPrevious(): void {
    if (!this.isAnimating && this.book.getState().canTurnBackward()) {
      this.book.startReverseTurn();
      this.animationProgress = 0;
      this.isAnimating = true;
    }
  }

  private updateUI(): void {
    const state = this.book.getState();
    const stateDisplay = document.getElementById('state-display');
    const currentPageEl = document.getElementById('current-page');
    const fpsEl = document.getElementById('fps');
    const prevBtn = document.getElementById('prev-btn') as HTMLButtonElement;
    const nextBtn = document.getElementById('next-btn') as HTMLButtonElement;

    if (stateDisplay) {
      stateDisplay.textContent = `State: ${state.getStateDescription()}`;
    }

    if (currentPageEl) {
      currentPageEl.textContent = `${state.getStateIndex()} / ${state.getTotalStates() - 1}`;
    }

    if (fpsEl) {
      fpsEl.textContent = Math.round(this.fps).toString();
    }

    // Update button states
    if (prevBtn) prevBtn.disabled = !state.canTurnBackward() || this.isAnimating;
    if (nextBtn) nextBtn.disabled = !state.canTurnForward() || this.isAnimating;
  }

  private animate = (): void => {
    requestAnimationFrame(this.animate);

    // Update animation
    if (this.isAnimating) {
      this.animationProgress += 1 / (this.animationDuration * 60); // assuming 60fps

      if (this.animationProgress >= 1.0) {
        this.animationProgress = 1.0;
        this.book.updateTurningPage(this.animationProgress);
        this.book.completeTurn();
        this.isAnimating = false;
      } else {
        this.book.updateTurningPage(this.animationProgress);
      }
    }

    // Update FPS
    this.frameCount++;
    const now = Date.now();
    const deltaTime = now - this.lastFpsUpdate;
    if (deltaTime >= 1000) {
      this.fps = (this.frameCount * 1000) / deltaTime;
      this.frameCount = 0;
      this.lastFpsUpdate = now;
      this.updateUI();
    }

    // Render
    this.renderer.render(this.scene, this.camera);
  };

  private onWindowResize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(width, height);
  }
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  new PageTurnDemo();
});
