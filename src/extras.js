// Race-day set dressing: crowds in the thousands, bunting, cones.
//
// Crowd system (PS3 grandstand tricks, three layers):
//   1. Front rows: real character models baked into frozen poses, instanced.
//   2. The horde: billboard sprites rendered at startup from those same baked
//      poses into a texture atlas — thousands of spectators for ~2 tris each.
//   3. Accents: a few fully skinned & animated wavers and sidewalk walkers.
// Corners get tiered riser platforms so the mass is visible from car height.
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
// geometry, normalized to ~1.72 m with feet at y=0.
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
  const size = box.getSize(new THREE.Vector3());
  const s = 1.72 / size.y;
  const m = new THREE.Matrix4().makeScale(s, s, s)
    .multiply(new THREE.Matrix4().makeTranslation(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2));
  for (const p of parts) p.geometry.applyMatrix4(m);
  return parts;
}

// Render every baked pose into one sprite atlas; returns billboard
// {geometry, material} per pose (quads with the pose's atlas cell as UVs).
function makeBillboards(renderer, poses) {
  const CW = 160, CH = 320;
  const cols = 8, rows = Math.ceil(poses.length / cols);
  const rt = new THREE.WebGLRenderTarget(cols * CW, rows * CH, { depthBuffer: true });
  rt.texture.anisotropy = 4;

  const capScene = new THREE.Scene();
  capScene.add(new THREE.HemisphereLight(0xdfeaff, 0x8a8070, 1.15));
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.0);
  sun.position.set(-2, 3, 4);
  capScene.add(sun);
  const cam = new THREE.OrthographicCamera(-0.85, 0.85, 2.12, -0.05, 0.1, 10);
  cam.position.set(0, 1, 4);
  cam.lookAt(0, 1, 0);

  const prevColor = new THREE.Color();
  renderer.getClearColor(prevColor);
  const prevAlpha = renderer.getClearAlpha();
  renderer.setClearColor(0x000000, 0);
  renderer.setRenderTarget(rt);
  renderer.clear();
  const holder = new THREE.Group();
  capScene.add(holder);
  poses.forEach((parts, i) => {
    holder.clear();
    for (const p of parts) holder.add(new THREE.Mesh(p.geometry, p.material));
    const cx = (i % cols) * CW, cy = Math.floor(i / cols) * CH;
    // use the render target's own viewport/scissor so renderer canvas state is untouched
    rt.viewport.set(cx, cy, CW, CH);
    rt.scissor.set(cx, cy, CW, CH);
    rt.scissorTest = true;
    renderer.setRenderTarget(rt);
    renderer.render(capScene, cam);
  });
  rt.viewport.set(0, 0, cols * CW, rows * CH);
  rt.scissorTest = false;
  renderer.setRenderTarget(null);
  renderer.setClearColor(prevColor, prevAlpha);

  return poses.map((_, i) => {
    const g = new THREE.PlaneGeometry(1.7, 2.17);
    g.translate(0, 2.17 / 2 - 0.05, 0);
    const uv = g.attributes.uv;
    const u0 = (i % cols) / cols, v0 = Math.floor(i / cols) / rows;
    for (let k = 0; k < uv.count; k++) {
      uv.setXY(k, u0 + uv.getX(k) / cols, v0 + uv.getY(k) / rows);
    }
    const m = new THREE.MeshBasicMaterial({
      map: rt.texture, alphaTest: 0.4, side: THREE.DoubleSide,
    });
    return { geometry: g, material: m };
  });
}

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

export function buildExtras(scene, renderer, curve, length, cornerSpans) {
  const rng = mulberry32(2025);
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();

  const turnAngle = (s) => {
    const a = frameAt(curve, length, s).t;
    const b = frameAt(curve, length, s + 14).t;
    return Math.atan2(a.x * b.z - a.z * b.x, a.x * b.x + a.z * b.z);
  };

  // straight sections = complement of the corner spans
  const straights = [];
  {
    const sorted = [...cornerSpans].sort((a, b) => a[0] - b[0]);
    let cursor = 0;
    for (const [a, b] of sorted) {
      if (a - cursor > 20) straights.push([cursor, a]);
      cursor = Math.max(cursor, b);
    }
    if (length - cursor > 20) straights.push([cursor, length]);
  }

  // ---------------- crowd spot lists ----------------
  const spots3d = [];  // {x,z,y,rot,h}  front rows, real geometry
  const spotsBB = [];  // billboard horde
  const addRow = (list, a, b, off, y, side, spacing, skip = 0) => {
    for (let s = a; s < b; s += spacing * (0.85 + rng() * 0.3)) {
      if (rng() < skip) continue;
      const { p, r } = frameAt(curve, length, s);
      const o = off + (rng() - 0.5) * 0.3;
      list.push({
        x: p.x + r.x * side * o, z: p.z + r.z * side * o, y,
        rot: Math.atan2(-side * r.x, -side * r.z) + (rng() - 0.5) * 0.35,
        h: 0.92 + rng() * 0.18,
      });
    }
  };

  // corners: 3D front row + three tiered billboard rows on risers (outside),
  // plus a single row on the inside
  const riserGeos = [];
  for (const [a, b] of cornerSpans) {
    const outside = turnAngle((a + b) / 2) > 0 ? 1 : -1;
    addRow(spots3d, a, b, ROAD_HALF + 4.4, 0.02, outside, 1.05);
    addRow(spotsBB, a, b, ROAD_HALF + 5.7, 0.5, outside, 0.62);
    addRow(spotsBB, a, b, ROAD_HALF + 6.5, 1.0, outside, 0.62);
    addRow(spotsBB, a, b, ROAD_HALF + 7.3, 1.5, outside, 0.62);
    addRow(spots3d, a, b, ROAD_HALF + 4.4, 0.02, -outside, 1.6, 0.15);
    addRow(spotsBB, a, b, ROAD_HALF + 5.5, 0, -outside, 0.9, 0.1);
    // riser steps under the tiered rows
    riserGeos.push(buildRibbon(curve, length, [
      { x: outside * (ROAD_HALF + 5.3), y: 0, u: 0 },
      { x: outside * (ROAD_HALF + 5.3), y: 0.5, u: 0.15 },
      { x: outside * (ROAD_HALF + 6.1), y: 0.5, u: 0.3 },
      { x: outside * (ROAD_HALF + 6.1), y: 1.0, u: 0.45 },
      { x: outside * (ROAD_HALF + 6.9), y: 1.0, u: 0.6 },
      { x: outside * (ROAD_HALF + 6.9), y: 1.5, u: 0.75 },
      { x: outside * (ROAD_HALF + 7.7), y: 1.5, u: 0.9 },
      { x: outside * (ROAD_HALF + 7.7), y: 0, u: 1 },
    ], 1 / 8, Math.max(10, Math.floor((b - a) / 2.5)), a - 2, b + 2));
  }
  if (riserGeos.length) {
    const riser = new THREE.Mesh(mergeGeoms(riserGeos), new THREE.MeshStandardMaterial({
      color: 0x7d7a74, roughness: 0.95,
    }));
    riser.receiveShadow = true;
    scene.add(riser);
  }

  // straights: two packed rows along both fences
  for (const [a, b] of straights) {
    for (const side of [-1, 1]) {
      addRow(spotsBB, a + 6, b - 6, ROAD_HALF + 4.5, 0.02, side, 0.8, 0.08);
      addRow(spotsBB, a + 6, b - 6, ROAD_HALF + 5.4, 0.02, side, 0.85, 0.12);
    }
  }

  // ---------------- animated accents + baked crowd ----------------
  const mixers = [];
  const walkers = [];

  const findClip = (clips, re) => clips.find((c) => re.test(c.name));
  const spawn = (gltf, clipRe, x, z, rot, fallbackRe = /idle(_neutral)?$/i) => {
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
      mixer.update(rng() * clip.duration);
    }
    mixers.push(mixer);
    return obj;
  };

  const loader = makeGLTFLoader();
  Promise.all(CHARACTERS.map((p) => new Promise((res) => loader.load(p, res, undefined, () => res(null)))))
    .then((gltfs) => {
      const loaded = gltfs.filter(Boolean);
      if (!loaded.length) return;

      const isLight = (g) => {
        let tris = 0;
        g.scene.traverse((o) => { if (o.isMesh || o.isSkinnedMesh) tris += (o.geometry.index?.count || o.geometry.attributes.position.count) / 3; });
        return tris < 8000;
      };
      const massChars = loaded.filter(isLight);

      // bake poses: waving (corners) + idle (everywhere)
      const cheerPoses = [], standPoses = [];
      for (const g of massChars) {
        const clips = g.animations;
        const grab = (re, times, out) => {
          const clip = clips.find((c) => re.test(c.name));
          if (!clip) return;
          for (const f of times) out.push(bakePose(g, clip, clip.duration * f));
        };
        grab(/wave$/i, [0.3, 0.62], cheerPoses);
        grab(/idle(_neutral)?$/i, [0.45], standPoses);
      }
      if (!cheerPoses.length && !standPoses.length) return;

      // billboard sprites from the same poses
      const allPoses = [...cheerPoses, ...standPoses];
      const bb = makeBillboards(renderer, allPoses);
      const cheerBB = bb.slice(0, cheerPoses.length);
      const standBB = bb.slice(cheerPoses.length);

      const instantiate = (spots, variants, tintSat, mirror) => {
        if (!spots.length || !variants.length) return;
        const buckets = variants.map(() => []);
        spots.forEach((sp) => buckets[Math.floor(rng() * variants.length)].push(sp));
        buckets.forEach((bucket, vi) => {
          if (!bucket.length) return;
          const parts = Array.isArray(variants[vi]) ? variants[vi] : [variants[vi]];
          for (const part of parts) {
            const im = new THREE.InstancedMesh(part.geometry, part.material, bucket.length);
            im.frustumCulled = false;
            bucket.forEach((sp, i) => {
              dummy.position.set(sp.x, sp.y ?? 0.02, sp.z);
              dummy.rotation.set(0, sp.rot, 0);
              // mirroring flips winding, so only for double-sided billboards
              dummy.scale.set(mirror && rng() < 0.5 ? -sp.h : sp.h, sp.h, sp.h);
              dummy.updateMatrix();
              im.setMatrixAt(i, dummy.matrix);
              im.setColorAt(i, color.setHSL(rng(), tintSat, 0.85 + rng() * 0.14));
            });
            im.instanceColor.needsUpdate = true;
            scene.add(im);
          }
        });
      };

      // front rows in 3D (mix of waving and watching)
      instantiate(spots3d, [...cheerPoses, ...cheerPoses, ...standPoses], 0.08, false);
      // the billboard horde: wavers where there are risers, idle elsewhere
      const bbCheer = spotsBB.filter((s) => s.y > 0.1);
      const bbStand = spotsBB.filter((s) => s.y <= 0.1);
      instantiate(bbCheer, [...cheerBB, ...standBB], 0.1, true);
      instantiate(bbStand, standBB.length ? [...standBB, ...cheerBB.slice(0, 4)] : cheerBB, 0.1, true);

      // fully animated wavers in the front row at the corners
      const waver = loaded.find((g) => g.animations.some((c) => /wave$/i.test(c.name))) || loaded[0];
      for (const [a, b] of cornerSpans) {
        const n = Math.min(4, Math.floor((b - a) / 12));
        for (let i = 0; i < n; i++) {
          const s = a + rng() * (b - a);
          const side = rng() < 0.6 ? 1 : -1;
          const { p, r } = frameAt(curve, length, s);
          const off = ROAD_HALF + 3.95 + rng() * 0.4;
          const yaw = Math.atan2(-side * r.x, -side * r.z);
          spawn(waver, /wave$/i,
            p.x + r.x * side * off, p.z + r.z * side * off, yaw + (rng() - 0.5) * 0.4);
        }
      }
      // walkers strolling the sidewalks
      for (let i = 0; i < 12; i++) {
        const g = massChars.length ? massChars[Math.floor(rng() * massChars.length)] : loaded[0];
        const obj = spawn(g, /(^|\|)walk$/i, 0, 0, 0);
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
        const off = (ROAD_HALF + 0.95) * (rng() < 0.5 ? 1 : -1);
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
