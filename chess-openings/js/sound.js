// Small synthesized sound effects (no audio files needed).
let ctx = null;
let enabled = true;

function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function knock(t, freq, gain, len) {
  const a = audio();
  if (!a) return;
  const buf = a.createBuffer(1, Math.floor(a.sampleRate * len), a.sampleRate);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < ch.length; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / ch.length, 4);
  const src = a.createBufferSource();
  src.buffer = buf;
  const filter = a.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = freq;
  filter.Q.value = 1.4;
  const g = a.createGain();
  g.gain.value = gain;
  src.connect(filter).connect(g).connect(a.destination);
  src.start(a.currentTime + t);
}

function tone(t, freq, len, type = 'sine', gain = 0.12) {
  const a = audio();
  if (!a) return;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.value = freq;
  const start = a.currentTime + t;
  g.gain.setValueAtTime(0, start);
  g.gain.linearRampToValueAtTime(gain, start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, start + len);
  o.connect(g).connect(a.destination);
  o.start(start);
  o.stop(start + len + 0.05);
}

export const sound = {
  setEnabled(v) {
    enabled = v;
  },
  get enabled() {
    return enabled;
  },
  unlock() {
    if (enabled) audio();
  },
  move() {
    if (enabled) knock(0, 900, 1.6, 0.07);
  },
  capture() {
    if (!enabled) return;
    knock(0, 700, 2.2, 0.09);
    knock(0.045, 1300, 1.2, 0.06);
  },
  check() {
    if (!enabled) return;
    knock(0, 900, 1.6, 0.07);
    tone(0.02, 880, 0.18, 'triangle', 0.08);
  },
  good() {
    if (!enabled) return;
    tone(0, 660, 0.14, 'sine', 0.1);
    tone(0.09, 990, 0.2, 'sine', 0.1);
  },
  bad() {
    if (enabled) tone(0, 180, 0.25, 'sawtooth', 0.06);
  },
  done() {
    if (!enabled) return;
    [523, 659, 784, 1047].forEach((f, i) => tone(i * 0.09, f, 0.25, 'sine', 0.09));
  },
};
