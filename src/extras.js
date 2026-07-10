// Race-day set dressing: spectator crowds behind the fences, pedestrians on
// the sidewalks, bunting over the corner fences and cones at corner entries.
// People are two instanced meshes (bodies tinted by clothing, heads by skin).
import * as THREE from 'three';
import { frameAt, mergeGeoms, buildRibbon, ROAD_HALF } from './track.js';
import { mulberry32 } from './textures.js';
import { makeGLTFLoader } from './car.js';
import * as SkeletonUtils from '../vendor/utils/SkeletonUtils.js';

const CHARACTERS = [
  'assets/people/anne.glb', 'assets/people/woman.glb',
  'assets/people/hoodie.glb', 'assets/people/suit.glb', 'assets/people/worker.glb',
  'assets/people/casual.glb', 'assets/people/bizman.glb',
  'assets/people/woman2.glb', 'assets/people/woman3.glb',
];

function paintVerts(g, hex) {
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  const c = new THREE.Color(hex);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

// Bake a skinned character at one animation frame into static world-space
// geometry — the crowd is then instanced real bodies in frozen poses, the
// same impostor trick PS3-era games used for grandstands.
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
  // normalize: feet at y=0, centred, ~1.72 m tall
  const box = new THREE.Box3();
  for (const p of parts) { p.geometry.computeBoundingBox(); box.union(p.geometry.boundingBox); }
  const size = box.getSize(new THREE.Vector3());
  const s = 1.72 / size.y;
  const m = new THREE.Matrix4().makeScale(s, s, s)
    .multiply(new THREE.Matrix4().makeTranslation(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2));
  for (const p of parts) p.geometry.applyMatrix4(m);
  return parts;
}

// Ribbon UVs: u (texture x) runs top→bottom of the strip, v (texture y)
// repeats along the track — so flags are drawn sideways, hanging toward +x.
function makeBuntingTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 256;
  const x = c.getContext('2d');
  x.clearRect(0, 0, 64, 256);
  x.strokeStyle = '#e8e8e8'; x.lineWidth = 4;
  x.beginPath(); x.moveTo(3, 0); x.lineTo(3, 256); x.stroke();
  const cols = ['#d84a3a', '#e8c53a', '#3a76d8', '#3aa65a'];
  for (let i = 0; i < 4; i++) {
    x.fillStyle = cols[i];
    const y0 = i * 64 + 3;
    x.beginPath();
    x.moveTo(5, y0); x.lineTo(5, y0 + 58); x.lineTo(58, y0 + 29);
    x.closePath(); x.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.ClampToEdgeWrapping; t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function buildExtras(scene, curve, length, cornerSpans) {
  const rng = mulberry32(2025);
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();

  // ---------------- crowd placement (filled with baked poses once loaded) ---
  const crowdSpots = []; // {x, z, rot, h, cheer}
  const put = (s, off, side, facing, cheer) => {
    const { r, p } = frameAt(curve, length, s);
    const x = p.x + r.x * side * off, z = p.z + r.z * side * off;
    const yawToTrack = Math.atan2(-side * r.x, -side * r.z);
    crowdSpots.push({
      x, z,
      rot: facing === 'track' ? yawToTrack + (rng() - 0.5) * 0.5 : rng() * Math.PI * 2,
      h: 0.92 + rng() * 0.18,
      cheer,
    });
  };
  // dense crowds at the corners, behind the catch fence (two loose rows)
  for (const [a, b] of cornerSpans) {
    const n = Math.floor((b - a) / 1.1);
    for (let i = 0; i < n; i++) {
      const s = a + rng() * (b - a);
      const side = rng() < 0.6 ? 1 : -1;
      put(s, ROAD_HALF + 4.3 + rng() * 1.4, side, 'track', true);
    }
  }
  // scattered pedestrians along the rest of the lap
  for (let s = 0; s < length; s += 9) {
    if (rng() < 0.4) continue;
    put(s + rng() * 6, ROAD_HALF + 4.3 + rng() * 1.3, rng() < 0.5 ? 1 : -1, 'any', false);
  }

  // ---------------- bunting over the corner fences ----------------
  {
    const tex = makeBuntingTexture();
    const mat = new THREE.MeshStandardMaterial({
      map: tex, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.8,
    });
    const strips = [];
    for (const [a, b] of cornerSpans) {
      for (const side of [-1, 1]) {
        strips.push(buildRibbon(curve, length, [
          { x: side * (ROAD_HALF + 3.7), y: 3.0, u: 0 },
          { x: side * (ROAD_HALF + 3.7), y: 2.62, u: 1 },
        ], 1 / 3.2, Math.max(8, Math.floor((b - a) / 3)), a, b));
      }
    }
    if (strips.length) scene.add(new THREE.Mesh(mergeGeoms(strips), mat));
  }

  // ---------------- cones at corner entries ----------------
  {
    const coneGeo = new THREE.CylinderGeometry(0.05, 0.16, 0.5, 8);
    coneGeo.translate(0, 0.25, 0);
    const base = new THREE.CylinderGeometry(0.2, 0.2, 0.04, 8);
    base.translate(0, 0.02, 0);
    const geo = mergeGeoms([paintVerts(coneGeo, 0xe06a1e), paintVerts(base, 0xd8d8d8)]);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
    const spots = [];
    for (const [a] of cornerSpans) {
      for (let i = 0; i < 5; i++) {
        if (rng() < 0.45) continue;
        const { p, r } = frameAt(curve, length, a - 14 + i * 5);
        const off = (ROAD_HALF + 0.95) * (rng() < 0.5 ? 1 : -1); // on the kerb edge, off the line
        spots.push({ x: p.x + r.x * off, z: p.z + r.z * off });
      }
    }
    if (spots.length) {
      const cones = new THREE.InstancedMesh(geo, mat, spots.length);
      cones.frustumCulled = false;
      cones.castShadow = true;
      spots.forEach((sp, i) => {
        dummy.position.set(sp.x, 0.03, sp.z);
        dummy.rotation.set(0, rng() * Math.PI, 0);
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        cones.setMatrixAt(i, dummy.matrix);
      });
      scene.add(cones);
    }
  }

  // ---------------- animated characters (skinned, CC0/CC-BY GLBs) ----------
  const mixers = [];
  const walkers = []; // {obj, s, off, side, dir, v}

  const findClip = (clips, re) => clips.find((c) => re.test(c.name));
  const spawn = (gltf, clipRe, x, z, rot, fallbackRe = /idle/i) => {
    const obj = SkeletonUtils.clone(gltf.scene);
    const box = new THREE.Box3().setFromObject(obj);
    const h = box.max.y - box.min.y;
    const sc = (1.68 + rng() * 0.16) / h;
    obj.scale.setScalar(sc);
    obj.position.set(x, 0, z);
    obj.rotation.y = rot;
    obj.traverse((o) => { if (o.isMesh || o.isSkinnedMesh) { o.castShadow = true; o.frustumCulled = false; } });
    scene.add(obj);
    const mixer = new THREE.AnimationMixer(obj);
    const clip = findClip(gltf.animations, clipRe) || findClip(gltf.animations, fallbackRe) || gltf.animations[0];
    if (clip) {
      const action = mixer.clipAction(clip);
      action.timeScale = 0.9 + rng() * 0.25;
      action.play();
      mixer.update(rng() * clip.duration); // desync the crowd
    }
    mixers.push(mixer);
    return obj;
  };

  const loader = makeGLTFLoader();
  Promise.all(CHARACTERS.map((p) => new Promise((res) => loader.load(p, res, undefined, () => res(null)))))
    .then((gltfs) => {
      const loaded = gltfs.filter(Boolean);
      if (!loaded.length) return;

      // -------- baked-pose instanced crowd (light characters only) ---------
      const isLight = (g) => {
        let tris = 0;
        g.scene.traverse((o) => { if (o.isMesh || o.isSkinnedMesh) tris += (o.geometry.index?.count || o.geometry.attributes.position.count) / 3; });
        return tris < 8000;
      };
      const massChars = loaded.filter(isLight);
      const cheerPoses = [], standPoses = [];
      for (const g of massChars) {
        const clips = g.animations;
        const grab = (re, times, out) => {
          const clip = clips.find((c) => re.test(c.name));
          if (!clip) return;
          for (const f of times) out.push(bakePose(g, clip, clip.duration * f));
        };
        // clip names end with the action ("...|Wave"); avoid Idle_Gun etc.
        grab(/wave$/i, [0.3, 0.62], cheerPoses); // arm overhead mid-wave
        grab(/idle(_neutral)?$/i, [0.2, 0.7], standPoses);
      }
      const buildCrowd = (spots, poses) => {
        if (!spots.length || !poses.length) return;
        const buckets = poses.map(() => []);
        spots.forEach((sp) => buckets[Math.floor(rng() * poses.length)].push(sp));
        buckets.forEach((bucket, pi) => {
          if (!bucket.length) return;
          for (const part of poses[pi]) {
            const im = new THREE.InstancedMesh(part.geometry, part.material, bucket.length);
            im.frustumCulled = false; // spectators are cheap: no shadow pass
            bucket.forEach((sp, i) => {
              dummy.position.set(sp.x, 0.02, sp.z);
              dummy.rotation.set(0, sp.rot, 0);
              dummy.scale.setScalar(sp.h);
              dummy.updateMatrix();
              im.setMatrixAt(i, dummy.matrix);
              // subtle per-person tint so identical clones read as different people
              im.setColorAt(i, color.setHSL(rng(), 0.08, 0.85 + rng() * 0.14));
            });
            im.instanceColor.needsUpdate = true;
            scene.add(im);
          }
        });
      };
      // corners: mostly waving, some just watching; elsewhere: idle bystanders
      buildCrowd(crowdSpots.filter((s) => s.cheer),
        cheerPoses.length ? [...cheerPoses, ...cheerPoses, ...standPoses] : standPoses);
      buildCrowd(crowdSpots.filter((s) => !s.cheer), standPoses.length ? standPoses : cheerPoses);

      // -------- fully animated accents ------------------------------------
      // wavers: prefer a character that actually has a wave clip
      const waver = loaded.find((g) => g.animations.some((c) => /wave/i.test(c.name))) || loaded[0];
      for (const [a, b] of cornerSpans) {
        const n = Math.min(4, Math.floor((b - a) / 12));
        for (let i = 0; i < n; i++) {
          const s = a + rng() * (b - a);
          const side = rng() < 0.6 ? 1 : -1;
          const { p, r } = frameAt(curve, length, s);
          const off = ROAD_HALF + 3.95 + rng() * 0.4;
          const yaw = Math.atan2(-side * r.x, -side * r.z);
          spawn(waver, /wave|yes|cheer/i,
            p.x + r.x * side * off, p.z + r.z * side * off, yaw + (rng() - 0.5) * 0.4);
        }
      }
      // walkers strolling the sidewalks
      for (let i = 0; i < 12; i++) {
        const g = massChars.length ? massChars[Math.floor(rng() * massChars.length)] : loaded[0];
        const obj = spawn(g, /walk/i, 0, 0, 0);
        walkers.push({
          obj,
          s: rng() * length,
          off: ROAD_HALF + 1.6 + rng() * 1.6,
          side: rng() < 0.5 ? 1 : -1,
          dir: rng() < 0.5 ? 1 : -1,
          v: 1.1 + rng() * 0.6,
        });
      }
    });

  return {
    update(dt) {
      for (const m of mixers) m.update(dt);
      for (const w of walkers) {
        w.s = ((w.s + w.dir * w.v * dt) % length + length) % length;
        const { p, t, r } = frameAt(curve, length, w.s);
        w.obj.position.set(p.x + r.x * w.side * w.off, 0.16, p.z + r.z * w.side * w.off);
        w.obj.rotation.y = Math.atan2(w.dir * t.x, w.dir * t.z);
      }
    },
  };
}
