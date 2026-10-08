import { transport } from "./transport.js";
import { readDspState, commitDspState, setDspBypassSlot } from "./dsp.js";
import { exportConfigJSON, parseConfigJSON } from "./config.js";
import { appState } from "./state.js";
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
} from "./ui.js";

renderBands(appState.bands);
initTheme(() => renderEqCanvas(appState.bands, appState.eqEnabled));
initAsanoToggle();
initLinuxHint();

appState.subscribe((event, data, state) => {
  if (
    event === "sync" ||
    event === "dirty" ||
    event === "connection" ||
    event === "working"
  ) {
    syncUiFromState(state);
  } else if (event === "band") {
    renderEqCanvas(state.bands, state.eqEnabled);
  } else if (event === "bypass") {
    syncUiFromState(state);
  }
});

bindBandDelegation((index, updates) => {
  appState.updateBand(index, updates);
});

bindVolumeControls(
  (channel, value) => {
    if (channel === "left") appState.setVolume(value, undefined);
    else appState.setVolume(undefined, value);
  },
  (micGain) => {
    appState.setMicGain(micGain);
  },
);

initCanvasInteraction(
  () => appState,
  (index, updates) => appState.updateBand(index, updates),
  () => renderEqCanvas(appState.bands, appState.eqEnabled),
);

new ResizeObserver(() => {
  renderEqCanvas(appState.bands, appState.eqEnabled);
}).observe(elements.canvas);

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
    const res = await commitDspState(
      appState.bands,
      appState.leftVol,
      appState.rightVol,
      appState.micGain,
    );
    if (res.success) {
      appState.markSaved();
      showToast("Settings saved to hardware", "success");
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
  appState.setWorking(true);
  const targetSlot = appState.eqEnabled ? SLOT.BYPASS : SLOT.CUSTOM;

  try {
    const res = await setDspBypassSlot(targetSlot);
    appState.setEqEnabled(res.enabled);
    showToast(res.enabled ? "EQ enabled" : "EQ disabled", "success");
    appState.setConnection(res.connected);
  } catch (err) {
    showToast(`Failed to toggle bypass: ${err.message}`, "error");
  } finally {
    appState.setWorking(false);
  }
}

function clearFilters() {
  appState.resetFilters();
  showToast("Filters reset. Click Commit to apply.", "success");
}

function exportPreset() {
  if (appState.isWorking || !appState.isConnected) return;
  const filename = exportConfigJSON(appState);
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
      appState.markChanged();
      showToast(
        `Imported ${cfg.bands.length} filter(s). Click Commit to apply.`,
        "success",
      );
    } catch (err) {
      showToast(err.message, "error");
    }
  };
  reader.readAsText(file);
}
