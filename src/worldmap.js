// Open-world minimap + full map (press M). North-up, whole-district street grid
// with the player arrow, the pickup/drop markers, and a GPS-style route drawn
// along the grid toward the current objective. Pure 2D canvas.
export function createWorldMap(model) {
  const nodes = model.nodes;
  const lo = model.min - model.ROAD_HW, hi = model.max + model.ROAD_HW;
  const span = hi - lo || 1;
  const roadHW = model.ROAD_HW;

  // corner minimap reuses the existing round canvas
  const el = document.getElementById('minimap');
  el.style.display = 'block';
  el.style.borderRadius = '14px'; // square-ish so the grid corners aren't clipped
  const ctx = el.getContext('2d');

  // full-screen map overlay, toggled with M
  const big = document.createElement('canvas');
  big.width = big.height = 760;
  big.style.cssText = 'position:fixed;inset:0;margin:auto;z-index:19;display:none;'
    + 'background:rgba(9,12,17,0.94);border:1px solid rgba(255,255,255,0.14);border-radius:14px;'
    + 'box-shadow:0 16px 60px rgba(0,0,0,0.6);pointer-events:none;max-width:90vw;max-height:84vh;';
  document.body.appendChild(big);
  const bctx = big.getContext('2d');
  let bigOpen = false;
  const typing = (e) => e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA');
  addEventListener('keydown', (e) => {
    if (typing(e)) return;
    if (e.code === 'KeyM') { bigOpen = !bigOpen; big.style.display = bigOpen ? 'block' : 'none'; }
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
    // drop consecutive duplicates
    const out = [];
    for (const p of pts) { const l = out[out.length - 1]; if (!l || Math.hypot(l[0] - p[0], l[1] - p[1]) > 1) out.push(p); }
    return out;
  }

  function draw(c, S, pad) {
    const k = (S - pad * 2) / span;
    const X = (wx) => pad + (wx - lo) * k;
    const Y = (wz) => S - (pad + (wz - lo) * k); // north up
    c.clearRect(0, 0, S, S);

    // block fills (everything that isn't road) for a city-map look
    c.fillStyle = 'rgba(120,132,150,0.16)';
    for (let i = 0; i < nodes.length - 1; i++) {
      for (let j = 0; j < nodes.length - 1; j++) {
        const x0 = X(nodes[i] + roadHW), x1 = X(nodes[i + 1] - roadHW);
        const y0 = Y(nodes[j] + roadHW), y1 = Y(nodes[j + 1] - roadHW);
        c.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
      }
    }
    // plaza in green
    if (model.plaza) {
      const p = model.plaza;
      const x0 = X(p.minX), x1 = X(p.maxX), y0 = Y(p.minZ), y1 = Y(p.maxZ);
      c.fillStyle = 'rgba(74,140,70,0.5)';
      c.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
    }
    // streets: the grid lines
    c.strokeStyle = 'rgba(230,236,245,0.28)';
    c.lineWidth = Math.max(1.5, roadHW * k * 0.9);
    c.beginPath();
    for (const n of nodes) { c.moveTo(X(n), Y(lo)); c.lineTo(X(n), Y(hi)); c.moveTo(X(lo), Y(n)); c.lineTo(X(hi), Y(n)); }
    c.stroke();
    return { X, Y };
  }

  let lastRoute = null, lastTarget = null;

  return {
    update(carPos, yaw, dbg) {
      // recompute the route occasionally toward the active objective
      const target = dbg && (dbg.state === 'idle' ? dbg.pickup : dbg.drop);
      const both = { pickup: dbg && dbg.pickup, drop: dbg && dbg.drop, state: dbg && dbg.state };

      const paint = (c, S, pad, big) => {
        const { X, Y } = draw(c, S, pad);
        // route to the objective
        if (target) {
          const r = route(carPos, target);
          c.strokeStyle = dbg.state === 'idle' ? 'rgba(53,208,127,0.95)' : 'rgba(255,160,48,0.95)';
          c.lineWidth = big ? 5 : 3;
          c.lineCap = 'round'; c.lineJoin = 'round';
          c.setLineDash(big ? [14, 10] : [8, 6]);
          c.beginPath();
          r.forEach((p, i) => (i ? c.lineTo(X(p[0]), Y(p[1])) : c.moveTo(X(p[0]), Y(p[1]))));
          c.stroke();
          c.setLineDash([]);
        }
        // markers
        const dot = (p, col, rr) => { if (!p) return; c.fillStyle = col; c.beginPath(); c.arc(X(p.x), Y(p.z), rr, 0, Math.PI * 2); c.fill(); };
        dot(both.pickup, '#35d07f', big ? 8 : 4.5);
        dot(both.drop, '#ffa030', big ? 8 : 4.5);
        // player arrow
        const px = X(carPos.x), py = Y(carPos.z);
        c.save(); c.translate(px, py); c.rotate(yaw);
        c.fillStyle = '#ff3b30';
        const s = big ? 1.7 : 1;
        c.beginPath(); c.moveTo(0, -7 * s); c.lineTo(4.6 * s, 5 * s); c.lineTo(-4.6 * s, 5 * s); c.closePath(); c.fill();
        c.restore();
      };

      paint(ctx, el.width, 12, false);
      if (bigOpen) {
        paint(bctx, big.width, 40, true);
        bctx.fillStyle = 'rgba(255,255,255,0.9)';
        bctx.font = 'bold 22px "DejaVu Sans Mono",monospace';
        bctx.fillText('APEX CITY — KARTA', 40, 44);
        bctx.font = '14px "DejaVu Sans Mono",monospace';
        bctx.fillStyle = 'rgba(255,255,255,0.6)';
        bctx.fillText('M för att stänga · grön = hämta · orange = lämna', 40, big.height - 30);
      }
    },
  };
}
