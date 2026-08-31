# Agent Guide

## Project purpose

China Drone Deck is a Steam Deck-first ground station for inexpensive V666-family Wi-Fi camera drones. The application provides camera viewing, Steam Input/gamepad controls, selectable RC stick layouts, hardware discovery, and offline-friendly AppImage updates.

## Safety rules

- Treat `V666` as a reseller model name, not a protocol identifier. Multiple incompatible aircraft use this name.
- Keep camera-only/diagnostic mode as the default.
- Never enable a flight protocol solely because the product box says V666.
- Require an exact SSID or packet-capture match before suggesting a control profile.
- Preserve the L1 deadman switch and neutral-on-release behavior.
- Preserve hold-to-takeoff and explicit protocol-confirmation safeguards.
- Any new or changed protocol must be tested with propellers removed before flight.
- Do not claim hardware validation unless the code was tested against the physical aircraft.
- Mode 1 through Mode 4 are stick-channel layouts. Do not describe them as firmware flight modes such as Acro, GPS, or Altitude Hold.

## Repository layout

- `src/main.js`: Electron lifecycle, IPC, updater, and service coordination.
- `src/preload.js`: restricted renderer API exposed through context isolation.
- `src/network.js`: discovery and UDP flight-link lifecycle.
- `src/protocols.js`: control profiles, stick mapping, packet generation, and checksums.
- `src/video.js`: ffmpeg RTSP-to-MJPEG bridge.
- `src/renderer/`: Steam Deck UI and gamepad interaction.
- `test/`: Node test runner coverage for mappings and packet formats.
- `scripts/install-steamdeck.sh`: AppImage installation on SteamOS.
- `.github/workflows/release.yml`: Linux AppImage release build.

## Development workflow

Use Node.js 22 or newer.

```bash
npm install
npm test
npm start
```

Run syntax checks for modified JavaScript files and keep packet-format tests deterministic. For any control-protocol change, add or update a byte-level test before considering the work complete.

Live camera display requires `ffmpeg` on `PATH`. A custom binary can be supplied through `CHINA_DRONE_FFMPEG`.

## Git commits

- Always commit completed, intended changes using a Conventional Commit message. Stage only files related to the task; never include unrelated changes.

## Implementation conventions

- Keep Electron context isolation enabled and Node integration disabled in the renderer.
- Expose only narrowly scoped operations through `src/preload.js`.
- Do not place raw socket access in renderer code.
- Clamp every control channel before packet encoding.
- Stop timers and close sockets during disconnect and application shutdown.
- Unknown SSIDs must resolve to the diagnostic profile.
- Discovery may probe common camera endpoints, but it must not transmit motor commands.
- Keep flight control usable without an internet connection.
- Avoid dependencies that make AppImage distribution substantially larger unless they replace a fragile system requirement.

## Protocol work

Document each protocol profile with:

- Expected SSID pattern.
- Drone IP address and UDP/TCP ports.
- Activation or handshake sequence.
- Control packet size and byte layout.
- Neutral values, checksum, and command meanings.
- Required send frequency and failsafe behavior.
- Camera stream URL and codec.
- Source of evidence, preferably a packet capture from the exact aircraft.

Never infer undocumented command bytes by sending a brute-force sequence to an assembled aircraft.
### Confirmed `FLOW_09B183` WiFi-UAV findings

These findings come from static analysis of the supplied matching Android APK (`com.lcfld.fldpublic`, `wifi-uav-base.apk`) and are not a substitute for props-off hardware verification.

- The native library is `lib/arm64-v8a/libuav_lib.so`; its debug symbols name the stream code `mjpeg_ndk.c`.
- `mjpeg_ndk_set_active_camera_index` stores the selected native camera index. Index `0` is the main/forward path; index `1` selects the flow path (the user confirmed this is the bottom camera on this aircraft).
- The stream-request UDP envelope carries that index at byte offset `0x56` (decimal `86`). The preceding request bytes at offsets `82..85` are `32 4b 14 2d`. Change only byte `86` for camera selection.
- Do **not** encode camera readiness or camera selection in the ACK-record status field. ACK records are their own 16-byte-plus-bitmap structure: 64-bit frame ID, 32-bit status, 32-bit record length, then the received-fragment bitmap.
- Incoming video-fragment header bytes `52` and `53` report main and flow camera availability respectively. They are status information, not the outbound selector.
- Some selected-flow JPEG payloads contain an SOI marker but omit EOI. The bridge may append the missing `FF D9` terminator after complete fragment assembly; it must not use this to mask missing fragments or invent JPEG data.

For future WiFi-UAV camera changes, preserve these byte-level tests in `test/protocols.test.js`, keep control traffic separate from camera requests, and do not probe alternate indices or commands on live hardware without evidence.

## Versioning and releases

Use Conventional Commit messages such as:

```text
feat: add camera switching
fix: neutralize sticks after gamepad disconnect
docs: document V666 hardware identification
```

Before a release:

1. Ensure the working tree contains only intended changes.
2. Run `npm test`.
3. Build the Linux AppImage with `npm run dist:linux` or use the release workflow.
4. Confirm the version, changelog, and Git tag agree.
5. Never test updater installation during an active flight.

## Completion checklist

- Relevant tests pass.
- Runtime behavior fails safely when hardware is missing or disconnected.
- User-facing claims distinguish implemented, provisionally supported, and physically verified behavior.
- Steam Deck instructions remain current.
- `README.md` is updated when setup, controls, supported protocols, or release behavior changes.
