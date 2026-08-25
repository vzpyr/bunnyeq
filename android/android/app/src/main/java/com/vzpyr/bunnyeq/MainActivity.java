package com.vzpyr.bunnyeq;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbDeviceConnection;
import android.hardware.usb.UsbEndpoint;
import android.hardware.usb.UsbInterface;
import android.hardware.usb.UsbManager;
import android.os.Build;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import com.getcapacitor.BridgeActivity;
import org.json.JSONArray;

public class MainActivity extends BridgeActivity {
    private static final String ACTION_USB_PERMISSION = "com.vzpyr.bunnyeq.USB_PERMISSION";
    private static final int VID = 0x31B2;
    private static final int PID = 0x1112;

    private UsbManager usbManager;
    private BroadcastReceiver usbReceiver;
    private UsbDeviceConnection usbConnection;
    private UsbInterface usbInterface;
    private UsbEndpoint inEndpoint;
    private UsbEndpoint outEndpoint;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        usbManager = (UsbManager) getSystemService(Context.USB_SERVICE);
        getBridge().getWebView().addJavascriptInterface(new UsbBridge(), "AndroidBridge");
        setupUsbReceiver();
    }

    @Override
    public void onResume() {
        super.onResume();
        checkAndConnectUsb();
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        if (usbReceiver != null) {
            unregisterReceiver(usbReceiver);
        }
        closeDevice();
    }

    private void setupUsbReceiver() {
        usbReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                String action = intent.getAction();
                if (ACTION_USB_PERMISSION.equals(action)) {
                    synchronized (this) {
                        UsbDevice device = null;
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                            device = intent.getParcelableExtra(UsbManager.EXTRA_DEVICE, UsbDevice.class);
                        } else {
                            device = intent.getParcelableExtra(UsbManager.EXTRA_DEVICE);
                        }
                        if (intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false) && device != null) {
                            openDevice(device);
                        }
                    }
                } else if (UsbManager.ACTION_USB_DEVICE_ATTACHED.equals(action)) {
                    checkAndConnectUsb();
                } else if (UsbManager.ACTION_USB_DEVICE_DETACHED.equals(action)) {
                    UsbDevice device = null;
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        device = intent.getParcelableExtra(UsbManager.EXTRA_DEVICE, UsbDevice.class);
                    } else {
                        device = intent.getParcelableExtra(UsbManager.EXTRA_DEVICE);
                    }
                    if (device != null && device.getVendorId() == VID && device.getProductId() == PID) {
                        closeDevice();
                    }
                }
            }
        };

        IntentFilter filter = new IntentFilter();
        filter.addAction(ACTION_USB_PERMISSION);
        filter.addAction(UsbManager.ACTION_USB_DEVICE_ATTACHED);
        filter.addAction(UsbManager.ACTION_USB_DEVICE_DETACHED);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(usbReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(usbReceiver, filter);
        }
    }

    private boolean checkAndConnectUsb() {
        if (usbConnection != null) return true;
        for (UsbDevice device : usbManager.getDeviceList().values()) {
            if (device.getVendorId() == VID && device.getProductId() == PID) {
                if (usbManager.hasPermission(device)) {
                    openDevice(device);
                    return true;
                } else {
                    int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? PendingIntent.FLAG_MUTABLE : 0;
                    PendingIntent permissionIntent = PendingIntent.getBroadcast(
                        this, 0, new Intent(ACTION_USB_PERMISSION), flags
                    );
                    usbManager.requestPermission(device, permissionIntent);
                }
                break;
            }
        }
        return false;
    }

    private void openDevice(UsbDevice device) {
        UsbDeviceConnection conn = usbManager.openDevice(device);
        if (conn == null) return;

        UsbInterface hidIntf = null;
        for (int i = 0; i < device.getInterfaceCount(); i++) {
            UsbInterface intf = device.getInterface(i);
            if (intf.getInterfaceClass() == 3) {
                hidIntf = intf;
                break;
            }
        }
        UsbInterface targetIntf = hidIntf != null ? hidIntf : device.getInterface(0);

        if (conn.claimInterface(targetIntf, true)) {
            usbConnection = conn;
            usbInterface = targetIntf;
            inEndpoint = null;
            outEndpoint = null;
            for (int j = 0; j < targetIntf.getEndpointCount(); j++) {
                UsbEndpoint ep = targetIntf.getEndpoint(j);
                if (ep.getDirection() == 128) {
                    inEndpoint = ep;
                } else if (ep.getDirection() == 0) {
                    outEndpoint = ep;
                }
            }
        } else {
            conn.close();
        }
    }

    private void closeDevice() {
        try {
            if (usbInterface != null && usbConnection != null) {
                usbConnection.releaseInterface(usbInterface);
            }
            if (usbConnection != null) {
                usbConnection.close();
            }
        } catch (Exception ignored) {}
        usbConnection = null;
        usbInterface = null;
        inEndpoint = null;
        outEndpoint = null;
    }

    public class UsbBridge {
        @JavascriptInterface
        public boolean isConnected() {
            return usbConnection != null;
        }

        @JavascriptInterface
        public boolean connect() {
            final boolean[] connected = new boolean[]{false};
            runOnUiThread(() -> connected[0] = checkAndConnectUsb());
            return connected[0] || usbConnection != null;
        }

        @JavascriptInterface
        public void disconnect() {
            runOnUiThread(MainActivity.this::closeDevice);
        }

        @JavascriptInterface
        public boolean writeReport(String json) {
            UsbDeviceConnection conn = usbConnection;
            if (conn == null) return false;
            try {
                JSONArray jsonArray = new JSONArray(json);
                byte[] data = new byte[jsonArray.length()];
                for (int i = 0; i < jsonArray.length(); i++) {
                    data[i] = (byte) jsonArray.getInt(i);
                }

                if (outEndpoint != null) {
                    int res = conn.bulkTransfer(outEndpoint, data, data.length, 100);
                    if (res >= 0) return true;
                }

                int reportId = data[0] & 0xFF;
                int value = (0x02 << 8) | reportId;
                int intfNum = usbInterface != null ? usbInterface.getId() : 3;
                int res = conn.controlTransfer(0x21, 0x09, value, intfNum, data, data.length, 100);
                return res >= 0;
            } catch (Exception e) {
                return false;
            }
        }

        @JavascriptInterface
        public String readReport(int timeoutMs) {
            UsbDeviceConnection conn = usbConnection;
            if (conn == null) return "";
            byte[] buffer = new byte[64];
            if (inEndpoint != null) {
                int res = conn.bulkTransfer(inEndpoint, buffer, buffer.length, timeoutMs);
                if (res > 0) {
                    JSONArray arr = new JSONArray();
                    for (int i = 0; i < res; i++) {
                        arr.put(buffer[i] & 0xFF);
                    }
                    return arr.toString();
                }
            }

            int reportId = 0x4B;
            int value = (0x01 << 8) | reportId;
            int intfNum = usbInterface != null ? usbInterface.getId() : 3;
            int res = conn.controlTransfer(0xA1, 0x01, value, intfNum, buffer, buffer.length, timeoutMs);
            if (res > 0) {
                JSONArray arr = new JSONArray();
                for (int i = 0; i < res; i++) {
                    arr.put(buffer[i] & 0xFF);
                }
                return arr.toString();
            }
            return "";
        }

        @JavascriptInterface
        public String getChipId() {
            UsbDeviceConnection conn = usbConnection;
            if (conn == null) return "?";
            byte[] probe = new byte[]{0x54, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0};
            if (outEndpoint != null) {
                conn.bulkTransfer(outEndpoint, probe, probe.length, 50);
            } else {
                conn.controlTransfer(0x21, 0x09, (0x02 << 8) | 0x54, usbInterface != null ? usbInterface.getId() : 3, probe, probe.length, 50);
            }

            try {
                Thread.sleep(50);
            } catch (InterruptedException ignored) {}

            byte[] buffer = new byte[64];
            int bytesRead = 0;
            if (inEndpoint != null) {
                bytesRead = conn.bulkTransfer(inEndpoint, buffer, buffer.length, 100);
            }
            if (bytesRead <= 0) {
                bytesRead = conn.controlTransfer(0xA1, 0x01, (0x01 << 8) | 0x54, usbInterface != null ? usbInterface.getId() : 3, buffer, buffer.length, 100);
            }

            if (bytesRead > 0) {
                int start = (bytesRead > 2 && buffer[0] == 0x54 && buffer[1] == 0x54) ? 1 : 0;
                int end = start;
                while (end < bytesRead && buffer[end] != 0) {
                    end++;
                }
                if (end > start) {
                    String raw = new String(buffer, start, end - start, java.nio.charset.StandardCharsets.UTF_8).trim();
                    if (!raw.isEmpty()) return raw;
                }
            }
            return "?";
        }
    }
}
