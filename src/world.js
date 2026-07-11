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
  const awnings = [0x8a3f39, 0x3d5c48, 0x41546e, 0x7a6a4a];
  const tints = [0xffffff, 0xf1ece2, 0xe6eef5, 0xfff2e6];
  const doorGlass = new THREE.MeshStandardMaterial({ color: 0x161d24, roughness: 0.12, metalness: 0.65 });
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x3b4048, roughness: 0.7, metalness: 0.25 });
  const mastMat = new THREE.MeshStandardMaterial({ color: 0x33373d, roughness: 0.6, metalness: 0.7 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.4, metalness: 0.65 });
  const bollardMat = new THREE.MeshStandardMaterial({ color: 0x1c1f24, roughness: 0.6, metalness: 0.5 });
  const sconceMat = new THREE.MeshStandardMaterial({ color: 0x2a2418, emissive: 0xffdca0, emissiveIntensity: 0.08, roughness: 0.5 });
  registerEmissive(sconceMat, 0.08, 2.0);       // entrance lamps, glow at night
  const signMat = new THREE.MeshStandardMaterial({ color: 0x151b22, emissive: 0xbfe0ff, emissiveIntensity: 0.15, roughness: 0.4 });
  registerEmissive(signMat, 0.15, 1.7);         // lit signage band
  model.buildings.forEach((b, i) => {
    const w = b.maxX - b.minX, d = b.maxZ - b.minZ, h = b.height;
    const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    const f = facades[b.kind];
    const tex = (t) => { const c = t.clone(); c.wrapS = c.wrapT = THREE.RepeatWrapping; c.needsUpdate = true; c.repeat.set(Math.max(1, Math.round(w / 12)), Math.max(2, Math.round(h / 5))); return c; };
    const mat = new THREE.MeshStandardMaterial({
      map: tex(f.map), normalMap: tex(f.normalMap), roughnessMap: tex(f.roughnessMap),
      emissive: 0xffffff, emissiveMap: tex(f.emissiveMap), emissiveIntensity: 0,
      color: tints[i % tints.length], roughness: 1, metalness: 0,
    });
    registerEmissive(mat, 0, 1.25); // windows dark by day, lit at night
    const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [mat, mat, roofMat, roofMat, mat, mat]);
    box.position.set(cx, CURB_Y + h / 2, cz);
    box.castShadow = true; box.receiveShadow = true;
    group.add(box);

    // rooftop mechanical penthouse for a varied skyline
    const ph = new THREE.Mesh(new THREE.BoxGeometry(w * 0.45, 3.2, d * 0.45), roofMat);
    ph.position.set(cx, CURB_Y + h + 1.6, cz);
    ph.castShadow = true; group.add(ph);
    // aviation beacon + mast on the signature tower
    if (h > 50) {
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 12, 6), mastMat);
      mast.position.set(cx, CURB_Y + h + 3.2 + 6, cz); group.add(mast);
      const beaconMat = new THREE.MeshStandardMaterial({ color: 0x2a0000, emissive: 0xff2200, emissiveIntensity: 1.2 });
      registerEmissive(beaconMat, 1.2, 3.4);
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8), beaconMat);
      beacon.position.set(cx, CURB_Y + h + 3.2 + 12, cz); group.add(beacon);
    }

    // recessed street entrance on the face toward the intersection. The frame
    // and reveals PROTRUDE while the glass sits flush, so the doorway reads as
    // an inset portal with depth instead of a decal stuck on the wall.
    const [sx] = b.quad;
    const faceX = sx > 0 ? b.minX : b.maxX; // facade nearest the intersection
    const nx = -sx;                          // outward normal toward the road
    const yaw = nx > 0 ? Math.PI / 2 : -Math.PI / 2;
    const DW = 5, DH = 3.6, REV = 0.75;      // opening width (z), height, reveal depth
    // warm lobby glow, lit at night, sitting just inside the glass
    const lobbyMat = new THREE.MeshStandardMaterial({ color: 0x120d06, emissive: 0xffdca0, emissiveIntensity: 0 });
    registerEmissive(lobbyMat, 0, 0.85);
    const lobby = new THREE.Mesh(new THREE.PlaneGeometry(DW - 0.4, DH - 0.4), lobbyMat);
    lobby.position.set(faceX + nx * 0.02, CURB_Y + DH / 2, cz); lobby.rotation.y = yaw; group.add(lobby);
    // dark reflective glass doors, flush on the facade
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(DW, DH), doorGlass);
    glass.position.set(faceX + nx * 0.05, CURB_Y + DH / 2, cz); glass.rotation.y = yaw; group.add(glass);
    // mullion between the two door leaves
    const mull = new THREE.Mesh(new THREE.BoxGeometry(0.12, DH, 0.1), frameMat);
    mull.position.set(faceX + nx * 0.08, CURB_Y + DH / 2, cz); group.add(mull);
    // protruding jambs + lintel that frame (and recess) the glass
    for (const s of [-1, 1]) {
      const jamb = new THREE.Mesh(new THREE.BoxGeometry(REV, DH + 0.5, 0.45), frameMat);
      jamb.position.set(faceX + nx * REV / 2, CURB_Y + (DH + 0.5) / 2, cz + s * (DW / 2 + 0.22));
      jamb.castShadow = true; group.add(jamb);
    }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(REV, 0.55, DW + 0.9), frameMat);
    lintel.position.set(faceX + nx * REV / 2, CURB_Y + DH + 0.27, cz);
    lintel.castShadow = true; group.add(lintel);
    // awning above, on two slim posts
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.3, DW + 1.6),
      new THREE.MeshStandardMaterial({ color: awnings[i % awnings.length], roughness: 0.85 }));
    canopy.position.set(faceX + nx * 1.55, CURB_Y + DH + 0.78, cz);
    canopy.castShadow = true; group.add(canopy);
    for (const s of [-1, 1]) {
      const h2 = CURB_Y + DH + 0.78;
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, h2, 6), frameMat);
      strut.position.set(faceX + nx * 2.7, h2 / 2, cz + s * (DW / 2 + 0.55)); group.add(strut);
    }
    // low threshold sill
    const sill = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.12, DW + 0.4), frameMat);
    sill.position.set(faceX + nx * 0.28, CURB_Y + 0.06, cz); group.add(sill);
    // finer detail: wall sconces, door handles, bollards
    for (const s of [-1, 1]) {
      const sconce = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.5, 0.14), sconceMat);
      sconce.position.set(faceX + nx * 0.16, CURB_Y + 2.7, cz + s * (DW / 2 + 0.42));
      group.add(sconce);
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.95, 6), trimMat);
      handle.position.set(faceX + nx * 0.13, CURB_Y + 1.2, cz + s * 0.4);
      group.add(handle);
      const bollard = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.9, 10), bollardMat);
      bollard.position.set(faceX + nx * 2.4, CURB_Y + 0.45, cz + s * (DW / 2 + 0.9));
      bollard.castShadow = true; group.add(bollard);
    }
    // illuminated signage band above the doors
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.5, DW - 0.6), signMat);
    sign.position.set(faceX + nx * 0.13, CURB_Y + DH - 0.12, cz); group.add(sign);
  });

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
