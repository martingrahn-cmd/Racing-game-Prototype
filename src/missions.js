// Package-delivery game loop with a light "shady dispatcher" story arc.
// Pick up a package (green beacon), deliver it to the drop (orange beacon)
// before the timer runs out, chain runs for cash. Jumps and drifts build a
// STYLE multiplier that pads the payout — so the crazy driving IS the reward.
import * as THREE from 'three';

const PICKUP_R = 6, DROP_R = 6.5;
const PICKUP_KMH = 12;   // must be nearly stopped in the ring to grab the package
const BASE_PAY = 150;

// dispatcher beats, keyed by how many deliveries you've completed
const DISPATCH = [
  [0, 'DISPATCH: Ny i stan? Kör paket åt mig så rullar stålarna in. Ta det gröna.'],
  [1, 'DISPATCH: Snyggt. Nästa kund är lite... känsligare. Inga frågor, bara kör.'],
  [3, 'DISPATCH: Bra bud är svåra att hitta. Håll dig undan snuten — det här är inte choklad.'],
  [6, 'DISPATCH: Du börjar bli känd i fel kretsar. Precis rätt kretsar, menar jag.'],
  [10, 'DISPATCH: Stort ikväll. En flyktbil väntar. Du är med — eller hur?'],
];

// A flat ground marker (no sky-high light pillar — that fought the map-reading
// feel). Two concentric rings on the tarmac that gently pulse so you can spot
// the target without a beam blotting out the city.
function makeBeacon(color) {
  const group = new THREE.Group();
  const rMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.RingGeometry(2.6, 3.4, 32), rMat);
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.12; group.add(ring);
  const discMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const disc = new THREE.Mesh(new THREE.CircleGeometry(2.5, 32), discMat);
  disc.rotation.x = -Math.PI / 2; disc.position.y = 0.1; group.add(disc);
  group.visible = false;
  return { group, pulse: (t) => { const s = 1 + Math.sin(t * 3) * 0.16; ring.scale.set(s, s, 1); discMat.opacity = 0.1 + (Math.sin(t * 3) * 0.5 + 0.5) * 0.12; } };
}

function panel(css) { const d = document.createElement('div'); d.style.cssText = 'position:fixed;font-family:"DejaVu Sans Mono",monospace;color:#fff;pointer-events:none;z-index:40;text-shadow:0 2px 6px #000;' + css; document.body.appendChild(d); return d; }

export function createMissions(scene, model) {
  const t2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  const pickupB = makeBeacon(0x35d07f), dropB = makeBeacon(0xffa030);
  scene.add(pickupB.group, dropB.group);

  // HUD
  const obj = panel('top:64px;left:50%;transform:translateX(-50%);font-size:22px;font-weight:bold;letter-spacing:1px;text-align:center;');
  const cashEl = panel('top:14px;right:18px;font-size:20px;font-weight:bold;color:#ffe14a;');
  const styleEl = panel('top:44px;right:18px;font-size:15px;color:#9fe0ff;');
  const msg = panel('bottom:96px;left:50%;transform:translateX(-50%);font-size:16px;background:rgba(10,14,20,0.72);padding:9px 16px;border-left:3px solid #ff5a3c;max-width:70vw;opacity:0;transition:opacity .4s;');

  const B = model.buildings;
  const frontOf = (b) => new THREE.Vector3(b.cx, 0, model.nodes[b.bj] + model.ROAD_HW * 0.7);
  const rand = () => B[Math.floor(Math.random() * B.length)];

  let state = 'idle', pickup = null, drop = null, timer = 0, cash = 0, delivered = 0;
  let style = 0, styleHot = 0, msgTimer = 0, tt = 0, shownBeat = -1;

  function dispatch(text) { msg.textContent = text; msg.style.opacity = '1'; msgTimer = 6; }
  function maybeBeat() { for (const [n, text] of DISPATCH) { if (n === delivered && n !== shownBeat) { shownBeat = n; dispatch(text); break; } } }

  function newPickup() {
    const b = rand(); pickup = frontOf(b);
    pickupB.group.position.copy(pickup); pickupB.group.visible = true;
    dropB.group.visible = false; state = 'idle';
  }
  function startDelivery() {
    let b; do { b = rand(); } while (t2(frontOf(b), pickup) < 90);
    drop = frontOf(b);
    timer = Math.max(28, t2(pickup, drop) / 24 + 14);
    dropB.group.position.copy(drop); dropB.group.visible = true;
    pickupB.group.visible = false; state = 'carrying';
  }
  function complete(p) {
    const timeBonus = Math.round(timer * 6);
    const mult = 1 + style;
    const pay = Math.round((BASE_PAY + timeBonus) * mult);
    cash += pay; delivered++;
    dispatch(`LEVERERAT! +$${pay}  (tid $${timeBonus} · style x${mult.toFixed(1)})`);
    style = 0; maybeBeat(); newPickup();
  }
  function fail() { dispatch('FÖR SENT — paketet är kört. Ny order.'); style = 0; newPickup(); }

  newPickup();
  setTimeout(() => maybeBeat(), 400);

  return {
    update(dt, st) {
      tt += dt;
      pickupB.pulse(tt); dropB.pulse(tt);
      if (msgTimer > 0) { msgTimer -= dt; if (msgTimer <= 0) msg.style.opacity = '0'; }

      if (!st) { obj.style.display = cashEl.style.display = styleEl.style.display = 'none'; return; }
      obj.style.display = cashEl.style.display = styleEl.style.display = 'block';
      const p = st.pos;

      // STYLE builds from air time and drifting; decays when you're just cruising
      if (st.airborne || st.drifting) { style = Math.min(style + dt * (st.airborne ? 0.9 : 0.4), 3); styleHot = 1.4; }
      else { styleHot -= dt; if (styleHot <= 0) style = Math.max(0, style - dt * 0.25); }

      cashEl.textContent = `$ ${cash}`;
      styleEl.textContent = style > 0.05 ? `STYLE x${(1 + style).toFixed(1)}` : '';

      if (state === 'idle') {
        const dist = t2(p, pickup);
        const inRing = dist < PICKUP_R;
        // you have to actually STOP for the package — no grabbing it at 200 km/h
        const slow = st.kmh < PICKUP_KMH;
        if (inRing && !slow) obj.innerHTML = `📦 SAKTA IN OCH STANNA &nbsp;·&nbsp; <span style="color:#ffd94a">${Math.round(st.kmh)} km/h</span>`;
        else obj.innerHTML = `📦 HÄMTA PAKETET &nbsp;·&nbsp; ${Math.round(dist)} m`;
        if (inRing && slow) startDelivery();
      } else {
        timer -= dt;
        const m = Math.floor(timer / 60), s = Math.max(0, Math.floor(timer % 60));
        obj.innerHTML = `🎯 LEVERERA &nbsp;·&nbsp; <span style="color:${timer < 8 ? '#ff5a3c' : '#fff'}">${m}:${String(s).padStart(2, '0')}</span> &nbsp;·&nbsp; ${Math.round(t2(p, drop))} m`;
        if (timer <= 0) fail();
        else if (t2(p, drop) < DROP_R) complete(p);
      }
    },
    dbg: () => ({ state, cash, delivered, pickup: pickup && { x: pickup.x, z: pickup.z }, drop: drop && { x: drop.x, z: drop.z } }),
  };
}
