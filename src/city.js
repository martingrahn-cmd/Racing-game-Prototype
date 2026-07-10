// City generation: instanced buildings around the circuit, trees, ground and a hazy hill backdrop.
import * as THREE from 'three';
import {
  makeFacadeGlass, makeFacadeRibbon, makeFacadeResidential,
  makeRoofTexture, makeGroundTexture, makeAdsAtlas, makeContactShadowTexture, mulberry32,
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
    rough: 0.35, metal: 0.45,
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

  const placements = [[], [], []]; // per class: {x, y?, z, yaw, sx, sy, sz, tint}
  const treeSpots = [];
  const billboards = []; // {x, z, yaw, w, h, y, ad}
  const antennas = [];   // {x, z, y, h}

  const maybeCrown = (b, cls, rngv) => {
    // tall towers get a setback crown + sometimes an antenna
    if (cls === 2 && b.sy > 46 && rngv < 0.6) {
      placements[2].push({
        ...b, y: b.sy, sx: b.sx * 0.62, sz: b.sz * 0.62, sy: b.sy * 0.3,
      });
      if (rngv < 0.35) antennas.push({ x: b.x, z: b.z, y: b.sy * 1.3, h: 5 + rngv * 20 });
    } else if (cls === 2 && b.sy > 60) {
      antennas.push({ x: b.x, z: b.z, y: b.sy, h: 6 + rngv * 14 });
    }
  };

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
      const b = {
        x, z, yaw, sx: w, sy: heightFor(cls, rng, dt), sz: d,
        tint: CLASSES[cls].tints[Math.floor(rng() * CLASSES[cls].tints.length)],
      };
      placements[cls].push(b);
      maybeCrown(b, cls, rng());
      // wall ad facing the track
      if (cls >= 1 && b.sy > 13 && rng() < 0.24) {
        const face = off - d / 2 - 0.18;
        const v = { x: -side * r.x, z: -side * r.z }; // toward road
        billboards.push({
          x: p.x + r.x * side * face, z: p.z + r.z * side * face,
          yaw: Math.atan2(v.x, v.z),
          w: 4.5 + rng() * 2.5, y: 7.5 + rng() * Math.min(b.sy - 11, 9),
          ad: Math.floor(rng() * 4),
        });
      }
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
    const b = {
      x, z, yaw: Math.floor(rng() * 4) * (Math.PI / 2) + 0.12,
      sx: w, sy: heightFor(cls, rng, dt) * (0.8 + dt * 0.9), sz: d,
      tint: CLASSES[cls].tints[Math.floor(rng() * CLASSES[cls].tints.length)],
    };
    placements[cls].push(b);
    maybeCrown(b, cls, rng());
  }

  // --- create instanced meshes ---------------------------------------------
  const roofTex = makeRoofTexture();
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  for (let cls = 0; cls < 3; cls++) {
    const list = placements[cls];
    if (!list.length) continue;
    const spec = CLASSES[cls];
    const f = spec.tex();
    const facadeMat = new THREE.MeshStandardMaterial({
      map: f.map, normalMap: f.normalMap, roughnessMap: f.roughnessMap,
      normalScale: new THREE.Vector2(0.8, 0.8),
      roughness: spec.rough, metalness: spec.metal,
    });
    const roofMat = new THREE.MeshStandardMaterial({ map: roofTex, roughness: 0.95 });
    const mesh = new THREE.InstancedMesh(spec.geo(), [facadeMat, roofMat], list.length);
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    list.forEach((b, i) => {
      dummy.position.set(b.x, b.y || 0, b.z);
      dummy.rotation.set(0, b.yaw, 0);
      dummy.scale.set(b.sx, b.sy, b.sz);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, color.setHex(b.tint));
    });
    mesh.instanceColor.needsUpdate = true;
    scene.add(mesh);
  }

  // --- rooftop antennas -------------------------------------------------------
  if (antennas.length) {
    const ag = new THREE.CylinderGeometry(0.06, 0.14, 1, 5);
    ag.translate(0, 0.5, 0);
    const am = new THREE.InstancedMesh(ag, new THREE.MeshStandardMaterial({ color: 0x33373d, roughness: 0.6 }), antennas.length);
    am.frustumCulled = false;
    antennas.forEach((a, i) => {
      dummy.position.set(a.x, a.y, a.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, a.h, 1);
      dummy.updateMatrix();
      am.setMatrixAt(i, dummy.matrix);
    });
    scene.add(am);
  }

  // --- wall ads (merged planes with atlas UVs, slightly emissive) -------------
  if (billboards.length) {
    const adsTex = makeAdsAtlas();
    const adGeos = billboards.map((b) => {
      const g = new THREE.PlaneGeometry(b.w, b.w * 0.75);
      const uvA = g.attributes.uv;
      const u0 = (b.ad % 2) * 0.5, v0 = 0.5 - Math.floor(b.ad / 2) * 0.5;
      for (let i = 0; i < uvA.count; i++) {
        uvA.setXY(i, u0 + uvA.getX(i) * 0.5, v0 + uvA.getY(i) * 0.5);
      }
      g.rotateY(b.yaw);
      g.translate(b.x, b.y, b.z);
      return g;
    });
    const adMesh = new THREE.Mesh(mergeGeoms(adGeos), new THREE.MeshStandardMaterial({
      map: adsTex, emissiveMap: adsTex, emissive: 0xffffff, emissiveIntensity: 0.42,
      roughness: 0.55,
    }));
    scene.add(adMesh);
  }

  // --- trees ----------------------------------------------------------------
  for (let i = 0; i < 260; i++) { // extra scattered park trees
    const x = DOWNTOWN.x + (rng() - 0.5) * 900;
    const z = DOWNTOWN.y + (rng() - 0.5) * 900;
    if (!minRoadDist(x, z, ROAD_HALF + 7)) continue;
    if (rng() < 0.5) treeSpots.push({ x, z });
  }
  if (treeSpots.length) {
    // organic canopy: several jittered leaf blobs, darker toward the bottom
    const paint = (g, hex, shade = 0) => {
      const pos = g.attributes.position;
      const n = pos.count;
      const col = new Float32Array(n * 3);
      const c = new THREE.Color(hex);
      const bb = g.boundingBox || (g.computeBoundingBox(), g.boundingBox);
      for (let i = 0; i < n; i++) {
        let f = 1;
        if (shade) {
          const t = (pos.getY(i) - bb.min.y) / (bb.max.y - bb.min.y);
          f = 0.55 + t * 0.55;
        }
        col[i * 3] = c.r * f; col[i * 3 + 1] = c.g * f; col[i * 3 + 2] = c.b * f;
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      if (!g.index) {
        const idx = []; for (let i = 0; i < n; i++) idx.push(i);
        g.setIndex(idx);
      }
      return g;
    };
    const jitter = (g, amt, rngj) => {
      const pos = g.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        pos.setXYZ(i,
          pos.getX(i) + (rngj() - 0.5) * amt,
          pos.getY(i) + (rngj() - 0.5) * amt,
          pos.getZ(i) + (rngj() - 0.5) * amt);
      }
      g.computeVertexNormals();
      return g;
    };
    const rngT = mulberry32(4242);
    const trunk = new THREE.CylinderGeometry(0.13, 0.22, 1.9, 6);
    trunk.translate(0, 0.95, 0);
    paint(trunk, 0x6b4a32);
    const blobs = [trunk];
    const blobSpec = [
      [0, 2.8, 0, 1.25], [0.8, 2.3, 0.3, 0.85], [-0.7, 2.45, -0.25, 0.8],
      [0.15, 2.2, -0.75, 0.75], [-0.2, 3.5, 0.2, 0.8],
    ];
    for (const [bx, by, bz, br] of blobSpec) {
      const blob = new THREE.IcosahedronGeometry(br, 2);
      jitter(blob, br * 0.22, rngT);
      blob.translate(bx, by, bz);
      blob.computeBoundingBox();
      paint(blob, 0x527c3c, 1);
      blobs.push(blob);
    }
    const treeGeo = mergeGeoms(blobs);
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

  // --- contact shadows (fake AO where buildings & trees meet the ground) ----
  {
    const spots = [];
    for (const list of placements) {
      for (const b of list) {
        if (b.y) continue; // crowns sit on towers, not the ground
        spots.push({ x: b.x, z: b.z, yaw: b.yaw, sx: b.sx * 1.5, sz: b.sz * 1.5 });
      }
    }
    for (const t of treeSpots) spots.push({ x: t.x, z: t.z, yaw: 0, sx: 4.2, sz: 4.2 });
    const g = new THREE.PlaneGeometry(1, 1);
    g.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      map: makeContactShadowTexture(), transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2,
    });
    const cs = new THREE.InstancedMesh(g, mat, spots.length);
    cs.frustumCulled = false;
    cs.renderOrder = 1;
    spots.forEach((sp, i) => {
      dummy.position.set(sp.x, 0.045, sp.z);
      dummy.rotation.set(0, sp.yaw, 0);
      dummy.scale.set(sp.sx, 1, sp.sz);
      dummy.updateMatrix();
      cs.setMatrixAt(i, dummy.matrix);
    });
    scene.add(cs);
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
