import {
  COMMAND,
  REGISTER,
  AUDIO_LIMITS,
  FILTER_TYPE,
  FILTER_TYPE_TO_CODE,
  CODE_TO_FILTER_TYPE,
  DEVICE,
} from "./constants.js";

const clamp = (val, min, max) => Math.max(min, Math.min(max, val));

export function buildReadPacket(registerAddress) {
  return new Uint8Array([
    registerAddress,
    0,
    0,
    0,
    COMMAND.READ,
    0,
    0,
    0,
    0,
    0,
  ]);
}

export function buildGainFreqPacket(registerAddress, freqHz, gainDb) {
  const freqInt = Math.round(
    clamp(freqHz, AUDIO_LIMITS.FREQ.MIN, AUDIO_LIMITS.FREQ.MAX),
  );
  let gainScaled = Math.round(
    clamp(gainDb, AUDIO_LIMITS.GAIN.MIN, AUDIO_LIMITS.GAIN.MAX) * 10,
  );
  if (gainScaled < 0) {
    gainScaled += 0x10000;
  }

  return new Uint8Array([
    registerAddress,
    0,
    0,
    0,
    COMMAND.WRITE,
    0,
    gainScaled & 0xff,
    (gainScaled >> 8) & 0xff,
    freqInt & 0xff,
    (freqInt >> 8) & 0xff,
  ]);
}

export function buildQTypePacket(registerAddress, qFactor, filterType) {
  const qInt = Math.round(
    clamp(qFactor, AUDIO_LIMITS.Q.MIN, AUDIO_LIMITS.Q.MAX) * 1000,
  );
  const typeByte = FILTER_TYPE_TO_CODE[filterType] ?? 0;

  return new Uint8Array([
    registerAddress,
    0,
    0,
    0,
    COMMAND.WRITE,
    0,
    qInt & 0xff,
    (qInt >> 8) & 0xff,
    typeByte,
    0,
  ]);
}

export function buildVolumePacket(leftDb, rightDb) {
  return new Uint8Array([
    REGISTER.VOLUME,
    0,
    0,
    0,
    COMMAND.WRITE,
    0,
    encodeVolume(leftDb),
    encodeVolume(rightDb),
    0,
    0,
  ]);
}

export function buildMicGainPacket(micGainDb) {
  return new Uint8Array([
    REGISTER.MIC_GAIN,
    0,
    0,
    0,
    COMMAND.WRITE,
    0,
    encodeVolume(micGainDb),
    0,
    0,
    0,
  ]);
}

export function buildEnablePacket(slotId) {
  return new Uint8Array([
    REGISTER.ENABLE,
    0,
    0,
    0,
    COMMAND.WRITE,
    0,
    slotId,
    0,
    0,
    0,
  ]);
}

export function buildCommitPacket() {
  return new Uint8Array([0, 0, 0, 0, COMMAND.COMMIT, 0, 0, 0, 0, 0]);
}

export function encodeVolume(db) {
  const raw = Math.round(db * 2);
  return raw < 0 ? (raw + 256) & 0xff : raw & 0xff;
}

export function decodeVolume(byte) {
  const signed = byte > 127 ? byte - 256 : byte;
  return signed / 2.0;
}

export function parseGainFreq(bytes) {
  const gainRaw = bytes[6] | (bytes[7] << 8);
  const gain = gainRaw > 0x7fff ? (gainRaw - 0x10000) / 10.0 : gainRaw / 10.0;
  const freq = bytes[8] | (bytes[9] << 8);
  return { gain, freq };
}

export function parseQType(bytes) {
  const qRaw = bytes[6] | (bytes[7] << 8);
  const q = qRaw / 1000.0;
  const type = CODE_TO_FILTER_TYPE[bytes[8]] || FILTER_TYPE.PEAK;
  return { q, type };
}

export function parseChipId(bytes) {
  if (!bytes || bytes.length === 0) return "?";
  let start = 0;
  if (
    bytes.length > 2 &&
    bytes[0] === DEVICE.REPORT_CHIP_ID &&
    bytes[1] === 0x54
  ) {
    start = 1;
  }
  let end = start;
  while (end < bytes.length && bytes[end] !== 0) {
    end++;
  }
  if (end > start) {
    const slice = bytes.subarray(start, end);
    const text = new TextDecoder("utf-8").decode(slice).trim();
    if (text.length > 0) return text;
  }
  return "?";
}
