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
const STREET_TREES = ['tree', 'tree2', 'oak'];        // broadleaf only on the streets
const PARK_TREES = ['tree', 'tree2', 'oak', 'pine'];  // pines belong in the park (#58)
// weighted sidewalk furniture pool (common things repeat). Mailboxes and road
// signs are held back for now — mailboxes suit a residential district (#45) and
// signs need real intersection logic (#46) before they belong on a corner.
const FURNITURE = ['bench', 'bench', 'trash', 'trash', 'hydrant', 'bicycle', 'bicycle',
  'meter', 'meter', 'bush', 'bush', 'dumpster', 'cone', 'barrier'];
// rare accents placed at most once per block edge (phone booths were too dense, #47)
const ACCENTS = ['phonebooth'];
// props that get a random per-instance colour for variety (#50 bikes, #55 benches)
const TINT = {
  bicycle: [0xb63a34, 0x2f6fb0, 0x2f8f6f, 0xd7a12b, 0x24272c, 0xe8e2d4, 0x6a4a8f, 0xc0552f],
  bench: [0x6a4a2f, 0x3d5c48, 0x41546e, 0x5a5a5a, 0x7a3a30, 0x4a4e54],
};
// light "loose" props that go flying when you plough into them (the rest —
// trees, statues, bus shelters, phone booths — stay bolted down).
const LOOSE = new Set(['bench', 'bicycle', 'cone', 'barrier', 'trash', 'meter', 'hydrant', 'bush', 'flowers']);

// merge geometries sharing a material: keep position + normal + uv + vertex
// colour (zero-fill uv / white-fill colour where a sub-mesh lacks it) so both
// textured AND vertex-coloured props survive instancing (else the latter — pine,
// oak — render black once their COLOR_0 attribute is dropped).
function mergeGroup(geos) {
  const g = geos.map((x) => (x.index ? x.toNonIndexed() : x));
  let vc = 0; for (const x of g) vc += x.attributes.position.count;
  let colSize = 0; for (const x of g) { if (x.attributes.color) { colSize = x.attributes.color.itemSize; break; } }
  const pos = new Float32Array(vc * 3), nor = new Float32Array(vc * 3), uv = new Float32Array(vc * 2);
  const col = colSize ? new Float32Array(vc * colSize) : null;
  let o = 0;
  for (const x of g) {
    const A = x.attributes.position, n = A.count;
    let N = x.attributes.normal; if (!N) { x.computeVertexNormals(); N = x.attributes.normal; }
    pos.set(A.array, o * 3); nor.set(N.array, o * 3);
    if (x.attributes.uv) uv.set(x.attributes.uv.array, o * 2);
    if (col) { if (x.attributes.color) col.set(x.attributes.color.array, o * colSize); else col.fill(1, o * colSize, (o + n) * colSize); }
    o += n;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (col) out.setAttribute('color', new THREE.BufferAttribute(col, colSize));
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
  const addTree = (x, z, kinds) => { add(pick(kinds), x, z, rnd() * 6.28); treeSpots.push({ x, z }); };

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
      // at most one rare accent (phone booth) per edge, not every slot (#47)
      const accentAt = !e.entrance && rnd() < 0.16 ? Math.floor(rnd() * (n + 1)) : -1;
      for (let i = 0; i <= n; i++) {
        const along = e.a + 3 + (len - 6) * (i / n);
        if (e.entrance && Math.abs(along - b.cx) < 4.5) continue;
        const x = e.horiz ? along : fixed, z = e.horiz ? fixed : along;
        if (stop && (x - stop.x) ** 2 + (z - stop.z) ** 2 < 16) continue; // clearance around the shelter
        add(i === accentAt ? pick(ACCENTS) : pick(FURNITURE), x, z, yaw);
      }
    }
  }

  // ---- street trees at block MID-EDGES (not corners) so they never grow into
  // the signal poles that stand on every intersection corner (#63, #74) ----
  const placedSoFar = [];                             // furniture + shelters, to keep trees clear
  for (const k in spots) for (const p of spots[k]) placedSoFar.push(p);
  for (const b of model.buildings) {
    const s = b.slab;
    const edges = [
      { horiz: true, fix: s.minZ, a: s.minX, b: s.maxX, out: -1 },
      { horiz: true, fix: s.maxZ, a: s.minX, b: s.maxX, out: 1 },
      { horiz: false, fix: s.minX, a: s.minZ, b: s.maxZ, out: -1 },
      { horiz: false, fix: s.maxX, a: s.minZ, b: s.maxZ, out: 1 },
    ];
    for (const e of edges) {
      if (rnd() < 0.55) continue;                     // ~45% of edges get a street tree
      const len = e.b - e.a;
      const along = e.a + len * (0.34 + rnd() * 0.32); // mid-block, away from the corner poles
      const fixed = e.fix - e.out * 1.7;               // just onto the sidewalk from the curb
      const x = e.horiz ? along : fixed, z = e.horiz ? fixed : along;
      if (near(busStops, x, z, 5)) continue;
      if (near(placedSoFar, x, z, 2.8)) continue;      // don't overlap furniture
      addTree(x, z, STREET_TREES);
    }
  }

  // ---- park props on the central plaza (avoid fountain / gazebo / clock tower) ----
  if (model.plaza) {
    const pz = model.plaza, cx = pz.cx, cz = pz.cz;
    const halfW = (pz.maxX - pz.minX) / 2 - 4, halfD = (pz.maxZ - pz.minZ) / 2 - 4;
    const blocked = [
      { x: cx, z: cz, r: 14 },              // fountain + roundabout
      { x: cx - 15, z: cz - 13, r: 5 },     // gazebo
      { x: cx + 15, z: cz + 14, r: 5 },     // clock tower
      { x: cx + 15, z: cz - 13, r: 7 },     // playground
      { x: cx - 14, z: cz + 12, r: 3 },     // statue
      { x: cx - 23, z: cz + 21, r: 8 },     // pond
    ];
    const okPark = (x, z) => !blocked.some((o) => (o.x - x) ** 2 + (o.z - z) ** 2 < o.r * o.r);
    const parkPlace = (k, count, extra) => {
      let placed = 0, tries = 0;
      while (placed < count && tries < count * 12) {
        tries++;
        const x = cx + (rnd() * 2 - 1) * halfW, z = cz + (rnd() * 2 - 1) * halfD;
        if (!okPark(x, z)) continue;
        if (k === 'tree') addTree(x, z, PARK_TREES); else add(k, x, z, rnd() * 6.28);
        if (extra) extra(x, z);
        placed++;
      }
    };
    add('statue', cx - 14, cz + 12, Math.PI);   // landmark statue in the NW quadrant (clear of the playground)
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
  const looseGroups = [];   // {ims:[InstancedMesh], objs:[flying state]} for knock-flying props
  const CAR_R = 1.7;
  const loader = makeGLTFLoader();
  for (const [key, list] of Object.entries(spots)) {
    if (!list.length || !PROPS[key]) continue;
    const cfg = PROPS[key];
    // one random colour per placement (shared across the prop's sub-meshes)
    const cols = TINT[key] ? list.map(() => new THREE.Color(pick(TINT[key]))) : null;
    loader.load(cfg.file, (gltf) => {
      const parts = prepGLB(gltf, cfg.h, cfg.yaw);
      // non-loose props (trees, bushes, stops, statue…) are the high-poly ones
      // and don't need the flying index-mapping, so bucket them into spatial
      // cells → each InstancedMesh gets a tight bounding sphere and frustum-culls
      // (one map-spanning InstancedMesh never culls — every tree drew every frame).
      if (!LOOSE.has(key)) {
        const PROP_CHUNK = 300; // coarse: we're draw-call bound with triangle headroom (#101)
        const cells = new Map();
        for (let i = 0; i < list.length; i++) {
          const ck = Math.floor(list[i].x / PROP_CHUNK) + ',' + Math.floor(list[i].z / PROP_CHUNK);
          let arr = cells.get(ck); if (!arr) { arr = []; cells.set(ck, arr); } arr.push(i);
        }
        const M = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
        for (const part of parts) {
          for (const idx of cells.values()) {
            const im = new THREE.InstancedMesh(part.geometry, part.material, idx.length);
            im.castShadow = true;
            for (let j = 0; j < idx.length; j++) {
              const i = idx[j];
              q.setFromAxisAngle(up, list[i].yaw); p.set(list[i].x, CURB_Y, list[i].z); M.compose(p, q, one); im.setMatrixAt(j, M);
              if (cols) im.setColorAt(j, cols[i]);
            }
            if (im.instanceColor) im.instanceColor.needsUpdate = true;
            im.computeBoundingSphere();
            group.add(im);
          }
        }
        return;
      }
      // Loose props (knock-flying) also chunk into spatial cells so distant cells
      // frustum-cull — bicycles alone were ~1750 × 1714 tris ≈ 3M drawn every
      // frame from a single map-spanning InstancedMesh (#98). The flying mechanic
      // works per-cell: one looseGroup per cell, objs indexed into that cell's
      // InstancedMeshes (local index), so knock-flying is unchanged.
      const r = key === 'bench' ? 1.5 : key === 'barrier' ? 1.3 : key === 'bicycle' ? 1.1
        : (key === 'hydrant' || key === 'cone') ? 0.7 : 0.95;
      const hit2 = (CAR_R + r) * (CAR_R + r);
      const LOOSE_CHUNK = 300; // coarse: draw-call bound, triangle headroom (#101)
      const cells = new Map();
      for (let i = 0; i < list.length; i++) {
        const ck = Math.floor(list[i].x / LOOSE_CHUNK) + ',' + Math.floor(list[i].z / LOOSE_CHUNK);
        let arr = cells.get(ck); if (!arr) { arr = []; cells.set(ck, arr); } arr.push(i);
      }
      const M = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
      for (const idx of cells.values()) {
        const partIms = [];
        for (const part of parts) {
          const im = new THREE.InstancedMesh(part.geometry, part.material, idx.length);
          im.castShadow = true;
          im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
          for (let j = 0; j < idx.length; j++) {
            const i = idx[j];
            q.setFromAxisAngle(up, list[i].yaw); p.set(list[i].x, CURB_Y, list[i].z); M.compose(p, q, one);
            im.setMatrixAt(j, M);
            if (cols) im.setColorAt(j, cols[i]);
          }
          if (im.instanceColor) im.instanceColor.needsUpdate = true;
          im.computeBoundingSphere();
          partIms.push(im);
          group.add(im);
        }
        looseGroups.push({
          ims: partIms,
          objs: idx.map((i, j) => ({ i: j, x: list[i].x, z: list[i].z, yaw: list[i].yaw, hit2, launched: false, rested: false })),
        });
      }
    }, undefined, () => { /* skip a prop that fails to load */ });
  }

  // Loose props go flying when the car ploughs through them: launch along the
  // car's travel with an outward kick + tumble, fall under gravity, bounce a
  // couple of times, then rest where they landed. Once you're well away they
  // quietly reset (like the toppling poles) so the city repairs itself.
  const GRAV = 24;
  const _M = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _one = new THREE.Vector3(1, 1, 1);
  function restMatrix(o, out) { _e.set(0, o.yaw, 0); _q.setFromEuler(_e); _p.set(o.x, CURB_Y, o.z); return out.compose(_p, _q, _one); }

  function update(dt, playerPos, heading, speed) {
    for (const grp of looseGroups) {
      let dirty = false;
      for (const o of grp.objs) {
        if (!o.launched) {
          if (playerPos && speed > 3) {
            const dx = o.x - playerPos.x, dz = o.z - playerPos.z;
            if (dx * dx + dz * dz < o.hit2) {
              const dl = Math.hypot(dx, dz) || 1, nx = dx / dl, nz = dz / dl;
              const hx = heading ? heading.x : nx, hz = heading ? heading.z : nz;
              o.launched = true; o.rested = false; o.bounce = 0;
              o.px = o.x; o.py = CURB_Y + 0.4; o.pz = o.z;
              o.vx = hx * speed * 0.7 + nx * (speed * 0.4 + 2);
              o.vz = hz * speed * 0.7 + nz * (speed * 0.4 + 2);
              o.vy = Math.min(speed * 0.5, 9) + 3;
              o.rx = 0; o.ry = o.yaw; o.rz = 0;
              o.wx = ((o.i * 13) % 9 - 4) * 2.3; o.wy = ((o.i * 7) % 9 - 4) * 2.0; o.wz = ((o.i * 17) % 9 - 4) * 2.3;
              dirty = true;
            }
          }
        } else if (!o.rested) {
          o.vy -= GRAV * dt;
          o.px += o.vx * dt; o.py += o.vy * dt; o.pz += o.vz * dt;
          o.vx *= (1 - 0.8 * dt); o.vz *= (1 - 0.8 * dt);
          o.rx += o.wx * dt; o.ry += o.wy * dt; o.rz += o.wz * dt;
          if (o.py <= CURB_Y + 0.05) {
            if (o.vy < -5 && o.bounce < 2) {
              o.bounce++; o.py = CURB_Y + 0.05; o.vy = -o.vy * 0.42;
              o.vx *= 0.55; o.vz *= 0.55; o.wx *= 0.6; o.wy *= 0.6; o.wz *= 0.6;
            } else {
              o.rested = true; o.py = CURB_Y + 0.05; o.vx = o.vz = o.vy = 0;
            }
          }
          _e.set(o.rx, o.ry, o.rz); _q.setFromEuler(_e); _p.set(o.px, o.py, o.pz);
          _M.compose(_p, _q, _one);
          for (const im of grp.ims) im.setMatrixAt(o.i, _M);
          dirty = true;
        } else {
          const far = !playerPos || ((o.x - playerPos.x) ** 2 + (o.z - playerPos.z) ** 2) > 8100; // 90 m
          if (far) {
            o.launched = false; o.rested = false;
            restMatrix(o, _M);
            for (const im of grp.ims) im.setMatrixAt(o.i, _M);
            dirty = true;
          }
        }
      }
      if (dirty) for (const im of grp.ims) im.instanceMatrix.needsUpdate = true;
    }
  }

  return { group, obstacles: [], update };
}
