// Renders an original dark-tension loop to public/soundtrack.wav (no samples, pure synthesis).
// Run: node tools/make-soundtrack.js   (~72 s, 22050 Hz mono 16-bit, loops seamlessly)
const fs = require('fs'), path = require('path');
const SR = 22050, BPM = 80, BEAT = 60 / BPM, BARS = 24;
const N = Math.round(SR * BEAT * 4 * BARS);
const buf = new Float32Array(N);
const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
// add a sound; writes wrap around the end so the loop has no seam
const put = (t, len, fn) => {
  const s0 = Math.round(t * SR), n = Math.round(len * SR);
  for (let i = 0; i < n; i++) buf[(s0 + i) % N] += fn(i / SR, i / n);
};
let seed = 7; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
const tri = (p) => 2 * Math.abs(2 * (p - Math.floor(p + 0.5))) - 1;

// chord progression, 4 bars each, repeated: Am - F - Dm - E  (root midi, minor/major third)
const prog = [[45, 3], [41, 4], [38, 3], [40, 4]];
for (let bar = 0; bar < BARS; bar++) {
  const [root, third] = prog[Math.floor(bar / 2) % 4];
  const t0 = bar * 4 * BEAT, section = Math.floor(bar / 8); // 0 intro, 1 build, 2 full
  // sub drone pad (two detuned sines, slow swell)
  for (const d of [0, 0.3]) put(t0, 4 * BEAT + 0.5, (t, p) => {
    const env = Math.min(1, t / 1.5) * Math.min(1, (4 * BEAT + 0.5 - t) / 1.2);
    return 0.16 * env * Math.sin(2 * Math.PI * (hz(root - 12) + d) * t);
  });
  // cold pad: root, third, fifth, filtered by soft triangle
  for (const iv of [0, third, 7]) put(t0, 4 * BEAT + 0.8, (t) => {
    const env = Math.min(1, t / 2) * Math.min(1, (4 * BEAT + 0.8 - t) / 1.5);
    return 0.05 * (section ? 1 : 0.5) * env * tri(hz(root + 12 + iv) * t);
  });
  // heartbeat kick on beats 1 and 3 (from section 1: every beat)
  for (let b = 0; b < 4; b++) {
    if (section === 0 && b % 2) continue;
    put(t0 + b * BEAT, 0.35, (t) => 0.55 * Math.exp(-t * 14) * Math.sin(2 * Math.PI * (48 + 90 * Math.exp(-t * 30)) * t));
  }
  // ticking clock: short noise ticks on eighth notes
  for (let e = 0; e < 8; e++) put(t0 + e * BEAT / 2, 0.03, (t) => 0.07 * rnd() * Math.exp(-t * 150) * (e % 2 ? 0.6 : 1));
  // pulsing bass eighths (section 2)
  if (section === 2) for (let e = 0; e < 8; e++) put(t0 + e * BEAT / 2, BEAT / 2, (t, p) =>
    0.13 * (1 - p) * Math.sin(2 * Math.PI * hz(root - 12) * t) + 0.04 * (1 - p) * tri(hz(root - 12) * t * 2));
  // arpeggio blips, echoing (section 1+)
  if (section >= 1) {
    const arp = [0, 7, third + 12, 12, third + 12, 7, 0, 7];
    for (let e = 0; e < 8; e++) for (const [dly, g] of [[0, 1], [BEAT * 0.75, 0.35], [BEAT * 1.5, 0.15]])
      put(t0 + e * BEAT / 2 + dly, 0.25, (t) => 0.07 * g * Math.exp(-t * 12) * Math.sin(2 * Math.PI * hz(root + 24 + arp[e]) * t));
  }
}
// distant radio static bursts + a rising siren swell every 8 bars
for (let k = 0; k < 6; k++) put((k * 4 + 3.2) * 4 * BEAT / 2, 0.4, (t, p) => 0.05 * rnd() * Math.sin(Math.PI * p) * (Math.sin(t * 60) > 0 ? 1 : 0.2));
for (let k = 0; k < 3; k++) put(k * 8 * 4 * BEAT + 6 * 4 * BEAT, 2 * 4 * BEAT, (t, p) =>
  0.05 * Math.sin(Math.PI * p) * Math.sin(2 * Math.PI * (220 + 40 * p) * t + 3 * Math.sin(2 * Math.PI * 0.5 * t)));
// soft limit + write wav
let peak = 0; for (const v of buf) peak = Math.max(peak, Math.abs(v));
const out = Buffer.alloc(44 + N * 2);
out.write('RIFF', 0); out.writeUInt32LE(36 + N * 2, 4); out.write('WAVEfmt ', 8); out.writeUInt32LE(16, 16);
out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22); out.writeUInt32LE(SR, 24); out.writeUInt32LE(SR * 2, 28);
out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34); out.write('data', 36); out.writeUInt32LE(N * 2, 40);
for (let i = 0; i < N; i++) out.writeInt16LE(Math.round(Math.tanh(buf[i] / peak * 1.4) * 0.9 * 32767), 44 + i * 2);
const file = path.join(__dirname, '..', 'public', 'soundtrack.wav');
fs.writeFileSync(file, out);
console.log('wrote', file, (out.length / 1e6).toFixed(1) + ' MB,', (N / SR).toFixed(1) + ' s, peak before limit', peak.toFixed(2));
