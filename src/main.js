// APEX CITY — a zero-asset city racing environment. Attract mode: the camera
// drives the circuit at racing speed until a car takes its place.
import * as THREE from 'three';
import { buildTrack, frameAt } from './track.js';
import { buildCity } from './city.js';
import { buildSky, SUN_DIR } from './sky.js';
import { createPost } from './post.js';
import { createCar } from './car.js';
import { buildExtras } from './extras.js';
import { buildTraffic } from './traffic.js';
import { createDrive, TUNE } from './drive.js';
import { createAudio } from './audio.js';
import { createSmoke } from './smoke.js';
import { createSkidmarks } from './skidmarks.js';
import { createDayNight } from './daynight.js';
import { createMinimap } from './minimap.js';
import { createCityModel } from './citymodel.js';
import { buildWorld } from './world.js';
import { createSignals } from './signals.js';
import { createCollision } from './collision.js';
import GUI from '../vendor/lil-gui.module.min.js';

// ?world=1 → open-world free-roam slice (Phase 1). Default = the race circuit.
const WORLD = new URLSearchParams(location.search).has('world');

// true while the user is typing in a form field, so game hotkeys don't fire
const uiTyping = () => {
  const a = document.activeElement;
  return !!a && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT');
};

// ------------------------------------------------------------ renderer
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

// Post pipeline does tonemapping/grading in HDR; fall back to direct
// ACES rendering when unavailable (WebGL1).
const post = createPost(renderer);
let postEnabled = !!post;
if (!postEnabled) {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
}
function setDirectToneMapping(on) {
  renderer.toneMapping = on ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
  renderer.toneMappingExposure = 1.12;
  scene.traverse((o) => {
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => (m.needsUpdate = true));
  });
}

// software/mobile GPUs can drop the context under load — recover by reloading
canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  console.warn('[gl] context lost');
  if (!new URLSearchParams(location.search).has('noreload')) location.reload();
});

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xdfe9f2, 260, 3100);

const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.3, 5200);

// ------------------------------------------------------------ lights
const sun = new THREE.DirectionalLight(0xfff1dc, 3.1);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -160; sun.shadow.camera.right = 160;
sun.shadow.camera.top = 160; sun.shadow.camera.bottom = -160;
sun.shadow.camera.near = 10; sun.shadow.camera.far = 900;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.6;
scene.add(sun, sun.target);

const hemi = new THREE.HemisphereLight(0xc6d5ea, 0x9a8d7d, 0.85);
scene.add(hemi);

// ------------------------------------------------------------ world
const sky = buildSky(scene);
// hero car first: its download + Draco decode should win the network queue
const car = createCar(scene);
const audio = createAudio();
const smoke = createSmoke(scene);
const skidmarks = createSkidmarks(scene);

let curve = null, length = 0, cornerSpans = null;
let extras = null, traffic = null, minimap = null, signals = null, drive;
if (WORLD) {
  const model = createCityModel();
  const worldObj = buildWorld(scene, model);
  signals = createSignals(scene, model);
  const collision = createCollision(model, {
    buildings: worldObj.colliders.buildings,
    obstacles: [...worldObj.obstacles, ...signals.obstacles],
  });
  drive = createDrive(null, 0, { world: { spawn: model.spawn, collision, curbY: model.CURB_Y } });
  scene.fog.near = 110; scene.fog.far = 560; // atmospheric fade at the district edge
  const mm = document.getElementById('minimap'); if (mm) mm.style.display = 'none';
} else {
  ({ curve, length, cornerSpans } = buildTrack(scene));
  buildCity(scene, curve, length);
  extras = buildExtras(scene, renderer, curve, length, cornerSpans);
  traffic = buildTraffic(scene, curve, length);
  drive = createDrive(curve, length);
  minimap = createMinimap(curve, length);
}
const daynight = createDayNight({ scene, sky, sun, hemi, post });

// debug panel (G) — the vibe-coder's control room
const gui = new GUI({ title: 'APEX DEBUG' });
{
  const fCycle = gui.addFolder('Dygn');
  fCycle.add(daynight.params, 'auto').name('auto-cykel');
  fCycle.add(daynight.params, 'timeOfDay', 0, 1, 0.001).name('tid (0=gryning)').listen();
  fCycle.add(daynight.params, 'cycleSec', 30, 3600, 10).name('cykel (s)');
  const fNight = gui.addFolder('Natt');
  fNight.add(daynight.params, 'moonIntensity', 0, 1, 0.01).name('månljus');
  fNight.add(daynight.params, 'nightExposure', 0.5, 1.6, 0.01).name('exponering');
  if (post) fNight.add(post.uniforms.bloomStrength, 'value', 0, 2.5, 0.05).name('bloom');
  const fDrive = gui.addFolder('Körning');
  fDrive.add(TUNE, 'accel', 5, 30, 0.5);
  fDrive.add(TUNE, 'brakeForce', 8, 40, 1).name('broms');
  fDrive.add(TUNE, 'grip', 2, 12, 0.1).name('grepp');
  fDrive.add(TUNE, 'driftGrip', 0.4, 4, 0.1).name('sladdgrepp');
  fDrive.add(TUNE, 'steer', 1, 4, 0.05).name('styrutslag');
  fDrive.add(TUNE, 'sidewalkMax', 3, 20, 0.5).name('trottoar max m/s');
  gui.hide();
}
let guiVisible = false;
addEventListener('keydown', (e) => {
  if (uiTyping()) return;
  if (e.code === 'KeyG') {
    guiVisible = !guiVisible;
    guiVisible ? gui.show() : gui.hide();
  }
});

// ---------------------------------------------------------- hard reload
// Forces fresh copies of every game file past the HTTP cache (fetch with
// cache:'reload' overwrites the cache entry), then reloads. One click after
// a deploy = guaranteed latest version, no manual cache clearing.
const GAME_FILES = [
  'index.html',
  'src/main.js', 'src/track.js', 'src/city.js', 'src/sky.js', 'src/textures.js',
  'src/post.js', 'src/car.js', 'src/traffic.js', 'src/extras.js', 'src/drive.js',
  'src/audio.js', 'src/smoke.js', 'src/skidmarks.js', 'src/daynight.js',
  'src/night.js', 'src/minimap.js',
  'src/citymodel.js', 'src/world.js', 'src/signals.js', 'src/collision.js',
  'vendor/three.module.js', 'vendor/lil-gui.module.min.js',
  'vendor/loaders/GLTFLoader.js', 'vendor/loaders/DRACOLoader.js',
  'vendor/utils/BufferGeometryUtils.js', 'vendor/utils/SkeletonUtils.js',
];
let reloading = false;
async function hardReload() {
  if (reloading) return;
  reloading = true;
  elPrompt.textContent = '🔄 HÄMTAR SENASTE VERSIONEN…';
  promptTimer = 60;
  try {
    await Promise.allSettled(GAME_FILES.map((f) => fetch(f, { cache: 'reload' })));
  } finally {
    location.reload();
  }
}
document.getElementById('btnReload').addEventListener('click', hardReload);
addEventListener('keydown', (e) => { if (!uiTyping() && e.code === 'KeyU') hardReload(); });

// ---------------------------------------------------------- photo mode
// Captures the frame with a burned-in coordinate stamp (and coords in the
// filename) so a screenshot doubles as a bug report we can teleport back to.
let photoRequested = false;
addEventListener('keydown', (e) => { if (!uiTyping() && e.code === 'KeyP') photoRequested = true; });
document.getElementById('btnPhoto').addEventListener('click', () => { photoRequested = true; });

function takePhoto(st) {
  const pos = st ? st.pos : carGround;
  const tod = daynight.params.timeOfDay;
  const w = canvas.width, h = canvas.height;
  const c2 = document.createElement('canvas');
  c2.width = w; c2.height = h;
  const x = c2.getContext('2d');
  x.drawImage(canvas, 0, 0);
  const stamp = `x ${pos.x.toFixed(1)}  z ${pos.z.toFixed(1)}  s ${Math.round(sPos)} m  tod ${tod.toFixed(3)}  cam ${CAM_NAMES[camMode]}`;
  const fs = Math.max(13, Math.round(h * 0.02));
  x.font = `bold ${fs}px monospace`;
  const tw = x.measureText(stamp).width;
  x.fillStyle = 'rgba(8,10,14,0.72)';
  x.fillRect(10, h - fs * 2.2, tw + 24, fs * 1.8);
  x.fillStyle = '#ffd94a';
  x.fillText(stamp, 22, h - fs);
  const name = `apex_x${pos.x.toFixed(0)}_z${pos.z.toFixed(0)}_s${Math.round(sPos)}_tod${tod.toFixed(2)}.png`;
  c2.toBlob((blob) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  });
  elPrompt.textContent = `📸 ${name}`;
  promptTimer = 2.5;

  // open the bug-report overlay, pre-loaded with this frame's context
  bugCtx = {
    pos: pos.clone(), tod, cam: CAM_NAMES[camMode], s: Math.round(sPos),
    kmh: st ? Math.round(st.kmh) : 0, mode: WORLD ? 'world' : 'race', file: name,
  };
  elBugMeta.textContent = `${bugCtx.mode} · x ${bugCtx.pos.x.toFixed(1)} z ${bugCtx.pos.z.toFixed(1)} · tod ${tod.toFixed(2)} · ${bugCtx.cam}`;
  elBugText.value = '';
  refreshBugLog();
  bugOverlay.classList.remove('bug-hidden');
  setTimeout(() => elBugText.focus(), 40);
}

// ------------------------------------------------------------ bug report
// A photo doubles as a bug report: the overlay copies a structured, teleport-
// stamped report to the clipboard (paste it + the photo straight into the
// Claude chat), or opens a prefilled GitHub issue as a fallback.
const bugOverlay = document.getElementById('bugReport');
const elBugMeta = document.getElementById('bugMeta');
const elBugText = document.getElementById('bugText');
const elBugCount = document.getElementById('bugCount');
const bugLogRow = document.getElementById('bugLogRow');
let bugCtx = null;

// session log: collect several reports and copy them all at once, since the
// clipboard only holds one at a time
let bugLog = [];
try { bugLog = JSON.parse(localStorage.getItem('apexBugLog') || '[]'); } catch { bugLog = []; }
function saveBugLog() { try { localStorage.setItem('apexBugLog', JSON.stringify(bugLog)); } catch { /* private mode */ } }
function refreshBugLog() {
  bugLogRow.style.display = bugLog.length ? 'flex' : 'none';
  elBugCount.textContent = `${bugLog.length} sparade denna session`;
}
refreshBugLog();

function buildReport(note) {
  const c = bugCtx;
  if (!c) return '';
  const teleport = c.mode === 'world' ? '?world=1' : `?s=${c.s}&tod=${c.tod.toFixed(2)}`;
  return [
    `[BUGG]${note ? ' ' + note.split('\n')[0].slice(0, 60) : ''}`,
    '',
    `Läge: ${c.mode} · x ${c.pos.x.toFixed(1)} · z ${c.pos.z.toFixed(1)} · tod ${c.tod.toFixed(3)} · kamera ${c.cam} · fart ${c.kmh} km/h`,
    `Teleport: ${teleport}`,
    note ? `\nRapport: ${note}` : '',
    `\n(Bild: ${c.file} — dra in den här i chatten)`,
  ].join('\n');
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall back */ }
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.focus(); ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { /* ignore */ }
  ta.remove();
  return ok;
}

document.getElementById('bugCopy').addEventListener('click', async () => {
  const rep = buildReport(elBugText.value.trim());
  bugLog.push(rep); saveBugLog(); refreshBugLog();
  const ok = await copyText(rep);
  elPrompt.textContent = ok ? '📋 KOPIERAT — KLISTRA IN I CHATTEN MED CLAUDE' : '⚠️ KUNDE INTE KOPIERA';
  promptTimer = 3.5;
  bugOverlay.classList.add('bug-hidden');
});
document.getElementById('bugCopyAll').addEventListener('click', async () => {
  if (!bugLog.length) return;
  const ok = await copyText(bugLog.join('\n\n— — — — —\n\n'));
  elPrompt.textContent = ok ? `📋 ${bugLog.length} BUGGAR KOPIERADE` : '⚠️ KUNDE INTE KOPIERA';
  promptTimer = 3.5;
  bugOverlay.classList.add('bug-hidden');
});
document.getElementById('bugClear').addEventListener('click', () => { bugLog = []; saveBugLog(); refreshBugLog(); });
document.getElementById('bugGithub').addEventListener('click', () => {
  const note = elBugText.value.trim();
  const title = encodeURIComponent(`[BUGG] ${note.slice(0, 60) || 'rapport'}`);
  const body = encodeURIComponent(buildReport(note));
  window.open(`https://github.com/martingrahn-cmd/Racing-game-Prototype/issues/new?title=${title}&body=${body}&labels=bugg`, '_blank');
  bugOverlay.classList.add('bug-hidden');
});
document.getElementById('bugClose').addEventListener('click', () => bugOverlay.classList.add('bug-hidden'));
// browsers unlock audio on a user gesture; any of these will do
for (const ev of ['keydown', 'pointerdown', 'gamepadconnected']) {
  addEventListener(ev, () => audio.resume());
}
addEventListener('keydown', (e) => { if (!uiTyping() && e.code === 'KeyM') audio.toggleMute(); });

// image-based lighting from the generated sky (gives glass its sheen)
{
  const pmrem = new THREE.PMREMGenerator(renderer);
  const skyScene = new THREE.Scene();
  skyScene.add(sky.clone());
  const env = pmrem.fromScene(skyScene, 0.04, 1, 4000);
  scene.environment = env.texture;
  scene.traverse((o) => {
    const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
    for (const m of mats) {
      if (m.isMeshStandardMaterial && !m.userData.keepEnv) m.envMapIntensity = 0.5;
    }
  });
  pmrem.dispose();
}

// ------------------------------------------------------------ camera director
const SPEEDS = [90, 140, 180, 240, 300]; // km/h
const params = new URLSearchParams(location.search);
let speedIdx = THREE.MathUtils.clamp(parseInt(params.get('speed') ?? '2', 10), 0, SPEEDS.length - 1);
let sPos = parseFloat(params.get('s') ?? '0');
let camMode = THREE.MathUtils.clamp(parseInt(params.get('cam') ?? '0', 10), 0, 4); // 4 = photo orbit (URL only)
if (WORLD && camMode > 2) camMode = 0; // trackside cam needs the spline
let lastUserSwitch = params.has('cam') ? Infinity : -30; // explicit ?cam= pins the camera
let autoTimer = 0;
let tracksideS = null;

const V = () => new THREE.Vector3();
const carP = V(), carGround = V(), aheadP = V(), tmp = V(), camPos = V(), lookP = V();
let smoothedPos = null, smoothedLook = null;

function pointAt(s, out) {
  const { p } = frameAt(curve, length, s);
  out.copy(p);
  return out;
}

function signedCurvature(s) {
  const a = frameAt(curve, length, s).t;
  const b = frameAt(curve, length, s + 14).t;
  return Math.atan2(a.x * b.z - a.z * b.x, a.x * b.x + a.z * b.z);
}

function modDist(a, b) { // distance from a forward to b along loop
  let d = (b - a) % length;
  if (d < 0) d += length;
  return d;
}

const dirVec = V(), rightVec = V();

function updateCamera(dt, time, st) {
  let kmh, roll, steer, speedMs;
  if (st) {
    // player is driving: anchor everything to the real car state
    sPos = st.s;
    carP.copy(st.pos); carP.y += 0.55;
    carGround.copy(st.pos); carGround.y += 0.035;
    dirVec.copy(st.heading);
    kmh = st.kmh;
    speedMs = st.speed;
    roll = st.roll;
    steer = st.steer;
  } else {
    // attract mode: ghost point runs along the spline
    kmh = SPEEDS[speedIdx];
    speedMs = kmh / 3.6;
    sPos = (sPos + speedMs * dt) % length;
    pointAt(sPos, carP).y += 0.55;
    pointAt(sPos, carGround).y += 0.035;
    const fr = frameAt(curve, length, sPos);
    dirVec.copy(fr.t);
    const curvature = signedCurvature(sPos); // positive = right-hand corner
    roll = THREE.MathUtils.clamp(curvature * 1.6, -0.10, 0.10);
    steer = THREE.MathUtils.clamp(curvature * 2.2, -0.45, 0.45);
  }
  rightVec.set(-dirVec.z, 0, dirVec.x); // true right = dir × up
  const sf = THREE.MathUtils.clamp((kmh - 90) / 210, 0, 1);
  const back = st?.lookBack ? -1 : 1; // held: camera swings to face rearward

  car.update(carGround, dirVec, roll, steer, speedMs, dt, st ? st.brake > 0.15 || st.drifting : false);
  car.setVisible(camMode !== 1);

  if (camMode === 0) { // chase
    camPos.copy(carGround).addScaledVector(dirVec, -7.2 * back);
    camPos.y += 1.9;
    lookP.copy(carGround).addScaledVector(dirVec, 16 * back);
    lookP.y += 1.0;
  } else if (camMode === 1) { // bumper
    camPos.copy(carGround).addScaledVector(dirVec, 2.35 * back);
    camPos.y += 0.72;
    camPos.addScaledVector(rightVec, roll * 3);
    lookP.copy(carGround).addScaledVector(dirVec, 34 * back);
    lookP.y += 0.9;
  } else if (camMode === 2) { // helicopter
    camPos.copy(carGround).addScaledVector(dirVec, -38);
    camPos.y += 46;
    camPos.addScaledVector(rightVec, 22);
    lookP.copy(carGround).addScaledVector(dirVec, 40);
    lookP.y += 2;
  } else if (camMode === 4) { // photo orbit around the car
    const a = time * 0.35;
    camPos.copy(carGround);
    camPos.x += Math.cos(a) * 6.8;
    camPos.z += Math.sin(a) * 6.8;
    camPos.y += 1.55;
    lookP.copy(carGround); lookP.y += 0.55;
  } else { // trackside cinematic
    if (tracksideS === null || modDist(tracksideS, sPos) < length - 25 && modDist(sPos, tracksideS) > 180) {
      tracksideS = (sPos + 95) % length;
    }
    if (modDist(tracksideS, sPos) > 12 && modDist(tracksideS, sPos) < 100) {
      tracksideS = (sPos + 95) % length; // car passed: cut to next corner
    }
    // TV camera mounted on a pole above the catch fence
    const tf = frameAt(curve, length, tracksideS);
    camPos.copy(tf.p).addScaledVector(tf.r, 7.0);
    camPos.y += 7.2;
    lookP.copy(carP);
  }

  // speed shake (not for trackside/photo)
  if (camMode !== 3 && camMode !== 4) {
    camPos.y += Math.sin(time * 31) * 0.018 * (0.3 + sf);
    camPos.addScaledVector(rightVec, Math.sin(time * 23.7) * 0.02 * (0.3 + sf));
  }

  // smoothing (snappier when the player drives, or the chase cam lags corners)
  if (!smoothedPos) {
    smoothedPos = camPos.clone();
    smoothedLook = lookP.clone();
  }
  const posK = camMode === 3 ? 1 : 1 - Math.pow(st ? 0.000001 : 0.0001, dt);
  const lookK = 1 - Math.pow(st ? 0.000001 : 0.00005, dt);
  smoothedPos.lerp(camPos, camMode === 3 ? 1 : posK);
  smoothedLook.lerp(lookP, lookK);

  camera.position.copy(smoothedPos);
  camera.up.set(0, 1, 0).addScaledVector(rightVec, camMode === 3 ? 0 : roll);
  camera.up.normalize();
  camera.lookAt(smoothedLook);

  const targetFov = 62 + sf * 13 + (camMode === 1 ? 6 : 0);
  camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 3);
  camera.updateProjectionMatrix();

  // shadow frustum follows the action
  sun.position.copy(carP).addScaledVector(SUN_DIR, 420);
  sun.target.position.copy(carP);

  return kmh;
}

// ------------------------------------------------------------ input
function cycleCamera() {
  camMode = (camMode + 1) % (WORLD ? 3 : 4); // no trackside cam in free roam
  tracksideS = null;
  lastUserSwitch = perfTime;
  smoothedPos = null;
}
function changeSpeed(d) {
  speedIdx = THREE.MathUtils.clamp(speedIdx + d, 0, SPEEDS.length - 1);
}
addEventListener('keydown', (e) => {
  if (uiTyping()) return;
  if (e.code === 'KeyC') { e.preventDefault(); cycleCamera(); }
  if (!drive.playing && (e.code === 'Equal')) changeSpeed(1);
  if (!drive.playing && (e.code === 'Minus')) changeSpeed(-1);
});
document.getElementById('btnCam').addEventListener('click', cycleCamera);
document.getElementById('btnPlus').addEventListener('click', () => changeSpeed(1));
document.getElementById('btnMinus').addEventListener('click', () => changeSpeed(-1));
canvas.addEventListener('pointerdown', (e) => {
  if (e.target === canvas && e.pointerType === 'touch') cycleCamera();
});

// ------------------------------------------------------------ adaptive quality
const TIERS = [
  { pr: 2.0, shadows: 2048, post: true },
  { pr: 1.5, shadows: 2048, post: true },
  { pr: 1.25, shadows: 1024, post: true },
  { pr: 1.0, shadows: 1024, post: false },
  { pr: 1.0, shadows: 0, post: false },
];
let tier = 0;
function applyTier() {
  const t = TIERS[tier];
  renderer.setPixelRatio(Math.min(devicePixelRatio, t.pr));
  const wantPost = t.post && !!post;
  if (wantPost !== postEnabled) {
    postEnabled = wantPost;
    setDirectToneMapping(!wantPost);
  }
  const wantShadows = t.shadows > 0;
  if (renderer.shadowMap.enabled !== wantShadows) {
    renderer.shadowMap.enabled = wantShadows;
    sun.castShadow = wantShadows;
    scene.traverse((o) => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => (m.needsUpdate = true)); });
  }
  if (wantShadows && sun.shadow.mapSize.x !== t.shadows) {
    sun.shadow.mapSize.set(t.shadows, t.shadows);
    if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
  }
  resize();
}
applyTier();

let slowFrames = 0;
function autoQuality(dt) {
  if (dt > 1 / 42) slowFrames++; else slowFrames = Math.max(0, slowFrames - 2);
  if (slowFrames > 90 && tier < TIERS.length - 1) {
    tier++; slowFrames = 0; applyTier();
  }
}

// ------------------------------------------------------------ resize
function resize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight, false); // CSS keeps the canvas full-screen
  if (post) post.setSize(innerWidth, innerHeight, renderer.getPixelRatio());
}
addEventListener('resize', resize);
resize();

// ------------------------------------------------------------ HUD
const elSpeed = document.getElementById('speed');
const elFps = document.getElementById('fps');
const elCam = document.getElementById('camName');
const elPrompt = document.getElementById('prompt');
const elCoords = document.getElementById('coords');
const elHint = document.getElementById('hint');
const HINT_KEYS = '[↑↓←→/WASD] KÖR  ·  [SPACE] HANDBROMS  ·  [B] BAKÅT  ·  [H] TUTA  ·  [R] RESET  ·  [P] FOTO  ·  [C] KAMERA  ·  [G] DEBUG';
const HINT_PAD = '[RT] GAS  ·  [LT] BROMS  ·  [A] HANDBROMS  ·  [B] BAKÅT  ·  [X] TUTA  ·  [SELECT] RESET  ·  [Y] KAMERA';
const CAM_NAMES = ['CHASE', 'BUMPER', 'HELI', 'TV', 'PHOTO'];
const ATTRACT_PROMPT = 'GASA FÖR ATT KÖRA — ↑ / W ELLER RT PÅ HANDKONTROLL';
let promptTimer = 0;
let fpsAcc = 0, fpsN = 0, fpsTimer = 0;

// ------------------------------------------------------------ main loop
let perfTime = 0;
let last = performance.now();
let firstFrame = true;

function loop(now) {
  requestAnimationFrame(loop);
  let dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  perfTime += dt;

  const st = drive.update(dt, sPos, WORLD ? null : traffic.cars);
  if (st) audio.resume(); // gamepad-only players never fire DOM gestures
  if (drive.consumeCameraTap()) cycleCamera();

  // attract mode: auto-cycle cameras unless the user recently chose one
  autoTimer += dt;
  if (!st && autoTimer > 11 && perfTime - lastUserSwitch > 26) {
    autoTimer = 0;
    camMode = (camMode + 1) % 4;
    tracksideS = null;
    smoothedPos = null;
  }
  daynight.update(dt);
  const kmh = updateCamera(dt, perfTime, st);
  if (WORLD) {
    signals.update(dt);
  } else {
    extras.update(dt);
    traffic.update(dt);
  }
  smoke.update(dt, st);
  skidmarks.update(dt, st);
  audio.update(st, dt);
  if (!WORLD) minimap.update(st ? st.pos : carGround, st ? st.yaw : Math.atan2(dirVec.x, dirVec.z), traffic.cars);
  autoQuality(dt);
  if (postEnabled) {
    const sf = (kmh - 90) / 210;
    post.render(scene, camera, camMode === 3 ? 0 : sf, perfTime);
  } else {
    renderer.render(scene, camera);
  }
  if (photoRequested) { // same task as the render: the buffer is still intact
    photoRequested = false;
    takePhoto(st);
  }

  // HUD
  elSpeed.textContent = String(Math.round(st ? kmh : kmh + Math.sin(perfTime * 9) * 1.4));
  elCam.textContent = CAM_NAMES[camMode];
  const toast = drive.consumePadToast();
  if (toast) { elPrompt.textContent = '🎮 HANDKONTROLL ANSLUTEN'; promptTimer = toast; }
  if (promptTimer > 0) {
    promptTimer -= dt;
    if (promptTimer <= 0) elPrompt.textContent = drive.playing ? '' : ATTRACT_PROMPT;
  } else if (!drive.playing && elPrompt.textContent !== ATTRACT_PROMPT) {
    elPrompt.textContent = ATTRACT_PROMPT;
  } else if (drive.playing && promptTimer <= 0 && elPrompt.textContent === ATTRACT_PROMPT) {
    elPrompt.textContent = '';
  }
  fpsAcc += dt; fpsN++; fpsTimer += dt;
  if (fpsTimer > 0.5) {
    elFps.textContent = `${Math.round(fpsN / fpsAcc)} FPS`;
    const cp = st ? st.pos : carGround;
    elCoords.textContent = `x ${cp.x.toFixed(0)} · z ${cp.z.toFixed(0)} · s ${Math.round(sPos)} m · ${daynight.params.timeOfDay.toFixed(2)}`;
    // the hint row follows the active input device
    const hint = drive.padConnected ? HINT_PAD : HINT_KEYS;
    if (elHint.textContent !== hint) elHint.textContent = hint;
    fpsAcc = 0; fpsN = 0; fpsTimer = 0;
  }

  if (firstFrame) {
    firstFrame = false;
    document.getElementById('loader').classList.add('done');
  }

  // debug handle for automated testing
  window.__dbg = {
    cam: camera.position.toArray().map((n) => +n.toFixed(1)),
    car: st ? st.pos.toArray().map((n) => +n.toFixed(1)) : null,
    yaw: st ? +st.yaw.toFixed(3) : null,
    kmh: Math.round(kmh), tier, playing: drive.playing,
    post: postEnabled, d: +daynight.dayness.toFixed(3),
    sun: +sun.intensity.toFixed(2), hemi: +hemi.intensity.toFixed(2),
    tris: renderer.info.render.triangles,
  };
}
requestAnimationFrame(loop);
