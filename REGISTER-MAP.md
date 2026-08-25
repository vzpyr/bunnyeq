# KTMicro Bunny DSP USB HID Register Map

Technical register specification reverse-engineered from hardware probing (firmware v1.01) and Tanchjim APK analysis.

## 1. Device Identification & USB Topology

### USB Identifiers

| Property             | Value                             |
| :------------------- | :-------------------------------- |
| **VID:PID**          | `31b2:1112` (KTMicro)             |
| **Product String**   | `TANCHJIM BUNNY DSP`              |
| **Chip ID**          | `TURN2CDC` (Report `0x54`)        |
| **Firmware Version** | v1.01 (`bcdDevice=0101`)          |
| **USB Class**        | Composite (Audio Class 1.0 + HID) |

### USB Interfaces

| Interface       | Alt Setting | Class Description                     | Purpose                     |
| :-------------- | :---------- | :------------------------------------ | :-------------------------- |
| **Interface 0** | `alt=0`     | Audio Control (Class 1, Subclass 1)   | Volume and mute control     |
| **Interface 1** | `alt=0`     | Audio Streaming (Class 1, Subclass 2) | Streaming (idle)            |
| **Interface 1** | `alt=2`     | Audio Streaming (Class 1, Subclass 2) | Streaming (active)          |
| **Interface 3** | `alt=0`     | HID (Class 3, Subclass 0)             | DSP parameter configuration |

## 2. HID Reports

| Report ID | Type           | Direction | Payload Size | Purpose                                      |
| :-------- | :------------- | :-------- | :----------- | :------------------------------------------- |
| `0x01`    | Consumer       | IN        | 1 byte       | Media keys (Play/Pause, Volume +/-)          |
| `0x4B`    | Vendor Feature | IN / OUT  | 10 bytes     | DSP configuration (EQ, DAC volume, mic gain) |
| `0x54`    | Vendor Feature | IN        | 10 bytes     | Chip ID (`TURN2CDC`, read-only)              |

## 3. Packet Protocol (Report 0x4B)

All read and write operations use an 11-byte HID buffer (1-byte Report ID prefix + 10-byte payload):

| Byte Offset   | Field            | Description                                                                                           |
| :------------ | :--------------- | :---------------------------------------------------------------------------------------------------- |
| **Byte 0**    | Register Address | Target register address                                                                               |
| **Bytes 1-3** | Reserved         | `0x00, 0x00, 0x00`                                                                                    |
| **Byte 4**    | Command          | `0x52` ('R') Read<br>`0x57` ('W') Write<br>`0x53` ('S') Commit to Flash<br>`0x43` ('C') Clear / Reset |
| **Byte 5**    | Reserved         | `0x00`                                                                                                |
| **Bytes 6-9** | Payload          | Little-endian payload (register-dependent)                                                            |

### Protocol Notes

- **Reads (`0x52`) & Commit (`0x53`)** return input report responses
- **Writes (`0x57`)** are fire-and-forget; changes take effect in volatile memory until committed
- **Commit (`0x53`)** writes all registers to non-volatile flash and resets the USB HID interface (~200-500ms)

## 4. Register Reference

### 4.1 EQ Slot & Bypass (0x24)

| Register | Byte 6 Value | Description                 |
| :------- | :----------- | :-------------------------- |
| `0x24`   | `0x02`       | EQ Bypass (flat / disabled) |
| `0x24`   | `0x03`       | Custom 5-band PEQ active    |

### 4.2 5-Band Parametric EQ (0x26 - 0x2F)

Each filter band occupies two consecutive registers:

1. Gain + Frequency
2. Q Factor + Filter Type

| Band       | Gain + Freq Register | Q + Type Register |
| :--------- | :------------------- | :---------------- |
| **Band 1** | `0x26`               | `0x27`            |
| **Band 2** | `0x28`               | `0x29`            |
| **Band 3** | `0x2A`               | `0x2B`            |
| **Band 4** | `0x2C`               | `0x2D`            |
| **Band 5** | `0x2E`               | `0x2F`            |

#### Gain + Frequency Format (0x26, 0x28, 0x2A, 0x2C, 0x2E)

| Payload Bytes | Field     | Format               | Encoding                                               |
| :------------ | :-------- | :------------------- | :----------------------------------------------------- |
| **Bytes 6-7** | Gain      | Signed `int16_le`    | `dB * 10` (e.g. `120` = `+12.0 dB`, `-15` = `-1.5 dB`) |
| **Bytes 8-9** | Frequency | Unsigned `uint16_le` | `Hz` (20 Hz to 20,000 Hz)                              |

#### Q Factor + Filter Type Format (0x27, 0x29, 0x2B, 0x2D, 0x2F)

| Payload Bytes | Field       | Format               | Encoding                                                                          |
| :------------ | :---------- | :------------------- | :-------------------------------------------------------------------------------- |
| **Bytes 6-7** | Q Factor    | Unsigned `uint16_le` | `Q * 1000` (e.g. `300` = `0.3`, `1000` = `1.0`)                                   |
| **Byte 8**    | Filter Type | `uint8`              | `0x00` = Peak (`PK`)<br>`0x03` = Low Shelf (`LSQ`)<br>`0x04` = High Shelf (`HSQ`) |
| **Byte 9**    | Reserved    | `uint8`              | `0x00`                                                                            |

### 4.3 Microphone ADC Gain (0x65)

Controls hardware ADC pre-amplifier gain.

| Property     | Value                                      |
| :----------- | :----------------------------------------- |
| **Register** | `0x65`                                     |
| **Range**    | -60 dB to +12 dB                           |
| **Encoding** | `dB * 2` stored as signed `int8` in Byte 6 |

| dB Gain    | Encoded Byte |
| :--------- | :----------- |
| **+12 dB** | `0x18` (24)  |
| **0 dB**   | `0x00` (0)   |
| **-1 dB**  | `0xFE` (254) |
| **-60 dB** | `0x88` (136) |

### 4.4 Digital DAC Volume (0x66)

Independent digital output attenuation for Left and Right playback channels.

| Property     | Value                                                                               |
| :----------- | :---------------------------------------------------------------------------------- |
| **Register** | `0x66`                                                                              |
| **Range**    | -60 dB to 0 dB per channel                                                          |
| **Encoding** | Two `int8` values (`dB * 2`): **Byte 6** = Left Channel, **Byte 7** = Right Channel |

_Note: Both channels must be sent together in a single write._

### 4.5 Flash Commit (0x53)

```
Packet: [0x4B, 0x00, 0x00, 0x00, 0x00, 0x53, 0x00, 0x00, 0x00, 0x00, 0x00]
```

- Persists volatile DSP register configuration to on-board flash
- Survives power cycles across different host devices
- Triggers USB reconnection / re-enumeration

## 5. Device Info Registers (Read-Only)

| Register          | Decoded Value        | Description                        |
| :---------------- | :------------------- | :--------------------------------- |
| `0x01`            | `01 00 00 00`        | Major firmware version (1)         |
| `0x04` - `0x05`   | `1.0.1`              | Firmware version string            |
| `0x08` - `0x0A`   | `Sep 4 2024`         | Build date                         |
| `0x40` - `0x41`   | `KTMicro`            | Vendor name                        |
| `0x48` - `0x4C`   | `TANCHJIM BUNNY DSP` | Product string                     |
| `0x5B`            | `b2 31 12 11`        | VID (`0x31B2`) & PID (`0x1112`) LE |
| **Report `0x54`** | `TURN2CDC`           | Hardware Chip identifier           |

## 6. Implementation Notes

- **USB Reconnection:** Flash commit (`0x53`) triggers a hardware USB reset. Host software must handle device disconnection and re-open the HID device.
- **Band Order:** Filter bands must be committed in ascending frequency order.
