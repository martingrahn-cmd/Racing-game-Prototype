// Minimap: track outline with the player and traffic, bottom-left like the
// reference build. Pure 2D canvas — the path is cached once.
export function createMinimap(curve, length) {
  const el = document.getElementById('minimap');
  const ctx = el.getContext('2d');
  const S = el.width; // square canvas

  // fit the track into the canvas with some padding
  const pts = [];
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i <= 220; i++) {
    const p = curve.getPointAt(i / 220);
    pts.push(p);
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  }
  const pad = 14;
  const k = (S - pad * 2) / Math.max(maxX - minX, maxZ - minZ);
  const ox = (S - (maxX - minX) * k) / 2;
  const oz = (S - (maxZ - minZ) * k) / 2;
  const toX = (x) => ox + (x - minX) * k;
  const toY = (z) => S - (oz + (z - minZ) * k); // flip so north is up

  // cache the outline
  const bg = document.createElement('canvas');
  bg.width = bg.height = S;
  {
    const b = bg.getContext('2d');
    b.strokeStyle = 'rgba(255,255,255,0.75)';
    b.lineWidth = 3.5;
    b.lineJoin = 'round';
    b.beginPath();
    pts.forEach((p, i) => (i ? b.lineTo(toX(p.x), toY(p.z)) : b.moveTo(toX(p.x), toY(p.z))));
    b.closePath();
    b.stroke();
    // start/finish tick
    const p0 = pts[0], p1 = pts[2];
    b.strokeStyle = 'rgba(255,217,74,0.9)';
    b.lineWidth = 2;
    const dx = toX(p1.x) - toX(p0.x), dy = toY(p1.z) - toY(p0.z);
    const l = Math.hypot(dx, dy) || 1;
    b.beginPath();
    b.moveTo(toX(p0.x) - (dy / l) * 5, toY(p0.z) + (dx / l) * 5);
    b.lineTo(toX(p0.x) + (dy / l) * 5, toY(p0.z) - (dx / l) * 5);
    b.stroke();
  }

  return {
    update(carPos, yaw, trafficCars) {
      ctx.clearRect(0, 0, S, S);
      ctx.drawImage(bg, 0, 0);
      if (trafficCars) {
        ctx.fillStyle = 'rgba(200,205,215,0.8)';
        for (const c of trafficCars) {
          ctx.beginPath();
          ctx.arc(toX(c.group.position.x), toY(c.group.position.z), 2.1, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      // player: red arrow pointing along the heading
      const px = toX(carPos.x), py = toY(carPos.z);
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(yaw); // world yaw from +z; canvas clockwise with flipped y
      ctx.fillStyle = '#ff3b30';
      ctx.beginPath();
      ctx.moveTo(0, -6.5);
      ctx.lineTo(4.4, 5);
      ctx.lineTo(-4.4, 5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    },
  };
}
