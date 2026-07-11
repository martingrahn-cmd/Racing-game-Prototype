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
  // near-side signals: one pole per approach on the driver's-right corner
  // BEFORE the intersection, arm straight out over that lane, head facing back
  // at the driver (Euro-style — "närmaste stolpen, vänd mot körfältet")
  const C = R + 1.4;
  const poleDefs = [
    { corner: [-C, -C], arm: [1, 0], face: [0, -1], axis: 'ns' }, // northbound (SW corner)
    { corner: [C, C], arm: [-1, 0], face: [0, 1], axis: 'ns' },   // southbound (NE corner)
    { corner: [-C, C], arm: [0, -1], face: [-1, 0], axis: 'ew' }, // eastbound (NW corner)
    { corner: [C, -C], arm: [0, 1], face: [1, 0], axis: 'ew' },   // westbound (SE corner)
  ];

  const poleMat = new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.7, metalness: 0.5 });
  const housingMat = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.8, metalness: 0.2 });
  const poles = [];
  const obstacles = []; // knockable: plough through a pole and it topples

  for (const def of poleDefs) {
    const [cx, cz] = def.corner;
    const [ax, az] = def.arm;
    const [fx, fz] = def.face;
    const pole = new THREE.Group();
    pole.position.set(cx, 0, cz);
    group.add(pole);

    const POST_H = 5.8, ARM_Y = 5.3, ARM_LEN = 5.6;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, POST_H, 8), poleMat);
    post.position.y = POST_H / 2; post.castShadow = true; pole.add(post);

    // horizontal arm, attached at the pole and reaching straight out over the
    // lane (fixes the floating boom — it now starts at the post)
    const arm = new THREE.Mesh(
      ax !== 0 ? new THREE.BoxGeometry(ARM_LEN, 0.13, 0.13) : new THREE.BoxGeometry(0.13, 0.13, ARM_LEN),
      poleMat,
    );
    arm.position.set(ax * ARM_LEN / 2, ARM_Y, az * ARM_LEN / 2);
    arm.castShadow = true; pole.add(arm);

    // head hanging from the arm end, facing the oncoming driver. Lamps are flat
    // discs so cross-street lights read edge-on, not the wrong colour.
    const hx = ax * ARM_LEN, hz = az * ARM_LEN;
    const head = new THREE.Group();
    head.position.set(hx, ARM_Y - 0.95, hz);
    head.rotation.y = Math.atan2(fx, fz);
    pole.add(head);
    const hang = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.95, 0.08), poleMat);
    hang.position.set(0, 0.95, 0); head.add(hang); // connects the head up to the arm
    const housing = new THREE.Mesh(new THREE.BoxGeometry(0.62, 1.72, 0.34), housingMat);
    housing.castShadow = true; head.add(housing);

    const lamps = {};
    [['red', RED], ['yellow', YEL], ['green', GRN]].forEach(([name, col], i) => {
      const y = 0.52 - i * 0.52;
      const mat = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, emissive: col, emissiveIntensity: 0.03, roughness: 0.4, side: THREE.DoubleSide });
      const disc = new THREE.Mesh(new THREE.CircleGeometry(0.18, 18), mat);
      disc.position.set(0, y, 0.18); // front face, toward the driver
      head.add(disc);
      const hood = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.05, 0.17), housingMat);
      hood.position.set(0, y + 0.21, 0.23); head.add(hood); // visor over each lamp
      lamps[name] = mat;
    });
    poles.push({ axis: def.axis, lamps });
    obstacles.push({
      x: cx, z: cz, r: 0.45, knocked: false,
      knock: () => { pole.rotation.x = (cz >= 0 ? 1 : -1) * 1.4; pole.position.y = 0.15; },
    });
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
