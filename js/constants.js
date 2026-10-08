export const DEVICE = Object.freeze({
  VENDOR_ID: 0x31b2,
  PRODUCT_ID: 0x1112,
  REPORT_DSP: 0x4b,
  REPORT_CHIP_ID: 0x54,
});

export const COMMAND = Object.freeze({
  READ: 0x52,
  WRITE: 0x57,
  COMMIT: 0x53,
});

export const REGISTER = Object.freeze({
  ENABLE: 0x24,
  FILTER_BASE: 0x26,
  MIC_GAIN: 0x65,
  VOLUME: 0x66,
});

export const SLOT = Object.freeze({
  BYPASS: 0x02,
  CUSTOM: 0x03,
});

export const FILTER_TYPE = Object.freeze({
  PEAK: "peak",
  LOW_SHELF: "low_shelf",
  HIGH_SHELF: "high_shelf",
});

export const FILTER_TYPE_TO_CODE = Object.freeze({
  [FILTER_TYPE.PEAK]: 0x00,
  [FILTER_TYPE.LOW_SHELF]: 0x03,
  [FILTER_TYPE.HIGH_SHELF]: 0x04,
});

export const CODE_TO_FILTER_TYPE = Object.freeze({
  0x00: FILTER_TYPE.PEAK,
  0x03: FILTER_TYPE.LOW_SHELF,
  0x04: FILTER_TYPE.HIGH_SHELF,
});

export const AUDIO_LIMITS = Object.freeze({
  FILTER_COUNT: 5,
  DEFAULT_FREQS: [100, 500, 1000, 5000, 10000],
  FREQ: { MIN: 20, MAX: 20000, STEP: 1 },
  GAIN: { MIN: -12, MAX: 12, STEP: 0.1 },
  Q: { MIN: 0.1, MAX: 10, STEP: 0.1, DEFAULT: 1.0 },
  VOLUME: { MIN: -60, MAX: 0, STEP: 1, DEFAULT: 0 },
  MIC_GAIN: { MIN: -60, MAX: 12, STEP: 1, DEFAULT: 0 },
});

export const CANVAS_CONFIG = Object.freeze({
  FREQ_POINTS: [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000],
  DB_MIN: -15,
  DB_MAX: 15,
  STEP_COUNT: 800,
  HIT_RADIUS_SQ: 64,
});
