// The city police force (#116). A small fleet of patrol cars cruises the
// grid with the lights off — loosely shadowing the player's part of town so
// they're never far away. The moment the heist calls in a robbery they ALL
// flip to pursuit AT ONCE (light bars flashing, rubber-banded speeds, greedy
// grid chase), and go back on patrol when the heat dies. The fleet is shown
// on the minimap as blue direction wedges, so you always know where the law
// is looking.
import * as THREE from 'three';
import { makeGLTFLoader, rigWheels } from './car.js';
import { mergeCarByMaterial } from './traffic_world.js';

const MOBILE = ('ontouchstart' in window) || (navigator.maxTouchPoints || 0) > 0;
const N_COPS = MOBILE ? 3 : 4;
const PATROL_SPEED = 12;        // m/s — cruising
const SHADOW_R = 260;           // patrols drift back toward the player beyond this
const ALARM_R = 450;            // units farther than this get dispatched close when the alarm goes
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export function createPolice(scene, model) {
  const { nodes, BLOCKS, PITCH, LANE } = model;
  const group = new THREE.Group();
  scene.add(group);

  const cops = [];
  let chasing = false;

  const loader = makeGLTFLoader();
  loader.load('assets/traffic/cop.glb', (gltf) => {
    for (let i = 0; i < N_COPS; i++) spawnCop(gltf, 1 + Math.floor(Math.random() * (BLOCKS - 1)), 1 + Math.floor(Math.random() * (BLOCKS - 1)));
  }, undefined, () => { /* no police in town today */ });

  function spawnCop(gltf, ni, nj) {
    const mdl = gltf.scene.clone(true);
    const rig = rigWheels(mdl);
    mdl.rotation.y = rig.forwardSign < 0 ? Math.PI : 0;
    const holder = new THREE.Group();
    holder.add(mdl);
    const V = new THREE.Vector3();
    const b1 = new THREE.Box3().setFromObject(holder);
    const size = b1.getSize(V);
    const scale = 4.6 / Math.max(size.x, size.z);
    holder.scale.setScalar(scale);
    const b2 = new THREE.Box3().setFromObject(holder);
    const c = b2.getCenter(V);
    mdl.position.x -= c.x / scale; mdl.position.z -= c.z / scale;
    mdl.position.y -= b2.min.y / scale;
    holder.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    mergeCarByMaterial(holder);
    // flashing light bar (added after the merge so the mats stay toggleable)
    const top = new THREE.Box3().setFromObject(holder).max.y;
    const mkLight = (col, x) => {
      const m = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: col, emissiveIntensity: 0 });
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.3), m);
      box.position.set(x, top + 0.02, -0.1);
      holder.add(box);
      return m;
    };
    const container = new THREE.Group();
    container.add(holder);
    container.position.set(nodes[ni], 0, nodes[nj]);
    group.add(container);
    cops.push({
      group: container, yaw: 0, ni, nj, dir: [0, 1], t: 0.05, speed: PATROL_SPEED,
      matL: mkLight(0xff2a20, -0.36), matR: mkLight(0x2a6bff, 0.36),
    });
  }

  function pickPatrolDir(c, playerPos) {
    const opts = DIRS.filter((d) => {
      const ni = c.ni + d[0], nj = c.nj + d[1];
      if (ni < 0 || ni > BLOCKS || nj < 0 || nj > BLOCKS) return false;
      return !(d[0] === -c.dir[0] && d[1] === -c.dir[1]);
    });
    if (!opts.length) return [-c.dir[0], -c.dir[1]];
    // far from the player's part of town → drift back toward it, else wander
    if (playerPos) {
      const dx = playerPos.x - nodes[c.ni], dz = playerPos.z - nodes[c.nj];
      if (dx * dx + dz * dz > SHADOW_R * SHADOW_R) {
        let best = opts[0], bestD = Infinity;
        for (const d of opts) {
          const dd = (nodes[c.ni + d[0]] - playerPos.x) ** 2 + (nodes[c.nj + d[1]] - playerPos.z) ** 2;
          if (dd < bestD) { bestD = dd; best = d; }
        }
        return best;
      }
    }
    const straight = opts.find((d) => d[0] === c.dir[0] && d[1] === c.dir[1]);
    if (straight && Math.random() < 0.6) return straight;
    return opts[Math.floor(Math.random() * opts.length)];
  }

  function pickChaseDir(c, playerPos) {
    let best = null, bestD = Infinity;
    for (const d of DIRS) {
      const ni = c.ni + d[0], nj = c.nj + d[1];
      if (ni < 0 || ni > BLOCKS || nj < 0 || nj > BLOCKS) continue;
      if (d[0] === -c.dir[0] && d[1] === -c.dir[1]) continue; // no U-turns
      const dd = (nodes[ni] - playerPos.x) ** 2 + (nodes[nj] - playerPos.z) ** 2;
      if (dd < bestD) { bestD = dd; best = d; }
    }
    return best || [-c.dir[0], -c.dir[1]];
  }

  // when the alarm goes, a far-off unit "responds from a side street": re-seat
  // it on a segment 2-3 blocks from the player (deep in/past the fog, no pop)
  function reseat(c, playerPos) {
    const pi = Math.max(1, Math.min(BLOCKS - 1, Math.round((playerPos.x - nodes[0]) / PITCH)));
    const pj = Math.max(1, Math.min(BLOCKS - 1, Math.round((playerPos.z - nodes[0]) / PITCH)));
    for (let tries = 0; tries < 10; tries++) {
      const di = Math.floor(Math.random() * 7) - 3, dj = Math.floor(Math.random() * 7) - 3;
      const ch = Math.max(Math.abs(di), Math.abs(dj));
      if (ch < 2 || ch > 3) continue;
      const ni = pi + di, nj = pj + dj;
      if (ni < 1 || ni > BLOCKS - 1 || nj < 1 || nj > BLOCKS - 1) continue;
      c.ni = ni; c.nj = nj;
      c.dir = pickChaseDir(c, playerPos);
      c.t = 0.2 + Math.random() * 0.4;
      c.group.position.set(nodes[ni], 0, nodes[nj]);
      return;
    }
  }

  return {
    cars: cops,
    chasing: () => chasing,
    setChase(v, playerPos) {
      chasing = v;
      if (v && playerPos) {
        for (const c of cops) {
          const dx = c.group.position.x - playerPos.x, dz = c.group.position.z - playerPos.z;
          if (dx * dx + dz * dz > ALARM_R * ALARM_R) reseat(c, playerPos);
        }
      }
      if (!v) for (const c of cops) { c.matL.emissiveIntensity = 0; c.matR.emissiveIntensity = 0; c.speed = PATROL_SPEED; }
    },
    update(dt, playerPos, tt) {
      for (const c of cops) {
        if (chasing) {
          const flash = Math.sin(tt * 11) > 0;
          c.matL.emissiveIntensity = flash ? 3.4 : 0.1;
          c.matR.emissiveIntensity = flash ? 0.1 : 3.4;
        }
        let target = PATROL_SPEED;
        if (chasing && playerPos) {
          const dx = playerPos.x - c.group.position.x, dz = playerPos.z - c.group.position.z;
          const dist = Math.hypot(dx, dz);
          target = dist > 250 ? 38 : dist < 16 ? 36 : 31;   // rubber band, ram up close
        }
        c.speed += THREE.MathUtils.clamp(target - c.speed, -18 * dt, 9 * dt);
        c.t += c.speed * dt / PITCH;
        if (c.t >= 1) {
          c.t -= 1; c.ni += c.dir[0]; c.nj += c.dir[1];
          c.dir = (chasing && playerPos) ? pickChaseDir(c, playerPos) : pickPatrolDir(c, playerPos);
        }
        const Ax = nodes[c.ni], Az = nodes[c.nj];
        const Bx = nodes[c.ni + c.dir[0]], Bz = nodes[c.nj + c.dir[1]];
        const rx = -c.dir[1], rz = c.dir[0];
        const lane = chasing ? 0.4 : 1;                     // patrol keeps its lane; pursuit cuts the middle
        const px = Ax + (Bx - Ax) * c.t + rx * LANE * lane;
        const pz = Az + (Bz - Az) * c.t + rz * LANE * lane;
        c.group.position.set(px, 0, pz);
        const targetYaw = Math.atan2(c.dir[0], c.dir[1]);
        let dy = targetYaw - c.yaw;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        c.yaw += dy * Math.min(1, 6 * dt);
        c.group.rotation.y = c.yaw;
      }
    },
    dbg: () => ({ chasing, cops: cops.map((c) => ({ x: +c.group.position.x.toFixed(0), z: +c.group.position.z.toFixed(0), yaw: +c.yaw.toFixed(2) })) }),
  };
}
