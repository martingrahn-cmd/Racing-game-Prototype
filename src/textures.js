// Procedural textures — everything is drawn in code, no image assets.
// Facades and the road also generate height-derived normal maps and
// roughness maps so surfaces respond to light like PS3/PS4-era materials.
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

// Tangent-space normal map from a grayscale height canvas (wrapping edges).
function normalFromHeight(hc, strength = 2.5) {
  const w = hc.width, h = hc.height;
  const src = hc.getContext('2d').getImageData(0, 0, w, h).data;
  const out = canvas(w, h);
  const octx = out.getContext('2d');
  const img = octx.createImageData(w, h);
  const H = (x, y) => src[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (H(x - 1, y) - H(x + 1, y)) * strength;
      const dy = (H(x, y + 1) - H(x, y - 1)) * strength; // v is up = canvas y down
      const inv = 1 / Math.hypot(dx, dy, 1);
      const k = (y * w + x) * 4;
      img.data[k] = (dx * inv * 0.5 + 0.5) * 255;
      img.data[k + 1] = (dy * inv * 0.5 + 0.5) * 255;
      img.data[k + 2] = (inv * 0.5 + 0.5) * 255;
      img.data[k + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(out);
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

function gray(v) { return `rgb(${v},${v},${v})`; }

// ---------------------------------------------------------------- asphalt
export function makeRoadTexture() {
  const rng = mulberry32(11);
  const w = 512, h = 512;
  const c = canvas(w, h), x = c.getContext('2d');
  const hc = canvas(w, h), hx = hc.getContext('2d');
  const rc = canvas(w, h), rx = rc.getContext('2d');

  x.fillStyle = '#4a4b4f'; x.fillRect(0, 0, w, h);
  hx.fillStyle = gray(128); hx.fillRect(0, 0, w, h);
  rx.fillStyle = gray(238); rx.fillRect(0, 0, w, h); // rough asphalt

  noiseFill(x, w, h, 0.10, rng);
  noiseFill(hx, w, h, 0.35, rng);

  // tire-polished darker bands in each lane (smoother = subtle sheen)
  const band = (ctx, u, spread, rgba) => {
    const g = ctx.createLinearGradient((u - spread) * w, 0, (u + spread) * w, 0);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.5, rgba);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  };
  band(x, 0.28, 0.10, 'rgba(15,15,18,0.35)');
  band(x, 0.72, 0.10, 'rgba(15,15,18,0.35)');
  band(rx, 0.28, 0.10, 'rgba(150,150,150,0.55)');
  band(rx, 0.72, 0.10, 'rgba(150,150,150,0.55)');

  const paint = (px, py, pw, ph) => {
    x.fillStyle = '#eeeadf'; x.fillRect(px, py, pw, ph);
    hx.fillStyle = gray(150); hx.fillRect(px, py, pw, ph);
    rx.fillStyle = gray(140); rx.fillRect(px, py, pw, ph); // paint is smoother
  };
  // edge lines
  paint(0.035 * w, 0, 9, h);
  paint(0.965 * w - 9, 0, 9, h);
  // dashed centre line
  for (let y = 0; y < h; y += 128) paint(w / 2 - 5, y, 10, 72);

  // faint cracks (grooves in the height map)
  for (let i = 0; i < 10; i++) {
    let px = rng() * w, py = rng() * h;
    const stroke = (ctx, style, lw) => {
      ctx.strokeStyle = style; ctx.lineWidth = lw;
      ctx.beginPath(); ctx.moveTo(px, py);
      let qx = px, qy = py;
      for (let k = 0; k < 6; k++) { qx += (rng() - 0.5) * 60; qy += rng() * 40; ctx.lineTo(qx, qy); }
      ctx.stroke();
    };
    const sx = px, sy = py;
    stroke(x, 'rgba(0,0,0,0.18)', 1);
    px = sx; py = sy;
    stroke(hx, gray(70), 1.5);
  }
  // tar seams (shiny dark lines)
  for (let i = 0; i < 4; i++) {
    const py = rng() * h;
    x.fillStyle = 'rgba(20,20,22,0.5)'; x.fillRect(0, py, w, 3);
    rx.fillStyle = gray(90); rx.fillRect(0, py, w, 3);
  }
  return { map: toTexture(c), normalMap: normalFromHeight(hc, 1.6), roughnessMap: toTexture(rc, { srgb: false }) };
}

// ---------------------------------------------------------------- kerbs
export function makeKerbTexture() { // red/white racing kerb (corners)
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

export function makeConcreteKerbTexture() { // plain city curb (straights)
  const rng = mulberry32(17);
  const c = canvas(64, 128), x = c.getContext('2d');
  x.fillStyle = '#a8a49b'; x.fillRect(0, 0, 64, 128);
  noiseFill(x, 64, 128, 0.09, rng);
  const g = x.createLinearGradient(0, 0, 64, 0);
  g.addColorStop(0, 'rgba(0,0,0,0.3)');
  g.addColorStop(0.4, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.12)');
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
  return toTexture(c);
}

// ---------------------------------------------------------------- building facades
// Each facade produces {map, normalMap, roughnessMap}: windows are recessed
// in the height map and smooth in the roughness map, so they catch sun and sky.
function facadeSet(bg, wallRough = 200) {
  const c = canvas(512, 512), x = c.getContext('2d');
  const hc = canvas(512, 512), hx = hc.getContext('2d');
  const rc = canvas(512, 512), rx = rc.getContext('2d');
  const ec = canvas(512, 512), ex = ec.getContext('2d'); // night-light emissive
  x.fillStyle = bg; x.fillRect(0, 0, 512, 512);
  hx.fillStyle = gray(220); hx.fillRect(0, 0, 512, 512);
  rx.fillStyle = gray(wallRough); rx.fillRect(0, 0, 512, 512);
  ex.fillStyle = '#000000'; ex.fillRect(0, 0, 512, 512);
  return { c, x, hc, hx, rc, rx, ec, ex };
}

const NIGHT_WINDOW_COLORS = ['#ffd27a', '#ffe9b8', '#fff4d8', '#bcd6ff', '#ffc9a0'];

function paintWindow(set, px, py, ww, wh, rng, glassTopBias, glassRough = 45) {
  const { x, hx, rx, ex } = set;
  // ~30% of windows are lit after dark
  if (rng() < 0.3) {
    ex.fillStyle = NIGHT_WINDOW_COLORS[Math.floor(rng() * NIGHT_WINDOW_COLORS.length)];
    ex.globalAlpha = 0.55 + rng() * 0.45;
    ex.fillRect(px, py, ww, wh);
    ex.globalAlpha = 1;
  }
  const refl = 0.35 + rng() * 0.5;
  const g = x.createLinearGradient(px, py, px, py + wh);
  const top = Math.floor(120 + refl * 110 * glassTopBias);
  const bot = Math.floor(38 + refl * 30);
  g.addColorStop(0, `rgb(${top - 20},${top},${top + 18})`);
  g.addColorStop(1, `rgb(${bot},${bot + 6},${bot + 14})`);
  x.fillStyle = g;
  x.fillRect(px, py, ww, wh);
  hx.fillStyle = gray(70); hx.fillRect(px, py, ww, wh);       // recessed
  rx.fillStyle = gray(glassRough); rx.fillRect(px, py, ww, wh); // smooth glass
  if (rng() < 0.12) { // blinds / curtains
    x.fillStyle = 'rgba(215,208,190,0.8)';
    const bh = wh * (0.3 + rng() * 0.5);
    x.fillRect(px, py, ww, bh);
    rx.fillStyle = gray(180); rx.fillRect(px, py, ww, bh);
  }
}

// Ground-floor storefronts: dark glazing, awnings, signs (canvas bottom = v0).
function paintStorefront(set, w, h, rng, band = 62) {
  const { x, hx, rx, ex } = set;
  const y0 = h - band;
  x.fillStyle = '#22262c'; x.fillRect(0, y0, w, band);
  hx.fillStyle = gray(60); hx.fillRect(0, y0, w, band);
  rx.fillStyle = gray(55); rx.fillRect(0, y0, w, band);
  const shops = 5 + Math.floor(rng() * 3);
  const sw = w / shops;
  const awning = ['#7e3f39', '#3d5c48', '#41546e', '#8a7350', '#575463', '#4a4a4a'];
  for (let i = 0; i < shops; i++) {
    const sx = i * sw;
    x.fillStyle = `rgba(255,236,190,${0.10 + rng() * 0.25})`;
    x.fillRect(sx + 6, y0 + 18, sw - 12, band - 24);
    // shops glow warmly after dark
    ex.fillStyle = NIGHT_WINDOW_COLORS[Math.floor(rng() * 3)];
    ex.globalAlpha = 0.8;
    ex.fillRect(sx + 6, y0 + 18, sw - 12, band - 24);
    ex.globalAlpha = 1;
    x.fillStyle = awning[Math.floor(rng() * awning.length)];
    x.fillRect(sx + 3, y0, sw - 6, 9);
    hx.fillStyle = gray(255); hx.fillRect(sx + 3, y0, sw - 6, 9); // awning sticks out
    x.fillStyle = 'rgba(10,12,14,0.9)';
    x.fillRect(sx + sw / 2 - 7, y0 + 26, 14, band - 26);
  }
}

function finishFacade(set, normalStrength = 2.2) {
  return {
    map: toTexture(set.c),
    normalMap: normalFromHeight(set.hc, normalStrength),
    roughnessMap: toTexture(set.rc, { srgb: false }),
    emissiveMap: toTexture(set.ec),
  };
}

// Glass office tower: full curtain wall.
export function makeFacadeGlass() {
  const rng = mulberry32(101);
  const set = facadeSet('#5e6e7c', 160);
  const { x, hx } = set;
  const cols = 12, rows = 16;
  const cw = 512 / cols, rh = 512 / rows;
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      paintWindow(set, i * cw + 2, j * rh + 2, cw - 4, rh - 4, rng, 1.0, 30);
    }
  }
  x.fillStyle = 'rgba(226,232,238,0.35)';
  for (let i = 0; i <= cols; i++) x.fillRect(i * cw - 1, 0, 2, 512);
  hx.fillStyle = gray(255);
  for (let i = 0; i <= cols; i++) hx.fillRect(i * cw - 1, 0, 2, 512);
  // lobby
  x.fillStyle = '#1d2126'; x.fillRect(0, 512 - 40, 512, 40);
  x.fillStyle = 'rgba(235,240,244,0.5)'; x.fillRect(0, 512 - 42, 512, 4);
  hx.fillStyle = gray(60); hx.fillRect(0, 512 - 40, 512, 40);
  set.rx.fillStyle = gray(35); set.rx.fillRect(0, 512 - 40, 512, 40);
  return finishFacade(set, 1.8);
}

// Concrete mid-rise with ribbon windows.
export function makeFacadeRibbon() {
  const rng = mulberry32(202);
  const set = facadeSet('#b3aa9a', 210);
  const { x, hx } = set;
  noiseFill(x, 512, 512, 0.06, rng);
  const rows = 10, rh = 512 / rows;
  for (let j = 0; j < rows; j++) {
    const y0 = j * rh + rh * 0.22;
    const wh = rh * 0.52;
    x.fillStyle = '#2e3844'; x.fillRect(0, y0, 512, wh);
    hx.fillStyle = gray(70); hx.fillRect(0, y0, 512, wh);
    set.rx.fillStyle = gray(50); set.rx.fillRect(0, y0, 512, wh);
    for (let i = 0; i < 16; i++) {
      paintWindow(set, i * 32 + 2, y0 + 2, 28, wh - 4, rng, 0.7, 45);
    }
    x.fillStyle = 'rgba(0,0,0,0.22)'; x.fillRect(0, y0 + wh, 512, 4);
  }
  paintStorefront(set, 512, 512, rng);
  return finishFacade(set);
}

// Residential: punched windows + balconies on plaster.
export function makeFacadeResidential() {
  const rng = mulberry32(303);
  const set = facadeSet('#cbb49a', 225);
  const { x, hx } = set;
  noiseFill(x, 512, 512, 0.07, rng);
  const cols = 8, rows = 8;
  const cw = 512 / cols, rh = 512 / rows;
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const px = i * cw + cw * 0.22, py = j * rh + rh * 0.18;
      paintWindow(set, px, py, cw * 0.56, rh * 0.6, rng, 0.55, 60);
      x.strokeStyle = 'rgba(70,60,50,0.6)';
      x.lineWidth = 2;
      x.strokeRect(px, py, cw * 0.56, rh * 0.6);
      if ((i + j * 3) % 4 === 0) { // balcony slab
        x.fillStyle = 'rgba(90,80,70,0.75)';
        x.fillRect(i * cw + cw * 0.12, j * rh + rh * 0.8, cw * 0.76, 6);
        hx.fillStyle = gray(255);
        hx.fillRect(i * cw + cw * 0.12, j * rh + rh * 0.8, cw * 0.76, 6);
      }
    }
  }
  paintStorefront(set, 512, 512, rng, 56);
  return finishFacade(set);
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
  return toTexture(c, { repeat: false });
}

// ---------------------------------------------------------------- wall ads (2x2 atlas)
export function makeAdsAtlas() {
  const rng = mulberry32(606);
  const c = canvas(512, 512), x = c.getContext('2d');
  const ads = [
    { bg: '#d8262c', fg: '#ffffff', text: 'APEX', sub: 'RACING TEAM' },
    { bg: '#123c6e', fg: '#ffd94a', text: 'NITRO', sub: 'FUEL & CO' },
    { bg: '#0e0f12', fg: '#5ad1ff', text: 'SKYLINE', sub: '98.5 FM' },
    { bg: '#f2ede2', fg: '#c8102e', text: 'VELOCITA', sub: 'TYRES' },
  ];
  ads.forEach((a, i) => {
    const ox = (i % 2) * 256, oy = Math.floor(i / 2) * 256;
    x.fillStyle = a.bg; x.fillRect(ox, oy, 256, 256);
    // diagonal accent
    x.fillStyle = 'rgba(255,255,255,0.09)';
    x.beginPath();
    x.moveTo(ox, oy + 256); x.lineTo(ox + 130, oy); x.lineTo(ox + 200, oy); x.lineTo(ox + 70, oy + 256);
    x.fill();
    x.fillStyle = a.fg;
    x.textAlign = 'center';
    x.font = 'italic 900 52px system-ui, sans-serif';
    x.textBaseline = 'middle';
    x.fillText(a.text, ox + 128, oy + 108);
    x.font = '700 22px system-ui, sans-serif';
    x.fillText(a.sub, ox + 128, oy + 158);
    // frame
    x.strokeStyle = 'rgba(0,0,0,0.55)';
    x.lineWidth = 10;
    x.strokeRect(ox + 5, oy + 5, 246, 246);
  });
  return toTexture(c, { repeat: false });
}

// ---------------------------------------------------------------- road decals
export function makeManholeTexture() {
  const c = canvas(64, 64), x = c.getContext('2d');
  x.clearRect(0, 0, 64, 64);
  x.fillStyle = '#2c2d30';
  x.beginPath(); x.arc(32, 32, 28, 0, Math.PI * 2); x.fill();
  x.strokeStyle = '#1a1b1d'; x.lineWidth = 3;
  x.beginPath(); x.arc(32, 32, 24, 0, Math.PI * 2); x.stroke();
  x.lineWidth = 2;
  for (let i = -2; i <= 2; i++) {
    x.beginPath(); x.moveTo(12, 32 + i * 8); x.lineTo(52, 32 + i * 8); x.stroke();
  }
  return toTexture(c, { repeat: false });
}

export function makeSkidTexture() {
  const c = canvas(64, 256), x = c.getContext('2d');
  x.clearRect(0, 0, 64, 256);
  for (const cx of [18, 46]) {
    const g = x.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, 'rgba(12,12,14,0)');
    g.addColorStop(0.3, 'rgba(12,12,14,0.4)');
    g.addColorStop(0.7, 'rgba(12,12,14,0.4)');
    g.addColorStop(1, 'rgba(12,12,14,0)');
    x.fillStyle = g;
    x.fillRect(cx - 7, 0, 14, 256);
  }
  return toTexture(c); // wraps: skids fade in/out repeatedly along the span
}

export function makeGlowPoolTexture() { // white radial falloff for additive light pools
  const c = canvas(128, 128), x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 4, 64, 64, 62);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 128, 128);
  return toTexture(c, { repeat: false });
}

export function makeContactShadowTexture() {
  const c = canvas(128, 128), x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 8, 64, 64, 62);
  g.addColorStop(0, 'rgba(0,0,0,0.5)');
  g.addColorStop(0.55, 'rgba(0,0,0,0.38)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 128, 128);
  return toTexture(c, { repeat: false });
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
  return toTexture(c, { repeat: false });
}
