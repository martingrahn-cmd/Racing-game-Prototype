// Open-world pedestrians. The character models skin incorrectly under a live
// AnimationMixer (the cloned pose spreads and renders invisible), so instead we
// BAKE a flipbook of the walk cycle into static geometry (the technique the race
// crowd uses and which renders correctly). Each pedestrian holds ONE set of
// meshes and swaps their geometry reference per frame — so a 30-frame walk costs
// exactly the same per-frame as a 4-frame one (no per-frame skinning, no extra
// scene objects). The cycle is foot-locked to ground speed (no sliding).
//
// People walk a SIDEWALK GRAPH: block-corner nodes joined by sidewalk edges
// (around a block) and crosswalk edges (across a street at an intersection). They
// only step onto a crossing when that street's light is red for traffic, so they
// cross when it's safe and otherwise keep strolling. The crowd scales with the
// day: packed at midday, sparse at night. They also dodge the player's car.
import * as THREE from 'three';
import * as SkeletonUtils from '../vendor/utils/SkeletonUtils.js';
import { makeGLTFLoader } from './car.js';
import { getDayness } from './night.js';

const MODELS = [
  'assets/people/anne.glb', 'assets/people/casual.glb', 'assets/people/hoodie.glb',
  'assets/people/suit.glb', 'assets/people/worker.glb', 'assets/people/bizman.glb',
  'assets/people/woman.glb', 'assets/people/woman2.glb', 'assets/people/woman3.glb',
];
// which character models frequent which district (indices into MODELS above):
// 0 anne, 1 casual, 2 hoodie, 3 suit, 4 worker, 5 bizman, 6 woman, 7 woman2, 8 woman3
const ZONE_MODELS = {
  finance: [3, 3, 5, 5, 7, 8, 6],       // suits & business
  residential: [1, 1, 2, 2, 0, 6, 6],   // casual
  villa: [0, 1, 4, 6, 8, 0],            // families / mixed
  park: [0, 1, 2, 3, 4, 5, 6, 7, 8],    // everyone
};
const WALK = 1.25;        // m/s
const CROSS_RUSH = 1.6;   // people hurry across crosswalks
const DODGE_R = 5.5;
const NFRAMES = 30;       // baked walk-cycle frames (free at runtime via geometry swap)
const STRIDE = 1.35;      // metres travelled per full walk cycle → foot-locked, no sliding
// touch devices run a lighter crowd (per-frame AI + flipbook updates cost CPU)
const MOBILE = ('ontouchstart' in window) || (navigator.maxTouchPoints || 0) > 0;
const DAY_CROWD = MOBILE ? 120 : 460;  // pool size at full daylight (4× map; nearest render)
const NIGHT_CROWD = MOBILE ? 48 : 150; // active pedestrians at night

// Bake a full walk-cycle flipbook from one model. Clone the rig ONCE, then sample
// NFRAMES evenly across the clip, baking each posed frame into static world-space
// geometry (~1.72 m tall, feet at 0, centred). All frames share ONE normalising
// transform so the character's height doesn't jitter frame-to-frame. Returns an
// array of NFRAMES frames, each an array of {geometry, material} parts.
function bakePoseRaw(gltf, clip, time) {
  const clone = SkeletonUtils.clone(gltf.scene);
  const mixer = new THREE.AnimationMixer(clone);
  mixer.clipAction(clip).play();
  mixer.setTime(time);
  clone.updateMatrixWorld(true);
  const parts = [];
  const v = new THREE.Vector3();
  clone.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    o.skeleton.update();
    const g = o.geometry.clone();
    const src = o.geometry.attributes.position;
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(src, i);
      o.applyBoneTransform(i, v);
      v.applyMatrix4(o.matrixWorld);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    g.deleteAttribute('skinIndex');
    g.deleteAttribute('skinWeight');
    g.computeVertexNormals();
    parts.push({ geometry: g, material: o.material });
  });
  return parts;
}

// scale a set of baked parts by `s`, centre on x/z, drop feet to y=0 (in place).
function seatParts(parts, s) {
  const box = new THREE.Box3();
  for (const p of parts) { p.geometry.computeBoundingBox(); box.union(p.geometry.boundingBox); }
  const m = new THREE.Matrix4().makeScale(s, s, s)
    .multiply(new THREE.Matrix4().makeTranslation(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2));
  for (const p of parts) { p.geometry.applyMatrix4(m); p.geometry.computeBoundingSphere(); }
  return parts;
}

// Returns { frames, scale }. Frames are normalised to 1.72 m tall (feet at 0);
// scale is reused so a seated pose of the same model keeps human proportions.
function bakeFlipbook(gltf, clip, nFrames) {
  const frames = [];
  for (let f = 0; f < nFrames; f++) frames.push(bakePoseRaw(gltf, clip, clip.duration * (f / nFrames)));
  const box = new THREE.Box3();
  for (const parts of frames) for (const p of parts) { p.geometry.computeBoundingBox(); box.union(p.geometry.boundingBox); }
  const s = 1.72 / (box.max.y - box.min.y || 1.72);
  const m = new THREE.Matrix4().makeScale(s, s, s)
    .multiply(new THREE.Matrix4().makeTranslation(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2));
  for (const parts of frames) for (const p of parts) { p.geometry.applyMatrix4(m); p.geometry.computeBoundingSphere(); }
  return { frames, scale: s };
}

// a small red/cream checked picnic-blanket texture
function makeBlanketTex() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d');
  const cols = ['#b64a3a', '#e8ddc8'];
  for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) { x.fillStyle = cols[(i + j) % 2]; x.fillRect(i * 8, j * 8, 8, 8); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// scatter picnic blankets with a few seated people on the plaza grass (static)
function placePicnics(group, model, seated) {
  const { CURB_Y, plaza } = model;
  const cx = plaza.cx, cz = plaza.cz;
  const halfW = (plaza.maxX - plaza.minX) / 2 - 5, halfD = (plaza.maxZ - plaza.minZ) / 2 - 5;
  let seed = 99;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const blanketMat = new THREE.MeshStandardMaterial({ map: makeBlanketTex(), roughness: 0.95 });
  const blankGeo = new THREE.PlaneGeometry(2.4, 2.4); blankGeo.rotateX(-Math.PI / 2);
  const blocked = [[cx, cz, 14], [cx - 15, cz - 13, 5], [cx + 15, cz + 14, 5], [cx + 15, cz - 13, 7], [cx - 14, cz + 12, 3], [cx - 23, cz + 21, 8]];
  const cushCols = [0xb64a3a, 0x3d6a8f, 0x7a8a3a, 0x7a3a6a, 0xc9a23a];
  let placed = 0, tries = 0;
  while (placed < 5 && tries < 90) {
    tries++;
    const x = cx + (rnd() * 2 - 1) * halfW, z = cz + (rnd() * 2 - 1) * halfD;
    if (Math.abs(x - cx) < 2.4 || Math.abs(z - cz) < 2.4) continue;   // keep off the gravel paths
    if (blocked.some(([bx, bz, r]) => (bx - x) ** 2 + (bz - z) ** 2 < r * r)) continue;
    const bl = new THREE.Mesh(blankGeo, blanketMat); bl.position.set(x, CURB_Y + 0.05, z); bl.receiveShadow = true; group.add(bl);
    const n = 2 + Math.floor(rnd() * 2);
    for (let s = 0; s < n; s++) {
      const ang = (s / n) * Math.PI * 2 + rnd() * 0.4;
      const parts = seated[Math.floor(rnd() * seated.length)];
      const person = new THREE.Group();
      for (const part of parts) { const mm = new THREE.Mesh(part.geometry, part.material); mm.castShadow = true; person.add(mm); }
      const px = x + Math.cos(ang) * 0.85, pz = z + Math.sin(ang) * 0.85;
      person.position.set(px, CURB_Y + 0.02, pz);
      person.rotation.y = Math.atan2(x - px, z - pz); // face the blanket
      group.add(person);
      // a low cushion so the seated pose isn't perched on an invisible chair (#75)
      const cush = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.42, 0.62),
        new THREE.MeshStandardMaterial({ color: cushCols[Math.floor(rnd() * cushCols.length)], roughness: 0.92 }));
      cush.position.set(px, CURB_Y + 0.21, pz); cush.castShadow = true; cush.receiveShadow = true; group.add(cush);
    }
    placed++;
  }
}

// Build the sidewalk graph: a node per block corner, sidewalk edges around each
// block, crosswalk edges across a street to the matching corner of the neighbour
// block (tagged with the traffic axis whose red light makes the crossing safe).
function buildSidewalkGraph(model) {
  const { SIDEWALK } = model;
  const m = SIDEWALK / 2;
  const wb = model.buildings.map((b) => ({ bi: b.bi, bj: b.bj, slab: b.slab, cat: b.category }));
  if (model.plaza) wb.push({ bi: model.plaza.bi, bj: model.plaza.bj, slab: model.plaza, cat: 'park' });
  const grid = {};
  wb.forEach((b, idx) => {
    b.idx = idx;
    grid[`${b.bi},${b.bj}`] = b;
    const s = b.slab;
    // corners 0=TL 1=TR 2=BR 3=BL  (x = horizontal, z = vertical)
    b.corners = [
      [s.minX + m, s.minZ + m], [s.maxX - m, s.minZ + m],
      [s.maxX - m, s.maxZ - m], [s.minX + m, s.maxZ - m],
    ];
  });

  const nid = (idx, c) => idx * 4 + c;
  const edges = {};
  const add = (a, b, cross) => { (edges[a] = edges[a] || []).push({ to: b, cross }); };
  const nb = (i, j) => grid[`${i},${j}`];
  for (const b of wb) {
    for (let c = 0; c < 4; c++) {
      add(nid(b.idx, c), nid(b.idx, (c + 1) % 4), null); // sidewalk around the block
      add(nid(b.idx, c), nid(b.idx, (c + 3) % 4), null);
    }
    // crosswalks across a vertical street (walking in x) → safe when N-S is red
    const r = nb(b.bi + 1, b.bj);
    if (r) { add(nid(b.idx, 1), nid(r.idx, 0), 'ns'); add(nid(b.idx, 2), nid(r.idx, 3), 'ns'); }
    const l = nb(b.bi - 1, b.bj);
    if (l) { add(nid(b.idx, 0), nid(l.idx, 1), 'ns'); add(nid(b.idx, 3), nid(l.idx, 2), 'ns'); }
    // crosswalks across a horizontal street (walking in z) → safe when E-W is red
    const up = nb(b.bi, b.bj - 1);
    if (up) { add(nid(b.idx, 0), nid(up.idx, 3), 'ew'); add(nid(b.idx, 1), nid(up.idx, 2), 'ew'); }
    const dn = nb(b.bi, b.bj + 1);
    if (dn) { add(nid(b.idx, 3), nid(dn.idx, 0), 'ew'); add(nid(b.idx, 2), nid(dn.idx, 1), 'ew'); }
  }
  // park paths: a plus of walkways across the central plaza so people stroll
  // through the park (on paths) instead of only round its perimeter.
  const extra = [];
  const base = wb.length * 4;
  const plazaB = model.plaza ? wb.find((b) => b.bi === model.plaza.bi && b.bj === model.plaza.bj) : null;
  if (plazaB) {
    const C = plazaB.corners;
    const centerId = base + extra.length;
    extra.push([(C[0][0] + C[2][0]) / 2, (C[0][1] + C[2][1]) / 2]);
    for (let k = 0; k < 4; k++) {
      const a = C[k], b = C[(k + 1) % 4];
      const midId = base + extra.length;
      extra.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
      add(nid(plazaB.idx, k), midId, null); add(midId, nid(plazaB.idx, k), null);
      add(nid(plazaB.idx, (k + 1) % 4), midId, null); add(midId, nid(plazaB.idx, (k + 1) % 4), null);
      add(midId, centerId, null); add(centerId, midId, null);
    }
  }
  const pos = (id) => (id >= base ? extra[id - base] : wb[Math.floor(id / 4)].corners[id % 4]);
  const catOf = (id) => (id >= base ? 'park' : wb[Math.floor(id / 4)].cat || 'residential');
  const nodeCount = base + extra.length;
  return { edges, pos, catOf, nodeCount };
}

export function createPedestrians(scene, model, signals, count = DAY_CROWD) {
  const group = new THREE.Group();
  scene.add(group);
  const { CURB_Y } = model;
  const peds = [];
  const graph = buildSidewalkGraph(model);

  const safe = (cross) => {
    if (!cross) return true;
    const st = signals ? signals.getState() : null;
    return st ? st[cross] === 'red' : false;
  };
  // choose the next edge from p.a: crossings only when safe, avoid U-turns,
  // and bias toward staying on the sidewalk so people don't zig-zag the streets.
  function chooseNext(p) {
    const opts = (graph.edges[p.a] || []).filter((e) => safe(e.cross));
    let pool = opts.filter((e) => e.to !== p.prev);
    if (!pool.length) pool = opts;
    if (!pool.length) { p.b = p.a; p.cross = null; p.len = 1; return; }
    const weighted = [];
    for (const e of pool) { const w = e.cross ? 1 : 3; for (let i = 0; i < w; i++) weighted.push(e); }
    const e = weighted[Math.floor(Math.random() * weighted.length)];
    p.prev = p.a; p.b = e.to; p.cross = e.cross;
    const a = graph.pos(p.a), b = graph.pos(p.b);
    p.len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  }

  const loader = makeGLTFLoader();
  Promise.all(MODELS.map((p) => new Promise((res) => loader.load(p, res, undefined, () => res(null)))))
    .then((gltfs) => {
      const flipbooks = [];   // walk-cycle frames per usable model
      const seated = [];      // one baked seated pose per model that has a sit/duck clip
      for (const gltf of gltfs) {
        if (!gltf || !gltf.animations || !gltf.animations.length) continue;
        const walk = gltf.animations.find((c) => /walk/i.test(c.name)) || gltf.animations[0];
        let baked;
        try { baked = bakeFlipbook(gltf, walk, NFRAMES); } catch { continue; }
        flipbooks.push(baked.frames);
        const sit = gltf.animations.find((c) => /sit/i.test(c.name)) || gltf.animations.find((c) => /duck/i.test(c.name));
        if (sit) { try { seated.push(seatParts(bakePoseRaw(gltf, sit, sit.duration * 0.6), baked.scale)); } catch { /* skip */ } }
      }
      if (!flipbooks.length) return;

      // matte the character materials so the headlight beam lights them like
      // cloth, not like a lantern (no specular flare, no emissive, muted albedo).
      const seen = new Set();
      const matte = (mm) => {
        if (!mm || seen.has(mm) || !mm.isMeshStandardMaterial) return; seen.add(mm);
        mm.roughness = 1; mm.metalness = 0;
        if (mm.emissive) mm.emissive.setScalar(0);
        mm.emissiveIntensity = 0;
        if (mm.color) mm.color.multiplyScalar(0.8);
      };
      for (const fb of flipbooks) for (const parts of fb) for (const part of parts) matte(part.material);
      for (const parts of seated) for (const part of parts) matte(part.material);

      for (let k = 0; k < count; k++) {
        // pick a spawn node, then a character that fits that district
        const startNode = Math.floor(Math.random() * graph.nodeCount);
        const zonePool = ZONE_MODELS[graph.catOf(startNode)] || ZONE_MODELS.park;
        const fb = flipbooks[zonePool[Math.floor(Math.random() * zonePool.length)] % flipbooks.length];
        const container = new THREE.Group();
        const meshes = fb[0].map((part) => {
          const mesh = new THREE.Mesh(part.geometry, part.material);
          mesh.castShadow = true;   // frustum-culled (default): only on-screen peds draw
          container.add(mesh);
          return mesh;
        });
        group.add(container);
        const p = {
          group: container, meshes, fb, nF: fb.length, curFrame: 0,
          phase: Math.random() * fb.length,
          a: startNode, prev: -1,
          b: 0, cross: null, len: 1, t: Math.random(),
          base: WALK * (0.8 + Math.random() * 0.5),
          yaw: Math.random() * Math.PI * 2,
          dodge: new THREE.Vector2(0, 0), d2: 0,
        };
        chooseNext(p);
        peds.push(p);
      }

      if (seated.length && model.plaza) placePicnics(group, model, seated);
    });

  return {
    update(dt, playerPos) {
      for (const p of peds) {
        const a = graph.pos(p.a), b = graph.pos(p.b);
        const spd = p.base * (p.cross ? CROSS_RUSH : 1);
        p.t += spd * dt / p.len;
        if (p.t >= 1) { p.t -= 1; p.a = p.b; chooseNext(p); }
        const px = a[0] + (b[0] - a[0]) * p.t;
        const pz = a[1] + (b[1] - a[1]) * p.t;

        if (playerPos) {
          const dx = px + p.dodge.x - playerPos.x, dz = pz + p.dodge.y - playerPos.z;
          const d = Math.hypot(dx, dz);
          if (d < DODGE_R && d > 0.05) {
            p.dodge.x += (dx / d) * 9 * dt;
            p.dodge.y += (dz / d) * 9 * dt;
            if (p.dodge.length() > 2.6) p.dodge.setLength(2.6);
          }
        }
        p.dodge.multiplyScalar(Math.max(0, 1 - 2 * dt));

        const wx = px + p.dodge.x, wz = pz + p.dodge.y;
        p.group.position.set(wx, CURB_Y, wz);
        const targetYaw = Math.atan2(b[0] - a[0], b[1] - a[1]);
        let dy = targetYaw - p.yaw;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        p.yaw += dy * Math.min(1, 7 * dt);
        p.group.rotation.y = p.yaw;

        // foot-locked flipbook: one full cycle per STRIDE metres travelled
        p.phase += (spd * dt / STRIDE) * p.nF;
        const idx = Math.floor(p.phase) % p.nF;
        if (idx !== p.curFrame) {
          const parts = p.fb[idx];
          for (let i = 0; i < p.meshes.length; i++) p.meshes[i].geometry = parts[i].geometry;
          p.curFrame = idx;
        }

        if (playerPos) { const ex = wx - playerPos.x, ez = wz - playerPos.z; p.d2 = ex * ex + ez * ez; }
      }

      // day/night crowd size: pack the streets at midday, thin out after dark.
      // Hide the FARTHEST pedestrians so the pop-in happens off in the distance.
      const active = Math.round(NIGHT_CROWD + (DAY_CROWD - NIGHT_CROWD) * getDayness());
      if (active >= peds.length || !playerPos) {
        for (const p of peds) p.group.visible = true;
      } else {
        const order = peds.slice().sort((x, y) => x.d2 - y.d2);
        for (let i = 0; i < order.length; i++) order[i].group.visible = i < active;
      }
    },
  };
}
