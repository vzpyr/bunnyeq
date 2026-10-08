import { createDefaultBands } from "./config.js";

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

  resetFilters() {
    this.bands = createDefaultBands();
    this.leftVol = 0;
    this.rightVol = 0;
    this.micGain = 0;
    this.markChanged();
    this.notify("sync", this);
  }
}

export const appState = new AppState();
