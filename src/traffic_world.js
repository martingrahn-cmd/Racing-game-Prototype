// Open-world traffic: AI cars that route the street grid, keep to their lane,
// stop at red lights, turn at intersections, follow the car ahead, and brake
// for the player. Cars are simple procedural boxes with working brake lights.
//
// Lane convention matches the player spawn: travelling +z runs in the x=node-LANE
// lane, so same-direction traffic is followed, oncoming traffic is on the far side.
import * as THREE from 'three';
import { registerEmissive, getDayness } from './night.js';

const CRUISE = 11;          // m/s ≈ 40 km/h
const ACCEL = 7, DECEL = 20;
const PALETTE = [0xb63a34, 0x2f6fb0, 0xd7d7cf, 0x353b42, 0xd7a12b, 0x2f8f6f, 0x8a8f96, 0x6a4a8f];
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function makeCar(color) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.7, 4.2),
    new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.3 }));
  body.position.y = 0.62; body.castShadow = true; g.add(body);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.66, 0.62, 2.2),
    new THREE.MeshStandardMaterial({ color: 0x1b2026, roughness: 0.15, metalness: 0.5 }));
  cabin.position.set(0, 1.18, -0.15); g.add(cabin);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111318, roughness: 0.85 });
  const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.3, 12);
  for (const [wx, wz] of [[-0.95, 1.3], [0.95, 1.3], [-0.95, -1.3], [0.95, -1.3]]) {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.rotation.z = Math.PI / 2; w.position.set(wx, 0.34, wz); g.add(w);
  }
  // tail lights (rear = local -z) — driven manually for brake flashes
  const tailMat = new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff2200, emissiveIntensity: 0.4 });
  for (const sx of [-0.6, 0.6]) {
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.18, 0.08), tailMat);
    t.position.set(sx, 0.64, -2.06); g.add(t);
  }
  // head lights (front = local +z) — on at night
  const headMat = new THREE.MeshStandardMaterial({ color: 0x222018, emissive: 0xfff2cc, emissiveIntensity: 0.15 });
  registerEmissive(headMat, 0.0, 1.9);
  for (const sx of [-0.6, 0.6]) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.16, 0.08), headMat);
    h.position.set(sx, 0.6, 2.12); g.add(h);
  }
  return { group: g, tailMat };
}

export function createWorldTraffic(scene, model, signals, count = 14) {
  const group = new THREE.Group();
  scene.add(group);
  const { nodes, BLOCKS, PITCH, LANE, ROAD_HW } = model;
  const signalizedSet = new Set(model.signalized.map((it) => `${it.i},${it.j}`));
  const inGrid = (i, j) => i >= 0 && i <= BLOCKS && j >= 0 && j <= BLOCKS;
  const nodeX = (i) => nodes[i], nodeZ = (j) => nodes[j];

  function pickDir(i, j, inc) {
    const opts = DIRS.filter((d) => inGrid(i + d[0], j + d[1]) && !(d[0] === -inc[0] && d[1] === -inc[1]));
    if (!opts.length) return [-inc[0], -inc[1]];
    const straight = opts.find((d) => d[0] === inc[0] && d[1] === inc[1]);
    if (straight && Math.random() < 0.55) return straight;
    return opts[Math.floor(Math.random() * opts.length)];
  }

  const cars = [];
  for (let k = 0; k < count; k++) {
    const ni = 1 + Math.floor(Math.random() * (BLOCKS - 1));
    const nj = 1 + Math.floor(Math.random() * (BLOCKS - 1));
    const dir = pickDir(ni, nj, [0, 0]);
    const { group: mesh, tailMat } = makeCar(PALETTE[k % PALETTE.length]);
    group.add(mesh);
    cars.push({ ni, nj, dir, t: Math.random() * 0.8, speed: CRUISE, yaw: 0, group: mesh, tailMat });
  }

  const tmp = new THREE.Vector3();

  return {
    cars,
    update(dt, playerPos) {
      const night = 1 - getDayness();
      const st = signals.getState();
      for (const car of cars) {
        const A = { x: nodeX(car.ni), z: nodeZ(car.nj) };
        const bi = car.ni + car.dir[0], bj = car.nj + car.dir[1];
        const B = { x: nodeX(bi), z: nodeZ(bj) };
        const rx = -car.dir[1], rz = car.dir[0]; // lane offset (matches player side)
        const pax = A.x + rx * LANE, paz = A.z + rz * LANE;
        const pbx = B.x + rx * LANE, pbz = B.z + rz * LANE;
        const cxp = pax + (pbx - pax) * car.t, czp = paz + (pbz - paz) * car.t;

        let target = CRUISE;
        // stop for a red/yellow at a signalised intersection ahead
        if (signalizedSet.has(`${bi},${bj}`)) {
          const axis = car.dir[1] !== 0 ? 'ns' : 'ew';
          if (st[axis] === 'red' || st[axis] === 'yellow') {
            const distToStop = (1 - car.t) * PITCH - (ROAD_HW + 3.2);
            target = Math.min(target, Math.max(0, distToStop) * 1.3);
          }
        }
        // follow the nearest car ahead in the same lane
        for (const o of cars) {
          if (o === car || o.ni !== car.ni || o.nj !== car.nj || o.dir[0] !== car.dir[0] || o.dir[1] !== car.dir[1]) continue;
          if (o.t <= car.t) continue;
          const gap = (o.t - car.t) * PITCH;
          if (gap < 9) target = Math.min(target, Math.max(0, gap - 5.5) * 3);
        }
        // brake for the player if they're close ahead on our path
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
        // shortest-arc smoothing toward the travel direction
        let dy = targetYaw - car.yaw;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        car.yaw += dy * Math.min(1, 8 * dt);
        car.group.rotation.y = car.yaw;
        car.tailMat.emissiveIntensity = (braking || car.speed < 0.5 ? 3.2 : 0.35) + night * 0.9;
      }
    },
  };
}
