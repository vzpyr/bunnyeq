import { AUDIO_LIMITS, FILTER_TYPE, CANVAS_CONFIG } from "./constants.js";
import { drawEQ, xToFreq, yToDb } from "./eq.js";

let notifyTimeout = null;
let activeDrag = null;
let cachedDots = [];

export const elements = {
  bandsContainer: document.getElementById("bands"),
  canvas: document.getElementById("eqCanvas"),
  statusDot: document.getElementById("statusDot"),
  statusText: document.getElementById("statusText"),
  chipId: document.getElementById("chipId"),
  notify: document.getElementById("notify"),
  disconnectOverlay: document.getElementById("disconnectOverlay"),
  disconnectMsg: document.getElementById("disconnectMsg"),
  disconnectError: document.getElementById("disconnectError"),
  app: document.getElementById("app"),
  connectHeaderBtn: document.getElementById("connectHeaderBtn"),
  retryBtn: document.getElementById("retryBtn"),
  readBtn: document.getElementById("readBtn"),
  commitBtn: document.getElementById("commitBtn"),
  bypassBtn: document.getElementById("bypassBtn"),
  clearBtn: document.getElementById("clearBtn"),
  exportBtn: document.getElementById("exportBtn"),
  importBtn: document.getElementById("importBtn"),
  importFile: document.getElementById("importFile"),
  leftVolSlider: document.getElementById("leftVolSlider"),
  leftVolInput: document.getElementById("leftVolInput"),
  rightVolSlider: document.getElementById("rightVolSlider"),
  rightVolInput: document.getElementById("rightVolInput"),
  micGainSlider: document.getElementById("micGainSlider"),
  micGainInput: document.getElementById("micGainInput"),
  themeToggle: document.getElementById("themeToggle"),
  themeIconSun: document.getElementById("themeIconSun"),
  themeIconMoon: document.getElementById("themeIconMoon"),
  asanoToggle: document.getElementById("asanoToggle"),
  asanoWrap: document.getElementById("asanoWrap"),
  linuxHintCopy: document.getElementById("linuxHintCopy"),
  linuxHintCode: document.getElementById("linuxHintCode"),
};

export function setDisconnectError(message) {
  if (message) {
    elements.disconnectError.textContent = message;
    elements.disconnectError.style.display = "block";
  } else {
    elements.disconnectError.textContent = "";
    elements.disconnectError.style.display = "none";
  }
}

export function showToast(message, type = "success", persistent = false) {
  if (notifyTimeout) {
    clearTimeout(notifyTimeout);
    notifyTimeout = null;
  }
  elements.notify.textContent = message;
  elements.notify.className = `notify ${type}`;
  if (!persistent) {
    notifyTimeout = setTimeout(() => {
      elements.notify.className = "notify";
    }, 4000);
  }
}

export function initTheme(onThemeChange) {
  const saved = localStorage.getItem("theme");
  const systemDark = window.matchMedia?.(
    "(prefers-color-scheme: dark)",
  ).matches;
  const initialTheme = saved || (systemDark ? "dark" : "light");

  applyTheme(initialTheme);

  elements.themeToggle.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme");
    const next = current === "dark" ? "light" : "dark";
    applyTheme(next);
    localStorage.setItem("theme", next);
    onThemeChange?.();
  });

  window
    .matchMedia?.("(prefers-color-scheme: dark)")
    .addEventListener("change", (e) => {
      if (!localStorage.getItem("theme")) {
        applyTheme(e.matches ? "dark" : "light");
        onThemeChange?.();
      }
    });
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  const isDark = theme === "dark";
  elements.themeIconSun.style.display = isDark ? "" : "none";
  elements.themeIconMoon.style.display = isDark ? "none" : "";
}

export function initAsanoToggle() {
  elements.asanoToggle.addEventListener("click", () => {
    elements.asanoWrap.classList.toggle("hidden");
    elements.asanoToggle.classList.toggle("hidden");
  });
}

export function initLinuxHint() {
  elements.linuxHintCopy.addEventListener("click", async () => {
    const copySvg = elements.linuxHintCopy.querySelector("svg");
    const originalSvg = copySvg.innerHTML;
    try {
      await navigator.clipboard.writeText(
        elements.linuxHintCode.textContent.trim() + "\n",
      );
      copySvg.innerHTML = '<path d="M20 6 9 17l-5-5" />';
      elements.linuxHintCopy.classList.add("copied");
      setTimeout(() => {
        copySvg.innerHTML = originalSvg;
        elements.linuxHintCopy.classList.remove("copied");
      }, 1500);
    } catch (_) {}
  });
}

export function renderBands(bands) {
  elements.bandsContainer.innerHTML = bands
    .map(
      (b, i) => `
    <div class="band ${b.disabled ? "disabled" : ""}" data-index="${i}">
      <div class="band-lead">
        <label class="band-switch" title="Toggle Band #${i + 1}">
          <input type="checkbox" class="band-toggle" data-band="${i}" ${!b.disabled ? "checked" : ""}>
          <span class="band-switch-slider"></span>
        </label>
        <span class="band-number">#${i + 1}</span>
      </div>
      <div class="band-field">
        <label>Type</label>
        <select class="band-type" data-band="${i}">
          <option value="${FILTER_TYPE.PEAK}" ${b.type === FILTER_TYPE.PEAK ? "selected" : ""}>Peak</option>
          <option value="${FILTER_TYPE.LOW_SHELF}" ${b.type === FILTER_TYPE.LOW_SHELF ? "selected" : ""}>Low Shelf</option>
          <option value="${FILTER_TYPE.HIGH_SHELF}" ${b.type === FILTER_TYPE.HIGH_SHELF ? "selected" : ""}>High Shelf</option>
        </select>
      </div>
      <div class="band-field">
        <label>Frequency</label>
        <input type="range" class="band-freq-slider" data-band="${i}" min="20" max="20000" value="${b.freq}" step="1">
        <div class="band-input-row">
          <input type="number" class="band-num band-freq-num" data-band="${i}" value="${b.freq}" min="20" max="20000" step="1">
          <span class="unit">Hz</span>
        </div>
      </div>
      <div class="band-field">
        <label>Gain</label>
        <input type="range" class="band-gain-slider" data-band="${i}" min="-12" max="12" value="${b.gain}" step="0.1">
        <div class="band-input-row">
          <input type="number" class="band-num band-gain-num" data-band="${i}" value="${b.gain}" min="-12" max="12" step="0.1">
          <span class="unit">dB</span>
        </div>
      </div>
      <div class="band-field">
        <label>Q Factor</label>
        <input type="range" class="band-q-slider" data-band="${i}" min="0.1" max="10" value="${b.q}" step="0.1">
        <div class="band-input-row">
          <input type="number" class="band-num band-q-num" data-band="${i}" value="${b.q}" min="0.1" max="10" step="0.1">
        </div>
      </div>
    </div>`,
    )
    .join("");

  updateFrequencyRanges(bands);
}

export function updateFrequencyRanges(bands) {
  const sliders = elements.bandsContainer.querySelectorAll(".band-freq-slider");
  sliders.forEach((slider, i) => {
    slider.min = i > 0 ? parseFloat(bands[i - 1].freq) + 1 : 20;
    slider.max = i < 4 ? parseFloat(bands[i + 1].freq) - 1 : 20000;
  });
}

export function bindBandDelegation(onBandChange) {
  elements.bandsContainer.addEventListener("input", (e) => {
    const target = e.target;
    const bandIdx = parseInt(target.dataset.band, 10);
    if (isNaN(bandIdx)) return;

    if (target.classList.contains("band-freq-slider")) {
      const numInput = elements.bandsContainer.querySelector(
        `.band-freq-num[data-band="${bandIdx}"]`,
      );
      if (numInput) numInput.value = target.value;
      onBandChange(bandIdx, { freq: parseFloat(target.value) });
    } else if (target.classList.contains("band-gain-slider")) {
      const numInput = elements.bandsContainer.querySelector(
        `.band-gain-num[data-band="${bandIdx}"]`,
      );
      if (numInput) numInput.value = target.value;
      onBandChange(bandIdx, { gain: parseFloat(target.value) });
    } else if (target.classList.contains("band-q-slider")) {
      const numInput = elements.bandsContainer.querySelector(
        `.band-q-num[data-band="${bandIdx}"]`,
      );
      if (numInput) numInput.value = target.value;
      onBandChange(bandIdx, { q: parseFloat(target.value) });
    }
  });

  elements.bandsContainer.addEventListener("change", (e) => {
    const target = e.target;
    const bandIdx = parseInt(target.dataset.band, 10);
    if (isNaN(bandIdx)) return;

    if (target.classList.contains("band-type")) {
      onBandChange(bandIdx, { type: target.value });
    } else if (target.classList.contains("band-toggle")) {
      const card = elements.bandsContainer.querySelector(
        `.band[data-index="${bandIdx}"]`,
      );
      if (card) card.classList.toggle("disabled", !target.checked);
      onBandChange(bandIdx, { disabled: !target.checked });
    } else if (target.classList.contains("band-num")) {
      const isFreq = target.classList.contains("band-freq-num");
      const isGain = target.classList.contains("band-gain-num");
      const sliderClass = isFreq
        ? ".band-freq-slider"
        : isGain
          ? ".band-gain-slider"
          : ".band-q-slider";
      const slider = elements.bandsContainer.querySelector(
        `${sliderClass}[data-band="${bandIdx}"]`,
      );
      if (slider) {
        let val = parseFloat(target.value);
        if (isNaN(val)) val = parseFloat(slider.value);
        const min = parseFloat(slider.min);
        const max = parseFloat(slider.max);
        val = Math.max(min, Math.min(max, val));
        slider.value = val;
        target.value = val;
        const key = isFreq ? "freq" : isGain ? "gain" : "q";
        onBandChange(bandIdx, { [key]: val });
      }
    }
  });
}

export function bindVolumeControls(onVolumeChange, onMicGainChange) {
  const syncPair = (slider, input, onChange) => {
    slider.addEventListener("input", () => {
      input.value = slider.value;
      onChange(parseFloat(slider.value));
    });
    input.addEventListener("change", () => {
      let val = parseFloat(input.value);
      if (isNaN(val)) val = parseFloat(slider.value);
      val = Math.max(
        parseFloat(slider.min),
        Math.min(parseFloat(slider.max), val),
      );
      slider.value = val;
      input.value = val;
      onChange(val);
    });
  };

  syncPair(elements.leftVolSlider, elements.leftVolInput, (v) =>
    onVolumeChange("left", v),
  );
  syncPair(elements.rightVolSlider, elements.rightVolInput, (v) =>
    onVolumeChange("right", v),
  );
  syncPair(elements.micGainSlider, elements.micGainInput, onMicGainChange);
}

export function initCanvasInteraction(getState, onBandChange, redraw) {
  const canvas = elements.canvas;

  const getCanvasCoords = (e) => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      w: rect.width,
      h: rect.height,
    };
  };

  canvas.addEventListener("pointerdown", (e) => {
    const state = getState();
    if (state.isWorking || !state.isConnected) return;

    const { x, y } = getCanvasCoords(e);
    for (let i = cachedDots.length - 1; i >= 0; i--) {
      const dot = cachedDots[i];
      if ((x - dot.x) ** 2 + (y - dot.y) ** 2 <= CANVAS_CONFIG.HIT_RADIUS_SQ) {
        activeDrag = dot.band;
        canvas.setPointerCapture(e.pointerId);
        canvas.style.cursor = "grabbing";
        e.preventDefault();
        return;
      }
    }
  });

  canvas.addEventListener("pointermove", (e) => {
    const { x, y, w, h } = getCanvasCoords(e);

    if (activeDrag === null) {
      const isHovering = cachedDots.some(
        (dot) =>
          (x - dot.x) ** 2 + (y - dot.y) ** 2 <= CANVAS_CONFIG.HIT_RADIUS_SQ,
      );
      canvas.style.cursor = isHovering ? "grab" : "";
      return;
    }

    const state = getState();
    const bandIdx = activeDrag;
    const bands = state.bands;

    const minFreq = bandIdx > 0 ? parseFloat(bands[bandIdx - 1].freq) + 1 : 20;
    const maxFreq =
      bandIdx < 4 ? parseFloat(bands[bandIdx + 1].freq) - 1 : 20000;
    const freq = Math.max(minFreq, Math.min(maxFreq, xToFreq(x, w)));
    const gain = Math.max(-12, Math.min(12, yToDb(y, h)));

    onBandChange(bandIdx, { freq, gain });
    updateBandInputs(bandIdx, freq, gain);
    redraw();
  });

  const stopDrag = (e) => {
    if (activeDrag !== null) {
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch (_) {}
      activeDrag = null;
      canvas.style.cursor = "";
    }
  };

  canvas.addEventListener("pointerup", stopDrag);
  canvas.addEventListener("pointercancel", stopDrag);
}

function updateBandInputs(bandIdx, freq, gain) {
  const freqSlider = elements.bandsContainer.querySelector(
    `.band-freq-slider[data-band="${bandIdx}"]`,
  );
  const freqNum = elements.bandsContainer.querySelector(
    `.band-freq-num[data-band="${bandIdx}"]`,
  );
  const gainSlider = elements.bandsContainer.querySelector(
    `.band-gain-slider[data-band="${bandIdx}"]`,
  );
  const gainNum = elements.bandsContainer.querySelector(
    `.band-gain-num[data-band="${bandIdx}"]`,
  );

  if (freqSlider) freqSlider.value = freq;
  if (freqNum) freqNum.value = freq;
  if (gainSlider) gainSlider.value = gain;
  if (gainNum) gainNum.value = gain;
}

export function renderEqCanvas(bands, eqEnabled) {
  cachedDots = drawEQ(elements.canvas, bands, eqEnabled);
  return cachedDots;
}

export function syncUiFromState(state) {
  elements.statusDot.className = state.isConnected
    ? "status-dot"
    : "status-dot error";
  elements.statusText.textContent = state.isConnected
    ? "Connected"
    : "Disconnected";
  elements.chipId.textContent = state.chipId || "-";
  elements.connectHeaderBtn.style.display = state.isConnected ? "none" : "";
  elements.disconnectOverlay.classList.toggle("visible", !state.isConnected);
  elements.app.classList.toggle("offline", !state.isConnected);

  const canInteract = state.isConnected && !state.isWorking;
  elements.readBtn.disabled = !canInteract;
  elements.commitBtn.disabled = !canInteract || !state.hasChanges;
  elements.bypassBtn.disabled = !canInteract;
  elements.clearBtn.disabled = !canInteract;
  elements.importBtn.disabled = !canInteract;
  elements.exportBtn.disabled = !canInteract;

  const allInputs = elements.app.querySelectorAll("input, select");
  allInputs.forEach((el) => {
    el.disabled = !canInteract;
  });

  const powerIcon =
    '<svg class="icon-sm" xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.77.04"/></svg>';
  elements.bypassBtn.innerHTML = `${powerIcon} ${state.eqEnabled ? "Disable EQ" : "Enable EQ"}`;

  elements.leftVolSlider.value = state.leftVol;
  elements.leftVolInput.value = state.leftVol;
  elements.rightVolSlider.value = state.rightVol;
  elements.rightVolInput.value = state.rightVol;
  elements.micGainSlider.value = state.micGain;
  elements.micGainInput.value = state.micGain;

  for (let i = 0; i < state.bands.length; i++) {
    const b = state.bands[i];
    const card = elements.bandsContainer.querySelector(
      `.band[data-index="${i}"]`,
    );
    if (!card) continue;

    card.classList.toggle("disabled", Boolean(b.disabled));
    const toggle = card.querySelector(".band-toggle");
    if (toggle) toggle.checked = !b.disabled;
    const typeSelect = card.querySelector(".band-type");
    if (typeSelect) typeSelect.value = b.type;

    const freqSlider = card.querySelector(".band-freq-slider");
    const freqNum = card.querySelector(".band-freq-num");
    if (freqSlider) freqSlider.value = b.freq;
    if (freqNum) freqNum.value = b.freq;

    const gainSlider = card.querySelector(".band-gain-slider");
    const gainNum = card.querySelector(".band-gain-num");
    if (gainSlider) gainSlider.value = b.gain;
    if (gainNum) gainNum.value = b.gain;

    const qSlider = card.querySelector(".band-q-slider");
    const qNum = card.querySelector(".band-q-num");
    if (qSlider) qSlider.value = b.q;
    if (qNum) qNum.value = b.q;
  }

  updateFrequencyRanges(state.bands);
  renderEqCanvas(state.bands, state.eqEnabled);
}
