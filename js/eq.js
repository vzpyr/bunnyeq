export const FREQ_POINTS = [
  20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000,
];

export function filterResponse(f, fc, gain, q, type) {
  if (q <= 0.01) q = 0.1;
  const A = Math.pow(10, gain / 40);
  const w0 = 2 * Math.PI * fc;
  const w = 2 * Math.PI * f;

  if (type === "PK") {
    const num = Math.pow(w0 * w0 - w * w, 2) + Math.pow((A / q) * w0 * w, 2);
    const den =
      Math.pow(w0 * w0 - w * w, 2) + Math.pow((1 / (A * q)) * w0 * w, 2);
    return 10 * Math.log10(Math.max(num / den, 1e-15));
  }

  const w0w = w0 * w;
  const w0_sq = w0 * w0;
  const w_sq = w * w;

  if (type === "LSQ") {
    const sqrtA = Math.sqrt(A);
    const num_sq =
      Math.pow(A * w0_sq - w_sq, 2) + Math.pow((sqrtA / q) * w0w, 2);
    const den_sq =
      Math.pow(w0_sq - A * w_sq, 2) + Math.pow((sqrtA / q) * w0w, 2);
    return 10 * Math.log10(Math.max((A * A * num_sq) / den_sq, 1e-15));
  }

  if (type === "HSQ") {
    const sqrtA = Math.sqrt(A);
    const num_sq =
      Math.pow(w0_sq - A * w_sq, 2) + Math.pow((sqrtA / q) * w0w, 2);
    const den_sq =
      Math.pow(A * w0_sq - w_sq, 2) + Math.pow((sqrtA / q) * w0w, 2);
    return 10 * Math.log10(Math.max(num_sq / den_sq, 1e-15));
  }

  return 0;
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
  const cGrid = cs.getPropertyValue("--canvas-grid").trim();
  const cLabel = cs.getPropertyValue("--canvas-label").trim();
  const cZero = cs.getPropertyValue("--canvas-zero").trim();
  const cBand = cs.getPropertyValue("--canvas-band").trim();
  const cCurve = cs.getPropertyValue("--canvas-curve").trim();
  const cDot = cs.getPropertyValue("--canvas-dot").trim();
  const cDotText = cs.getPropertyValue("--canvas-dot-text").trim();
  const cEqOffBg = cs.getPropertyValue("--canvas-eq-off-bg").trim();
  const cEqOffText = cs.getPropertyValue("--canvas-eq-off-text").trim();

  const fMin = 20;
  const fMax = 20000;
  const dbMin = -15;
  const dbMax = 15;

  function freqToX(f) {
    return (Math.log(f / fMin) / Math.log(fMax / fMin)) * W;
  }

  function dbToY(db) {
    return H - ((db - dbMin) / (dbMax - dbMin)) * H;
  }

  ctx.strokeStyle = cGrid;
  ctx.lineWidth = 1;
  for (let db = -12; db <= 12; db += 3) {
    const y = dbToY(db);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
    ctx.fillStyle = cLabel;
    ctx.font = '10px "League Spartan", sans-serif';
    ctx.fillText(db + " dB", 4, y - 3);
  }

  for (const f of FREQ_POINTS) {
    const x = freqToX(f);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
    ctx.fillStyle = cLabel;
    ctx.font = '10px "League Spartan", sans-serif';
    ctx.textAlign = "center";
    ctx.fillText(f >= 1000 ? f / 1000 + "k" : f, x, H - 2);
    ctx.textAlign = "start";
  }

  ctx.strokeStyle = cZero;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, dbToY(0));
  ctx.lineTo(W, dbToY(0));
  ctx.stroke();

  const steps = 800;

  for (let b = 0; b < bands.length; b++) {
    const band = bands[b];
    if (band.disabled || band.gain === 0) continue;

    ctx.beginPath();
    let bfirst = true;
    for (let i = 0; i <= steps; i++) {
      const f = fMin * Math.pow(fMax / fMin, i / steps);
      let db = filterResponse(f, band.freq, band.gain, band.q, band.type);
      db = Math.max(dbMin, Math.min(dbMax, db));
      const x = freqToX(f);
      const y = dbToY(db);
      if (bfirst) {
        ctx.moveTo(x, y);
        bfirst = false;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.strokeStyle = cBand;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  ctx.beginPath();
  let first = true;
  for (let i = 0; i <= steps; i++) {
    const f = fMin * Math.pow(fMax / fMin, i / steps);
    let totalDb = 0;
    for (let b = 0; b < bands.length; b++) {
      const band = bands[b];
      if (band.disabled || band.gain === 0) continue;
      totalDb += filterResponse(f, band.freq, band.gain, band.q, band.type);
    }
    totalDb = Math.max(dbMin, Math.min(dbMax, totalDb));
    const x = freqToX(f);
    const y = dbToY(totalDb);
    if (first) {
      ctx.moveTo(x, y);
      first = false;
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
    const x = freqToX(band.freq);
    const y = dbToY(band.gain);
    dots.push({ x, y, band: b });

    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fillStyle = cDot;
    ctx.fill();
    ctx.fillStyle = cDotText;
    ctx.font = 'bold 10px "League Spartan", sans-serif';
    ctx.textAlign = "center";
    ctx.fillText(b + 1, x, y - 10);
    ctx.textAlign = "start";
  }

  return dots;
}
