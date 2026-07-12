// Open-world pedestrians. The character models skin incorrectly under a live
// AnimationMixer (the cloned pose spreads and renders invisible), so instead we
// BAKE a flipbook of the walk cycle into static geometry (the technique the race
// crowd uses and which renders correctly). Each pedestrian holds ONE set of
// meshes and swaps their geometry reference per frame — so a 30-frame walk costs
// exactly the same per-frame as a 4-frame one (no per-frame skinning, no extra
// scene objects). The cycle is foot-locked to ground speed (no sliding) and the
// crowd scales with the day: packed at midday, sparse at night. Pedestrians
// stroll the block sidewalks and dodge the player's car rather than be run over.
import * as THREE from 'three';
import * as SkeletonUtils from '../vendor/utils/SkeletonUtils.js';
import { makeGLTFLoader } from './car.js';
import { getDayness } from './night.js';

const MODELS = [
  'assets/people/anne.glb', 'assets/people/casual.glb', 'assets/people/hoodie.glb',
  'assets/people/suit.glb', 'assets/people/worker.glb', 'assets/people/bizman.glb',
  'assets/people/woman.glb', 'assets/people/woman2.glb', 'assets/people/woman3.glb',
];
const WALK = 1.25;        // m/s
const DODGE_R = 5.5;
const NFRAMES = 30;       // baked walk-cycle frames (free at runtime via geometry swap)
const STRIDE = 1.35;      // metres travelled per full walk cycle → foot-locked, no sliding
const DAY_CROWD = 90;     // active pedestrians at full daylight
const NIGHT_CROWD = 26;   // active pedestrians at night

// Bake a full walk-cycle flipbook from one model. Clone the rig ONCE, then sample
// NFRAMES evenly across the clip, baking each posed frame into static world-space
// geometry (~1.72 m tall, feet at 0, centred). All frames share ONE normalising
// transform so the character's height doesn't jitter frame-to-frame (a per-frame
// bbox would squash any frame where a hand rises above the head). Returns an array
// of NFRAMES frames, each an array of {geometry, material} parts.
function bakeFlipbook(gltf, clip, nFrames) {
  const clone = SkeletonUtils.clone(gltf.scene);
  const mixer = new THREE.AnimationMixer(clone);
  mixer.clipAction(clip).play();
  const skinned = [];
  clone.traverse((o) => { if (o.isSkinnedMesh) skinned.push(o); });
  const frames = [];
  const v = new THREE.Vector3();
  for (let f = 0; f < nFrames; f++) {
    mixer.setTime(clip.duration * (f / nFrames));
    clone.updateMatrixWorld(true);
    const parts = [];
    for (const o of skinned) {
      o.skeleton.update();
      const g = o.geometry.clone();
      const src = o.geometry.attributes.position;
      const pos = g.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(src, i);
        o.applyBoneTransform(i, v);
        v.applyMatrix4(o.matrixWorld);
        pos.setXYZ(i, v.x, v.y, v.z);
      }
      g.deleteAttribute('skinIndex');
      g.deleteAttribute('skinWeight');
      g.computeVertexNormals();
      parts.push({ geometry: g, material: o.material });
    }
    frames.push(parts);
  }
  const box = new THREE.Box3();
  for (const parts of frames) for (const p of parts) { p.geometry.computeBoundingBox(); box.union(p.geometry.boundingBox); }
  const s = 1.72 / (box.max.y - box.min.y || 1.72);
  const m = new THREE.Matrix4().makeScale(s, s, s)
    .multiply(new THREE.Matrix4().makeTranslation(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2));
  for (const parts of frames) for (const p of parts) p.geometry.applyMatrix4(m);
  return frames;
}

export function createPedestrians(scene, model, count = DAY_CROWD) {
  const group = new THREE.Group();
  scene.add(group);
  const { SIDEWALK, CURB_Y } = model;
  const peds = [];

  const blocks = model.buildings.map((b) => b.slab);
  if (model.plaza) blocks.push(model.plaza);
  const m = SIDEWALK / 2;
  const perim = (s) => [
    [s.minX + m, s.minZ + m], [s.maxX - m, s.minZ + m],
    [s.maxX - m, s.maxZ - m], [s.minX + m, s.maxZ - m],
  ];

  const loader = makeGLTFLoader();
  Promise.all(MODELS.map((p) => new Promise((res) => loader.load(p, res, undefined, () => res(null)))))
    .then((gltfs) => {
      const flipbooks = [];
      for (const gltf of gltfs) {
        if (!gltf || !gltf.animations || !gltf.animations.length) continue;
        const clip = gltf.animations.find((c) => /walk/i.test(c.name)) || gltf.animations[0];
        try { flipbooks.push(bakeFlipbook(gltf, clip, NFRAMES)); }
        catch { /* skip a model that won't bake */ }
      }
      if (!flipbooks.length) return;

      for (let k = 0; k < count; k++) {
        const fb = flipbooks[k % flipbooks.length];
        const container = new THREE.Group();
        const meshes = fb[0].map((part) => {
          const mesh = new THREE.Mesh(part.geometry, part.material);
          mesh.castShadow = true; mesh.frustumCulled = false;
          container.add(mesh);
          return mesh;
        });
        group.add(container);
        peds.push({
          group: container, meshes, fb, nF: fb.length, curFrame: 0,
          phase: Math.random() * fb.length,
          slab: blocks[Math.floor(Math.random() * blocks.length)],
          c: Math.floor(Math.random() * 4),
          dir: Math.random() < 0.5 ? 1 : -1,
          t: Math.random(),
          speed: WALK * (0.8 + Math.random() * 0.5),
          yaw: 0,
          dodge: new THREE.Vector2(0, 0),
          d2: 0,
        });
      }
    });

  return {
    update(dt, playerPos) {
      for (const p of peds) {
        const cs = perim(p.slab);
        const a = cs[p.c], b = cs[(p.c + p.dir + 4) % 4];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        p.t += p.speed * dt / len;
        if (p.t >= 1) { p.t -= 1; p.c = (p.c + p.dir + 4) % 4; }
        const px = a[0] + (b[0] - a[0]) * p.t;
        const pz = a[1] + (b[1] - a[1]) * p.t;

        if (playerPos) {
          const dx = px + p.dodge.x - playerPos.x, dz = pz + p.dodge.y - playerPos.z;
          const d = Math.hypot(dx, dz);
          if (d < DODGE_R && d > 0.05) {
            p.dodge.x += (dx / d) * 9 * dt;
            p.dodge.y += (dz / d) * 9 * dt;
            if (p.dodge.length() > 2.6) p.dodge.setLength(2.6);
          }
        }
        p.dodge.multiplyScalar(Math.max(0, 1 - 2 * dt));

        const wx = px + p.dodge.x, wz = pz + p.dodge.y;
        p.group.position.set(wx, CURB_Y, wz);
        const targetYaw = Math.atan2(b[0] - a[0], b[1] - a[1]);
        let dy = targetYaw - p.yaw;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        p.yaw += dy * Math.min(1, 7 * dt);
        p.group.rotation.y = p.yaw;

        // foot-locked flipbook: one full cycle per STRIDE metres travelled
        p.phase += (p.speed * dt / STRIDE) * p.nF;
        const idx = Math.floor(p.phase) % p.nF;
        if (idx !== p.curFrame) {
          const parts = p.fb[idx];
          for (let i = 0; i < p.meshes.length; i++) p.meshes[i].geometry = parts[i].geometry;
          p.curFrame = idx;
        }

        if (playerPos) { const ex = wx - playerPos.x, ez = wz - playerPos.z; p.d2 = ex * ex + ez * ez; }
      }

      // day/night crowd size: pack the streets at midday, thin out after dark.
      // Hide the FARTHEST pedestrians so the pop-in happens off in the distance.
      const active = Math.round(NIGHT_CROWD + (DAY_CROWD - NIGHT_CROWD) * getDayness());
      if (active >= peds.length || !playerPos) {
        for (const p of peds) p.group.visible = true;
      } else {
        const order = peds.slice().sort((x, y) => x.d2 - y.d2);
        for (let i = 0; i < order.length; i++) order[i].group.visible = i < active;
      }
    },
  };
}
