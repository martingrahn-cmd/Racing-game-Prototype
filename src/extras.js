// Race-day set dressing: spectator crowds behind the fences, pedestrians on
// the sidewalks, bunting over the corner fences and cones at corner entries.
// People are two instanced meshes (bodies tinted by clothing, heads by skin).
import * as THREE from 'three';
import { frameAt, mergeGeoms, buildRibbon, ROAD_HALF } from './track.js';
import { mulberry32 } from './textures.js';

const CLOTHES = [
  0xc94f3d, 0x3d6bc9, 0x3da05a, 0xd8c13a, 0xd8d8d8, 0x8a4fc9,
  0x36b6c4, 0xe07f2e, 0x555a63, 0xb03a68, 0x2e3a4e, 0x9aa5ad,
];
const SKINS = [0xf2c9a4, 0xe0ac7e, 0xc98d5f, 0x9c6b43, 0x7a4f30, 0xf7d7b8];

function paintVerts(g, hex) {
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  const c = new THREE.Color(hex);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

// body geometry, arms down or cheering; clothing painted white (tinted per instance)
function personGeometry(cheer) {
  const parts = [];
  const legs = new THREE.BoxGeometry(0.26, 0.72, 0.17);
  legs.translate(0, 0.36, 0);
  parts.push(paintVerts(legs, 0x3a3d44)); // dark pants, tint shifts them subtly
  const torso = new THREE.BoxGeometry(0.36, 0.56, 0.22);
  torso.translate(0, 1.0, 0);
  parts.push(paintVerts(torso, 0xffffff));
  for (const sx of [-1, 1]) {
    const arm = new THREE.BoxGeometry(0.09, 0.5, 0.11);
    if (cheer) {
      arm.translate(0, 0.25, 0);
      arm.rotateZ(sx * 2.55); // raised overhead
      arm.translate(sx * 0.2, 1.25, 0);
    } else {
      arm.translate(sx * 0.24, 0.99, 0);
    }
    parts.push(paintVerts(arm, 0xffffff));
  }
  return mergeGeoms(parts);
}

function makeBuntingTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const x = c.getContext('2d');
  x.clearRect(0, 0, 256, 64);
  x.strokeStyle = '#e8e8e8'; x.lineWidth = 3;
  x.beginPath(); x.moveTo(0, 4); x.lineTo(256, 4); x.stroke();
  const cols = ['#d84a3a', '#e8c53a', '#3a76d8', '#3aa65a', '#e8e8e8', '#8a4fc9'];
  for (let i = 0; i < 8; i++) {
    x.fillStyle = cols[i % cols.length];
    x.beginPath();
    x.moveTo(i * 32 + 2, 4); x.lineTo(i * 32 + 30, 4); x.lineTo(i * 32 + 16, 58);
    x.closePath(); x.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

export function buildExtras(scene, curve, length, cornerSpans) {
  const rng = mulberry32(2025);
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();

  // ---------------- people placement ----------------
  const people = []; // {x, z, rot, h, cheer, clothes, skin}
  const put = (s, off, side, facing, cheer) => {
    const { p, t, r } = frameAt(curve, length, s);
    const x = p.x + r.x * side * off, z = p.z + r.z * side * off;
    const yawToTrack = Math.atan2(-side * r.x, -side * r.z);
    people.push({
      x, z,
      rot: facing === 'track' ? yawToTrack + (rng() - 0.5) * 0.5 : rng() * Math.PI * 2,
      h: 0.88 + rng() * 0.24,
      cheer,
      clothes: CLOTHES[Math.floor(rng() * CLOTHES.length)],
      skin: SKINS[Math.floor(rng() * SKINS.length)],
    });
  };
  // dense crowds at the corners, behind the catch fence
  for (const [a, b] of cornerSpans) {
    const n = Math.floor((b - a) / 1.6);
    for (let i = 0; i < n; i++) {
      const s = a + rng() * (b - a);
      const side = rng() < 0.6 ? 1 : -1;
      put(s, ROAD_HALF + 4.3 + rng() * 1.1, side, 'track', rng() < 0.35);
    }
  }
  // scattered pedestrians along the rest of the lap
  for (let s = 0; s < length; s += 9) {
    if (rng() < 0.4) continue;
    put(s + rng() * 6, ROAD_HALF + 4.3 + rng() * 1.3, rng() < 0.5 ? 1 : -1, 'any', false);
  }

  const standGeo = personGeometry(false);
  const cheerGeo = personGeometry(true);
  const bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
  const headGeo = new THREE.SphereGeometry(0.115, 10, 8);
  headGeo.translate(0, 1.42, 0);
  const headMat = new THREE.MeshStandardMaterial({ roughness: 0.7 });

  for (const cheer of [false, true]) {
    const group = people.filter((p) => p.cheer === cheer);
    if (!group.length) continue;
    const bodies = new THREE.InstancedMesh(cheer ? cheerGeo : standGeo, bodyMat, group.length);
    const heads = new THREE.InstancedMesh(headGeo, headMat, group.length);
    bodies.frustumCulled = heads.frustumCulled = false;
    bodies.castShadow = true;
    group.forEach((p, i) => {
      dummy.position.set(p.x, 0, p.z);
      dummy.rotation.set(0, p.rot, 0);
      dummy.scale.set(p.h, p.h, p.h);
      dummy.updateMatrix();
      bodies.setMatrixAt(i, dummy.matrix);
      heads.setMatrixAt(i, dummy.matrix);
      bodies.setColorAt(i, color.setHex(p.clothes));
      heads.setColorAt(i, color.setHex(p.skin));
    });
    bodies.instanceColor.needsUpdate = true;
    heads.instanceColor.needsUpdate = true;
    scene.add(bodies, heads);
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
        ], 1 / 1.6, Math.max(8, Math.floor((b - a) / 3)), a, b));
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
}
