import {
  DEVICE,
  COMMAND,
  REGISTER,
  SLOT,
  AUDIO_LIMITS,
  FILTER_TYPE,
} from "./constants.js";
import {
  buildReadPacket,
  buildGainFreqPacket,
  buildQTypePacket,
  buildVolumePacket,
  buildMicGainPacket,
  buildEnablePacket,
  buildCommitPacket,
  parseGainFreq,
  parseQType,
  decodeVolume,
} from "./protocol.js";
import { transport } from "./transport.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// One HID conversation at a time: live writes, reads and saves must not interleave.
let deviceQueue = Promise.resolve();
function exclusive(task) {
  const run = deviceQueue.then(task, task);
  deviceQueue = run.catch(() => {});
  return run;
}

// Last packet written to each register, so live updates only send what changed.
const lastWritten = new Map();
const packetKey = (packet) => Array.from(packet).join(",");

export function forgetLiveState() {
  lastWritten.clear();
}

// After a replug the DSP is back on its flash settings, so the cache is void.
transport.onDisconnect(forgetLiveState);

// The Android bridge reconnects natively without telling the page, so a silent
// replug could leave the cache wrong there. Always send every register on it.
const canSkipUnchanged = () => !transport.isAndroidBridge();

let liveErrorHandler = () => {};
export function onLiveError(handler) {
  liveErrorHandler = handler;
}

function filterPackets(filters) {
  const packets = [];
  for (let i = 0; i < AUDIO_LIMITS.FILTER_COUNT; i++) {
    const f = filters[i] || {
      freq: AUDIO_LIMITS.DEFAULT_FREQS[i] ?? 1000,
      gain: 0,
      q: AUDIO_LIMITS.Q.DEFAULT,
      type: FILTER_TYPE.PEAK,
      disabled: false,
    };
    const gfReg = REGISTER.FILTER_BASE + i * 2;
    const gain = f.disabled ? 0 : f.gain;
    packets.push([gfReg, buildGainFreqPacket(gfReg, f.freq, gain)]);
    packets.push([gfReg + 1, buildQTypePacket(gfReg + 1, f.q, f.type)]);
  }
  return packets;
}

let pendingLive = null;
let liveRunning = false;

// Writes the current settings to the DSP's working registers, which it plays
// immediately. Nothing is saved to flash: unplugging reverts to the last save.
// Calls made while a write is in flight collapse into one follow-up write.
export function liveSync(filters, leftVol, rightVol, micGain) {
  pendingLive = { filters, leftVol, rightVol, micGain };
  if (liveRunning) return;
  liveRunning = true;
  exclusive(async () => {
    try {
      while (pendingLive && transport.isConnected()) {
        const {
          filters: f,
          leftVol: l,
          rightVol: r,
          micGain: mic,
        } = pendingLive;
        pendingLive = null;
        const packets = [
          ...filterPackets(f),
          [REGISTER.VOLUME, buildVolumePacket(l, r)],
          [REGISTER.MIC_GAIN, buildMicGainPacket(mic)],
        ];
        for (const [reg, packet] of packets) {
          if (pendingLive) break;
          const key = packetKey(packet);
          if (canSkipUnchanged() && lastWritten.get(reg) === key) continue;
          await transport.sendReport(DEVICE.REPORT_DSP, packet);
          lastWritten.set(reg, key);
        }
      }
    } catch (err) {
      forgetLiveState();
      liveErrorHandler(err);
    } finally {
      liveRunning = false;
      pendingLive = null;
    }
  });
}

// A/B switch between the custom EQ and the DSP's flat bypass, without saving.
export function setLiveSlot(targetSlot) {
  return exclusive(async () => {
    if (!transport.isConnected()) throw new Error("Device not connected");
    await transport.sendReport(
      DEVICE.REPORT_DSP,
      buildEnablePacket(targetSlot),
    );
    await transport.sendReport(
      DEVICE.REPORT_DSP,
      buildReadPacket(REGISTER.ENABLE),
    );
    const slotData = await transport.readResponse(
      REGISTER.ENABLE,
      COMMAND.READ,
      500,
    );
    return { enabled: (slotData ? slotData[6] : targetSlot) === SLOT.CUSTOM };
  });
}

export function readDspState() {
  return exclusive(readDspStateNow);
}

async function readDspStateNow() {
  forgetLiveState();
  if (!transport.isConnected()) {
    throw new Error("Device not connected");
  }

  await transport.sendReport(
    DEVICE.REPORT_DSP,
    buildReadPacket(REGISTER.ENABLE),
  );
  const slotData = await transport.readResponse(
    REGISTER.ENABLE,
    COMMAND.READ,
    500,
  );
  if (!slotData) {
    throw new Error("No response from device");
  }

  const enabled = slotData[6] === SLOT.CUSTOM;
  const filters = [];
  const readRegs = new Set();

  for (let i = 0; i < AUDIO_LIMITS.FILTER_COUNT; i++) {
    const gfReg = REGISTER.FILTER_BASE + i * 2;
    const qReg = gfReg + 1;

    const filter = {
      freq: AUDIO_LIMITS.DEFAULT_FREQS[i] ?? 1000,
      gain: 0,
      q: AUDIO_LIMITS.Q.DEFAULT,
      type: FILTER_TYPE.PEAK,
      disabled: false,
    };

    await transport.sendReport(DEVICE.REPORT_DSP, buildReadPacket(gfReg));
    const gfData = await transport.readResponse(gfReg, COMMAND.READ, 500);
    if (gfData) {
      const parsed = parseGainFreq(gfData);
      filter.gain = parsed.gain;
      filter.freq = parsed.freq;
      readRegs.add(gfReg);
    }

    await transport.sendReport(DEVICE.REPORT_DSP, buildReadPacket(qReg));
    const qData = await transport.readResponse(qReg, COMMAND.READ, 500);
    if (qData) {
      const parsed = parseQType(qData);
      filter.q = parsed.q;
      filter.type = parsed.type;
      readRegs.add(qReg);
    }

    filters.push(filter);
  }

  let leftVol = 0;
  let rightVol = 0;
  await transport.sendReport(
    DEVICE.REPORT_DSP,
    buildReadPacket(REGISTER.VOLUME),
  );
  const volData = await transport.readResponse(
    REGISTER.VOLUME,
    COMMAND.READ,
    500,
  );
  if (volData) {
    leftVol = decodeVolume(volData[6]);
    rightVol = decodeVolume(volData[7]);
    readRegs.add(REGISTER.VOLUME);
  }

  let micGain = 0;
  await transport.sendReport(
    DEVICE.REPORT_DSP,
    buildReadPacket(REGISTER.MIC_GAIN),
  );
  const micData = await transport.readResponse(
    REGISTER.MIC_GAIN,
    COMMAND.READ,
    500,
  );
  if (micData) {
    micGain = decodeVolume(micData[6]);
    readRegs.add(REGISTER.MIC_GAIN);
  }

  const chipId = await transport.readChipId();

  // What was just read is what the working registers hold; registers that did
  // not answer stay unknown so the next live update rewrites them.
  const known = [
    ...filterPackets(filters),
    [REGISTER.VOLUME, buildVolumePacket(leftVol, rightVol)],
    [REGISTER.MIC_GAIN, buildMicGainPacket(micGain)],
  ];
  for (const [reg, packet] of known) {
    if (readRegs.has(reg)) lastWritten.set(reg, packetKey(packet));
  }

  return {
    enabled,
    filters,
    leftVol,
    rightVol,
    micGain,
    chipId,
  };
}

export function commitDspState(
  filters,
  leftVol,
  rightVol,
  micGain,
  enabled = true,
) {
  return exclusive(() =>
    commitDspStateNow(filters, leftVol, rightVol, micGain, enabled),
  );
}

async function commitDspStateNow(filters, leftVol, rightVol, micGain, enabled) {
  if (!transport.isConnected()) {
    throw new Error("Device not connected");
  }

  await transport.sendReport(
    DEVICE.REPORT_DSP,
    buildEnablePacket(enabled ? SLOT.CUSTOM : SLOT.BYPASS),
  );
  await sleep(100);

  for (let i = 0; i < AUDIO_LIMITS.FILTER_COUNT; i++) {
    const f = filters[i] || {
      freq: AUDIO_LIMITS.DEFAULT_FREQS[i] ?? 1000,
      gain: 0,
      q: AUDIO_LIMITS.Q.DEFAULT,
      type: FILTER_TYPE.PEAK,
      disabled: false,
    };
    const gfReg = REGISTER.FILTER_BASE + i * 2;
    const qReg = gfReg + 1;
    const gain = f.disabled ? 0 : f.gain;

    await transport.sendReport(
      DEVICE.REPORT_DSP,
      buildGainFreqPacket(gfReg, f.freq, gain),
    );
    await transport.sendReport(
      DEVICE.REPORT_DSP,
      buildQTypePacket(qReg, f.q, f.type),
    );
  }

  await transport.sendReport(
    DEVICE.REPORT_DSP,
    buildVolumePacket(leftVol, rightVol),
  );
  await transport.sendReport(DEVICE.REPORT_DSP, buildMicGainPacket(micGain));
  await transport.sendReport(DEVICE.REPORT_DSP, buildCommitPacket());

  forgetLiveState();
  const reconnected = await transport.waitForReconnect();

  return {
    success: true,
    connected: reconnected,
  };
}

export async function setDspBypassSlot(targetSlot) {
  if (!transport.isConnected()) {
    throw new Error("Device not connected");
  }

  await transport.sendReport(DEVICE.REPORT_DSP, buildEnablePacket(targetSlot));
  await transport.sendReport(DEVICE.REPORT_DSP, buildCommitPacket());

  const reconnected = await transport.waitForReconnect();

  return {
    success: true,
    enabled: targetSlot === SLOT.CUSTOM,
    connected: reconnected,
  };
}

export const readAll = readDspState;
export const commitDSP = commitDspState;
export const toggleBypassDSP = setDspBypassSlot;
