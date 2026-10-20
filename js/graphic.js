import { AUDIO_LIMITS, FILTER_TYPE } from "./constants.js";
import { filterResponse } from "./eq.js";

// The ten fixed sliders of a classic graphic EQ (Apple Music, iTunes, most car stereos).
export const GRAPHIC_FREQS = [
  32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000,
];
export const GRAPHIC_LABELS = [
  "32",
  "64",
  "125",
  "250",
  "500",
  "1K",
  "2K",
  "4K",
  "8K",
  "16K",
];
export const GRAPHIC_RANGE = { MIN: -12, MAX: 12, STEP: 0.5 };
export const PREAMP_RANGE = { MIN: -12, MAX: 0, STEP: 0.5 };

// The classic iTunes / Apple Music preset set. Values are approximate
// transcriptions, not Apple's exact numbers.
export const GRAPHIC_PRESETS = {
  Flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  Acoustic: [5, 5, 4, 1, 1.5, 1.5, 3.5, 4, 3.5, 2],
  "Bass Booster": [5.5, 4.5, 3.5, 2.5, 1.5, 0, 0, 0, 0, 0],
  "Bass Reducer": [-5.5, -4.5, -3.5, -2.5, -1.5, 0, 0, 0, 0, 0],
  Classical: [4.5, 4, 3, 2.5, -1.5, -1.5, 0, 2, 3, 3.5],
  Dance: [3.5, 6.5, 5, 0, 2, 3.5, 5, 4.5, 3.5, 0],
  Deep: [5, 3.5, 1.5, 1, 3, 2.5, 1.5, -2, -3.5, -4.5],
  Electronic: [4, 3.5, 1, 0, -2, 2, 1, 1, 4, 5],
  "Hip-Hop": [5, 4, 1.5, 3, -1, -1, 1.5, -0.5, 2, 3],
  Jazz: [4, 3, 1.5, 2, -1.5, -1.5, 0, 1.5, 3, 3.5],
  Latin: [4.5, 3, 0, 0, -1.5, -1.5, -1.5, 0, 3, 4.5],
  Loudness: [6, 4, 0, 0, -2, 0, -1, -5, 5, 1],
  Lounge: [-3, -1.5, -0.5, 1.5, 4, 2.5, 0, -1.5, 2, 1],
  Piano: [3, 2, 0, 2.5, 3, 1.5, 3.5, 4.5, 3, 3.5],
  Pop: [-1.5, -1, 0, 2, 4, 4, 2, 0, -1, -1.5],
  "R&B": [2.5, 7, 5.5, 1.5, -2, -1.5, 2.5, 2.5, 3, 3.5],
  Rock: [5, 4, 3, 1.5, -0.5, -1, 0.5, 2.5, 3.5, 4.5],
  "Small Speakers": [5.5, 4.5, 3.5, 2.5, 1.5, 0, -1.5, -2.5, -3.5, -4.5],
  "Spoken Word": [-3.5, -0.5, 0, 0.5, 3.5, 4.5, 5, 4.5, 2.5, 0],
  "Treble Booster": [0, 0, 0, 0, 0, 1.5, 2.5, 3.5, 4.5, 5.5],
  "Treble Reducer": [0, 0, 0, 0, 0, -1.5, -2.5, -3.5, -4.5, -5.5],
  "Vocal Booster": [-1.5, -3, -3, 1.5, 3.5, 3.5, 3, 1.5, 0, -1.5],
};

// Stored or imported slider values: exactly ten finite numbers within range.
export function sanitizeGains(gains) {
  if (!Array.isArray(gains) || gains.length !== GRAPHIC_FREQS.length)
    return null;
  if (!gains.every((g) => typeof g === "number" && Number.isFinite(g)))
    return null;
  return gains.map((g) =>
    Math.max(GRAPHIC_RANGE.MIN, Math.min(GRAPHIC_RANGE.MAX, g)),
  );
}

const F_MIN = AUDIO_LIMITS.FREQ.MIN;
const F_MAX = AUDIO_LIMITS.FREQ.MAX;
const SAMPLE_COUNT = 120;
const SAMPLE_FREQS = Array.from(
  { length: SAMPLE_COUNT },
  (_, i) => F_MIN * Math.pow(F_MAX / F_MIN, i / (SAMPLE_COUNT - 1)),
);
// Below the 32 Hz and above the 16 kHz slider nobody hears much detail; weight it down.
const SAMPLE_WEIGHTS = SAMPLE_FREQS.map((f) => (f < 28 || f > 18000 ? 0.4 : 1));

// Smooth curve through the slider knobs (monotone cubic in log-frequency), held flat
// past the outermost sliders. This is the curve the sliders visibly draw.
export function graphicTarget(gains, freqs = SAMPLE_FREQS) {
  const xs = GRAPHIC_FREQS.map((f) => Math.log10(f));
  const n = xs.length;
  const h = xs.slice(1).map((x, i) => x - xs[i]);
  const d = h.map((hi, i) => (gains[i + 1] - gains[i]) / hi);
  const m = new Array(n);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) {
      m[i] = 0;
    } else {
      const w1 = 2 * h[i] + h[i - 1];
      const w2 = h[i] + 2 * h[i - 1];
      m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
    }
  }
  // Flat ends: the curve leaves the outer knobs horizontally.
  m[0] = 0;
  m[n - 1] = 0;

  return freqs.map((f) => {
    const x = Math.log10(f);
    if (x <= xs[0]) return gains[0];
    if (x >= xs[n - 1]) return gains[n - 1];
    let k = 0;
    while (x > xs[k + 1]) k++;
    const t = (x - xs[k]) / h[k];
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * gains[k] +
      (t3 - 2 * t2 + t) * h[k] * m[k] +
      (-2 * t3 + 3 * t2) * gains[k + 1] +
      (t3 - t2) * h[k] * m[k + 1]
    );
  });
}

const TYPE_LAYOUTS = [
  [
    FILTER_TYPE.LOW_SHELF,
    FILTER_TYPE.PEAK,
    FILTER_TYPE.PEAK,
    FILTER_TYPE.PEAK,
    FILTER_TYPE.HIGH_SHELF,
  ],
  [
    FILTER_TYPE.LOW_SHELF,
    FILTER_TYPE.PEAK,
    FILTER_TYPE.PEAK,
    FILTER_TYPE.PEAK,
    FILTER_TYPE.PEAK,
  ],
  [
    FILTER_TYPE.PEAK,
    FILTER_TYPE.PEAK,
    FILTER_TYPE.PEAK,
    FILTER_TYPE.PEAK,
    FILTER_TYPE.HIGH_SHELF,
  ],
  [
    FILTER_TYPE.PEAK,
    FILTER_TYPE.PEAK,
    FILTER_TYPE.PEAK,
    FILTER_TYPE.PEAK,
    FILTER_TYPE.PEAK,
  ],
];

const Q_LIMITS = {
  [FILTER_TYPE.PEAK]: [0.3, 5],
  [FILTER_TYPE.LOW_SHELF]: [0.4, 1.5],
  [FILTER_TYPE.HIGH_SHELF]: [0.4, 1.5],
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Fitted centres stay away from the top octave, where the DSP's digital filters
// stop behaving like the analog curve drawn on screen.
const FIT_F_MIN = 25;
const FIT_F_MAX = 16000;

// Parameter vector per band: [log(freq), gain, log(q)].
function project(p, types) {
  for (let b = 0; b < types.length; b++) {
    const [qMin, qMax] = Q_LIMITS[types[b]];
    p[3 * b] = clamp(p[3 * b], Math.log(FIT_F_MIN), Math.log(FIT_F_MAX));
    p[3 * b + 1] = clamp(
      p[3 * b + 1],
      AUDIO_LIMITS.GAIN.MIN,
      AUDIO_LIMITS.GAIN.MAX,
    );
    p[3 * b + 2] = clamp(p[3 * b + 2], Math.log(qMin), Math.log(qMax));
  }
  return p;
}

function residuals(p, types, target, out) {
  for (let k = 0; k < SAMPLE_COUNT; k++) {
    let sum = 0;
    for (let b = 0; b < types.length; b++) {
      sum += filterResponse(
        SAMPLE_FREQS[k],
        Math.exp(p[3 * b]),
        p[3 * b + 1],
        Math.exp(p[3 * b + 2]),
        types[b],
      );
    }
    out[k] = SAMPLE_WEIGHTS[k] * (sum - target[k]);
  }
  // Light penalty on each band's gain: among curves that fit equally well, prefer the
  // one without big boosts cancelling each other (they waste headroom).
  for (let b = 0; b < types.length; b++) {
    out[SAMPLE_COUNT + b] = GAIN_PENALTY * p[3 * b + 1];
  }
  return out;
}

const GAIN_PENALTY = 0.08;
const residualCount = (types) => SAMPLE_COUNT + types.length;

const sumSq = (r) => r.reduce((s, v) => s + v * v, 0);

function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) {
      if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    }
    if (Math.abs(M[piv][c]) < 1e-12) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}

// Levenberg-Marquardt with a numeric Jacobian, projected onto the hardware limits.
function levenbergMarquardt(p0, types, target, iterations) {
  const n = p0.length;
  let p = project(p0.slice(), types);
  const m = residualCount(types);
  let r = residuals(p, types, target, new Float64Array(m));
  let cost = sumSq(r);
  let lambda = 1e-2;
  const J = Array.from({ length: m }, () => new Float64Array(n));
  const rStep = new Float64Array(m);

  for (let it = 0; it < iterations; it++) {
    for (let j = 0; j < n; j++) {
      const eps = 1e-4;
      const saved = p[j];
      p[j] = saved + eps;
      residuals(p, types, target, rStep);
      p[j] = saved;
      for (let k = 0; k < m; k++) J[k][j] = (rStep[k] - r[k]) / eps;
    }

    const JtJ = Array.from({ length: n }, () => new Array(n).fill(0));
    const Jtr = new Array(n).fill(0);
    for (let k = 0; k < m; k++) {
      const row = J[k];
      for (let i = 0; i < n; i++) {
        Jtr[i] -= row[i] * r[k];
        for (let j = i; j < n; j++) JtJ[i][j] += row[i] * row[j];
      }
    }
    for (let i = 0; i < n; i++)
      for (let j = 0; j < i; j++) JtJ[i][j] = JtJ[j][i];

    let improved = false;
    for (let tries = 0; tries < 6 && !improved; tries++) {
      const A = JtJ.map((row, i) =>
        row.map((v, j) => (i === j ? v + lambda * (v + 1e-6) : v)),
      );
      const delta = solve(A, Jtr);
      if (!delta) {
        lambda *= 4;
        continue;
      }
      const candidate = project(
        p.map((v, i) => v + delta[i]),
        types,
      );
      const rc = residuals(candidate, types, target, new Float64Array(m));
      const cc = sumSq(rc);
      if (cc < cost) {
        p = candidate;
        r = rc;
        const gain = cost - cc;
        cost = cc;
        lambda = Math.max(lambda / 3, 1e-7);
        improved = true;
        if (gain < 1e-6) return { p, cost };
      } else {
        lambda *= 4;
      }
    }
    if (!improved) break;
  }
  return { p, cost };
}

function initialParams(types, target) {
  const centers = [60, 250, 1000, 4000, 12000];
  const at = (f) => graphicTargetAt(target, f);
  const p = [];
  types.forEach((type, b) => {
    let f = centers[b];
    let g = at(f);
    if (type === FILTER_TYPE.LOW_SHELF) {
      f = 120;
      g = at(32);
    } else if (type === FILTER_TYPE.HIGH_SHELF) {
      f = 6000;
      g = at(16000);
    }
    p.push(
      Math.log(f),
      clamp(g, -12, 12),
      Math.log(type === FILTER_TYPE.PEAK ? 1 : 0.7),
    );
  });
  return p;
}

function graphicTargetAt(target, f) {
  const x = Math.log(f / F_MIN) / Math.log(F_MAX / F_MIN);
  const k = Math.round(clamp(x, 0, 1) * (SAMPLE_COUNT - 1));
  return target[k];
}

function toBands(p, types) {
  const bands = types.map((type, b) => ({
    type,
    freq: Math.round(Math.exp(p[3 * b])),
    gain: Math.round(p[3 * b + 1] * 10) / 10,
    q: Math.round(Math.exp(p[3 * b + 2]) * 100) / 100,
    disabled: false,
  }));
  // The hardware expects the bands in ascending frequency order.
  bands.sort((a, b) => a.freq - b.freq);
  for (let i = 1; i < bands.length; i++) {
    if (bands[i].freq <= bands[i - 1].freq)
      bands[i].freq = bands[i - 1].freq + 1;
  }
  return bands;
}

function bandsToParams(bands) {
  return bands.flatMap((b) => [Math.log(b.freq), b.gain, Math.log(b.q)]);
}

export function bandsResponse(bands, freqs) {
  return freqs.map((f) =>
    bands.reduce(
      (s, b) =>
        b.disabled ? s : s + filterResponse(f, b.freq, b.gain, b.q, b.type),
      0,
    ),
  );
}

// Fits the five hardware filters to the curve the ten sliders draw.
// `previous` (the last fit) warm-starts a quick refinement while a slider is dragged.
export function fitGraphicEq(
  rawGains,
  { previous = null, quick = false } = {},
) {
  const gains = sanitizeGains(rawGains) || GRAPHIC_FREQS.map(() => 0);
  const target = graphicTarget(gains);
  if (gains.every((g) => g === 0)) {
    return {
      bands: AUDIO_LIMITS.DEFAULT_FREQS.map((freq) => ({
        type: FILTER_TYPE.PEAK,
        freq,
        gain: 0,
        q: 1,
        disabled: false,
      })),
      maxError: 0,
    };
  }

  let best = null;
  const consider = (types, p0, iterations) => {
    const res = levenbergMarquardt(p0, types, target, iterations);
    if (!best || res.cost < best.cost) best = { ...res, types };
  };

  if (previous) {
    const types = previous.map((b) => b.type);
    consider(types, bandsToParams(previous), quick ? 12 : 60);
  }
  if (!quick || !previous) {
    for (const types of TYPE_LAYOUTS) {
      consider(types, initialParams(types, target), 60);
    }
  }

  const bands = toBands(best.p, best.types);
  const audible = SAMPLE_FREQS.map((f, i) => [f, i]).filter(
    ([f]) => f >= 32 && f <= 16000,
  );
  const achieved = bandsResponse(
    bands,
    audible.map(([f]) => f),
  );
  const maxError = audible.reduce(
    (m, [, i], k) => Math.max(m, Math.abs(achieved[k] - target[i])),
    0,
  );
  return { bands, maxError };
}

// Peak boost of a set of bands, which is how much the preamp must cut to avoid clipping.
export function peakBoost(bands) {
  const peak = Math.max(...bandsResponse(bands, SAMPLE_FREQS));
  return Math.max(0, peak);
}

// Reads a parametric curve back into slider positions (for curves made elsewhere).
export function slidersFromBands(bands) {
  return bandsResponse(bands, GRAPHIC_FREQS).map((g) =>
    clamp(Math.round(g * 2) / 2, GRAPHIC_RANGE.MIN, GRAPHIC_RANGE.MAX),
  );
}
