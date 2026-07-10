// Procedural textures — everything is drawn in code, no image assets.
import * as THREE from 'three';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function toTexture(c, { repeat = true, srgb = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) { t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping; }
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  return t;
}

// Small deterministic RNG so the city looks the same on every load.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function noiseFill(ctx, w, h, alpha, rng) {
  ctx.save();
  ctx.globalAlpha = alpha;
  for (let i = 0; i < (w * h) / 28; i++) {
    const v = Math.floor(rng() * 255);
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.fillRect(rng() * w, rng() * h, 1.5, 1.5);
  }
  ctx.restore();
}

// ---------------------------------------------------------------- asphalt
export function makeRoadTexture() {
  const rng = mulberry32(11);
  const w = 512, h = 512;
  const c = canvas(w, h), x = c.getContext('2d');

  x.fillStyle = '#4a4b4f';
  x.fillRect(0, 0, w, h);
  noiseFill(x, w, h, 0.10, rng);

  // tire-polished darker bands in each lane
  const grad = (u, spread) => {
    const g = x.createLinearGradient((u - spread) * w, 0, (u + spread) * w, 0);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.5, 'rgba(15,15,18,0.35)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
  };
  grad(0.28, 0.10); grad(0.72, 0.10);

  // edge lines
  x.fillStyle = '#eeeadf';
  x.fillRect(0.035 * w, 0, 9, h);
  x.fillRect(0.965 * w - 9, 0, 9, h);

  // dashed centre line
  for (let y = 0; y < h; y += 128) {
    x.fillRect(w / 2 - 5, y, 10, 72);
  }

  // faint cracks
  x.strokeStyle = 'rgba(0,0,0,0.18)';
  x.lineWidth = 1;
  for (let i = 0; i < 10; i++) {
    x.beginPath();
    let px = rng() * w, py = rng() * h;
    x.moveTo(px, py);
    for (let k = 0; k < 6; k++) { px += (rng() - 0.5) * 60; py += rng() * 40; x.lineTo(px, py); }
    x.stroke();
  }
  return toTexture(c);
}

// ---------------------------------------------------------------- kerb
export function makeKerbTexture() {
  const c = canvas(64, 128), x = c.getContext('2d');
  x.fillStyle = '#d8d3c8'; x.fillRect(0, 0, 64, 128);
  x.fillStyle = '#c23b2e'; x.fillRect(0, 0, 64, 64);
  const g = x.createLinearGradient(0, 0, 64, 0);
  g.addColorStop(0, 'rgba(0,0,0,0.25)');
  g.addColorStop(0.4, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.1)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 128);
  return toTexture(c);
}

// ---------------------------------------------------------------- sidewalk
export function makeSidewalkTexture() {
  const rng = mulberry32(21);
  const c = canvas(256, 256), x = c.getContext('2d');
  x.fillStyle = '#9b978e'; x.fillRect(0, 0, 256, 256);
  noiseFill(x, 256, 256, 0.08, rng);
  x.strokeStyle = 'rgba(60,58,54,0.5)';
  x.lineWidth = 3;
  for (let i = 0; i <= 256; i += 128) {
    x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 256); x.stroke();
    x.beginPath(); x.moveTo(0, i); x.lineTo(256, i); x.stroke();
  }
  return toTexture(c);
}

// ---------------------------------------------------------------- ground (city blocks seen from above)
export function makeGroundTexture() {
  const rng = mulberry32(31);
  const c = canvas(512, 512), x = c.getContext('2d');
  x.fillStyle = '#63615c'; x.fillRect(0, 0, 512, 512);
  noiseFill(x, 512, 512, 0.09, rng);
  // block grid: lighter "streets"
  x.strokeStyle = 'rgba(146,142,134,0.85)';
  x.lineWidth = 10;
  for (let i = 0; i <= 512; i += 256) {
    x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 512); x.stroke();
    x.beginPath(); x.moveTo(0, i); x.lineTo(512, i); x.stroke();
  }
  x.strokeStyle = 'rgba(50,49,46,0.6)';
  x.lineWidth = 2;
  for (let i = 128; i < 512; i += 256) {
    x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 512); x.stroke();
    x.beginPath(); x.moveTo(0, i); x.lineTo(512, i); x.stroke();
  }
  return toTexture(c);
}

// ---------------------------------------------------------------- chain-link fence
export function makeFenceTexture() {
  const c = canvas(128, 128), x = c.getContext('2d');
  x.clearRect(0, 0, 128, 128);
  x.strokeStyle = 'rgba(88,94,102,0.85)';
  x.lineWidth = 1.8;
  const step = 16;
  for (let i = -128; i < 256; i += step) {
    x.beginPath(); x.moveTo(i, 0); x.lineTo(i + 128, 128); x.stroke();
    x.beginPath(); x.moveTo(i + 128, 0); x.lineTo(i, 128); x.stroke();
  }
  const t = toTexture(c, { srgb: true });
  return t;
}

// ---------------------------------------------------------------- building facades
// Daylight look: windows read as darker glass with a sky-reflection gradient.
function facadeBase(w, h, bg) {
  const c = canvas(w, h), x = c.getContext('2d');
  x.fillStyle = bg; x.fillRect(0, 0, w, h);
  return { c, x };
}

function paintWindow(x, px, py, ww, wh, rng, glassTopBias) {
  const refl = 0.35 + rng() * 0.5;
  const g = x.createLinearGradient(px, py, px, py + wh);
  const top = Math.floor(120 + refl * 110 * glassTopBias);
  const bot = Math.floor(38 + refl * 30);
  g.addColorStop(0, `rgb(${top - 20},${top},${top + 18})`);
  g.addColorStop(1, `rgb(${bot},${bot + 6},${bot + 14})`);
  x.fillStyle = g;
  x.fillRect(px, py, ww, wh);
  if (rng() < 0.12) { // blinds / curtains
    x.fillStyle = 'rgba(215,208,190,0.8)';
    x.fillRect(px, py, ww, wh * (0.3 + rng() * 0.5));
  }
}

// Ground-floor storefronts: dark glazing, awnings, signs (drawn at canvas bottom = v0).
function paintStorefront(x, w, h, rng, band = 62) {
  const y0 = h - band;
  x.fillStyle = '#22262c';
  x.fillRect(0, y0, w, band);
  const shops = 5 + Math.floor(rng() * 3);
  const sw = w / shops;
  const awning = ['#7e3f39', '#3d5c48', '#41546e', '#8a7350', '#575463', '#4a4a4a'];
  for (let i = 0; i < shops; i++) {
    const sx = i * sw;
    // window glow of interior
    x.fillStyle = `rgba(255,236,190,${0.10 + rng() * 0.25})`;
    x.fillRect(sx + 6, y0 + 18, sw - 12, band - 24);
    // awning / sign band
    x.fillStyle = awning[Math.floor(rng() * awning.length)];
    x.fillRect(sx + 3, y0, sw - 6, 9);
    // door
    x.fillStyle = 'rgba(10,12,14,0.9)';
    x.fillRect(sx + sw / 2 - 7, y0 + 26, 14, band - 26);
  }
}

// Glass office tower: full curtain wall.
export function makeFacadeGlass() {
  const rng = mulberry32(101);
  const { c, x } = facadeBase(512, 512, '#5e6e7c');
  const cols = 12, rows = 16;
  const cw = 512 / cols, rh = 512 / rows;
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      paintWindow(x, i * cw + 2, j * rh + 2, cw - 4, rh - 4, rng, 1.0);
    }
  }
  // mullion highlights
  x.fillStyle = 'rgba(226,232,238,0.35)';
  for (let i = 0; i <= cols; i++) x.fillRect(i * cw - 1, 0, 2, 512);
  // lobby
  x.fillStyle = '#1d2126';
  x.fillRect(0, 512 - 40, 512, 40);
  x.fillStyle = 'rgba(235,240,244,0.5)';
  x.fillRect(0, 512 - 42, 512, 4);
  return toTexture(c);
}

// Concrete mid-rise with ribbon windows.
export function makeFacadeRibbon() {
  const rng = mulberry32(202);
  const { c, x } = facadeBase(512, 512, '#b3aa9a');
  noiseFill(x, 512, 512, 0.06, rng);
  const rows = 10, rh = 512 / rows;
  for (let j = 0; j < rows; j++) {
    const y0 = j * rh + rh * 0.22;
    const wh = rh * 0.52;
    x.fillStyle = '#2e3844';
    x.fillRect(0, y0, 512, wh);
    for (let i = 0; i < 16; i++) {
      paintWindow(x, i * 32 + 2, y0 + 2, 28, wh - 4, rng, 0.7);
    }
    // spandrel shadow line
    x.fillStyle = 'rgba(0,0,0,0.22)';
    x.fillRect(0, y0 + wh, 512, 4);
  }
  paintStorefront(x, 512, 512, rng);
  return toTexture(c);
}

// Residential: punched windows + balconies on plaster.
export function makeFacadeResidential() {
  const rng = mulberry32(303);
  const { c, x } = facadeBase(512, 512, '#cbb49a');
  noiseFill(x, 512, 512, 0.07, rng);
  const cols = 8, rows = 8;
  const cw = 512 / cols, rh = 512 / rows;
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const px = i * cw + cw * 0.22, py = j * rh + rh * 0.18;
      paintWindow(x, px, py, cw * 0.56, rh * 0.6, rng, 0.55);
      x.strokeStyle = 'rgba(70,60,50,0.6)';
      x.lineWidth = 2;
      x.strokeRect(px, py, cw * 0.56, rh * 0.6);
      if ((i + j * 3) % 4 === 0) { // balcony slab
        x.fillStyle = 'rgba(90,80,70,0.75)';
        x.fillRect(i * cw + cw * 0.12, j * rh + rh * 0.8, cw * 0.76, 6);
      }
    }
  }
  paintStorefront(x, 512, 512, rng, 56);
  return toTexture(c);
}

// ---------------------------------------------------------------- roof
export function makeRoofTexture() {
  const rng = mulberry32(404);
  const c = canvas(128, 128), x = c.getContext('2d');
  x.fillStyle = '#8b8a86'; x.fillRect(0, 0, 128, 128);
  noiseFill(x, 128, 128, 0.12, rng);
  x.fillStyle = 'rgba(60,60,60,0.5)';
  x.fillRect(8, 8, 26, 18);  // AC units
  x.fillRect(80, 60, 30, 22);
  return toTexture(c);
}

// ---------------------------------------------------------------- banner atlas (8 rows)
export const BANNERS = ['START', 'APEX RACING', 'VELOCITA', 'GRAHN GP', 'TURBO+', 'SKYLINE FM', 'NITRO FUEL', 'DRIFT KING'];

export function makeBannerAtlas() {
  const c = canvas(1024, 1024), x = c.getContext('2d');
  const rowH = 128;
  const palette = [
    ['#111111', '#ffffff'],
    ['#c8102e', '#ffffff'],
    ['#0f4c81', '#ffd94a'],
    ['#f2f2f2', '#c8102e'],
    ['#ff7a00', '#101010'],
    ['#20242c', '#5ad1ff'],
    ['#ffd200', '#101010'],
    ['#5b2a86', '#ffffff'],
  ];
  for (let r = 0; r < 8; r++) {
    const y = r * rowH;
    const [bg, fg] = palette[r];
    x.fillStyle = bg;
    x.fillRect(0, y, 1024, rowH);
    if (r === 0) {
      // checkered start banner
      const s = 32;
      for (let i = 0; i < 1024 / s; i++) {
        for (let j = 0; j < rowH / s; j++) {
          if ((i + j) % 2 === 0) { x.fillStyle = '#ffffff'; x.fillRect(i * s, y + j * s, s, s); }
        }
      }
      x.fillStyle = 'rgba(0,0,0,0.72)';
      x.fillRect(212, y + 24, 600, 80);
      x.fillStyle = '#ffffff';
      x.font = 'italic 900 62px system-ui, sans-serif';
      x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText('START', 512, y + 66);
    } else {
      // speed stripes
      x.fillStyle = 'rgba(255,255,255,0.10)';
      for (let i = -2; i < 12; i++) {
        x.beginPath();
        x.moveTo(i * 100, y + rowH); x.lineTo(i * 100 + 60, y);
        x.lineTo(i * 100 + 90, y); x.lineTo(i * 100 + 30, y + rowH);
        x.fill();
      }
      x.fillStyle = fg;
      x.font = 'italic 900 72px system-ui, sans-serif';
      x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText(BANNERS[r], 512, y + 66);
    }
  }
  const t = toTexture(c, { repeat: false });
  return t;
}

// ---------------------------------------------------------------- soft cloud sprite
export function makeCloudTexture() {
  const rng = mulberry32(505);
  const c = canvas(256, 256), x = c.getContext('2d');
  x.clearRect(0, 0, 256, 256);
  for (let i = 0; i < 26; i++) {
    const px = 50 + rng() * 156, py = 90 + rng() * 76;
    const r = 18 + rng() * 34;
    const g = x.createRadialGradient(px, py, 0, px, py, r);
    g.addColorStop(0, 'rgba(255,255,255,0.30)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.beginPath(); x.arc(px, py, r, 0, Math.PI * 2); x.fill();
  }
  const t = toTexture(c, { repeat: false });
  return t;
}
