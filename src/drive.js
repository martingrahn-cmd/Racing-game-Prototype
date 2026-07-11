// Player driving: arcade physics with grip/drift, keyboard + gamepad input.
// The circuit is fenced, so the car is kept inside the track corridor by
// tracking progress along the spline and clamping lateral offset.
//
// Gamepad (standard mapping): left stick = steer, RT = gas, LT = brake/reverse,
// A/Cross = handbrake, B/Circle = look back, Y/Triangle = camera.
import * as THREE from 'three';
import { frameAt } from './track.js';

const TRACK_HALF = 8.3;        // fence corridor half-width
const MAX_SPEED = 61;          // m/s ≈ 220 km/h
const MAX_REVERSE = 9;

// handling parameters, exposed so the debug GUI can tune them live
export const TUNE = {
  accel: 13.5,
  brakeForce: 24,
  grip: 6.5,
  driftGrip: 1.8,   // more bite in the slide = a heavier, less floaty drift
  steer: 2.4,
  driftSteer: 1.6,
  sidewalkMax: 8.3, // m/s ≈ 30 km/h — sidewalks are a slow crawl, never a route
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

  function readInput() {
    let steer = 0, throttle = 0, brake = 0, hand = false, look = false, horn = false, reset = false;
    if (keys.has('ArrowLeft') || keys.has('KeyA')) steer -= 1;
    if (keys.has('ArrowRight') || keys.has('KeyD')) steer += 1;
    if (keys.has('ArrowUp') || keys.has('KeyW')) throttle = 1;
    if (keys.has('ArrowDown') || keys.has('KeyS')) brake = 1;
    if (keys.has('Space')) hand = true;
    if (keys.has('KeyB')) look = true;
    if (keys.has('KeyH')) horn = true;
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
      resetNow = resetNow || !!pad.buttons[8]?.pressed;                  // Back / Select
      const camBtn = !!pad.buttons[3]?.pressed;                          // Y / Triangle
      if (camBtn && !camHeld) cameraTapped = true;
      camHeld = camBtn;
      // d-pad steering fallback
      if (pad.buttons[14]?.pressed) steer -= 1;
      if (pad.buttons[15]?.pressed) steer += 1;
    }
    reset = resetNow && !resetHeld; // edge-trigger
    resetHeld = resetNow;
    return { steer: THREE.MathUtils.clamp(steer, -1, 1), throttle, brake, hand, look, horn, reset };
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

  // free-roam (open world) mode: no spline, drive anywhere and collide with the
  // static world. Controllable from the first frame (no attract takeover).
  const world = opts.world || null;
  if (world) {
    playing = true;
    pos.set(world.spawn.pos[0], 0, world.spawn.pos[2]);
    yaw = world.spawn.yaw;
    heading.set(Math.sin(yaw), 0, Math.cos(yaw));
    vel.copy(heading).multiplyScalar(2);
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
        if (inp.throttle > 0.15 || inp.brake > 0.15 || Math.abs(inp.steer) > 0.4) takeControl(attractS);
        else return null;
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
      const response = inp.hand ? 2.3 : 10; // sliding tires hold their rotation (inertia = weight)
      yawVel += (targetYawVel - yawVel) * Math.min(1, response * dt);
      yaw += yawVel * dt;
      heading.set(Math.sin(yaw), 0, Math.cos(yaw));

      // throttle / brake / reverse
      let acc = 0;
      if (inp.throttle > 0) acc += inp.throttle * (TUNE.accel - TUNE.accel * 0.67 * Math.max(fwdSpeed, 0) / MAX_SPEED);
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
      if (f2 > MAX_SPEED) vel.addScaledVector(heading, MAX_SPEED - f2);
      if (f2 < -MAX_REVERSE) vel.addScaledVector(heading, -MAX_REVERSE - f2);

      pos.addScaledVector(vel, dt);

      if (world) {
        // free roam: buildings hard-stop; curbs are mountable — bump up onto
        // the sidewalk with a jolt, drive it slower, and hop back down
        const fb = world.collision.resolve(pos, 1.5, vel);
        if (fb.onCurb) {
          if (!onCurbPrev && speed > 4) { vel.multiplyScalar(0.7); rumble(0.7, 0.5, 130); } // mount jolt
          vel.multiplyScalar(Math.max(0, 1 - 2.4 * dt));   // bog down onto the kerb
          const sp = vel.length();                          // hard cap: never a fast route
          if (sp > TUNE.sidewalkMax) vel.multiplyScalar(TUNE.sidewalkMax / sp);
        }
        onCurbPrev = fb.onCurb;
        const targetY = fb.onCurb ? (world.curbY || 0) : 0;
        pos.y += (targetY - pos.y) * Math.min(1, 9 * dt); // ride up/down the curb
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
        roll: THREE.MathUtils.clamp(-lat * 0.012, -0.09, 0.09),
        lookBack: inp.look,
        drifting,
        hand: inp.hand,               // handbrake held → rear wheels locked (skidmarks)
        slip: Math.abs(lat),          // lateral tire slip, feeds screech + smoke
        throttle: inp.throttle,
        brake: inp.brake,
        horn: inp.horn,
        s: world ? 0 : sEst,
      };
    },
  };
}
