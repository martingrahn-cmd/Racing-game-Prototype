// Traffic lights across the district. One synced controller cycles the two
// axes (N–S vs E–W) through green → yellow → red with an all-red pause, and
// drives the emissive lamp on every corner pole. Near-side placement: each
// pole sits on the driver's-right corner before the intersection, arm out over
// that lane, head facing back at the driver, lamps as flat discs so a
// cross-street light reads edge-on (not the wrong colour). Poles are knockable.
import * as THREE from 'three';
import { getDayness } from './night.js';

const RED = 0xff3320, YEL = 0xffb020, GRN = 0x35dd55;

export function createSignals(scene, model) {
  const group = new THREE.Group();
  scene.add(group);
  const R = model.ROAD_HW;
  const { greenSec = 8, yellowSec = 2.2, allRedSec = 1.2 } = model.signals || {};

  const timeline = [
    { ns: 'green', ew: 'red', t: greenSec },
    { ns: 'yellow', ew: 'red', t: yellowSec },
    { ns: 'red', ew: 'red', t: allRedSec },
    { ns: 'red', ew: 'green', t: greenSec },
    { ns: 'red', ew: 'yellow', t: yellowSec },
    { ns: 'red', ew: 'red', t: allRedSec },
  ];
  const period = timeline.reduce((a, p) => a + p.t, 0);
  let clock = 0;
  const state = { ns: 'green', ew: 'red' };

  const C = R + 1.4;
  const poleDefs = [
    { corner: [-C, -C], arm: [1, 0], face: [0, -1], axis: 'ns' },
    { corner: [C, C], arm: [-1, 0], face: [0, 1], axis: 'ns' },
    { corner: [-C, C], arm: [0, -1], face: [-1, 0], axis: 'ew' },
    { corner: [C, -C], arm: [0, 1], face: [1, 0], axis: 'ew' },
  ];

  const poleMat = new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.7, metalness: 0.5 });
  const housingMat = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.8, metalness: 0.2 });
  const poles = [];
  const obstacles = [];

  const postGeo = new THREE.CylinderGeometry(0.13, 0.16, 5.8, 8);
  const hangGeo = new THREE.BoxGeometry(0.08, 0.95, 0.08);
  const housingGeo = new THREE.BoxGeometry(0.62, 1.72, 0.34);
  const discGeo = new THREE.CircleGeometry(0.18, 18);
  const hoodGeo = new THREE.BoxGeometry(0.42, 0.05, 0.17);
  const armX = new THREE.BoxGeometry(5.6, 0.13, 0.13);
  const armZ = new THREE.BoxGeometry(0.13, 0.13, 5.6);
  const ARM_LEN = 5.6, ARM_Y = 5.3;

  for (const it of model.signalized) {
    for (const def of poleDefs) {
      const cx = it.x + def.corner[0], cz = it.z + def.corner[1];
      const [ax, az] = def.arm;
      const [fx, fz] = def.face;
      const pole = new THREE.Group();
      pole.position.set(cx, 0, cz);
      group.add(pole);

      const post = new THREE.Mesh(postGeo, poleMat);
      post.position.y = 2.9; post.castShadow = true; pole.add(post);
      const arm = new THREE.Mesh(ax !== 0 ? armX : armZ, poleMat);
      arm.position.set(ax * ARM_LEN / 2, ARM_Y, az * ARM_LEN / 2);
      pole.add(arm);

      const hx = ax * ARM_LEN, hz = az * ARM_LEN;
      const head = new THREE.Group();
      head.position.set(hx, ARM_Y - 0.95, hz);
      head.rotation.y = Math.atan2(fx, fz);
      pole.add(head);
      const hang = new THREE.Mesh(hangGeo, poleMat);
      hang.position.set(0, 0.95, 0); head.add(hang);
      const housing = new THREE.Mesh(housingGeo, housingMat);
      housing.castShadow = true; head.add(housing);

      const lamps = {};
      [['red', RED], ['yellow', YEL], ['green', GRN]].forEach(([name, col], i) => {
        const y = 0.52 - i * 0.52;
        const mat = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, emissive: col, emissiveIntensity: 0.03, roughness: 0.4, side: THREE.DoubleSide });
        const disc = new THREE.Mesh(discGeo, mat);
        disc.position.set(0, y, 0.18); head.add(disc);
        const hood = new THREE.Mesh(hoodGeo, housingMat);
        hood.position.set(0, y + 0.21, 0.23); head.add(hood);
        lamps[name] = mat;
      });
      poles.push({ axis: def.axis, lamps });
      obstacles.push({
        x: cx, z: cz, r: 0.45, knocked: false,
        knock: () => { pole.rotation.x = (def.corner[1] >= 0 ? 1 : -1) * 1.4; pole.position.y = 0.15; },
      });
    }
  }

  function paint() {
    const night = 1 - getDayness();
    const onI = 1.7 + 1.9 * night;
    for (const p of poles) {
      const showing = state[p.axis];
      for (const name of ['red', 'yellow', 'green']) {
        p.lamps[name].emissiveIntensity = name === showing ? onI : 0.03;
      }
    }
  }
  paint();

  return {
    group,
    obstacles,
    getState() { return state; },
    update(dt) {
      clock = (clock + dt) % period;
      let acc = 0;
      for (const ph of timeline) {
        acc += ph.t;
        if (clock < acc) { state.ns = ph.ns; state.ew = ph.ew; break; }
      }
      paint();
    },
  };
}
