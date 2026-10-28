// The spectrogram /triage draws in the browser, kept apart from the page so it can be checked without one.
//
// 50 Hz to 16 kHz on a log scale, so a ship horn's low hum and a bird's song are both readable; for a clip slowed down
// `slow` times (a bat clip, ten times), 10 to 100 kHz as the microphone heard it, where bats call. Each column keeps the
// loudest of every window in its stretch of time, so a bat's call of a few milliseconds is not stepped over.

export type Spectrum = {
  /** dB per column and row, row 0 at the top (highest frequency) */
  db: Float32Array;
  frames: number;
  rows: number;
  top: number;
  /** the frequency range drawn, in the clip's own frequencies */
  fmin: number;
  fmax: number;
};

export function spectrogram(x: Float32Array, rate: number, slow = 1, width = 900, rows = 240): Spectrum {
  const N = 2048;
  const frames = Math.max(1, Math.min(width, Math.floor((x.length - N) / (N / 4))));
  const span = Math.max(0, x.length - N) / frames;
  const win = new Float32Array(N).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
  // a slowed-down clip carries everything slow times lower
  const fmin = slow > 1 ? 10000 / slow : 50;
  const fmax = Math.min(slow > 1 ? 100000 / slow : 16000, rate / 2);
  const rowBin = Array.from({ length: rows }, (_, y) => Math.round((fmin * Math.pow(fmax / fmin, (rows - 1 - y) / (rows - 1)) * N) / rate));
  const db = new Float32Array(frames * rows).fill(-Infinity);
  const re = new Float32Array(N);
  const im = new Float32Array(N);
  let top = -Infinity;
  for (let f = 0; f < frames; f++) {
    const start = Math.floor(f * span);
    const end = Math.floor((f + 1) * span);
    for (let s = start; s === start || s < end; s += N / 2) {
      for (let i = 0; i < N; i++) {
        re[i] = (x[s + i] ?? 0) * win[i];
        im[i] = 0;
      }
      fft(re, im);
      for (let y = 0; y < rows; y++) {
        const k = rowBin[y];
        const v = 10 * Math.log10(re[k] * re[k] + im[k] * im[k] + 1e-12);
        if (v > db[f * rows + y]) db[f * rows + y] = v;
        if (v > top) top = v;
      }
    }
  }
  return { db, frames, rows, top, fmin, fmax };
}

/** The row a frequency as heard (before any slowing down) falls on, or null when it is outside the range drawn. */
export function rowOf(s: Spectrum, heardHz: number, slow = 1): number | null {
  const at = heardHz / slow;
  if (at < s.fmin || at > s.fmax) return null;
  return s.rows - 1 - ((s.rows - 1) * Math.log(at / s.fmin)) / Math.log(s.fmax / s.fmin);
}

/** In-place radix-2 FFT; re and im have a power-of-two length. */
export function fft(re: Float32Array, im: Float32Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (-2 * Math.PI) / len;
    const wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const u = i + k, v = u + len / 2;
        const br = re[v] * cr - im[v] * ci;
        const bi = re[v] * ci + im[v] * cr;
        re[v] = re[u] - br; im[v] = im[u] - bi;
        re[u] += br; im[u] += bi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}
