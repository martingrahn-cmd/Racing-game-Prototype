// The getaway-driver heist arc (#115). A bank on the finance ring carries a
// standing 💰 job on the city map:
//   take the job → park in the getaway spot outside APEX BANK → the crew
//   sprints out of the doors and piles into the car ("STEP ON IT BRO!") →
//   outrun the police to the hideout on the villa edge → drop the crew →
//   dump the hot car at the chop-shop to kill the heat → paid.
// The robbers are baked sprint flipbooks (same pipeline as the pedestrians,
// so they render correctly); the police are the city's standing patrol fleet
// (police.js) — the heist just flips them ALL to pursuit at once. The bank /
// hideout / chop-shop are procedural landmarks on blocks reserved in
// citymodel.js.
import * as THREE from 'three';
import { makeGLTFLoader } from './car.js';
import { bakeFlipbook, bakeFlipbookVC } from './pedestrians_world.js';
import { registerEmissive } from './night.js';

const N_CREW = 3;
const N_COPS = 3;
const ARRIVE_R = 7.5;      // beacon ring radius for each stage
const STOP_KMH = 14;       // must be (nearly) stopped to trigger a stage
const CREW_RUN = 5.6;      // m/s sprint
const PAY_HIDEOUT = 900, PAY_DUMP = 600;
const COOLDOWN = 90;       // s until the bank can be hit again

// same flat pulsing ground beacon as the delivery missions, in heat-red
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

function panel(css) { const d = document.createElement('div'); d.style.cssText = 'position:fixed;font-family:"DejaVu Sans Mono",monospace;color:#fff;pointer-events:none;z-index:42;text-shadow:0 2px 6px #000;' + css; document.body.appendChild(d); return d; }

// canvas-text sign texture (dark board, gold lettering)
function makeSignTex(text, w = 1024, h = 160) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d');
  x.fillStyle = '#101722'; x.fillRect(0, 0, w, h);
  x.strokeStyle = '#c9a23a'; x.lineWidth = 10; x.strokeRect(10, 10, w - 20, h - 20);
  x.fillStyle = '#e8c04a';
  x.font = `bold ${Math.round(h * 0.52)}px Georgia,serif`;
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(text, w / 2, h / 2 + 4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------------------------------------------------------- landmarks
// APEX BANK: a classic columned hall with steps, gold signage and a paved
// forecourt, flush with the building line so the crew spawns at its doors.
function buildBank(group, b, CURB_Y) {
  const w = b.maxX - b.minX, d = b.maxZ - b.minZ;
  const stone = new THREE.MeshStandardMaterial({ color: 0xdfd8ca, roughness: 0.85, metalness: 0.02 });
  // columns/trim in a warmer stone so the portico reads against the wall
  const trim = new THREE.MeshStandardMaterial({ color: 0xc2b394, roughness: 0.8, metalness: 0.03 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a313c, roughness: 0.4, metalness: 0.4 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xc9a23a, roughness: 0.35, metalness: 0.7 });
  const HW = w * 0.62, HD = d * 0.5, H = 11;
  const front = b.minZ;                       // faces the street toward the plaza
  const cx = b.cx, hallZ = front + HD / 2 + 2.6;

  // paved forecourt over the whole block so the AABB collider reads as a plaza
  const court = new THREE.Mesh(new THREE.BoxGeometry(w, 0.14, d), new THREE.MeshStandardMaterial({ color: 0xb9b2a4, roughness: 0.9 }));
  court.position.set(cx, CURB_Y + 0.07, b.cz); court.receiveShadow = true; group.add(court);

  const hall = new THREE.Mesh(new THREE.BoxGeometry(HW, H, HD), stone);
  hall.position.set(cx, CURB_Y + H / 2, hallZ); hall.castShadow = true; hall.receiveShadow = true; group.add(hall);
  // portico: six columns + architrave + pediment
  const colGeo = new THREE.CylinderGeometry(0.55, 0.62, 8.6, 10);
  for (let i = 0; i < 6; i++) {
    const x = cx - HW * 0.42 + (HW * 0.84) * (i / 5);
    const col = new THREE.Mesh(colGeo, trim);
    col.position.set(x, CURB_Y + 4.3, front + 1.3); col.castShadow = true; group.add(col);
  }
  const arch = new THREE.Mesh(new THREE.BoxGeometry(HW * 0.94, 1.5, 3.4), trim);
  arch.position.set(cx, CURB_Y + 9.35, front + 1.6); arch.castShadow = true; group.add(arch);
  const shape = new THREE.Shape();
  shape.moveTo(-HW * 0.47, 0); shape.lineTo(HW * 0.47, 0); shape.lineTo(0, 2.6); shape.closePath();
  const ped = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 3.0, bevelEnabled: false }), trim);
  ped.position.set(cx, CURB_Y + 10.1, front + 0.2); ped.castShadow = true; group.add(ped);
  // steps down to the forecourt
  for (let s = 0; s < 2; s++) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(HW * 0.7, 0.3, 1.1), stone);
    step.position.set(cx, CURB_Y + 0.15 + s * 0.3, front - 0.6 - s * 0.9 + 0.9);
    step.receiveShadow = true; group.add(step);
  }
  // doors: dark glass slabs between the middle columns
  for (const sx of [-1.6, 1.6]) {
    const door = new THREE.Mesh(new THREE.BoxGeometry(2.6, 4.2, 0.2), dark);
    door.position.set(cx + sx, CURB_Y + 2.1, front + 0.35); group.add(door);
  }
  // the gold sign — swap for a fetched GLB later if one turns up
  const signTex = makeSignTex('APEX BANK');
  const signMat = new THREE.MeshStandardMaterial({ map: signTex, emissive: 0xffffff, emissiveMap: signTex, emissiveIntensity: 0.1, roughness: 0.5 });
  registerEmissive(signMat, 0.1, 1.5);
  const sign = new THREE.Mesh(new THREE.BoxGeometry(HW * 0.5, 1.35, 0.22), signMat);
  sign.position.set(cx, CURB_Y + 8.0, front + 1.62); group.add(sign);
  // two gold bollards flanking the steps
  for (const sx of [-HW * 0.4, HW * 0.4]) {
    const bol = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 1.0, 8), gold);
    bol.position.set(cx + sx, CURB_Y + 0.5, front - 1.6); bol.castShadow = true; group.add(bol);
  }
  return { doorX: cx, doorZ: front + 0.2 };
}

// hideout / chop-shop: an edge-lot lockup — corrugated shed, roll door, sign
function buildLockup(group, b, CURB_Y, label) {
  const shed = new THREE.MeshStandardMaterial({ color: 0x878b90, roughness: 0.55, metalness: 0.35 });
  const doorM = new THREE.MeshStandardMaterial({ color: 0x3c4149, roughness: 0.6, metalness: 0.3 });
  const W = 17, D = 12, H = 5.6;
  const front = b.minZ, cx = b.cx;
  const lawn = new THREE.Mesh(new THREE.BoxGeometry(b.maxX - b.minX + 2, 0.06, b.maxZ - b.minZ + 2),
    new THREE.MeshStandardMaterial({ color: 0x55804a, roughness: 0.95 }));
  lawn.position.set(cx, CURB_Y + 0.04, b.cz); lawn.receiveShadow = true; group.add(lawn);
  const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), shed);
  body.position.set(cx, CURB_Y + H / 2, front + D / 2 + 1); body.castShadow = true; body.receiveShadow = true; group.add(body);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(W + 1.2, 0.35, D + 1.2), doorM);
  roof.position.set(cx, CURB_Y + H + 0.18, front + D / 2 + 1); roof.castShadow = true; group.add(roof);
  const door = new THREE.Mesh(new THREE.BoxGeometry(9, 4.2, 0.25), doorM);
  door.position.set(cx, CURB_Y + 2.1, front + 1.02); group.add(door);
  for (let i = 0; i < 5; i++) { // roll-door grooves
    const g = new THREE.Mesh(new THREE.BoxGeometry(9, 0.06, 0.06), shed);
    g.position.set(cx, CURB_Y + 0.8 + i * 0.8, front + 0.88); group.add(g);
  }
  const signTex = makeSignTex(label, 512, 110);
  const signMat = new THREE.MeshStandardMaterial({ map: signTex, emissive: 0xffffff, emissiveMap: signTex, emissiveIntensity: 0.08, roughness: 0.6 });
  registerEmissive(signMat, 0.08, 1.1);
  const sign = new THREE.Mesh(new THREE.BoxGeometry(6.2, 1.15, 0.2), signMat);
  sign.position.set(cx, CURB_Y + H - 0.9, front + 0.98); group.add(sign);
  return { doorX: cx, doorZ: front + 0.4 };
}

export function createHeist(scene, model, missions, camera, police) {
  const { CURB_Y } = model;
  if (!model.bank || !model.hideout || !model.chopshop) return null;
  const group = new THREE.Group();
  scene.add(group);

  const bankDoor = buildBank(group, model.bank, CURB_Y);
  const hideDoor = buildLockup(group, model.hideout, CURB_Y, 'GARAGE 7');
  const shopDoor = buildLockup(group, model.chopshop, CURB_Y, 'KROM & LACK');

  // stage spots: ON THE SIDEWALK in front of each facade — a getaway car waits
  // by the doors, not in the traffic lane (passing cars shove anything parked
  // in the lane, and the crew's sprint should be short)
  const spotOf = (b) => new THREE.Vector3(b.cx, 0, (b.slab.minZ + b.minZ) / 2);
  const bankSpot = spotOf(model.bank), hideSpot = spotOf(model.hideout), shopSpot = spotOf(model.chopshop);

  const beacon = makeBeacon(0xff5a3c);
  scene.add(beacon.group);

  // HUD (own line — the delivery HUD hides while the heist runs)
  const obj = panel('top:64px;left:50%;transform:translateX(-50%);font-size:22px;font-weight:bold;letter-spacing:1px;text-align:center;display:none;');
  const bubble = panel('font-size:15px;font-weight:bold;background:#fff;color:#111;padding:7px 12px;border-radius:14px;transform:translate(-50%,-130%);display:none;box-shadow:0 4px 14px rgba(0,0,0,0.45);');
  const fade = panel('inset:0;background:#000;opacity:0;transition:opacity .45s;');
  const toastEl = panel('bottom:96px;left:50%;transform:translateX(-50%);font-size:16px;background:rgba(10,14,20,0.72);padding:9px 16px;border-left:3px solid #e8c04a;max-width:70vw;opacity:0;transition:opacity .4s;');
  let toastT = 0;
  const toast = (t) => { toastEl.textContent = t; toastEl.style.opacity = '1'; toastT = 6; };

  // ------------------------------------------------------------- the crew
  const CREW_MODELS = ['assets/people/hoodie.glb', 'assets/people/casual.glb', 'assets/people/worker.glb'];
  const crewBooks = [];   // baked sprint flipbooks
  const loader = makeGLTFLoader();
  for (const path of CREW_MODELS) {
    loader.load(path, (gltf) => {
      if (!gltf.animations || !gltf.animations.length) return;
      const clip = gltf.animations.find((c) => /run|sprint/i.test(c.name))
        || gltf.animations.find((c) => /walk/i.test(c.name)) || gltf.animations[0];
      try { crewBooks.push(bakeFlipbookVC(bakeFlipbook(gltf, clip, 12).frames)); } catch { /* skip */ }
    }, undefined, () => { /* skip */ });
  }
  const runners = [];  // live robbers {group, meshes, fb, nF, phase, delay, mode:'toCar'|'toDoor', done, scale}
  function spawnRunner(i, sx, sz, mode) {
    const fb = crewBooks[i % crewBooks.length];
    if (!fb) return null;
    const g = new THREE.Group();
    const meshes = fb[0].map((part) => { const m = new THREE.Mesh(part.geometry, part.material); m.castShadow = true; g.add(m); return m; });
    g.position.set(sx, CURB_Y, sz);
    group.add(g);
    const r = { group: g, meshes, fb, nF: fb.length, phase: Math.random() * 4, delay: i * 0.8, mode, done: false, boardT: 0 };
    runners.push(r);
    return r;
  }
  function clearRunners() { for (const r of runners) group.remove(r.group); runners.length = 0; }

  const V = new THREE.Vector3(); // scratch (speech-bubble projection)

  // ------------------------------------------------------------- state
  let phase = 'idle', cooldown = 0, aboard = 0, tt = 0;
  let bubbleT = 0;
  const bubblePos = new THREE.Vector3();

  function setBeacon(spot) { beacon.group.position.copy(spot); beacon.group.visible = true; }
  function fail(msg) {
    toast(msg);
    clearRunners();
    if (police) police.setChase(false);
    beacon.group.visible = false;
    phase = 'idle'; cooldown = 30;
    missions.setBusy(false);
    obj.style.display = 'none';
  }

  const api = {
    group,
    available: () => phase === 'idle' && cooldown <= 0 && crewBooks.length > 0,
    mapPin: () => ({ x: bankSpot.x, z: bankSpot.z, pay: PAY_HIDEOUT + PAY_DUMP }),
    target: () => {
      if (phase === 'toBank' || phase === 'loading') return { x: bankSpot.x, z: bankSpot.z };
      if (phase === 'chase' || phase === 'unload') return { x: hideSpot.x, z: hideSpot.z };
      if (phase === 'dump') return { x: shopSpot.x, z: shopSpot.z };
      return null;
    },
    phase: () => phase,
    select() {
      if (!api.available()) return false;
      if (missions.state() !== 'none') { toast('DISPATCH: Gör klart leveransen först.'); return false; }
      missions.setBusy(true);
      phase = 'toBank';
      setBeacon(bankSpot);
      toast('GÄNGET: Vänta utanför APEX BANK med motorn igång. Inga misstag.');
      return true;
    },
    update(dt, st) {
      tt += dt;
      beacon.pulse(tt);
      if (toastT > 0) { toastT -= dt; if (toastT <= 0) toastEl.style.opacity = '0'; }
      if (cooldown > 0) cooldown -= dt;
      if (phase === 'idle' || !st) { if (phase === 'idle') obj.style.display = 'none'; return; }
      obj.style.display = 'block';
      const p = st.pos;
      const d2 = (a) => Math.hypot(a.x - p.x, a.z - p.z);

      if (phase === 'toBank') {
        const dist = d2(bankSpot);
        obj.innerHTML = dist < ARRIVE_R * 1.8 && st.kmh >= STOP_KMH
          ? '💰 RÅN &nbsp;·&nbsp; <span style="color:#ffd94a">STANNA I RINGEN</span>'
          : `💰 RÅN &nbsp;·&nbsp; KÖR TILL BANKEN &nbsp;·&nbsp; ${Math.round(dist)} m`;
        if (dist < ARRIVE_R && st.kmh < STOP_KMH) {
          phase = 'loading'; aboard = 0;
          for (let i = 0; i < N_CREW; i++) spawnRunner(i, bankDoor.doorX + (i - 1) * 1.4, bankDoor.doorZ, 'toCar');
          toast('GÄNGET: NU NU NU — håll motorn igång!');
        }
      } else if (phase === 'loading') {
        obj.innerHTML = `💰 VÄNTA PÅ GÄNGET &nbsp;·&nbsp; <span style="color:#35d07f">${aboard}/${N_CREW}</span>${st.kmh > 8 ? ' &nbsp;·&nbsp; <span style="color:#ff5a3c">STANNA!</span>' : ''}`;
        // drive off without them and the job collapses
        if (d2(bankSpot) > 42 && st.kmh > 25) { fail('GÄNGET: VART FAN TOG DU VÄGEN?! Rånet sprack.'); return; }
        for (const r of runners) {
          if (r.done) continue;
          if (r.delay > 0) { r.delay -= dt; continue; }
          if (r.boardT > 0) { // climbing in: sink into the car
            r.boardT -= dt;
            const k = Math.max(0, r.boardT / 0.3);
            r.group.scale.setScalar(0.3 + 0.7 * k);
            r.group.position.y = CURB_Y - (1 - k) * 0.7;
            if (r.boardT <= 0) { r.done = true; r.group.visible = false; aboard++; }
            continue;
          }
          const dx = p.x - r.group.position.x, dz = p.z - r.group.position.z;
          const d = Math.hypot(dx, dz);
          if (d < 1.7) { r.boardT = 0.3; continue; }
          const spd = CREW_RUN * Math.min(1, d / 3);
          r.group.position.x += (dx / d) * spd * dt;
          r.group.position.z += (dz / d) * spd * dt;
          r.group.rotation.y = Math.atan2(dx, dz);
          r.phase += (spd * dt / 2.1) * r.nF;
          const idx = Math.floor(r.phase) % r.nF;
          for (let i = 0; i < r.meshes.length; i++) r.meshes[i].geometry = r.fb[idx][i].geometry;
        }
        if (aboard >= N_CREW) {
          clearRunners();
          phase = 'chase';
          setBeacon(hideSpot);
          bubbleT = 2.8; bubblePos.copy(p);
          toast('GÄNGET: STEP ON IT BRO!! 🔫');
          // the patrol fleet is already in the streets — every unit flips to
          // pursuit THE MOMENT the alarm goes (far-off units respond from a
          // side street 2-3 blocks out, #116)
          if (police) police.setChase(true, p);
        }
      } else if (phase === 'chase') {
        const dist = d2(hideSpot);
        obj.innerHTML = `🚔 TILL GÖMSTÄLLET &nbsp;·&nbsp; ${Math.round(dist)} m`;
        if (dist < ARRIVE_R && st.kmh < STOP_KMH) {
          phase = 'unload';
          for (let i = 0; i < N_CREW; i++) spawnRunner(i, p.x + (i - 1) * 1.2, p.z + 1.2, 'toDoor');
          const pay = Math.round(PAY_HIDEOUT * missions.styleMult());
          missions.addCash(pay, `GÄNGET BETALAR: +$${pay}`);
        }
      } else if (phase === 'unload') {
        obj.innerHTML = '💰 GÄNGET HOPPAR UR…';
        let left = 0;
        for (const r of runners) {
          if (r.done) continue;
          if (r.delay > 0) { r.delay -= dt; left++; continue; }
          const dx = hideDoor.doorX - r.group.position.x, dz = hideDoor.doorZ - r.group.position.z;
          const d = Math.hypot(dx, dz);
          if (d < 1.4) { r.done = true; r.group.visible = false; continue; }
          left++;
          r.group.position.x += (dx / d) * CREW_RUN * dt;
          r.group.position.z += (dz / d) * CREW_RUN * dt;
          r.group.rotation.y = Math.atan2(dx, dz);
          r.phase += (CREW_RUN * dt / 2.1) * r.nF;
          const idx = Math.floor(r.phase) % r.nF;
          for (let i = 0; i < r.meshes.length; i++) r.meshes[i].geometry = r.fb[idx][i].geometry;
        }
        if (!left) {
          clearRunners();
          phase = 'dump';
          setBeacon(shopSpot);
          toast('GÄNGET: Bilen är bränd — dumpa den hos KROM & LACK. Polisen släpper inte.');
        }
      } else if (phase === 'dump') {
        const dist = d2(shopSpot);
        obj.innerHTML = `🚔 DUMPA BILEN &nbsp;·&nbsp; KROM & LACK &nbsp;·&nbsp; ${Math.round(dist)} m`;
        if (dist < ARRIVE_R && st.kmh < STOP_KMH) {
          phase = 'done';
          fade.style.opacity = '1';
          setTimeout(() => {
            if (police) police.setChase(false);
            beacon.group.visible = false;
            missions.addCash(PAY_DUMP, `KROM: Ny lack, inga spår. +$${PAY_DUMP}`);
            missions.setBusy(false);
            obj.style.display = 'none';
            phase = 'idle'; cooldown = COOLDOWN;
            fade.style.opacity = '0';
          }, 650);
        }
      }

      // the speech bubble tracks the car on screen
      if (bubbleT > 0) {
        bubbleT -= dt;
        bubblePos.copy(p); bubblePos.y = 1.6;
        V.copy(bubblePos).project(camera);
        if (V.z < 1 && bubbleT > 0) {
          bubble.style.display = 'block';
          bubble.textContent = 'STEP ON IT BRO!! 🔫';
          bubble.style.left = `${(V.x * 0.5 + 0.5) * innerWidth}px`;
          bubble.style.top = `${(-V.y * 0.5 + 0.5) * innerHeight}px`;
        } else bubble.style.display = 'none';
        if (bubbleT <= 0) bubble.style.display = 'none';
      }
    },
    dbg: () => ({
      phase, aboard, chasing: police ? police.chasing() : false, cooldown: Math.round(cooldown), books: crewBooks.length,
      runners: runners.map((r) => ({ delay: +r.delay.toFixed(2), boardT: +r.boardT.toFixed(2), done: r.done, x: +r.group.position.x.toFixed(1), z: +r.group.position.z.toFixed(1) })),
    }),
  };
  return api;
}
