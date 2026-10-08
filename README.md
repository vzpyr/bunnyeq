# Bunny EQ

Lightweight web and Android EQ controller for the Tanchjim Bunny DSP

<p align="center">
  <img src="screenshots/screenshot1.png" width="49%">
  <img src="screenshots/screenshot2.png" width="49%">
</p>

## Features

- 5-band parametric EQ (supports Peak, Low Shelf, and High Shelf filters with draggable response curve)
- Global EQ and per-band toggles
- Per-side volume (-60 dB to 0 dB) and microphone gain (-60 dB to +12 dB)
- JSON presets for quick importing/exporting
- Cross-platform support (web app and Android app)

## Web

[vzpyr.github.io/bunnyeq](https://vzpyr.github.io/bunnyeq)

## Android

You can download Bunny EQ for Android from the [Releases](https://github.com/vzpyr/bunnyeq/releases).

## Build

You need Node.js, Android SDK and JDK.

### Android

```bash
cd android
npm install
npm run build
```

The APK will afterwards land in `android/android/app/build/outputs/apk/debug/`.

## Permissions

### Web

You need a chromium-based browser on Desktop. Choose your DSP when prompted. On Linux, you might need udev rules so the browser can interact with the device. Run this command and possibly reconnect the device:

```bash
sudo tee /etc/udev/rules.d/99-bunny.rules <<'EOF'
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="31b2", MODE="0666"
EOF
sudo udevadm control --reload-rules && sudo udevadm trigger --subsystem-match=hidraw
```

### Android

Allow the USB permission prompt when connecting the DSP.

## Register Map

### USB Interface

- VID:PID: `31b2:1112`
- HID interface: 3
- Report IDs: `0x4B` (DSP config), `0x54` (Chip ID query, returns `TURN2CDC`)

### Packet Format (Report 0x4B)

Writes (`0x57`) apply to volatile memory immediately. Commit sends command `0x53` (register `0x00`), saves all registers to flash, and resets USB (~200–500ms). Reads (`0x52`) return an input report echoing the register, command, and payload:

| Byte | Field    | Description                                    |
| :--- | :------- | :--------------------------------------------- |
| 0    | Register | Target register address                        |
| 1–3  | Reserved | `0x00, 0x00, 0x00`                             |
| 4    | Command  | `0x52` (Read), `0x57` (Write), `0x53` (Commit) |
| 5    | Reserved | `0x00`                                         |
| 6–9  | Payload  | Little-endian register data                    |

### Registers

Filter bands must be ordered by ascending frequency (`i = 0..4` for Bands 1–5). Individual bands are bypassed by setting gain to 0:

| Register     | Name                 | Format                  | Description                                                         |
| :----------- | :------------------- | :---------------------- | :------------------------------------------------------------------ |
| `0x24`       | EQ Mode              | `uint8`                 | `0x02` = Bypass, `0x03` = Active PEQ                                |
| `0x26 + 2*i` | Band 1–5 Gain & Freq | `int16_le`, `uint16_le` | Gain (dB * 10, ±12 dB), Frequency (Hz, 20–20,000)                   |
| `0x27 + 2*i` | Band 1–5 Q & Type    | `uint16_le`, `uint8`    | Q (* 1000), Type (`0x00` Peak, `0x03` Low Shelf, `0x04` High Shelf) |
| `0x65`       | Mic Gain             | `int8`                  | Pre-amp gain (dB * 2, -60 to +12 dB)                                |
| `0x66`       | Volume               | `int8`, `int8`          | Left and Right attenuation (dB * 2, -60 to 0 dB)                    |

## License

[MIT](LICENSE)
