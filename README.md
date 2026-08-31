# China Drone Deck

A Steam Deck-first ground station for the inexpensive V666 family of Wi-Fi camera drones. It provides an in-app low-latency camera view, native Deck/gamepad input, selectable Mode 1/2/3/4 stick layouts, protocol discovery, and AppImage updates that can be staged before connecting to the drone's offline Wi-Fi.

> **Important:** V666 is a reseller model name used for multiple, electrically unrelated aircraft. Do not enable control based on the name printed on the box. Match the Wi-Fi SSID and protocol first, and perform the first control test with all propellers removed.

## Current status

- Steam Deck UI and standard gamepad input: implemented
- Flight Mode 1, 2, 3, and 4 mappings: implemented
- Hold-L1 deadman control and neutral-on-release: implemented
- `WIFI_8K-*` / E88-E99 UDP control profile: implemented, requires hardware verification
- `FLOW-UFO-*` / KY UFO UDP control profile: implemented, requires hardware verification
- `FLOW_09B183` / WiFi UAV (FLD) UDP control profile: implemented from the matching `com.lcfld.fldpublic` app and independent packet traces; requires propellers-off verification
- RTSP camera probing and in-app MJPEG bridge: implemented (requires `ffmpeg` on `PATH`)
- Conservative camera-only mode: implemented and selected by default
- GitHub release/AppImage self-updates: implemented
- Tested against a physical Lenovo-branded V666: **not yet**

The last line matters. The app is ready for a props-off hardware identification session, not an unobserved first flight.

## First hardware identification

1. Remove every propeller. Leave the bundled transmitter off.
2. Power the drone and connect the Steam Deck to its Wi-Fi in Desktop Mode.
3. Record the exact Wi-Fi name. Common matches are `WIFI_8K_*`, `FLOW-UFO-*`, the exact `FLOW_09B183`, or something entirely different.
4. On SteamOS, China Drone Deck scans for supported drone Wi-Fi automatically on launch. Press **Join selected** to switch to the detected network; **Rescan Wi-Fi** is available if the drone was powered on later. You can also enter the name manually. For the exact `FLOW_09B183`, the app selects its native camera option and `192.168.169.1` automatically.
5. Select **Discover drone**. Start with **Camera only / diagnostic** and try the proposed camera URLs; for `FLOW_09B183`, choose **WiFi UAV native UDP** instead of an RTSP URL.
6. If the SSID matches a supported profile, select it and check the explicit verification box.
7. Enable the flight link with the props still removed. Hold L1 and move each stick slightly, one axis at a time. Confirm the expected motor response and neutral-on-release.
8. Verify takeoff/land, calibration, headless, and emergency commands on the bench before reinstalling propellers.

If neither SSID matches, do not try the closest-sounding profile. Capture the official Android app traffic instead:

```bash
# On a rooted Android device running the vendor app
su -c 'tcpdump -i any -s 0 -w /sdcard/v666.pcap'
```

Exercise one control at a time, stop the capture, and copy `v666.pcap` into this repository. The SSID, a photo of the QR-code/manual page naming the phone app, and that capture are sufficient to add the exact profile safely.

## Development

Requirements: Node.js 22+, npm, and `ffmpeg` for live camera display.

```bash
npm install
npm test
npm start
```

Set `CHINA_DRONE_FFMPEG=/absolute/path/to/ffmpeg` if it is not on `PATH`.

## Build and install on Steam Deck

Build locally on Linux or download the AppImage produced by the release workflow:

```bash
npm ci
npm run dist:linux
chmod +x scripts/install-steamdeck.sh
./scripts/install-steamdeck.sh dist/China-Drone-Deck-0.1.0-x86_64.AppImage
```

Then, in Steam Desktop Mode, choose **Games → Add a Non-Steam Game**, select China Drone Deck, and return to Gaming Mode. The standard Steam Input gamepad layout is expected.

## Updating without internet on the drone Wi-Fi

The intended flow is:

1. When the app opens on normal internet Wi-Fi, it automatically checks and stages an available update. Use **Update Bay → Check & stage** to check again manually.
2. The AppImage update downloads into Electron's update cache.
3. Connect to the drone Wi-Fi. The staged update remains available without internet. After the updated app launches successfully, it automatically removes its staged download from `~/.cache/china-drone-deck-updater`.
4. Choose **Restart & install** at a safe time, never during a flight.

Tag a release such as `v0.1.2`; the included workflow builds the AppImage, publishes it to the GitHub Release, and uploads the `latest-linux.yml` metadata used by the updater. Until the first release is published, download an AppImage on any internet connection and use `scripts/install-steamdeck.sh` to replace the installed copy.

An even smoother option is a cheap USB Wi-Fi adapter: keep the Deck's internal adapter connected to the drone and the USB adapter connected to the internet. The app does not require this, but it makes release checks and documentation access possible while connected to the aircraft.

## Controls

| Control | Action |
|---|---|
| L1 (hold) | Deadman switch; permits stick values to be sent |
| Left/right sticks | Channels selected by Mode 1/2/3/4 |
| Release L1 | Immediately command neutral sticks |
| A (hold) / B / X / Y / R1 | Take off / land / headless / calibrate / emergency stop |
| D-pad / A | Move the visible UI focus / activate the focused control (while flight link is disconnected) |
| D-pad left/right on a dropdown or slider | Change the selected option or value |
| Menu / View | Start selected camera / open the flight-link safety confirmation |
| Touchscreen buttons | Hold-to-takeoff, land, calibrate, headless, emergency stop |

Mode layouts follow conventional RC definitions:

| Mode | Left vertical | Left horizontal | Right vertical | Right horizontal |
|---|---|---|---|---|
| 1 | Pitch | Yaw | Throttle | Roll |
| 2 | Throttle | Yaw | Pitch | Roll |
| 3 | Pitch | Roll | Throttle | Yaw |
| 4 | Throttle | Roll | Pitch | Yaw |

## Camera notes

The bridge tries common toy-drone RTSP endpoints, including `:7070/H264VideoSMS` and `:7070/webcam`, then uses `ffmpeg` to produce an in-app MJPEG feed. This is deliberately separate from flight control: camera viewing can work even when the aircraft protocol is still unknown.

For the exact `FLOW_09B183` WiFi-UAV/FLD profile, choose **WiFi UAV native UDP**. The app sends the native stream request to `192.168.169.1` on UDP ports `8800` and `8801`, reconstructs its JPEG fragments, and corrects this camera's vertical orientation in the display; it does not use RTSP or `ffmpeg`.

Wi-Fi FPV on this class of drone often has hundreds of milliseconds of latency. Keep the aircraft within visual line of sight and do not use the camera as the sole reference for close-proximity flying.

## Sources used to choose provisional profiles

- The V666 manual listing describes 2.4 GHz Wi-Fi FPV, phone control, trajectory flight, multi-speed, and headless mode: [DiotGood V666 manual](https://manuals.plus/ae/1005008994617054).
- The Lenovo/AliExpress V666 listing family advertises app control and a Wi-Fi camera but does not identify a stable protocol: [Lenovo V666 listing archive](https://ms.pricearchive.org/aliexpress.com/item/1005012548211000).
- The `WIFI_8K` packet and mode-switch behavior were independently documented for the E88/E99 family: [maritaca-e88-controller](https://github.com/popolony2k/maritaca-e88-controller).
- The `FLOW-UFO` packet, port, command values, and RTSP endpoint were captured from the KY UFO app: [pyDroneWire](https://github.com/hakimjanov/pyDroneWire).
- HFun-family cameras have been observed at `rtsp://192.168.100.1:7070/H264VideoSMS`: [HFun camera reverse engineering notes](https://www.reddit.com/r/drones/comments/13e5c1s/hacking_a_dronex_pro_air_camera/).
- The `FLOW_09B183` profile uses the WiFi UAV FLD-compatible extended packet: `192.168.169.1:8800`, 124-byte UDP envelope, and inner `66 14` control payload. Its matching Android package is `com.lcfld.fldpublic`; the packet envelope is independently documented in [TurboDrone's WiFi UAV adapter](https://github.com/marshallrichards/turbodrone/blob/master/backend/protocols/wifi_uav_rc_protocol_adapter.py).

## Safety and scope

This app does not add Acro, GPS, altitude-hold, or autonomous modes to firmware that lacks them. Mode 1–4 only rearrange which physical stick controls throttle, yaw, pitch, and roll. Features such as headless mode are available only if the selected protocol and flight controller support them. Cheap V666 listings frequently overstate camera resolution, range, obstacle avoidance, and return-to-home behavior; treat the aircraft itself as the authority.
