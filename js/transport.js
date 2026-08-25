import {
  VID,
  PID,
  REPORT_ID,
  REPORT_CHIP_ID,
  parseChipId,
} from "./protocol.js";

class Transport {
  constructor() {
    this.device = null;
    this.disconnectHandlers = new Set();
    this.connectHandlers = new Set();
    this.pendingInputReports = [];

    if (typeof navigator !== "undefined" && navigator.hid) {
      navigator.hid.addEventListener("connect", (e) => {
        if (e.device.vendorId === VID && e.device.productId === PID) {
          this.connectHandlers.forEach((cb) => cb(e.device));
        }
      });
      navigator.hid.addEventListener("disconnect", (e) => {
        if (this.device && e.device === this.device) {
          this.device = null;
          this.disconnectHandlers.forEach((cb) => cb());
        }
      });
    }
  }

  isAndroidBridge() {
    return typeof window !== "undefined" && !!window.AndroidBridge;
  }

  isSupported() {
    return (
      this.isAndroidBridge() ||
      (typeof navigator !== "undefined" && !!navigator.hid)
    );
  }

  isConnected() {
    if (this.isAndroidBridge()) {
      return !!window.AndroidBridge.isConnected();
    }
    return !!(this.device && this.device.opened);
  }

  onConnect(cb) {
    this.connectHandlers.add(cb);
  }

  onDisconnect(cb) {
    this.disconnectHandlers.add(cb);
  }

  async getPairedDevice() {
    if (!navigator.hid) return null;
    const devices = await navigator.hid.getDevices();
    return (
      devices.find((d) => d.vendorId === VID && d.productId === PID) || null
    );
  }

  async connect(interactive = false) {
    if (this.isAndroidBridge()) {
      const ok = window.AndroidBridge.connect();
      return !!ok;
    }

    if (!navigator.hid) {
      throw new Error("Please use a Chromium-based browser");
    }

    let dev = await this.getPairedDevice();
    if (!dev && interactive) {
      const selected = await navigator.hid.requestDevice({
        filters: [{ vendorId: VID, productId: PID }],
      });
      if (selected && selected.length > 0) {
        dev = selected[0];
      }
    }

    if (!dev) return false;

    if (!dev.opened) {
      await dev.open();
    }

    this.device = dev;
    this.device.oninputreport = (event) => {
      const { reportId, data } = event;
      const buf = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      this.pendingInputReports.push({ reportId, data: buf, time: Date.now() });
      if (this.pendingInputReports.length > 20) {
        this.pendingInputReports.shift();
      }
    };

    return true;
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
      const json = JSON.stringify(Array.from(packet));
      const res = window.AndroidBridge.writeReport(json);
      if (!res) throw new Error("Failed to write to device");
      await this.sleep(30);
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
    await this.sleep(30);
  }

  async readResponse(reg, cmd, timeoutMs = 500) {
    if (this.isAndroidBridge()) {
      const raw = window.AndroidBridge.readReport(timeoutMs);
      if (!raw) return null;
      let arr;
      if (typeof raw === "string") {
        try {
          arr = JSON.parse(raw);
        } catch (_) {
          return null;
        }
      } else {
        arr = raw;
      }
      const data = new Uint8Array(arr);
      const payload = data.length > 10 ? data.subarray(1, 11) : data;
      if (payload[0] === reg && payload[4] === cmd) {
        return payload;
      }
      return null;
    }

    if (!this.device || !this.device.opened) {
      throw new Error("Device not connected");
    }

    const start = Date.now();
    try {
      const dv = await this.device.receiveFeatureReport(REPORT_ID);
      if (dv && dv.byteLength >= 10) {
        const offset =
          dv.byteLength > 10 && dv.getUint8(0) === REPORT_ID ? 1 : 0;
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

    while (Date.now() - start < timeoutMs) {
      const idx = this.pendingInputReports.findIndex(
        (r) =>
          r.reportId === REPORT_ID &&
          r.data.length >= 5 &&
          r.data[0] === reg &&
          r.data[4] === cmd,
      );
      if (idx !== -1) {
        const [found] = this.pendingInputReports.splice(idx, 1);
        return found.data.subarray(0, 10);
      }
      await this.sleep(10);
    }

    return null;
  }

  async readChipId() {
    if (this.isAndroidBridge()) {
      if (typeof window.AndroidBridge.getChipId === "function") {
        const id = window.AndroidBridge.getChipId();
        if (id && id !== "?") return id;
      }
    }

    if (!this.device || !this.device.opened) return "?";

    try {
      const probe = new Uint8Array(10);
      try {
        await this.device.sendReport(REPORT_CHIP_ID, probe);
      } catch (_) {
        await this.device.sendFeatureReport(REPORT_CHIP_ID, probe);
      }

      const start = Date.now();
      while (Date.now() - start < 300) {
        const idx = this.pendingInputReports.findIndex(
          (r) => r.reportId === REPORT_CHIP_ID,
        );
        if (idx !== -1) {
          const [found] = this.pendingInputReports.splice(idx, 1);
          const parsed = parseChipId(found.data);
          if (parsed !== "?") return parsed;
        }
        await this.sleep(10);
      }

      const dv = await this.device.receiveFeatureReport(REPORT_CHIP_ID);
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
    await this.sleep(800);
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const ok = await this.connect(false);
        if (ok && this.isConnected()) {
          await this.sleep(300);
          return true;
        }
      } catch (_) {}
      await this.sleep(intervalMs);
    }
    return false;
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const transport = new Transport();
