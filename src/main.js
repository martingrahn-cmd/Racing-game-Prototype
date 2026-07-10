// APEX CITY — a zero-asset city racing environment. Attract mode: the camera
// drives the circuit at racing speed until a car takes its place.
import * as THREE from 'three';
import { buildTrack, frameAt } from './track.js';
import { buildCity } from './city.js';
import { buildSky, SUN_DIR } from './sky.js';
import { createPost } from './post.js';

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
const { curve, length } = buildTrack(scene);
buildCity(scene, curve, length);

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
let camMode = THREE.MathUtils.clamp(parseInt(params.get('cam') ?? '0', 10), 0, 3);
let lastUserSwitch = -30;
let autoTimer = 0;
let tracksideS = null;

const V = () => new THREE.Vector3();
const carP = V(), aheadP = V(), tmp = V(), camPos = V(), lookP = V();
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

function updateCamera(dt, time) {
  const kmh = SPEEDS[speedIdx];
  const v = kmh / 3.6;
  sPos = (sPos + v * dt) % length;

  pointAt(sPos, carP).y += 0.55;
  const sf = (kmh - 90) / 210; // 0..1 speed factor

  const fr = frameAt(curve, length, sPos);
  const roll = THREE.MathUtils.clamp(-signedCurvature(sPos) * 1.6, -0.10, 0.10);

  if (camMode === 0) { // chase
    pointAt(sPos - 8.5, camPos).y += 2.6;
    pointAt(sPos + 20, lookP).y += 1.2;
  } else if (camMode === 1) { // bumper
    camPos.copy(carP); camPos.y += 0.65;
    camPos.addScaledVector(fr.r, roll * 3);
    pointAt(sPos + 34, lookP).y += 0.9;
  } else if (camMode === 2) { // helicopter
    pointAt(sPos - 42, camPos);
    camPos.y += 46;
    camPos.addScaledVector(fr.r, 22);
    pointAt(sPos + 40, lookP).y += 2;
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

  // speed shake (not for trackside)
  if (camMode !== 3) {
    camPos.y += Math.sin(time * 31) * 0.018 * (0.3 + sf);
    camPos.addScaledVector(fr.r, Math.sin(time * 23.7) * 0.02 * (0.3 + sf));
  }

  // smoothing
  if (!smoothedPos) {
    smoothedPos = camPos.clone();
    smoothedLook = lookP.clone();
  }
  const posK = camMode === 3 ? 1 : 1 - Math.pow(0.0001, dt);
  const lookK = 1 - Math.pow(0.00005, dt);
  smoothedPos.lerp(camPos, camMode === 3 ? 1 : posK);
  smoothedLook.lerp(lookP, lookK);

  camera.position.copy(smoothedPos);
  camera.up.set(0, 1, 0).addScaledVector(fr.r, camMode === 3 ? 0 : roll);
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
  camMode = (camMode + 1) % 4;
  tracksideS = null;
  lastUserSwitch = perfTime;
  smoothedPos = null;
}
function changeSpeed(d) {
  speedIdx = THREE.MathUtils.clamp(speedIdx + d, 0, SPEEDS.length - 1);
}
addEventListener('keydown', (e) => {
  if (e.code === 'KeyC' || e.code === 'Space') { e.preventDefault(); cycleCamera(); }
  if (e.code === 'ArrowUp' || e.code === 'Equal') changeSpeed(1);
  if (e.code === 'ArrowDown' || e.code === 'Minus') changeSpeed(-1);
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
const CAM_NAMES = ['CHASE', 'BUMPER', 'HELI', 'TV'];
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

  // attract mode: auto-cycle cameras unless the user recently chose one
  autoTimer += dt;
  if (autoTimer > 11 && perfTime - lastUserSwitch > 26) {
    autoTimer = 0;
    camMode = (camMode + 1) % 4;
    tracksideS = null;
    smoothedPos = null;
  }

  const kmh = updateCamera(dt, perfTime);
  autoQuality(dt);
  if (postEnabled) {
    const sf = (kmh - 90) / 210;
    post.render(scene, camera, camMode === 3 ? 0 : sf, perfTime);
  } else {
    renderer.render(scene, camera);
  }

  // HUD
  elSpeed.textContent = String(Math.round(kmh + Math.sin(perfTime * 9) * 1.4));
  elCam.textContent = CAM_NAMES[camMode];
  fpsAcc += dt; fpsN++; fpsTimer += dt;
  if (fpsTimer > 0.5) {
    elFps.textContent = `${Math.round(fpsN / fpsAcc)} FPS`;
    fpsAcc = 0; fpsN = 0; fpsTimer = 0;
  }

  if (firstFrame) {
    firstFrame = false;
    document.getElementById('loader').classList.add('done');
  }
}
requestAnimationFrame(loop);
