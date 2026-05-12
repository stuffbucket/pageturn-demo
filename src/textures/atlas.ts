/**
 * atlas.ts - Rich texture generation for the book demo
 *
 * Generates procedural covers, endpapers, text pages, landscape scenes,
 * geometric art, and a Big Buck Bunny video texture.
 */

import * as THREE from 'three';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Page aspect ratio: width 1.0, height 1.4. */
const PAGE_ASPECT = 1.4;

/**
 * Create a canvas whose coordinate system compensates for the page's 1:1.4
 * aspect stretch.  We apply ctx.scale(PAGE_ASPECT, 1) so that text and shapes
 * are drawn wider by 1.4× on the canvas; the page geometry's vertical stretch
 * then produces characters with correct proportions.
 *
 * Returns [canvas, ctx, w] where w = s / PAGE_ASPECT is the effective drawing
 * width.  Use `w` for all X/width dimensions; use `s` for Y/height/font sizes.
 */
function createCanvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D, number] {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(PAGE_ASPECT, 1);
  return [canvas, ctx, size / PAGE_ASPECT];
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
  const [c, x, w] = createCanvas(s);

  // Deep teal-to-navy gradient
  const bg = x.createLinearGradient(0, 0, w * 0.3, s);
  bg.addColorStop(0, '#1b3a4b');
  bg.addColorStop(0.5, '#0d253a');
  bg.addColorStop(1, '#0a1628');
  x.fillStyle = bg;
  x.fillRect(0, 0, w, s);

  // Subtle linen texture
  x.globalAlpha = 0.04;
  for (let y = 0; y < s; y += 3) { x.fillStyle = '#fff'; x.fillRect(0, y, w, 1); }
  x.globalAlpha = 1;

  const cx = w / 2;
  const gold = '#d4a574';
  const goldL = '#e8c99b';

  // Top rule with diamond
  x.strokeStyle = gold; x.lineWidth = 1.5;
  x.beginPath(); x.moveTo(w * 0.15, s * 0.22); x.lineTo(w * 0.85, s * 0.22); x.stroke();
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
  x.beginPath(); x.moveTo(w * 0.25, s * 0.48); x.lineTo(w * 0.75, s * 0.48); x.stroke();

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
  const [c, x, w] = createCanvas(s);
  const bg = x.createLinearGradient(w * 0.7, 0, 0, s);
  bg.addColorStop(0, '#1b3a4b'); bg.addColorStop(0.5, '#0d253a'); bg.addColorStop(1, '#0a1628');
  x.fillStyle = bg; x.fillRect(0, 0, w, s);
  x.globalAlpha = 0.04;
  for (let y = 0; y < s; y += 3) { x.fillStyle = '#fff'; x.fillRect(0, y, w, 1); }
  x.globalAlpha = 1;
  const cx = w / 2;
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
  const [c, x, w] = createCanvas(s);
  x.fillStyle = '#e8ddd0'; x.fillRect(0, 0, w, s);
  // Marbled pattern — overlapping translucent circles
  const cols = ['#c4724e', '#8b6f4e', '#a0845c', '#d4a574', '#6b4c3b'];
  x.globalAlpha = 0.06;
  for (let i = 0; i < 120; i++) {
    x.fillStyle = cols[i % cols.length];
    x.beginPath();
    x.arc((i * 137.5) % w, (i * 97.3 + 43) % s, 20 + (i * 23 % 80), 0, Math.PI * 2);
    x.fill();
  }
  x.globalAlpha = 0.03; x.strokeStyle = '#6b4c3b'; x.lineWidth = 0.5;
  for (let i = 0; i < w; i += 8) {
    x.beginPath(); x.moveTo(i, 0); x.lineTo(i + w * 0.2, s); x.stroke();
  }
  x.globalAlpha = 1;
  return toTexture(c);
}

// ── Interior pages ───────────────────────────────────────────────────────────

function drawTitlePage(s: number): THREE.CanvasTexture {
  const [c, x, w] = createCanvas(s);
  x.fillStyle = '#faf6f0'; x.fillRect(0, 0, w, s);
  const cx = w / 2;
  x.strokeStyle = '#c0b8a8'; x.lineWidth = 0.5;
  x.beginPath(); x.moveTo(w * 0.2, s * 0.15); x.lineTo(w * 0.8, s * 0.15); x.stroke();
  x.fillStyle = '#2c2c2c';
  x.font = `300 ${s * 0.08}px Georgia, serif`;
  x.textAlign = 'center'; x.fillText('WANDERLUST', cx, s * 0.32);
  x.strokeStyle = '#c0b8a8'; x.lineWidth = 0.5;
  x.beginPath(); x.moveTo(w * 0.35, s * 0.38); x.lineTo(w * 0.65, s * 0.38); x.stroke();
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
  const [c, x, w] = createCanvas(s);
  x.fillStyle = '#faf6f0'; x.fillRect(0, 0, w, s);
  const cx = w / 2;
  const m = w * 0.12;
  x.fillStyle = '#2c2c2c';
  x.font = `italic ${s * 0.035}px Georgia, serif`;
  x.textAlign = 'center';
  x.fillText('The Road Not Taken', cx, s * 0.12);
  x.strokeStyle = '#c0b8a8'; x.lineWidth = 0.3;
  x.beginPath(); x.moveTo(w * 0.3, s * 0.16); x.lineTo(w * 0.7, s * 0.16); x.stroke();

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
  x.fillText('\u2014 Robert Frost, 1916', w - m, s * 0.9);
  return toTexture(c);
}

function drawPullQuotePage(s: number): THREE.CanvasTexture {
  const [c, x, w] = createCanvas(s);
  x.fillStyle = '#f5f0e8'; x.fillRect(0, 0, w, s);
  const cx = w / 2;
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
  x.beginPath(); x.moveTo(w * 0.35, s * 0.72); x.lineTo(w * 0.65, s * 0.72); x.stroke();
  return toTexture(c);
}

function drawColophonPage(s: number): THREE.CanvasTexture {
  const [c, x, w] = createCanvas(s);
  x.fillStyle = '#faf6f0'; x.fillRect(0, 0, w, s);
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
  for (const l of lines) { if (l === '') { y += s * 0.03; continue; } x.fillText(l, w / 2, y); y += s * 0.04; }
  return toTexture(c);
}

// ── Text-heavy pages (cream bg, dark text — showcases crease visibility) ────

function drawProsePage(s: number): THREE.CanvasTexture {
  const [c, x, w] = createCanvas(s);
  x.fillStyle = '#faf6f0'; x.fillRect(0, 0, w, s);
  const m = w * 0.1;

  // Chapter heading
  x.fillStyle = '#2c2c2c';
  x.font = `italic ${s * 0.04}px Georgia, serif`;
  x.textAlign = 'center';
  x.fillText('Chapter One', w / 2, s * 0.12);
  x.strokeStyle = '#c0b8a8'; x.lineWidth = 0.4;
  x.beginPath(); x.moveTo(w * 0.3, s * 0.155); x.lineTo(w * 0.7, s * 0.155); x.stroke();

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
  x.fillText('9', w / 2, s * 0.95);
  return toTexture(c);
}

function drawProsePage2(s: number): THREE.CanvasTexture {
  const [c, x, w] = createCanvas(s);
  x.fillStyle = '#faf6f0'; x.fillRect(0, 0, w, s);
  const m = w * 0.1;

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
  x.fillText('10', w / 2, s * 0.95);
  return toTexture(c);
}

// ── Table of Contents ────────────────────────────────────────────────────────

function drawTocPage(s: number): THREE.CanvasTexture {
  const [c, x, w] = createCanvas(s);
  x.fillStyle = '#faf6f0';
  x.fillRect(0, 0, w, s);

  const m = w * 0.12;

  // Title
  x.fillStyle = '#2c2c2c';
  x.font = `300 ${s * 0.05}px Georgia, serif`;
  x.textAlign = 'left';
  x.fillText('Contents', m, s * 0.15);

  // Decorative rule
  x.strokeStyle = '#c9b99a';
  x.lineWidth = s * 0.001;
  x.beginPath();
  x.moveTo(m, s * 0.19);
  x.lineTo(w - m, s * 0.19);
  x.stroke();

  const entries: [string, string, string][] = [
    ['I',   'Typography & Imagery',  '4'],
    ['II',  'Video Textures',        '8'],
    ['III', 'Production Video',      '12'],
    ['IV',  'The Formalization',     '16'],
  ];

  let y = s * 0.30;
  for (const [num, title, page] of entries) {
    // Section number
    x.fillStyle = '#8a7a68';
    x.font = `italic ${s * 0.022}px Georgia, serif`;
    x.textAlign = 'left';
    x.fillText(num, m, y);

    // Title
    x.fillStyle = '#2c2c2c';
    x.font = `${s * 0.028}px Georgia, serif`;
    x.fillText(title, m + w * 0.08, y);

    // Dot leader
    x.fillStyle = '#c9b99a';
    x.font = `${s * 0.018}px Georgia, serif`;
    const titleW = x.measureText(title).width;
    const startX = m + w * 0.08 + titleW + w * 0.02;
    const endX = w - m - w * 0.04;
    let dx = startX;
    while (dx < endX) {
      x.fillText('\u00B7', dx, y);
      dx += w * 0.015;
    }

    // Page number
    x.fillStyle = '#5a5048';
    x.font = `${s * 0.024}px Georgia, serif`;
    x.textAlign = 'right';
    x.fillText(page, w - m, y);
    x.textAlign = 'left';

    y += s * 0.10;
  }

  return toTexture(c);
}

// ── Section Introduction Pages ───────────────────────────────────────────────

interface SectionIntroConfig {
  number: string;
  title: string;
  subtitle: string;
  nutgraph: string[];
  detail: string[];
}

function drawSectionIntroPage(s: number, config: SectionIntroConfig): THREE.CanvasTexture {
  const [c, x, w] = createCanvas(s);
  x.fillStyle = '#faf6f0';
  x.fillRect(0, 0, w, s);

  const m = w * 0.12;          // Vignelli: generous, consistent margins
  const right = w - m;

  // Top rule
  x.strokeStyle = '#c9b99a';
  x.lineWidth = s * 0.002;
  x.beginPath();
  x.moveTo(m, s * 0.12);
  x.lineTo(right, s * 0.12);
  x.stroke();

  // Section number — large, right-aligned
  x.fillStyle = '#c9b99a';
  x.font = `${s * 0.07}px Helvetica Neue, Helvetica, Arial, sans-serif`;
  x.textAlign = 'right';
  x.fillText(config.number, right, s * 0.24);

  // Title — bold sans-serif, one or two lines max
  x.fillStyle = '#2a2520';
  x.font = `bold ${s * 0.050}px Helvetica Neue, Helvetica, Arial, sans-serif`;
  x.textAlign = 'left';
  const titleLines = config.title.split('&').length > 1
    ? config.title.split(' & ').reduce((acc: string[], _, i, arr) => {
        if (i === 0) acc.push(arr[0] + ' &');
        if (i === 1) acc.push(arr[1]);
        return acc;
      }, [])
    : [config.title];
  let ty = s * 0.34;
  for (const line of titleLines) {
    x.fillText(line, m, ty);
    ty += s * 0.06;
  }

  // Subtitle
  x.fillStyle = '#6a6058';
  x.font = `italic ${s * 0.024}px Georgia, serif`;
  x.fillText(config.subtitle, m, ty + s * 0.01);

  // Divider
  x.strokeStyle = '#c9b99a';
  x.lineWidth = s * 0.001;
  const divY = ty + s * 0.05;
  x.beginPath();
  x.moveTo(m, divY);
  x.lineTo(m + w * 0.18, divY);
  x.stroke();

  // Nutgraph — the key insight
  x.fillStyle = '#3a3530';
  x.font = `italic ${s * 0.022}px Georgia, serif`;
  let ny = divY + s * 0.06;
  const nlh = s * 0.030;
  for (const l of config.nutgraph) {
    if (l === '') { ny += nlh * 0.3; continue; }
    x.fillText(l, m, ny);
    ny += nlh;
  }

  // Detail — compact body text
  x.fillStyle = '#6a6560';
  x.font = `${s * 0.019}px Georgia, serif`;
  let dy = ny + s * 0.025;
  const dlh = s * 0.026;
  for (const l of config.detail) {
    if (l === '') { dy += dlh * 0.3; continue; }
    x.fillText(l, m, dy);
    dy += dlh;
  }

  // Bottom rule
  x.strokeStyle = '#c9b99a';
  x.lineWidth = s * 0.002;
  x.beginPath();
  x.moveTo(m, s * 0.90);
  x.lineTo(right, s * 0.90);
  x.stroke();

  return toTexture(c);
}

function drawSection1Intro(s: number): THREE.CanvasTexture {
  return drawSectionIntroPage(s, {
    number: 'I',
    title: 'Typography & Imagery',
    subtitle: 'The book as a vessel for the written word',
    nutgraph: [
      'A digital book must first succeed',
      'as a book \u2014 the typography, the',
      'rhythm of prose against white space.',
    ],
    detail: [
      'Canvas textures carry Georgia serif at',
      'full resolution, with careful leading and',
      'a warm parchment ground.',
      '',
      'An Unsplash photograph proves raster',
      'imagery integrates seamlessly with the',
      'procedurally-generated pages.',
    ],
  });
}

function drawSection2Intro(s: number): THREE.CanvasTexture {
  return drawSectionIntroPage(s, {
    number: 'II',
    title: 'Video Textures',
    subtitle: 'Motion pictures imbued into paper',
    nutgraph: [
      'Each frame of video is drawn into the',
      'page\u2019s canvas texture, so it curls',
      'with the paper itself.',
    ],
    detail: [
      'Big Buck Bunny streams as a direct MP4,',
      'drawn via drawImage at 60 fps across',
      'two page surfaces.',
      '',
      'The video bends during page turns \u2014',
      'not a flat overlay, but ink that moves.',
    ],
  });
}

function drawSection3Intro(s: number): THREE.CanvasTexture {
  return drawSectionIntroPage(s, {
    number: 'III',
    title: 'Production Video',
    subtitle: 'From the studio to the spread',
    nutgraph: [
      'Freight Rail Works \u201CTrailblazer\u201D by',
      'Loop \u2014 a CG data-visualization',
      'piece served as a local MP4.',
    ],
    detail: [
      'The camera zooms in when the spread',
      'is reached, synced to the video\u2019s own',
      'timeline. Zoom in over 3 s, hold,',
      'then ease back at the 22 s mark.',
    ],
  });
}

function drawSection4Intro(s: number): THREE.CanvasTexture {
  return drawSectionIntroPage(s, {
    number: 'IV',
    title: 'The Formalization',
    subtitle: 'Mathematics behind the curl',
    nutgraph: [
      'Five equations govern every bend:',
      'progress-to-angle, vertex displacement,',
      'physics settle, animation, and shadow.',
    ],
    detail: [
      'The facing page reproduces the reference',
      'sheet from contrib/, rendered at 3\u00D7.',
      '',
      'Key constraint: A < 0.5 ensures the',
      'free edge never reverses direction.',
    ],
  });
}

// ── PDF rendered page (loads pre-rendered PNG of the PDF) ─────────────────────

function loadPdfPageTexture(): THREE.Texture {
  const loader = new THREE.TextureLoader();
  const texture = loader.load('/images/pagecurl-full.png');
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

// ── Preface page (facing the TOC) ────────────────────────────────────────────

function drawPrefacePage(s: number): THREE.CanvasTexture {
  const [c, x, w] = createCanvas(s);
  x.fillStyle = '#faf6f0';
  x.fillRect(0, 0, w, s);

  const cx = w / 2;
  const m = w * 0.12;

  x.fillStyle = '#8a7a68';
  x.font = `italic ${s * 0.026}px Georgia, serif`;
  x.textAlign = 'center';
  x.fillText('Preface', cx, s * 0.15);

  x.strokeStyle = '#c9b99a';
  x.lineWidth = s * 0.001;
  x.beginPath();
  x.moveTo(w * 0.35, s * 0.19);
  x.lineTo(w * 0.65, s * 0.19);
  x.stroke();

  x.fillStyle = '#3a3530';
  x.font = `${s * 0.022}px Georgia, serif`;
  x.textAlign = 'left';
  const lines = [
    'This book is a technical demonstration',
    'of real-time page-turn rendering in the',
    'browser, built with Three.js and custom',
    'GLSL shaders.',
    '',
    'Every page you see — text, images, and',
    'video — is a canvas texture mapped onto',
    '3D geometry. When a page turns, a vertex',
    'shader bends it along a cylinder whose',
    'axis sweeps from spine to edge.',
    '',
    'The four sections that follow showcase',
    'increasing complexity: static typography,',
    'looping video textures, a produced',
    'commercial with synchronized camera',
    'animation, and finally the mathematical',
    'formalization that governs every curl.',
    '',
    'Drag any page to turn it, or use',
    'the arrow keys.',
  ];
  let y = s * 0.28;
  const lh = s * 0.03;
  for (const l of lines) {
    if (l === '') { y += lh * 0.5; continue; }
    x.fillText(l, m, y);
    y += lh;
  }

  return toTexture(c);
}

// ── Video info pages (right side of video section intro spreads) ─────────────

function drawBBBInfoPage(s: number): THREE.CanvasTexture {
  const [c, x, w] = createCanvas(s);
  x.fillStyle = '#faf6f0';
  x.fillRect(0, 0, w, s);

  const m = w * 0.1;

  x.fillStyle = '#c9b99a';
  x.font = `${s * 0.018}px Georgia, serif`;
  x.textAlign = 'left';
  x.fillText('DEMONSTRATION', m, s * 0.12);

  x.fillStyle = '#2a2520';
  x.font = `bold ${s * 0.036}px Georgia, serif`;
  x.fillText('Big Buck Bunny', m, s * 0.20);

  x.strokeStyle = '#c9b99a';
  x.lineWidth = s * 0.001;
  x.beginPath();
  x.moveTo(m, s * 0.24);
  x.lineTo(m + w * 0.30, s * 0.24);
  x.stroke();

  x.fillStyle = '#5a5048';
  x.font = `italic ${s * 0.021}px Georgia, serif`;
  x.fillText('Blender Foundation, 2008', m, s * 0.30);

  x.fillStyle = '#3a3530';
  x.font = `${s * 0.020}px Georgia, serif`;
  const lines = [
    'An open-source animated short served',
    'as a direct MP4 stream from the local',
    'public/ directory.',
    '',
    'Each frame is drawn to two canvas',
    'textures via drawImage(), splitting',
    'the 16:9 frame across the left and',
    'right page surfaces.',
    '',
    'The video loops continuously. Because',
    'the frames are part of the page',
    'texture, they curl and bend with the',
    'paper during a page turn \u2014 not a',
    'flat overlay floating above the book.',
    '',
    'Turn the page to see it in action.',
  ];
  let y = s * 0.38;
  const lh = s * 0.028;
  for (const l of lines) {
    if (l === '') { y += lh * 0.4; continue; }
    x.fillText(l, m, y);
    y += lh;
  }

  // Small technical note
  x.fillStyle = '#8a7a68';
  x.font = `italic ${s * 0.016}px Georgia, serif`;
  x.fillText('Source: archive.org/details/BigBuckBunny_124', m, s * 0.88);

  return toTexture(c);
}

function drawVimeoCreditsPage(s: number): THREE.CanvasTexture {
  const [c, x, w] = createCanvas(s);
  x.fillStyle = '#faf6f0';
  x.fillRect(0, 0, w, s);

  const m = w * 0.1;

  x.fillStyle = '#c9b99a';
  x.font = `${s * 0.018}px Georgia, serif`;
  x.textAlign = 'left';
  x.fillText('PRODUCTION', m, s * 0.12);

  x.fillStyle = '#2a2520';
  x.font = `bold ${s * 0.032}px Georgia, serif`;
  x.fillText('Freight Rail Works', m, s * 0.20);
  x.fillText('\u201CTrailblazer\u201D', m, s * 0.26);

  x.strokeStyle = '#c9b99a';
  x.lineWidth = s * 0.001;
  x.beginPath();
  x.moveTo(m, s * 0.30);
  x.lineTo(m + w * 0.30, s * 0.30);
  x.stroke();

  x.fillStyle = '#5a5048';
  x.font = `italic ${s * 0.020}px Georgia, serif`;
  x.fillText('Aggressive / Loop, 2020', m, s * 0.36);

  x.fillStyle = '#3a3530';
  x.font = `${s * 0.018}px Georgia, serif`;
  const credits: [string, string][] = [
    ['Creative Directors', 'Alex Topaller,'],
    ['', 'Daniel Shapiro,'],
    ['', 'Alex Mikhaylov,'],
    ['', 'Max Chelyadnikov'],
    ['Producers', 'Alex Aab, Daniel Shapiro'],
    ['Art Director', 'Alex Mikhalyov'],
    ['CG Supervisor', 'Max Chelyadnikov'],
    ['3D Animator', 'Dmitriy Paukov'],
    ['FX TD', 'Artemy Perevertin,'],
    ['', 'Danil Krivoruchko'],
    ['Compositing', 'Max Chelyadnikov'],
  ];
  let y = s * 0.44;
  const lh = s * 0.026;
  for (const [role, name] of credits) {
    if (role) {
      x.fillStyle = '#8a7a68';
      x.font = `italic ${s * 0.016}px Georgia, serif`;
      x.fillText(role, m, y);
    }
    x.fillStyle = '#3a3530';
    x.font = `${s * 0.018}px Georgia, serif`;
    x.fillText(name, m + w * 0.30, y);
    y += lh;
  }

  // Link
  x.fillStyle = '#8a7a68';
  x.font = `italic ${s * 0.016}px Georgia, serif`;
  x.fillText('myshli.com/project/freight-rail', m, s * 0.88);

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

// Hosted on archive.org — long-stable mirror, serves Access-Control-Allow-Origin: *
// so drawImage(video) into a canvas doesn't taint it.
const BIG_BUCK_BUNNY_URL =
  'https://archive.org/download/BigBuckBunny_124/Content/big_buck_bunny_720p_surround.mp4';

function createVideoSpreadTextures(s: number): { left: THREE.Texture; right: THREE.Texture } {
  // Harness mode: skip the video element and render a static placeholder.
  // The harness page sets <body data-harness="1"> before main.ts boots, so
  // the demo doesn't depend on a remote CDN during automated capture.
  if (typeof document !== 'undefined' && document.body?.dataset.harness === '1') {
    return createVideoPlaceholderTextures(s);
  }

  const video = document.createElement('video');
  video.crossOrigin = 'anonymous';
  video.src = BIG_BUCK_BUNNY_URL;
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

function createVideoPlaceholderTextures(s: number): { left: THREE.Texture; right: THREE.Texture } {
  const draw = (label: 'L' | 'R') => {
    const c = document.createElement('canvas');
    c.width = s; c.height = s;
    const x = c.getContext('2d')!;
    const g = x.createLinearGradient(0, 0, s, s);
    g.addColorStop(0, '#1a2233');
    g.addColorStop(1, '#3a4a66');
    x.fillStyle = g; x.fillRect(0, 0, s, s);
    x.fillStyle = '#c0d0e8';
    x.font = `bold ${s * 0.08}px Georgia, serif`;
    x.textAlign = 'center';
    x.fillText('HARNESS', s / 2, s * 0.45);
    x.font = `${s * 0.04}px Georgia, serif`;
    x.fillText('video disabled', s / 2, s * 0.55);
    x.font = `${s * 0.14}px Georgia, serif`;
    x.fillText(label, s / 2, s * 0.85);
    const t = toTexture(c);
    t.generateMipmaps = false;
    t.minFilter = THREE.LinearFilter;
    return t;
  };
  return { left: draw('L'), right: draw('R') };
}

// ── Texture Pool ─────────────────────────────────────────────────────────────
//
// Instead of generating all textures eagerly (≈ 24 × 1024² × 4 bytes = 96 MB),
// the pool lazily generates them on demand and evicts distant pages.  Video
// textures are always live (they update per frame and can't be evicted).
//
// The pool exposes a Map-compatible .get() interface so Book.ts needs minimal
// changes.  Call retainWindow(j, numLeaves) after every page turn to dispose
// textures outside a ±RADIUS window.

const RETAIN_RADIUS = 3; // keep textures for spreads j ± RADIUS

export class TexturePool {
  private cache = new Map<string, THREE.Texture>();
  private generators = new Map<string, () => THREE.Texture>();
  private live = new Map<string, THREE.Texture>(); // video textures (never evicted)

  constructor(
    generators: Map<string, () => THREE.Texture>,
    live: Map<string, THREE.Texture>,
  ) {
    this.generators = generators;
    this.live = live;
    // Pre-populate cache with live textures so get() always returns them.
    for (const [k, v] of live) this.cache.set(k, v);
  }

  /** Get a texture by page name. Lazily generates if not cached. */
  get(name: string): THREE.Texture | undefined {
    if (this.cache.has(name)) return this.cache.get(name);
    const gen = this.generators.get(name);
    if (!gen) return undefined;
    const tex = gen();
    this.cache.set(name, tex);
    return tex;
  }

  has(name: string): boolean {
    return this.generators.has(name) || this.cache.has(name);
  }

  /**
   * Evict textures outside the ±RETAIN_RADIUS window from spread j.
   * Covers are always retained.  Video textures (live) are never evicted.
   */
  retainWindow(currentJ: number, numLeaves: number): void {
    // Build the set of page names to keep
    const keep = new Set<string>();
    keep.add('cover_front_ext');
    keep.add('cover_front_int');
    keep.add('cover_back_int');
    keep.add('cover_back_ext');

    for (let j = currentJ - RETAIN_RADIUS; j <= currentJ + RETAIN_RADIUS; j++) {
      if (j < -1 || j > numLeaves + 1) continue;
      // Add page names for this spread
      if (j === -1) { /* cover_front_ext already kept */ }
      else if (j === 0) { keep.add('p1'); }
      else if (j >= 1 && j <= numLeaves - 1) { keep.add(`p${2*j}`); keep.add(`p${2*j+1}`); }
      else if (j === numLeaves) { keep.add(`p${2*numLeaves}`); }
      else if (j === numLeaves + 1) { /* cover_back_ext already kept */ }
    }

    for (const [name, tex] of this.cache) {
      if (keep.has(name) || this.live.has(name)) continue;
      tex.dispose();
      this.cache.delete(name);
    }
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

export function generateBookTextures(
  numPages: number,
  textureSize: number = 1024
): TexturePool {
  const s = textureSize;

  // Live textures: video spreads that update every frame and can't be evicted.
  const live = new Map<string, THREE.Texture>();

  const bbb = createVideoSpreadTextures(s);
  live.set('p10', bbb.left);
  live.set('p11', bbb.right);

  const vimeo = createVimeoVideoTextures(s);
  live.set('p14', vimeo.left);
  live.set('p15', vimeo.right);

  // Generator factories: one per page name, called lazily on first access.
  const generators = new Map<string, () => THREE.Texture>();
  generators.set('cover_front_ext', () => drawFrontCover(s));
  generators.set('cover_front_int', () => drawEndpaper(s));
  generators.set('cover_back_int',  () => drawEndpaper(s));
  generators.set('cover_back_ext',  () => drawBackCover(s));

  const designs = new Map<number, () => THREE.Texture>([
    [1,  () => drawTitlePage(s)],
    [2,  () => drawTocPage(s)],
    [3,  () => drawPrefacePage(s)],
    [4,  () => drawSection1Intro(s)],
    [5,  () => drawPoemPage(s)],
    [6,  () => loadUnsplashTexture()],
    [7,  () => drawPullQuotePage(s)],
    [8,  () => drawSection2Intro(s)],
    [9,  () => drawBBBInfoPage(s)],
    // p10, p11 are live (BBB video)
    [12, () => drawSection3Intro(s)],
    [13, () => drawVimeoCreditsPage(s)],
    // p14, p15 are live (Vimeo video)
    [16, () => drawSection4Intro(s)],
    [17, () => loadPdfPageTexture()],
    [18, () => drawProsePage(s)],
    [19, () => drawProsePage2(s)],
  ]);

  for (let i = 1; i <= numPages; i++) {
    const key = `p${i}`;
    if (live.has(key)) continue;
    const factory = designs.get(i);
    generators.set(key, factory ?? (() => drawColophonPage(s)));
  }

  return new TexturePool(generators, live);
}
