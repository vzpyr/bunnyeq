export const DEFAULT_FREQS = [100, 500, 1000, 5000, 10000];

export function createDefaultBands() {
  return DEFAULT_FREQS.map((freq) => ({
    type: "PK",
    freq,
    gain: 0,
    q: 1.0,
    disabled: false,
  }));
}

export function exportConfigJSON(state) {
  const cfg = {
    format: "bunnyeq-v1",
    leftVol: state.leftVol,
    rightVol: state.rightVol,
    micGain: state.micGain,
    bands: state.bands.map((b) => ({
      type: b.type,
      freq: b.freq,
      gain: b.gain,
      q: b.q,
      disabled: !!b.disabled,
    })),
  };

  const ts = new Date().toISOString().replace(/:/g, "-").replace(/\..+/, "");
  const blob = new Blob([JSON.stringify(cfg, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `bunnyeq-${ts}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return `bunnyeq-${ts}.json`;
}

export function parseConfigJSON(jsonString) {
  let cfg;
  try {
    cfg = JSON.parse(jsonString);
  } catch (_) {
    throw new Error("Invalid JSON file");
  }

  if (!cfg.format || !cfg.format.startsWith("bunnyeq-")) {
    throw new Error('Not a Bunny EQ config file (missing "format")');
  }
  if (!Array.isArray(cfg.bands)) {
    throw new Error('Invalid config: missing "bands" array');
  }

  const validTypes = ["PK", "LSQ", "HSQ"];
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  const leftVol = clamp(parseFloat(cfg.leftVol) || 0, -60, 0);
  const rightVol = clamp(parseFloat(cfg.rightVol) || 0, -60, 0);
  const micGain = clamp(parseFloat(cfg.micGain) || 0, -60, 12);

  const bands = [];
  for (let i = 0; i < 5; i++) {
    if (i < cfg.bands.length) {
      const b = cfg.bands[i] || {};
      const type = validTypes.includes(b.type) ? b.type : "PK";
      const freq = clamp(parseFloat(b.freq) || DEFAULT_FREQS[i], 20, 20000);
      const gain = clamp(parseFloat(b.gain) || 0, -12, 12);
      const q = clamp(parseFloat(b.q) || 1.0, 0.1, 10);
      bands.push({
        type,
        freq,
        gain,
        q,
        disabled: !!b.disabled,
      });
    } else {
      bands.push({
        type: "PK",
        freq: DEFAULT_FREQS[i],
        gain: 0,
        q: 1.0,
        disabled: false,
      });
    }
  }

  return { leftVol, rightVol, micGain, bands };
}
