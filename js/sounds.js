// Sound Effects (Web Audio API)
const { ref } = Vue;

let audioCtx = null;
export const soundOn = ref(localStorage.getItem('jigsaw_sound') !== 'off');
let soundEnabled = false;

function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

export function enableSound() {
  soundEnabled = true;
}

export function toggleSound() {
  soundOn.value = !soundOn.value;
  localStorage.setItem('jigsaw_sound', soundOn.value ? 'on' : 'off');
}

export function playThump() {
  if (!soundEnabled || !soundOn.value) return;
  const ctx = getAudioCtx();
  const t = ctx.currentTime;
  // Warm body tone — two detuned sines for woody resonance
  [150, 120].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.5, t + 0.1);
    g.gain.setValueAtTime(i === 0 ? 0.35 : 0.2, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    lp.type = 'lowpass';
    lp.frequency.value = 400;
    osc.connect(lp).connect(g).connect(ctx.destination);
    osc.start(t); osc.stop(t + 0.15);
  });
  // Filtered noise for percussive attack
  const buf = ctx.createBuffer(1, ctx.sampleRate * 0.05 | 0, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const ns = ctx.createBufferSource();
  const ng = ctx.createGain();
  const bp = ctx.createBiquadFilter();
  ns.buffer = buf;
  bp.type = 'bandpass'; bp.frequency.value = 300; bp.Q.value = 1.5;
  ng.gain.setValueAtTime(0.4, t);
  ng.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
  ns.connect(bp).connect(ng).connect(ctx.destination);
  ns.start(t);
}

export function playClick() {
  if (!soundEnabled || !soundOn.value) return;
  const ctx = getAudioCtx();
  const t = ctx.currentTime;
  // Sharp noise transient — highpass filtered snap
  const buf = ctx.createBuffer(1, ctx.sampleRate * 0.03 | 0, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const ns = ctx.createBufferSource();
  const ng = ctx.createGain();
  const hp = ctx.createBiquadFilter();
  ns.buffer = buf;
  hp.type = 'highpass'; hp.frequency.value = 2000; hp.Q.value = 0.7;
  ng.gain.setValueAtTime(0.25, t);
  ng.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
  ns.connect(hp).connect(ng).connect(ctx.destination);
  ns.start(t);
  // Tonal ping for satisfying "lock" feel
  const osc = ctx.createOscillator();
  const og = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(1100, t);
  osc.frequency.exponentialRampToValueAtTime(800, t + 0.05);
  og.gain.setValueAtTime(0.15, t);
  og.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
  osc.connect(og).connect(ctx.destination);
  osc.start(t); osc.stop(t + 0.08);
}
