/**
 * atlas.ts - Rich texture generation for the book demo
 *
 * Generates procedural covers, endpapers, text pages, landscape scenes,
 * geometric art, and a Big Buck Bunny video texture.
 */

import * as THREE from 'three';

// ── Helpers ──────────────────────────────────────────────────────────────────

function createCanvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  return [canvas, ctx];
}

function toTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ── Covers ───────────────────────────────────────────────────────────────────

function drawFrontCover(s: number): THREE.CanvasTexture {
  const [c, x] = createCanvas(s);

  // Deep teal-to-navy gradient
  const bg = x.createLinearGradient(0, 0, s * 0.3, s);
  bg.addColorStop(0, '#1b3a4b');
  bg.addColorStop(0.5, '#0d253a');
  bg.addColorStop(1, '#0a1628');
  x.fillStyle = bg;
  x.fillRect(0, 0, s, s);

  // Subtle linen texture
  x.globalAlpha = 0.04;
  for (let y = 0; y < s; y += 3) { x.fillStyle = '#fff'; x.fillRect(0, y, s, 1); }
  x.globalAlpha = 1;

  const cx = s / 2;
  const gold = '#d4a574';
  const goldL = '#e8c99b';

  // Top rule with diamond
  x.strokeStyle = gold; x.lineWidth = 1.5;
  x.beginPath(); x.moveTo(s * 0.15, s * 0.22); x.lineTo(s * 0.85, s * 0.22); x.stroke();
  x.fillStyle = gold; x.save(); x.translate(cx, s * 0.22); x.rotate(Math.PI / 4);
  x.fillRect(-4, -4, 8, 8); x.restore();

  // Title
  x.fillStyle = goldL;
  x.font = `300 ${s * 0.09}px Georgia, serif`;
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText('WANDERLUST', cx, s * 0.35);

  // Subtitle
  x.fillStyle = gold;
  x.font = `italic ${s * 0.032}px Georgia, serif`;
  x.fillText('A Journey Through Light & Color', cx, s * 0.43);

  // Lower rule
  x.strokeStyle = gold; x.lineWidth = 0.8;
  x.beginPath(); x.moveTo(s * 0.25, s * 0.48); x.lineTo(s * 0.75, s * 0.48); x.stroke();

  // Author line
  x.fillStyle = goldL;
  x.font = `${s * 0.035}px Georgia, serif`;
  x.fillText('\u2014 photographs & prose \u2014', cx, s * 0.55);

  // Bottom ornament — three rotated squares
  x.strokeStyle = gold; x.lineWidth = 0.5;
  for (let i = -1; i <= 1; i++) {
    x.save(); x.translate(cx + i * 18, s * 0.82); x.rotate(Math.PI / 4);
    x.strokeRect(-5, -5, 10, 10); x.restore();
  }
  return toTexture(c);
}

function drawBackCover(s: number): THREE.CanvasTexture {
  const [c, x] = createCanvas(s);
  const bg = x.createLinearGradient(s * 0.7, 0, 0, s);
  bg.addColorStop(0, '#1b3a4b'); bg.addColorStop(0.5, '#0d253a'); bg.addColorStop(1, '#0a1628');
  x.fillStyle = bg; x.fillRect(0, 0, s, s);
  x.globalAlpha = 0.04;
  for (let y = 0; y < s; y += 3) { x.fillStyle = '#fff'; x.fillRect(0, y, s, 1); }
  x.globalAlpha = 1;
  const cx = s / 2;
  x.fillStyle = '#d4a574';
  x.font = `italic ${s * 0.028}px Georgia, serif`;
  x.textAlign = 'center';
  const blurb = [
    '\u201CThrough mountains, markets,',
    'and the quiet in-between,',
    'these pages hold the light',
    'of a thousand golden hours.\u201D',
  ];
  blurb.forEach((l, i) => x.fillText(l, cx, s * 0.4 + i * s * 0.045));
  x.globalAlpha = 0.4;
  x.font = `${s * 0.02}px monospace`;
  x.fillText('ISBN 978-0-000000-00-0', cx, s * 0.88);
  x.globalAlpha = 1;
  return toTexture(c);
}

function drawEndpaper(s: number): THREE.CanvasTexture {
  const [c, x] = createCanvas(s);
  x.fillStyle = '#e8ddd0'; x.fillRect(0, 0, s, s);
  // Marbled pattern — overlapping translucent circles
  const cols = ['#c4724e', '#8b6f4e', '#a0845c', '#d4a574', '#6b4c3b'];
  x.globalAlpha = 0.06;
  for (let i = 0; i < 120; i++) {
    x.fillStyle = cols[i % cols.length];
    x.beginPath();
    x.arc((i * 137.5) % s, (i * 97.3 + 43) % s, 20 + (i * 23 % 80), 0, Math.PI * 2);
    x.fill();
  }
  x.globalAlpha = 0.03; x.strokeStyle = '#6b4c3b'; x.lineWidth = 0.5;
  for (let i = 0; i < s; i += 8) {
    x.beginPath(); x.moveTo(i, 0); x.lineTo(i + s * 0.2, s); x.stroke();
  }
  x.globalAlpha = 1;
  return toTexture(c);
}

// ── Interior pages ───────────────────────────────────────────────────────────

function drawTitlePage(s: number): THREE.CanvasTexture {
  const [c, x] = createCanvas(s);
  x.fillStyle = '#faf6f0'; x.fillRect(0, 0, s, s);
  const cx = s / 2;
  x.strokeStyle = '#c0b8a8'; x.lineWidth = 0.5;
  x.beginPath(); x.moveTo(s * 0.2, s * 0.15); x.lineTo(s * 0.8, s * 0.15); x.stroke();
  x.fillStyle = '#2c2c2c';
  x.font = `300 ${s * 0.08}px Georgia, serif`;
  x.textAlign = 'center'; x.fillText('WANDERLUST', cx, s * 0.32);
  x.strokeStyle = '#c0b8a8'; x.lineWidth = 0.5;
  x.beginPath(); x.moveTo(s * 0.35, s * 0.38); x.lineTo(s * 0.65, s * 0.38); x.stroke();
  x.fillStyle = '#8a8a8a';
  x.font = `italic ${s * 0.032}px Georgia, serif`;
  x.fillText('A Journey Through', cx, s * 0.46);
  x.fillText('Light & Color', cx, s * 0.51);
  x.fillStyle = '#c0b8a8';
  x.font = `${s * 0.025}px Georgia, serif`;
  x.fillText('MMXXVI', cx, s * 0.75);
  return toTexture(c);
}

function drawPoemPage(s: number): THREE.CanvasTexture {
  const [c, x] = createCanvas(s);
  x.fillStyle = '#faf6f0'; x.fillRect(0, 0, s, s);
  const cx = s / 2;
  const m = s * 0.12;
  x.fillStyle = '#2c2c2c';
  x.font = `italic ${s * 0.035}px Georgia, serif`;
  x.textAlign = 'center';
  x.fillText('The Road Not Taken', cx, s * 0.12);
  x.strokeStyle = '#c0b8a8'; x.lineWidth = 0.3;
  x.beginPath(); x.moveTo(s * 0.3, s * 0.16); x.lineTo(s * 0.7, s * 0.16); x.stroke();

  x.fillStyle = '#3c3c3c';
  x.font = `${s * 0.026}px Georgia, serif`;
  x.textAlign = 'left';
  const lines = [
    'Two roads diverged in a yellow wood,',
    'And sorry I could not travel both',
    'And be one traveler, long I stood',
    'And looked down one as far as I could',
    'To where it bent in the undergrowth;',
    '',
    'Then took the other, as just as fair,',
    'And having perhaps the better claim,',
    'Because it was grassy and wanted wear;',
    'Though as for that the passing there',
    'Had worn them really about the same,',
    '',
    'And both that morning equally lay',
    'In leaves no step had trodden black.',
    'Oh, I kept the first for another day!',
    'Yet knowing how way leads on to way,',
    'I doubted if I should ever come back.',
    '',
    'I shall be telling this with a sigh',
    'Somewhere ages and ages hence:',
    'Two roads diverged in a wood, and I\u2014',
    'I took the one less traveled by,',
    'And that has made all the difference.',
  ];
  let y = s * 0.24;
  const lh = s * 0.032;
  for (const l of lines) { if (l === '') y += lh * 0.6; else { x.fillText(l, m, y); y += lh; } }
  x.fillStyle = '#8a8a8a';
  x.font = `italic ${s * 0.022}px Georgia, serif`;
  x.textAlign = 'right';
  x.fillText('\u2014 Robert Frost, 1916', s - m, s * 0.9);
  return toTexture(c);
}

function drawOceanSunrise(s: number): THREE.CanvasTexture {
  const [c, x] = createCanvas(s);
  // Sky
  const sky = x.createLinearGradient(0, 0, 0, s * 0.5);
  sky.addColorStop(0, '#1a2a4a'); sky.addColorStop(0.4, '#4a6a8a');
  sky.addColorStop(0.7, '#d4927a'); sky.addColorStop(1, '#f0d4a0');
  x.fillStyle = sky; x.fillRect(0, 0, s, s * 0.5);
  // Sun
  const sx = s * 0.45, sy = s * 0.38;
  const gl = x.createRadialGradient(sx, sy, 0, sx, sy, s * 0.2);
  gl.addColorStop(0, 'rgba(255,235,200,0.9)'); gl.addColorStop(0.2, 'rgba(255,200,140,0.4)');
  gl.addColorStop(1, 'rgba(255,160,100,0)');
  x.fillStyle = gl; x.fillRect(0, 0, s, s * 0.5);
  x.fillStyle = '#fff0d0'; x.beginPath(); x.arc(sx, sy, s * 0.035, 0, Math.PI * 2); x.fill();
  // Water
  const w = x.createLinearGradient(0, s * 0.5, 0, s);
  w.addColorStop(0, '#2a5a7a'); w.addColorStop(0.3, '#1a4a6a');
  w.addColorStop(0.7, '#0d3a5a'); w.addColorStop(1, '#082a4a');
  x.fillStyle = w; x.fillRect(0, s * 0.5, s, s * 0.5);
  // Reflection shimmer
  x.globalAlpha = 0.15;
  for (let i = 0; i < 40; i++) {
    const ry = s * 0.52 + i * s * 0.012;
    const rw = s * 0.04 + Math.sin(i * 0.7) * s * 0.015;
    x.fillStyle = '#f0d4a0';
    x.fillRect(sx + Math.sin(i * 1.3) * s * 0.02 - rw / 2, ry, rw, s * 0.004);
  }
  x.globalAlpha = 1;
  // Wave hints
  x.strokeStyle = 'rgba(100,160,200,0.1)'; x.lineWidth = 0.5;
  for (let i = 0; i < 20; i++) {
    const wy = s * 0.55 + i * s * 0.022;
    x.beginPath();
    for (let px = 0; px < s; px += 4) {
      const py = wy + Math.sin(px * 0.02 + i * 2) * 2;
      px === 0 ? x.moveTo(px, py) : x.lineTo(px, py);
    }
    x.stroke();
  }
  return toTexture(c);
}

function drawPullQuotePage(s: number): THREE.CanvasTexture {
  const [c, x] = createCanvas(s);
  x.fillStyle = '#f5f0e8'; x.fillRect(0, 0, s, s);
  const cx = s / 2;
  // Large opening quote mark
  x.fillStyle = 'rgba(212,165,116,0.25)';
  x.font = `${s * 0.25}px Georgia, serif`;
  x.textAlign = 'center'; x.fillText('\u201C', cx, s * 0.35);
  // Quote
  x.fillStyle = '#2c2c2c';
  x.font = `italic ${s * 0.038}px Georgia, serif`;
  x.fillText('Not all those who', cx, s * 0.48);
  x.fillText('wander are lost.', cx, s * 0.535);
  x.fillStyle = '#8a8a8a';
  x.font = `${s * 0.024}px Georgia, serif`;
  x.fillText('\u2014 J.R.R. Tolkien', cx, s * 0.65);
  x.strokeStyle = '#c0b8a8'; x.lineWidth = 0.5;
  x.beginPath(); x.moveTo(s * 0.35, s * 0.72); x.lineTo(s * 0.65, s * 0.72); x.stroke();
  return toTexture(c);
}

function drawColophonPage(s: number): THREE.CanvasTexture {
  const [c, x] = createCanvas(s);
  x.fillStyle = '#faf6f0'; x.fillRect(0, 0, s, s);
  x.fillStyle = '#8a8a8a';
  x.font = `${s * 0.022}px Georgia, serif`;
  x.textAlign = 'center';
  const lines = [
    'This book was set in Georgia',
    'and rendered in Three.js.',
    '',
    'Page-turn physics by vertex shader.',
    'Bend envelope: sin(2\u03C6), A\u2009=\u20090.4',
    '',
    'First edition, MMXXVI',
    '',
    '\u25C6',
  ];
  let y = s * 0.4;
  for (const l of lines) { if (l === '') { y += s * 0.03; continue; } x.fillText(l, s / 2, y); y += s * 0.04; }
  return toTexture(c);
}

// ── Text-heavy pages (cream bg, dark text — showcases crease visibility) ────

function drawProsePage(s: number): THREE.CanvasTexture {
  const [c, x] = createCanvas(s);
  x.fillStyle = '#faf6f0'; x.fillRect(0, 0, s, s);
  const m = s * 0.1;

  // Chapter heading
  x.fillStyle = '#2c2c2c';
  x.font = `italic ${s * 0.04}px Georgia, serif`;
  x.textAlign = 'center';
  x.fillText('Chapter One', s / 2, s * 0.12);
  x.strokeStyle = '#c0b8a8'; x.lineWidth = 0.4;
  x.beginPath(); x.moveTo(s * 0.3, s * 0.155); x.lineTo(s * 0.7, s * 0.155); x.stroke();

  // Body text
  x.fillStyle = '#3a3a3a';
  x.font = `${s * 0.024}px Georgia, serif`;
  x.textAlign = 'left';
  const paras = [
    'The morning light came in through the',
    'train window like something remembered',
    'rather than seen. Outside, the hills of',
    'Tuscany rolled past in their ancient',
    'colours \u2014 ochre, sienna, the deep green',
    'of cypress trees standing like sentinels',
    'along every ridge.',
    '',
    'She had not planned to come here. The',
    'ticket had been bought on impulse, at',
    'a kiosk in Z\u00fcrich, while rain streaked',
    'the glass and the departure board',
    'flickered with destinations she could',
    'not pronounce. Florence had seemed',
    'warm and possible.',
    '',
    'Now the train slowed, and the city',
    'appeared in fragments: a dome, a tower,',
    'terracotta rooftops cascading toward',
    'the river. She closed her notebook and',
    'pressed her forehead to the cool glass.',
    'The journey, she realised, had already',
    'begun long before Budapest.',
  ];
  let y = s * 0.21;
  const lh = s * 0.03;
  for (const l of paras) {
    if (l === '') { y += lh * 0.5; continue; }
    x.fillText(l, m, y); y += lh;
  }

  // Page number
  x.fillStyle = '#b0a898';
  x.font = `${s * 0.018}px Georgia, serif`;
  x.textAlign = 'center';
  x.fillText('9', s / 2, s * 0.95);
  return toTexture(c);
}

function drawProsePage2(s: number): THREE.CanvasTexture {
  const [c, x] = createCanvas(s);
  x.fillStyle = '#faf6f0'; x.fillRect(0, 0, s, s);
  const m = s * 0.1;

  x.fillStyle = '#3a3a3a';
  x.font = `${s * 0.024}px Georgia, serif`;
  x.textAlign = 'left';
  const paras = [
    'The piazza was almost empty at that',
    'hour. A waiter arranged chairs outside',
    'a caf\u00e9 with the unhurried precision of',
    'someone who has done this ten thousand',
    'times. She ordered an espresso and sat',
    'facing the Duomo.',
    '',
    'Travel, she had come to understand, was',
    'not about the places. It was about the',
    'particular quality of attention that',
    'unfamiliar streets demand \u2014 the way you',
    'notice the angle of light on stone, the',
    'sound of footsteps in a narrow alley,',
    'the weight of bread in your hand.',
    '',
    'She opened her notebook again. The',
    'pages were half-filled with sketches',
    'and half-sentences, fragments of',
    'conversations overheard in languages',
    'she was only beginning to understand.',
    'On the facing page, a watercolour of',
    'the Arno at dusk \u2014 the bridge a dark',
    'line, the sky all rose and copper.',
    '',
    'Tomorrow she would take the slow train',
    'south. But for now, this moment: the',
    'coffee, the light, the stone.',
  ];
  let y = s * 0.1;
  const lh = s * 0.03;
  for (const l of paras) {
    if (l === '') { y += lh * 0.5; continue; }
    x.fillText(l, m, y); y += lh;
  }

  // Page number
  x.fillStyle = '#b0a898';
  x.font = `${s * 0.018}px Georgia, serif`;
  x.textAlign = 'center';
  x.fillText('10', s / 2, s * 0.95);
  return toTexture(c);
}

// ── Unsplash image loader ────────────────────────────────────────────────────

function loadUnsplashTexture(): THREE.Texture {
  const loader = new THREE.TextureLoader();
  const texture = loader.load(
    'https://images.unsplash.com/photo-1507041957456-9c397ce39c97?w=1024&h=1024&fit=crop&q=80',
  );
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

// ── Vimeo video spread (direct CDN stream drawn to canvas like BBB) ──────────

let _vimeoVideo: HTMLVideoElement | null = null;

/** Returns the Vimeo <video> element (available after generateBookTextures). */
export function getVimeoVideo(): HTMLVideoElement | null {
  return _vimeoVideo;
}

function createVimeoVideoTextures(s: number): { left: THREE.Texture; right: THREE.Texture } {
  const video = document.createElement('video');
  _vimeoVideo = video;
  video.src = '/videos/freight-rail.mp4';
  video.crossOrigin = 'anonymous';
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';

  const leftCanvas  = document.createElement('canvas');
  leftCanvas.width = s; leftCanvas.height = s;
  const rightCanvas = document.createElement('canvas');
  rightCanvas.width = s; rightCanvas.height = s;

  const leftCtx  = leftCanvas.getContext('2d')!;
  const rightCtx = rightCanvas.getContext('2d')!;
  leftCtx.fillStyle  = '#000'; leftCtx.fillRect(0, 0, s, s);
  rightCtx.fillStyle = '#000'; rightCtx.fillRect(0, 0, s, s);

  const leftTex  = toTexture(leftCanvas);
  const rightTex = toTexture(rightCanvas);
  leftTex.generateMipmaps  = false;
  rightTex.generateMipmaps = false;
  leftTex.minFilter  = THREE.LinearFilter;
  rightTex.minFilter = THREE.LinearFilter;

  // Helper: paint a source (image or video) full-bleed across the two page canvases.
  function paintSpread(source: CanvasImageSource, aspect: number) {
    // Each canvas pixel spans 1/s in X and 1.4/s in Y on the page geometry,
    // so multiply by 1.4 to compensate for the vertical stretch.
    const correctedAspect = aspect * 1.4;
    const totalW = 2 * s;
    let drawW = totalW;
    let drawH = drawW / correctedAspect;
    if (drawH > s) { drawH = s; drawW = drawH * correctedAspect; }
    const offsetX = (totalW - drawW) / 2;
    const offsetY = (s - drawH) / 2;

    leftCtx.fillStyle  = '#000'; leftCtx.fillRect(0, 0, s, s);
    leftCtx.drawImage(source, offsetX, offsetY, drawW, drawH);
    rightCtx.fillStyle = '#000'; rightCtx.fillRect(0, 0, s, s);
    rightCtx.drawImage(source, offsetX - s, offsetY, drawW, drawH);

    leftTex.needsUpdate  = true;
    rightTex.needsUpdate = true;
  }

  // Frame-sync loop: once the video has data, draw each frame to the canvases.
  function update() {
    requestAnimationFrame(update);
    if (video.readyState < 2) return;
    paintSpread(video, video.videoWidth / video.videoHeight);
  }
  requestAnimationFrame(update);

  return { left: leftTex, right: rightTex };
}

// ── Video spread (Big Buck Bunny, native 16:9 across two pages) ──────────────

function createVideoSpreadTextures(s: number): { left: THREE.Texture; right: THREE.Texture } {
  const video = document.createElement('video');
  video.src = 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4';
  video.crossOrigin = 'anonymous';
  video.loop = true;
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  video.play().catch(() => {
    const resume = () => { video.play(); document.removeEventListener('pointerdown', resume); };
    document.addEventListener('pointerdown', resume);
  });

  const leftCanvas  = document.createElement('canvas');
  leftCanvas.width = s; leftCanvas.height = s;
  const rightCanvas = document.createElement('canvas');
  rightCanvas.width = s; rightCanvas.height = s;

  const leftTex  = toTexture(leftCanvas);
  const rightTex = toTexture(rightCanvas);
  leftTex.generateMipmaps  = false;
  rightTex.generateMipmaps = false;
  leftTex.minFilter  = THREE.LinearFilter;
  rightTex.minFilter = THREE.LinearFilter;

  const leftCtx  = leftCanvas.getContext('2d')!;
  const rightCtx = rightCanvas.getContext('2d')!;

  function update() {
    requestAnimationFrame(update);
    if (video.readyState < 2) return;

    const videoAspect = video.videoWidth / video.videoHeight;
    // Each canvas pixel spans 1/s in X and 1.4/s in Y on the page geometry,
    // so multiply by 1.4 to compensate for the vertical stretch.
    const correctedAspect = videoAspect * 1.4;
    const totalW = 2 * s;
    let drawW = totalW;
    let drawH = drawW / correctedAspect;
    if (drawH > s) { drawH = s; drawW = drawH * correctedAspect; }

    const offsetX = (totalW - drawW) / 2;
    const offsetY = (s - drawH) / 2;

    leftCtx.fillStyle  = '#000'; leftCtx.fillRect(0, 0, s, s);
    leftCtx.drawImage(video, offsetX, offsetY, drawW, drawH);

    rightCtx.fillStyle = '#000'; rightCtx.fillRect(0, 0, s, s);
    rightCtx.drawImage(video, offsetX - s, offsetY, drawW, drawH);

    leftTex.needsUpdate  = true;
    rightTex.needsUpdate = true;
  }
  requestAnimationFrame(update);

  return { left: leftTex, right: rightTex };
}

// ── Public API ───────────────────────────────────────────────────────────────

export function generateBookTextures(
  numPages: number,
  textureSize: number = 1024
): Map<string, THREE.Texture> {
  const textures = new Map<string, THREE.Texture>();
  const s = textureSize;

  // Covers + endpapers
  textures.set('cover_front_ext', drawFrontCover(s));
  textures.set('cover_front_int', drawEndpaper(s));
  textures.set('cover_back_int',  drawEndpaper(s));
  textures.set('cover_back_ext',  drawBackCover(s));

  // Big Buck Bunny full spread at native 16:9 (p4 left, p5 right)
  const bbb = createVideoSpreadTextures(s);
  textures.set('p4', bbb.left);
  textures.set('p5', bbb.right);

  // Vimeo video spread (p8 left, p9 right) — live frames drawn to canvas.
  const vimeo = createVimeoVideoTextures(s);
  textures.set('p8', vimeo.left);
  textures.set('p9', vimeo.right);

  // Interior pages — specific designs, with colophon fallback
  const designs = new Map<number, () => THREE.Texture>([
    [1, () => drawTitlePage(s)],
    [2, () => drawPoemPage(s)],
    [3, () => loadUnsplashTexture()],
    // p4, p5 set above (BBB video spread)
    [6, () => drawPullQuotePage(s)],
    [7, () => drawOceanSunrise(s)],
    // p8, p9 set above (Vimeo thumbnail spread)
    [10, () => drawProsePage(s)],
    [11, () => drawProsePage2(s)],
  ]);

  for (let i = 1; i <= numPages; i++) {
    if (textures.has(`p${i}`)) continue;  // already set (BBB spread)
    const factory = designs.get(i);
    textures.set(`p${i}`, factory ? factory() : drawColophonPage(s));
  }

  return textures;
}
