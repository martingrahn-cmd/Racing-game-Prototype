// Traffic lights across the district. One synced controller cycles the two
// axes (N–S vs E–W) through green → yellow → red with an all-red pause, and
// drives the emissive lamp on every corner pole. Near-side placement: each
// pole sits on the driver's-right corner before the intersection, arm out over
// that lane, head facing back at the driver, lamps as flat discs so a
// cross-street light reads edge-on (not the wrong colour).
//
// INSTANCED + CHUNKED: every signalised intersection carries the same four
// poles, and one controller drives them all, so the cluster is baked once and
// drawn as InstancedMeshes. But a single map-spanning InstancedMesh never
// frustum-culls (its bounding sphere covers everything): at a 4× map that
// drew ~1M signal triangles every frame no matter where the camera looked —
// the single biggest GPU cost on the iPhone (#109). So the instances are
// bucketed into ~300 m cells (like the street lamps, #103): only nearby cells
// rasterise. The static parts (pole/arm/backboard/housing/bezels/hoods) are
// also merged into ONE vertex-coloured indexed geometry — 1 draw per cell
// instead of 3 — and only the six lamp-disc materials toggle each frame.
import * as THREE from 'three';
import { getDayness } from './night.js';
import { mergeGeometries } from '../vendor/utils/BufferGeometryUtils.js';

const RED = 0xff3320, YEL = 0xffb020, GRN = 0x35dd55;
const SIG_CHUNK = 300; // metres per instancing cell — small enough to cull, big enough to stay draw-cheap

// Merge geometries into ONE indexed geometry with the given flat colour baked
// per-vertex. Keeping the index (instead of toNonIndexed) keeps vertex reuse,
// so the GPU runs ~3× fewer vertex-shader invocations for the same picture.
function prepVC(geo, color) {
  const g = geo.clone();
  for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.index) {
    const n = g.attributes.position.count;
    const idx = n > 65535 ? new Uint32Array(n) : new Uint16Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    g.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  const n = g.attributes.position.count, col = new Float32Array(n * 3);
  const c = new THREE.Color(color);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.clearGroups();
  return g;
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

  // flat colours for the static parts, baked to vertex colours below
  const POLE_COL = 0x23262b, HOUSING_COL = 0x15171a, BACK_COL = 0xc9b83a;
  const staticMat = new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0.35, vertexColors: true });
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
  // flat ring instead of a torus for the black rim around each lens: reads the
  // same past a couple of metres and is 24 tris instead of 288 — the torus alone
  // was ~3 500 tris per intersection (#109)
  const bezelGeo = new THREE.RingGeometry(0.135, 0.235, 12);
  const discGeo = new THREE.CircleGeometry(0.17, 12);
  const hoodGeo = new THREE.BoxGeometry(0.44, 0.06, 0.2);
  const armX = new THREE.BoxGeometry(5.6, 0.13, 0.13);
  const armZ = new THREE.BoxGeometry(0.13, 0.13, 5.6);
  const ARM_LEN = 5.6, ARM_Y = 6.0;

  // bake all four poles once into node-local cluster geometries: static parts
  // (with their colour) in one bucket, discs bucketed by axis+colour so they
  // can toggle independently
  const bucket = { static: [], disc: { ns: { red: [], yellow: [], green: [] }, ew: { red: [], yellow: [], green: [] } } };
  for (const def of poleDefs) {
    const [ax, az] = def.arm, [fx, fz] = def.face, [cxo, czo] = def.corner;
    const tg = new THREE.Group();
    const st = (mesh, col) => { mesh.userData.b = 'static'; mesh.userData.col = col; return mesh; };
    const post = st(new THREE.Mesh(postGeo, staticMat), POLE_COL); post.position.set(cxo, 3.3, czo); tg.add(post);
    const arm = st(new THREE.Mesh(ax !== 0 ? armX : armZ, staticMat), POLE_COL); arm.position.set(cxo + ax * ARM_LEN / 2, ARM_Y, czo + az * ARM_LEN / 2); tg.add(arm);
    const head = new THREE.Group();
    head.position.set(cxo + ax * ARM_LEN, ARM_Y - 0.95, czo + az * ARM_LEN);
    head.rotation.y = Math.atan2(fx, fz); tg.add(head);
    const hang = st(new THREE.Mesh(hangGeo, staticMat), POLE_COL); hang.position.set(0, 0.95, 0); head.add(hang);
    const back = st(new THREE.Mesh(backGeo, staticMat), BACK_COL); back.position.set(0, 0, -0.04); head.add(back);
    const housing = st(new THREE.Mesh(housingGeo, staticMat), HOUSING_COL); head.add(housing);
    ['red', 'yellow', 'green'].forEach((name, i) => {
      const y = 0.52 - i * 0.52;
      const bezel = st(new THREE.Mesh(bezelGeo, staticMat), HOUSING_COL); bezel.position.set(0, y, 0.2); head.add(bezel);
      const disc = new THREE.Mesh(discGeo, discMats[def.axis][name]); disc.position.set(0, y, 0.21); disc.userData.b = 'disc:' + def.axis + ':' + name; head.add(disc);
      const hood = st(new THREE.Mesh(hoodGeo, staticMat), HOUSING_COL); hood.position.set(0, y + 0.2, 0.26); head.add(hood);
    });
    tg.updateMatrixWorld(true);
    tg.traverse((o) => {
      if (!o.isMesh) return;
      const b = o.userData.b;
      if (b === 'static') { const g = prepVC(o.geometry, o.userData.col); g.applyMatrix4(o.matrixWorld); bucket.static.push(g); }
      else { const [, axis, color] = b.split(':'); const g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld); bucket.disc[axis][color].push(g); }
    });
  }
  const staticGeo = mergeGeometries(bucket.static, false);
  const discGeos = {};
  for (const axis of ['ns', 'ew']) {
    for (const color of ['red', 'yellow', 'green']) {
      discGeos[axis + color] = mergeGeometries(bucket.disc[axis][color].map((g) => {
        for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
        return g;
      }), false);
    }
  }

  // bucket the intersections into cells; each cell gets 1 static + 6 disc
  // InstancedMeshes with tight bounding spheres, so off-screen cells cull
  const cells = new Map();
  for (const it of model.signalized) {
    const key = Math.floor(it.x / SIG_CHUNK) + ',' + Math.floor(it.z / SIG_CHUNK);
    let arr = cells.get(key); if (!arr) { arr = []; cells.set(key, arr); }
    arr.push(it);
  }
  const M = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
  function addInst(geo, mat, arr, cast) {
    if (!geo || !arr.length) return;
    const im = new THREE.InstancedMesh(geo, mat, arr.length);
    im.castShadow = cast;
    for (let i = 0; i < arr.length; i++) { p.set(arr[i].x, 0, arr[i].z); M.compose(p, q, one); im.setMatrixAt(i, M); }
    im.computeBoundingSphere();
    group.add(im);
  }
  for (const arr of cells.values()) {
    addInst(staticGeo, staticMat, arr, true);
    for (const axis of ['ns', 'ew']) for (const color of ['red', 'yellow', 'green']) addInst(discGeos[axis + color], discMats[axis][color], arr, false);
  }

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
