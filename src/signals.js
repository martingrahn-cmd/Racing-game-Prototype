// Traffic lights at the intersection. A single controller cycles the two axes
// (north–south vs east–west) through green → yellow → red with an all-red
// pause, and drives the emissive lamp on each corner pole. The lamps glow
// harder at night. Later the traffic AI reads getState() to stop at red.
import * as THREE from 'three';
import { getDayness } from './night.js';

const RED = 0xff3320, YEL = 0xffb020, GRN = 0x35dd55;

export function createSignals(scene, model) {
  const group = new THREE.Group();
  scene.add(group);
  const R = model.ROAD_HW;
  const { greenSec, yellowSec, allRedSec } = model.signals;

  // phase timeline: which colour each axis shows, and for how long
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

  // one pole per approach, on the driver's-right far corner, head facing traffic
  const poleDefs = [
    { corner: [-(R + 1.6), R + 1.6], face: [0, -1], axis: 'ns' }, // northbound
    { corner: [R + 1.6, -(R + 1.6)], face: [0, 1], axis: 'ns' },  // southbound
    { corner: [R + 1.6, R + 1.6], face: [-1, 0], axis: 'ew' },    // eastbound
    { corner: [-(R + 1.6), -(R + 1.6)], face: [1, 0], axis: 'ew' }, // westbound
  ];

  const poleMat = new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.7, metalness: 0.5 });
  const housingMat = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.8, metalness: 0.2 });
  const poles = [];

  for (const def of poleDefs) {
    const [cx, cz] = def.corner;
    const [fx, fz] = def.face;
    const pole = new THREE.Group();
    pole.position.set(cx, 0, cz);
    group.add(pole);

    // vertical post
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 5.4, 8), poleMat);
    post.position.y = 2.7; post.castShadow = true; pole.add(post);

    // arm reaching in over the lane (toward the intersection = -corner dir)
    const inX = -Math.sign(cx), inZ = -Math.sign(cz);
    const armLen = 3.6;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, armLen), poleMat);
    arm.position.set(inX * armLen / 2, 5.2, inZ * armLen / 2);
    arm.lookAt(pole.position.x + inX, 5.2, pole.position.z + inZ);
    pole.add(arm);

    // head at the arm end
    const hx = inX * armLen, hz = inZ * armLen;
    const housing = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.7, 0.5), housingMat);
    housing.position.set(hx, 4.85, hz);
    housing.castShadow = true; pole.add(housing);

    // three lamps on the driver-facing side
    const lamps = {};
    const cols = [['red', RED], ['yellow', YEL], ['green', GRN]];
    cols.forEach(([name, col], i) => {
      const mat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: col, emissiveIntensity: 0.03, roughness: 0.4 });
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), mat);
      lamp.position.set(hx + fx * 0.3, 4.85 + (0.55 - i * 0.55), hz + fz * 0.3);
      pole.add(lamp);
      lamps[name] = mat;
    });
    poles.push({ axis: def.axis, lamps });
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
