// Dynamic tire marks: while the rear tires slip (drift, burnout, lockup)
// dark quads are laid down behind each rear wheel into a ring buffer and
// slowly fade. Cheap: one draw call, fixed memory.
import * as THREE from 'three';

const MAX_QUADS = 1100;
const TIRE_W = 0.15;
const SEG_LEN = 0.4;

export function createSkidmarks(scene) {
  const positions = new Float32Array(MAX_QUADS * 4 * 3);
  const alphas = new Float32Array(MAX_QUADS * 4);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
  const idx = new Uint32Array(MAX_QUADS * 6);
  for (let q = 0; q < MAX_QUADS; q++) {
    const v = q * 4, i = q * 6;
    idx[i] = v; idx[i + 1] = v + 2; idx[i + 2] = v + 1;
    idx[i + 3] = v + 1; idx[i + 4] = v + 2; idx[i + 5] = v + 3;
  }
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    vertexShader: /* glsl */`
      attribute float aAlpha;
      varying float vAlpha;
      void main() {
        vAlpha = aAlpha;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      varying float vAlpha;
      void main() {
        if (vAlpha < 0.01) discard;
        gl_FragColor = vec4(0.05, 0.05, 0.06, vAlpha);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  scene.add(mesh);

  let cursor = 0;
  const last = [null, null]; // per rear wheel: {c: Vector3, l: Vector3, r: Vector3}
  const c = new THREE.Vector3(), right = new THREE.Vector3();
  const segDir = new THREE.Vector3(), perp = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);

  function emit(prev, cur) {
    const v = cursor * 4;
    positions.set([
      prev.l.x, prev.l.y, prev.l.z,
      prev.r.x, prev.r.y, prev.r.z,
      cur.l.x, cur.l.y, cur.l.z,
      cur.r.x, cur.r.y, cur.r.z,
    ], v * 3);
    alphas[v] = alphas[v + 1] = alphas[v + 2] = alphas[v + 3] = 0.55;
    cursor = (cursor + 1) % MAX_QUADS;
  }

  return {
    update(dt, st) {
      const marking = st && (st.slip > 2.4 || (st.throttle > 0.6 && st.speed < 7));
      if (marking) {
        right.set(-st.heading.z, 0, st.heading.x);
        for (const side of [0, 1]) {
          c.copy(st.pos)
            .addScaledVector(st.heading, -1.35)
            .addScaledVector(right, side === 0 ? -0.8 : 0.8);
          c.y = 0.04;
          const prev = last[side];
          if (!prev) {
            last[side] = { c: c.clone(), l: c.clone(), r: c.clone() };
            continue;
          }
          segDir.subVectors(c, prev.c);
          if (segDir.lengthSq() < SEG_LEN * SEG_LEN) continue;
          if (segDir.lengthSq() > 25) { last[side] = null; continue; } // teleport/reset
          perp.crossVectors(UP, segDir).normalize().multiplyScalar(TIRE_W / 2);
          const cur = {
            c: c.clone(),
            l: c.clone().add(perp),
            r: c.clone().sub(perp),
          };
          // first segment of a fresh streak: align the start edge too
          if (prev.l.equals(prev.c)) {
            prev.l.copy(prev.c).add(perp);
            prev.r.copy(prev.c).sub(perp);
          }
          emit(prev, cur);
          last[side] = cur;
        }
      } else {
        last[0] = last[1] = null;
      }

      // slow fade — old rubber stays visible ~25 s
      let dirty = marking;
      for (let i = 0; i < alphas.length; i += 4) {
        if (alphas[i] > 0) {
          const a = Math.max(0, alphas[i] - 0.022 * dt);
          alphas[i] = alphas[i + 1] = alphas[i + 2] = alphas[i + 3] = a;
          dirty = true;
        }
      }
      if (dirty) {
        geo.attributes.position.needsUpdate = true;
        geo.attributes.aAlpha.needsUpdate = true;
      }
    },
  };
}
