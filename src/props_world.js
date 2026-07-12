// Street furniture for the open world, built from real CC0/CC-BY GLB props
// (benches, trash cans, fire hydrants, bus stops, trees) sourced from Poly Pizza
// — see assets/LICENSES.md. Each prop type is normalised (scaled to a real-world
// size, feet on the ground) and drawn as InstancedMesh sets (one per material),
// so the whole city's furniture is only a handful of draw calls no matter how
// many pieces. Placement is deterministic so the city looks the same each load.
import * as THREE from 'three';
import { makeGLTFLoader } from './car.js';

// GLB props: target height (m) and a base yaw so the "front" faces +z (toward
// the street when placed). Tune per model if one faces the wrong way.
const PROPS = {
  bench:   { file: 'assets/poly/bench.glb',   h: 0.85, yaw: 0 },
  trash:   { file: 'assets/poly/trash_s.glb', h: 0.95, yaw: 0 },
  hydrant: { file: 'assets/poly/hydrant.glb', h: 0.85, yaw: 0 },
  busstop: { file: 'assets/poly/busstop.glb', h: 3.0,  yaw: 0 },
  tree:    { file: 'assets/poly/tree.glb',    h: 5.0,  yaw: 0 },
};

// merge geometries sharing a material: keep position + normal + uv (zero-fill uv
// where a sub-mesh has none) so textured props survive instancing.
function mergeGroup(geos) {
  const g = geos.map((x) => (x.index ? x.toNonIndexed() : x));
  let vc = 0; for (const x of g) vc += x.attributes.position.count;
  const pos = new Float32Array(vc * 3), nor = new Float32Array(vc * 3), uv = new Float32Array(vc * 2);
  let o = 0;
  for (const x of g) {
    const P = x.attributes.position;
    let N = x.attributes.normal; if (!N) { x.computeVertexNormals(); N = x.attributes.normal; }
    const U = x.attributes.uv;
    pos.set(P.array, o * 3); nor.set(N.array, o * 3);
    if (U) uv.set(U.array, o * 2);
    o += P.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return out;
}

// bake a GLB into per-material {geometry, material}, normalised to `h` metres
// tall, centred on x/z with its base at y=0, rotated by base yaw.
function prepGLB(gltf, h, baseYaw) {
  gltf.scene.updateMatrixWorld(true);
  const meshes = [];
  gltf.scene.traverse((o) => {
    if (o.isMesh) { const geo = o.geometry.clone(); geo.applyMatrix4(o.matrixWorld); meshes.push({ geo, mat: o.material }); }
  });
  const box = new THREE.Box3();
  for (const m of meshes) { m.geo.computeBoundingBox(); box.union(m.geo.boundingBox); }
  const size = box.getSize(new THREE.Vector3());
  const s = h / (size.y || 1);
  const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
  const N = new THREE.Matrix4().makeRotationY(baseYaw)
    .multiply(new THREE.Matrix4().makeScale(s, s, s))
    .multiply(new THREE.Matrix4().makeTranslation(-cx, -box.min.y, -cz));
  const byMat = new Map();
  for (const m of meshes) { m.geo.applyMatrix4(N); if (!byMat.has(m.mat)) byMat.set(m.mat, []); byMat.get(m.mat).push(m.geo); }
  const parts = [];
  for (const [mat, gs] of byMat) parts.push({ geometry: mergeGroup(gs), material: mat });
  return parts;
}

export function createProps(scene, model) {
  const group = new THREE.Group();
  scene.add(group);
  const { CURB_Y, ROAD_HW, nodes } = model;

  // deterministic RNG so the layout is stable across loads
  let seed = 20240;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

  // ---- placement pass (independent of async GLB loading) ----
  const spots = { bench: [], trash: [], hydrant: [], busstop: [], tree: [] };
  const INSET = 1.4, SP = 8;
  const TYPES = ['bench', 'tree', 'trash', 'tree', 'hydrant', 'bench', 'tree'];
  for (const b of model.buildings) {
    const s = b.slab;
    const edges = [
      { horiz: true, fix: s.minZ, a: s.minX, b: s.maxX, out: [0, -1], entrance: true },
      { horiz: true, fix: s.maxZ, a: s.minX, b: s.maxX, out: [0, 1] },
      { horiz: false, fix: s.minX, a: s.minZ, b: s.maxZ, out: [-1, 0] },
      { horiz: false, fix: s.maxX, a: s.minZ, b: s.maxZ, out: [1, 0] },
    ];
    for (const e of edges) {
      const yaw = Math.atan2(e.out[0], e.out[1]);
      const fixed = e.fix - e.out[e.horiz ? 1 : 0] * INSET;
      const len = e.b - e.a;
      const n = Math.max(1, Math.floor((len - 6) / SP));
      for (let i = 0; i <= n; i++) {
        const along = e.a + 3 + (len - 6) * (i / n);
        if (e.entrance && Math.abs(along - b.cx) < 4.5) continue;
        const x = e.horiz ? along : fixed, z = e.horiz ? fixed : along;
        const t = TYPES[Math.floor(rnd() * TYPES.length)];
        spots[t].push({ x, z, yaw });
      }
      if (!e.entrance && rnd() < 0.3) {
        const along = e.a + len * 0.5;
        spots.busstop.push({ x: e.horiz ? along : fixed, z: e.horiz ? fixed : along, yaw });
      }
    }
  }
  // extra street trees at the outer corners of every intersection for a leafy grid
  for (let i = 0; i < nodes.length; i++) {
    for (let j = 0; j < nodes.length; j++) {
      for (const [ox, oz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        if (rnd() < 0.5) continue;
        spots.tree.push({ x: nodes[i] + ox * (ROAD_HW + 2.2), z: nodes[j] + oz * (ROAD_HW + 2.2), yaw: rnd() * 6.28 });
      }
    }
  }

  // ---- load each prop GLB and build its instanced sets ----
  const loader = makeGLTFLoader();
  for (const [key, cfg] of Object.entries(PROPS)) {
    const list = spots[key];
    if (!list.length) continue;
    loader.load(cfg.file, (gltf) => {
      const parts = prepGLB(gltf, cfg.h, cfg.yaw);
      for (const part of parts) {
        const im = new THREE.InstancedMesh(part.geometry, part.material, list.length);
        im.castShadow = true;
        const M = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
        for (let i = 0; i < list.length; i++) {
          q.setFromAxisAngle(up, list[i].yaw);
          p.set(list[i].x, CURB_Y, list[i].z);
          M.compose(p, q, one);
          im.setMatrixAt(i, M);
        }
        group.add(im);
      }
    }, undefined, () => { /* skip a prop that fails to load */ });
  }

  return { group, obstacles: [] };
}
