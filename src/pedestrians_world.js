// Open-world pedestrians: animated characters (the crowd models from the race
// demo) strolling the block sidewalks. They loop each block's perimeter, face
// their walking direction, and — crucially — dodge the player's car rather than
// getting run over: when the car nears, they scramble away and drift back.
import * as THREE from 'three';
import * as SkeletonUtils from '../vendor/utils/SkeletonUtils.js';
import { makeGLTFLoader } from './car.js';

const MODELS = [
  'assets/people/anne.glb', 'assets/people/casual.glb', 'assets/people/hoodie.glb',
  'assets/people/suit.glb', 'assets/people/worker.glb', 'assets/people/bizman.glb',
  'assets/people/woman.glb', 'assets/people/woman2.glb', 'assets/people/woman3.glb',
];
const WALK = 1.3;       // m/s
const DODGE_R = 5.5;    // how close the car must be to spook them

export function createPedestrians(scene, model, count = 34) {
  const group = new THREE.Group();
  scene.add(group);
  const { ROAD_HW, SIDEWALK, CURB_Y } = model;
  const mixers = [];
  const peds = [];

  // block sidewalk perimeters (a walk line down the middle of each sidewalk)
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
      const animated = gltfs.filter((g) => g && g.animations && g.animations.length);
      if (!animated.length) return;
      for (let k = 0; k < count; k++) {
        const gltf = animated[k % animated.length];
        const obj = SkeletonUtils.clone(gltf.scene);
        const box = new THREE.Box3().setFromObject(obj);
        const h = box.max.y - box.min.y || 1.7;
        obj.scale.setScalar((1.66 + Math.random() * 0.16) / h);
        obj.traverse((o) => { if (o.isMesh || o.isSkinnedMesh) { o.castShadow = true; o.frustumCulled = false; } });
        group.add(obj);
        const mixer = new THREE.AnimationMixer(obj);
        const clip = gltf.animations.find((c) => /walk/i.test(c.name))
          || gltf.animations.find((c) => /idle/i.test(c.name)) || gltf.animations[0];
        const action = mixer.clipAction(clip);
        action.timeScale = 0.9 + Math.random() * 0.25;
        action.play();
        mixer.update(Math.random() * (clip.duration || 1));
        mixers.push(mixer);

        peds.push({
          obj,
          slab: blocks[Math.floor(Math.random() * blocks.length)],
          c: Math.floor(Math.random() * 4),
          dir: Math.random() < 0.5 ? 1 : -1,
          t: Math.random(),
          speed: WALK * (0.85 + Math.random() * 0.4),
          yaw: 0,
          dodge: new THREE.Vector2(0, 0),
        });
      }
    });

  const A = new THREE.Vector2(), B = new THREE.Vector2();

  return {
    update(dt, playerPos) {
      for (const mx of mixers) mx.update(dt);
      for (const p of peds) {
        const cs = perim(p.slab);
        const a = cs[p.c], b = cs[(p.c + p.dir + 4) % 4];
        A.set(a[0], a[1]); B.set(b[0], b[1]);
        const len = A.distanceTo(B) || 1;
        p.t += p.speed * dt / len;
        if (p.t >= 1) { p.t -= 1; p.c = (p.c + p.dir + 4) % 4; }
        const px = a[0] + (b[0] - a[0]) * p.t;
        const pz = a[1] + (b[1] - a[1]) * p.t;

        // dodge the player's car
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

        p.obj.position.set(px + p.dodge.x, CURB_Y, pz + p.dodge.y);
        const targetYaw = Math.atan2(b[0] - a[0], b[1] - a[1]);
        let dy = targetYaw - p.yaw;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        p.yaw += dy * Math.min(1, 7 * dt);
        p.obj.rotation.y = p.yaw;
      }
    },
  };
}
