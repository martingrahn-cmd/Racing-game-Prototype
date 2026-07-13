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
import { registerEmissive, registerOpacity, registerCustom } from './night.js';
import { makeGLTFLoader } from './car.js';

// Make a textured building glow from its windows at dusk/night. There's no window
// mask on these low-poly models, so we reuse the colour map as an emissive map at
// low intensity — the bright window areas glow more than the walls. Peaks in the
// evening, dims (but stays on) deep into the night, off in daylight.
function litWindows(mat) {
  if (!mat || !mat.isMeshStandardMaterial || !mat.map || mat.userData.lit) return;
  mat.userData.lit = true;
  mat.emissive = new THREE.Color(0xffe6b0);
  mat.emissiveMap = mat.map;
  mat.emissiveIntensity = 0;
  registerCustom((d) => {
    const n = 1 - d; // 0 = noon, 1 = midnight
    mat.emissiveIntensity = n < 0.45 ? (n / 0.45) * 0.55 : Math.max(0.3, 0.55 - (n - 0.45) * 0.4);
  });
}

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

  const aptSpots = [], villaSpots = [], villaBlocks = [], doors = [];
  const lotGrass = new THREE.MeshStandardMaterial({ color: 0x5f8f4e, roughness: 0.95, metalness: 0 });
  model.buildings.forEach((b, i) => {
    // residential blocks are lined with real GLB apartment buildings; villa blocks
    // (the edge) get a garden lot with a few detached houses — both instanced below
    if (b.category === 'residential') { collectApartments(b, aptSpots); return; }
    if (b.category === 'villa') { villaBlocks.push(b); collectVillas(b, villaSpots); return; }
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

    addEntrance(group, obstacles, doors, b, { doorGlass, frameMat, awn: awnings[i % awnings.length], frameMat2: frameMat, bollardMat, sconceMat, signMat, curbSide }, CURB_Y);
  });

  const plazaR = model.plaza ? buildPlaza(group, model.plaza, CURB_Y) : null;
  const lodCells = [];
  buildApartments(group, aptSpots, CURB_Y, lodCells);
  const hedgeMat = new THREE.MeshStandardMaterial({ color: 0x3f7a3a, roughness: 0.95, metalness: 0 });
  const hedgeGeo = new THREE.BoxGeometry(1, 1, 1);
  const fenceMat = new THREE.MeshStandardMaterial({ color: 0xb7a684, roughness: 0.85, metalness: 0 });
  const garageWall = new THREE.MeshStandardMaterial({ color: 0xd0cabb, roughness: 0.9, metalness: 0 });
  const garageDoor = new THREE.MeshStandardMaterial({ color: 0x6a5a44, roughness: 0.6, metalness: 0.25 });
  const garageRoof = new THREE.MeshStandardMaterial({ color: 0x7a5140, roughness: 0.8 });
  for (const b of villaBlocks) {
    const lot = new THREE.Mesh(new THREE.BoxGeometry(b.maxX - b.minX + 2, 0.06, b.maxZ - b.minZ + 2), lotGrass);
    lot.position.set(b.cx, CURB_Y + 0.04, b.cz); lot.receiveShadow = true; group.add(lot);
  }
  // each street-facing house gets its own fenced front garden + garage + driveway
  // (#79: individual plots, not one fence around the whole block)
  const parkedSpots = buildVillaGardens(group, villaSpots, CURB_Y,
    { fenceMat, garageWall, garageDoor, garageRoof, hedgeMat, hedgeGeo });
  buildVillas(group, villaSpots, CURB_Y, lodCells);
  buildParkedCars(group, parkedSpots, CURB_Y);
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

  const ramps = buildRamps(group, model);

  const buildingAABBs = model.buildings.map((b) => ({ minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ }));
  return {
    group, colliders: { buildings: buildingAABBs }, obstacles, ramps,
    updateDoors: (dt, playerPos) => updateDoors(doors, dt, playerPos),
    updateClock: (timeOfDay) => updateClock(plazaR && plazaR.clockHands, timeOfDay),
    updateLOD: (camPos) => updateBuildingLOD(lodCells, camPos),
  };
}

// street entrance on the building's south (-z) face: recessed portal with frame,
// awning, signage, sconces and knockable bollards
// automatic sliding doors: open when the player is close and now and then on
// their own (as if people are coming and going), revealing the lit lobby (#52)
function updateDoors(doors, dt, playerPos) {
  for (const d of doors) {
    d.timer -= dt;
    if (d.timer <= 0) { d.ambient = !d.ambient; d.timer = d.ambient ? 1.4 + d.rnd() * 1.6 : 7 + d.rnd() * 12; }
    const near = playerPos ? ((d.x - playerPos.x) ** 2 + (d.z - playerPos.z) ** 2) < 121 : false; // 11 m
    const target = near || d.ambient ? 1 : 0;
    d.open += (target - d.open) * Math.min(1, dt * 6);
    const slide = d.open * (d.hw - 0.12);
    d.left.position.x = d.baseL - slide;
    d.right.position.x = d.baseR + slide;
  }
}

function addEntrance(group, obstacles, doors, b, m, CURB_Y) {
  const cx = b.cx, faceZ = b.minZ, nz = -1;
  const DW = 5, DH = 3.6, REV = 0.75;
  const lobbyMat = new THREE.MeshStandardMaterial({ color: 0x120d06, emissive: 0xffdca0, emissiveIntensity: 0 });
  registerEmissive(lobbyMat, 0, 0.85);
  const lobby = new THREE.Mesh(new THREE.PlaneGeometry(DW - 0.4, DH - 0.4), lobbyMat);
  lobby.position.set(cx, CURB_Y + DH / 2, faceZ + nz * 0.02); lobby.rotation.y = Math.PI; group.add(lobby);
  // two sliding glass panels instead of one fixed pane
  const hw = DW / 2, panelGeo = new THREE.PlaneGeometry(hw, DH);
  const left = new THREE.Mesh(panelGeo, m.doorGlass);
  left.position.set(cx - DW / 4, CURB_Y + DH / 2, faceZ + nz * 0.05); left.rotation.y = Math.PI; group.add(left);
  const right = new THREE.Mesh(panelGeo, m.doorGlass);
  right.position.set(cx + DW / 4, CURB_Y + DH / 2, faceZ + nz * 0.05); right.rotation.y = Math.PI; group.add(right);
  let s = (Math.round(cx) * 131 + Math.round(faceZ) * 977) & 0x7fffffff;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  doors.push({ x: cx, z: faceZ, left, right, baseL: cx - DW / 4, baseR: cx + DW / 4, hw, open: 0, ambient: false, timer: 2 + rnd() * 12, rnd });
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
    const bx = cx + s * (DW / 2 + 0.9), bz = faceZ + nz * 2.4;
    const bg = new THREE.Group(); bg.position.set(bx, CURB_Y, bz);
    const bollard = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.9, 10), m.bollardMat);
    bollard.position.y = 0.45; bollard.castShadow = true; bg.add(bollard);
    group.add(bg);
    obstacles.push({ x: bx, z: bz, r: 0.3, group: bg, axis: 'x', sign: nz >= 0 ? 1 : -1, knocked: false, fall: 0 });
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
  const W = 13;     // apartment footprint width along the street
  const OFF = 4.5;  // half-depth: sit the back at the block edge (matches DEPTH=8)
  const edges = [
    { horiz: true, fix: b.minZ + OFF, a: b.minX, len: b.maxX - b.minX, yaw: Math.PI },      // south → face -z
    { horiz: true, fix: b.maxZ - OFF, a: b.minX, len: b.maxX - b.minX, yaw: 0 },            // north → face +z
    { horiz: false, fix: b.minX + OFF, a: b.minZ, len: b.maxZ - b.minZ, yaw: -Math.PI / 2 }, // west  → face -x
    { horiz: false, fix: b.maxX - OFF, a: b.minZ, len: b.maxZ - b.minZ, yaw: Math.PI / 2 },  // east  → face +x
  ];
  let seed = (b.bi * 23 + b.bj * 41) & 255;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (const e of edges) {
    const usable = e.len - 2 * OFF;                 // leave the corners for the perpendicular rows
    const n = Math.max(2, Math.round(usable / W));
    for (let i = 0; i < n; i++) {
      const along = e.a + OFF + usable * ((i + 0.5) / n);
      out.push({ x: e.horiz ? along : e.fix, z: e.horiz ? e.fix : along, yaw: e.yaw, m: Math.floor(rnd() * APT_MODELS.length) });
    }
  }
}

// Build InstancedMeshes bucketed into spatial cells. One InstancedMesh spanning
// the whole map never frustum-culls (its bounding sphere covers everything), so
// on a big map every instance renders every frame. Splitting placements into
// grid cells gives each chunk a tight bounding sphere, so distant/off-screen
// cells cull against the frustum + the clipped far plane. `place(a, i, M)` fills
// the matrix for placement `a`; optional `color(a, i)` sets a per-instance tint.
const CHUNK = 240; // metres per cell
function addChunked(group, geometry, material, list, place, opts = {}) {
  if (!list.length) return;
  const cells = new Map();
  for (const a of list) {
    const key = Math.floor(a.x / CHUNK) + ',' + Math.floor(a.z / CHUNK);
    let arr = cells.get(key); if (!arr) { arr = []; cells.set(key, arr); }
    arr.push(a);
  }
  const M = new THREE.Matrix4();
  for (const arr of cells.values()) {
    const im = new THREE.InstancedMesh(geometry, material, arr.length);
    im.castShadow = opts.castShadow !== false; im.receiveShadow = !!opts.receiveShadow;
    for (let i = 0; i < arr.length; i++) { place(arr[i], i, M); im.setMatrixAt(i, M); if (opts.color) im.setColorAt(i, opts.color(arr[i], i)); }
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere();
    group.add(im);
  }
}

// Building LOD: near cells draw the detailed model, far cells draw a single
// cheap box impostor per building (a low-poly GLB at ~5000 tris × thousands of
// instances is what pins the GPU). Per cell we build both the detail meshes and
// one box InstancedMesh, register the pair, and updateBuildingLOD() swaps them
// by camera distance each frame. `parts` are the baked {geometry,material} of
// the model (base at y=0). Returns nothing; pushes {x,z,detail,box} into cells.
const LOD_NEAR2 = 280 * 280; // within this radius → full detail, beyond → box impostor
function addBuildingLOD(group, parts, list, cellsOut, opts = {}) {
  if (!list.length || !parts.length) return;
  const y = opts.y || 0;
  // one box sized to the model's overall footprint + height
  const bb = new THREE.Box3();
  for (const part of parts) { part.geometry.computeBoundingBox(); bb.union(part.geometry.boundingBox); }
  const size = bb.getSize(new THREE.Vector3());
  const boxGeo = new THREE.BoxGeometry(Math.max(size.x, 1), Math.max(size.y, 1), Math.max(size.z, 1));
  boxGeo.translate((bb.min.x + bb.max.x) / 2, bb.min.y + size.y / 2, (bb.min.z + bb.max.z) / 2);
  const boxMat = new THREE.MeshStandardMaterial({ color: opts.impostorColor || 0x8a8886, roughness: 0.92, metalness: 0 });
  const cells = new Map();
  for (const a of list) {
    const key = Math.floor(a.x / CHUNK) + ',' + Math.floor(a.z / CHUNK);
    let arr = cells.get(key); if (!arr) { arr = []; cells.set(key, arr); }
    arr.push(a);
  }
  const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3(), M = new THREE.Matrix4();
  const fill = (im) => {
    for (let i = 0; i < im.count; i++) { const a = im.userData.arr[i]; q.setFromAxisAngle(up, a.yaw); p.set(a.x, y, a.z); M.compose(p, q, one); im.setMatrixAt(i, M); if (opts.color) im.setColorAt(i, opts.color(a, i)); }
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere();
  };
  for (const arr of cells.values()) {
    let sx = 0, sz = 0; for (const a of arr) { sx += a.x; sz += a.z; } sx /= arr.length; sz /= arr.length;
    const detail = [];
    for (const part of parts) {
      const im = new THREE.InstancedMesh(part.geometry, part.material, arr.length);
      im.castShadow = true; im.receiveShadow = true; im.userData.arr = arr; fill(im);
      group.add(im); detail.push(im);
    }
    const boxIm = new THREE.InstancedMesh(boxGeo, boxMat, arr.length);
    boxIm.castShadow = true; boxIm.userData.arr = arr; fill(boxIm); boxIm.visible = false;
    group.add(boxIm);
    cellsOut.push({ x: sx, z: sz, detail, box: boxIm });
  }
}
function updateBuildingLOD(cells, camPos) {
  if (!cells || !camPos) return;
  for (const c of cells) {
    const near = ((c.x - camPos.x) ** 2 + (c.z - camPos.z) ** 2) < LOD_NEAR2;
    if (c.box.visible === near) {           // state changed → swap detail <-> impostor
      c.box.visible = !near;
      for (const im of c.detail) im.visible = near;
    }
  }
}

// Instance the apartment models at every placement. Each model is normalised by
// DEPTH (its back-to-front size) so the street setback is the same whatever the
// model, then grouped by material into InstancedMeshes. Windows glow at night.
const APT_MODELS = ['assets/poly/apt_b.glb', 'assets/poly/apt_a.glb'];
function buildApartments(group, spots, CURB_Y, lodCells) {
  if (!spots.length) return;
  const loader = makeGLTFLoader();
  APT_MODELS.forEach((path, mi) => {
    const list = spots.filter((s) => s.m === mi);
    if (!list.length) return;
    loader.load(path, (gltf) => {
      gltf.scene.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(gltf.scene);
      const size = box.getSize(new THREE.Vector3());
      const s = 8 / (size.z || 1); // fix the depth so buildings sit flush to the block edge
      const N = new THREE.Matrix4().makeScale(s, s, s)
        .multiply(new THREE.Matrix4().makeTranslation(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2));
      const parts = [];
      gltf.scene.traverse((o) => { if (o.isMesh) { const g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld); g.applyMatrix4(N); parts.push({ geometry: g, material: o.material }); } });
      for (const part of parts) litWindows(part.material);
      addBuildingLOD(group, parts, list, lodCells, { y: CURB_Y, impostorColor: 0x8f8b84 });
    }, undefined, () => { /* keep the block empty if the model fails to load */ });
  });
}

// A villa block: detached houses set back on a garden lot, facing the streets.
// villa1 (pink) is out by request; use the brick two-storey and the driveway house
const VILLA_MODELS = ['assets/poly/house1.glb', 'assets/poly/villa_c.glb'];
// house1 ships with salmon-pink walls and villa_c is all-white; recolour both to
// dark-red / earthy tones (#67, #79). villa_c is a single material, so it gets a
// per-instance colour for variety; house1's walls are the `_defaultMat` part.
const VILLA_WALL = 0x7a2b26;
const VILLA_PALETTE = [0x7a2b26, 0x8f3a2c, 0x662a2a, 0x93502f, 0x6d4a3a, 0x844238];
function collectVillas(b, out) {
  const W = 15;    // house + garden spacing along the street
  const OFF = 6;   // set back from the street edge (front garden)
  const edges = [
    { horiz: true, fix: b.minZ + OFF, a: b.minX, len: b.maxX - b.minX, yaw: Math.PI, out: [0, -1] },
    { horiz: true, fix: b.maxZ - OFF, a: b.minX, len: b.maxX - b.minX, yaw: 0, out: [0, 1] },
    { horiz: false, fix: b.minX + OFF, a: b.minZ, len: b.maxZ - b.minZ, yaw: -Math.PI / 2, out: [-1, 0] },
    { horiz: false, fix: b.maxX - OFF, a: b.minZ, len: b.maxZ - b.minZ, yaw: Math.PI / 2, out: [1, 0] },
  ];
  let seed = (b.bi * 31 + b.bj * 17) & 255;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (const e of edges) {
    const usable = e.len - 2 * OFF;
    const n = Math.max(2, Math.round(usable / W));
    for (let i = 0; i < n; i++) {
      const along = e.a + OFF + usable * ((i + 0.5) / n);
      out.push({ x: e.horiz ? along : e.fix, z: e.horiz ? e.fix : along, yaw: e.yaw, m: Math.floor(rnd() * VILLA_MODELS.length), edge: true, out: e.out });
    }
  }
  // a couple of houses set into the middle so the lot isn't a bare lawn
  const inner = 2 + Math.floor(rnd() * 2);
  for (let i = 0; i < inner; i++) {
    out.push({
      x: b.minX + 12 + rnd() * (b.maxX - b.minX - 24),
      z: b.minZ + 12 + rnd() * (b.maxZ - b.minZ - 24),
      yaw: rnd() * Math.PI * 2, m: Math.floor(rnd() * VILLA_MODELS.length), edge: false,
    });
  }
}

function buildVillas(group, spots, CURB_Y, lodCells) {
  if (!spots.length) return;
  const loader = makeGLTFLoader();
  VILLA_MODELS.forEach((path, mi) => {
    const list = spots.filter((s) => s.m === mi);
    if (!list.length) return;
    loader.load(path, (gltf) => {
      gltf.scene.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(gltf.scene);
      const size = box.getSize(new THREE.Vector3());
      const s = 9 / Math.max(size.x, size.z);
      const N = new THREE.Matrix4().makeScale(s, s, s)
        .multiply(new THREE.Matrix4().makeTranslation(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2));
      const parts = [];
      gltf.scene.traverse((o) => { if (o.isMesh) { const g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld); g.applyMatrix4(N); parts.push({ geometry: g, material: o.material }); } });
      const mono = parts.length === 1;   // villa_c: one white material → per-instance colour
      for (const part of parts) {
        const m = part.material, nm = (m.name || '').toLowerCase();
        if (!mono) {
          if (nm === '_defaultmat') m.color.setHex(VILLA_WALL);   // house1's salmon walls → dark red
          else if (nm.includes('roof')) m.color.setHex(0x5f5148); // tone down the teal roof
        } else { m.color.setHex(0xffffff); m.vertexColors = false; } // white base so instanceColor is exact
        litWindows(part.material);
      }
      const colorFn = mono ? (a) => new THREE.Color(VILLA_PALETTE[Math.abs(Math.round(a.x) * 3 + Math.round(a.z)) % VILLA_PALETTE.length]) : null;
      addBuildingLOD(group, parts, list, lodCells, { y: CURB_Y, color: colorFn, impostorColor: mono ? 0xffffff : VILLA_WALL });
    }, undefined, () => { /* skip a villa model that fails to load */ });
  });
}

// Per-house front gardens: for every street-facing villa, a low fence around a
// front garden with a driveway gap, a garage on the driveway side, a paved
// driveway, and 0/1/2 cars parked on it (#79). Fully INSTANCED — at a 4× map
// this is thousands of houses, so each kind of piece (fence, garage body/door/
// roof, driveway, hedge) is drawn as a single InstancedMesh. Returns the
// parked-car spots.
function buildVillaGardens(group, spots, CURB_Y, mats) {
  const { fenceMat, garageWall, garageDoor, garageRoof, hedgeMat } = mats;
  const driveMat = new THREE.MeshStandardMaterial({ color: 0x6a6a6f, roughness: 0.95, metalness: 0 });
  const parkedSpots = [];
  const fences = [], drives = [], hedges = [], garages = [];   // collected placements
  const FH = 0.9, halfW = 6.2, front = 5.0, gapH = 2.0;
  for (const s of spots) {
    if (!s.edge || !s.out) continue;
    const [ox, oz] = s.out;             // toward the street
    const ax = -oz, az = ox;            // along the street
    let sd = (Math.round(s.x) * 73 + Math.round(s.z) * 91 + 7) & 0x7fffffff;
    const rnd = () => { sd = (sd * 1103515245 + 12345) & 0x7fffffff; return sd / 0x7fffffff; };
    const side = rnd() < 0.5 ? 1 : -1;          // which side the driveway/garage is on
    const gapC = side * (halfW - 2.4);          // driveway gap centre along the fence
    const fx = s.x + ox * front, fz = s.z + oz * front; // front fence centre, near the curb
    // front fence in two runs, leaving the driveway gap
    const seg = (c0, c1) => {
      const len = Math.abs(c1 - c0); if (len < 0.3) return;
      const mid = (c0 + c1) / 2;
      fences.push({ x: fx + ax * mid, z: fz + az * mid, sx: Math.abs(ax) * len + 0.13, sz: Math.abs(az) * len + 0.13 });
    };
    seg(-halfW, gapC - gapH); seg(gapC + gapH, halfW);
    // two side fences running back from the front corners toward the house
    const backLen = front + 1.2;
    for (const cs of [-1, 1]) {
      const c0x = fx + ax * (cs * halfW), c0z = fz + az * (cs * halfW);
      fences.push({ x: c0x - ox * backLen / 2, z: c0z - oz * backLen / 2, sx: Math.abs(ox) * backLen + 0.13, sz: Math.abs(oz) * backLen + 0.13 });
    }
    // a shrub or two in the garden
    for (let h = 0; h < 2; h++) {
      hedges.push({ x: s.x + ax * (-side * (halfW - 2)) + ox * (1.5 + h * 1.6), z: s.z + az * (-side * (halfW - 2)) + oz * (1.5 + h * 1.6) });
    }
    // garage on the driveway side, door facing the street
    const grx = s.x + ax * (side * (halfW - 1.6)), grz = s.z + az * (side * (halfW - 1.6));
    const gyaw = Math.atan2(ox, oz);
    garages.push({ x: grx, z: grz, yaw: gyaw });
    // paved driveway from the garage out to the street gap
    const dl = front + 3;
    drives.push({ x: grx + ox * (dl / 2 - 1), z: grz + oz * (dl / 2 - 1), sx: Math.abs(ox) * dl + Math.abs(ax) * 3.4, sz: Math.abs(oz) * dl + Math.abs(az) * 3.4 });
    // 0, 1 or 2 cars on the driveway (weighted)
    const r = rnd(); const nCars = r < 0.32 ? 0 : r < 0.72 ? 1 : 2;
    for (let c = 0; c < nCars; c++) parkedSpots.push({ x: grx + ox * (2.6 + c * 3.0), z: grz + oz * (2.6 + c * 3.0), yaw: gyaw });
  }
  // --- draw each collected kind as spatially-chunked InstancedMeshes ---
  const box = new THREE.BoxGeometry(1, 1, 1);
  const q0 = new THREE.Quaternion(), p0 = new THREE.Vector3(), sc = new THREE.Vector3();
  addChunked(group, box, fenceMat, fences, (a, i, M) => { p0.set(a.x, CURB_Y + FH / 2, a.z); sc.set(a.sx, FH, a.sz); M.compose(p0, q0, sc); });
  addChunked(group, box, driveMat, drives, (a, i, M) => { p0.set(a.x, CURB_Y + 0.05, a.z); sc.set(a.sx, 0.06, a.sz); M.compose(p0, q0, sc); }, { castShadow: false, receiveShadow: true });
  addChunked(group, box, hedgeMat, hedges, (a, i, M) => { p0.set(a.x, CURB_Y + 0.4, a.z); sc.set(1.1, 0.8, 1.1); M.compose(p0, q0, sc); });
  const bodyGeo = new THREE.BoxGeometry(4.4, 2.7, 4.4); bodyGeo.translate(0, 1.35, 0);
  const doorGeo = new THREE.BoxGeometry(3.0, 2.0, 0.12); doorGeo.translate(0, 1.0, 2.26);
  const roofGeo = new THREE.ConeGeometry(3.5, 1.3, 4); roofGeo.rotateY(Math.PI / 4); roofGeo.translate(0, 3.35, 0);
  const gup = new THREE.Vector3(0, 1, 0), gone = new THREE.Vector3(1, 1, 1);
  const placeGar = (a, i, M) => { q0.setFromAxisAngle(gup, a.yaw); p0.set(a.x, CURB_Y, a.z); M.compose(p0, q0, gone); };
  addChunked(group, bodyGeo, garageWall, garages, placeGar);
  addChunked(group, doorGeo, garageDoor, garages, placeGar, { castShadow: false });
  addChunked(group, roofGeo, garageRoof, garages, placeGar);
  return parkedSpots;
}

// A wedge stunt ramp (entry at local z=0, rising to height H at z=L).
function makeRampGeo(W, L, H) {
  const hw = W / 2;
  const a = [-hw, 0, 0], b = [hw, 0, 0], c = [-hw, 0, L], d = [hw, 0, L], e = [-hw, H, L], f = [hw, H, L];
  const tris = [a, b, f, a, f, e, /*incline*/ d, c, e, d, e, f, /*back*/ a, c, d, a, d, b, /*bottom*/ a, e, c, /*left*/ b, d, f /*right*/];
  const pos = new Float32Array(tris.length * 3);
  tris.forEach((v, i) => { pos[i * 3] = v[0]; pos[i * 3 + 1] = v[1]; pos[i * 3 + 2] = v[2]; });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

// Stunt ramps down the two central avenues — hit one at speed to launch (fun hook).
function buildRamps(group, model) {
  const { nodes, LANE } = model;
  const W = 6, L = 7, H = 2.3;
  const geo = makeRampGeo(W, L, H);
  const mat = new THREE.MeshStandardMaterial({ color: 0xe0b020, emissive: 0x3a2c00, emissiveIntensity: 0.3, roughness: 0.6, metalness: 0.2 });
  const mid = (model.BLOCKS - 1) / 2;   // the central avenue the player spawns on
  const specs = [];
  for (const seg of [mid - 3, mid - 1, mid + 1, mid + 3]) {
    if (seg < 0 || seg >= nodes.length - 1) continue;
    specs.push({ x: nodes[mid] - LANE, z: (nodes[seg] + nodes[seg + 1]) / 2, dir: [0, 1] });  // central N–S avenue
    specs.push({ x: (nodes[seg] + nodes[seg + 1]) / 2, z: nodes[mid] + LANE, dir: [1, 0] });  // central E–W avenue
  }
  const ramps = [];
  for (const s of specs) {
    const yaw = Math.atan2(s.dir[0], s.dir[1]);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(s.x, 0.02, s.z); m.rotation.y = yaw; m.castShadow = true; m.receiveShadow = true;
    group.add(m);
    // launch zone centred on the ramp's middle, sized to its footprint
    ramps.push({ x: s.x + s.dir[0] * L / 2, z: s.z + s.dir[1] * L / 2, dir: s.dir, halfL: L / 2 + 1, halfW: W / 2 + 0.5 });
  }
  return ramps;
}

// A few parked cars outside the villa garages (instanced from a traffic model).
function buildParkedCars(group, spots, CURB_Y) {
  if (!spots.length) return;
  const loader = makeGLTFLoader();
  loader.load('assets/traffic/sedan1.glb', (gltf) => {
    gltf.scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(gltf.scene);
    const size = box.getSize(new THREE.Vector3());
    const s = 4.3 / Math.max(size.x, size.z);
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
  }, undefined, () => { /* skip parked cars if the model fails */ });
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
  // gravel walking paths: a roundabout ring circling the fountain, fed by four
  // straight approaches from the entrances (#78 — no path straight through the
  // fountain any more).
  const pathMat = new THREE.MeshStandardMaterial({ color: 0xbdb09a, roughness: 1, metalness: 0 });
  const RING_R = 12, RING_W = 2.8;
  const ringPath = new THREE.Mesh(new THREE.RingGeometry(RING_R - RING_W / 2, RING_R + RING_W / 2, 44), pathMat);
  ringPath.rotation.x = -Math.PI / 2; ringPath.position.set(cx, CURB_Y + 0.06, cz); ringPath.receiveShadow = true; group.add(ringPath);
  for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const len = (w / 2 - 2) - RING_R, mid = RING_R + len / 2;
    const spur = new THREE.Mesh(new THREE.BoxGeometry(ox ? len : RING_W, 0.06, oz ? len : RING_W), pathMat);
    spur.position.set(cx + ox * mid, CURB_Y + 0.06, cz + oz * mid); spur.receiveShadow = true; group.add(spur);
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
  // (the real statue model is placed at cx-14,cz+12 by props_world; the crude
  // procedural figure that used to stand here was removed — one statue is enough)
  // trees at the corners
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const tx = cx + sx * (w / 2 - 6), tz = cz + sz * (d / 2 - 6);
    const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 3.4, 8), trunk);
    tr.position.set(tx, CURB_Y + 1.7, tz); tr.castShadow = true; group.add(tr);
    const cr = new THREE.Mesh(new THREE.SphereGeometry(2.6, 12, 10), leaf);
    cr.position.set(tx, CURB_Y + 4.6, tz); cr.scale.y = 0.85; cr.castShadow = true; group.add(cr);
  }
  // ---- playground: fenced gravel yard with a swing set + slide, opening toward
  // the fountain (#76 — no more statue standing in the middle of it) ----
  const gx = cx + 15, gz = cz - 13;
  const sand = new THREE.MeshStandardMaterial({ color: 0xd8c79a, roughness: 1, metalness: 0 });
  const pen = new THREE.Mesh(new THREE.BoxGeometry(11, 0.07, 11), sand);
  pen.position.set(gx, CURB_Y + 0.05, gz); pen.receiveShadow = true; group.add(pen);
  const picket = new THREE.MeshStandardMaterial({ color: 0x8a5a3a, roughness: 0.85 });
  const HALF = 5.4, PH = 0.8, OPEN = 2.2;
  const fenceRun = (x0, z0, x1, z1) => {
    const r = new THREE.Mesh(new THREE.BoxGeometry(Math.abs(x1 - x0) || 0.13, PH, Math.abs(z1 - z0) || 0.13), picket);
    r.position.set((x0 + x1) / 2, CURB_Y + PH / 2, (z0 + z1) / 2); r.castShadow = true; group.add(r);
  };
  fenceRun(gx - HALF, gz - HALF, gx + HALF, gz - HALF);   // south
  fenceRun(gx - HALF, gz + HALF, gx + HALF, gz + HALF);   // north
  fenceRun(gx + HALF, gz - HALF, gx + HALF, gz + HALF);   // east
  fenceRun(gx - HALF, gz - HALF, gx - HALF, gz - OPEN);   // west, split for the gate
  fenceRun(gx - HALF, gz + OPEN, gx - HALF, gz + HALF);   //   (opening faces the fountain)
  // swing set (shifted to the north half of the yard)
  const swZ = gz + 2.2;
  for (const s of [-1, 1]) {
    const leg1 = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 3.4, 6), metal);
    leg1.position.set(gx - 2.2, CURB_Y + 1.7, swZ + s * 1.4); leg1.rotation.x = s * 0.28; group.add(leg1);
    const leg2 = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 3.4, 6), metal);
    leg2.position.set(gx + 2.2, CURB_Y + 1.7, swZ + s * 1.4); leg2.rotation.x = s * 0.28; group.add(leg2);
  }
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 4.8, 6), metal);
  beam.rotation.z = Math.PI / 2; beam.position.set(gx, CURB_Y + 3.3, swZ); group.add(beam);
  for (const off of [-1.2, 1.2]) {
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.1, 0.35), new THREE.MeshStandardMaterial({ color: 0x333a3f, roughness: 0.8 }));
    seat.position.set(gx + off, CURB_Y + 1.0, swZ); group.add(seat);
    for (const s of [-1, 1]) {
      const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 2.3, 4), metal);
      chain.position.set(gx + off, CURB_Y + 2.15, swZ + s * 0.15); group.add(chain);
    }
  }
  // a little slide in the south half
  const slideMat = new THREE.MeshStandardMaterial({ color: 0x3f7fb0, roughness: 0.45, metalness: 0.3 });
  const slX = gx, slZ = gz - 2.8;
  const ramp = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.1, 3.6), slideMat);
  ramp.position.set(slX, CURB_Y + 1.05, slZ); ramp.rotation.x = 0.52; ramp.castShadow = true; group.add(ramp);
  const platform = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.1, 1.0), slideMat);
  platform.position.set(slX, CURB_Y + 1.95, slZ - 1.9); group.add(platform);
  for (const s of [-1, 1]) {
    const rung = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.1, 5), metal);
    rung.position.set(slX + s * 0.42, CURB_Y + 1.0, slZ - 2.3); group.add(rung);
  }

  // ---- benches just outside the roundabout, facing the fountain (#77/#78:
  // none sit on an approach axis or block a path) ----
  const wood = new THREE.MeshStandardMaterial({ color: 0x6a4a2f, roughness: 0.8, metalness: 0.05 });
  const benchR = RING_R + 2.7;
  for (let i = 0; i < 8; i++) {
    const ang = Math.PI / 8 + (i / 8) * Math.PI * 2;   // offset so none align with the 4 spurs
    const bx = cx + Math.cos(ang) * benchR, bz = cz + Math.sin(ang) * benchR;
    const bench = new THREE.Group();
    const seat = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.1, 0.5), wood); seat.position.y = 0.46; bench.add(seat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.5, 0.1), wood); back.position.set(0, 0.73, -0.2); bench.add(back);
    for (const s of [-0.82, 0.82]) { const lg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.46, 0.5), metal); lg.position.set(s, 0.23, 0); bench.add(lg); }
    // seat faces inward (back on the outer side)
    bench.position.set(bx, CURB_Y, bz); bench.rotation.y = -ang - Math.PI / 2; bench.traverse((o) => { if (o.isMesh) o.castShadow = true; });
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

  // ---- clock tower landmark (four faces show the in-game time, #73) ----
  const ctx = cx + 15, ctz = cz + 14;
  const brick = new THREE.MeshStandardMaterial({ color: 0xb9a894, roughness: 0.9 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x8a7a66, roughness: 0.85 });
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(2.6, 13, 2.6), brick);
  shaft.position.set(ctx, CURB_Y + 6.5, ctz); shaft.castShadow = true; group.add(shaft);
  // cornice band + belfry housing the faces
  const cornice = new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.5, 3.1), trim);
  cornice.position.set(ctx, CURB_Y + 9.4, ctz); cornice.castShadow = true; group.add(cornice);
  const belfry = new THREE.Mesh(new THREE.BoxGeometry(2.9, 3.2, 2.9), brick);
  belfry.position.set(ctx, CURB_Y + 11.2, ctz); belfry.castShadow = true; group.add(belfry);
  const faceMat = new THREE.MeshStandardMaterial({ color: 0xf4f0e6, emissive: 0xffe6a8, emissiveIntensity: 0.1, roughness: 0.5 });
  registerEmissive(faceMat, 0.1, 1.4);
  const handMat = new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.5 });
  const clockHands = [];
  for (const [ox, oz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
    const faceG = new THREE.Group();
    faceG.position.set(ctx + ox * 1.46, CURB_Y + 11.2, ctz + oz * 1.46);
    faceG.lookAt(ctx + ox * 4, CURB_Y + 11.2, ctz + oz * 4); // +z of the group points outward
    group.add(faceG);
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.95, 28), faceMat);
    face.position.z = 0.01; faceG.add(face);
    for (let h = 0; h < 12; h++) {
      const a = (h / 12) * Math.PI * 2;
      const tick = new THREE.Mesh(new THREE.BoxGeometry(h % 3 ? 0.05 : 0.09, 0.16, 0.02), handMat);
      tick.position.set(Math.sin(a) * 0.8, Math.cos(a) * 0.8, 0.03); tick.rotation.z = -a; faceG.add(tick);
    }
    const hour = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.52, 0.03), handMat);
    hour.geometry.translate(0, 0.21, 0); hour.position.z = 0.05; faceG.add(hour);
    const minute = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.8, 0.03), handMat);
    minute.geometry.translate(0, 0.33, 0); minute.position.z = 0.06; faceG.add(minute);
    clockHands.push({ hour, minute });
  }
  const ctRoof = new THREE.Mesh(new THREE.ConeGeometry(2.4, 2.6, 4), new THREE.MeshStandardMaterial({ color: 0x4a5560, roughness: 0.6, metalness: 0.3 }));
  ctRoof.rotation.y = Math.PI / 4; ctRoof.position.set(ctx, CURB_Y + 14.3, ctz); ctRoof.castShadow = true; group.add(ctRoof);

  // ---- decorative pond in the open mid-quadrant ----
  const pondX = cx - 23, pondZ = cz + 21;
  const pondWaterMat = new THREE.MeshStandardMaterial({ color: 0x2c6a86, emissive: 0x0e2a38, emissiveIntensity: 0.18, roughness: 0.12, metalness: 0.35, transparent: true, opacity: 0.9 });
  registerEmissive(pondWaterMat, 0.18, 0.7);
  const pondRim = new THREE.Mesh(new THREE.CylinderGeometry(6.6, 6.9, 0.5, 26), stone);
  pondRim.position.set(pondX, CURB_Y + 0.22, pondZ); pondRim.receiveShadow = true; group.add(pondRim);
  const pondWater = new THREE.Mesh(new THREE.CylinderGeometry(6.1, 6.1, 0.28, 26), pondWaterMat);
  pondWater.position.set(pondX, CURB_Y + 0.34, pondZ); pondWater.scale.z = 0.82; group.add(pondWater);
  const lily = new THREE.MeshStandardMaterial({ color: 0x3f8a45, roughness: 0.9 });
  const bloom = new THREE.MeshStandardMaterial({ color: 0xe4849e, roughness: 0.85 });
  for (const [lx, lz] of [[-2.4, 1.1], [1.8, -1.4], [2.6, 1.7], [-0.6, -2.1]]) {
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.06, 10), lily);
    pad.position.set(pondX + lx, CURB_Y + 0.47, pondZ + lz * 0.82); group.add(pad);
    if ((lx + lz) > 0) { const fl = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), bloom); fl.position.set(pondX + lx, CURB_Y + 0.55, pondZ + lz * 0.82); group.add(fl); }
  }
  // reeds/cattails clumped at the near edge
  const reedMat = new THREE.MeshStandardMaterial({ color: 0x6f8f3c, roughness: 0.95 });
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2, rr = 5.6 + (i % 3) * 0.3;
    const reed = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 1.4 + (i % 4) * 0.25, 5), reedMat);
    reed.position.set(pondX + Math.cos(a) * rr, CURB_Y + 0.9, pondZ + Math.sin(a) * rr * 0.82);
    reed.rotation.z = Math.cos(a) * 0.12; reed.castShadow = true; group.add(reed);
  }

  // ---- ornate park lamps along the gravel paths (glow at night) ----
  const lampPole = new THREE.MeshStandardMaterial({ color: 0x2b3138, roughness: 0.5, metalness: 0.6 });
  const lampGlass = new THREE.MeshStandardMaterial({ color: 0xfff2c8, emissive: 0xffd873, emissiveIntensity: 0.05, roughness: 0.3, metalness: 0.1, transparent: true, opacity: 0.92 });
  registerEmissive(lampGlass, 0.05, 2.6);
  function parkLamp(lx, lz) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.16, 4.2, 8), lampPole);
    post.position.set(lx, CURB_Y + 2.1, lz); post.castShadow = true; group.add(post);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.24, 0.35, 8), lampPole);
    cap.position.set(lx, CURB_Y + 4.5, lz); group.add(cap);
    const lantern = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.5), lampGlass);
    lantern.position.set(lx, CURB_Y + 4.05, lz); group.add(lantern);
    const top = new THREE.Mesh(new THREE.ConeGeometry(0.36, 0.4, 8), lampPole);
    top.position.set(lx, CURB_Y + 4.75, lz); group.add(top);
  }
  // four lamps around the roundabout (on the diagonals, between the benches) and
  // one part-way down each approach spur
  for (let i = 0; i < 4; i++) { const a = Math.PI / 4 + i * Math.PI / 2; parkLamp(cx + Math.cos(a) * (RING_R + 2.7), cz + Math.sin(a) * (RING_R + 2.7)); }
  for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { parkLamp(cx + ox * (RING_R + 10) + oz * 2.2, cz + oz * (RING_R + 10) + ox * 2.2); }

  // ---- low decorative perimeter railing (gaps at the 4 path entrances) ----
  const railMat = new THREE.MeshStandardMaterial({ color: 0x30363d, roughness: 0.5, metalness: 0.55 });
  const railHalf = w / 2 - 1.4, gap = 4.5;
  function railRun(a0, a1, fixed, horiz) {
    // posts + top/mid rail along one straight segment
    const len = a1 - a0; if (len <= 0) return;
    const n = Math.max(1, Math.round(len / 3.4));
    for (let i = 0; i <= n; i++) {
      const a = a0 + (len * i) / n;
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.0, 0.14), railMat);
      post.position.set(horiz ? a : fixed, CURB_Y + 0.5, horiz ? fixed : a); group.add(post);
    }
    for (const ry of [0.82, 0.42]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(horiz ? len : 0.08, 0.08, horiz ? 0.08 : len), railMat);
      rail.position.set(horiz ? (a0 + a1) / 2 : fixed, CURB_Y + ry, horiz ? fixed : (a0 + a1) / 2); group.add(rail);
    }
  }
  for (const side of [-1, 1]) {
    // top & bottom edges (horizontal runs), split by the central path gap
    railRun(cx - railHalf, cx - gap, cz + side * railHalf, true);
    railRun(cx + gap, cx + railHalf, cz + side * railHalf, true);
    // left & right edges (vertical runs)
    railRun(cz - railHalf, cz - gap, cx + side * railHalf, false);
    railRun(cz + gap, cz + railHalf, cx + side * railHalf, false);
  }

  return { clockHands };
}

// Advance the clock-tower hands to the in-game time. timeOfDay 0 = dawn (06:00),
// so hour = todHours + 6. Hands rotate clockwise (negative about the face's +z).
function updateClock(clockHands, timeOfDay) {
  if (!clockHands) return;
  const hours = (timeOfDay * 24 + 6) % 24;
  const minFrac = (timeOfDay * 24) % 1;             // 0..1 within the hour
  const minA = -minFrac * Math.PI * 2;
  const hourA = -(((hours % 12) + minFrac) / 12) * Math.PI * 2;
  for (const c of clockHands) { c.hour.rotation.z = hourA; c.minute.rotation.z = minA; }
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
