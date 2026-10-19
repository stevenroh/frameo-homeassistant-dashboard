# Tablet setup: agent instructions

You turn an ordinary Android tablet into the Home HQ wall dashboard that this repository runs on a Denver Frameo
frame. You have this repository checked out, ADB to the tablet, and the owner at hand to answer questions. Read
`README.md` first: it covers the page, the config, the build and the over-the-air updates. This file covers what a
tablet changes, and the order to do it in.

Work through the steps in order. Each ends on a **done when** line; finish it before starting the next step.

## 1. Survey the tablet

```sh
adb devices -l
adb shell 'getprop ro.product.model; getprop ro.build.version.release; wm size; wm density;
  head -3 /proc/meminfo; df -h /data | tail -1; which su; date; settings get global auto_time;
  dumpsys package com.google.android.webview | grep versionName | head -1'
```

- No device listed while the tablet is plugged in: USB debugging is off. The owner enables it (tap Build number 7
  times, then Developer options, USB debugging) and accepts the "Allow USB debugging?" prompt with Always allow.
- In WSL, `adb` is usually the Windows `adb.exe` under `C:\Users\<user>\AppData\Local\Android\Sdk\platform-tools\`.
  Its output ends lines with `\r`: strip it (`tr -d '\r'`) before comparing strings such as `Success`.
- A clock that is off by more than a day breaks TLS: Home Assistant over `wss://`, Play services and sign-ins fail and
  retry in the background. Fix the date before anything else.

**Done when** the owner has seen a table of model, Android version, screen size and density, RAM, free storage, root
(yes/no), WebView version and the clock.

## 2. Agree the tablet's role

Ask the owner one question: is the tablet a **dedicated** wall dashboard, or **shared** (also used for YouTube,
Netflix, browsing)? Dedicated means strip hard and make the kiosk the Home app. Shared means strip only what the owner
names, and keep the kiosk as an ordinary app.

**Done when** the owner has answered.

## 3. Debloat

Storage first: a nearly full `/data` is the biggest cause of a slow tablet. Below roughly 10% free, Android stops
optimising apps and every write crawls. Removing system apps frees RAM, not disk.

1. Rank apps by storage: `adb shell dumpsys diskstats` lists `Package Names`, `App Sizes`, `App Data Sizes` and
   `Cache Sizes` as parallel JSON arrays. Show the owner the top ten, then uninstall or `pm clear` only the ones they
   choose. `pm clear` logs the app out and deletes its downloads; say so.
2. Remove system bloat for user 0, which is reversible:
   `adb shell pm uninstall -k --user 0 <pkg>`. Append every package that returns `Success` to `restore-apps.sh` as
   `adb shell cmd package install-existing <pkg>`, so each one can be restored.
3. Tune:
   ```sh
   adb shell 'pm trim-caches 999G
     settings put global window_animation_scale 0; settings put global transition_animation_scale 0
     settings put global animator_duration_scale 0
     settings put global wifi_scan_always_enabled 0; settings put global ble_scan_always_enabled 0
     sm fstrim'
   adb shell cmd package bg-dexopt-job   # recompiles apps, several minutes; only with storage free
   adb reboot
   ```

What to remove, by category (show the owner the list before step 2):

- Always safe: retail demo, OEM tips, "what's new", telemetry, user-experience and analytics apps, factory test
  apps (touch panel, `midtest`, `rawdata`), Easter egg, FM radio, Feedback, print recommendation, work-profile setup.
- Owner's call: Google app/Assistant (the biggest RAM user, also powers voice typing), Gmail, Calendar, Photos,
  Drive, Maps, Duo/Meet, Play Movies, YouTube Music, Microsoft apps, OEM account and assistant apps.
- Keep: Google Play services (`gms`, `gsf`), Play Store, **Android System WebView** (the dashboard runs in it),
  keyboard, launcher, SystemUI, Settings, `permissioncontroller`, `packageinstaller`, setup wizard, every
  `com.android.providers.*`, OEM update app, kids-mode and Digital Wellbeing apps when children use the tablet, and
  any package you cannot identify.

Worked example, Lenovo Tab M10 HD (TB-X505F, Android 10): `com.motorola.demo`, `com.tblenovo.lenovotips`,
`com.tblenovo.whatsnewclient`, `com.lenovo.ue.device`, `com.lenovo.dsa`, `com.lenovo.ocpl`, `com.lenovo.lsf`,
`com.lenovo.lsf.device`, `com.lenovo.screenassistant`, `com.lenovo.screencapture`, `com.tblenovo.smartiot`,
`com.tblenovo.wallpaper`, `com.qualcomm.qti.qms.service.telemetry`, `com.longcheertel.midtest`,
`com.focaltech.ft_terminal_test`, `com.goodix.rawdata`, `com.caf.fmradio`. Storage went from 93% to 35% full,
free RAM after boot from about 740 MB to 1.07 GB.

**Done when** `/data` has at least 20% free, every removal is in `restore-apps.sh`, the tablet has rebooted, and the
owner has the before/after numbers (free storage, `MemAvailable`).

## 4. Configure

Copy `secrets/config.example.json` to `secrets/config.json` and fill it in with the owner (README, Configure). The
token belongs to a **non-admin** Home Assistant user: anyone with ADB can read it out of the APK. Tabs whose entities
are missing are hidden, so leave out sections the owner does not use (EV, music, recipes) rather than inventing ids.

**Done when** `node tools/render-config.mjs` writes `build/assets/config.js` and every entity id in it exists in the
owner's Home Assistant.

## 5. Port the kiosk to the tablet

The kiosk was written for the frame. Check each difference; change code only where the tablet needs it.

| | Frame | Tablet |
|---|---|---|
| Root | `su` ships with the firmware | Usually none |
| Screen sleep | Backlight off through `su` | Needs the fallback below |
| Navigation bar | Missing, so `NavigationService` adds one | Present; leave the service off |
| Screen | 1280x800 | Varies |
| Android | 6.0.1, WebView 107 | Often 10 to 15 |

- **Screen sleep.** `MainActivity.goDark` writes `/sys/class/backlight/*/brightness` through `su` whenever
  `findBacklight()` finds a node. Without root the write fails (logcat `HomeHQ`: `Backlight write failed`) and the
  screen stays lit behind the black cover. Use the backlight path only when `su` exists. Otherwise take the
  window-brightness fallback that is already in `goDark` and `wake`. Check on the tablet: after
  `--ei sleep_minutes 1`, the screen visibly dims within a minute and a tap brings it back.
- **Screen size.** The page is a fixed 1280x800 canvas (`page/index.html` viewport `width=1280`). 16:10 screens
  (1280x800, 1920x1200, 2560x1600) scale cleanly. Other ratios (5:3, 4:3, 16:9) show bars or clip the bottom. Tell
  the owner, and check every tab on the device before changing the layout.
- **Install.** The APK targets SDK 23. If `adb install` fails with `INSTALL_FAILED_DEPRECATED_SDK_VERSION`, retry with
  `adb install --bypass-low-target-sdk-block`. Leave the target where it is: raising it changes cleartext, storage
  and permission behaviour that the updater relies on.
- **Signing.** The first build creates `secrets/debug.keystore`. Keep that file: every later APK must be signed with
  it or the tablet refuses the update.

**Done when** `npm test` passes, `./build-linux.sh` (or `./build.sh` on Windows) produces `build/homehq.apk`, it
installs, and the dashboard shows live Home Assistant data on the tablet.

## 6. Kiosk mode and wall mounting

```sh
adb install -r build/homehq.apk
adb shell am start -n com.wesbos.homehq/.MainActivity --ei sleep_minutes 5
# Dedicated tablets only: make the kiosk the Home app
adb shell am start -n com.wesbos.homehq/.MainActivity --ez home true
adb shell cmd package set-home-activity com.wesbos.homehq/.Home
```

- The kiosk keeps the screen on while it is in front, so Android's screen timeout does not apply there. Sleep is the
  kiosk's `sleep_minutes`.
- The menu (Android settings, Wi-Fi, reload, update) opens with a two-finger hold of 1.5 s.
- A tablet on a charger all day wears its battery and can swell. Turn on the OEM's charge limit if it has one (Lenovo:
  Battery, Battery protection or Conservation mode). Otherwise suggest a smart plug that Home Assistant switches.
- Dedicated tablets: remove the lock screen PIN with the owner, or the kiosk sits behind it after every reboot.
- Set up over-the-air page updates (README, Updates over wifi), so later page changes need no cable.

**Done when** the tablet boots straight into the dashboard (dedicated) or opens it from the app icon (shared), and the
screen sleeps and wakes.

## 7. Live check

On the tablet, in front of the owner: open every visible tab, toggle a light, change a thermostat target, and check
that the clock and weather are current. Measure as on the frame: time from launch to first paint, and jank over 30 s
of idle with `adb shell dumpsys gfxinfo com.wesbos.homehq` (the frame draws 1 frame, 0 janky).

**Done when** the owner has a short report: tablet model, what was removed (point to `restore-apps.sh`), free storage
and RAM before and after, every tab checked with pass or fail, and the gfxinfo numbers.
