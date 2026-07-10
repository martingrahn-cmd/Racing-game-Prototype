// The player car. A procedural placeholder drives the track out of the box;
// drop a free CC0 model at assets/car.glb (see README) and it takes over
// automatically. URL param ?carRot=90/180/270 fixes models with a different
// forward axis.
import * as THREE from 'three';
import { GLTFLoader } from '../vendor/loaders/GLTFLoader.js';
import { DRACOLoader } from '../vendor/loaders/DRACOLoader.js';
import { makeContactShadowTexture } from './textures.js';

export function makeGLTFLoader() {
  const draco = new DRACOLoader();
  draco.setDecoderPath('vendor/draco/');
  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);
  return loader;
}

// Find spinnable wheel nodes: nodes named *wheel* whose parent isn't a wheel.
// Front wheels are detected by name (fl/fr/front); the front-wheel z sign
// also tells us which way the model faces.
export function rigWheels(root) {
  const wheels = [];
  root.traverse((o) => {
    if (/wheel/i.test(o.name) && !/wheel/i.test(o.parent?.name || '')) wheels.push(o);
  });
  const isFront = (o) => /(_f[lr]\b|front)/i.test(o.name);
  const fronts = wheels.filter(isFront);
  let forwardSign = 1;
  if (fronts.length) {
    const zAvg = fronts.reduce((a, o) => a + o.position.z, 0) / fronts.length;
    forwardSign = zAvg >= 0 ? 1 : -1;
  }
  for (const w of wheels) w.rotation.order = 'YXZ'; // steer (y) then spin (x)
  let radius = 0.34;
  if (wheels.length) {
    const box = new THREE.Box3().setFromObject(wheels[0]);
    radius = Math.max(0.12, (box.max.y - box.min.y) / 2);
  }
  return { spinNodes: wheels, steerNodes: fronts, forwardSign, radius };
}

const CAR_LENGTH = 4.4; // meters, GLB models are scaled to this

const PAINTS = {
  red: 0xa11218, blue: 0x17419e, yellow: 0xd9a01a,
  white: 0xe6e8ea, black: 0x101216, silver: 0xb0b6bd, green: 0x1c5c38,
};

// ---------------------------------------------------------------------------
// A lofted sports-coupe shell: smooth cross-sections swept nose→tail, the way
// real car bodies are surfaced. Curvature gives the clearcoat + environment
// reflections something to play against — that is what sells the material.
// Local space: forward = +z, nose at z=+2.2, tail at z=-2.2.
// ---------------------------------------------------------------------------
const ss = (a, b, x) => THREE.MathUtils.smoothstep(x, a, b);
const arcBump = (t, c, s) => Math.sqrt(Math.max(0, 1 - ((t - c) / s) ** 2));

const WHEEL_T = { front: 0.2, rear: 0.8 };
const tToZ = (t) => 2.2 - 4.4 * t;

function bodyParams(t) {
  const taperNose = 0.34 + 0.66 * ss(0.0, 0.10, t);
  const taperTail = 1 - 0.55 * ss(0.93, 1.0, t);
  const w = (0.88 + 0.05 * arcBump(t, WHEEL_T.front, 0.16) + 0.07 * arcBump(t, WHEEL_T.rear, 0.17)
    - 0.02 * ss(0.3, 0.5, t) * (1 - ss(0.5, 0.7, t))) * taperNose * taperTail;
  // wheel-arch openings: the lower body edge lifts over the wheels
  const arch = 0.47 * Math.max(arcBump(t, WHEEL_T.front, 0.115), arcBump(t, WHEEL_T.rear, 0.12));
  const belt = 0.58 + 0.06 * ss(0.05, 0.35, t) + 0.14 * ss(0.45, 0.95, t);
  let roof = 0.46 + 0.17 * ss(0.01, 0.12, t)      // nose → hood
    - 0.015 * ss(0.14, 0.30, t)                    // hood dips slightly
    + 0.52 * ss(0.30, 0.47, t)                     // windshield
    - 0.315 * ss(0.60, 0.90, t)                    // fastback
    + 0.055 * ss(0.92, 0.995, t);                  // ducktail kick
  roof = Math.max(roof, belt + 0.03);
  const cab = ss(0.32, 0.42, t) * (1 - ss(0.74, 0.86, t));
  const gw = THREE.MathUtils.lerp(w * 0.97, w * 0.60, cab);
  return { w, arch, belt, roof, gw, cab };
}

function halfProfile(t) {
  const { w, arch, belt, roof, gw } = bodyParams(t);
  const floor = 0.15;
  const side = floor + arch;
  const rocker = Math.max(side + 0.08, floor + 0.14);
  const mid = (rocker + belt) / 2;
  return [
    [0, floor],                       // 0 floor centre
    [w * 0.72, side],                 // 1 floor edge (lifts over wheels)
    [w * 0.98, Math.min(rocker, belt - 0.06)], // 2 rocker
    [w * 1.015, Math.min(mid, belt - 0.03)],   // 3 side bulge
    [w * 0.985, belt],                // 4 belt line (crease)
    [w * 0.985, belt],                // 5 belt duplicate → sharp crease
    [gw, belt + 0.04],                // 6 greenhouse base
    [gw * 0.62, roof - 0.03],         // 7 upper glass
    [0, roof],                        // 8 roof centre
  ];
}

function buildShell(paintMat, glassMat) {
  const N = 72;
  const half = [];
  for (let i = 0; i <= N; i++) half.push(halfProfile(i / N));
  const H = half[0].length;          // 9
  const R = 2 * H - 2;               // full ring: mirror without duplicating centres

  const pos = [];
  for (let i = 0; i <= N; i++) {
    const z = tToZ(i / N);
    const h = half[i];
    const ring = h.concat(h.slice(1, H - 1).reverse().map(([x, y]) => [-x, y]));
    for (const [x, y] of ring) pos.push(x, y, z);
  }
  // caps
  const noseIdx = pos.length / 3;
  pos.push(0, (half[0][0][1] + half[0][H - 1][1]) / 2, 2.24);
  const tailIdx = pos.length / 3;
  pos.push(0, (half[N][0][1] + half[N][H - 1][1]) / 2 + 0.08, -2.23);

  const jOfRing = (k) => (k < H ? k : R - k); // ring index → half-profile node
  const bodyIdx = [], glassIdx = [];
  for (let i = 0; i < N; i++) {
    const tm = (i + 0.5) / N;
    const { cab } = bodyParams(tm);
    for (let k = 0; k < R; k++) {
      const k2 = (k + 1) % R;
      const jm = Math.max(jOfRing(k), jOfRing(k2));
      if (jm === 5 && Math.min(jOfRing(k), jOfRing(k2)) === 4) continue; // crease seam, zero area
      const a = i * R + k, b = i * R + k2, c = (i + 1) * R + k, d = (i + 1) * R + k2;
      const isGlass = tm > 0.30 && tm < 0.82 && (jm >= 7 || (jm >= 6 && cab > 0.55));
      (isGlass ? glassIdx : bodyIdx).push(a, c, b, b, c, d);
    }
  }
  for (let k = 0; k < R; k++) { // cap fans
    const k2 = (k + 1) % R;
    bodyIdx.push(noseIdx, k2, k);
    bodyIdx.push(tailIdx, N * R + k, N * R + k2);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex([...bodyIdx, ...glassIdx]);
  g.addGroup(0, bodyIdx.length, 0);
  g.addGroup(bodyIdx.length, glassIdx.length, 1);
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, [paintMat, glassMat]);
  mesh.castShadow = true;
  return mesh;
}

function buildPlaceholder() {
  const params = new URLSearchParams(location.search);
  const paintHex = PAINTS[params.get('paint')] ?? PAINTS.red;

  const car = new THREE.Group();
  const paint = new THREE.MeshPhysicalMaterial({
    color: paintHex, metalness: 0.25, roughness: 0.38,
    clearcoat: 1.0, clearcoatRoughness: 0.08, envMapIntensity: 0.6,
  });
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x11161c, metalness: 0.0, roughness: 0.06, envMapIntensity: 1.5,
  });
  paint.userData.keepEnv = true;
  glass.userData.keepEnv = true;
  const darkTrim = new THREE.MeshStandardMaterial({ color: 0x121418, roughness: 0.55, metalness: 0.3 });

  car.add(buildShell(paint, glass));

  // trim & details ---------------------------------------------------------
  const add = (geo, mat, x, y, z, ry = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.y = ry;
    m.castShadow = true;
    car.add(m);
    return m;
  };
  // splitter, grille, diffuser — the nose tapers hard, keep trim tucked in
  add(new THREE.BoxGeometry(0.8, 0.05, 0.2), darkTrim, 0, 0.12, 1.9);
  add(new THREE.BoxGeometry(0.38, 0.09, 0.06), darkTrim, 0, 0.27, 2.05);
  add(new THREE.BoxGeometry(0.95, 0.13, 0.3), darkTrim, 0, 0.16, -2.02);
  // ducktail lip
  add(new THREE.BoxGeometry(1.0, 0.035, 0.2), darkTrim, 0, 0.94, -2.04);
  // lights
  const tailMat = new THREE.MeshStandardMaterial({ color: 0x2a0000, emissive: 0xc90f0f, emissiveIntensity: 1.3 });
  const headMat = new THREE.MeshStandardMaterial({ color: 0xcfd6dd, emissive: 0xaec4dd, emissiveIntensity: 0.55, roughness: 0.2 });
  add(new THREE.BoxGeometry(0.8, 0.05, 0.05), tailMat, 0, 0.8, -2.12);
  for (const sx of [-1, 1]) {
    add(new THREE.BoxGeometry(0.24, 0.05, 0.06), headMat, sx * 0.36, 0.5, 1.88, sx * -0.3);
    // exhaust
    const ex = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.1, 10),
      new THREE.MeshStandardMaterial({ color: 0x51565c, metalness: 0.9, roughness: 0.35 }));
    ex.rotation.x = Math.PI / 2;
    ex.position.set(sx * 0.34, 0.25, -2.13);
    car.add(ex);
  }

  // wheels ------------------------------------------------------------------
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x17181a, roughness: 0.92 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xb6bcc4, metalness: 0.95, roughness: 0.25 });
  const wellMat = new THREE.MeshStandardMaterial({ color: 0x0a0b0c, roughness: 1 });
  const tireGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.27, 24);
  tireGeo.rotateZ(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(0.215, 0.215, 0.28, 16);
  rimGeo.rotateZ(Math.PI / 2);
  // diametric bar in the wheel plane (y-z), thin along the axle → 10-spoke look
  const spokeGeo = new THREE.BoxGeometry(0.30, 0.36, 0.05);
  const wellGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.16, 16); // stays hidden inside the arch
  wellGeo.rotateZ(Math.PI / 2);

  const wheels = [], steerPivots = [];
  for (const [wx, wz] of [[-0.78, tToZ(WHEEL_T.front)], [0.78, tToZ(WHEEL_T.front)], [-0.78, tToZ(WHEEL_T.rear)], [0.78, tToZ(WHEEL_T.rear)]]) {
    const well = new THREE.Mesh(wellGeo, wellMat);
    well.position.set(wx * 0.7, 0.33, wz);
    car.add(well);

    const spin = new THREE.Group();
    spin.add(new THREE.Mesh(tireGeo, tireMat), new THREE.Mesh(rimGeo, rimMat));
    for (let sp = 0; sp < 5; sp++) {
      const spoke = new THREE.Mesh(spokeGeo, rimMat);
      spoke.rotation.x = (sp / 5) * Math.PI * 2;
      spin.add(spoke);
    }
    spin.children.forEach((m) => (m.castShadow = true));
    wheels.push(spin);
    if (wz > 0) {
      const pivot = new THREE.Group();
      pivot.position.set(wx, 0.35, wz);
      pivot.add(spin);
      steerPivots.push(pivot);
      car.add(pivot);
    } else {
      spin.position.set(wx, 0.35, wz);
      car.add(spin);
    }
  }

  return { group: car, wheels, steerPivots, wheelRadius: 0.35 };
}

export function createCar(scene) {
  const root = new THREE.Group();
  scene.add(root);

  let rig = buildPlaceholder();
  root.add(rig.group);

  // soft blob shadow under the car (in addition to the sun shadow)
  const blob = new THREE.Mesh(
    new THREE.PlaneGeometry(2.6, 5.1),
    new THREE.MeshBasicMaterial({
      map: makeContactShadowTexture(), transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -3, opacity: 0.9,
    })
  );
  blob.rotation.x = -Math.PI / 2;
  blob.renderOrder = 2;
  scene.add(blob);

  // replace the placeholder with the real model (assets/car.glb)
  const params = new URLSearchParams(location.search);
  const extraYaw = (parseFloat(params.get('carRot') ?? '0') * Math.PI) / 180;
  const paintHex = PAINTS[params.get('paint')] ?? PAINTS.red;
  makeGLTFLoader().load('assets/car.glb', (gltf) => {
    const model = gltf.scene;
    const wheelRig = rigWheels(model);
    model.rotation.y = extraYaw + (wheelRig.forwardSign < 0 ? Math.PI : 0);

    const holder = new THREE.Group();
    holder.add(model);
    // normalize: longest horizontal axis = car length, wheels on the ground
    const box = new THREE.Box3().setFromObject(holder);
    const size = box.getSize(new THREE.Vector3());
    const scale = CAR_LENGTH / Math.max(size.x, size.z);
    holder.scale.setScalar(scale);
    const box2 = new THREE.Box3().setFromObject(holder);
    const center = box2.getCenter(new THREE.Vector3());
    model.position.x -= center.x / scale;
    model.position.z -= center.z / scale;
    model.position.y -= box2.min.y / scale;

    holder.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => {
          if (!m.isMeshStandardMaterial) return;
          m.envMapIntensity = 1.0;
          m.userData.keepEnv = true;
          // daylight: keep headlight/LED emissives from blowing out in bloom
          if (m.emissive && (m.emissive.r + m.emissive.g + m.emissive.b) > 0) {
            m.emissiveIntensity = Math.min(m.emissiveIntensity ?? 1, 0.25);
          }
          if (/body.?color|^body$|paint/i.test(m.name || '')) {
            // repaint the shell with our clearcoat livery
            m.color.setHex(paintHex);
            m.metalness = 0.4; m.roughness = 0.25;
            if ('clearcoat' in m) { m.clearcoat = 1.0; m.clearcoatRoughness = 0.05; }
          }
        });
      }
    });
    root.remove(rig.group);
    rig = {
      group: holder,
      wheels: wheelRig.spinNodes,
      steerPivots: wheelRig.steerNodes,
      wheelRadius: wheelRig.radius * scale,
      dir: wheelRig.forwardSign, // steering sign flips with the model's native facing
    };
    root.add(holder);
  }, undefined, () => { /* no assets/car.glb — the sculpted placeholder keeps driving */ });

  return {
    root,
    // place the car on the track: p = position, t = tangent, roll = lean, steer = front wheel angle
    update(p, t, roll, steer, speed, dt) {
      root.position.copy(p);
      // Euler XYZ: the z component banks the car around its own forward axis.
      // Body rolls OUT of the corner (opposite of the camera's lean-in).
      root.rotation.set(0, Math.atan2(t.x, t.z), roll * 0.7);
      const spin = (speed * dt) / rig.wheelRadius * (rig.dir || 1);
      for (const w of rig.wheels) w.rotation.x += spin;
      for (const pv of rig.steerPivots) pv.rotation.y = steer * (rig.dir || 1);
      blob.position.set(p.x, 0.05, p.z);
      blob.rotation.z = -root.rotation.y;
    },
    setVisible(v) { root.visible = v; blob.visible = v; },
  };
}
