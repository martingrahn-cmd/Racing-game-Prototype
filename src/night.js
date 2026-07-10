// Registry for everything that reacts to nightfall. Modules register their
// materials/lights at build time; the day/night controller applies a single
// "dayness" factor (1 = noon, 0 = midnight) every frame.

const emissives = []; // {mat, day, night}
const opacities = []; // {mat, day, night}
const lights = [];    // {light, day, night}

export function registerEmissive(mat, day, night) {
  emissives.push({ mat, day, night });
  mat.emissiveIntensity = day;
}

export function registerOpacity(mat, day, night) {
  opacities.push({ mat, day, night });
  mat.opacity = day;
}

export function registerLight(light, day, night) {
  lights.push({ light, day, night });
  light.intensity = day;
}

// nightScale lets a global slider (e.g. headlight intensity) scale a group
export function applyDayness(d) {
  const n = 1 - d;
  for (const e of emissives) e.mat.emissiveIntensity = e.day * d + e.night * n;
  for (const o of opacities) o.mat.opacity = o.day * d + o.night * n;
  for (const l of lights) l.light.intensity = l.day * d + l.night * n;
}
