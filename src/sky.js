// Sky dome with analytic gradient + sun, sprite clouds. No textures from disk.
import * as THREE from 'three';
import { makeCloudTexture, mulberry32 } from './textures.js';
import { registerOpacity } from './night.js';

// Light direction used for shadows — mutated in place by the day/night cycle
// (sun by day, moon by night). The sky's own sun-disc direction is a uniform.
export const SUN_DIR = new THREE.Vector3(-0.55, 0.62, 0.35).normalize();

export function buildSky(scene) {
  const uniforms = {
    topColor: { value: new THREE.Color(0x3d74c9) },
    horizonColor: { value: new THREE.Color(0xdfe9f2) },
    hazeColor: { value: new THREE.Color(0xf5e6c8) },
    sunDir: { value: SUN_DIR.clone() },
    starAmt: { value: 0 },
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
          // pin the dome to the far plane: the mobile far plane sits at a few
          // hundred metres (#102) — far inside the 3600 m dome, which otherwise
          // clips away entirely (black sky, no stars). At max depth the sky
          // draws first and everything else covers it, whatever camera.far is.
          gl_Position.z = gl_Position.w * 0.99999;
        }
      `,
      fragmentShader: /* glsl */`
        uniform vec3 topColor, horizonColor, hazeColor, sunDir;
        uniform float starAmt;
        varying vec3 vDir;

        float hash3(vec3 v) {
          return fract(sin(dot(v, vec3(12.9898, 78.233, 45.164))) * 43758.5453);
        }

        void main() {
          vec3 d = normalize(vDir);
          float h = clamp(d.y, 0.0, 1.0);
          vec3 col = mix(horizonColor, topColor, pow(h, 0.58));
          float sd = clamp(dot(d, sunDir), 0.0, 1.0);
          // warm haze around the sun near the horizon
          col = mix(col, hazeColor, pow(sd, 3.0) * (1.0 - h) * 0.55);
          // sun disc + bloom
          col += vec3(1.0, 0.93, 0.82) * (pow(sd, 1400.0) * 1.6 + pow(sd, 24.0) * 0.22);

          // night: stars + a soft galactic band
          if (starAmt > 0.001) {
            float horizonMask = smoothstep(0.03, 0.22, d.y);
            vec3 bandN = normalize(vec3(0.35, 0.42, 0.84));
            float band = exp(-pow(dot(d, bandN) * 3.2, 2.0));
            vec3 cell = floor(d * 240.0);
            float hh = hash3(cell);
            float star = smoothstep(0.9965 - band * 0.006, 1.0, hh);
            float tint = hash3(cell + 7.0);
            vec3 starCol = mix(vec3(0.75, 0.82, 1.0), vec3(1.0, 0.92, 0.8), tint);
            col += (star * starCol * (0.55 + 0.45 * hash3(cell + 13.0))
                    + band * vec3(0.10, 0.11, 0.16)) * starAmt * horizonMask;
          }
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
      map: cloudTex, transparent: true, fog: true,
      depthWrite: false,
    });
    registerOpacity(mat, 0.55 + rng() * 0.35, 0.08); // clouds fade at night
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
