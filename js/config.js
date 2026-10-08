import { AUDIO_LIMITS, FILTER_TYPE } from "./constants.js";

const clamp = (val, min, max) => Math.max(min, Math.min(max, val));

export function createDefaultBands() {
  return AUDIO_LIMITS.DEFAULT_FREQS.map((freq) => ({
    type: FILTER_TYPE.PEAK,
    freq,
    gain: 0,
    q: AUDIO_LIMITS.Q.DEFAULT,
    disabled: false,
  }));
}

export function normalizeFilterType(rawType) {
  if (!rawType) return FILTER_TYPE.PEAK;
  const s = String(rawType).toLowerCase().replace(/[-_]/g, "");
  if (s === "peak" || s === "pk") return FILTER_TYPE.PEAK;
  if (s === "lowshelf" || s === "lsq") return FILTER_TYPE.LOW_SHELF;
  if (s === "highshelf" || s === "hsq") return FILTER_TYPE.HIGH_SHELF;
  return FILTER_TYPE.PEAK;
}

export function exportConfigJSON(state) {
  const config = {
    format: "bunnyeq-v1",
    leftVol: state.leftVol,
    rightVol: state.rightVol,
    micGain: state.micGain,
    bands: state.bands.map((band) => ({
      type: band.type,
      freq: band.freq,
      gain: band.gain,
      q: band.q,
      disabled: Boolean(band.disabled),
    })),
  };

  const ts = new Date().toISOString().replace(/:/g, "-").replace(/\..+/, "");
  const filename = `bunnyeq-${ts}.json`;
  const blob = new Blob([JSON.stringify(config, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  return filename;
}

export function parseConfigJSON(jsonString) {
  let config;
  try {
    config = JSON.parse(jsonString);
  } catch (_) {
    throw new Error("Invalid JSON file");
  }

  if (!config.format || !config.format.startsWith("bunnyeq-")) {
    throw new Error('Not a Bunny EQ preset (missing "format")');
  }
  if (!Array.isArray(config.bands)) {
    throw new Error('Invalid preset: missing "bands" array');
  }

  const { FREQ, GAIN, Q, VOLUME, MIC_GAIN, FILTER_COUNT, DEFAULT_FREQS } =
    AUDIO_LIMITS;

  const leftVol = clamp(
    parseFloat(config.leftVol) || 0,
    VOLUME.MIN,
    VOLUME.MAX,
  );
  const rightVol = clamp(
    parseFloat(config.rightVol) || 0,
    VOLUME.MIN,
    VOLUME.MAX,
  );
  const micGain = clamp(
    parseFloat(config.micGain) || 0,
    MIC_GAIN.MIN,
    MIC_GAIN.MAX,
  );

  const bands = [];
  for (let i = 0; i < FILTER_COUNT; i++) {
    const rawBand = config.bands[i] || {};
    bands.push({
      type: normalizeFilterType(rawBand.type),
      freq: clamp(
        parseFloat(rawBand.freq) || DEFAULT_FREQS[i],
        FREQ.MIN,
        FREQ.MAX,
      ),
      gain: clamp(parseFloat(rawBand.gain) || 0, GAIN.MIN, GAIN.MAX),
      q: clamp(parseFloat(rawBand.q) || Q.DEFAULT, Q.MIN, Q.MAX),
      disabled: Boolean(rawBand.disabled),
    });
  }

  return { leftVol, rightVol, micGain, bands };
}
