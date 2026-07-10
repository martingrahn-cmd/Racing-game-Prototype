// Day/night cycle. Phase p ∈ [0,1): sunrise 0, noon 0.25, sunset 0.5,
// midnight 0.75. Drives the sun/moon light, sky colors, stars, fog and the
// night registry (window lights, street lamps, headlights, neon).
import * as THREE from 'three';
import { SUN_DIR } from './sky.js';
import { applyDayness } from './night.js';

const DAY_TOP = new THREE.Color(0x3d74c9);
const DAY_HOR = new THREE.Color(0xdfe9f2);
const NIGHT_TOP = new THREE.Color(0x040910);
const NIGHT_HOR = new THREE.Color(0x0c1522);
const SUNSET = new THREE.Color(0xff9a5c);
const SUN_WARM = new THREE.Color(0xfff1dc);
const SUN_SET = new THREE.Color(0xff9c5a);
const MOON_COL = new THREE.Color(0x9db8e8);
const HEMI_DAY_SKY = new THREE.Color(0xc6d5ea);
const HEMI_NIGHT_SKY = new THREE.Color(0x1a2740);
const HEMI_DAY_GND = new THREE.Color(0x9a8d7d);
const HEMI_NIGHT_GND = new THREE.Color(0x0c0e14);
const MOON_DIR = new THREE.Vector3(0.45, 0.72, -0.35).normalize();

export function createDayNight({ scene, sky, sun, hemi, post }) {
  const q = new URLSearchParams(location.search);
  const params = {
    cycleSec: parseFloat(q.get('cycle') ?? '240'), // 2 min day + 2 min night
    auto: !q.has('tod'),
    timeOfDay: q.has('tod') ? parseFloat(q.get('tod')) : Math.random(), // random start
    moonIntensity: 0.9,
    nightExposure: 1.14,
    headlights: 1.0, // global multiplier, wired by the GUI via car.setHeadlightScale
  };

  const sunDirReal = new THREE.Vector3();
  const c1 = new THREE.Color(), c2 = new THREE.Color();
  let envTimer = 0;
  let envMats = [];
  let envScan = 0;

  function collectEnvMats() {
    envMats = [];
    scene.traverse((o) => {
      const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
      for (const m of mats) {
        if (m.isMeshStandardMaterial && m.envMapIntensity !== undefined) {
          if (m.userData.envBase === undefined) m.userData.envBase = m.envMapIntensity;
          envMats.push(m);
        }
      }
    });
  }

  return {
    params,
    get dayness() {
      const el = Math.sin(params.timeOfDay * Math.PI * 2);
      return THREE.MathUtils.smoothstep(el, -0.06, 0.22);
    },
    update(dt) {
      if (params.auto) {
        params.timeOfDay = (params.timeOfDay + dt / params.cycleSec) % 1;
      }
      const p = params.timeOfDay;
      const el = Math.sin(p * Math.PI * 2);
      const d = THREE.MathUtils.smoothstep(el, -0.06, 0.22);
      const twilight = THREE.MathUtils.clamp(1 - Math.abs(el) / 0.32, 0, 1); // sunset/sunrise band

      // real sun position (for the sky disc) + blended light dir (for shadows)
      const az = p * Math.PI * 2 - Math.PI * 0.15;
      const ce = Math.sqrt(Math.max(0, 1 - el * el));
      sunDirReal.set(Math.cos(az) * ce, el, Math.sin(az) * ce).normalize();
      SUN_DIR.copy(MOON_DIR).lerp(sunDirReal, d).normalize();

      // directional light = sun by day, moon by night
      sun.intensity = 3.1 * d + params.moonIntensity * (1 - d);
      c1.copy(MOON_COL).lerp(SUN_WARM, d).lerp(SUN_SET, twilight * d * 0.75);
      sun.color.copy(c1);
      hemi.intensity = 0.42 + 0.44 * d; // city-glow floor keeps the road readable
      hemi.color.copy(c2.copy(HEMI_NIGHT_SKY).lerp(HEMI_DAY_SKY, d));
      hemi.groundColor.copy(c2.copy(HEMI_NIGHT_GND).lerp(HEMI_DAY_GND, d));

      // sky + fog
      const u = sky.material.uniforms;
      u.sunDir.value.copy(sunDirReal);
      u.topColor.value.copy(NIGHT_TOP).lerp(DAY_TOP, d);
      u.horizonColor.value.copy(NIGHT_HOR).lerp(DAY_HOR, d)
        .lerp(SUNSET, twilight * 0.55);
      u.hazeColor.value.copy(u.horizonColor.value).lerp(SUNSET, twilight * 0.4);
      u.starAmt.value = (1 - d) * (1 - twilight * 0.5);
      scene.fog.color.copy(u.horizonColor.value);

      // exposure + environment reflections dim at night
      if (post) post.uniforms.exposure.value = params.nightExposure + (1.22 - params.nightExposure) * d;
      envTimer -= dt; envScan -= dt;
      if (envScan <= 0) { collectEnvMats(); envScan = 4; } // catch late-loaded GLBs
      if (envTimer <= 0) {
        const k = 0.12 + 0.88 * d;
        for (const m of envMats) m.envMapIntensity = m.userData.envBase * k;
        envTimer = 0.25;
      }

      applyDayness(d);
      return d;
    },
  };
}
