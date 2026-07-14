// Open-world minimap + full map.
// - Corner minimap: a zoomed, heading-up view of the streets around the car —
//   the MAP rotates and the player arrow stays fixed pointing up (driving-game
//   convention), with the GPS route and an edge-clamped objective marker.
//   TAP IT (or press M) to open the full map.
// - Full map: the whole district as a north-up miniature — and the JOB BOARD:
//   open deliveries show as $-pins; tap one to take the mission (#114).
// The city itself (roads, district-tinted blocks, building footprints, the
// plaza with its fountain/pond/playground) is rendered ONCE into an offscreen
// canvas; per-frame work is one rotated blit + the dynamic overlays.
export function createWorldMap(model, missions) {
  const nodes = model.nodes;
  const lo = model.min - model.ROAD_HW, hi = model.max + model.ROAD_HW;
  const span = hi - lo || 1;
  const roadHW = model.ROAD_HW;
  const VIEW_R = 170;        // metres of world shown from centre to minimap edge

  // ---------------------------------------------------------- static city art
  // NOTE the mirrored x-axis: in this world, facing +z ("north"), the car's
  // RIGHT is world -x (turning right DECREASES yaw). A conventional east-right
  // map is therefore mirror-flipped against what the driver experiences —
  // "target to the right on the map" was actually to the LEFT (#113). Drawing
  // -x to the right makes map-right always match car-right.
  const BASE = 1024;
  const k0 = BASE / span;                    // base-canvas pixels per metre
  const bx = (wx) => (hi - wx) * k0;         // mirrored: -x to the right
  const by = (wz) => BASE - (wz - lo) * k0;  // north up
  const base = document.createElement('canvas');
  base.width = base.height = BASE;
  {
    const c = base.getContext('2d');
    c.fillStyle = '#161b22';                                   // ground
    c.fillRect(0, 0, BASE, BASE);
    // streets
    c.strokeStyle = '#3a4049';
    c.lineWidth = roadHW * 2 * k0;
    c.beginPath();
    for (const n of nodes) {
      c.moveTo(bx(n), by(lo)); c.lineTo(bx(n), by(hi));
      c.moveTo(bx(lo), by(n)); c.lineTo(bx(hi), by(n));
    }
    c.stroke();
    // centre-line dashes give the roads their "map" read
    c.strokeStyle = 'rgba(230,236,245,0.16)';
    c.lineWidth = Math.max(1, 0.5 * k0);
    c.setLineDash([4.4 * k0 * 2, 4.4 * k0 * 2]);
    c.beginPath();
    for (const n of nodes) {
      c.moveTo(bx(n), by(lo)); c.lineTo(bx(n), by(hi));
      c.moveTo(bx(lo), by(n)); c.lineTo(bx(hi), by(n));
    }
    c.stroke();
    c.setLineDash([]);

    const rect = (x0, z0, x1, z1, col) => {
      c.fillStyle = col;
      c.fillRect(Math.min(bx(x0), bx(x1)), Math.min(by(z0), by(z1)), Math.abs(bx(x1) - bx(x0)), Math.abs(by(z1) - by(z0)));
    };
    // blocks: sidewalk slab + district-tinted building footprints, so the map
    // is an honest miniature — towers in the middle, apartments ringing their
    // blocks, villas on green lots with houses along the street edges
    for (const b of model.buildings) {
      const s = b.slab;
      const vary = ((b.bi * 7 + b.bj * 13) % 5) * 0.012 - 0.024;
      const shade = (hex, d) => {
        const v = parseInt(hex.slice(1), 16);
        const f = (x) => Math.max(0, Math.min(255, Math.round(((v >> x) & 255) * (1 + d))));
        return `rgb(${f(16)},${f(8)},${f(0)})`;
      };
      if (b.category === 'finance') {
        rect(s.minX, s.minZ, s.maxX, s.maxZ, shade('#2b303a', vary));      // paved block
        rect(b.minX, b.minZ, b.maxX, b.maxZ, shade('#48586e', vary));      // tower footprint
      } else if (b.category === 'residential') {
        rect(s.minX, s.minZ, s.maxX, s.maxZ, shade('#3a3733', vary));      // paved block
        rect(b.minX, b.minZ, b.maxX, b.maxZ, shade('#57493f', vary));      // apartment ring
        const in2 = 9; // apartments line the edges; the courtyard sits inside
        rect(b.minX + in2, b.minZ + in2, b.maxX - in2, b.maxZ - in2, shade('#3a3733', vary));
      } else {
        rect(s.minX, s.minZ, s.maxX, s.maxZ, shade('#2f4633', vary));      // lawn lot
        // houses ring the street edges: a thin brick band, hollow centre
        rect(b.minX + 2, b.minZ + 2, b.maxX - 2, b.maxZ - 2, shade('#6b3f34', vary));
        rect(b.minX + 11, b.minZ + 11, b.maxX - 11, b.maxZ - 11, shade('#2f4633', vary));
      }
    }
    // the plaza park with its landmarks
    if (model.plaza) {
      const p = model.plaza;
      rect(p.minX, p.minZ, p.maxX, p.maxZ, '#2f5a3a');
      const dot = (wx, wz, rm, col) => { c.fillStyle = col; c.beginPath(); c.arc(bx(wx), by(wz), rm * k0, 0, Math.PI * 2); c.fill(); };
      c.strokeStyle = '#8a8069'; c.lineWidth = 2.8 * k0;                   // gravel ring + spurs
      c.beginPath(); c.arc(bx(p.cx), by(p.cz), 12 * k0, 0, Math.PI * 2); c.stroke();
      c.beginPath();
      for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        c.moveTo(bx(p.cx + ox * 12), by(p.cz + oz * 12));
        c.lineTo(bx(p.cx + ox * ((p.maxX - p.minX) / 2 - 2)), by(p.cz + oz * ((p.maxZ - p.minZ) / 2 - 2)));
      }
      c.stroke();
      dot(p.cx, p.cz, 6.4, '#b7b1a4'); dot(p.cx, p.cz, 5.6, '#3f7fa8');    // fountain
      dot(p.cx - 23, p.cz + 21, 6.6, '#3f7fa8');                           // pond
      rect(p.cx + 15 - 5.5, p.cz - 13 - 5.5, p.cx + 15 + 5.5, p.cz - 13 + 5.5, '#8a7a5a'); // playground
      dot(p.cx - 15, p.cz - 13, 3.6, '#e8e2d4');                           // gazebo
      rect(p.cx + 15 - 1.5, p.cz + 14 - 1.5, p.cx + 15 + 1.5, p.cz + 14 + 1.5, '#b9a894'); // clock tower
    }
  }

  // ---------------------------------------------------------- canvases
  const el = document.getElementById('minimap');
  el.style.display = 'block';
  el.style.borderRadius = '50%';   // heading-up map spins — keep it round
  el.style.pointerEvents = 'auto';
  el.style.cursor = 'pointer';
  const ctx = el.getContext('2d');

  const big = document.createElement('canvas');
  big.id = 'bigmap';
  big.width = big.height = 760;
  // above the objective HUD line (z 40) so the map header isn't overprinted,
  // below the dispatcher toast (z 42) so "leverera först" still shows
  big.style.cssText = 'position:fixed;inset:0;margin:auto;z-index:41;display:none;'
    + 'background:rgba(9,12,17,0.94);border:1px solid rgba(255,255,255,0.14);border-radius:14px;'
    + 'box-shadow:0 16px 60px rgba(0,0,0,0.6);pointer-events:none;max-width:90vw;max-height:84vh;';
  document.body.appendChild(big);
  const bctx = big.getContext('2d');
  // the big map's fixed world->px mapping (shared by drawing and tap hit-tests)
  const BS = big.width, BPAD = 40;
  const bk = (BS - BPAD * 2) / span;
  const BX = (wx) => BPAD + (hi - wx) * bk;   // mirrored to match the corner map
  const BY = (wz) => BS - (BPAD + (wz - lo) * bk);

  let bigOpen = false;
  function setBig(open) {
    bigOpen = open;
    big.style.display = open ? 'block' : 'none';
    big.style.pointerEvents = open ? 'auto' : 'none';
  }
  const typing = (e) => e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA');
  addEventListener('keydown', (e) => {
    if (typing(e)) return;
    if (e.code === 'KeyM') setBig(!bigOpen);
  });
  // tap the corner minimap to open the job board — the touch-first path
  el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); setBig(!bigOpen); });
  // taps on the big map: take a job, or close (✕ / anywhere else)
  big.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    const rect = big.getBoundingClientRect();
    const cx = (e.clientX - rect.left) * (big.width / rect.width);
    const cy = (e.clientY - rect.top) * (big.height / rect.height);
    if (cx > big.width - 70 && cy < 70) { setBig(false); return; }   // ✕
    if (missions) {
      const jb = missions.jobs();
      for (let i = 0; i < jb.length; i++) {
        if (jb[i].active) continue;
        const dx = cx - BX(jb[i].x), dy = cy - BY(jb[i].z);
        if (dx * dx + dy * dy < 34 * 34) {
          if (missions.select(i)) setBig(false);
          return;                              // carrying: stay open, dispatcher explains
        }
      }
    }
    setBig(false);
  });

  const nearestNode = (v) => {
    let bi = 0, bd = Infinity;
    for (let i = 0; i < nodes.length; i++) { const d = Math.abs(nodes[i] - v); if (d < bd) { bd = d; bi = i; } }
    return bi;
  };
  // route from the player to the target as a grid-following polyline (world coords)
  function route(from, to) {
    const gxp = nearestNode(from.x), gzp = nearestNode(from.z);
    const gxt = nearestNode(to.x), gzt = nearestNode(to.z);
    const pts = [
      [from.x, from.z],
      [nodes[gxp], nodes[gzp]],           // hop onto the grid
      [nodes[gxt], nodes[gzp]],           // run along a street
      [nodes[gxt], nodes[gzt]],           // turn up an avenue
      [to.x, to.z],
    ];
    const out = [];
    for (const p of pts) { const l = out[out.length - 1]; if (!l || Math.hypot(l[0] - p[0], l[1] - p[1]) > 1) out.push(p); }
    return out;
  }

  return {
    update(carPos, yaw, dbg) {
      const target = dbg && (dbg.state === 'idle' ? dbg.pickup : dbg.drop);
      const pickup = dbg && dbg.pickup, drop = dbg && dbg.drop;
      const routeCol = dbg && dbg.state === 'idle' ? 'rgba(53,208,127,0.95)' : 'rgba(255,160,48,0.95)';
      const r = target ? route(carPos, target) : null;

      // ---------------- corner minimap: heading-up, zoomed, round ----------------
      {
        const S = el.width;
        const ppm = (S / 2) / VIEW_R;             // screen px per metre
        ctx.clearRect(0, 0, S, S);
        ctx.save();
        ctx.beginPath(); ctx.arc(S / 2, S / 2, S / 2 - 1, 0, Math.PI * 2); ctx.clip();
        ctx.fillStyle = '#161b22'; ctx.fillRect(0, 0, S, S);
        ctx.translate(S / 2, S / 2);
        ctx.rotate(yaw);                          // heading up: rotate the world, not the arrow
        // world point -> px in this rotated frame (x mirrored, see above)
        const PX = (wx) => -(wx - carPos.x) * ppm;
        const PY = (wz) => -(wz - carPos.z) * ppm;
        // rotated blit of the pre-rendered city
        const s2 = ppm / k0;
        ctx.drawImage(base, -bx(carPos.x) * s2, -by(carPos.z) * s2, BASE * s2, BASE * s2);
        // route
        if (r) {
          ctx.strokeStyle = routeCol;
          ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
          ctx.setLineDash([8, 6]);
          ctx.beginPath();
          r.forEach((p, i) => (i ? ctx.lineTo(PX(p[0]), PY(p[1])) : ctx.moveTo(PX(p[0]), PY(p[1]))));
          ctx.stroke();
          ctx.setLineDash([]);
        }
        // markers — the active objective clamps to the rim so it always shows
        const maxM = (S / 2 - 9) / ppm;
        const dot = (p, col, rr, clamp) => {
          if (!p) return;
          let dx = p.x - carPos.x, dz = p.z - carPos.z;
          const d = Math.hypot(dx, dz);
          if (d > maxM) { if (!clamp) return; dx *= maxM / d; dz *= maxM / d; }
          ctx.fillStyle = col;
          ctx.beginPath(); ctx.arc(-dx * ppm, -dz * ppm, rr, 0, Math.PI * 2); ctx.fill();
        };
        dot(pickup, '#35d07f', 4.5, dbg && dbg.state === 'idle');
        dot(drop, '#ffa030', 4.5, dbg && dbg.state === 'carrying');
        // open jobs as faint pins, so you spot work while cruising
        if (missions) {
          const jb = missions.jobs();
          ctx.fillStyle = 'rgba(53,208,127,0.5)';
          for (const j of jb) {
            if (j.active) continue;
            const dx = j.x - carPos.x, dz = j.z - carPos.z;
            if (Math.hypot(dx, dz) > maxM) continue;
            ctx.beginPath(); ctx.arc(-dx * ppm, -dz * ppm, 3, 0, Math.PI * 2); ctx.fill();
          }
        }
        ctx.restore();
        // upright N at the rim, toward world north (rim angle follows the map spin)
        const nR = S / 2 - 10;
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.font = `bold ${Math.round(S * 0.085)}px "DejaVu Sans Mono",monospace`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('N', S / 2 + nR * Math.sin(yaw), S / 2 - nR * Math.cos(yaw));
        // fixed player arrow, always pointing up
        ctx.save();
        ctx.translate(S / 2, S / 2);
        ctx.fillStyle = '#ff3b30';
        ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(4.6, 5); ctx.lineTo(0, 2.6); ctx.lineTo(-4.6, 5); ctx.closePath();
        ctx.fill(); ctx.stroke();
        ctx.restore();
        // rim
        ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(S / 2, S / 2, S / 2 - 1, 0, Math.PI * 2); ctx.stroke();
      }

      // ---------------- full map: north-up city miniature + job board ----------------
      if (bigOpen) {
        bctx.clearRect(0, 0, BS, BS);
        bctx.drawImage(base, BPAD, BPAD, BS - BPAD * 2, BS - BPAD * 2);
        if (r) {
          bctx.strokeStyle = routeCol;
          bctx.lineWidth = 5; bctx.lineCap = 'round'; bctx.lineJoin = 'round';
          bctx.setLineDash([14, 10]);
          bctx.beginPath();
          r.forEach((p, i) => (i ? bctx.lineTo(BX(p[0]), BY(p[1])) : bctx.moveTo(BX(p[0]), BY(p[1]))));
          bctx.stroke();
          bctx.setLineDash([]);
        }
        const dot = (p, col, rr) => { if (!p) return; bctx.fillStyle = col; bctx.beginPath(); bctx.arc(BX(p.x), BY(p.z), rr, 0, Math.PI * 2); bctx.fill(); };
        dot(pickup, '#35d07f', 8);
        dot(drop, '#ffa030', 8);
        // the job board: open deliveries as tappable $-pins
        const carrying = missions && missions.state() === 'carrying';
        if (missions) {
          const jb = missions.jobs();
          bctx.textAlign = 'center';
          for (let i = 0; i < jb.length; i++) {
            if (jb[i].active) continue;              // the taken job is the route/beacon
            const x = BX(jb[i].x), y = BY(jb[i].z);
            bctx.globalAlpha = carrying ? 0.38 : 1;
            bctx.fillStyle = 'rgba(10,16,12,0.88)';
            bctx.beginPath(); bctx.arc(x, y, 17, 0, Math.PI * 2); bctx.fill();
            bctx.strokeStyle = '#35d07f'; bctx.lineWidth = 2.5;
            bctx.beginPath(); bctx.arc(x, y, 17, 0, Math.PI * 2); bctx.stroke();
            bctx.fillStyle = '#35d07f';
            bctx.font = 'bold 15px "DejaVu Sans Mono",monospace'; bctx.textBaseline = 'middle';
            bctx.fillText('📦', x, y + 1);
            bctx.font = 'bold 13px "DejaVu Sans Mono",monospace';
            bctx.fillStyle = '#c9f3da';
            bctx.fillText(`~$${jb[i].pay}`, x, y + 30);
            bctx.globalAlpha = 1;
          }
          bctx.textAlign = 'left';
        }
        // player arrow (north-up map -> the arrow itself rotates with the car;
        // negated yaw on the mirrored axis)
        bctx.save(); bctx.translate(BX(carPos.x), BY(carPos.z)); bctx.rotate(-yaw);
        bctx.fillStyle = '#ff3b30';
        bctx.strokeStyle = 'rgba(0,0,0,0.55)'; bctx.lineWidth = 2;
        bctx.beginPath(); bctx.moveTo(0, -12); bctx.lineTo(7.8, 8.5); bctx.lineTo(0, 4.4); bctx.lineTo(-7.8, 8.5); bctx.closePath();
        bctx.fill(); bctx.stroke();
        bctx.restore();
        // header + close ✕
        const choosing = missions && missions.state() === 'none';
        bctx.fillStyle = choosing ? '#35d07f' : 'rgba(255,255,255,0.9)';
        bctx.font = 'bold 22px "DejaVu Sans Mono",monospace';
        bctx.textAlign = 'left'; bctx.textBaseline = 'alphabetic';
        bctx.fillText(choosing ? 'VÄLJ UPPDRAG — TRYCK PÅ ETT 📦' : 'APEX CITY — KARTA', 40, 44);
        bctx.font = '14px "DejaVu Sans Mono",monospace';
        bctx.fillStyle = 'rgba(255,255,255,0.6)';
        bctx.fillText(carrying ? 'leverera till orange innan tiden går ut' : 'tryck på ett paket för att anta jobbet · ✕ stänger', 40, big.height - 30);
        bctx.strokeStyle = 'rgba(255,255,255,0.7)'; bctx.lineWidth = 2.5;
        bctx.beginPath(); bctx.arc(BS - 42, 42, 17, 0, Math.PI * 2); bctx.stroke();
        bctx.beginPath();
        bctx.moveTo(BS - 49, 35); bctx.lineTo(BS - 35, 49);
        bctx.moveTo(BS - 35, 35); bctx.lineTo(BS - 49, 49);
        bctx.stroke();
      }
    },
  };
}
