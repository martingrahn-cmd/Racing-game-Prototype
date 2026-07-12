// Open-world pedestrians. The character models skin incorrectly under a live
// AnimationMixer (the cloned pose spreads and renders invisible), so instead we
// BAKE a few frames of the walk cycle into static geometry (the technique the
// race crowd uses and which renders correctly) and flip between them — a cheap,
// robust 4-frame walk that needs no per-frame skinning. Pedestrians stroll the
// block sidewalks and dodge the player's car rather than being run over.
import * as THREE from 'three';
import * as SkeletonUtils from '../vendor/utils/SkeletonUtils.js';
import { makeGLTFLoader } from './car.js';

const MODELS = [
  'assets/people/anne.glb', 'assets/people/casual.glb', 'assets/people/hoodie.glb',
  'assets/people/suit.glb', 'assets/people/worker.glb', 'assets/people/bizman.glb',
  'assets/people/woman.glb', 'assets/people/woman2.glb', 'assets/people/woman3.glb',
];
const WALK = 1.25;      // m/s
const DODGE_R = 5.5;
const FRAMES = [0.05, 0.3, 0.55, 0.8]; // walk-cycle sample points (fraction of clip)

// bake a posed skinned mesh into static world-space geometry (~1.72 m tall,
// feet at y=0, centred). Returns [{geometry, material}].
function bakePose(gltf, clip, time) {
  const clone = SkeletonUtils.clone(gltf.scene);
  const mixer = new THREE.AnimationMixer(clone);
  mixer.clipAction(clip).play();
  mixer.update(time);
  clone.updateMatrixWorld(true);
  const parts = [];
  const v = new THREE.Vector3();
  clone.traverse((o) => {
    if (o.isSkinnedMesh) {
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
  });
  const box = new THREE.Box3();
  for (const p of parts) { p.geometry.computeBoundingBox(); box.union(p.geometry.boundingBox); }
  const s = 1.72 / (box.max.y - box.min.y || 1.72);
  const m = new THREE.Matrix4().makeScale(s, s, s)
    .multiply(new THREE.Matrix4().makeTranslation(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2));
  for (const p of parts) p.geometry.applyMatrix4(m);
  return parts;
}

export function createPedestrians(scene, model, count = 40) {
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
      // bake a walk-cycle flipbook per usable model
      const flipbooks = [];
      for (const gltf of gltfs) {
        if (!gltf || !gltf.animations || !gltf.animations.length) continue;
        const clip = gltf.animations.find((c) => /walk/i.test(c.name)) || gltf.animations[0];
        try {
          flipbooks.push(FRAMES.map((f) => bakePose(gltf, clip, clip.duration * f)));
        } catch { /* skip a model that won't bake */ }
      }
      if (!flipbooks.length) return;

      for (let k = 0; k < count; k++) {
        const fb = flipbooks[k % flipbooks.length];
        const container = new THREE.Group();
        const poseGroups = fb.map((parts, i) => {
          const sub = new THREE.Group();
          for (const part of parts) {
            const mesh = new THREE.Mesh(part.geometry, part.material);
            mesh.castShadow = true; mesh.frustumCulled = false;
            sub.add(mesh);
          }
          sub.visible = i === 0;
          container.add(sub);
          return sub;
        });
        group.add(container);
        peds.push({
          group: container, poseGroups, curPose: 0, phase: Math.random() * FRAMES.length,
          slab: blocks[Math.floor(Math.random() * blocks.length)],
          c: Math.floor(Math.random() * 4),
          dir: Math.random() < 0.5 ? 1 : -1,
          t: Math.random(),
          speed: WALK * (0.8 + Math.random() * 0.5),
          yaw: 0,
          dodge: new THREE.Vector2(0, 0),
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

        p.group.position.set(px + p.dodge.x, CURB_Y, pz + p.dodge.y);
        const targetYaw = Math.atan2(b[0] - a[0], b[1] - a[1]);
        let dy = targetYaw - p.yaw;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        p.yaw += dy * Math.min(1, 7 * dt);
        p.group.rotation.y = p.yaw;

        // flipbook walk: advance the pose with distance travelled
        p.phase += p.speed * dt * 2.0;
        const idx = Math.floor(p.phase) % FRAMES.length;
        if (idx !== p.curPose) {
          p.poseGroups[p.curPose].visible = false;
          p.poseGroups[idx].visible = true;
          p.curPose = idx;
        }
      }
    },
  };
}
