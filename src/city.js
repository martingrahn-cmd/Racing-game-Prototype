// City generation: instanced buildings around the circuit, trees, ground and a hazy hill backdrop.
import * as THREE from 'three';
import {
  makeFacadeGlass, makeFacadeRibbon, makeFacadeResidential,
  makeRoofTexture, makeGroundTexture, mulberry32,
} from './textures.js';
import { frameAt, mergeGeoms, ROAD_HALF } from './track.js';

const DOWNTOWN = new THREE.Vector2(-30, 60);

// Box with base at y=0, side faces tiled (uRep, vRep), top/bottom on material #1 (roof).
function buildingGeometry(uRep, vRep) {
  const g = new THREE.BoxGeometry(1, 1, 1);
  g.translate(0, 0.5, 0);
  const uv = g.attributes.uv;
  // BoxGeometry face vertex order: px(0-3) nx(4-7) py(8-11) ny(12-15) pz(16-19) nz(20-23)
  for (let i = 0; i < 24; i++) {
    const isTopBottom = i >= 8 && i < 16;
    if (isTopBottom) uv.setXY(i, uv.getX(i) * 3, uv.getY(i) * 3);
    else uv.setXY(i, uv.getX(i) * uRep, uv.getY(i) * vRep);
  }
  g.clearGroups();
  g.addGroup(0, 12, 0);   // px + nx
  g.addGroup(12, 12, 1);  // py + ny (roof)
  g.addGroup(24, 12, 0);  // pz + nz
  return g;
}

// Facade textures already contain a full grid of floors, so the sides map
// roughly once per building (windows stretch a little with size — fine at speed).
const CLASSES = [
  { // low residential (texture has 8 floors, building has ~3 → show bottom part)
    geo: () => buildingGeometry(1, 0.5),
    tex: makeFacadeResidential,
    tints: [0xd6b8a0, 0xc9a184, 0xb98f6f, 0xd8d2c4, 0xccc0a8],
    rough: 0.9, metal: 0.0,
  },
  { // concrete mid-rise
    geo: () => buildingGeometry(1, 1),
    tex: makeFacadeRibbon,
    tints: [0xd8cfc0, 0xcfc8bb, 0xc9beac, 0xbfc4c9, 0xd2cabd],
    rough: 0.85, metal: 0.05,
  },
  { // glass tower
    geo: () => buildingGeometry(1, 1),
    tex: makeFacadeGlass,
    tints: [0xcfe0ea, 0xb8ccd8, 0xdce8f0, 0xaebfd4, 0xc4d8d2],
    rough: 0.35, metal: 0.25,
  },
];

function pickClass(rng, dt) {
  const r = rng();
  if (r < 0.12 + 0.45 * dt) return 2;
  if (r < 0.55 + 0.25 * dt) return 1;
  return 0;
}

function heightFor(cls, rng, dt) {
  if (cls === 2) return 34 + rng() * 58 * (0.35 + dt);
  if (cls === 1) return 16 + rng() * 22;
  return 7 + rng() * 9;
}

export function buildCity(scene, curve, length) {
  const rng = mulberry32(1337);

  // sample points for road-distance rejection
  const roadSamples = [];
  for (let i = 0; i < 420; i++) roadSamples.push(curve.getPointAt(i / 420));
  const minRoadDist = (x, z, d) => {
    const d2 = d * d;
    for (const p of roadSamples) {
      const dx = p.x - x, dz = p.z - z;
      if (dx * dx + dz * dz < d2) return false;
    }
    return true;
  };

  const placements = [[], [], []]; // per class: {pos, yaw, sx, sy, sz, tint}
  const treeSpots = [];

  // --- street wall: buildings fronting the circuit --------------------------
  const slot = 17;
  for (let s = 0; s < length - slot; s += slot) {
    for (const side of [-1, 1]) {
      const roll = rng();
      const { p, t, r } = frameAt(curve, length, s + rng() * 5);
      const yaw = Math.atan2(t.x, t.z);
      if (roll < 0.14) { // gap: park strip with trees
        const off = ROAD_HALF + 6.5 + rng() * 4;
        treeSpots.push({ x: p.x + r.x * side * off, z: p.z + r.z * side * off });
        if (rng() < 0.6) {
          const off2 = off + 3 + rng() * 3;
          treeSpots.push({ x: p.x + r.x * side * off2 + (rng() - 0.5) * 4, z: p.z + r.z * side * off2 + (rng() - 0.5) * 4 });
        }
        continue;
      }
      // street level stays human-scale; towers mostly live in the far skyline
      const dt = Math.max(0, 1 - Math.hypot(p.x - DOWNTOWN.x, p.z - DOWNTOWN.y) / 420) * 0.45;
      const cls = pickClass(rng, dt);
      const w = 10 + rng() * 8;   // along road
      const d = 9 + rng() * 9;    // depth
      const off = ROAD_HALF + 5.6 + d / 2 + rng() * 6;
      const x = p.x + r.x * side * off, z = p.z + r.z * side * off;
      if (!minRoadDist(x, z, Math.max(w, d) * 0.5 + ROAD_HALF + 4.2)) continue;
      placements[cls].push({
        x, z, yaw, sx: w, sy: heightFor(cls, rng, dt), sz: d,
        tint: CLASSES[cls].tints[Math.floor(rng() * CLASSES[cls].tints.length)],
      });
    }
  }

  // --- far field: skyline --------------------------------------------------
  for (let i = 0; i < 900; i++) {
    const x = DOWNTOWN.x + (rng() - 0.5) * 1750;
    const z = DOWNTOWN.y + (rng() - 0.5) * 1750;
    const w = 14 + rng() * 22, d = 14 + rng() * 22;
    if (!minRoadDist(x, z, Math.max(w, d) * 0.72 + ROAD_HALF + 5)) continue;
    const dt = Math.max(0, 1 - Math.hypot(x - DOWNTOWN.x, z - DOWNTOWN.y) / 520) * 0.8;
    const cls = pickClass(rng, dt);
    placements[cls].push({
      x, z, yaw: Math.floor(rng() * 4) * (Math.PI / 2) + 0.12,
      sx: w, sy: heightFor(cls, rng, dt) * (0.8 + dt * 0.9), sz: d,
      tint: CLASSES[cls].tints[Math.floor(rng() * CLASSES[cls].tints.length)],
    });
  }

  // --- create instanced meshes ---------------------------------------------
  const roofTex = makeRoofTexture();
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  for (let cls = 0; cls < 3; cls++) {
    const list = placements[cls];
    if (!list.length) continue;
    const spec = CLASSES[cls];
    const facadeMat = new THREE.MeshStandardMaterial({
      map: spec.tex(), roughness: spec.rough, metalness: spec.metal,
    });
    const roofMat = new THREE.MeshStandardMaterial({ map: roofTex, roughness: 0.95 });
    const mesh = new THREE.InstancedMesh(spec.geo(), [facadeMat, roofMat], list.length);
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    list.forEach((b, i) => {
      dummy.position.set(b.x, 0, b.z);
      dummy.rotation.set(0, b.yaw, 0);
      dummy.scale.set(b.sx, b.sy, b.sz);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, color.setHex(b.tint));
    });
    mesh.instanceColor.needsUpdate = true;
    scene.add(mesh);
  }

  // --- trees ----------------------------------------------------------------
  for (let i = 0; i < 260; i++) { // extra scattered park trees
    const x = DOWNTOWN.x + (rng() - 0.5) * 900;
    const z = DOWNTOWN.y + (rng() - 0.5) * 900;
    if (!minRoadDist(x, z, ROAD_HALF + 7)) continue;
    if (rng() < 0.5) treeSpots.push({ x, z });
  }
  if (treeSpots.length) {
    const trunk = new THREE.CylinderGeometry(0.14, 0.2, 1.7, 6);
    trunk.translate(0, 0.85, 0);
    const crown = new THREE.IcosahedronGeometry(1.35, 1);
    crown.scale(1, 1.25, 1);
    crown.translate(0, 2.7, 0);
    // vertex colors: trunk brown, crown green
    const paint = (g, hex) => {
      const n = g.attributes.position.count;
      const col = new Float32Array(n * 3);
      const c = new THREE.Color(hex);
      for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      if (!g.index) {
        const idx = []; for (let i = 0; i < n; i++) idx.push(i);
        g.setIndex(idx);
      }
      return g;
    };
    paint(trunk, 0x6b4a32);
    paint(crown, 0x4d7a3a);
    const treeGeo = mergeGeoms([trunk, crown]);
    const treeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
    const trees = new THREE.InstancedMesh(treeGeo, treeMat, treeSpots.length);
    trees.frustumCulled = false;
    trees.castShadow = true;
    treeSpots.forEach((t, i) => {
      dummy.position.set(t.x, 0, t.z);
      dummy.rotation.set(0, rng() * Math.PI * 2, 0);
      const sc = 0.8 + rng() * 0.9;
      dummy.scale.set(sc, sc * (0.85 + rng() * 0.4), sc);
      dummy.updateMatrix();
      trees.setMatrixAt(i, dummy.matrix);
      trees.setColorAt(i, color.setHSL(0.26 + rng() * 0.06, 0.4, 0.3 + rng() * 0.12));
    });
    trees.instanceColor.needsUpdate = true;
    scene.add(trees);
  }

  // --- ground ---------------------------------------------------------------
  const groundTex = makeGroundTexture();
  groundTex.repeat.set(90, 90);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(6000, 6000),
    new THREE.MeshStandardMaterial({ map: groundTex, roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.05;
  ground.receiveShadow = true;
  scene.add(ground);

  // --- hill silhouettes (two hazy rings, classic PS-era backdrop trick) -----
  const hillRing = (radius, base, amp, seedOff, hex) => {
    const SEG = 180;
    const pos = new Float32Array((SEG + 1) * 2 * 3);
    const idx = [];
    for (let i = 0; i <= SEG; i++) {
      const a = (i / SEG) * Math.PI * 2;
      const hN = Math.sin(a * 3 + seedOff) * 0.5 + Math.sin(a * 7 + seedOff * 2.3) * 0.3 + Math.sin(a * 13 + seedOff * 4.1) * 0.2;
      const hgt = base + Math.max(0, hN) * amp;
      const x = Math.cos(a) * radius, z = Math.sin(a) * radius;
      pos.set([x, -4, z], i * 6);
      pos.set([x, hgt, z], i * 6 + 3);
      if (i < SEG) {
        const k = i * 2;
        idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(idx);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: hex, side: THREE.DoubleSide }));
    scene.add(m);
  };
  hillRing(1750, 30, 200, 1.7, 0x6f8399);
  hillRing(2400, 60, 330, 4.2, 0x8095aa);
}
