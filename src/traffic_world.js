// Open-world traffic: AI cars that route the street grid, keep to their lane,
// stop at red lights, turn at intersections, follow the car ahead, and brake
// for the player. Uses the real GLB car models (with a procedural box as an
// instant placeholder until each model streams in). Working brake lights.
//
// Lane convention matches the player spawn: travelling +z runs in the x=node-LANE
// lane, so same-direction traffic is followed, oncoming traffic is on the far side.
import * as THREE from 'three';
import { registerEmissive, getDayness } from './night.js';
import { makeGLTFLoader, rigWheels } from './car.js';

const CRUISE = 11;          // m/s ≈ 40 km/h
const ACCEL = 7, DECEL = 20;
const CAR_LEN = 4.3;
const MODELS = [
  'assets/traffic/taxi.glb', 'assets/traffic/sedan1.glb', 'assets/traffic/sedan2.glb',
  'assets/traffic/suv.glb', 'assets/traffic/sports1.glb', 'assets/traffic/sports2.glb',
  'assets/traffic/cop.glb',
];
const PALETTE = [0xb63a34, 0x2f6fb0, 0xd7d7cf, 0x353b42, 0xd7a12b, 0x2f8f6f, 0x8a8f96, 0x6a4a8f];
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// procedural box car — instant placeholder before the GLB streams in
function makePlaceholder(color) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.7, 4.2),
    new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.3 }));
  body.position.y = 0.62; body.castShadow = true; g.add(body);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.66, 0.62, 2.2),
    new THREE.MeshStandardMaterial({ color: 0x1b2026, roughness: 0.15, metalness: 0.5 }));
  cabin.position.set(0, 1.18, -0.15); g.add(cabin);
  const tailMat = new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff2200, emissiveIntensity: 0.4 });
  for (const sx of [-0.6, 0.6]) {
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.18, 0.08), tailMat);
    t.position.set(sx, 0.64, -2.06); g.add(t);
  }
  return { group: g, tailMat };
}

export function createWorldTraffic(scene, model, signals, count = 14) {
  const group = new THREE.Group();
  scene.add(group);
  const { nodes, BLOCKS, PITCH, LANE, ROAD_HW } = model;
  const signalizedSet = new Set(model.signalized.map((it) => `${it.i},${it.j}`));
  const inGrid = (i, j) => i >= 0 && i <= BLOCKS && j >= 0 && j <= BLOCKS;

  function pickDir(i, j, inc) {
    const opts = DIRS.filter((d) => inGrid(i + d[0], j + d[1]) && !(d[0] === -inc[0] && d[1] === -inc[1]));
    if (!opts.length) return [-inc[0], -inc[1]];
    const straight = opts.find((d) => d[0] === inc[0] && d[1] === inc[1]);
    if (straight && Math.random() < 0.55) return straight;
    return opts[Math.floor(Math.random() * opts.length)];
  }

  // shared night-on headlight material for the streamed models
  const headMat = new THREE.MeshStandardMaterial({ color: 0x222018, emissive: 0xfff2cc, emissiveIntensity: 0.15 });
  registerEmissive(headMat, 0.0, 1.9);
  const lightGeo = new THREE.BoxGeometry(0.3, 0.14, 0.08);

  const cars = [];
  for (let k = 0; k < count; k++) {
    const ni = 1 + Math.floor(Math.random() * (BLOCKS - 1));
    const nj = 1 + Math.floor(Math.random() * (BLOCKS - 1));
    const dir = pickDir(ni, nj, [0, 0]);
    const container = new THREE.Group();
    group.add(container);
    const ph = makePlaceholder(PALETTE[k % PALETTE.length]);
    container.add(ph.group);
    cars.push({
      ni, nj, dir, t: Math.random() * 0.8, speed: CRUISE, yaw: 0,
      group: container, placeholder: ph.group, tailMat: ph.tailMat,
      mi: k % MODELS.length, applied: false, rig: null,
    });
  }

  // stream the GLB models and upgrade each car when its model arrives
  const loader = makeGLTFLoader();
  const V = new THREE.Vector3();
  MODELS.forEach((path, mi) => {
    loader.load(path, (gltf) => {
      for (const car of cars) {
        if (car.mi !== mi || car.applied) continue;
        applyModel(car, gltf);
      }
    }, undefined, () => { /* keep the placeholder on load error */ });
  });

  function applyModel(car, gltf) {
    const mdl = gltf.scene.clone(true);
    const rig = rigWheels(mdl);
    mdl.rotation.y = rig.forwardSign < 0 ? Math.PI : 0;
    const holder = new THREE.Group();
    holder.add(mdl);
    const b1 = new THREE.Box3().setFromObject(holder);
    const size = b1.getSize(V);
    const scale = CAR_LEN / Math.max(size.x, size.z);
    holder.scale.setScalar(scale);
    const b2 = new THREE.Box3().setFromObject(holder);
    const c = b2.getCenter(V);
    mdl.position.x -= c.x / scale;
    mdl.position.z -= c.z / scale;
    mdl.position.y -= b2.min.y / scale;
    holder.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => { if (m.isMeshStandardMaterial) m.envMapIntensity = 0.45; });
      }
    });
    // brake + head lights
    const tailMat = new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff2200, emissiveIntensity: 0.4 });
    for (const sx of [-0.55, 0.55]) {
      const tl = new THREE.Mesh(lightGeo, tailMat); tl.position.set(sx, 0.55, -2.05); holder.add(tl);
      const hl = new THREE.Mesh(lightGeo, headMat); hl.position.set(sx, 0.55, 2.05); holder.add(hl);
    }
    car.group.remove(car.placeholder);
    car.group.add(holder);
    car.tailMat = tailMat;
    car.rig = { spinNodes: rig.spinNodes, radius: rig.radius * scale, forwardSign: rig.forwardSign };
    car.applied = true;
  }

  return {
    cars,
    update(dt, playerPos) {
      const night = 1 - getDayness();
      const st = signals.getState();
      for (const car of cars) {
        const Ax = nodes[car.ni], Az = nodes[car.nj];
        const bi = car.ni + car.dir[0], bj = car.nj + car.dir[1];
        const Bx = nodes[bi], Bz = nodes[bj];
        const rx = -car.dir[1], rz = car.dir[0]; // lane offset (matches player side)
        const pax = Ax + rx * LANE, paz = Az + rz * LANE;
        const pbx = Bx + rx * LANE, pbz = Bz + rz * LANE;
        const cxp = pax + (pbx - pax) * car.t, czp = paz + (pbz - paz) * car.t;

        let target = CRUISE;
        if (signalizedSet.has(`${bi},${bj}`)) {
          const axis = car.dir[1] !== 0 ? 'ns' : 'ew';
          if (st[axis] === 'red' || st[axis] === 'yellow') {
            const distToStop = (1 - car.t) * PITCH - (ROAD_HW + 3.2);
            target = Math.min(target, Math.max(0, distToStop) * 1.3);
          }
        }
        for (const o of cars) {
          if (o === car || o.ni !== car.ni || o.nj !== car.nj || o.dir[0] !== car.dir[0] || o.dir[1] !== car.dir[1]) continue;
          if (o.t <= car.t) continue;
          const gap = (o.t - car.t) * PITCH;
          if (gap < 9) target = Math.min(target, Math.max(0, gap - 5.5) * 3);
        }
        if (playerPos) {
          const fx = playerPos.x - cxp, fz = playerPos.z - czp;
          const fwd = fx * car.dir[0] + fz * car.dir[1];
          const lat = fx * rx + fz * rz;
          if (fwd > 0 && fwd < 11 && Math.abs(lat) < 2.6) target = Math.min(target, Math.max(0, fwd - 4.5) * 2);
        }

        const braking = target < car.speed - 0.6;
        car.speed += THREE.MathUtils.clamp(target - car.speed, -DECEL * dt, ACCEL * dt);
        car.speed = Math.max(0, car.speed);
        car.t += car.speed * dt / PITCH;
        if (car.t >= 1) {
          car.t -= 1;
          car.ni = bi; car.nj = bj;
          car.dir = pickDir(bi, bj, car.dir);
        }

        car.group.position.set(cxp, 0, czp);
        const targetYaw = Math.atan2(car.dir[0], car.dir[1]);
        let dy = targetYaw - car.yaw;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        car.yaw += dy * Math.min(1, 8 * dt);
        car.group.rotation.y = car.yaw;
        car.tailMat.emissiveIntensity = (braking || car.speed < 0.5 ? 3.2 : 0.35) + night * 0.9;
        if (car.rig) {
          const spin = car.speed * dt / car.rig.radius * car.rig.forwardSign;
          for (const w of car.rig.spinNodes) w.rotation.x += spin;
        }
      }
    },
  };
}
