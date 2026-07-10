// Procedural audio — no sound files. An engine built from oscillators and a
// tire screech built from band-passed noise, both driven by the physics state.
// The AudioContext can only start after a user gesture; resume() handles it.

export function createAudio() {
  let ctx = null;
  let master, engineOsc, engineSub, engineFilter, engineGain;
  let screechSrc, screechFilter, screechGain;
  let hornGain;
  let muted = false;

  function init() {
    ctx = new (window.AudioContext || window.webkitAudioContext)();

    master = ctx.createGain();
    master.gain.value = 0.22;
    master.connect(ctx.destination);

    // --- engine: saw + one-octave-down square through a lowpass -----------
    engineOsc = ctx.createOscillator();
    engineOsc.type = 'sawtooth';
    engineSub = ctx.createOscillator();
    engineSub.type = 'square';
    engineFilter = ctx.createBiquadFilter();
    engineFilter.type = 'lowpass';
    engineFilter.frequency.value = 500;
    engineGain = ctx.createGain();
    engineGain.gain.value = 0;
    const subGain = ctx.createGain();
    subGain.gain.value = 0.5;
    engineOsc.connect(engineFilter);
    engineSub.connect(subGain).connect(engineFilter);
    engineFilter.connect(engineGain).connect(master);
    engineOsc.start();
    engineSub.start();

    // --- tire screech: looped noise through a resonant bandpass -----------
    const len = ctx.sampleRate * 1.5;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    screechSrc = ctx.createBufferSource();
    screechSrc.buffer = buf;
    screechSrc.loop = true;
    screechFilter = ctx.createBiquadFilter();
    screechFilter.type = 'bandpass';
    screechFilter.frequency.value = 1100;
    screechFilter.Q.value = 6;
    screechGain = ctx.createGain();
    screechGain.gain.value = 0;
    screechSrc.connect(screechFilter).connect(screechGain).connect(master);
    screechSrc.start();

    // --- horn: classic two-tone (roughly a major third apart) -------------
    hornGain = ctx.createGain();
    hornGain.gain.value = 0;
    const hornFilter = ctx.createBiquadFilter();
    hornFilter.type = 'lowpass';
    hornFilter.frequency.value = 2400;
    hornFilter.Q.value = 1.2;
    for (const f of [420, 528]) {
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = 0.5;
      osc.connect(g).connect(hornFilter);
      osc.start();
    }
    hornFilter.connect(hornGain).connect(master);
  }

  return {
    // call from any input handler — first call boots the context
    resume() {
      if (!ctx) { try { init(); } catch { return; } }
      if (ctx.state === 'suspended') ctx.resume();
    },
    toggleMute() {
      muted = !muted;
      if (master) master.gain.value = muted ? 0 : 0.22;
      return muted;
    },
    // st: {kmh, throttle, slip, brake, speed} — null while in attract mode
    update(st, dt) {
      if (!ctx || ctx.state !== 'running') return;
      const t = ctx.currentTime;
      if (!st) {
        engineGain.gain.setTargetAtTime(0, t, 0.2);
        screechGain.gain.setTargetAtTime(0, t, 0.1);
        hornGain.gain.setTargetAtTime(0, t, 0.03);
        return;
      }
      hornGain.gain.setTargetAtTime(st.horn ? 0.34 : 0, t, st.horn ? 0.01 : 0.05);
      // fake RPM: speed through 5 gears, throttle opens the filter
      const gearPos = Math.min(st.kmh, 219) / 44; // 0..5
      const inGear = gearPos - Math.floor(gearPos);
      const rpm = 55 + inGear * 75 + Math.min(st.kmh / 220, 1) * 25;
      engineOsc.frequency.setTargetAtTime(rpm, t, 0.04);
      engineSub.frequency.setTargetAtTime(rpm / 2, t, 0.04);
      engineFilter.frequency.setTargetAtTime(380 + st.throttle * 1400 + st.kmh * 3, t, 0.08);
      engineGain.gain.setTargetAtTime(0.16 + st.throttle * 0.2, t, 0.1);

      // screech from lateral slip, plus locked-up braking at speed
      const slipAmt = Math.max(0, (st.slip - 2.2) / 7);
      const brakeAmt = st.brake > 0.65 && st.speed > 14 ? 0.45 : 0;
      const amt = Math.min(1, Math.max(slipAmt, brakeAmt));
      screechGain.gain.setTargetAtTime(amt * 0.5, t, amt > 0 ? 0.03 : 0.12);
      screechFilter.frequency.setTargetAtTime(950 + amt * 450 + Math.sin(t * 37) * 60, t, 0.05);
    },
  };
}
