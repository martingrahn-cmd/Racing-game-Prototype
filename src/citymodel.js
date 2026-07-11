// City model — the data spine of the open world. No geometry here, just
// numbers: everything (roads, sidewalks, buildings, colliders, signals,
// traffic, pedestrians) is generated from this description so the world stays
// consistent when the model changes.
//
// Phase 1 = the vertical slice: one 4-way intersection at the origin with four
// corner blocks, sized so it tiles into the full grid later.

const ROAD_HW = 7;        // road half-width → 14 m two-lane street
const LANE = 3.5;         // lane centre offset (right-hand traffic)
const SIDEWALK = 4.5;     // sidewalk depth between curb and building
const CURB_Y = 0.18;      // curb / sidewalk height
const BLOCK_OUT = 52;     // block outer extent from centre
const ROAD_LEN = 62;      // how far the streets run out of the slice

const KINDS = ['glass', 'ribbon', 'residential', 'glass'];

export function createSliceModel() {
  const inner = ROAD_HW + SIDEWALK;   // 11.5 — building footprint starts here
  const outer = BLOCK_OUT - 2;        // small margin on the far sides

  // four corner blocks, one per quadrant
  const quads = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  const buildings = quads.map(([sx, sz], i) => ({
    minX: sx > 0 ? inner : -outer,
    maxX: sx > 0 ? outer : -inner,
    minZ: sz > 0 ? inner : -outer,
    maxZ: sz > 0 ? outer : -inner,
    height: 22 + ((i * 7) % 4) * 7 + (i === 0 ? 20 : 0), // one taller signature tower
    kind: KINDS[i],
  }));

  // raised sidewalk slabs fill the whole corner between the road cross and the
  // block edge; the building sits on top with a sidewalk margin around it
  const sidewalks = quads.map(([sx, sz]) => ({
    minX: sx > 0 ? ROAD_HW : -BLOCK_OUT,
    maxX: sx > 0 ? BLOCK_OUT : -ROAD_HW,
    minZ: sz > 0 ? ROAD_HW : -BLOCK_OUT,
    maxZ: sz > 0 ? BLOCK_OUT : -ROAD_HW,
  }));

  // distant filler silhouettes so the streets read as a city, not a void
  const filler = [];
  for (const [sx, sz] of quads) {
    for (let k = 0; k < 3; k++) {
      const along = 74 + k * 26;
      filler.push({ x: sx * (ROAD_HW + 16 + k * 4), z: sz * along, w: 22, d: 20, h: 26 + ((k * 13) % 30) });
      filler.push({ x: sx * along, z: sz * (ROAD_HW + 16 + k * 4), w: 20, d: 22, h: 30 + ((k * 7) % 26) });
    }
  }

  return {
    ROAD_HW, LANE, SIDEWALK, CURB_Y, BLOCK_OUT, ROAD_LEN,
    intersection: { x: 0, z: 0 },
    buildings,
    sidewalks,
    filler,
    signals: { greenSec: 8, yellowSec: 2.2, allRedSec: 1.2 },
    // start on the southern approach, right lane, facing north (+z)
    spawn: { pos: [-LANE, 0, -34], yaw: 0 },
  };
}
