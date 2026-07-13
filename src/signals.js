// Traffic lights across the district. One synced controller cycles the two
// axes (N–S vs E–W) through green → yellow → red with an all-red pause, and
// drives the emissive lamp on every corner pole. Near-side placement: each
// pole sits on the driver's-right corner before the intersection, arm out over
// that lane, head facing back at the driver, lamps as flat discs so a
// cross-street light reads edge-on (not the wrong colour).
//
// INSTANCED: every signalised intersection carries the same four poles, and —
// because one controller drives them all — every pole on a given axis shows the
// same colour at the same time. So the four poles are baked once into a handful
// of cluster geometries (grouped by material) and drawn as InstancedMeshes
// across all intersections; only the six lamp materials toggle each frame. At a
// 4× map that is ~9 draw calls instead of ~15 000 meshes.
import * as THREE from 'three';
import { getDayness } from './night.js';

const RED = 0xff3320, YEL = 0xffb020, GRN = 0x35dd55;

// merge geometries sharing a material (position + normal only — these are solid
// untextured MeshStandard parts).
function mergePN(geos) {
  const g = geos.map((x) => (x.index ? x.toNonIndexed() : x));
  let vc = 0; for (const x of g) vc += x.attributes.position.count;
  const pos = new Float32Array(vc * 3), nor = new Float32Array(vc * 3);
  let o = 0;
  for (const x of g) {
    const A = x.attributes.position; let N = x.attributes.normal;
    if (!N) { x.computeVertexNormals(); N = x.attributes.normal; }
    pos.set(A.array, o * 3); nor.set(N.array, o * 3); o += A.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return out;
}

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
  const backMat = new THREE.MeshStandardMaterial({ color: 0xc9b83a, roughness: 0.6, metalness: 0.1 });
  // six lamp materials — one per axis × colour — whose emissive we toggle
  const lampMat = (col) => new THREE.MeshStandardMaterial({ color: 0x0a0a0a, emissive: col, emissiveIntensity: 0.03, roughness: 0.4, side: THREE.DoubleSide });
  const discMats = {
    ns: { red: lampMat(RED), yellow: lampMat(YEL), green: lampMat(GRN) },
    ew: { red: lampMat(RED), yellow: lampMat(YEL), green: lampMat(GRN) },
  };

  const postGeo = new THREE.CylinderGeometry(0.13, 0.16, 6.6, 8); // taller so tall trucks clear the head (#49)
  const hangGeo = new THREE.BoxGeometry(0.08, 0.95, 0.08);
  const housingGeo = new THREE.BoxGeometry(0.66, 1.74, 0.4);
  const backGeo = new THREE.BoxGeometry(0.86, 1.94, 0.05);   // yellow retroreflective backboard
  const bezelGeo = new THREE.TorusGeometry(0.2, 0.035, 8, 18); // black rim around each lens
  const discGeo = new THREE.CircleGeometry(0.17, 18);
  const hoodGeo = new THREE.BoxGeometry(0.44, 0.06, 0.2);
  const armX = new THREE.BoxGeometry(5.6, 0.13, 0.13);
  const armZ = new THREE.BoxGeometry(0.13, 0.13, 5.6);
  const ARM_LEN = 5.6, ARM_Y = 6.0;

  // bake all four poles once into node-local cluster geometries, bucketed by
  // material (discs bucketed by axis+colour so they can toggle independently)
  const bucket = { pole: [], back: [], housing: [], disc: { ns: { red: [], yellow: [], green: [] }, ew: { red: [], yellow: [], green: [] } } };
  for (const def of poleDefs) {
    const [ax, az] = def.arm, [fx, fz] = def.face, [cxo, czo] = def.corner;
    const tg = new THREE.Group();
    const post = new THREE.Mesh(postGeo, poleMat); post.position.set(cxo, 3.3, czo); post.userData.b = 'pole'; tg.add(post);
    const arm = new THREE.Mesh(ax !== 0 ? armX : armZ, poleMat); arm.position.set(cxo + ax * ARM_LEN / 2, ARM_Y, czo + az * ARM_LEN / 2); arm.userData.b = 'pole'; tg.add(arm);
    const head = new THREE.Group();
    head.position.set(cxo + ax * ARM_LEN, ARM_Y - 0.95, czo + az * ARM_LEN);
    head.rotation.y = Math.atan2(fx, fz); tg.add(head);
    const hang = new THREE.Mesh(hangGeo, poleMat); hang.position.set(0, 0.95, 0); hang.userData.b = 'pole'; head.add(hang);
    const back = new THREE.Mesh(backGeo, backMat); back.position.set(0, 0, -0.04); back.userData.b = 'back'; head.add(back);
    const housing = new THREE.Mesh(housingGeo, housingMat); housing.userData.b = 'housing'; head.add(housing);
    ['red', 'yellow', 'green'].forEach((name, i) => {
      const y = 0.52 - i * 0.52;
      const bezel = new THREE.Mesh(bezelGeo, housingMat); bezel.position.set(0, y, 0.2); bezel.userData.b = 'housing'; head.add(bezel);
      const disc = new THREE.Mesh(discGeo, discMats[def.axis][name]); disc.position.set(0, y, 0.21); disc.userData.b = 'disc:' + def.axis + ':' + name; head.add(disc);
      const hood = new THREE.Mesh(hoodGeo, housingMat); hood.position.set(0, y + 0.2, 0.26); hood.userData.b = 'housing'; head.add(hood);
    });
    tg.updateMatrixWorld(true);
    tg.traverse((o) => {
      if (!o.isMesh) return;
      const g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld);
      const b = o.userData.b;
      if (b.startsWith('disc:')) { const [, axis, color] = b.split(':'); bucket.disc[axis][color].push(g); }
      else bucket[b].push(g);
    });
  }

  // instance each cluster across every signalised intersection
  const N = model.signalized.length;
  function addInst(geos, mat, cast) {
    if (!geos.length || !N) return;
    const im = new THREE.InstancedMesh(mergePN(geos), mat, N);
    im.castShadow = cast;
    const M = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
    for (let i = 0; i < N; i++) { const it = model.signalized[i]; p.set(it.x, 0, it.z); M.compose(p, q, one); im.setMatrixAt(i, M); }
    group.add(im);
  }
  addInst(bucket.pole, poleMat, true);
  addInst(bucket.back, backMat, true);
  addInst(bucket.housing, housingMat, true);
  for (const axis of ['ns', 'ew']) for (const color of ['red', 'yellow', 'green']) addInst(bucket.disc[axis][color], discMats[axis][color], false);

  function paint() {
    const night = 1 - getDayness();
    const onI = 1.7 + 1.9 * night;
    for (const axis of ['ns', 'ew']) {
      const showing = state[axis];
      for (const color of ['red', 'yellow', 'green']) discMats[axis][color].emissiveIntensity = color === showing ? onI : 0.03;
    }
  }
  paint();

  return {
    group,
    obstacles: [],   // poles are instanced/static now — no per-pole colliders
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
