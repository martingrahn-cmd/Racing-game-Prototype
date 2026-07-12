// Builds the open-world district geometry from the city model: asphalt street
// grid, lane markings, raised sidewalks with curbs, corner buildings (glassy
// facades, reused procedural textures), a central plaza (fountain, statue,
// trees, swings), and distant filler silhouettes. Returns the static colliders
// and knockable obstacles the driving/collision code needs.
import * as THREE from 'three';
import {
  makeSidewalkTexture, makeConcreteKerbTexture, makeRoofTexture,
  makeFacadeGlass, makeFacadeRibbon, makeFacadeResidential,
} from './textures.js';
import { registerEmissive, registerOpacity } from './night.js';
import { makeGLTFLoader } from './car.js';

function makeAsphalt() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = '#4d4e55'; x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2600; i++) {
    const g = 48 + Math.floor(Math.random() * 34);
    x.fillStyle = `rgba(${g},${g},${g + 2},0.5)`;
    x.fillRect(Math.random() * 256, Math.random() * 256, 1.4, 1.4);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function buildWorld(scene, model) {
  const group = new THREE.Group();
  scene.add(group);
  const { ROAD_HW, CURB_Y, nodes, min, max } = model;
  const obstacles = [];
  const span = max - min;

  // -------------------------------------------------- ground / asphalt
  const asphalt = makeAsphalt();
  asphalt.repeat.set((span + 400) / 20, (span + 400) / 20);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(span + 400, span + 400),
    new THREE.MeshStandardMaterial({ map: asphalt, roughness: 0.62, metalness: 0.04 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  // -------------------------------------------------- lane markings (merged)
  const markMat = new THREE.MeshStandardMaterial({
    color: 0xd9d6c8, roughness: 0.6, metalness: 0,
    emissive: 0xcfc9b4, emissiveIntensity: 0,
  });
  registerEmissive(markMat, 0, 0.3);
  const markGeos = [];
  const stripe = (cx, cz, w, d) => {
    const g = new THREE.PlaneGeometry(w, d);
    g.rotateX(-Math.PI / 2); g.translate(cx, 0.02, cz);
    markGeos.push(g);
  };
  const gap = ROAD_HW + 3;
  const EDGE = ROAD_HW - 0.35;
  // per street segment: centre dashes + edge lines (skip the intersection box)
  for (let a = 0; a < nodes.length; a++) {
    for (let s = 0; s < nodes.length - 1; s++) {
      const from = nodes[s] + gap, to = nodes[s + 1] - gap;
      // vertical street x = nodes[a], segment along z
      for (let z = from; z <= to; z += 4.4) stripe(nodes[a], z, 0.18, 2.4);
      stripe(nodes[a] - EDGE, (nodes[s] + nodes[s + 1]) / 2, 0.14, (to - from));
      stripe(nodes[a] + EDGE, (nodes[s] + nodes[s + 1]) / 2, 0.14, (to - from));
      // horizontal street z = nodes[a], segment along x
      for (let x = from; x <= to; x += 4.4) stripe(x, nodes[a], 2.4, 0.18);
      stripe((nodes[s] + nodes[s + 1]) / 2, nodes[a] - EDGE, (to - from), 0.14);
      stripe((nodes[s] + nodes[s + 1]) / 2, nodes[a] + EDGE, (to - from), 0.14);
    }
  }
  // crosswalks on the four approaches of each signalised intersection
  for (const it of model.signalized) {
    for (const [ax, az] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const at = ROAD_HW + 1.6;
      for (let b = -6; b <= 6; b += 1.5) {
        if (az !== 0) stripe(it.x + b, it.z + az * at, 0.5, 3.0);
        else stripe(it.x + ax * at, it.z + b, 3.0, 0.5);
      }
    }
  }
  const markMesh = new THREE.Mesh(mergeFlat(markGeos), markMat);
  markMesh.renderOrder = 1;
  group.add(markMesh);

  // -------------------------------------------------- sidewalks + curbs
  const swTex = makeSidewalkTexture(); swTex.repeat.set(10, 10);
  const curbTex = makeConcreteKerbTexture();
  const swTop = new THREE.MeshStandardMaterial({ map: swTex, roughness: 0.9, metalness: 0 });
  const curbSide = new THREE.MeshStandardMaterial({ map: curbTex, roughness: 0.85, metalness: 0 });
  const slabs = model.buildings.map((b) => b.slab);
  if (model.plaza) slabs.push(model.plaza);
  for (const s of slabs) {
    const w = s.maxX - s.minX, d = s.maxZ - s.minZ;
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(w, CURB_Y, d),
      [curbSide, curbSide, swTop, curbSide, curbSide, curbSide],
    );
    box.position.set((s.minX + s.maxX) / 2, CURB_Y / 2, (s.minZ + s.maxZ) / 2);
    box.receiveShadow = true;
    group.add(box);
  }

  // -------------------------------------------------- buildings
  const facades = { glass: makeFacadeGlass(), ribbon: makeFacadeRibbon(), residential: makeFacadeResidential() };
  const roofMat = new THREE.MeshStandardMaterial({ map: makeRoofTexture(), roughness: 0.9, metalness: 0 });
  const doorGlass = new THREE.MeshStandardMaterial({ color: 0x161d24, roughness: 0.12, metalness: 0.65 });
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x3b4048, roughness: 0.7, metalness: 0.25 });
  const bollardMat = new THREE.MeshStandardMaterial({ color: 0x1c1f24, roughness: 0.6, metalness: 0.5 });
  const mastMat = new THREE.MeshStandardMaterial({ color: 0x33373d, roughness: 0.6, metalness: 0.7 });
  const sconceMat = new THREE.MeshStandardMaterial({ color: 0x2a2418, emissive: 0xffdca0, emissiveIntensity: 0.08, roughness: 0.5 });
  registerEmissive(sconceMat, 0.08, 2.0);
  const signMat = new THREE.MeshStandardMaterial({ color: 0x151b22, emissive: 0xbfe0ff, emissiveIntensity: 0.15, roughness: 0.4 });
  registerEmissive(signMat, 0.15, 1.7);
  const tints = [0xdfe9f2, 0xe9e2d2, 0xd2e6ec, 0xf0ebe0];
  const awnings = [0x8a3f39, 0x3d5c48, 0x41546e, 0x7a6a4a];

  const aptSpots = [];
  model.buildings.forEach((b, i) => {
    // residential blocks are lined with real GLB apartment buildings instead of
    // one procedural mass — collect their placements, build them in one pass below
    if (b.category === 'residential') { collectApartments(b, aptSpots); return; }
    const w = b.maxX - b.minX, d = b.maxZ - b.minZ, h = b.height;
    const cx = b.cx, cz = b.cz;
    const f = facades[b.kind];
    const tex = (t) => { const c = t.clone(); c.wrapS = c.wrapT = THREE.RepeatWrapping; c.needsUpdate = true; c.repeat.set(Math.max(1, Math.round(w / 12)), Math.max(2, Math.round(h / 5))); return c; };
    const glassy = b.kind === 'glass';
    const matDef = {
      map: tex(f.map), normalMap: tex(f.normalMap), roughnessMap: tex(f.roughnessMap),
      emissive: 0xffffff, emissiveMap: tex(f.emissiveMap), emissiveIntensity: 0,
      color: tints[i % tints.length], roughness: glassy ? 0.28 : 1, metalness: glassy ? 0.1 : 0,
    };
    // glass towers get a physical clearcoat for real sheen (vector-rails vibe)
    const mat = glassy
      ? new THREE.MeshPhysicalMaterial({ ...matDef, clearcoat: 0.6, clearcoatRoughness: 0.25 })
      : new THREE.MeshStandardMaterial(matDef);
    registerEmissive(mat, 0, 1.25);
    const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [mat, mat, roofMat, roofMat, mat, mat]);
    box.position.set(cx, CURB_Y + h / 2, cz);
    box.castShadow = true; box.receiveShadow = true;
    group.add(box);

    // rooftop penthouse + beacon on the tall towers
    const ph = new THREE.Mesh(new THREE.BoxGeometry(w * 0.45, 3.2, d * 0.45), roofMat);
    ph.position.set(cx, CURB_Y + h + 1.6, cz); ph.castShadow = true; group.add(ph);
    if (h > 55) {
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 12, 6), mastMat);
      mast.position.set(cx, CURB_Y + h + 9.2, cz); group.add(mast);
      const beaconMat = new THREE.MeshStandardMaterial({ color: 0x2a0000, emissive: 0xff2200, emissiveIntensity: 1.2 });
      registerEmissive(beaconMat, 1.2, 3.4);
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8), beaconMat);
      beacon.position.set(cx, CURB_Y + h + 15.2, cz); group.add(beacon);
    }
    // additive glow bands on tall glass towers (night neon accent)
    if (glassy && h > 45) {
      for (let bnd = 0; bnd < 2; bnd++) {
        const y = CURB_Y + h * (0.4 + bnd * 0.28);
        const gb = new THREE.Mesh(new THREE.BoxGeometry(w + 0.2, 1.1, d + 0.2),
          new THREE.MeshBasicMaterial({ color: bnd ? 0xffc27a : 0x66e0ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
        gb.position.set(cx, y, cz);
        registerOpacity(gb.material, 0.0, 0.5); // dark by day, glowing at night
        group.add(gb);
      }
    }

    addEntrance(group, obstacles, b, { doorGlass, frameMat, awn: awnings[i % awnings.length], frameMat2: frameMat, bollardMat, sconceMat, signMat, curbSide }, CURB_Y);
  });

  if (model.plaza) buildPlaza(group, model.plaza, CURB_Y);
  buildApartments(group, aptSpots, CURB_Y);
  buildStreetLamps(group, model);

  // -------------------------------------------------- distant filler
  const fillerMat = new THREE.MeshStandardMaterial({ color: 0x2b313b, roughness: 1, metalness: 0 });
  const ring = max + 70;
  for (let k = -3; k <= 3; k++) {
    for (const sgn of [-1, 1]) {
      const off = k * 60 + (k % 2 ? 18 : 0);
      const h1 = 28 + ((k * 17 + 40) % 34);
      let bx = new THREE.Mesh(new THREE.BoxGeometry(24, h1, 22), fillerMat);
      bx.position.set(off, h1 / 2, sgn * ring); bx.castShadow = true; group.add(bx);
      const h2 = 30 + ((k * 11 + 20) % 30);
      bx = new THREE.Mesh(new THREE.BoxGeometry(22, h2, 24), fillerMat);
      bx.position.set(sgn * ring, h2 / 2, off); bx.castShadow = true; group.add(bx);
    }
  }

  const buildingAABBs = model.buildings.map((b) => ({ minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ }));
  return { group, colliders: { buildings: buildingAABBs }, obstacles };
}

// street entrance on the building's south (-z) face: recessed portal with frame,
// awning, signage, sconces and knockable bollards
function addEntrance(group, obstacles, b, m, CURB_Y) {
  const cx = b.cx, faceZ = b.minZ, nz = -1;
  const DW = 5, DH = 3.6, REV = 0.75;
  const lobbyMat = new THREE.MeshStandardMaterial({ color: 0x120d06, emissive: 0xffdca0, emissiveIntensity: 0 });
  registerEmissive(lobbyMat, 0, 0.85);
  const lobby = new THREE.Mesh(new THREE.PlaneGeometry(DW - 0.4, DH - 0.4), lobbyMat);
  lobby.position.set(cx, CURB_Y + DH / 2, faceZ + nz * 0.02); lobby.rotation.y = Math.PI; group.add(lobby);
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(DW, DH), m.doorGlass);
  glass.position.set(cx, CURB_Y + DH / 2, faceZ + nz * 0.05); glass.rotation.y = Math.PI; group.add(glass);
  for (const s of [-1, 1]) {
    const jamb = new THREE.Mesh(new THREE.BoxGeometry(0.45, DH + 0.5, REV), m.frameMat);
    jamb.position.set(cx + s * (DW / 2 + 0.22), CURB_Y + (DH + 0.5) / 2, faceZ + nz * REV / 2);
    jamb.castShadow = true; group.add(jamb);
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(DW + 0.9, 0.55, REV), m.frameMat);
  lintel.position.set(cx, CURB_Y + DH + 0.27, faceZ + nz * REV / 2); lintel.castShadow = true; group.add(lintel);
  const canopy = new THREE.Mesh(new THREE.BoxGeometry(DW + 1.6, 0.3, 2.6),
    new THREE.MeshStandardMaterial({ color: m.awn, roughness: 0.85 }));
  canopy.position.set(cx, CURB_Y + DH + 0.78, faceZ + nz * 1.55); canopy.castShadow = true; group.add(canopy);
  const sign = new THREE.Mesh(new THREE.BoxGeometry(DW - 0.6, 0.5, 0.08), m.signMat);
  sign.position.set(cx, CURB_Y + DH - 0.12, faceZ + nz * 0.13); group.add(sign);
  for (const s of [-1, 1]) {
    const sconce = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.5, 0.16), m.sconceMat);
    sconce.position.set(cx + s * (DW / 2 + 0.42), CURB_Y + 2.7, faceZ + nz * 0.16); group.add(sconce);
    const bollard = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.9, 10), m.bollardMat);
    bollard.position.set(cx + s * (DW / 2 + 0.9), CURB_Y + 0.45, faceZ + nz * 2.4);
    bollard.castShadow = true; group.add(bollard);
    obstacles.push({ x: bollard.position.x, z: bollard.position.z, r: 0.3, knocked: false,
      knock: () => { bollard.rotation.x = 1.4; bollard.position.y = CURB_Y + 0.1; } });
  }
}

// Street lamps lining every street segment. Built as instanced meshes (posts,
// glowing heads, and a soft light-pool disc) so the whole set is a handful of
// draw calls. Heads glow and pools fade in at night via the night registry.
function buildStreetLamps(group, model) {
  const { nodes, ROAD_HW, CURB_Y } = model;
  const OFF = ROAD_HW + 1.2;   // just past the curb, on the sidewalk
  const POST_H = 5;
  // unit lamp modelled pointing toward -x (arm reaches over the road); each
  // instance is yawed so the arm faces the street it lights.
  const postG = new THREE.CylinderGeometry(0.11, 0.14, POST_H, 8); postG.translate(0, POST_H / 2, 0);
  const armG = new THREE.BoxGeometry(1.8, 0.12, 0.12); armG.translate(-0.8, POST_H - 0.2, 0);
  const darkGeo = mergePN([postG, armG]);
  const headGeo = new THREE.BoxGeometry(0.52, 0.36, 0.44); headGeo.translate(-1.6, POST_H - 0.34, 0);
  const poolGeo = new THREE.CircleGeometry(4.6, 18); poolGeo.rotateX(-Math.PI / 2); poolGeo.translate(-1.6, 0.05, 0);

  const metalMat = new THREE.MeshStandardMaterial({ color: 0x33373d, roughness: 0.5, metalness: 0.7 });
  const headMat = new THREE.MeshStandardMaterial({ color: 0x2a2418, emissive: 0xffdca0, emissiveIntensity: 0.05, roughness: 0.5 });
  registerEmissive(headMat, 0.05, 2.6);
  const poolMat = new THREE.MeshBasicMaterial({ color: 0xffdca0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  registerOpacity(poolMat, 0.0, 0.3);

  const lamps = [];
  const seg = [0.34, 0.68];
  for (let a = 0; a < nodes.length; a++) {
    for (let s = 0; s < nodes.length - 1; s++) {
      for (const f of seg) {
        const p = nodes[s] + (nodes[s + 1] - nodes[s]) * f;
        lamps.push([nodes[a] + OFF, p, 0]);             // vertical street, +x sidewalk
        lamps.push([nodes[a] - OFF, p, Math.PI]);        // vertical street, -x sidewalk
        lamps.push([p, nodes[a] + OFF, -Math.PI / 2]);   // horizontal street, +z sidewalk
        lamps.push([p, nodes[a] - OFF, Math.PI / 2]);    // horizontal street, -z sidewalk
      }
    }
  }

  const N = lamps.length;
  const dark = new THREE.InstancedMesh(darkGeo, metalMat, N); dark.castShadow = true;
  const head = new THREE.InstancedMesh(headGeo, headMat, N);
  const pool = new THREE.InstancedMesh(poolGeo, poolMat, N); pool.renderOrder = 2;
  const M = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), pos = new THREE.Vector3();
  for (let i = 0; i < N; i++) {
    const [x, z, yaw] = lamps[i];
    q.setFromAxisAngle(up, yaw);
    pos.set(x, CURB_Y, z);
    M.compose(pos, q, one);
    dark.setMatrixAt(i, M); head.setMatrixAt(i, M); pool.setMatrixAt(i, M);
  }
  group.add(dark); group.add(head); group.add(pool);
}

// A residential block is ringed with apartment buildings facing the streets.
// Collect one placement per apartment slot (back to the block edge, front out).
function collectApartments(b, out) {
  const W = 11.5;   // apartment footprint width along the street
  const OFF = 3.6;  // half-depth: sit the back at the block edge
  const edges = [
    { horiz: true, fix: b.minZ + OFF, a: b.minX, len: b.maxX - b.minX, yaw: Math.PI },      // south → face -z
    { horiz: true, fix: b.maxZ - OFF, a: b.minX, len: b.maxX - b.minX, yaw: 0 },            // north → face +z
    { horiz: false, fix: b.minX + OFF, a: b.minZ, len: b.maxZ - b.minZ, yaw: -Math.PI / 2 }, // west  → face -x
    { horiz: false, fix: b.maxX - OFF, a: b.minZ, len: b.maxZ - b.minZ, yaw: Math.PI / 2 },  // east  → face +x
  ];
  for (const e of edges) {
    const usable = e.len - 2 * OFF;                 // leave the corners for the perpendicular rows
    const n = Math.max(1, Math.round(usable / W));
    for (let i = 0; i < n; i++) {
      const along = e.a + OFF + usable * ((i + 0.5) / n);
      out.push({ x: e.horiz ? along : e.fix, z: e.horiz ? e.fix : along, yaw: e.yaw });
    }
  }
}

// Normalise a building GLB (scale so its footprint width is `targetW`, feet at 0,
// centred) and instance it at every placement. One InstancedMesh per source mesh.
function buildApartments(group, spots, CURB_Y) {
  if (!spots.length) return;
  const loader = makeGLTFLoader();
  loader.load('assets/poly/apt1.glb', (gltf) => {
    gltf.scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(gltf.scene);
    const size = box.getSize(new THREE.Vector3());
    const s = 11.5 / Math.max(size.x, size.z);
    const N = new THREE.Matrix4().makeScale(s, s, s)
      .multiply(new THREE.Matrix4().makeTranslation(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2));
    const parts = [];
    gltf.scene.traverse((o) => { if (o.isMesh) { const g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld); g.applyMatrix4(N); parts.push({ geometry: g, material: o.material }); } });
    for (const part of parts) {
      const im = new THREE.InstancedMesh(part.geometry, part.material, spots.length);
      im.castShadow = true; im.receiveShadow = true;
      const M = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
      for (let i = 0; i < spots.length; i++) { q.setFromAxisAngle(up, spots[i].yaw); p.set(spots[i].x, CURB_Y, spots[i].z); M.compose(p, q, one); im.setMatrixAt(i, M); }
      group.add(im);
    }
  }, undefined, () => { /* keep the block empty if the model fails to load */ });
}

// Merge indexed geometries keeping position + normal (for untextured props).
function mergePN(geos) {
  const arrs = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  let vc = 0; for (const g of arrs) vc += g.attributes.position.count;
  const pos = new Float32Array(vc * 3), nor = new Float32Array(vc * 3);
  let o = 0;
  for (const g of arrs) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return out;
}

// central plaza: fountain, statue, trees, a small playground
function buildPlaza(group, plaza, CURB_Y) {
  const { cx, cz } = plaza;
  const stone = new THREE.MeshStandardMaterial({ color: 0xb7b1a4, roughness: 0.8, metalness: 0.05 });
  const grass = new THREE.MeshStandardMaterial({ color: 0x5f8f4e, roughness: 0.95, metalness: 0 });
  const trunk = new THREE.MeshStandardMaterial({ color: 0x6d5b3f, roughness: 0.85 });
  const leaf = new THREE.MeshStandardMaterial({ color: 0x4e8f45, roughness: 0.9 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x7c8790, roughness: 0.4, metalness: 0.6 });
  // grass pad
  const w = plaza.maxX - plaza.minX, d = plaza.maxZ - plaza.minZ;
  const pad = new THREE.Mesh(new THREE.BoxGeometry(w - 3, 0.05, d - 3), grass);
  pad.position.set(cx, CURB_Y + 0.03, cz); pad.receiveShadow = true; group.add(pad);
  // gentle grass mounds so the lawn isn't dead flat
  for (const [mx, mz, r, hy] of [[-13, 11, 6, 0.9], [12, 13, 5, 0.7], [14, -12, 5.5, 0.8], [-12, -13, 5, 0.6]]) {
    const mound = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 10), grass);
    mound.scale.y = hy / r; mound.position.set(cx + mx, CURB_Y + 0.03, cz + mz);
    mound.receiveShadow = true; mound.castShadow = true; group.add(mound);
  }
  // gravel walking paths (a plus through the park), matching the pedestrian routes
  const pathMat = new THREE.MeshStandardMaterial({ color: 0xbdb09a, roughness: 1, metalness: 0 });
  for (const horiz of [true, false]) {
    const path = new THREE.Mesh(new THREE.BoxGeometry(horiz ? w - 4 : 2.6, 0.06, horiz ? 2.6 : d - 4), pathMat);
    path.position.set(cx, CURB_Y + 0.06, cz); path.receiveShadow = true; group.add(path);
  }
  // fountain
  const basin = new THREE.Mesh(new THREE.CylinderGeometry(6, 6.4, 0.9, 28), stone);
  basin.position.set(cx, CURB_Y + 0.45, cz); basin.castShadow = true; group.add(basin);
  const waterMat = new THREE.MeshStandardMaterial({ color: 0x2f6f8f, emissive: 0x123040, emissiveIntensity: 0.2, roughness: 0.1, metalness: 0.3, transparent: true, opacity: 0.85 });
  registerEmissive(waterMat, 0.2, 0.8);
  const water = new THREE.Mesh(new THREE.CylinderGeometry(5.6, 5.6, 0.2, 28), waterMat);
  water.position.set(cx, CURB_Y + 0.85, cz); group.add(water);
  const jet = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.6, 3.2, 12), stone);
  jet.position.set(cx, CURB_Y + 2.2, cz); group.add(jet);
  // spraying water: a translucent plume up the jet + a fan of arcing streams that
  // fall back to the basin, plus scattered droplets (stylised, static)
  const sprayMat = new THREE.MeshStandardMaterial({ color: 0xbfe4f0, emissive: 0x2a6b82, emissiveIntensity: 0.25, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.5 });
  registerEmissive(sprayMat, 0.25, 0.7);
  const plume = new THREE.Mesh(new THREE.ConeGeometry(0.9, 2.6, 12, 1, true), sprayMat);
  plume.position.set(cx, CURB_Y + 5.1, cz); group.add(plume);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const stream = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.09, 3.4, 6), sprayMat);
    stream.position.set(cx + Math.cos(a) * 2.4, CURB_Y + 4.4, cz + Math.sin(a) * 2.4);
    stream.rotation.z = Math.cos(a) * 0.5; stream.rotation.x = -Math.sin(a) * 0.5; group.add(stream);
    const drop = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), sprayMat);
    drop.position.set(cx + Math.cos(a) * 4.6, CURB_Y + 2.4, cz + Math.sin(a) * 4.6); group.add(drop);
  }
  // statue on a pedestal
  const ped = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.2, 2.4), stone);
  ped.position.set(cx - 14, CURB_Y + 1.1, cz + 12); ped.castShadow = true; group.add(ped);
  const figure = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.7, 3.4, 10), metal);
  figure.position.set(cx - 14, CURB_Y + 3.9, cz + 12); figure.castShadow = true; group.add(figure);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.55, 12, 10), metal);
  head.position.set(cx - 14, CURB_Y + 5.9, cz + 12); group.add(head);
  // trees at the corners
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const tx = cx + sx * (w / 2 - 6), tz = cz + sz * (d / 2 - 6);
    const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 3.4, 8), trunk);
    tr.position.set(tx, CURB_Y + 1.7, tz); tr.castShadow = true; group.add(tr);
    const cr = new THREE.Mesh(new THREE.SphereGeometry(2.6, 12, 10), leaf);
    cr.position.set(tx, CURB_Y + 4.6, tz); cr.scale.y = 0.85; cr.castShadow = true; group.add(cr);
  }
  // playground swing set
  const gx = cx + 15, gz = cz - 13;
  for (const s of [-1, 1]) {
    const leg1 = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 3.4, 6), metal);
    leg1.position.set(gx - 2.2, CURB_Y + 1.7, gz + s * 1.6); leg1.rotation.x = s * 0.28; group.add(leg1);
    const leg2 = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 3.4, 6), metal);
    leg2.position.set(gx + 2.2, CURB_Y + 1.7, gz + s * 1.6); leg2.rotation.x = s * 0.28; group.add(leg2);
  }
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 4.8, 6), metal);
  beam.rotation.z = Math.PI / 2; beam.position.set(gx, CURB_Y + 3.3, gz); group.add(beam);
  for (const off of [-1.2, 1.2]) {
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.1, 0.35), new THREE.MeshStandardMaterial({ color: 0x333a3f, roughness: 0.8 }));
    seat.position.set(gx + off, CURB_Y + 1.0, gz); group.add(seat);
    for (const s of [-1, 1]) {
      const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 2.3, 4), metal);
      chain.position.set(gx + off, CURB_Y + 2.15, gz + s * 0.15); group.add(chain);
    }
  }

  // ---- benches ringing the fountain (facing in) ----
  const wood = new THREE.MeshStandardMaterial({ color: 0x6a4a2f, roughness: 0.8, metalness: 0.05 });
  for (let i = 0; i < 6; i++) {
    const ang = (i / 6) * Math.PI * 2 + 0.3;
    const bx = cx + Math.cos(ang) * 9.2, bz = cz + Math.sin(ang) * 9.2;
    const bench = new THREE.Group();
    const seat = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.1, 0.5), wood); seat.position.y = 0.46; bench.add(seat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.5, 0.1), wood); back.position.set(0, 0.73, -0.2); bench.add(back);
    for (const s of [-0.82, 0.82]) { const lg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.46, 0.5), metal); lg.position.set(s, 0.23, 0); bench.add(lg); }
    bench.position.set(bx, CURB_Y, bz); bench.rotation.y = ang + Math.PI / 2; bench.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    group.add(bench);
  }

  // ---- flower beds + hedges along the grass edges ----
  const hedge = new THREE.MeshStandardMaterial({ color: 0x3f7a3a, roughness: 0.95 });
  const blooms = [0xd85c7a, 0xe0b93a, 0xc95bd8, 0xe0663a];
  for (const [sx, sz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    const bx = cx + sx * (w / 2 - 4.5), bz = cz + sz * (d / 2 - 4.5);
    const bed = new THREE.Mesh(new THREE.BoxGeometry(sx ? 1.4 : 8, 0.4, sz ? 1.4 : 8), stone);
    bed.position.set(bx, CURB_Y + 0.2, bz); bed.castShadow = true; group.add(bed);
    const flower = new THREE.Mesh(new THREE.BoxGeometry(sx ? 1.1 : 7.6, 0.22, sz ? 1.1 : 7.6),
      new THREE.MeshStandardMaterial({ color: blooms[(sx + sz + 2) % blooms.length], roughness: 0.9 }));
    flower.position.set(bx, CURB_Y + 0.5, bz); group.add(flower);
  }
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const hx = cx + sx * (w / 2 - 3), hz = cz + sz * (d / 2 - 3);
    const h = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.9, 3.2), hedge);
    h.position.set(hx, CURB_Y + 0.45, hz); h.castShadow = true; group.add(h);
  }

  // ---- gazebo / bandstand landmark ----
  const gzx = cx - 15, gzz = cz - 13;
  const gzBase = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.6, 0.5, 8), stone);
  gzBase.position.set(gzx, CURB_Y + 0.25, gzz); gzBase.castShadow = true; group.add(gzBase);
  for (let i = 0; i < 6; i++) {
    const ang = (i / 6) * Math.PI * 2;
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 3.2, 8), new THREE.MeshStandardMaterial({ color: 0xe8e2d4, roughness: 0.7 }));
    col.position.set(gzx + Math.cos(ang) * 2.9, CURB_Y + 2.1, gzz + Math.sin(ang) * 2.9); col.castShadow = true; group.add(col);
  }
  const gzRoof = new THREE.Mesh(new THREE.ConeGeometry(3.7, 1.8, 8), new THREE.MeshStandardMaterial({ color: 0x5a6b74, roughness: 0.6, metalness: 0.3 }));
  gzRoof.position.set(gzx, CURB_Y + 4.6, gzz); gzRoof.castShadow = true; group.add(gzRoof);

  // ---- clock tower landmark ----
  const ctx = cx + 15, ctz = cz + 14;
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(2.6, 13, 2.6), new THREE.MeshStandardMaterial({ color: 0xcfc7b6, roughness: 0.85 }));
  shaft.position.set(ctx, CURB_Y + 6.5, ctz); shaft.castShadow = true; group.add(shaft);
  const faceMat = new THREE.MeshStandardMaterial({ color: 0xf4f0e6, emissive: 0xffe6a8, emissiveIntensity: 0.1, roughness: 0.5 });
  registerEmissive(faceMat, 0.1, 1.4);
  for (const [ox, oz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.9, 20), faceMat);
    face.position.set(ctx + ox * 1.32, CURB_Y + 11, ctz + oz * 1.32);
    face.lookAt(ctx + ox * 4, CURB_Y + 11, ctz + oz * 4); group.add(face);
  }
  const ctRoof = new THREE.Mesh(new THREE.ConeGeometry(2.2, 2.4, 4), new THREE.MeshStandardMaterial({ color: 0x4a5560, roughness: 0.6, metalness: 0.3 }));
  ctRoof.rotation.y = Math.PI / 4; ctRoof.position.set(ctx, CURB_Y + 14.2, ctz); ctRoof.castShadow = true; group.add(ctRoof);
}

// Minimal geometry merge for flat marking planes (position + uv only).
function mergeFlat(geos) {
  let vc = 0, ic = 0;
  for (const g of geos) { vc += g.attributes.position.count; ic += g.index.count; }
  const pos = new Float32Array(vc * 3), uv = new Float32Array(vc * 2), idx = new Uint32Array(ic);
  let vo = 0, io = 0;
  for (const g of geos) {
    const p = g.attributes.position.array, u = g.attributes.uv.array, ix = g.index.array;
    pos.set(p, vo * 3); uv.set(u, vo * 2);
    for (let i = 0; i < ix.length; i++) idx[io + i] = ix[i] + vo;
    vo += g.attributes.position.count; io += ix.length;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeVertexNormals();
  return out;
}
