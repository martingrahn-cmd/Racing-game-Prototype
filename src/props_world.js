// Street furniture & greenery for the open world, built from real CC0/CC-BY GLB
// props sourced from Poly Pizza — see assets/LICENSES.md. Each model is
// normalised (scaled to a real size, feet on the ground) and drawn as
// InstancedMesh sets grouped by material, so the whole city's furniture is only
// a handful of draw calls. Placement is deterministic (seeded) so the city looks
// the same each load.
import * as THREE from 'three';
import { makeGLTFLoader } from './car.js';

const P = 'assets/poly/';
// each prop: target height (m) and a base yaw so its "front" faces +z (toward the
// street when placed). Tune per model if one faces the wrong way.
const PROPS = {
  bench:      { file: P + 'bench.glb',      h: 0.85, yaw: Math.PI }, // #39: seat faces the street
  trash:      { file: P + 'trash_s.glb',    h: 0.95, yaw: 0 },
  hydrant:    { file: P + 'hydrant.glb',    h: 0.85, yaw: 0 },
  bicycle:    { file: P + 'bicycle.glb',    h: 1.1,  yaw: 0 },
  mailbox:    { file: P + 'mailbox.glb',    h: 1.1,  yaw: 0 },
  meter:      { file: P + 'meter.glb',      h: 1.35, yaw: 0 },
  phonebooth: { file: P + 'phonebooth.glb', h: 2.4,  yaw: 0 },
  streetsign: { file: P + 'streetsign.glb', h: 3.0,  yaw: 0 },
  bush:       { file: P + 'bush.glb',       h: 1.3,  yaw: 0 },
  hedge:      { file: P + 'hedge.glb',      h: 1.4,  yaw: 0 },
  dumpster:   { file: P + 'dumpster.glb',   h: 1.4,  yaw: 0 },
  cone:       { file: P + 'cone.glb',       h: 0.6,  yaw: 0 },
  barrier:    { file: P + 'barrier.glb',    h: 0.9,  yaw: 0 },
  busstop:    { file: P + 'busstop.glb',    h: 3.0,  yaw: 0 },
  picnic:     { file: P + 'picnic.glb',     h: 0.95, yaw: 0 },
  statue:     { file: P + 'statue.glb',     h: 4.2,  yaw: 0 },
  flowers:    { file: P + 'flowers.glb',    h: 0.5,  yaw: 0 },
  tree:       { file: P + 'tree.glb',       h: 6.0,  yaw: 0 }, // #44: bigger so it reads as a tree
  tree2:      { file: P + 'tree2.glb',      h: 5.6,  yaw: 0 },
  pine:       { file: P + 'pine.glb',       h: 7.5,  yaw: 0 },
  oak:        { file: P + 'oak.glb',        h: 7.0,  yaw: 0 },
};
const TREE_KINDS = ['tree', 'tree2', 'pine', 'oak'];
// weighted sidewalk furniture pool (common things repeat). Mailboxes and road
// signs are held back for now — mailboxes suit a residential district (#45) and
// signs need real intersection logic (#46) before they belong on a corner.
const FURNITURE = ['bench', 'bench', 'trash', 'trash', 'hydrant', 'bicycle', 'bicycle',
  'meter', 'bush', 'bush', 'phonebooth', 'dumpster', 'cone', 'barrier'];
// props that get a random per-instance colour for variety (#50 bikes, #55 benches)
const TINT = {
  bicycle: [0xb63a34, 0x2f6fb0, 0x2f8f6f, 0xd7a12b, 0x24272c, 0xe8e2d4, 0x6a4a8f, 0xc0552f],
  bench: [0x6a4a2f, 0x3d5c48, 0x41546e, 0x5a5a5a, 0x7a3a30, 0x4a4e54],
};

// merge geometries sharing a material: keep position + normal + uv (zero-fill uv
// where a sub-mesh has none) so textured props survive instancing.
function mergeGroup(geos) {
  const g = geos.map((x) => (x.index ? x.toNonIndexed() : x));
  let vc = 0; for (const x of g) vc += x.attributes.position.count;
  const pos = new Float32Array(vc * 3), nor = new Float32Array(vc * 3), uv = new Float32Array(vc * 2);
  let o = 0;
  for (const x of g) {
    const A = x.attributes.position;
    let N = x.attributes.normal; if (!N) { x.computeVertexNormals(); N = x.attributes.normal; }
    const U = x.attributes.uv;
    pos.set(A.array, o * 3); nor.set(N.array, o * 3);
    if (U) uv.set(U.array, o * 2);
    o += A.count;
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

  let seed = 20240;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

  const spots = {};                       // prop key -> [{x,z,yaw}]
  const add = (k, x, z, yaw) => { (spots[k] = spots[k] || []).push({ x, z, yaw }); };
  const busStops = [];                     // keep trees clear of shelters
  const treeSpots = [];                    // for dirt rings
  const near = (list, x, z, r) => list.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < r * r);
  const addTree = (x, z) => { add(pick(TREE_KINDS), x, z, rnd() * 6.28); treeSpots.push({ x, z }); };

  // ---- sidewalk furniture + bus shelters ----
  const INSET = 1.4, STOP_INSET = 0.7, SP = 8;
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
      const len = e.b - e.a;
      // bus shelter first, sitting nearer the curb (#38), so furniture stays clear
      let stop = null;
      if (!e.entrance && rnd() < 0.3) {
        const along = e.a + len * 0.5;
        const fx = e.fix - e.out[e.horiz ? 1 : 0] * STOP_INSET;
        const sx = e.horiz ? along : fx, sz = e.horiz ? fx : along;
        add('busstop', sx, sz, yaw); busStops.push({ x: sx, z: sz }); stop = { x: sx, z: sz };
      }
      const fixed = e.fix - e.out[e.horiz ? 1 : 0] * INSET;
      const n = Math.max(1, Math.floor((len - 6) / SP));
      for (let i = 0; i <= n; i++) {
        const along = e.a + 3 + (len - 6) * (i / n);
        if (e.entrance && Math.abs(along - b.cx) < 4.5) continue;
        const x = e.horiz ? along : fixed, z = e.horiz ? fixed : along;
        if (stop && (x - stop.x) ** 2 + (z - stop.z) ** 2 < 16) continue; // clearance around the shelter
        add(pick(FURNITURE), x, z, yaw);
      }
    }
  }

  // ---- street trees at intersection corners (halved, varied), clear of shelters ----
  for (let i = 0; i < nodes.length; i++) {
    for (let j = 0; j < nodes.length; j++) {
      for (const [ox, oz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        if (rnd() < 0.75) continue;                   // ~25% of corners → about half the old count
        const x = nodes[i] + ox * (ROAD_HW + 2.4), z = nodes[j] + oz * (ROAD_HW + 2.4);
        if (near(busStops, x, z, 5)) continue;
        addTree(x, z);
      }
    }
  }

  // ---- park props on the central plaza (avoid fountain / gazebo / clock tower) ----
  if (model.plaza) {
    const pz = model.plaza, cx = pz.cx, cz = pz.cz;
    const halfW = (pz.maxX - pz.minX) / 2 - 4, halfD = (pz.maxZ - pz.minZ) / 2 - 4;
    const blocked = [{ x: cx, z: cz, r: 8 }, { x: cx - 15, z: cz - 13, r: 5 }, { x: cx + 15, z: cz + 14, r: 5 }];
    const okPark = (x, z) => !blocked.some((o) => (o.x - x) ** 2 + (o.z - z) ** 2 < o.r * o.r);
    const parkPlace = (k, count, extra) => {
      let placed = 0, tries = 0;
      while (placed < count && tries < count * 12) {
        tries++;
        const x = cx + (rnd() * 2 - 1) * halfW, z = cz + (rnd() * 2 - 1) * halfD;
        if (!okPark(x, z)) continue;
        if (k === 'tree') addTree(x, z); else add(k, x, z, rnd() * 6.28);
        if (extra) extra(x, z);
        placed++;
      }
    };
    add('statue', cx + 15, cz - 13, Math.PI);   // a landmark statue opposite the gazebo
    parkPlace('picnic', 5);
    parkPlace('flowers', 6);
    parkPlace('bush', 7);
    parkPlace('hedge', 3);
    parkPlace('tree', 8);
  }

  // ---- dirt ring under every tree ----
  if (treeSpots.length) {
    const ringGeo = new THREE.CircleGeometry(1.35, 16); ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 1, metalness: 0 });
    const im = new THREE.InstancedMesh(ringGeo, ringMat, treeSpots.length);
    const M = new THREE.Matrix4();
    for (let i = 0; i < treeSpots.length; i++) { M.makeTranslation(treeSpots[i].x, CURB_Y + 0.02, treeSpots[i].z); im.setMatrixAt(i, M); }
    im.receiveShadow = true; group.add(im);
  }

  // ---- load each prop GLB and build its instanced sets ----
  const loader = makeGLTFLoader();
  for (const [key, list] of Object.entries(spots)) {
    if (!list.length || !PROPS[key]) continue;
    const cfg = PROPS[key];
    // one random colour per placement (shared across the prop's sub-meshes)
    const cols = TINT[key] ? list.map(() => new THREE.Color(pick(TINT[key]))) : null;
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
          if (cols) im.setColorAt(i, cols[i]);
        }
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
        group.add(im);
      }
    }, undefined, () => { /* skip a prop that fails to load */ });
  }

  return { group, obstacles: [] };
}
