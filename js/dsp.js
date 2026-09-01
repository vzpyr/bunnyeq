import {
  REPORT_ID,
  CMD_READ,
  REG_ENABLE,
  REG_MIC_GAIN,
  REG_VOLUME,
  FILTER_BASE,
  CUSTOM_SLOT,
  DISABLED_SLOT,
  FILTER_COUNT,
  buildReadPacket,
  buildGainFreqPacket,
  buildQTypePacket,
  buildVolumePacket,
  buildMicGainPacket,
  buildEnablePacket,
  buildCommitPacket,
  parseGainFreq,
  parseQType,
  decodeVol,
} from "./protocol.js";
import { transport } from "./transport.js";

export async function readAll() {
  if (!transport.isConnected()) {
    throw new Error("Device not connected");
  }

  await transport.sendReport(REPORT_ID, buildReadPacket(REG_ENABLE));
  const slotData = await transport.readResponse(REG_ENABLE, CMD_READ, 500);
  if (!slotData) {
    throw new Error("No response from device");
  }

  const enabled = slotData[6] === CUSTOM_SLOT;

  const filters = [];
  for (let i = 0; i < FILTER_COUNT; i++) {
    const gfReg = FILTER_BASE + i * 2;
    const qReg = gfReg + 1;

    let filter = {
      freq: 1000,
      gain: 0,
      q: 1.0,
      type: "PK",
      disabled: false,
    };

    await transport.sendReport(REPORT_ID, buildReadPacket(gfReg));
    const gfData = await transport.readResponse(gfReg, CMD_READ, 500);
    if (gfData) {
      const parsed = parseGainFreq(gfData);
      filter.gain = parsed.gain;
      filter.freq = parsed.freq;
    }

    await transport.sendReport(REPORT_ID, buildReadPacket(qReg));
    const qData = await transport.readResponse(qReg, CMD_READ, 500);
    if (qData) {
      const parsed = parseQType(qData);
      filter.q = parsed.q;
      filter.type = parsed.type;
    }

    filters.push(filter);
  }

  let leftVol = 0;
  let rightVol = 0;
  await transport.sendReport(REPORT_ID, buildReadPacket(REG_VOLUME));
  const volData = await transport.readResponse(REG_VOLUME, CMD_READ, 500);
  if (volData) {
    leftVol = decodeVol(volData[6]);
    rightVol = decodeVol(volData[7]);
  }

  let micGain = 0;
  await transport.sendReport(REPORT_ID, buildReadPacket(REG_MIC_GAIN));
  const micData = await transport.readResponse(REG_MIC_GAIN, CMD_READ, 500);
  if (micData) {
    micGain = decodeVol(micData[6]);
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

export async function commitDSP(filters, leftVol, rightVol, micGain) {
  if (!transport.isConnected()) {
    throw new Error("Device not connected");
  }

  await transport.sendReport(REPORT_ID, buildEnablePacket(CUSTOM_SLOT));
  await transport.sleep(100);

  for (let i = 0; i < FILTER_COUNT; i++) {
    const f = filters[i] || {
      freq: 1000,
      gain: 0,
      q: 1.0,
      type: "PK",
      disabled: false,
    };
    const gfReg = FILTER_BASE + i * 2;
    const qReg = gfReg + 1;

    const gain = f.disabled ? 0 : f.gain;
    await transport.sendReport(
      REPORT_ID,
      buildGainFreqPacket(gfReg, f.freq, gain),
    );
    await transport.sendReport(REPORT_ID, buildQTypePacket(qReg, f.q, f.type));
  }

  await transport.sendReport(REPORT_ID, buildVolumePacket(leftVol, rightVol));
  await transport.sendReport(REPORT_ID, buildMicGainPacket(micGain));
  await transport.sendReport(REPORT_ID, buildCommitPacket());

  const reconnected = await transport.waitForReconnect();

  return {
    success: true,
    connected: reconnected,
  };
}

export async function toggleBypassDSP(targetSlot) {
  if (!transport.isConnected()) {
    throw new Error("Device not connected");
  }

  await transport.sendReport(REPORT_ID, buildEnablePacket(targetSlot));
  await transport.sendReport(REPORT_ID, buildCommitPacket());

  const reconnected = await transport.waitForReconnect();

  return {
    success: true,
    enabled: targetSlot === CUSTOM_SLOT,
    connected: reconnected,
  };
}
