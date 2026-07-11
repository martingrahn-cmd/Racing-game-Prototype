// Static collision for free-roam driving. Buildings are hard axis-aligned
// boxes (the car is pushed out and its inward speed killed); the curb / corner
// sidewalks are a soft boundary that gently pushes the car back toward the road
// and scrubs speed, so you can bump up onto a sidewalk but it resists.
//
// Broadphase is brute force for the single-intersection slice; the same
// resolve() shape will sit behind a grid lookup once the city tiles.

export function createCollision(model, colliders) {
  const roadHalf = model.ROAD_HW;
  const buildings = colliders.buildings;
  const obstacles = colliders.obstacles || []; // knockable street furniture (poles, bollards)
  const nodes = model.nodes || [0];             // street-grid centrelines
  const min = model.min ?? -roadHalf, max = model.max ?? roadHalf;

  function nearRoad(v) { // distance to the nearest street centreline
    let best = Infinity;
    for (const n of nodes) { const dd = Math.abs(v - n); if (dd < best) best = dd; }
    return best;
  }
  function isRoad(x, z) {
    return nearRoad(x) <= roadHalf || nearRoad(z) <= roadHalf;
  }

  // mutates pos and vel; returns feedback flags
  function resolve(pos, radius, vel) {
    let onCurb = false, hitHard = false, knocked = false;

    // knockable furniture: drive it down (once) and let the car through
    for (const o of obstacles) {
      if (o.knocked) continue;
      const dx = pos.x - o.x, dz = pos.z - o.z;
      const rr = radius + o.r;
      if (dx * dx + dz * dz < rr * rr) { o.knocked = true; o.knock(); knocked = true; }
    }

    // curb: inside the district but off every street → up on a block sidewalk.
    // Mountable (no push-back here) — the driving code adds the jolt/scrub and
    // raises the car onto the curb; buildings below still hard-stop it.
    const inDistrict = pos.x > min - roadHalf && pos.x < max + roadHalf
      && pos.z > min - roadHalf && pos.z < max + roadHalf;
    if (inDistrict && !isRoad(pos.x, pos.z)) onCurb = true;

    // hard buildings: circle vs AABB push-out
    for (const b of buildings) {
      const cx = Math.max(b.minX, Math.min(pos.x, b.maxX));
      const cz = Math.max(b.minZ, Math.min(pos.z, b.maxZ));
      const dx = pos.x - cx, dz = pos.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= radius * radius) continue;
      hitHard = true;
      let nx, nz, push;
      if (d2 > 1e-6) {
        const d = Math.sqrt(d2);
        nx = dx / d; nz = dz / d; push = radius - d;
      } else {
        // centre inside the box — eject along the nearest face
        const dl = pos.x - b.minX, dr = b.maxX - pos.x;
        const db = pos.z - b.minZ, dt = b.maxZ - pos.z;
        const m = Math.min(dl, dr, db, dt);
        if (m === dl) { nx = -1; nz = 0; } else if (m === dr) { nx = 1; nz = 0; }
        else if (m === db) { nx = 0; nz = -1; } else { nx = 0; nz = 1; }
        push = radius + m;
      }
      pos.x += nx * push; pos.z += nz * push;
      const vn = vel.x * nx + vel.z * nz;
      if (vn < 0) { vel.x -= vn * nx; vel.z -= vn * nz; }
    }

    return { onCurb, hitHard, knocked };
  }

  return { resolve, isRoad };
}
