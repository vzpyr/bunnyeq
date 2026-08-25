export const VID = 0x31b2;
export const PID = 0x1112;

export const REPORT_ID = 0x4b;
export const REPORT_CHIP_ID = 0x54;

export const CMD_READ = 0x52;
export const CMD_WRITE = 0x57;
export const CMD_COMMIT = 0x53;

export const REG_ENABLE = 0x24;
export const REG_MIC_GAIN = 0x65;
export const REG_VOLUME = 0x66;
export const FILTER_BASE = 0x26;

export const DISABLED_SLOT = 0x02;
export const CUSTOM_SLOT = 0x03;
export const FILTER_COUNT = 5;

export function buildReadPacket(reg) {
  return new Uint8Array([reg, 0, 0, 0, CMD_READ, 0, 0, 0, 0, 0]);
}

export function buildGainFreqPacket(reg, freq, gain) {
  const freqInt = Math.round(Math.max(20, Math.min(20000, freq)));
  let gainScaled = Math.round(Math.max(-12, Math.min(12, gain)) * 10);
  if (gainScaled < 0) {
    gainScaled += 0x10000;
  }
  return new Uint8Array([
    reg,
    0,
    0,
    0,
    CMD_WRITE,
    0,
    gainScaled & 0xff,
    (gainScaled >> 8) & 0xff,
    freqInt & 0xff,
    (freqInt >> 8) & 0xff,
  ]);
}

export function buildQTypePacket(reg, q, type) {
  const qInt = Math.round(Math.max(0.1, Math.min(10, q)) * 1000);
  let typeByte = 0;
  if (type === "LSQ") typeByte = 3;
  if (type === "HSQ") typeByte = 4;
  return new Uint8Array([
    reg,
    0,
    0,
    0,
    CMD_WRITE,
    0,
    qInt & 0xff,
    (qInt >> 8) & 0xff,
    typeByte,
    0,
  ]);
}

export function buildVolumePacket(leftVol, rightVol) {
  return new Uint8Array([
    REG_VOLUME,
    0,
    0,
    0,
    CMD_WRITE,
    0,
    encodeVol(leftVol),
    encodeVol(rightVol),
    0,
    0,
  ]);
}

export function buildMicGainPacket(micGain) {
  return new Uint8Array([
    REG_MIC_GAIN,
    0,
    0,
    0,
    CMD_WRITE,
    0,
    encodeVol(micGain),
    0,
    0,
    0,
  ]);
}

export function buildEnablePacket(slot) {
  return new Uint8Array([REG_ENABLE, 0, 0, 0, CMD_WRITE, 0, slot, 0, 0, 0]);
}

export function buildCommitPacket() {
  return new Uint8Array([0, 0, 0, 0, CMD_COMMIT, 0, 0, 0, 0, 0]);
}

export function encodeVol(db) {
  const raw = Math.round(db * 2);
  return raw < 0 ? (raw + 256) & 0xff : raw & 0xff;
}

export function decodeVol(byte) {
  const signed = byte > 127 ? byte - 256 : byte;
  return signed / 2.0;
}

export function parseGainFreq(bytes) {
  const gainRaw = bytes[6] | (bytes[7] << 8);
  const gain = gainRaw > 0x7fff ? (gainRaw - 0x10000) / 10.0 : gainRaw / 10.0;
  const freq = bytes[8] | (bytes[9] << 8);
  return { gain, freq, q: 1.0, type: "PK" };
}

export function parseQType(bytes) {
  const qRaw = bytes[6] | (bytes[7] << 8);
  const q = qRaw / 1000.0;
  let type = "PK";
  if (bytes[8] === 3) type = "LSQ";
  if (bytes[8] === 4) type = "HSQ";
  return { q, type };
}

export function parseChipId(bytes) {
  if (!bytes || bytes.length === 0) return "?";
  let start = 0;
  if (bytes.length > 2 && bytes[0] === REPORT_CHIP_ID && bytes[1] === 0x54) {
    start = 1;
  }
  let end = start;
  while (end < bytes.length && bytes[end] !== 0) {
    end++;
  }
  if (end > start) {
    const sub = bytes.subarray(start, end);
    const str = new TextDecoder("utf-8").decode(sub).trim();
    if (str.length > 0) return str;
  }
  return "?";
}
