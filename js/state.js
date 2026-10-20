import { createDefaultBands } from "./config.js";
import { GRAPHIC_FREQS } from "./graphic.js";

const MODE_KEY = "bunnyeq.mode";
const AUTO_PREAMP_KEY = "bunnyeq.autoPreamp";
const SAVED_KEY = "bunnyeq.savedKey";

const VOLUME_MIN = -60;
const clampVolume = (db) => Math.max(VOLUME_MIN, Math.min(0, db));

function loadPref(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch (_) {
    return fallback;
  }
}

export function savePref(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (_) {}
}

class AppState {
  constructor() {
    this.bands = createDefaultBands();
    this.leftVol = 0;
    this.rightVol = 0;
    this.micGain = 0;
    this.eqEnabled = true;
    this.chipId = "-";
    this.isConnected = false;
    this.isWorking = false;
    this.hasChanges = false;
    this.listeners = new Set();

    // Graphic (10-slider) view. The hardware only ever holds `bands`; the sliders
    // are the curve those bands were fitted to.
    this.mode = loadPref(MODE_KEY, "graphic");
    this.graphicGains = GRAPHIC_FREQS.map(() => 0);
    this.graphicPreset = "Flat";
    this.graphicLinked = true;
    this.fitError = 0;
    // Preamp is a cut applied on top of the L/R volumes; the hardware only has
    // the one volume register, so what it gets is effectiveVolume().
    this.preamp = 0;
    this.autoPreamp = loadPref(AUTO_PREAMP_KEY, true);
    // Fingerprint of what was last saved to flash from this browser.
    this.savedKey = loadPref(SAVED_KEY, null);
  }

  effectiveVolume() {
    return {
      left: clampVolume(this.leftVol + this.preamp),
      right: clampVolume(this.rightVol + this.preamp),
    };
  }

  // Everything the IEM stores, quantised the way its registers are.
  deviceKey() {
    const { left, right } = this.effectiveVolume();
    return JSON.stringify({
      bands: this.bands.map((b) => [
        b.type,
        Math.round(b.freq),
        b.disabled ? 0 : Math.round(b.gain * 10),
        Math.round(b.q * 1000),
      ]),
      vol: [Math.round(left * 2), Math.round(right * 2)],
      mic: Math.round(this.micGain * 2),
      eq: this.eqEnabled,
    });
  }

  rememberSaved() {
    this.savedKey = this.deviceKey();
    savePref(SAVED_KEY, this.savedKey);
  }

  // Unsaved = differs from the last save. Without a known save, `fallback` decides.
  refreshDirty(fallback = true) {
    const dirty = this.savedKey ? this.deviceKey() !== this.savedKey : fallback;
    if (dirty !== this.hasChanges) {
      this.hasChanges = dirty;
      this.notify("dirty", { hasChanges: dirty });
    }
  }

  setPreamp(preamp) {
    this.preamp = preamp;
    this.notify("preamp", { preamp });
  }

  setMode(mode) {
    this.mode = mode;
    savePref(MODE_KEY, mode);
    this.notify("mode", { mode });
  }

  setAutoPreamp(autoPreamp) {
    this.autoPreamp = autoPreamp;
    savePref(AUTO_PREAMP_KEY, autoPreamp);
  }

  // Bands fitted from the sliders replace the parametric bands wholesale.
  applyGraphic({ gains, preset, bands, fitError, preamp, final = true }) {
    this.graphicGains = gains.slice();
    this.graphicPreset = preset;
    this.graphicLinked = true;
    this.fitError = fitError;
    this.bands = bands.map((b) => ({ ...b }));
    this.preamp = preamp;
    this.notify(final ? "graphic" : "graphic-drag", this);
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify(event, data) {
    this.listeners.forEach((listener) => listener(event, data, this));
  }

  setConnection(isConnected, chipId) {
    this.isConnected = isConnected;
    if (!isConnected) {
      this.chipId = "-";
    } else if (chipId !== undefined) {
      this.chipId = chipId;
    }
    this.notify("connection", { isConnected, chipId: this.chipId });
  }

  setWorking(isWorking) {
    this.isWorking = isWorking;
    this.notify("working", { isWorking });
  }

  setHasChanges(hasChanges) {
    this.hasChanges = hasChanges;
    this.notify("dirty", { hasChanges });
  }

  markChanged() {
    if (!this.hasChanges) {
      this.hasChanges = true;
      this.notify("dirty", { hasChanges: true });
    }
  }

  markSaved() {
    this.hasChanges = false;
    this.notify("dirty", { hasChanges: false });
  }

  setDspData({ bands, leftVol, rightVol, micGain, eqEnabled, chipId }) {
    if (Array.isArray(bands)) this.bands = bands;
    if (leftVol !== undefined) this.leftVol = leftVol;
    if (rightVol !== undefined) this.rightVol = rightVol;
    if (micGain !== undefined) this.micGain = micGain;
    if (eqEnabled !== undefined) this.eqEnabled = eqEnabled;
    if (chipId !== undefined) this.chipId = chipId;
    this.hasChanges = false;
    this.notify("sync", this);
  }

  updateBand(index, updates) {
    if (this.bands[index]) {
      Object.assign(this.bands[index], updates);
      this.graphicLinked = false;
      this.markChanged();
      this.notify("band", { index, band: this.bands[index] });
    }
  }

  setVolume(left, right) {
    if (left !== undefined) this.leftVol = left;
    if (right !== undefined) this.rightVol = right;
    this.markChanged();
    this.notify("volume", { left: this.leftVol, right: this.rightVol });
  }

  setMicGain(micGain) {
    this.micGain = micGain;
    this.markChanged();
    this.notify("micGain", { micGain: this.micGain });
  }

  setEqEnabled(enabled) {
    this.eqEnabled = enabled;
    this.notify("bypass", { eqEnabled: this.eqEnabled });
  }

  // Flattens the EQ. Volumes are left alone: they now apply live, and jumping
  // them to 0 dB in someone's ears is not what "reset the EQ" means.
  resetFilters() {
    this.bands = createDefaultBands();
    this.graphicGains = this.graphicGains.map(() => 0);
    this.graphicPreset = "Flat";
    this.graphicLinked = true;
    this.fitError = 0;
    this.preamp = 0;
    this.markChanged();
    this.notify("sync", this);
  }
}

export const appState = new AppState();
