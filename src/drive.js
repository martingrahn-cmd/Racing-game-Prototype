// Player driving: arcade physics with grip/drift, keyboard + gamepad input.
// The circuit is fenced, so the car is kept inside the track corridor by
// tracking progress along the spline and clamping lateral offset.
//
// Gamepad (standard mapping): left stick = steer, RT = gas, LT = brake/reverse,
// A/Cross = handbrake, B/Circle = look back, Y/Triangle = camera.
import * as THREE from 'three';
import { frameAt } from './track.js';

const TRACK_HALF = 8.3;        // fence corridor half-width
const MAX_SPEED = 42;          // m/s ≈ 150 km/h — heavier muscle car, not a hypercar
const MAX_REVERSE = 9;

// handling parameters, exposed so the debug GUI can tune them live.
// Tuned for an American-muscle feel: lazy off-the-line grunt, a loose tail and
// plenty of body sway rather than go-kart precision.
export const TUNE = {
  accel: 18,
  brakeForce: 30,
  grip: 8.5,        // looser back end — the car floats and steps out
  driftGrip: 4,     // more bite in the slide = a heavier, less floaty drift
  steer: 3,
  driftSteer: 1.6,
  steerResponse: 6, // slower steering take-up → wallowy, swaying turn-in
  sidewalkMax: 40,  // m/s — plough the pavement near full tilt
};

export function createDrive(curve, length, opts = {}) {
  // ---------------- input ----------------
  const keys = new Set();
  const typing = (e) => e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA');
  addEventListener('keydown', (e) => {
    if (typing(e)) return; // let the bug-report field capture typing
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    keys.add(e.code);
  });
  addEventListener('keyup', (e) => { if (!typing(e)) keys.delete(e.code); });

  let padIndex = null;
  let padToast = 0;
  addEventListener('gamepadconnected', (e) => { padIndex = e.gamepad.index; padToast = 4; });
  addEventListener('gamepaddisconnected', (e) => { if (padIndex === e.gamepad.index) padIndex = null; });

  let cameraTapped = false; // edge-triggered camera cycle from the pad
  let camHeld = false;
  let resetHeld = false;

  // ---------------- on-screen touch controls (phones/tablets) ----------------
  const touch = { steer: 0, throttle: 0, brake: 0, hand: false, boost: false, horn: false, reset: false };
  (function setupTouch() {
    const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints || 0) > 0;
    if (!isTouch) return;
    document.body.classList.add('touch');
    const hold = (id, set) => {
      const el = document.getElementById(id); if (!el) return;
      const on = (e) => { e.preventDefault(); set(true); el.classList.add('pressed'); };
      const off = (e) => { e.preventDefault(); set(false); el.classList.remove('pressed'); };
      el.addEventListener('pointerdown', on);
      for (const ev of ['pointerup', 'pointercancel', 'pointerleave', 'lostpointercapture']) el.addEventListener(ev, off);
    };
    hold('btnGas', (v) => { touch.throttle = v ? 1 : 0; });
    hold('btnBrake', (v) => { touch.brake = v ? 1 : 0; });
    hold('btnHand', (v) => { touch.hand = v; });
    hold('btnBoost', (v) => { touch.boost = v; });
    hold('btnHorn', (v) => { touch.horn = v; });
    hold('btnReset', (v) => { touch.reset = v; });
    // analog steering pad: drag left/right, self-centres on release
    const pad = document.getElementById('steerPad'), knob = document.getElementById('steerKnob');
    if (pad) {
      let active = null;
      const setX = (clientX) => {
        const r = pad.getBoundingClientRect();
        const t = Math.max(-1, Math.min(1, (clientX - (r.left + r.width / 2)) / (r.width / 2 - 8)));
        touch.steer = t;
        if (knob) knob.style.transform = `translateX(${t * (r.width / 2 - 34)}px)`;
      };
      pad.addEventListener('pointerdown', (e) => { e.preventDefault(); active = e.pointerId; try { pad.setPointerCapture(e.pointerId); } catch { /* ignore */ } setX(e.clientX); pad.classList.add('pressed'); });
      pad.addEventListener('pointermove', (e) => { if (active === e.pointerId) { e.preventDefault(); setX(e.clientX); } });
      const end = (e) => { if (active === e.pointerId) { active = null; touch.steer = 0; if (knob) knob.style.transform = 'translateX(0)'; pad.classList.remove('pressed'); } };
      for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) pad.addEventListener(ev, end);
    }
  })();

  function readInput() {
    let steer = 0, throttle = 0, brake = 0, hand = false, look = false, horn = false, reset = false, boost = false;
    if (keys.has('ArrowLeft') || keys.has('KeyA')) steer -= 1;
    if (keys.has('ArrowRight') || keys.has('KeyD')) steer += 1;
    if (keys.has('ArrowUp') || keys.has('KeyW')) throttle = 1;
    if (keys.has('ArrowDown') || keys.has('KeyS')) brake = 1;
    if (keys.has('Space')) hand = true;
    if (keys.has('KeyB')) look = true;
    if (keys.has('KeyH')) horn = true;
    if (keys.has('ShiftLeft') || keys.has('ShiftRight')) boost = true;
    let resetNow = keys.has('KeyR');

    const pad = padIndex !== null ? navigator.getGamepads()[padIndex] : null;
    if (pad) {
      const dz = (v) => (Math.abs(v) < 0.13 ? 0 : v);
      steer += dz(pad.axes[0] ?? 0);
      throttle = Math.max(throttle, pad.buttons[7]?.value ?? 0);         // RT
      brake = Math.max(brake, pad.buttons[6]?.value ?? 0);               // LT
      hand = hand || !!pad.buttons[0]?.pressed;                          // A / Cross
      look = look || !!pad.buttons[1]?.pressed;                          // B / Circle
      horn = horn || !!pad.buttons[2]?.pressed;                          // X / Square
      boost = boost || !!pad.buttons[5]?.pressed;                        // RB — nitro
      resetNow = resetNow || !!pad.buttons[8]?.pressed;                  // Back / Select
      const camBtn = !!pad.buttons[3]?.pressed;                          // Y / Triangle
      if (camBtn && !camHeld) cameraTapped = true;
      camHeld = camBtn;
      // d-pad steering fallback
      if (pad.buttons[14]?.pressed) steer -= 1;
      if (pad.buttons[15]?.pressed) steer += 1;
    }
    // on-screen touch controls fold into the same inputs
    throttle = Math.max(throttle, touch.throttle);
    brake = Math.max(brake, touch.brake);
    steer += touch.steer;
    hand = hand || touch.hand;
    boost = boost || touch.boost;
    horn = horn || touch.horn;
    resetNow = resetNow || touch.reset;

    reset = resetNow && !resetHeld; // edge-trigger
    resetHeld = resetNow;
    return { steer: THREE.MathUtils.clamp(steer, -1, 1), throttle, brake, hand, look, horn, reset, boost };
  }

  function rumble(strong, weak, ms) {
    const pad = padIndex !== null ? navigator.getGamepads()[padIndex] : null;
    try {
      pad?.vibrationActuator?.playEffect('dual-rumble', {
        duration: ms, strongMagnitude: strong, weakMagnitude: weak,
      });
    } catch { /* no rumble support */ }
  }

  // ---------------- state ----------------
  const pos = new THREE.Vector3();
  const vel = new THREE.Vector3();
  const heading = new THREE.Vector3(0, 0, 1);
  const fwd = new THREE.Vector3(), right = new THREE.Vector3(), tmp = new THREE.Vector3();
  let yaw = 0;
  let yawVel = 0;   // angular momentum: handbrake spins carry past 90°
  let lastDir = 1;  // travel direction memory while fwd speed passes through 0
  let sEst = 0;
  let playing = false;
  let wallBuzz = 0;
  let onCurbPrev = false; // was the car on a sidewalk last frame (world mode)
  let airY = 0, airVy = 0, airborne = false, jumpCool = 0; // stunt-jump state (free roam)

  // free-roam (open world) mode: no spline, drive anywhere and collide with the
  // static world. Controllable from the first frame (no attract takeover).
  const world = opts.world || null;
  if (world) {
    // start parked at the spawn in attract mode; first drive input takes over
    pos.set(world.spawn.pos[0], 0, world.spawn.pos[2]);
    yaw = world.spawn.yaw;
    heading.set(Math.sin(yaw), 0, Math.cos(yaw));
  }

  // free-roam takeover: grab the car where it's parked and roll it forward
  function takeControlWorld() {
    playing = true;
    heading.set(Math.sin(yaw), 0, Math.cos(yaw));
    vel.copy(heading).multiplyScalar(4);
  }

  function takeControl(attractS) {
    playing = true;
    sEst = attractS;
    const { p, t } = frameAt(curve, length, attractS);
    pos.copy(p); pos.y = 0;
    yaw = Math.atan2(t.x, t.z);
    const kmh0 = 180 / 3.6;
    vel.set(t.x, 0, t.z).multiplyScalar(kmh0);
  }

  // refine progress estimate around the previous value (handles the loop wrap)
  function refineS() {
    let best = sEst, bestD = Infinity;
    for (let ds = -14; ds <= 30; ds += 2.5) {
      const s = sEst + ds;
      const { p } = frameAt(curve, length, s);
      const d = (p.x - pos.x) ** 2 + (p.z - pos.z) ** 2;
      if (d < bestD) { bestD = d; best = s; }
    }
    sEst = ((best % length) + length) % length;
  }

  return {
    get playing() { return playing; },
    get sEst() { return sEst; },
    get padConnected() { return padIndex !== null; },
    consumeCameraTap() { const t = cameraTapped; cameraTapped = false; return t; },
    consumePadToast() { const t = padToast; padToast = 0; return t; },

    // returns null while in attract mode; first drive input takes over
    update(dt, attractS, trafficCars) {
      const inp = readInput();
      if (!playing) {
        if (inp.throttle > 0.15 || inp.brake > 0.15 || Math.abs(inp.steer) > 0.4) {
          if (world) takeControlWorld(); else takeControl(attractS);
        } else return null;
      }

      // reset: back to a sane spot, facing forward, at walking pace
      if (inp.reset) {
        if (world) {
          pos.set(world.spawn.pos[0], 0, world.spawn.pos[2]);
          yaw = world.spawn.yaw; yawVel = 0; onCurbPrev = false;
          heading.set(Math.sin(yaw), 0, Math.cos(yaw));
          vel.copy(heading).multiplyScalar(2);
        } else {
          refineS();
          const { p, t } = frameAt(curve, length, sEst);
          pos.copy(p); pos.y = 0;
          yaw = Math.atan2(t.x, t.z);
          yawVel = 0;
          vel.set(t.x, 0, t.z).multiplyScalar(3);
        }
      }

      heading.set(Math.sin(yaw), 0, Math.cos(yaw));
      const fwdSpeed = vel.dot(heading);
      const speed = vel.length();

      // steering: full lock at low speed, tightening down as speed rises.
      // positive steer = turn right = yaw DECREASES (heading (sin,cos) is CCW).
      // Rotation carries angular momentum and is scaled by TOTAL speed, not
      // forward speed — so a handbrake flick swings past 90° into a full spin.
      const steerAuthority = TUNE.steer - TUNE.steer * 0.65 * Math.min(Math.abs(fwdSpeed) / 45, 1);
      // direction memory is FROZEN while the handbrake is on: forward speed
      // flips sign as the car passes 90°, and updating here reversed the spin
      // at exactly that point (the old "90° wall")
      if (!inp.hand && Math.abs(fwdSpeed) > 1) lastDir = Math.sign(fwdSpeed);
      const targetYawVel = -inp.steer * steerAuthority * (inp.hand ? TUNE.driftSteer : 1)
        * lastDir * Math.min(speed / 6, 1);
      const response = inp.hand ? 2.3 : TUNE.steerResponse; // sliding tires hold their rotation (inertia = weight)
      yawVel += (targetYawVel - yawVel) * Math.min(1, response * dt);
      yaw += yawVel * dt;
      heading.set(Math.sin(yaw), 0, Math.cos(yaw));

      // throttle / brake / reverse (nitro boost raises accel + top speed)
      const boosting = inp.boost && inp.throttle > 0 && fwdSpeed > -1;
      const maxSp = boosting ? MAX_SPEED * 1.42 : MAX_SPEED;
      let acc = 0;
      if (inp.throttle > 0) acc += inp.throttle * (TUNE.accel * (boosting ? 1.9 : 1) - TUNE.accel * 0.67 * Math.max(fwdSpeed, 0) / maxSp);
      if (inp.brake > 0) {
        if (fwdSpeed > 0.6) acc -= inp.brake * TUNE.brakeForce;
        else acc -= inp.brake * 7; // reverse
      }
      vel.addScaledVector(heading, acc * dt);

      // grip: bleed lateral velocity (loose when the handbrake is on)
      right.set(-heading.z, 0, heading.x); // true right = heading × up
      const lat = vel.dot(right);
      const grip = inp.hand ? TUNE.driftGrip : TUNE.grip;
      vel.addScaledVector(right, -lat * Math.min(grip * dt, 1));
      // drag + handbrake scrub
      vel.multiplyScalar(Math.max(0, 1 - (0.25 + (inp.hand ? 1.0 : 0)) * dt * 0.4));

      // clamp forward/reverse speed
      const f2 = vel.dot(heading);
      if (f2 > maxSp) vel.addScaledVector(heading, maxSp - f2);
      if (f2 < -MAX_REVERSE) vel.addScaledVector(heading, -MAX_REVERSE - f2);

      pos.addScaledVector(vel, dt);

      if (world) {
        // free roam: buildings hard-stop; curbs are mountable — bump up onto
        // the sidewalk with a jolt, drive it slower, and hop back down
        const fb = world.collision.resolve(pos, 1.5, vel);

        // stunt ramps: hit one at speed going up it → launch into the air
        jumpCool = Math.max(0, jumpCool - dt);
        if (world.ramps && !airborne && jumpCool <= 0) {
          for (const r of world.ramps) {
            const dx = pos.x - r.x, dz = pos.z - r.z;
            const along = dx * r.dir[0] + dz * r.dir[1];
            const perp = -dx * r.dir[1] + dz * r.dir[0];
            if (Math.abs(along) > r.halfL || Math.abs(perp) > r.halfW) continue;
            const speedUp = vel.x * r.dir[0] + vel.z * r.dir[1]; // speed up the ramp
            if (speedUp > 13) { airborne = true; airVy = Math.min(speedUp * 0.44, 17); jumpCool = 1.4; rumble(0.6, 0.4, 90); }
            break;
          }
        }

        if (airborne) {
          airVy -= 26 * dt;                 // gravity
          airY += airVy * dt;
          if (airY <= 0) {                  // touchdown
            airY = 0; airborne = false;
            if (airVy < -7) { vel.multiplyScalar(0.88); rumble(1.0, 0.8, 200); }
            airVy = 0;
          }
          pos.y = airY;
        } else {
          if (fb.onCurb) {
            if (!onCurbPrev && speed > 4) { vel.multiplyScalar(0.85); rumble(0.7, 0.5, 130); } // mount jolt (lighter — keep momentum)
            const sp = vel.length();                          // generous cap: rampage the pavement near full tilt
            if (sp > TUNE.sidewalkMax) vel.multiplyScalar(TUNE.sidewalkMax / sp);
          }
          onCurbPrev = fb.onCurb;
          const targetY = fb.onCurb ? (world.curbY || 0) : 0;
          pos.y += (targetY - pos.y) * Math.min(1, 9 * dt); // ride up/down the curb
        }
        if (fb.knocked) { vel.multiplyScalar(0.65); rumble(0.9, 0.7, 180); } // ploughed a pole
        if (fb.hitHard && wallBuzz <= 0 && speed > 5) { rumble(0.8, 0.5, 150); wallBuzz = 0.35; }
      } else {
        // stay inside the fenced corridor
        refineS();
        const fr = frameAt(curve, length, sEst);
        tmp.subVectors(pos, fr.p);
        const lateral = tmp.dot(fr.r);
        if (Math.abs(lateral) > TRACK_HALF) {
          const over = lateral - Math.sign(lateral) * TRACK_HALF;
          pos.addScaledVector(fr.r, -over);
          const vLat = vel.dot(fr.r);
          if (Math.sign(vLat) === Math.sign(lateral)) {
            vel.addScaledVector(fr.r, -vLat * 1.35); // soft bounce
            vel.multiplyScalar(0.92);
            if (wallBuzz <= 0 && speed > 8) { rumble(0.7, 0.4, 130); wallBuzz = 0.35; }
          }
        }
      }
      wallBuzz = Math.max(0, wallBuzz - dt);

      // shoulder-check against traffic (cheap sphere push, player only)
      if (trafficCars) {
        for (const c of trafficCars) {
          const dx = pos.x - c.group.position.x, dz = pos.z - c.group.position.z;
          const d2 = dx * dx + dz * dz;
          if (d2 < 6.5 && d2 > 0.001) {
            const d = Math.sqrt(d2);
            const push = (2.55 - d) / d;
            pos.x += dx * push * 0.6; pos.z += dz * push * 0.6;
            vel.multiplyScalar(0.965);
            if (wallBuzz <= 0) { rumble(0.5, 0.6, 90); wallBuzz = 0.3; }
          }
        }
      }

      const drifting = inp.hand && Math.abs(lat) > 3;
      return {
        pos, heading, yaw,
        speed: vel.length(),
        kmh: Math.abs(vel.dot(heading)) * 3.6,
        steer: inp.steer * 0.42,
        roll: THREE.MathUtils.clamp(-lat * 0.02, -0.16, 0.16), // soft suspension → visible body lean
        lookBack: inp.look,
        drifting,
        hand: inp.hand,               // handbrake held → rear wheels locked (skidmarks)
        slip: Math.abs(lat),          // lateral tire slip, feeds screech + smoke
        throttle: inp.throttle,
        brake: inp.brake,
        horn: inp.horn,
        boosting: inp.boost && inp.throttle > 0,
        airborne,
        s: world ? 0 : sEst,
      };
    },
  };
}
