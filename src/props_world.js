// Street furniture for the open world: benches, planters with hedges, trash
// bins, fire hydrants and bus shelters lining the sidewalks. Static decoration
// that makes the district feel lived-in rather than empty. Everything repeatable
// is an InstancedMesh (a few draw calls for the whole city); bins and hydrants
// are individual knockables the car can bowl over. Placement is deterministic
// (seeded) so the city looks the same every load.
import * as THREE from 'three';

// merge indexed geometries keeping position + normal (untextured props)
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

function benchGeo() {
  const seat = new THREE.BoxGeometry(1.8, 0.1, 0.5); seat.translate(0, 0.46, 0);
  const back = new THREE.BoxGeometry(1.8, 0.5, 0.1); back.translate(0, 0.73, -0.2);
  const l1 = new THREE.BoxGeometry(0.12, 0.46, 0.5); l1.translate(-0.78, 0.23, 0);
  const l2 = new THREE.BoxGeometry(0.12, 0.46, 0.5); l2.translate(0.78, 0.23, 0);
  return mergePN([seat, back, l1, l2]);
}
function shelterGeo() {
  const parts = [];
  for (const sx of [-1.7, 1.7]) for (const sz of [-0.7, 0.7]) {
    const p = new THREE.BoxGeometry(0.1, 2.4, 0.1); p.translate(sx, 1.2, sz); parts.push(p);
  }
  const roof = new THREE.BoxGeometry(4.2, 0.12, 2.0); roof.translate(0, 2.5, 0); parts.push(roof);
  return mergePN(parts);
}

export function createProps(scene, model) {
  const group = new THREE.Group();
  scene.add(group);
  const { CURB_Y } = model;
  const obstacles = [];

  // deterministic RNG so the furniture layout is stable across loads
  let seed = 1337;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

  const INSET = 1.3;         // in from the curb onto the sidewalk
  const SP = 8;              // spacing between props along an edge
  const benchMats = [], planterMats = [], hedgeMats = [], shelterMats = [], glassMats = [];

  // materials
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x6a4a2f, roughness: 0.8, metalness: 0.05 });
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x8b8579, roughness: 0.9, metalness: 0.05 });
  const hedgeMat = new THREE.MeshStandardMaterial({ color: 0x3f7a3a, roughness: 0.95, metalness: 0 });
  const metalMat = new THREE.MeshStandardMaterial({ color: 0x2b2f35, roughness: 0.5, metalness: 0.6 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x9fbcc9, roughness: 0.15, metalness: 0.2, transparent: true, opacity: 0.32 });
  const binBody = new THREE.MeshStandardMaterial({ color: 0x2f4a34, roughness: 0.7, metalness: 0.3 });
  const binLid = new THREE.MeshStandardMaterial({ color: 0x25382a, roughness: 0.6, metalness: 0.4 });
  const hydRed = new THREE.MeshStandardMaterial({ color: 0xb02a22, roughness: 0.6, metalness: 0.2 });

  const binGeo = new THREE.CylinderGeometry(0.28, 0.32, 0.8, 12);
  const binLidGeo = new THREE.CylinderGeometry(0.31, 0.31, 0.1, 12);
  const hydGeo = new THREE.CylinderGeometry(0.15, 0.17, 0.62, 10);
  const hydCap = new THREE.SphereGeometry(0.16, 10, 8);
  const hydNoz = new THREE.CylinderGeometry(0.06, 0.06, 0.16, 8);

  const M = () => new THREE.Matrix4();
  const place = (kind, x, z, yaw) => {
    const m = M().compose(new THREE.Vector3(x, CURB_Y, z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(1, 1, 1));
    if (kind === 'bench') benchMats.push(m);
    else if (kind === 'planter') planterMats.push(m);
    else if (kind === 'shelter') shelterMats.push(m);
    else if (kind === 'bin') {
      const g = new THREE.Group();
      const b = new THREE.Mesh(binGeo, binBody); b.position.y = 0.4; b.castShadow = true; g.add(b);
      const l = new THREE.Mesh(binLidGeo, binLid); l.position.y = 0.82; g.add(l);
      g.position.set(x, CURB_Y, z); g.rotation.y = yaw; group.add(g);
      obstacles.push({ x, z, r: 0.4, knocked: false, knock: () => { g.rotation.z = 1.4; g.position.y = CURB_Y + 0.1; } });
    } else if (kind === 'hydrant') {
      const g = new THREE.Group();
      const b = new THREE.Mesh(hydGeo, hydRed); b.position.y = 0.31; b.castShadow = true; g.add(b);
      const c = new THREE.Mesh(hydCap, hydRed); c.position.y = 0.64; g.add(c);
      for (const s of [-1, 1]) { const n = new THREE.Mesh(hydNoz, hydRed); n.rotation.z = Math.PI / 2; n.position.set(s * 0.17, 0.36, 0); g.add(n); }
      g.position.set(x, CURB_Y, z); group.add(g);
      obstacles.push({ x, z, r: 0.3, knocked: false, knock: () => { g.rotation.x = 1.3; g.position.y = CURB_Y + 0.05; } });
    }
  };

  // planters carry a hedge; keep their transforms in step across two meshes
  const planterGeo = new THREE.BoxGeometry(1.1, 0.45, 1.1);
  const hedgeGeo = new THREE.BoxGeometry(1.0, 0.5, 1.0);

  const TYPES = ['bench', 'planter', 'bin', 'planter', 'bench', 'hydrant'];
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
      const fixed = e.fix - e.out[(e.horiz ? 1 : 0)] * INSET; // step inward onto the sidewalk
      const len = e.b - e.a;
      const n = Math.max(1, Math.floor((len - 6) / SP));
      for (let i = 0; i <= n; i++) {
        const along = e.a + 3 + (len - 6) * (i / n);
        if (e.entrance && Math.abs(along - b.cx) < 4.5) continue; // leave the doorway clear
        const x = e.horiz ? along : fixed;
        const z = e.horiz ? fixed : along;
        const t = TYPES[Math.floor(rnd() * TYPES.length)];
        place(t, x, z, yaw);
      }
      // a bus shelter on some north/east edges
      if (!e.entrance && rnd() < 0.28) {
        const along = e.a + len * 0.5;
        place('shelter', e.horiz ? along : fixed, e.horiz ? fixed : along, yaw);
      }
    }
  }

  // build the instanced sets
  const mk = (geo, mat, mats, cast) => {
    if (!mats.length) return;
    const im = new THREE.InstancedMesh(geo, mat, mats.length);
    im.castShadow = !!cast;
    for (let i = 0; i < mats.length; i++) im.setMatrixAt(i, mats[i]);
    group.add(im);
  };
  mk(benchGeo(), woodMat, benchMats, true);
  mk(planterGeo, stoneMat, planterMats, true);
  // hedges sit on the planters — same transforms, raised
  if (planterMats.length) {
    const up = new THREE.Matrix4().makeTranslation(0, 0.42, 0);
    const hm = planterMats.map((m) => m.clone().multiply(up));
    mk(hedgeGeo, hedgeMat, hm, true);
  }
  mk(shelterGeo(), metalMat, shelterMats, true);
  // shelter glass back panel
  if (shelterMats.length) {
    const glassG = new THREE.BoxGeometry(3.8, 1.9, 0.06); glassG.translate(0, 1.25, -0.9);
    const im = new THREE.InstancedMesh(glassG, glassMat, shelterMats.length);
    for (let i = 0; i < shelterMats.length; i++) im.setMatrixAt(i, shelterMats[i]);
    group.add(im);
  }

  return { group, obstacles };
}
