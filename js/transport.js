import { DEVICE } from "./constants.js";
import { parseChipId } from "./protocol.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class Transport {
  constructor() {
    this.device = null;
    this.pendingInputReports = [];
    this.connectListeners = new Set();
    this.disconnectListeners = new Set();
    this.connectPromise = null;

    if (typeof navigator !== "undefined" && navigator.hid) {
      navigator.hid.addEventListener("connect", (event) => {
        if (
          event.device.vendorId === DEVICE.VENDOR_ID &&
          event.device.productId === DEVICE.PRODUCT_ID
        ) {
          if (this.device && this.device.opened) return;
          this.connectListeners.forEach((listener) => listener(event.device));
        }
      });

      navigator.hid.addEventListener("disconnect", (event) => {
        if (this.device && event.device === this.device) {
          this.device = null;
          this.pendingInputReports = [];
          this.disconnectListeners.forEach((listener) => listener());
        }
      });
    }
  }

  isAndroidBridge() {
    return typeof window !== "undefined" && Boolean(window.AndroidBridge);
  }

  isSupported() {
    return (
      this.isAndroidBridge() ||
      (typeof navigator !== "undefined" && Boolean(navigator.hid))
    );
  }

  isConnected() {
    if (this.isAndroidBridge()) {
      return Boolean(window.AndroidBridge.isConnected());
    }
    return Boolean(this.device && this.device.opened);
  }

  onConnect(callback) {
    this.connectListeners.add(callback);
    return () => this.connectListeners.delete(callback);
  }

  onDisconnect(callback) {
    this.disconnectListeners.add(callback);
    return () => this.disconnectListeners.delete(callback);
  }

  pickDspDevice(devices) {
    if (!devices || devices.length === 0) return null;
    if (devices.length === 1) return devices[0];

    const dsp = devices.find((d) =>
      d.collections?.some(
        (c) =>
          c.inputReports?.some((r) => r.reportId === DEVICE.REPORT_DSP) ||
          c.outputReports?.some((r) => r.reportId === DEVICE.REPORT_DSP) ||
          c.featureReports?.some((r) => r.reportId === DEVICE.REPORT_DSP),
      ),
    );
    return dsp || devices[0];
  }

  async getPairedDevice() {
    if (!navigator.hid) return null;
    const devices = await navigator.hid.getDevices();
    const matching = devices.filter(
      (dev) =>
        dev.vendorId === DEVICE.VENDOR_ID &&
        dev.productId === DEVICE.PRODUCT_ID,
    );
    return this.pickDspDevice(matching);
  }

  async connect(interactive = false) {
    if (this.isAndroidBridge()) {
      return Boolean(window.AndroidBridge.connect());
    }

    if (!navigator.hid) {
      throw new Error("WebHID is not supported in this browser");
    }

    if (this.device && this.device.opened) {
      return true;
    }

    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.connectPromise = (async () => {
      let dev = await this.getPairedDevice();
      if (!dev && interactive) {
        const selected = await navigator.hid.requestDevice({
          filters: [
            { vendorId: DEVICE.VENDOR_ID, productId: DEVICE.PRODUCT_ID },
          ],
        });
        if (selected && selected.length > 0) {
          dev = this.pickDspDevice(selected);
        }
      }

      if (!dev) return false;

      if (!dev.opened) {
        try {
          await dev.open();
        } catch (err) {
          this.device = null;
          throw err;
        }
      }

      this.device = dev;
      this.device.oninputreport = (event) => {
        const { reportId, data } = event;
        const buffer = new Uint8Array(
          data.buffer,
          data.byteOffset,
          data.byteLength,
        );
        this.pendingInputReports.push({ reportId, data: buffer });
        if (this.pendingInputReports.length > 20) {
          this.pendingInputReports.shift();
        }
      };

      return true;
    })();

    try {
      return await this.connectPromise;
    } finally {
      this.connectPromise = null;
    }
  }

  async disconnect() {
    if (this.isAndroidBridge()) {
      if (typeof window.AndroidBridge.disconnect === "function") {
        window.AndroidBridge.disconnect();
      }
      return;
    }

    if (this.device) {
      try {
        if (this.device.opened) {
          await this.device.close();
        }
      } catch (_) {}
      this.device = null;
    }
  }

  async sendReport(reportId, data) {
    if (this.isAndroidBridge()) {
      const packet = new Uint8Array(1 + data.length);
      packet[0] = reportId;
      packet.set(data, 1);
      const ok = window.AndroidBridge.writeReport(
        JSON.stringify(Array.from(packet)),
      );
      if (!ok) throw new Error("Failed to write report to USB device");
      await sleep(30);
      return;
    }

    if (!this.device || !this.device.opened) {
      throw new Error("Device not connected");
    }

    try {
      await this.device.sendReport(reportId, data);
    } catch (_) {
      await this.device.sendFeatureReport(reportId, data);
    }
    await sleep(30);
  }

  async readResponse(reg, cmd, timeoutMs = 500) {
    if (this.isAndroidBridge()) {
      const raw = window.AndroidBridge.readReport(timeoutMs);
      if (!raw) return null;
      let array = [];
      try {
        array = typeof raw === "string" ? JSON.parse(raw) : raw;
      } catch (_) {
        return null;
      }
      const data = new Uint8Array(array);
      const payload = data.length > 10 ? data.subarray(1, 11) : data;
      return payload[0] === reg && payload[4] === cmd ? payload : null;
    }

    if (!this.device || !this.device.opened) {
      throw new Error("Device not connected");
    }

    try {
      const dv = await this.device.receiveFeatureReport(DEVICE.REPORT_DSP);
      if (dv && dv.byteLength >= 10) {
        const offset =
          dv.byteLength > 10 && dv.getUint8(0) === DEVICE.REPORT_DSP ? 1 : 0;
        const res = new Uint8Array(
          dv.buffer,
          dv.byteOffset + offset,
          Math.min(10, dv.byteLength - offset),
        );
        if (res[0] === reg && res[4] === cmd) {
          return res;
        }
      }
    } catch (_) {}

    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const idx = this.pendingInputReports.findIndex(
        (r) =>
          r.reportId === DEVICE.REPORT_DSP &&
          r.data.length >= 5 &&
          r.data[0] === reg &&
          r.data[4] === cmd,
      );
      if (idx !== -1) {
        const [found] = this.pendingInputReports.splice(idx, 1);
        return found.data.subarray(0, 10);
      }
      await sleep(10);
    }

    return null;
  }

  async readChipId() {
    if (
      this.isAndroidBridge() &&
      typeof window.AndroidBridge.getChipId === "function"
    ) {
      const id = window.AndroidBridge.getChipId();
      if (id && id !== "?") return id;
    }

    if (!this.device || !this.device.opened) return "?";

    try {
      const probe = new Uint8Array(10);
      try {
        await this.device.sendReport(DEVICE.REPORT_CHIP_ID, probe);
      } catch (_) {
        await this.device.sendFeatureReport(DEVICE.REPORT_CHIP_ID, probe);
      }

      const start = Date.now();
      while (Date.now() - start < 300) {
        const idx = this.pendingInputReports.findIndex(
          (r) => r.reportId === DEVICE.REPORT_CHIP_ID,
        );
        if (idx !== -1) {
          const [found] = this.pendingInputReports.splice(idx, 1);
          const parsed = parseChipId(found.data);
          if (parsed !== "?") return parsed;
        }
        await sleep(10);
      }

      const dv = await this.device.receiveFeatureReport(DEVICE.REPORT_CHIP_ID);
      if (dv && dv.byteLength > 0) {
        const bytes = new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength);
        const parsed = parseChipId(bytes);
        if (parsed !== "?") return parsed;
      }
    } catch (_) {}

    return "?";
  }

  async waitForReconnect(maxAttempts = 15, intervalMs = 250) {
    this.device = null;
    await sleep(800);
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const ok = await this.connect(false);
        if (ok && this.isConnected()) {
          await sleep(300);
          return true;
        }
      } catch (_) {}
      await sleep(intervalMs);
    }
    return false;
  }
}

export const transport = new Transport();
