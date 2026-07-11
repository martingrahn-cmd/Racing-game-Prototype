// Builds the open-world slice geometry from the city model: asphalt, lane
// markings, raised sidewalks with curbs, corner buildings (reusing the
// procedural facades), and distant filler silhouettes. Returns the static
// colliders the driving/collision code needs.
import * as THREE from 'three';
import {
  makeSidewalkTexture, makeConcreteKerbTexture, makeRoofTexture,
  makeFacadeGlass, makeFacadeRibbon, makeFacadeResidential,
} from './textures.js';
import { registerEmissive } from './night.js';

function makeAsphalt() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = '#45464b'; x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2600; i++) {
    const g = 40 + Math.floor(Math.random() * 34);
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
  const { ROAD_HW, CURB_Y, ROAD_LEN } = model;

  // -------------------------------------------------- ground / asphalt
  const asphalt = makeAsphalt();
  asphalt.repeat.set(28, 28);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(560, 560),
    new THREE.MeshStandardMaterial({ map: asphalt, roughness: 0.96, metalness: 0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  // -------------------------------------------------- lane markings
  const markMat = new THREE.MeshStandardMaterial({
    color: 0xd9d6c8, roughness: 0.6, metalness: 0,
    emissive: 0xcfc9b4, emissiveIntensity: 0,
  });
  registerEmissive(markMat, 0, 0.3); // retroreflective glow at night
  const markGeos = [];
  const stripe = (cx, cz, w, d) => {
    const g = new THREE.PlaneGeometry(w, d);
    g.rotateX(-Math.PI / 2);
    g.translate(cx, 0.02, cz);
    markGeos.push(g);
  };
  const gap = ROAD_HW + 3; // clear the intersection box
  // centre dashes + edge lines along the Z road (runs in z, width in x)
  for (let z = -ROAD_LEN; z <= ROAD_LEN; z += 4.2) {
    if (Math.abs(z) < gap) continue;
    stripe(0, z, 0.18, 2.4);
  }
  // edge lines along the X road
  for (let x = -ROAD_LEN; x <= ROAD_LEN; x += 4.2) {
    if (Math.abs(x) < gap) continue;
    stripe(x, 0, 2.4, 0.18);
  }
  // solid edge lines (split around the intersection)
  for (const s of [-1, 1]) {
    const a = (ROAD_LEN + gap) / 2, c = s * (gap + ROAD_LEN) / 2;
    const half = (ROAD_LEN - gap) / 2, mid = s * (gap + ROAD_LEN) / 2;
    for (const e of [-(ROAD_HW - 0.35), ROAD_HW - 0.35]) {
      stripe(e, mid, 0.14, half * 2);   // Z road edges
      stripe(mid, e, half * 2, 0.14);   // X road edges
    }
  }
  // crosswalks + stop lines on all four approaches
  const approaches = [['z', -1], ['z', 1], ['x', -1], ['x', 1]];
  for (const [axis, s] of approaches) {
    const at = s * (ROAD_HW + 1.6);
    for (let b = -6; b <= 6; b += 1.5) { // zebra bars
      if (axis === 'z') stripe(b, at, 0.5, 3.0);
      else stripe(at, b, 3.0, 0.5);
    }
    const stopAt = s * (ROAD_HW + 3.4);
    if (axis === 'z') stripe(-s * (ROAD_HW / 2 + 0.5), stopAt, ROAD_HW - 0.6, 0.32);
    else stripe(stopAt, -s * (ROAD_HW / 2 + 0.5), 0.32, ROAD_HW - 0.6);
  }
  // merge markings into one mesh
  const markMesh = new THREE.Mesh(mergeFlat(markGeos), markMat);
  markMesh.renderOrder = 1;
  group.add(markMesh);

  // -------------------------------------------------- sidewalks + curbs
  const swTex = makeSidewalkTexture(); swTex.repeat.set(7, 7);
  const curbTex = makeConcreteKerbTexture();
  const swTop = new THREE.MeshStandardMaterial({ map: swTex, roughness: 0.9, metalness: 0 });
  const curbSide = new THREE.MeshStandardMaterial({ map: curbTex, roughness: 0.85, metalness: 0 });
  for (const s of model.sidewalks) {
    const w = s.maxX - s.minX, d = s.maxZ - s.minZ;
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(w, CURB_Y, d),
      [curbSide, curbSide, swTop, curbSide, curbSide, curbSide], // +x -x +y -y +z -z
    );
    box.position.set((s.minX + s.maxX) / 2, CURB_Y / 2, (s.minZ + s.maxZ) / 2);
    box.receiveShadow = true;
    group.add(box);
  }

  // -------------------------------------------------- buildings
  const facades = {
    glass: makeFacadeGlass(),
    ribbon: makeFacadeRibbon(),
    residential: makeFacadeResidential(),
  };
  const roofTex = makeRoofTexture();
  const roofMat = new THREE.MeshStandardMaterial({ map: roofTex, roughness: 0.9, metalness: 0 });
  for (const b of model.buildings) {
    const w = b.maxX - b.minX, d = b.maxZ - b.minZ, h = b.height;
    const f = facades[b.kind];
    const tex = (t) => { const c = t.clone(); c.wrapS = c.wrapT = THREE.RepeatWrapping; c.needsUpdate = true; c.repeat.set(Math.max(1, Math.round(w / 12)), Math.max(2, Math.round(h / 5))); return c; };
    const mat = new THREE.MeshStandardMaterial({
      map: tex(f.map), normalMap: tex(f.normalMap), roughnessMap: tex(f.roughnessMap),
      emissive: 0xffffff, emissiveMap: tex(f.emissiveMap), emissiveIntensity: 0,
      roughness: 1, metalness: 0,
    });
    registerEmissive(mat, 0, 1.25); // windows dark by day, lit at night
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      [mat, mat, roofMat, roofMat, mat, mat],
    );
    box.position.set((b.minX + b.maxX) / 2, CURB_Y + h / 2, (b.minZ + b.maxZ) / 2);
    box.castShadow = true; box.receiveShadow = true;
    group.add(box);
  }

  // -------------------------------------------------- distant filler
  const fillerMat = new THREE.MeshStandardMaterial({ color: 0x2b313b, roughness: 1, metalness: 0 });
  for (const f of model.filler) {
    const box = new THREE.Mesh(new THREE.BoxGeometry(f.w, f.h, f.d), fillerMat);
    box.position.set(f.x, f.h / 2, f.z);
    box.castShadow = true;
    group.add(box);
  }

  return { group, colliders: { buildings: model.buildings } };
}

// Minimal geometry merge for the flat marking planes (position + uv only).
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
