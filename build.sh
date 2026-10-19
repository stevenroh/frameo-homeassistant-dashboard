#!/usr/bin/env bash
# Test, render config, bundle page/ into the kiosk APK on the Windows Android SDK, copy it back.
# Output: build/homehq.apk. Deploy steps: README.md.
set -euo pipefail
cd "$(dirname "$0")"
NODE=${NODE:-node}
WIN_TEMP=$(cmd.exe /c 'echo %TEMP%' 2>/dev/null | tr -d '\r')
STAGE_WIN="$WIN_TEMP\\frameo-dashboard-build"
STAGE=$(wslpath -u "$STAGE_WIN")
trap 'rm -rf "$STAGE"' EXIT   # the staged config.js holds the token; remove it even when a step fails

TZ=Europe/Amsterdam "$NODE" --test test/*.test.js test/*.test.mjs
rm -rf build/assets   # start clean, so files from older builds are not bundled
"$NODE" tools/render-config.mjs
# Flat on purpose: aapt2.exe stores subfolders with a backslash, which Android cannot find.
cp page/* build/assets/

rm -rf "$STAGE" && mkdir -p "$STAGE"
rsync -a --exclude build kiosk/ "$STAGE/kiosk/"
rsync -a build/assets/ "$STAGE/assets/"
[ -f secrets/debug.keystore ] && cp secrets/debug.keystore "$STAGE/debug.keystore"
KS_ARG=; [ -f secrets/debug.keystore ] && KS_ARG=1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$STAGE_WIN\\kiosk\\build.ps1" -Assets "$STAGE_WIN\\assets" ${KS_ARG:+-Keystore "$STAGE_WIN\\debug.keystore"}
cp "$STAGE/kiosk/build/homehq.apk" build/homehq.apk

unzip -l build/homehq.apk | grep -E 'assets/'
keytool -printcert -jarfile build/homehq.apk | grep -m1 SHA256
sha256sum build/homehq.apk
