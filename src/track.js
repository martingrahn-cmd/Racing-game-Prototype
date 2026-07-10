// Track: a closed city circuit built by extruding cross-sections along a spline.
import * as THREE from 'three';
import {
  makeRoadTexture, makeKerbTexture, makeConcreteKerbTexture, makeSidewalkTexture,
  makeFenceTexture, makeBannerAtlas, makeManholeTexture, makeSkidTexture,
  makeGlowPoolTexture, mulberry32,
} from './textures.js';
import { registerEmissive, registerOpacity, registerCustom } from './night.js';

const UP = new THREE.Vector3(0, 1, 0);

// Hand-tuned city circuit (~2 km): start straight, sweeper, esses, uphill-flat left, return.
const CONTROL_POINTS = [
  [-330, -40], [-180, -70], [-40, -80], [90, -70],
  [200, -40], [262, 40],
  [212, 140], [120, 172],
  [40, 122], [-30, 152],
  [-130, 212], [-240, 192],
  [-312, 110], [-332, 20],
].map(([x, z]) => new THREE.Vector3(x, 0, z));

export function makeCurve() {
  return new THREE.CatmullRomCurve3(CONTROL_POINTS, true, 'centripetal', 0.5);
}

// Frame (position/tangent/right) at arc-length s.
export function frameAt(curve, length, s) {
  let u = (s % length) / length;
  if (u < 0) u += 1;
  const p = curve.getPointAt(u);
  const t = curve.getTangentAt(u);
  const r = new THREE.Vector3().crossVectors(t, UP).normalize(); // right-hand side of travel
  return { p, t, r, u };
}

// Build a ribbon mesh: profile nodes {x: lateral (+right), y: height, u} swept
// along the curve, optionally only over the arc range [s0, s1].
export function buildRibbon(curve, length, profile, vScale, samples = 720, s0 = 0, s1 = null) {
  if (s1 === null) s1 = length;
  const rows = samples + 1;
  const n = profile.length;
  const pos = new Float32Array(rows * n * 3);
  const uv = new Float32Array(rows * n * 2);
  const idx = [];

  for (let i = 0; i < rows; i++) {
    const s = s0 + (i / samples) * (s1 - s0);
    const { p, r } = frameAt(curve, length, s);
    for (let j = 0; j < n; j++) {
      const k = i * n + j;
      pos[k * 3 + 0] = p.x + r.x * profile[j].x;
      pos[k * 3 + 1] = p.y + profile[j].y;
      pos[k * 3 + 2] = p.z + r.z * profile[j].x;
      uv[k * 2 + 0] = profile[j].u;
      uv[k * 2 + 1] = s * vScale;
    }
  }
  for (let i = 0; i < samples; i++) {
    for (let j = 0; j < n - 1; j++) {
      const a = i * n + j, b = a + 1, c = a + n, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Merge simple indexed geometries (position/normal/uv[/color]) after transforming.
export function mergeGeoms(list) {
  let vCount = 0, iCount = 0;
  const hasColor = list.every((g) => g.attributes.color);
  for (const g of list) { vCount += g.attributes.position.count; iCount += g.index.count; }
  const pos = new Float32Array(vCount * 3);
  const nor = new Float32Array(vCount * 3);
  const uv = new Float32Array(vCount * 2);
  const col = hasColor ? new Float32Array(vCount * 3) : null;
  const idx = new Uint32Array(iCount);
  let vo = 0, io = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array, vo * 3);
    nor.set(g.attributes.normal.array, vo * 3);
    uv.set(g.attributes.uv.array, vo * 2);
    if (col) col.set(g.attributes.color.array, vo * 3);
    const gi = g.index.array;
    for (let i = 0; i < gi.length; i++) idx[io + i] = gi[i] + vo;
    vo += g.attributes.position.count;
    io += gi.length;
  }
  const m = new THREE.BufferGeometry();
  m.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  m.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  m.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (col) m.setAttribute('color', new THREE.BufferAttribute(col, 3));
  m.setIndex(new THREE.BufferAttribute(idx, 1));
  return m;
}

function box(w, h, d, mat4, uvRegion) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (uvRegion) {
    const a = g.attributes.uv;
    for (let i = 0; i < a.count; i++) {
      a.setXY(i, uvRegion[0] + a.getX(i) * (uvRegion[2] - uvRegion[0]),
                 uvRegion[1] + a.getY(i) * (uvRegion[3] - uvRegion[1]));
    }
  }
  g.applyMatrix4(mat4);
  return g;
}

const ROAD_HALF = 5.5;

export function buildTrack(scene) {
  const curve = makeCurve();
  const length = curve.getLength();
  const rng = mulberry32(777);

  // --- road surface -------------------------------------------------------
  const roadTex = makeRoadTexture();
  const road = new THREE.Mesh(
    buildRibbon(curve, length, [
      { x: -ROAD_HALF, y: 0.02, u: 0 },
      { x: ROAD_HALF, y: 0.02, u: 1 },
    ], 1 / 14),
    (() => {
      const m = new THREE.MeshStandardMaterial({
        map: roadTex.map, normalMap: roadTex.normalMap, roughnessMap: roadTex.roughnessMap,
        emissiveMap: roadTex.emissiveMap, emissive: 0xffffff,
        normalScale: new THREE.Vector2(0.5, 0.5), roughness: 1.0, metalness: 0.0,
      });
      m.envMapIntensity = 0.22; // keep the blue sky reflection subtle on asphalt
      m.userData.keepEnv = true;
      registerEmissive(m, 0, 1.15); // retroreflective lane paint
      registerCustom((d) => { m.roughness = 0.62 + 0.38 * d; }); // moonlight sheen at night
      return m;
    })()
  );
  road.receiveShadow = true;
  scene.add(road);

  // --- kerbs: plain concrete on straights, red/white in the corners --------
  const kerbProfile = (side) => [
    { x: side * ROAD_HALF, y: 0.02, u: 1 },
    { x: side * (ROAD_HALF + 0.05), y: 0.14, u: 0.85 },
    { x: side * (ROAD_HALF + 0.62), y: 0.14, u: 0 },
  ];
  const concreteMat = new THREE.MeshStandardMaterial({ map: makeConcreteKerbTexture(), roughness: 0.9 });
  for (const side of [-1, 1]) {
    const kerb = new THREE.Mesh(buildRibbon(curve, length, kerbProfile(side), 1 / 4), concreteMat);
    kerb.receiveShadow = true;
    scene.add(kerb);
  }

  // corner spans by curvature (angle change over a lookahead window)
  const turnAngle = (s) => {
    const a = frameAt(curve, length, s).t;
    const b = frameAt(curve, length, s + 14).t;
    return Math.atan2(a.x * b.z - a.z * b.x, a.x * b.x + a.z * b.z);
  };
  const cornerSpans = [];
  {
    let start = null;
    for (let s = 0; s <= length; s += 4) {
      const bent = Math.abs(turnAngle(s)) > 0.055;
      if (bent && start === null) start = s;
      if ((!bent || s + 4 > length) && start !== null) {
        if (s - start > 16) cornerSpans.push([start - 8, s + 8]);
        start = null;
      }
    }
  }
  const kerbNightTex = makeKerbTexture();
  const racingKerbMat = new THREE.MeshStandardMaterial({
    map: kerbNightTex, emissiveMap: kerbNightTex, emissive: 0xffffff, roughness: 0.7,
  });
  registerEmissive(racingKerbMat, 0, 0.55); // kerb paint reads at night too
  const racingKerbs = [];
  for (const [a, b] of cornerSpans) {
    const n = Math.max(10, Math.floor((b - a) / 2));
    for (const side of [-1, 1]) {
      const prof = kerbProfile(side).map((p) => ({ ...p, y: p.y + 0.008 }));
      racingKerbs.push(buildRibbon(curve, length, prof, 1 / 4, n, a, b));
    }
  }
  if (racingKerbs.length) {
    const rk = new THREE.Mesh(mergeGeoms(racingKerbs), racingKerbMat);
    rk.receiveShadow = true;
    scene.add(rk);
  }

  // --- skid marks through the corners ---------------------------------------
  {
    const skidMat = new THREE.MeshBasicMaterial({
      map: makeSkidTexture(), transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -1,
    });
    const skids = [];
    for (const [a, b] of cornerSpans) {
      const inside = Math.sign(turnAngle((a + b) / 2)); // roll toward apex
      for (let k = 0; k < 2; k++) {
        const off = inside * (1.1 + rng() * 1.4) * (k ? -0.4 : 1);
        const w = 0.85;
        const n = Math.max(8, Math.floor((b - a) / 3));
        skids.push(buildRibbon(curve, length, [
          { x: off - w / 2, y: 0.035, u: 0 },
          { x: off + w / 2, y: 0.035, u: 1 },
        ], 1 / (b - a), n, a - 6 - rng() * 8, b + 4));
      }
    }
    if (skids.length) {
      // v spans 0..1 per skid because vScale = 1/(span length)
      const sm = new THREE.Mesh(mergeGeoms(skids), skidMat);
      sm.renderOrder = 2;
      scene.add(sm);
    }
  }

  // --- manhole covers --------------------------------------------------------
  {
    const mhGeos = [];
    for (let s = 25; s < length; s += 42 + rng() * 30) {
      const { p, t, r } = frameAt(curve, length, s);
      const g = new THREE.CircleGeometry(0.45, 20);
      g.rotateX(-Math.PI / 2);
      g.rotateY(Math.atan2(t.x, t.z));
      const lat = (rng() - 0.5) * 6;
      g.translate(p.x + r.x * lat, p.y + 0.03, p.z + r.z * lat);
      mhGeos.push(g);
    }
    const mh = new THREE.Mesh(mergeGeoms(mhGeos), new THREE.MeshStandardMaterial({
      map: makeManholeTexture(), transparent: true, roughness: 0.6, metalness: 0.6,
      polygonOffset: true, polygonOffsetFactor: -1, depthWrite: false,
    }));
    mh.renderOrder = 1;
    scene.add(mh);
  }

  // --- sidewalks -----------------------------------------------------------
  const walkTex = makeSidewalkTexture();
  walkTex.repeat.set(1, 1);
  const walkMat = new THREE.MeshStandardMaterial({ map: walkTex, roughness: 0.95 });
  for (const side of [-1, 1]) {
    const walk = new THREE.Mesh(
      buildRibbon(curve, length, [
        { x: side * (ROAD_HALF + 0.62), y: 0.16, u: 0 },
        { x: side * (ROAD_HALF + 3.9), y: 0.16, u: 1.1 },
        { x: side * (ROAD_HALF + 4.15), y: 0.0, u: 1.2 },
      ], 1 / 3),
      walkMat
    );
    walk.receiveShadow = true;
    scene.add(walk);
  }

  // --- chain-link catch fence ---------------------------------------------
  const fenceTex = makeFenceTexture();
  const fenceMat = new THREE.MeshStandardMaterial({
    map: fenceTex, transparent: true, alphaTest: 0.35,
    side: THREE.DoubleSide, roughness: 0.6, metalness: 0.4,
  });
  for (const side of [-1, 1]) {
    const fence = new THREE.Mesh(
      buildRibbon(curve, length, [
        { x: side * (ROAD_HALF + 3.7), y: 0.16, u: 0 },
        { x: side * (ROAD_HALF + 3.7), y: 2.6, u: 1 },
      ], 1 / 2.44, 480),
      fenceMat
    );
    scene.add(fence);
  }

  // fence posts + lamp posts (instanced)
  const postGeo = new THREE.CylinderGeometry(0.05, 0.05, 2.6, 6);
  postGeo.translate(0, 1.3 + 0.16, 0);
  const steelMat = new THREE.MeshStandardMaterial({ color: 0x565b63, roughness: 0.5, metalness: 0.6 });
  const postCount = Math.floor(length / 12) * 2;
  const posts = new THREE.InstancedMesh(postGeo, steelMat, postCount);
  posts.frustumCulled = false;
  {
    const m = new THREE.Matrix4();
    let i = 0;
    for (let s = 0; s < length - 6; s += 12) {
      const { p, r } = frameAt(curve, length, s);
      for (const side of [-1, 1]) {
        if (i >= postCount) break;
        m.makeTranslation(p.x + r.x * side * (ROAD_HALF + 3.7), p.y, p.z + r.z * side * (ROAD_HALF + 3.7));
        posts.setMatrixAt(i++, m);
      }
    }
    posts.count = i;
  }
  scene.add(posts);

  // --- street lamps (instanced, merged pole+arm+head) ----------------------
  const lampParts = [];
  {
    const m = new THREE.Matrix4();
    lampParts.push(box(0.16, 7.0, 0.16, m.makeTranslation(0, 3.5, 0)));
    const arm = new THREE.Matrix4().makeRotationZ(-0.32).setPosition(-1.2, 6.9, 0);
    lampParts.push(box(2.6, 0.12, 0.12, arm));
    lampParts.push(box(0.9, 0.14, 0.32, m.makeTranslation(-2.45, 6.5, 0)));
  }
  const lampGeo = mergeGeoms(lampParts);
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x3c4148, roughness: 0.55, metalness: 0.5 });
  const lampSpacing = 38;
  const lampCount = Math.floor(length / lampSpacing);
  const lamps = new THREE.InstancedMesh(lampGeo, lampMat, lampCount);
  lamps.frustumCulled = false;
  lamps.castShadow = true;
  // glowing head + warm pool of light on the ground, both driven by nightfall
  const lampGlowMat = new THREE.MeshStandardMaterial({ color: 0x2a2416, emissive: 0xffe6b0 });
  registerEmissive(lampGlowMat, 0, 3.2);
  const glowGeo = new THREE.BoxGeometry(0.86, 0.1, 0.28);
  const glows = new THREE.InstancedMesh(glowGeo, lampGlowMat, lampCount);
  glows.frustumCulled = false;
  const poolMat = new THREE.MeshBasicMaterial({
    map: makeGlowPoolTexture(), transparent: true, depthWrite: false,
    color: 0xffd9a0, blending: THREE.AdditiveBlending,
    polygonOffset: true, polygonOffsetFactor: -2,
  });
  registerOpacity(poolMat, 0, 0.85);
  const poolGeo = new THREE.PlaneGeometry(11, 11);
  poolGeo.rotateX(-Math.PI / 2);
  const pools = new THREE.InstancedMesh(poolGeo, poolMat, lampCount);
  pools.frustumCulled = false;
  pools.renderOrder = 3;
  {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const headOff = new THREE.Vector3();
    let i = 0;
    for (let s = 0; s < length - lampSpacing / 2 && i < lampCount; s += lampSpacing) {
      const side = (i % 2 === 0) ? 1 : -1;
      const { p, t, r } = frameAt(curve, length, s + 20);
      const yaw = Math.atan2(t.x, t.z) + (side > 0 ? 0 : Math.PI);
      q.setFromAxisAngle(UP, yaw + Math.PI / 2);
      m.makeRotationFromQuaternion(q);
      const bx = p.x + r.x * side * (ROAD_HALF + 2.4);
      const bz = p.z + r.z * side * (ROAD_HALF + 2.4);
      m.setPosition(bx, p.y + 0.16, bz);
      lamps.setMatrixAt(i, m);
      // lamp head sits 2.45 m inboard along the arm (local -x after the yaw)
      headOff.set(-2.45, 0, 0).applyQuaternion(q);
      m.setPosition(bx + headOff.x, p.y + 6.58, bz + headOff.z);
      glows.setMatrixAt(i, m);
      m.makeTranslation(bx + headOff.x, p.y + 0.07, bz + headOff.z);
      pools.setMatrixAt(i, m);
      i++;
    }
    lamps.count = glows.count = pools.count = i;
  }
  scene.add(lamps, glows, pools);

  // --- sponsor gantries -----------------------------------------------------
  const gantrySteel = [];
  const bannerGeos = [];
  const bannerAtlas = makeBannerAtlas();
  const gantryCount = 8;
  for (let gi = 0; gi < gantryCount; gi++) {
    const s = (gi / gantryCount) * length;
    const { p, t, r } = frameAt(curve, length, s);
    const yaw = Math.atan2(t.x, t.z);
    const base = new THREE.Matrix4().makeRotationY(yaw);

    const place = (g, lx, ly, lz) => {
      const off = new THREE.Vector3(lx, ly, lz).applyMatrix4(new THREE.Matrix4().makeRotationY(yaw));
      const mm = base.clone().setPosition(p.x + off.x, p.y + off.y, p.z + off.z);
      g.applyMatrix4(mm);
      return g;
    };
    // posts + beam (local x = across road because yaw aligns local +z to tangent)
    gantrySteel.push(place(new THREE.BoxGeometry(0.55, 6.4, 0.55), -7.9, 3.2, 0));
    gantrySteel.push(place(new THREE.BoxGeometry(0.55, 6.4, 0.55), 7.9, 3.2, 0));
    gantrySteel.push(place(new THREE.BoxGeometry(16.6, 0.8, 0.6), 0, 6.6, 0));

    // banner planes (back-to-back so the text reads correctly from both sides)
    const row = gi % 8;
    const v0 = 1 - (row + 1) / 8, v1 = 1 - row / 8;
    for (const flip of [0, 1]) {
      const bg = new THREE.PlaneGeometry(15.4, 1.9);
      const uvA = bg.attributes.uv;
      for (let i = 0; i < uvA.count; i++) uvA.setXY(i, uvA.getX(i), v0 + uvA.getY(i) * (v1 - v0));
      if (flip) bg.rotateY(Math.PI);
      bannerGeos.push(place(bg, 0, 5.2, flip ? -0.04 : 0.04));
    }
  }
  const gantryMesh = new THREE.Mesh(mergeGeoms(gantrySteel),
    new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.5, metalness: 0.55 }));
  gantryMesh.castShadow = true;
  scene.add(gantryMesh);

  const bannerMat = new THREE.MeshStandardMaterial({
    map: bannerAtlas, emissiveMap: bannerAtlas, emissive: 0xffffff, roughness: 0.75,
  });
  registerEmissive(bannerMat, 0, 1.5); // gantry banners glow like signage at night
  const bannerMesh = new THREE.Mesh(mergeGeoms(bannerGeos), bannerMat);
  scene.add(bannerMesh);

  // start/finish line painted on the road
  {
    const { p, t, r } = frameAt(curve, length, 2);
    const c = document.createElement('canvas');
    c.width = 256; c.height = 64;
    const x = c.getContext('2d');
    for (let i = 0; i < 16; i++) for (let j = 0; j < 4; j++) {
      x.fillStyle = (i + j) % 2 ? '#141414' : '#f4f4f4';
      x.fillRect(i * 16, j * 16, 16, 16);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const line = new THREE.Mesh(new THREE.PlaneGeometry(11, 2.4),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2 }));
    line.rotation.x = -Math.PI / 2;
    line.rotation.z = Math.atan2(t.x, t.z);
    line.position.set(p.x, p.y + 0.035, p.z);
    line.receiveShadow = true;
    scene.add(line);
  }

  return { curve, length, cornerSpans };
}

export { ROAD_HALF, UP };
