// Post-processing without addons: HDR scene target (MSAA) → bright-pass →
// separable blur → composite (speed blur, chromatic aberration, bloom,
// ACES tonemap, color grade, vignette, grain). This pass is most of the
// difference between "PS2" and "PS3/PS4" in the final image.
import * as THREE from 'three';

const QUAD_VERT = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const BRIGHT_FRAG = /* glsl */`
  uniform sampler2D tDiffuse;
  uniform float threshold;
  varying vec2 vUv;
  void main() {
    vec3 c = texture2D(tDiffuse, vUv).rgb;
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    gl_FragColor = vec4(c * smoothstep(threshold, threshold + 0.6, l), 1.0);
  }
`;

const BLUR_FRAG = /* glsl */`
  uniform sampler2D tDiffuse;
  uniform vec2 direction;
  uniform vec2 resolution;
  varying vec2 vUv;
  void main() {
    vec2 off = direction / resolution;
    vec3 c = texture2D(tDiffuse, vUv).rgb * 0.227027;
    c += texture2D(tDiffuse, vUv + off * 1.3846).rgb * 0.3162162;
    c += texture2D(tDiffuse, vUv - off * 1.3846).rgb * 0.3162162;
    c += texture2D(tDiffuse, vUv + off * 3.2308).rgb * 0.0702703;
    c += texture2D(tDiffuse, vUv - off * 3.2308).rgb * 0.0702703;
    gl_FragColor = vec4(c, 1.0);
  }
`;

const COMPOSITE_FRAG = /* glsl */`
  uniform sampler2D tDiffuse;
  uniform sampler2D tBloom;
  uniform float bloomStrength;
  uniform float exposure;
  uniform float speedBlur;   // 0..1
  uniform float time;
  varying vec2 vUv;

  vec3 aces(vec3 x) {
    return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
  }
  vec3 toSRGB(vec3 c) {
    return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
  }

  void main() {
    vec2 toC = vUv - 0.5;
    float r = length(toC);

    // radial motion blur, stronger at edges and with speed
    float amt = speedBlur * 0.055 * smoothstep(0.12, 0.75, r);
    vec3 col = vec3(0.0);
    float wsum = 0.0;
    for (int i = 0; i < 5; i++) {
      float w = 1.0 - float(i) * 0.16;
      col += texture2D(tDiffuse, vUv - toC * amt * float(i) * 0.25).rgb * w;
      wsum += w;
    }
    col /= wsum;

    // subtle chromatic aberration at frame edges
    float ca = (0.0012 + speedBlur * 0.0016) * smoothstep(0.2, 0.72, r);
    col.r = texture2D(tDiffuse, vUv - toC * ca * 2.0).r * 0.5 + col.r * 0.5;
    col.b = texture2D(tDiffuse, vUv + toC * ca * 2.0).b * 0.5 + col.b * 0.5;

    col += texture2D(tBloom, vUv).rgb * bloomStrength;

    col *= exposure;
    col = aces(col);

    // grade: slight teal shadows / warm highlights, saturation, contrast
    float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col += vec3(-0.002, 0.002, 0.005) * (1.0 - luma);
    col += vec3(0.012, 0.005, -0.006) * luma;
    col = mix(vec3(luma), col, 1.04);
    col = (col - 0.5) * 1.04 + 0.5;

    // vignette
    col *= 1.0 - 0.27 * smoothstep(0.42, 0.98, r * 1.35);

    // film grain
    float n = fract(sin(dot(gl_FragCoord.xy + mod(time * 60.0, 997.0), vec2(12.9898, 78.233))) * 43758.5453);
    col += (n - 0.5) * 0.016;

    gl_FragColor = vec4(toSRGB(clamp(col, 0.0, 1.0)), 1.0);
  }
`;

export function createPost(renderer) {
  if (!renderer.capabilities.isWebGL2) return null;

  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quadScene = new THREE.Scene();
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
  quadScene.add(quad);

  const opts = { type: THREE.HalfFloatType, depthBuffer: true, samples: 4 };
  let sceneRT = new THREE.WebGLRenderTarget(2, 2, opts);
  let bloomA = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType });
  let bloomB = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType });

  const brightMat = new THREE.ShaderMaterial({
    vertexShader: QUAD_VERT, fragmentShader: BRIGHT_FRAG,
    uniforms: { tDiffuse: { value: null }, threshold: { value: 1.12 } },
    depthTest: false, depthWrite: false,
  });
  const blurMat = new THREE.ShaderMaterial({
    vertexShader: QUAD_VERT, fragmentShader: BLUR_FRAG,
    uniforms: { tDiffuse: { value: null }, direction: { value: new THREE.Vector2(1, 0) }, resolution: { value: new THREE.Vector2(1, 1) } },
    depthTest: false, depthWrite: false,
  });
  const compMat = new THREE.ShaderMaterial({
    vertexShader: QUAD_VERT, fragmentShader: COMPOSITE_FRAG,
    uniforms: {
      tDiffuse: { value: null }, tBloom: { value: null },
      bloomStrength: { value: 0.85 }, exposure: { value: 1.22 },
      speedBlur: { value: 0 }, time: { value: 0 },
    },
    depthTest: false, depthWrite: false,
  });

  function setSize(w, h, pr) {
    const pw = Math.floor(w * pr), ph = Math.floor(h * pr);
    sceneRT.setSize(pw, ph);
    bloomA.setSize(pw >> 2, ph >> 2);
    bloomB.setSize(pw >> 2, ph >> 2);
    blurMat.uniforms.resolution.value.set(pw >> 2, ph >> 2);
  }

  function render(scene, camera, speedBlur, time) {
    renderer.setRenderTarget(sceneRT);
    renderer.render(scene, camera);

    quad.material = brightMat;
    brightMat.uniforms.tDiffuse.value = sceneRT.texture;
    renderer.setRenderTarget(bloomA);
    renderer.render(quadScene, quadCam);

    quad.material = blurMat;
    blurMat.uniforms.tDiffuse.value = bloomA.texture;
    blurMat.uniforms.direction.value.set(1, 0);
    renderer.setRenderTarget(bloomB);
    renderer.render(quadScene, quadCam);

    blurMat.uniforms.tDiffuse.value = bloomB.texture;
    blurMat.uniforms.direction.value.set(0, 1);
    renderer.setRenderTarget(bloomA);
    renderer.render(quadScene, quadCam);

    quad.material = compMat;
    compMat.uniforms.tDiffuse.value = sceneRT.texture;
    compMat.uniforms.tBloom.value = bloomA.texture;
    compMat.uniforms.speedBlur.value = speedBlur;
    compMat.uniforms.time.value = time;
    renderer.setRenderTarget(null);
    renderer.render(quadScene, quadCam);
  }

  function dispose() {
    sceneRT.dispose(); bloomA.dispose(); bloomB.dispose();
  }

  return { render, setSize, dispose, uniforms: compMat.uniforms };
}
