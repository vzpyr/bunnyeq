import { CANVAS_CONFIG, FILTER_TYPE } from "./constants.js";

const { FREQ_POINTS, DB_MIN, DB_MAX, STEP_COUNT } = CANVAS_CONFIG;
const F_MIN = 20;
const F_MAX = 20000;

export function filterResponse(f, fc, gain, q, type) {
  if (gain === 0 || !gain) return 0;
  const qSafe = Math.max(0.1, q || 1.0);
  const A = Math.pow(10, gain / 40);
  const w0 = 2 * Math.PI * fc;
  const w = 2 * Math.PI * f;
  const w0_sq = w0 * w0;
  const w_sq = w * w;
  const w0w = w0 * w;

  if (type === FILTER_TYPE.PEAK || type === "PK") {
    const diff_sq = Math.pow(w0_sq - w_sq, 2);
    const num = diff_sq + Math.pow((A / qSafe) * w0w, 2);
    const den = diff_sq + Math.pow((1 / (A * qSafe)) * w0w, 2);
    return 10 * Math.log10(Math.max(num / den, 1e-15));
  }

  const sqrtA = Math.sqrt(A);
  const crossTerm = Math.pow((sqrtA / qSafe) * w0w, 2);

  if (type === FILTER_TYPE.LOW_SHELF || type === "LSQ") {
    const num_sq = Math.pow(A * w0_sq - w_sq, 2) + crossTerm;
    const den_sq = Math.pow(w0_sq - A * w_sq, 2) + crossTerm;
    return 10 * Math.log10(Math.max((A * A * num_sq) / den_sq, 1e-15));
  }

  if (type === FILTER_TYPE.HIGH_SHELF || type === "HSQ") {
    const num_sq = Math.pow(w0_sq - A * w_sq, 2) + crossTerm;
    const den_sq = Math.pow(A * w0_sq - w_sq, 2) + crossTerm;
    return 10 * Math.log10(Math.max(num_sq / den_sq, 1e-15));
  }

  return 0;
}

export function freqToX(freq, width) {
  return (Math.log(freq / F_MIN) / Math.log(F_MAX / F_MIN)) * width;
}

export function xToFreq(x, width) {
  const ratio = Math.max(0, Math.min(1, x / width));
  return Math.round(F_MIN * Math.pow(F_MAX / F_MIN, ratio));
}

export function dbToY(db, height) {
  return height - ((db - DB_MIN) / (DB_MAX - DB_MIN)) * height;
}

export function yToDb(y, height) {
  const raw = DB_MAX - (y / height) * (DB_MAX - DB_MIN);
  return Math.round(raw * 10) / 10;
}

export function drawEQ(canvas, bands, eqEnabled) {
  if (!canvas) return [];

  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return [];

  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);

  const W = rect.width;
  const H = rect.height;
  ctx.clearRect(0, 0, W, H);

  const cs = getComputedStyle(document.documentElement);
  const cGrid = cs.getPropertyValue("--canvas-grid").trim() || "#ddd";
  const cLabel = cs.getPropertyValue("--canvas-label").trim() || "#888";
  const cZero = cs.getPropertyValue("--canvas-zero").trim() || "#bbb";
  const cBand =
    cs.getPropertyValue("--canvas-band").trim() || "rgba(42,75,127,0.2)";
  const cCurve = cs.getPropertyValue("--canvas-curve").trim() || "#d4a373";
  const cDot = cs.getPropertyValue("--canvas-dot").trim() || "#d3dee8";
  const cDotText = cs.getPropertyValue("--canvas-dot-text").trim() || "#2c2926";
  const cEqOffBg =
    cs.getPropertyValue("--canvas-eq-off-bg").trim() || "rgba(217,117,107,0.1)";
  const cEqOffText =
    cs.getPropertyValue("--canvas-eq-off-text").trim() || "#d9756b";

  ctx.strokeStyle = cGrid;
  ctx.lineWidth = 1;
  ctx.font = '10px "League Spartan", sans-serif';

  for (let db = -12; db <= 12; db += 3) {
    const y = dbToY(db, H);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
    ctx.fillStyle = cLabel;
    ctx.fillText(`${db} dB`, 4, y - 3);
  }

  for (const f of FREQ_POINTS) {
    const x = freqToX(f, W);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
    ctx.fillStyle = cLabel;
    ctx.textAlign = "center";
    ctx.fillText(f >= 1000 ? `${f / 1000}k` : `${f}`, x, H - 2);
    ctx.textAlign = "start";
  }

  ctx.strokeStyle = cZero;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, dbToY(0, H));
  ctx.lineTo(W, dbToY(0, H));
  ctx.stroke();

  const activeBands = bands.filter((b) => !b.disabled && b.gain !== 0);

  for (const band of activeBands) {
    ctx.beginPath();
    let isFirst = true;
    for (let i = 0; i <= STEP_COUNT; i++) {
      const f = F_MIN * Math.pow(F_MAX / F_MIN, i / STEP_COUNT);
      let db = filterResponse(f, band.freq, band.gain, band.q, band.type);
      db = Math.max(DB_MIN, Math.min(DB_MAX, db));
      const x = freqToX(f, W);
      const y = dbToY(db, H);
      if (isFirst) {
        ctx.moveTo(x, y);
        isFirst = false;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.strokeStyle = cBand;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  ctx.beginPath();
  let isFirstTotal = true;
  for (let i = 0; i <= STEP_COUNT; i++) {
    const f = F_MIN * Math.pow(F_MAX / F_MIN, i / STEP_COUNT);
    let totalDb = 0;
    for (const band of activeBands) {
      totalDb += filterResponse(f, band.freq, band.gain, band.q, band.type);
    }
    totalDb = Math.max(DB_MIN, Math.min(DB_MAX, totalDb));
    const x = freqToX(f, W);
    const y = dbToY(totalDb, H);
    if (isFirstTotal) {
      ctx.moveTo(x, y);
      isFirstTotal = false;
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.strokeStyle = cCurve;
  ctx.lineWidth = 2.5;
  ctx.stroke();

  if (!eqEnabled) {
    ctx.fillStyle = cEqOffBg;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = cEqOffText;
    ctx.font = 'bold 14px "League Spartan", sans-serif';
    ctx.textAlign = "center";
    ctx.fillText("Disabled", W / 2, 30);
    ctx.textAlign = "start";
    return [];
  }

  const dots = [];
  for (let b = 0; b < bands.length; b++) {
    const band = bands[b];
    if (band.disabled || band.gain === 0) continue;
    const x = freqToX(band.freq, W);
    const y = dbToY(band.gain, H);
    dots.push({ x, y, band: b });

    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fillStyle = cDot;
    ctx.fill();
    ctx.fillStyle = cDotText;
    ctx.font = 'bold 10px "League Spartan", sans-serif';
    ctx.textAlign = "center";
    ctx.fillText(String(b + 1), x, y - 10);
    ctx.textAlign = "start";
  }

  return dots;
}
