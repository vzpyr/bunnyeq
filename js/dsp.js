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

export async function readDspState() {
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
    }

    await transport.sendReport(DEVICE.REPORT_DSP, buildReadPacket(qReg));
    const qData = await transport.readResponse(qReg, COMMAND.READ, 500);
    if (qData) {
      const parsed = parseQType(qData);
      filter.q = parsed.q;
      filter.type = parsed.type;
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
  }

  const chipId = await transport.readChipId();

  return {
    enabled,
    filters,
    leftVol,
    rightVol,
    micGain,
    chipId,
  };
}

export async function commitDspState(filters, leftVol, rightVol, micGain) {
  if (!transport.isConnected()) {
    throw new Error("Device not connected");
  }

  await transport.sendReport(DEVICE.REPORT_DSP, buildEnablePacket(SLOT.CUSTOM));
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
