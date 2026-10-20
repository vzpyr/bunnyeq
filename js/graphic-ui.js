import {
  GRAPHIC_FREQS,
  GRAPHIC_LABELS,
  GRAPHIC_PRESETS,
  GRAPHIC_RANGE,
  PREAMP_RANGE,
  graphicTarget,
  sanitizeGains,
} from "./graphic.js";
import { savePref } from "./state.js";

const USER_PRESETS_KEY = "bunnyeq.userPresets";
const CUSTOM = "__custom__";

const el = {
  rack: document.getElementById("graphicRack"),
  presetSelect: document.getElementById("presetSelect"),
  savePresetBtn: document.getElementById("savePresetBtn"),
  deletePresetBtn: document.getElementById("deletePresetBtn"),
  autoPreamp: document.getElementById("autoPreampToggle"),
  fitInfo: document.getElementById("fitInfo"),
  note: document.getElementById("graphicNote"),
  graphicPanel: document.getElementById("graphicPanel"),
  parametricPanel: document.getElementById("parametricPanel"),
  tabs: document.querySelectorAll(".mode-tab"),
  preampHint: document.getElementById("preampHint"),
};

export function loadUserPresets() {
  try {
    const parsed = JSON.parse(localStorage.getItem(USER_PRESETS_KEY));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return {};
    const presets = {};
    for (const [name, gains] of Object.entries(parsed)) {
      const clean = sanitizeGains(gains);
      if (clean) presets[name] = clean;
    }
    return presets;
  } catch (_) {
    return {};
  }
}

function storeUserPresets(presets) {
  savePref(USER_PRESETS_KEY, presets);
}

export function presetGains(name) {
  if (Object.hasOwn(GRAPHIC_PRESETS, name)) return GRAPHIC_PRESETS[name];
  const user = loadUserPresets();
  return Object.hasOwn(user, name) ? user[name] : null;
}

const fmt = (db) => (db > 0 ? `+${db}` : `${db}`);
const fillPct = (v, min, max) => ((v - min) / (max - min)) * 100;

// The coloured bar runs from 0 dB to the knob, like Apple Music's equaliser.
function paintFill(input) {
  const min = parseFloat(input.min);
  const max = parseFloat(input.max);
  input.style.setProperty(
    "--p",
    `${fillPct(parseFloat(input.value), min, max)}%`,
  );
  input.style.setProperty(
    "--z",
    `${fillPct(Math.min(max, Math.max(min, 0)), min, max)}%`,
  );
}

function sliderColumn({ id, label, value, min, max, step, cls = "" }) {
  return `
    <div class="g-col ${cls}">
      <span class="g-val" id="${id}Val">${fmt(value)}</span>
      <div class="g-slot">
        <input type="range" class="g-slider" id="${id}" min="${min}" max="${max}"
          step="${step}" value="${value}" aria-label="${label}"
          style="--p: ${fillPct(value, min, max)}%">
      </div>
      <span class="g-label">${label}</span>
    </div>`;
}

export function renderGraphicRack(state) {
  const scale = `
    <div class="g-scale" aria-hidden="true">
      <span>+12 dB</span><span>0 dB</span><span>-12 dB</span>
    </div>`;
  el.rack.innerHTML =
    sliderColumn({
      id: "gPreamp",
      label: "Preamp",
      value: state.preamp,
      min: PREAMP_RANGE.MIN,
      max: PREAMP_RANGE.MAX,
      step: PREAMP_RANGE.STEP,
      cls: "g-preamp",
    }) +
    scale +
    GRAPHIC_FREQS.map((_, i) =>
      sliderColumn({
        id: `gBand${i}`,
        label: GRAPHIC_LABELS[i],
        value: state.graphicGains[i],
        min: GRAPHIC_RANGE.MIN,
        max: GRAPHIC_RANGE.MAX,
        step: GRAPHIC_RANGE.STEP,
      }),
    ).join("");
}

export function renderPresetOptions(selected) {
  const user = loadUserPresets();
  const opt = (name) =>
    `<option value="${escapeHtml(name)}" ${name === selected ? "selected" : ""}>${escapeHtml(name)}</option>`;
  const userNames = Object.keys(user);
  el.presetSelect.innerHTML =
    `<option value="${CUSTOM}" ${selected === CUSTOM ? "selected" : ""}>Manual</option>` +
    `<optgroup label="Classic presets">${Object.keys(GRAPHIC_PRESETS).map(opt).join("")}</optgroup>` +
    (userNames.length
      ? `<optgroup label="My presets">${userNames.map(opt).join("")}</optgroup>`
      : "");
  el.deletePresetBtn.disabled = !Object.hasOwn(user, selected);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

// `light` skips rebuilding the preset menu, for the many updates of a slider drag.
export function syncGraphicUi(state, { light = false } = {}) {
  el.tabs.forEach((tab) => {
    const active = tab.dataset.mode === state.mode;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  });
  el.graphicPanel.hidden = state.mode !== "graphic";
  el.parametricPanel.hidden = state.mode !== "parametric";

  state.graphicGains.forEach((g, i) => {
    const s = document.getElementById(`gBand${i}`);
    if (s && document.activeElement !== s) s.value = g;
    if (s) paintFill(s);
    const v = document.getElementById(`gBand${i}Val`);
    if (v) v.textContent = fmt(g);
  });
  const canInteract = state.isConnected && !state.isWorking;
  const pre = document.getElementById("gPreamp");
  if (pre) {
    if (document.activeElement !== pre) pre.value = state.preamp;
    paintFill(pre);
    pre.disabled = !canInteract || state.autoPreamp;
  }
  el.savePresetBtn.disabled = !canInteract;
  const preVal = document.getElementById("gPreampVal");
  if (preVal) preVal.textContent = fmt(state.preamp);
  el.autoPreamp.checked = state.autoPreamp;

  if (light) {
    el.presetSelect.value = state.graphicPreset;
  } else {
    renderPresetOptions(state.graphicPreset);
  }
  el.deletePresetBtn.disabled = el.deletePresetBtn.disabled || !canInteract;
  el.preampHint.textContent =
    state.preamp < 0
      ? `The Graphic tab's preamp (${fmt(state.preamp)} dB) is applied on top of these volumes.`
      : "";

  if (!state.graphicLinked) {
    el.fitInfo.textContent = "";
    el.note.textContent =
      "The IEM's filters were set in Parametric or by another app, so the sliders show an approximation of that curve. Moving a slider or picking a preset replaces it.";
  } else if (state.fitError > 1) {
    el.fitInfo.textContent = `Closest the IEM can get: within ${state.fitError.toFixed(1)} dB`;
    el.note.textContent =
      "This curve has more ups and downs than the IEM's five filters can follow exactly. The solid line is what you will hear.";
  } else {
    el.fitInfo.textContent =
      state.fitError > 0
        ? `Matched within ${state.fitError.toFixed(1)} dB`
        : "";
    el.note.textContent = "";
  }
}

export function graphicOverlay(state) {
  if (state.mode !== "graphic") return {};
  // Sliders only approximate a curve made elsewhere; don't draw them as the target.
  if (!state.graphicLinked) return { hideDots: true };
  const freqs = Array.from(
    { length: 200 },
    (_, i) => 20 * Math.pow(1000, i / 199),
  );
  const target = graphicTarget(state.graphicGains, freqs).map((db, i) => ({
    f: freqs[i],
    db,
  }));
  const knobs = GRAPHIC_FREQS.map((f, i) => ({ f, db: state.graphicGains[i] }));
  return { target, knobs, hideDots: true };
}

// Wires the rack. `onGains(gains, presetName, { final })` fires while dragging
// (final=false) and on release (final=true).
export function bindGraphicControls({
  getState,
  onGains,
  onPreamp,
  onAutoPreamp,
  onMode,
}) {
  el.rack.addEventListener("input", (e) => {
    const t = e.target;
    if (t.classList.contains("g-slider")) paintFill(t);
    if (t.id === "gPreamp") {
      onPreamp(parseFloat(t.value));
      return;
    }
    const m = /^gBand(\d)$/.exec(t.id);
    if (!m) return;
    const gains = getState().graphicGains.slice();
    gains[+m[1]] = parseFloat(t.value);
    document.getElementById(`${t.id}Val`).textContent = fmt(gains[+m[1]]);
    onGains(gains, CUSTOM, { final: false });
  });
  el.rack.addEventListener("change", (e) => {
    if (/^gBand\d$/.test(e.target.id)) {
      onGains(getState().graphicGains.slice(), CUSTOM, { final: true });
    }
  });
  // Double-click a slider to put it back to 0 dB, like most hardware EQ apps.
  el.rack.addEventListener("dblclick", (e) => {
    const m = /^gBand(\d)$/.exec(e.target.id);
    if (!m) return;
    const gains = getState().graphicGains.slice();
    gains[+m[1]] = 0;
    onGains(gains, CUSTOM, { final: true });
  });

  el.presetSelect.addEventListener("change", () => {
    const name = el.presetSelect.value;
    if (name === CUSTOM) return;
    const gains = presetGains(name);
    if (gains) onGains(gains.slice(), name, { final: true });
  });

  el.savePresetBtn.addEventListener("click", () => {
    const name = window.prompt("Name this preset:");
    if (!name || !name.trim()) return;
    const trimmed = name.trim();
    if (Object.hasOwn(GRAPHIC_PRESETS, trimmed) || trimmed === CUSTOM) {
      window.alert("That name is taken by a built-in preset. Pick another.");
      return;
    }
    const presets = loadUserPresets();
    presets[trimmed] = getState().graphicGains.slice();
    storeUserPresets(presets);
    onGains(presets[trimmed].slice(), trimmed, { final: true, quiet: true });
  });

  el.deletePresetBtn.addEventListener("click", () => {
    const name = el.presetSelect.value;
    const presets = loadUserPresets();
    if (!Object.hasOwn(presets, name)) return;
    if (!window.confirm(`Delete the preset "${name}"?`)) return;
    delete presets[name];
    storeUserPresets(presets);
    renderPresetOptions(CUSTOM);
  });

  el.autoPreamp.addEventListener("change", () =>
    onAutoPreamp(el.autoPreamp.checked),
  );

  el.tabs.forEach((tab) =>
    tab.addEventListener("click", () => onMode(tab.dataset.mode)),
  );
}

export { CUSTOM as CUSTOM_PRESET };
