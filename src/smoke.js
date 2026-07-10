// Tire smoke: a pooled point-sprite system. Particles spawn at the rear
// wheels while the tires slip, drift up and sideways, expand and fade.
import * as THREE from 'three';

const POOL = 160;

function makeSmokeTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  return t;
}

export function createSmoke(scene) {
  const positions = new Float32Array(POOL * 3);
  const sizes = new Float32Array(POOL);
  const alphas = new Float32Array(POOL);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6); // skip culling math

  const mat = new THREE.ShaderMaterial({
    uniforms: { tMap: { value: makeSmokeTexture() } },
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */`
      attribute float aSize;
      attribute float aAlpha;
      varying float vAlpha;
      void main() {
        vAlpha = aAlpha;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = min(aSize * (280.0 / max(1.0, -mv.z)), 110.0);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */`
      uniform sampler2D tMap;
      varying float vAlpha;
      void main() {
        vec4 c = texture2D(tMap, gl_PointCoord);
        // fixed smoke tint so tone mapping doesn't blow it out
        gl_FragColor = vec4(vec3(0.82, 0.82, 0.84), c.a * vAlpha);
        if (gl_FragColor.a < 0.01) discard;
      }
    `,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 5;
  scene.add(points);

  const parts = [];
  for (let i = 0; i < POOL; i++) {
    parts.push({ life: 0, age: 1, pos: new THREE.Vector3(0, -100, 0), vel: new THREE.Vector3(), size: 1 });
  }
  let cursor = 0;
  let spawnAcc = 0;

  const right = new THREE.Vector3();

  return {
    // st from drive.update; spawns while slipping (or hard launch)
    update(dt, st) {
      if (st) {
        const slip = Math.max(0, st.slip - 2.0);
        const burnout = st.throttle > 0.6 && st.speed < 7 ? 1.6 : 0;
        const rate = Math.min(slip * 9, 55) + burnout * 26;
        spawnAcc += rate * dt;
        right.set(st.heading.z, 0, -st.heading.x);
        while (spawnAcc >= 1) {
          spawnAcc -= 1;
          const p = parts[cursor];
          cursor = (cursor + 1) % POOL;
          const side = Math.random() < 0.5 ? -1 : 1;
          p.pos.copy(st.pos)
            .addScaledVector(st.heading, -1.35)
            .addScaledVector(right, side * 0.8);
          p.pos.y = 0.25;
          p.vel.set((Math.random() - 0.5) * 1.2, 0.9 + Math.random() * 0.9, (Math.random() - 0.5) * 1.2)
            .addScaledVector(right, side * 0.7)
            .addScaledVector(st.heading, -st.speed * 0.12);
          p.life = 0.7 + Math.random() * 0.5;
          p.age = 0;
          p.size = 0.5 + Math.random() * 0.5;
        }
      }
      for (let i = 0; i < POOL; i++) {
        const p = parts[i];
        if (p.age < p.life) {
          p.age += dt;
          p.pos.addScaledVector(p.vel, dt);
          p.vel.multiplyScalar(Math.max(0, 1 - dt * 1.6));
          const k = p.age / p.life;
          sizes[i] = (p.size + k * 2.4) * 2.2;
          alphas[i] = 0.4 * (1 - k) * Math.min(1, k * 8);
          positions[i * 3] = p.pos.x;
          positions[i * 3 + 1] = p.pos.y;
          positions[i * 3 + 2] = p.pos.z;
        } else {
          alphas[i] = 0;
        }
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.aSize.needsUpdate = true;
      geo.attributes.aAlpha.needsUpdate = true;
    },
  };
}
