// audio.js — musiques et bruitages entièrement synthétisés (Web Audio, aucun fichier)
// Le contexte ne démarre qu'après un geste de l'utilisateur, conformément aux navigateurs.

const store = {
  music: readVol('webno.vol.music', 0.45),
  sfx: readVol('webno.vol.sfx', 0.7),
};

function readVol(key, dflt) {
  try { const v = parseFloat(localStorage.getItem(key)); return isNaN(v) ? dflt : Math.min(1, Math.max(0, v)); }
  catch (_) { return dflt; }
}
function writeVol(key, v) { try { localStorage.setItem(key, String(v)); } catch (_) {} }

let ctx = null, master = null, musicBus = null, sfxBus = null, verb = null, ready = false;
let track = null, timer = null, step = 0, nextTime = 0;

/* ───────────────────────── mise en place ───────────────────────── */
function ensure() {
  if (ready) return true;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return false;
  try {
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 6; comp.attack.value = 0.004; comp.release.value = 0.22;
    master.connect(comp); comp.connect(ctx.destination);

    verb = ctx.createConvolver();
    verb.buffer = impulse(2.1, 2.6);
    const verbGain = ctx.createGain();
    verbGain.gain.value = 0.5;
    verb.connect(verbGain); verbGain.connect(master);

    musicBus = ctx.createGain(); musicBus.gain.value = store.music;
    sfxBus = ctx.createGain();   sfxBus.gain.value = store.sfx;
    musicBus.connect(master); sfxBus.connect(master);
    ready = true;
    return true;
  } catch (_) { return false; }
}

function impulse(seconds, decay) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
  }
  return buf;
}

function noiseBuffer(seconds = 1) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

/** À appeler sur le premier geste utilisateur. */
export function unlock() {
  if (!ensure()) return;
  if (ctx.state === 'suspended') ctx.resume();
}

export function volumes() { return { music: store.music, sfx: store.sfx }; }

export function setMusicVolume(v) {
  store.music = Math.min(1, Math.max(0, v));
  writeVol('webno.vol.music', store.music);
  if (musicBus) musicBus.gain.setTargetAtTime(store.music, ctx.currentTime, 0.05);
}

export function setSfxVolume(v) {
  store.sfx = Math.min(1, Math.max(0, v));
  writeVol('webno.vol.sfx', store.sfx);
  if (sfxBus) sfxBus.gain.setTargetAtTime(store.sfx, ctx.currentTime, 0.05);
}

/* ───────────────────────── instruments ───────────────────────── */
const N = { C2: 65.41, D2: 73.42, E2: 82.41, F2: 87.31, G2: 98, A2: 110, B2: 123.47,
  C3: 130.81, D3: 146.83, E3: 164.81, F3: 174.61, G3: 196, A3: 220, B3: 246.94,
  C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392, A4: 440, B4: 493.88,
  C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880, B5: 987.77, C6: 1046.5 };

function env(node, t, a, d, s, r, peak = 1, sustain = 0.6) {
  const g = node.gain;
  g.setValueAtTime(0.0001, t);
  g.exponentialRampToValueAtTime(peak, t + a);
  g.exponentialRampToValueAtTime(Math.max(peak * sustain, 0.0001), t + a + d);
  g.setValueAtTime(Math.max(peak * sustain, 0.0001), t + a + d + s);
  g.exponentialRampToValueAtTime(0.0001, t + a + d + s + r);
}

function pad(freq, t, dur, bus, gain = 0.05) {
  for (const detune of [-7, 7]) {
    const o = ctx.createOscillator();
    o.type = 'sawtooth'; o.frequency.value = freq; o.detune.value = detune;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 620; f.Q.value = 0.7;
    const g = ctx.createGain();
    env(g, t, 0.5, 0.4, Math.max(dur - 1.4, 0.1), 0.9, gain, 0.7);
    o.connect(f); f.connect(g); g.connect(bus);
    const send = ctx.createGain(); send.gain.value = 0.5; g.connect(send); send.connect(verb);
    o.start(t); o.stop(t + dur + 1.2);
  }
}

function pluck(freq, t, bus, gain = 0.14, dur = 0.5, type = 'triangle') {
  const o = ctx.createOscillator();
  o.type = type; o.frequency.value = freq;
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.setValueAtTime(3200, t);
  f.frequency.exponentialRampToValueAtTime(700, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(f); f.connect(g); g.connect(bus);
  const send = ctx.createGain(); send.gain.value = 0.28; g.connect(send); send.connect(verb);
  o.start(t); o.stop(t + dur + 0.05);
}

function bass(freq, t, dur, bus, gain = 0.2) {
  const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = freq;
  const o2 = ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = freq * 2; 
  const g2 = ctx.createGain(); g2.gain.value = 0.18;
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 420;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.03);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(f); o2.connect(g2); g2.connect(f); f.connect(g); g.connect(bus);
  o.start(t); o.stop(t + dur + 0.05); o2.start(t); o2.stop(t + dur + 0.05);
}

function kick(t, bus, gain = 0.5) {
  const o = ctx.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(130, t);
  o.frequency.exponentialRampToValueAtTime(44, t + 0.09);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
  o.connect(g); g.connect(bus);
  o.start(t); o.stop(t + 0.3);
}

function perc(t, bus, { freq = 6000, q = 1.2, dur = 0.05, gain = 0.1, type = 'highpass' } = {}) {
  const s = ctx.createBufferSource(); s.buffer = noiseBuffer(0.2);
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f); f.connect(g); g.connect(bus);
  s.start(t); s.stop(t + dur + 0.05);
}

/* ───────────────────────── musiques ───────────────────────── */
// Deux ambiances : le menu est enjoué, la table plus feutrée pour tenir la durée.
const TRACKS = {
  menu: {
    bpm: 100, gain: 0.9,
    chords: [
      { pad: [N.C3, N.E3, N.G3, N.B3], arp: [N.C4, N.E4, N.G4, N.B4], bass: N.C2 },
      { pad: [N.A2, N.C3, N.E3, N.G3], arp: [N.A3, N.C4, N.E4, N.G4], bass: N.A2 },
      { pad: [N.F2, N.A2, N.C3, N.E3], arp: [N.F3, N.A3, N.C4, N.E4], bass: N.F2 },
      { pad: [N.G2, N.B2, N.D3, N.E3], arp: [N.G3, N.B3, N.D4, N.E4], bass: N.G2 },
    ],
    play(bar, beat, sixteenth, t, bus) {
      const ch = this.chords[bar % 4];
      if (beat === 0 && sixteenth === 0) {
        for (const f of ch.pad) pad(f, t, this.beat * 4, bus, 0.042);
        bass(ch.bass, t, this.beat * 1.6, bus, 0.17);
      }
      if (sixteenth === 0 && (beat === 0 || beat === 2)) kick(t, bus, 0.34);
      if (sixteenth === 2) perc(t, bus, { freq: 8200, dur: 0.035, gain: 0.055 });
      if (sixteenth === 0 && beat === 2) bass(ch.bass * 1.5, t, this.beat, bus, 0.1);
      // arpège en croches, montée puis descente sur deux mesures
      if (sixteenth % 2 === 0) {
        const idx = beat * 2 + sixteenth / 2;
        const seq = bar % 2 === 0 ? [0, 1, 2, 3, 2, 1, 0, 1] : [3, 2, 1, 0, 1, 2, 3, 2];
        pluck(ch.arp[seq[idx % 8]], t, bus, 0.075, 0.42);
      }
    },
  },
  game: {
    bpm: 78, gain: 0.62,
    chords: [
      { pad: [N.A2, N.C3, N.E3, N.G3], arp: [N.A3, N.C4, N.E4], bass: N.A2 },
      { pad: [N.F2, N.A2, N.C3, N.E3], arp: [N.F3, N.A3, N.C4], bass: N.F2 },
      { pad: [N.C3, N.E3, N.G3, N.B3], arp: [N.C4, N.E4, N.G4], bass: N.C2 },
      { pad: [N.G2, N.B2, N.D3, N.F3], arp: [N.G3, N.B3, N.D4], bass: N.G2 },
    ],
    play(bar, beat, sixteenth, t, bus) {
      const ch = this.chords[bar % 4];
      if (beat === 0 && sixteenth === 0) {
        for (const f of ch.pad) pad(f, t, this.beat * 4, bus, 0.036);
        bass(ch.bass, t, this.beat * 2, bus, 0.15);
      }
      if (beat === 2 && sixteenth === 0) bass(ch.bass * 1.335, t, this.beat * 1.2, bus, 0.1);
      if (sixteenth === 0 && beat % 2 === 0) kick(t, bus, 0.2);
      if (sixteenth === 2 && beat % 2 === 1) perc(t, bus, { freq: 5200, dur: 0.06, gain: 0.04 });
      // quelques notes égrenées seulement, pour ne pas fatiguer
      if (sixteenth === 0 && (beat === 1 || beat === 3)) {
        pluck(ch.arp[(bar + beat) % ch.arp.length], t, bus, 0.055, 0.7);
      }
    },
  },
};

function scheduler() {
  if (!track) return;
  const t = TRACKS[track];
  const horizon = ctx.currentTime + 0.25;
  while (nextTime < horizon) {
    const sixteenth = step % 4;
    const beat = Math.floor(step / 4) % 4;
    const bar = Math.floor(step / 16);
    try { t.play(bar, beat, sixteenth, nextTime, musicBus); } catch (_) {}
    nextTime += t.beat / 4;
    step++;
  }
}

/** track : 'menu' | 'game' | null */
export function playMusic(name) {
  if (!ensure()) return;
  if (track === name) return;
  stopMusic();
  if (!name || !TRACKS[name]) return;
  const t = TRACKS[name];
  t.beat = 60 / t.bpm;
  track = name; step = 0;
  nextTime = ctx.currentTime + 0.12;
  musicBus.gain.cancelScheduledValues(ctx.currentTime);
  musicBus.gain.setValueAtTime(0.0001, ctx.currentTime);
  musicBus.gain.exponentialRampToValueAtTime(Math.max(store.music * t.gain, 0.0001), ctx.currentTime + 1.6);
  timer = setInterval(scheduler, 25);
  scheduler();
}

export function stopMusic() {
  if (timer) { clearInterval(timer); timer = null; }
  if (ready && musicBus) {
    musicBus.gain.cancelScheduledValues(ctx.currentTime);
    musicBus.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.25);
  }
  track = null;
}

/* ───────────────────────── bruitages ───────────────────────── */
const SFX = {
  // glissement de carte sur le feutre puis claquement
  play(t) {
    const s = ctx.createBufferSource(); s.buffer = noiseBuffer(0.3);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.1;
    f.frequency.setValueAtTime(2600, t);
    f.frequency.exponentialRampToValueAtTime(760, t + 0.13);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    s.connect(f); f.connect(g); g.connect(sfxBus);
    s.start(t); s.stop(t + 0.2);
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(210, t + 0.02); o.frequency.exponentialRampToValueAtTime(90, t + 0.1);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.22, t + 0.02); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(og); og.connect(sfxBus); o.start(t + 0.02); o.stop(t + 0.15);
  },
  draw(t) {
    const s = ctx.createBufferSource(); s.buffer = noiseBuffer(0.3);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 0.9;
    f.frequency.setValueAtTime(1200, t);
    f.frequency.exponentialRampToValueAtTime(3400, t + 0.11);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.3, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    s.connect(f); f.connect(g); g.connect(sfxBus);
    s.start(t); s.stop(t + 0.2);
  },
  shuffle(t) { for (let i = 0; i < 7; i++) SFX.draw(t + i * 0.055); },
  deal(t) { for (let i = 0; i < 4; i++) SFX.play(t + i * 0.08); },
  uno(t) {
    [N.C5, N.E5, N.G5, N.C6].forEach((f, i) => pluck(f, t + i * 0.075, sfxBus, 0.2, 0.5, 'triangle'));
    perc(t + 0.3, sfxBus, { freq: 9000, dur: 0.3, gain: 0.06 });
  },
  penalty(t) {
    [N.E3, N.C3].forEach((f, i) => {
      const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = f;
      const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = 900;
      const g = ctx.createGain();
      const tt = t + i * 0.13;
      g.gain.setValueAtTime(0.0001, tt);
      g.gain.exponentialRampToValueAtTime(0.16, tt + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.22);
      o.connect(fl); fl.connect(g); g.connect(sfxBus);
      o.start(tt); o.stop(tt + 0.25);
    });
  },
  swap(t) {
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(320, t);
    o.frequency.exponentialRampToValueAtTime(880, t + 0.16);
    o.frequency.exponentialRampToValueAtTime(360, t + 0.34);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.36);
    o.connect(g); g.connect(sfxBus);
    const send = ctx.createGain(); send.gain.value = 0.4; g.connect(send); send.connect(verb);
    o.start(t); o.stop(t + 0.4);
  },
  rotate(t) {
    const s = ctx.createBufferSource(); s.buffer = noiseBuffer(0.6);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 3;
    f.frequency.setValueAtTime(500, t);
    f.frequency.exponentialRampToValueAtTime(4200, t + 0.42);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.1);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.46);
    s.connect(f); f.connect(g); g.connect(sfxBus);
    s.start(t); s.stop(t + 0.5);
  },
  color(t) {
    [N.G4, N.C5].forEach((f, i) => pluck(f, t + i * 0.06, sfxBus, 0.14, 0.5, 'sine'));
  },
  win(t) {
    const notes = [N.C4, N.E4, N.G4, N.C5, N.E5, N.G5, N.C6];
    notes.forEach((f, i) => pluck(f, t + i * 0.085, sfxBus, 0.2, 0.9, 'triangle'));
    [N.C3, N.E3, N.G3, N.C4].forEach((f) => pad(f, t + 0.6, 2.4, sfxBus, 0.09));
    kick(t + 0.6, sfxBus, 0.4);
  },
  lose(t) {
    [N.G3, N.F3, N.E3, N.C3].forEach((f, i) => pluck(f, t + i * 0.13, sfxBus, 0.15, 0.7, 'sine'));
  },
  click(t) {
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(660, t);
    o.frequency.exponentialRampToValueAtTime(920, t + 0.05);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.11, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    o.connect(g); g.connect(sfxBus); o.start(t); o.stop(t + 0.1);
  },
  error(t) {
    const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = 150;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.1, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(g); g.connect(sfxBus); o.start(t); o.stop(t + 0.2);
  },
  turn(t) {
    [N.A4, N.E5].forEach((f, i) => {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.1 - i * 0.04, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
      o.connect(g); g.connect(sfxBus);
      const send = ctx.createGain(); send.gain.value = 0.5; g.connect(send); send.connect(verb);
      o.start(t); o.stop(t + 0.75);
    });
  },
  join(t) { [N.E4, N.A4, N.C5].forEach((f, i) => pluck(f, t + i * 0.07, sfxBus, 0.14, 0.45, 'triangle')); },
  jump(t) { [N.D5, N.A5].forEach((f, i) => pluck(f, t + i * 0.05, sfxBus, 0.16, 0.3, 'square')); },
};

export function sfx(name, delay = 0) {
  if (!ready) { if (!ensure()) return; }
  if (ctx.state === 'suspended') return;
  const fn = SFX[name];
  if (!fn) return;
  try { fn(ctx.currentTime + delay); } catch (_) {}
}

export function isReady() { return ready && ctx && ctx.state === 'running'; }
