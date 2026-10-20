import { transport } from "./transport.js";
import {
  readDspState,
  commitDspState,
  setLiveSlot,
  liveSync,
  onLiveError,
} from "./dsp.js";
import { exportConfigJSON, parseConfigJSON } from "./config.js";
import { appState, savePref } from "./state.js";
import {
  fitGraphicEq,
  peakBoost,
  slidersFromBands,
  sanitizeGains,
} from "./graphic.js";
import {
  renderGraphicRack,
  syncGraphicUi,
  bindGraphicControls,
  graphicOverlay,
  CUSTOM_PRESET,
} from "./graphic-ui.js";
import { SLOT } from "./constants.js";
import {
  elements,
  renderBands,
  bindBandDelegation,
  bindVolumeControls,
  initCanvasInteraction,
  initTheme,
  initAsanoToggle,
  initLinuxHint,
  showToast,
  setDisconnectError,
  syncUiFromState,
  renderEqCanvas,
  setOverlayProvider,
} from "./ui.js";

// How the sliders and preamp map onto what the IEM holds: one record for the
// live (unsaved) state and one for the last save, so a reload can restore them.
const LIVE_GRAPHIC_KEY = "bunnyeq.graphic.live";
const SAVED_GRAPHIC_KEY = "bunnyeq.graphic.saved";

const redraw = () =>
  renderEqCanvas(appState.bands, appState.eqEnabled, graphicOverlay(appState));

function pushLive() {
  const { left, right } = appState.effectiveVolume();
  liveSync(appState.bands, left, right, appState.micGain);
  rememberGraphic(LIVE_GRAPHIC_KEY);
  appState.refreshDirty();
}

onLiveError((err) => {
  showToast(`Couldn't send the change to the IEM: ${err.message}`, "error");
});

setOverlayProvider(graphicOverlay);
renderBands(appState.bands);
renderGraphicRack(appState);
initTheme(redraw);
initAsanoToggle();
initLinuxHint();

appState.subscribe((event, data, state) => {
  if (
    event === "sync" ||
    event === "dirty" ||
    event === "connection" ||
    event === "working" ||
    event === "bypass" ||
    event === "graphic" ||
    event === "mode"
  ) {
    syncUiFromState(state);
    syncGraphicUi(state);
  } else if (event === "graphic-drag" || event === "preamp") {
    syncGraphicUi(state, { light: true });
    redraw();
  } else if (event === "band") {
    redraw();
  }
});

bindBandDelegation((index, updates) => {
  appState.updateBand(index, updates);
  pushLive();
});

bindVolumeControls(
  (channel, value) => {
    if (channel === "left") appState.setVolume(value, undefined);
    else appState.setVolume(undefined, value);
    pushLive();
  },
  (micGain) => {
    appState.setMicGain(micGain);
    pushLive();
  },
);

initCanvasInteraction(
  () => appState,
  (index, updates) => {
    appState.updateBand(index, updates);
    pushLive();
  },
  redraw,
);

new ResizeObserver(redraw).observe(elements.canvas);

// Preamp the auto setting picks: cut by the curve's highest boost, in the
// register's 0.5 dB steps.
const autoPreampFor = (bands) =>
  -Math.min(12, Math.ceil(peakBoost(bands) * 2) / 2);

function applyGains(gains, preset, { final, quiet = false }) {
  const { bands, maxError } = fitGraphicEq(gains, {
    previous: appState.graphicLinked ? appState.bands : null,
    quick: !final,
  });
  const preamp = appState.autoPreamp ? autoPreampFor(bands) : appState.preamp;
  appState.applyGraphic({
    gains,
    preset,
    bands,
    fitError: maxError,
    preamp,
    final,
  });
  if (!appState.eqEnabled && final && !quiet) {
    showToast('EQ is off. Press "EQ: Off" to hear your changes.', "error");
  }
  pushLive();
}

function setPreamp(value) {
  appState.setPreamp(value);
  pushLive();
}

bindGraphicControls({
  getState: () => appState,
  onGains: applyGains,
  onPreamp: setPreamp,
  onAutoPreamp: (on) => {
    appState.setAutoPreamp(on);
    if (on) setPreamp(autoPreampFor(appState.bands));
    else syncGraphicUi(appState);
  },
  onMode: (mode) => {
    // Parametric edits leave the sliders stale; show where the new curve sits.
    if (mode === "graphic" && !appState.graphicLinked) {
      appState.graphicGains = slidersFromBands(appState.bands);
      appState.graphicPreset = CUSTOM_PRESET;
    }
    appState.setMode(mode);
  },
});

const bandsKey = (bands) =>
  JSON.stringify(
    bands.map((b) => [
      b.type,
      Math.round(b.freq),
      b.disabled ? 0 : Math.round(b.gain * 10),
      Math.round(b.q * 1000),
    ]),
  );

function rememberGraphic(storageKey) {
  savePref(storageKey, {
    key: bandsKey(appState.bands),
    linked: appState.graphicLinked,
    gains: appState.graphicGains,
    preset: appState.graphicPreset,
    fitError: appState.fitError,
    preamp: appState.preamp,
  });
}

function loadGraphicRecord(storageKey) {
  try {
    return JSON.parse(localStorage.getItem(storageKey));
  } catch (_) {
    return null;
  }
}

// After reading the IEM (or importing), work out the sliders and preamp behind its
// curve. `regLeft`/`regRight` are the volumes the hardware holds, preamp included.
function restoreGraphicView(regLeft, regRight) {
  const s = appState;
  const key = bandsKey(s.bands);
  const record = [LIVE_GRAPHIC_KEY, SAVED_GRAPHIC_KEY]
    .map(loadGraphicRecord)
    .find((r) => r && r.key === key);
  const gains = record && record.linked ? sanitizeGains(record.gains) : null;
  const preamp =
    record && Number.isFinite(record.preamp)
      ? Math.max(-12, Math.min(0, record.preamp))
      : 0;

  if (gains) {
    s.graphicGains = gains;
    s.graphicPreset =
      typeof record.preset === "string" ? record.preset : CUSTOM_PRESET;
    s.fitError = Number.isFinite(record.fitError) ? record.fitError : 0;
    s.graphicLinked = true;
  } else if (s.bands.every((b) => b.disabled || b.gain === 0)) {
    s.graphicGains = s.graphicGains.map(() => 0);
    s.graphicPreset = "Flat";
    s.fitError = 0;
    s.graphicLinked = true;
  } else {
    s.graphicGains = slidersFromBands(s.bands);
    s.graphicPreset = CUSTOM_PRESET;
    s.graphicLinked = false;
  }
  s.preamp = preamp;
  s.leftVol = Math.max(-60, Math.min(0, regLeft - preamp));
  s.rightVol = Math.max(-60, Math.min(0, regRight - preamp));
}

elements.connectHeaderBtn.addEventListener("click", () => connect(true));
elements.retryBtn.addEventListener("click", () => connect(true));
elements.readBtn.addEventListener("click", () => readDevice(false));
elements.commitBtn.addEventListener("click", () => commitDevice());
elements.bypassBtn.addEventListener("click", () => toggleBypass());
elements.clearBtn.addEventListener("click", () => clearFilters());
elements.exportBtn.addEventListener("click", () => exportPreset());
elements.importBtn.addEventListener("click", () => elements.importFile.click());
elements.importFile.addEventListener("change", handleImportFile);

let isConnecting = false;

transport.onDisconnect(() => {
  appState.setConnection(false);
  appState.setWorking(false);
});

transport.onConnect(() => {
  if (!appState.isConnected && !isConnecting && !appState.isWorking) {
    connect(false);
  }
});

initConnection();

async function initConnection() {
  if (!transport.isSupported()) {
    showToast("Please open in a Chromium-based browser", "error", true);
    elements.disconnectMsg.textContent =
      "Please open in a Chromium-based browser.";
    elements.retryBtn.disabled = true;
    return;
  }

  try {
    const connected = await transport.connect(false);
    if (connected) {
      appState.setConnection(true);
      await loadFromDevice(true);
    } else {
      appState.setConnection(false);
    }
  } catch (_) {
    appState.setConnection(false);
  }
}

async function connect(interactive = false) {
  if (isConnecting || appState.isWorking) return;
  if (appState.isConnected && transport.isConnected()) return;

  isConnecting = true;
  setDisconnectError(null);

  try {
    const ok = await transport.connect(interactive);
    if (ok) {
      setDisconnectError(null);
      appState.setConnection(true);
      showToast("Device connected", "success");
      await loadFromDevice(true);
    } else {
      appState.setConnection(false);
    }
  } catch (err) {
    const isLinux =
      typeof navigator !== "undefined" && navigator.userAgent.includes("Linux");
    const isPermissionError = err.message?.includes("Failed to open");
    const msg =
      isLinux && isPermissionError
        ? "Failed to open device. Ensure udev rules are installed."
        : `Failed to connect: ${err.message}`;

    setDisconnectError(msg);
    if (isLinux && isPermissionError) {
      const hint = document.querySelector(".linux-hint");
      if (hint) hint.open = true;
    }
    showToast(msg, "error");
    appState.setConnection(false);
  } finally {
    isConnecting = false;
  }
}

async function readDevice(quiet = false) {
  if (appState.isWorking) return;
  await loadFromDevice(quiet);
}

async function loadFromDevice(quiet = false) {
  appState.setWorking(true);
  if (!quiet) showToast("Reading settings from hardware...");
  // Reload reads the working registers, which hold unsaved live edits too.
  const wasDirty = appState.hasChanges;

  try {
    const data = await readDspState();
    appState.setDspData({
      bands: data.filters,
      leftVol: data.leftVol,
      rightVol: data.rightVol,
      micGain: data.micGain,
      eqEnabled: data.enabled,
      chipId: data.chipId,
    });
    restoreGraphicView(data.leftVol, data.rightVol);
    appState.refreshDirty(wasDirty);
    syncUiFromState(appState);
    syncGraphicUi(appState);
    if (!quiet) showToast(`Loaded ${data.filters.length} filters`, "success");
  } catch (err) {
    showToast(`Failed to read device: ${err.message}`, "error");
  } finally {
    appState.setWorking(false);
  }
}

async function commitDevice() {
  if (appState.isWorking || !appState.hasChanges || !appState.isConnected)
    return;
  appState.setWorking(true);
  showToast("Saving settings to flash...");

  try {
    const { left, right } = appState.effectiveVolume();
    const res = await commitDspState(
      appState.bands,
      left,
      right,
      appState.micGain,
      appState.eqEnabled,
    );
    if (res.success) {
      rememberGraphic(SAVED_GRAPHIC_KEY);
      appState.rememberSaved();
      appState.markSaved();
      showToast(
        appState.eqEnabled
          ? "Settings saved to hardware"
          : "Saved with the EQ switched off",
        "success",
      );
      appState.setConnection(res.connected);
    }
  } catch (err) {
    showToast(`Failed to save settings: ${err.message}`, "error");
  } finally {
    appState.setWorking(false);
  }
}

async function toggleBypass() {
  if (appState.isWorking || !appState.isConnected) return;
  const targetSlot = appState.eqEnabled ? SLOT.BYPASS : SLOT.CUSTOM;

  try {
    const res = await setLiveSlot(targetSlot);
    appState.setEqEnabled(res.enabled);
    appState.refreshDirty();
  } catch (err) {
    showToast(`Failed to switch EQ: ${err.message}`, "error");
  }
}

function clearFilters() {
  appState.resetFilters();
  pushLive();
  showToast("Back to flat. Click Save to IEM to keep it.", "success");
}

function exportPreset() {
  if (appState.isWorking || !appState.isConnected) return;
  // Export what the IEM plays, so the file means the same thing in any copy of the app.
  const { left, right } = appState.effectiveVolume();
  const filename = exportConfigJSON({
    bands: appState.bands,
    leftVol: left,
    rightVol: right,
    micGain: appState.micGain,
  });
  showToast(`Exported preset to ${filename}`, "success");
}

function handleImportFile(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const cfg = parseConfigJSON(e.target.result);
      appState.setDspData({
        bands: cfg.bands,
        leftVol: cfg.leftVol,
        rightVol: cfg.rightVol,
        micGain: cfg.micGain,
        eqEnabled: appState.eqEnabled,
        chipId: appState.chipId,
      });
      restoreGraphicView(cfg.leftVol, cfg.rightVol);
      syncUiFromState(appState);
      syncGraphicUi(appState);
      pushLive();
      showToast(
        `Imported ${cfg.bands.length} filter(s). Click Save to IEM to keep them.`,
        "success",
      );
    } catch (err) {
      showToast(err.message, "error");
    }
  };
  reader.readAsText(file);
}
