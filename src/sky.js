// Sky dome with analytic gradient + sun, sprite clouds. No textures from disk.
import * as THREE from 'three';
import { makeCloudTexture, mulberry32 } from './textures.js';

export const SUN_DIR = new THREE.Vector3(-0.55, 0.62, 0.35).normalize();

export function buildSky(scene) {
  const uniforms = {
    topColor: { value: new THREE.Color(0x3d74c9) },
    horizonColor: { value: new THREE.Color(0xdfe9f2) },
    hazeColor: { value: new THREE.Color(0xf5e6c8) },
    sunDir: { value: SUN_DIR },
  };
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(3600, 32, 16),
    new THREE.ShaderMaterial({
      uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: /* glsl */`
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */`
        uniform vec3 topColor, horizonColor, hazeColor, sunDir;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          float h = clamp(d.y, 0.0, 1.0);
          vec3 col = mix(horizonColor, topColor, pow(h, 0.58));
          float sd = clamp(dot(d, sunDir), 0.0, 1.0);
          // warm haze around the sun near the horizon
          col = mix(col, hazeColor, pow(sd, 3.0) * (1.0 - h) * 0.55);
          // sun disc + bloom
          col += vec3(1.0, 0.93, 0.82) * (pow(sd, 1400.0) * 1.6 + pow(sd, 24.0) * 0.22);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    })
  );
  sky.renderOrder = -10;
  scene.add(sky);

  // clouds
  const rng = mulberry32(909);
  const cloudTex = makeCloudTexture();
  for (let i = 0; i < 16; i++) {
    const mat = new THREE.SpriteMaterial({
      map: cloudTex, transparent: true, opacity: 0.55 + rng() * 0.35, fog: true,
      depthWrite: false,
    });
    const sp = new THREE.Sprite(mat);
    const a = rng() * Math.PI * 2;
    const r = 500 + rng() * 1900;
    sp.position.set(Math.cos(a) * r, 190 + rng() * 260 + r * 0.06, Math.sin(a) * r);
    const s = 260 + rng() * 420;
    sp.scale.set(s, s * 0.42, 1);
    scene.add(sp);
  }
  return sky;
}
