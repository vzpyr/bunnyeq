import { transport } from "./transport.js";
import { readAll, commitDSP, toggleBypassDSP } from "./dsp.js";
import { drawEQ } from "./eq.js";
import {
  createDefaultBands,
  exportConfigJSON,
  parseConfigJSON,
} from "./config.js";

let bands = createDefaultBands();
let leftVol = 0;
let rightVol = 0;
let micGain = 0;
let eqEnabled = true;
let hasChanges = false;
let isWorking = false;
let isReading = false;
let dots = [];
let drag = null;
let notifyTimer = null;

const bandsContainer = document.getElementById("bands");
const canvas = document.getElementById("eqCanvas");
const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");
const chipIdEl = document.getElementById("chipId");
const notifyEl = document.getElementById("notify");
const disconnectOverlay = document.getElementById("disconnectOverlay");
const appEl = document.getElementById("app");

const connectHeaderBtn = document.getElementById("connectHeaderBtn");
const retryBtn = document.getElementById("retryBtn");
const readBtn = document.getElementById("readBtn");
const commitBtn = document.getElementById("commitBtn");
const bypassBtn = document.getElementById("bypassBtn");
const clearBtn = document.getElementById("clearBtn");
const exportBtn = document.getElementById("exportBtn");
const importBtn = document.getElementById("importBtn");
const importFileInput = document.getElementById("importFile");

const leftVolSlider = document.getElementById("leftVolSlider");
const leftVolInput = document.getElementById("leftVolInput");
const rightVolSlider = document.getElementById("rightVolSlider");
const rightVolInput = document.getElementById("rightVolInput");
const micGainSlider = document.getElementById("micGainSlider");
const micGainInput = document.getElementById("micGainInput");

const themeToggleBtn = document.getElementById("themeToggle");
const themeIconSun = document.getElementById("themeIconSun");
const themeIconMoon = document.getElementById("themeIconMoon");
const asanoToggleBtn = document.getElementById("asanoToggle");
const asanoWrap = document.getElementById("asanoWrap");
const linuxHintCopyBtn = document.getElementById("linuxHintCopy");
const linuxHintCode = document.getElementById("linuxHintCode");

renderBands();
setupEventListeners();
initTheme();
redrawEQ();
new ResizeObserver(() => redrawEQ()).observe(canvas);

initConnection();

function renderBands() {
  bandsContainer.innerHTML = bands
    .map(
      (b, i) => `
    <div class="band ${b.disabled ? "disabled" : ""}" id="band${i}">
      <div class="band-lead">
        <label class="band-switch" title="Toggle Band #${i + 1}">
          <input type="checkbox" id="toggle${i}" data-band="${i}" ${!b.disabled ? "checked" : ""}>
          <span class="band-switch-slider"></span>
        </label>
        <span class="band-number">#${i + 1}</span>
      </div>
      <div class="band-field">
        <label>Type</label>
        <select id="type${i}">
          <option value="PK" ${b.type === "PK" ? "selected" : ""}>Peak</option>
          <option value="LSQ" ${b.type === "LSQ" ? "selected" : ""}>Low Shelf</option>
          <option value="HSQ" ${b.type === "HSQ" ? "selected" : ""}>High Shelf</option>
        </select>
      </div>
      <div class="band-field">
        <label>Frequency</label>
        <input type="range" id="freq${i}" min="20" max="20000" value="${b.freq}" step="1">
        <div class="band-input-row">
          <input type="number" id="freqNum${i}" class="band-num" value="${b.freq}" min="20" max="20000" step="1">
          <span class="unit">Hz</span>
        </div>
      </div>
      <div class="band-field">
        <label>Gain</label>
        <input type="range" id="gain${i}" min="-12" max="12" value="${b.gain}" step="0.1">
        <div class="band-input-row">
          <input type="number" id="gainNum${i}" class="band-num" value="${b.gain}" min="-12" max="12" step="0.1">
          <span class="unit">dB</span>
        </div>
      </div>
      <div class="band-field">
        <label>Q Factor</label>
        <input type="range" id="q${i}" min="0.1" max="10" value="${b.q}" step="0.1">
        <div class="band-input-row">
          <input type="number" id="qNum${i}" class="band-num" value="${b.q}" min="0.1" max="10" step="0.1">
        </div>
      </div>
    </div>`,
    )
    .join("");

  for (let i = 0; i < 5; i++) {
    const typeEl = document.getElementById(`type${i}`);
    const freqEl = document.getElementById(`freq${i}`);
    const freqNumEl = document.getElementById(`freqNum${i}`);
    const gainEl = document.getElementById(`gain${i}`);
    const gainNumEl = document.getElementById(`gainNum${i}`);
    const qEl = document.getElementById(`q${i}`);
    const qNumEl = document.getElementById(`qNum${i}`);
    const toggleEl = document.getElementById(`toggle${i}`);

    typeEl.addEventListener("change", () => onBandTypeChange(i, typeEl.value));

    freqEl.addEventListener("input", () => {
      freqNumEl.value = freqEl.value;
      onBandFieldChange(i, "freq", parseFloat(freqEl.value));
    });
    freqNumEl.addEventListener("change", () =>
      onBandNumChange(i, "freq", freqNumEl, freqEl),
    );
    freqNumEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        onBandNumChange(i, "freq", freqNumEl, freqEl);
      }
    });

    gainEl.addEventListener("input", () => {
      gainNumEl.value = gainEl.value;
      onBandFieldChange(i, "gain", parseFloat(gainEl.value));
    });
    gainNumEl.addEventListener("change", () =>
      onBandNumChange(i, "gain", gainNumEl, gainEl),
    );
    gainNumEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        onBandNumChange(i, "gain", gainNumEl, gainEl);
      }
    });

    qEl.addEventListener("input", () => {
      qNumEl.value = qEl.value;
      onBandFieldChange(i, "q", parseFloat(qEl.value));
    });
    qNumEl.addEventListener("change", () =>
      onBandNumChange(i, "q", qNumEl, qEl),
    );
    qNumEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        onBandNumChange(i, "q", qNumEl, qEl);
      }
    });

    toggleEl.addEventListener("change", (e) =>
      onToggleBand(i, e.target.checked),
    );
  }

  enforceFreqOrder();
}

function setupEventListeners() {
  connectHeaderBtn.addEventListener("click", () => connectDevice(true));
  retryBtn.addEventListener("click", () => connectDevice(true));

  readBtn.addEventListener("click", () => handleRead());
  commitBtn.addEventListener("click", () => handleCommit());
  bypassBtn.addEventListener("click", () => handleToggleBypass());
  clearBtn.addEventListener("click", () => handleClear());

  exportBtn.addEventListener("click", () => handleExport());
  importBtn.addEventListener("click", () => importFileInput.click());
  importFileInput.addEventListener("change", (e) => handleImport(e));

  leftVolSlider.addEventListener("input", () => {
    leftVolInput.value = leftVolSlider.value;
    leftVol = parseFloat(leftVolSlider.value);
    if (!isReading) markChanged();
  });
  leftVolInput.addEventListener("change", () => {
    leftVolSlider.value = leftVolInput.value;
    leftVol = parseFloat(leftVolSlider.value);
    if (!isReading) markChanged();
  });

  rightVolSlider.addEventListener("input", () => {
    rightVolInput.value = rightVolSlider.value;
    rightVol = parseFloat(rightVolSlider.value);
    if (!isReading) markChanged();
  });
  rightVolInput.addEventListener("change", () => {
    rightVolSlider.value = rightVolInput.value;
    rightVol = parseFloat(rightVolSlider.value);
    if (!isReading) markChanged();
  });

  micGainSlider.addEventListener("input", () => {
    micGainInput.value = micGainSlider.value;
    micGain = parseFloat(micGainSlider.value);
    if (!isReading) markChanged();
  });
  micGainInput.addEventListener("change", () => {
    micGainSlider.value = micGainInput.value;
    micGain = parseFloat(micGainSlider.value);
    if (!isReading) markChanged();
  });

  themeToggleBtn.addEventListener("click", toggleTheme);
  asanoToggleBtn.addEventListener("click", toggleAsano);
  linuxHintCopyBtn.addEventListener("click", () => handleCopyLinuxHint());

  canvas.addEventListener("mousedown", onCanvasPointerDown);
  window.addEventListener("mousemove", onCanvasPointerMove);
  window.addEventListener("mouseup", onCanvasPointerUp);

  canvas.addEventListener("touchstart", onCanvasTouchDown, { passive: false });
  window.addEventListener("touchmove", onCanvasTouchMove, { passive: false });
  window.addEventListener("touchend", onCanvasTouchUp);
  window.addEventListener("touchcancel", onCanvasTouchUp);

  transport.onDisconnect(() => onDisconnected());
  transport.onConnect(() => connectDevice(false));
}

async function initConnection() {
  if (!transport.isSupported()) {
    notify("Please open in a Chromium-based browser.", "error", true);
    document.getElementById("disconnectMsg").textContent =
      "Please open in a Chromium-based browser.";
    retryBtn.disabled = true;
    return;
  }

  try {
    const ok = await transport.connect(false);
    if (ok) {
      onConnected();
      await handleRead(true);
    } else {
      onDisconnected();
    }
  } catch (_) {
    onDisconnected();
  }
}

async function connectDevice(interactive = false) {
  if (isWorking) return;
  try {
    const ok = await transport.connect(interactive);
    if (ok) {
      onConnected();
      notify("Device connected", "success");
      await handleRead(true);
    } else {
      onDisconnected();
    }
  } catch (err) {
    notify(`Failed to connect: ${err.message}`, "error");
    onDisconnected();
  }
}

function onConnected() {
  disconnectOverlay.classList.remove("visible");
  appEl.classList.remove("offline");
  statusDot.className = "status-dot";
  statusText.textContent = "Connected";
  connectHeaderBtn.style.display = "none";
  syncButtonStates();
}

function onDisconnected() {
  statusDot.className = "status-dot error";
  statusText.textContent = "Disconnected";
  chipIdEl.textContent = "-";
  connectHeaderBtn.style.display = "";
  disconnectOverlay.classList.add("visible");
  appEl.classList.add("offline");
  syncButtonStates();
}

function syncButtonStates() {
  const connected = transport.isConnected();
  const canInteract = connected && !isWorking;

  readBtn.disabled = !canInteract;
  commitBtn.disabled = !canInteract || !hasChanges;
  bypassBtn.disabled = !canInteract;
  clearBtn.disabled = !canInteract;
  importBtn.disabled = !canInteract;
  exportBtn.disabled = !canInteract;

  const inputs = document.querySelectorAll(
    ".band input, .band select, .volume-row input",
  );
  inputs.forEach((el) => {
    el.disabled = !canInteract;
  });
}

function markChanged() {
  if (isReading) return;
  if (!hasChanges) {
    hasChanges = true;
    syncButtonStates();
  }
}

function onBandTypeChange(index, value) {
  bands[index].type = value;
  markChanged();
  redrawEQ();
}

function onBandFieldChange(index, field, value) {
  bands[index][field] = value;
  enforceFreqOrder();
  markChanged();
  redrawEQ();
}

function onBandNumChange(index, field, inputEl, sliderEl) {
  let v = parseFloat(inputEl.value);
  if (isNaN(v)) {
    inputEl.value = sliderEl.value;
    return;
  }
  const min = parseFloat(sliderEl.min);
  const max = parseFloat(sliderEl.max);
  const step = parseFloat(sliderEl.step) || 1;
  v = Math.round(v / step) * step;
  v = Math.max(min, Math.min(max, v));
  sliderEl.value = v;
  inputEl.value = v;
  onBandFieldChange(index, field, v);
}

function onToggleBand(index, enabled) {
  bands[index].disabled = !enabled;
  const bandEl = document.getElementById(`band${index}`);
  if (bandEl) {
    bandEl.classList.toggle("disabled", bands[index].disabled);
  }
  markChanged();
  redrawEQ();
}

function enforceFreqOrder() {
  for (let i = 0; i < 5; i++) {
    const s = document.getElementById(`freq${i}`);
    if (!s) continue;
    s.min = i > 0 ? parseFloat(bands[i - 1].freq) + 1 : 20;
    s.max = i < 4 ? parseFloat(bands[i + 1].freq) - 1 : 20000;
  }
}

function updateUIFromState() {
  isReading = true;
  for (let i = 0; i < 5; i++) {
    const b = bands[i];
    document.getElementById(`type${i}`).value = b.type;
    document.getElementById(`freq${i}`).value = b.freq;
    document.getElementById(`freqNum${i}`).value = b.freq;
    document.getElementById(`gain${i}`).value = b.gain;
    document.getElementById(`gainNum${i}`).value = b.gain;
    document.getElementById(`q${i}`).value = b.q;
    document.getElementById(`qNum${i}`).value = b.q;

    const toggleEl = document.getElementById(`toggle${i}`);
    if (toggleEl) {
      toggleEl.checked = !b.disabled;
    }
    const bandEl = document.getElementById(`band${i}`);
    if (bandEl) {
      bandEl.classList.toggle("disabled", !!b.disabled);
    }
  }

  leftVolSlider.value = leftVol;
  leftVolInput.value = leftVol;
  rightVolSlider.value = rightVol;
  rightVolInput.value = rightVol;
  micGainSlider.value = micGain;
  micGainInput.value = micGain;

  updateBypassUI();
  enforceFreqOrder();
  isReading = false;
  redrawEQ();
}

function updateBypassUI() {
  const iconHtml =
    '<svg class="lucide lucide-power-icon lucide-power" xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.77.04"/></svg>';
  bypassBtn.innerHTML = `${iconHtml} ${eqEnabled ? "Disable EQ" : "Enable EQ"}`;
}

function redrawEQ() {
  dots = drawEQ(canvas, bands, eqEnabled);
}

function notify(msg, type = "success", persistent = false) {
  notifyEl.textContent = msg;
  notifyEl.className = `notify ${type}`;
  if (notifyTimer) {
    clearTimeout(notifyTimer);
    notifyTimer = null;
  }
  if (!persistent) {
    notifyTimer = setTimeout(() => {
      notifyEl.className = "notify";
    }, 4000);
  }
}

async function handleRead(quiet = false) {
  if (isWorking) return;
  isWorking = true;
  syncButtonStates();
  if (!quiet) notify("Reading settings...");

  try {
    const data = await readAll();
    bands = data.filters;
    leftVol = data.leftVol;
    rightVol = data.rightVol;
    micGain = data.micGain;
    eqEnabled = data.enabled;
    chipIdEl.textContent = data.chipId || "?";

    updateUIFromState();
    hasChanges = false;
    if (!quiet) notify(`Loaded ${bands.length} filters`, "success");
  } catch (err) {
    notify(`Failed to read device: ${err.message}`, "error");
  } finally {
    isWorking = false;
    syncButtonStates();
  }
}

async function handleCommit() {
  if (isWorking || !hasChanges || !transport.isConnected()) return;
  isWorking = true;
  syncButtonStates();
  notify("Saving settings...");

  try {
    const res = await commitDSP(bands, leftVol, rightVol, micGain);
    if (res.success) {
      hasChanges = false;
      notify("Settings saved to device", "success");
      if (res.connected) {
        onConnected();
      } else {
        onDisconnected();
      }
    }
  } catch (err) {
    notify(`Failed to save settings: ${err.message}`, "error");
  } finally {
    isWorking = false;
    syncButtonStates();
  }
}

async function handleToggleBypass() {
  if (isWorking || !transport.isConnected()) return;
  isWorking = true;
  syncButtonStates();
  const targetSlot = eqEnabled ? 2 : 3;

  try {
    const res = await toggleBypassDSP(targetSlot);
    eqEnabled = res.enabled;
    updateBypassUI();
    redrawEQ();
    notify(eqEnabled ? "EQ enabled" : "EQ disabled", "success");
    if (res.connected) {
      onConnected();
    } else {
      onDisconnected();
    }
  } catch (err) {
    notify(`Failed to toggle EQ: ${err.message}`, "error");
  } finally {
    isWorking = false;
    syncButtonStates();
  }
}

function handleClear() {
  bands = createDefaultBands();
  leftVol = 0;
  rightVol = 0;
  micGain = 0;
  updateUIFromState();
  markChanged();
  notify("Filters reset. Click Commit to apply.", "success");
}

function handleExport() {
  if (isWorking || !transport.isConnected()) return;
  const filename = exportConfigJSON({
    leftVol,
    rightVol,
    micGain,
    bands,
  });
  notify(`Exported configuration to ${filename}`, "success");
}

function handleImport(event) {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const cfg = parseConfigJSON(e.target.result);
      bands = cfg.bands;
      leftVol = cfg.leftVol;
      rightVol = cfg.rightVol;
      micGain = cfg.micGain;
      updateUIFromState();
      markChanged();
      notify(
        `Imported ${bands.length} filter(s). Click Commit to apply.`,
        "success",
      );
    } catch (err) {
      notify(err.message, "error");
    }
  };
  reader.readAsText(file);
}

function initTheme() {
  const saved = localStorage.getItem("theme");
  const systemDark =
    window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;
  const theme = saved || (systemDark ? "dark" : "light");
  document.documentElement.setAttribute("data-theme", theme);
  syncThemeIcons();

  if (window.matchMedia) {
    window
      .matchMedia("(prefers-color-scheme: dark)")
      .addEventListener("change", (e) => {
        if (!localStorage.getItem("theme")) {
          document.documentElement.setAttribute(
            "data-theme",
            e.matches ? "dark" : "light",
          );
          syncThemeIcons();
          redrawEQ();
        }
      });
  }
}

function toggleTheme() {
  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  const nextTheme = isDark ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", nextTheme);
  localStorage.setItem("theme", nextTheme);
  syncThemeIcons();
  redrawEQ();
}

function syncThemeIcons() {
  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  themeIconSun.style.display = isDark ? "" : "none";
  themeIconMoon.style.display = isDark ? "none" : "";
}

function toggleAsano() {
  asanoWrap.classList.toggle("hidden");
  asanoToggleBtn.classList.toggle("hidden");
}

async function copyText(value) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

async function handleCopyLinuxHint() {
  const copyIcon =
    '<path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /><rect width="14" height="14" x="8" y="8" rx="2" ry="2" />';
  const checkIcon = '<path d="M20 6 9 17l-5-5" />';
  try {
    await copyText(linuxHintCode.textContent.trim() + "\n");
    const icon = linuxHintCopyBtn.querySelector("svg");
    icon.innerHTML = checkIcon;
    linuxHintCopyBtn.classList.add("copied");
    linuxHintCopyBtn.title = "Copied";
    setTimeout(() => {
      icon.innerHTML = copyIcon;
      linuxHintCopyBtn.classList.remove("copied");
      linuxHintCopyBtn.title = "Copy command";
    }, 1500);
  } catch (_) {}
}

function getPointerCanvasCoords(e) {
  const r = canvas.getBoundingClientRect();
  let clientX = e.clientX;
  let clientY = e.clientY;
  if (e.touches && e.touches.length > 0) {
    clientX = e.touches[0].clientX;
    clientY = e.touches[0].clientY;
  }
  return {
    mx: clientX - r.left,
    my: clientY - r.top,
    W: r.width,
    H: r.height,
  };
}

function onCanvasPointerDown(e) {
  if (isWorking || !transport.isConnected()) return;
  const { mx, my } = getPointerCanvasCoords(e);
  for (let i = dots.length - 1; i >= 0; i--) {
    const d = dots[i];
    if ((mx - d.x) ** 2 + (my - d.y) ** 2 <= 64) {
      drag = { band: d.band };
      canvas.style.cursor = "grabbing";
      e.preventDefault();
      return;
    }
  }
}

function onCanvasPointerMove(e) {
  if (!drag) {
    const { mx, my } = getPointerCanvasCoords(e);
    let over = false;
    for (const d of dots) {
      if ((mx - d.x) ** 2 + (my - d.y) ** 2 <= 64) {
        over = true;
        break;
      }
    }
    canvas.style.cursor = over ? "grab" : "";
    return;
  }

  const { mx, my, W, H } = getPointerCanvasCoords(e);
  const b = drag.band;
  const fMin = 20;
  const fMax = 20000;
  const dbMin = -15;
  const dbMax = 15;

  let freq = Math.round(
    fMin * Math.pow(fMax / fMin, Math.max(0, Math.min(1, mx / W))),
  );
  if (b > 0) freq = Math.max(freq, parseFloat(bands[b - 1].freq) + 1);
  if (b < 4) freq = Math.min(freq, parseFloat(bands[b + 1].freq) - 1);
  freq = Math.max(20, Math.min(20000, freq));

  let gain = Math.round((dbMax - (my / H) * (dbMax - dbMin)) * 10) / 10;
  gain = Math.max(-12, Math.min(12, gain));

  bands[b].freq = freq;
  bands[b].gain = gain;

  document.getElementById(`freq${b}`).value = freq;
  document.getElementById(`freqNum${b}`).value = freq;
  document.getElementById(`gain${b}`).value = gain;
  document.getElementById(`gainNum${b}`).value = gain;

  enforceFreqOrder();
  markChanged();
  redrawEQ();
}

function onCanvasPointerUp() {
  drag = null;
  canvas.style.cursor = "";
}

function onCanvasTouchDown(e) {
  if (e.touches.length > 0) {
    onCanvasPointerDown(e);
  }
}

function onCanvasTouchMove(e) {
  if (drag && e.touches.length > 0) {
    e.preventDefault();
    onCanvasPointerMove(e);
  }
}

function onCanvasTouchUp() {
  onCanvasPointerUp();
}
