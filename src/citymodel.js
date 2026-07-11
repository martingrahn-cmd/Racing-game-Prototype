// City model — the data spine of the open world. No geometry here, just
// numbers: everything (roads, sidewalks, buildings, colliders, signals) is
// generated from this so the world stays consistent when the model changes.
//
// Phase 2 = the district: a BLOCKS×BLOCKS grid of city blocks separated by a
// street grid, with a central plaza. Sized to ~500 m and designed to tile
// further into neighbouring districts later.

const ROAD_HW = 7;        // road half-width → 14 m two-lane street
const LANE = 3.5;         // lane centre offset (right-hand traffic)
const SIDEWALK = 4.5;     // sidewalk depth between curb and building
const CURB_Y = 0.18;      // curb / sidewalk height
const PITCH = 100;        // spacing between intersections
const BLOCKS = 5;         // blocks per axis (odd → a true centre block for the plaza)

const KINDS = ['glass', 'ribbon', 'glass', 'residential', 'glass'];

export function createCityModel() {
  const half = BLOCKS / 2;
  const nodes = [];
  for (let i = 0; i <= BLOCKS; i++) nodes.push(Math.round((i - half) * PITCH));
  const min = nodes[0], max = nodes[nodes.length - 1];

  // intersections at every grid node; signalise the interior ones (the
  // perimeter nodes are the district edge)
  const intersections = [];
  const signalized = [];
  for (let i = 0; i <= BLOCKS; i++) {
    for (let j = 0; j <= BLOCKS; j++) {
      const it = { x: nodes[i], z: nodes[j], i, j };
      intersections.push(it);
      if (i >= 1 && i <= BLOCKS - 1 && j >= 1 && j <= BLOCKS - 1) signalized.push(it);
    }
  }

  // blocks: one building per block, except the central block which is a plaza
  const mid = (BLOCKS - 1) / 2; // block index of the centre (BLOCKS odd → integer)
  const buildings = [];
  let plaza = null;
  for (let bi = 0; bi < BLOCKS; bi++) {
    for (let bj = 0; bj < BLOCKS; bj++) {
      const x0 = nodes[bi] + ROAD_HW, x1 = nodes[bi + 1] - ROAD_HW;
      const z0 = nodes[bj] + ROAD_HW, z1 = nodes[bj + 1] - ROAD_HW;
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      const slab = { minX: x0, maxX: x1, minZ: z0, maxZ: z1 };
      if (bi === mid && bj === mid) { plaza = { ...slab, cx, cz }; continue; }
      const kind = KINDS[(bi * 3 + bj) % KINDS.length];
      // deterministic height variety, with the occasional signature tower
      const r = (bi * 7 + bj * 13) % 5;
      const tall = (bi + bj) % 3 === 0;
      const height = 26 + r * 8 + (tall ? 34 : 0);
      buildings.push({
        minX: x0 + SIDEWALK, maxX: x1 - SIDEWALK,
        minZ: z0 + SIDEWALK, maxZ: z1 - SIDEWALK,
        slab, height, kind, cx, cz,
      });
    }
  }

  const sx = nodes[mid] - LANE;                 // right lane of a central vertical street
  const sz = (nodes[0] + nodes[1]) / 2;         // a couple of blocks south, facing in

  return {
    ROAD_HW, LANE, SIDEWALK, CURB_Y, PITCH, BLOCKS,
    nodes, min, max,
    intersections, signalized,
    buildings, plaza,
    spawn: { pos: [sx, 0, sz], yaw: 0 },
  };
}
