# Frame and kiosk quirks

What the Denver Frameo frame (`PFF_1037`) forces on the page and the kiosk app, and why. A tablet needs only some of
these; [TABLET.md](../TABLET.md) covers the port.

## The hardware

- **1 GHz Cortex-A7, Android 6.0.1, WebView 107.** The page has no framework, no animations, ripples or shadows, and
  touches the DOM only when a value changes. Idle for 30 s it draws one frame.
- **Fixed 1280x800.** The page is laid out for exactly that viewport (`width=1280`).
- **No clock battery.** Every boot starts at 2021-05-15 02:00 until network time arrives. The page treats any year
  before 2025 as untrusted (`clockTrusted`): the clock reads `--:--` and "Waiting for network time", the check runs
  every 2 s instead of every minute, and the agenda's day labels are redrawn once the real time arrives. A wrong clock also breaks TLS, so `wss://` fails until the time is right.
- **Old emoji font.** Android 6 shows most emoji (flags, ZWJ sequences, skin tones) as boxes, so titles from calendars
  and to-dos lose every emoji (`cleanTitle`). The
  strip covers the whole Miscellaneous Symbols and Dingbats blocks, so ★ and ✓ go too; © stays.
- **No date picker and no on-screen keyboard.** Reminders are presets (none, in 1 hour, this evening, tomorrow 09:00).
  Adding a to-do needs a keyboard app on the frame; without one, add items from a phone.
- **Every app gets root.** The firmware ships `su` open to all apps. That is why sleep can switch the backlight off, and
  why remote debugging is off by default (below).

## Kiosk app

| Feature | How |
| --- | --- |
| Full screen | Immersive mode hides the status and navigation bars |
| Menu (launcher, Settings, Wi-Fi, reload, update) | Hold two fingers still for 1.5 s (120 px slop), or one finger for 3 s on the empty bottom of the left rail |
| Screen sleep | After `sleep_minutes` (default 5, `--ei sleep_minutes N`, 0 = never) |
| Offline | A native screen instead of WebView's error page |
| Boot without Wi-Fi | A failed load retries every 5 s |
| Remote debugging | Only with `--ez debug true` |
| Start at boot | On by default (`BootReceiver`); `--ez autostart false` turns it off |
| Home app | `--ez home true`, then `cmd package set-home-activity com.wesbos.homehq/.Home` (Android 7+) |
| Navigation bar | `NavigationService`, an accessibility service, for frames without one |
| Page updates | `PageUpdater`, see [update-server.md](update-server.md) |

### Screen sleep

The kiosk keeps the screen on, so Android's own timeout never fires. After `sleep_minutes` without a touch it puts a
black cover over the page and writes `0` to `/sys/class/backlight/*/brightness` through `su`. The touchscreen stays on:
the first tap only wakes the screen and is not passed to the page, so it cannot toggle a light by accident. On wake the
saved brightness is restored (204 if none was saved).

Without a backlight node the kiosk dims the window to Android's minimum instead. Without root the backlight write fails
(logcat tag `HomeHQ`, `Backlight write failed`) and the screen stays lit behind the cover; see TABLET.md.

### Why the offline screen

WebView's own error page prints the full failing URL. A saved URL can carry a token, so the kiosk shows its own screen
(with a Wi-Fi settings button when there is no network) and retries.

### Remote debugging

`chrome://inspect` works only after launching with:

```sh
adb shell am start -n com.wesbos.homehq/.MainActivity --ez debug true
```

Every app on the frame has root, so the devtools socket should exist only while someone is debugging.

### Saved URL

`--es url <url>` saves a page URL used on every launch. Only `http` and `https` URLs are saved; anything else is
ignored. `pm clear com.wesbos.homehq` returns to the bundled page.

### Navigation service

Some frames ship without an Android navigation bar, which leaves no way back from Settings. `NavigationService` draws
a small Back/Dashboard bar over other apps, hidden while the dashboard is in front. Enable it under Settings,
Accessibility. Some firmware (PF1007L) drops the service after the kiosk is updated or force-stopped; grant
`WRITE_SECURE_SETTINGS` once and the kiosk re-enables it on start:

```sh
adb shell pm grant com.wesbos.homehq android.permission.WRITE_SECURE_SETTINGS
```

### Over-the-air updates

`PageUpdater` reads `<update_url>/manifest.json`, downloads every listed file into a temp folder, and swaps the folder
in only when all succeeded. The page folder is flat (file names have no slashes; at most 64 files of 8 MB).
`config.js` stays on the frame unless the manifest lists it, so the token does not have to be on the update server.
Setting up the server: [update-server.md](update-server.md).

## The token

The long-lived token is in the APK and in `config.js` on the frame, readable by anyone with ADB. Use a non-admin Home
Assistant user, and rotate the token if an APK leaves your hands.
