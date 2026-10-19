#!/usr/bin/env bash
# Linux build: tests, config.js, APK with the Android SDK in ~/Android/Sdk (build-tools 36.1.0, android-36.1).
# Output: build/homehq.apk, signed with secrets/debug.keystore (created if missing; the same file signs the Windows build,
# so copy it between machines or the frame refuses the update).
set -euo pipefail
cd "$(dirname "$0")"
KS=$PWD/secrets/debug.keystore
SDK=${ANDROID_HOME:-$HOME/Android/Sdk}
BT=$SDK/build-tools/36.1.0
JAR=$SDK/platforms/android-36.1/android.jar

npm test
node tools/render-config.mjs
cp page/* build/assets/

K=$(mktemp -d)   # the staged config.js holds the token; remove it even when a step fails
trap 'rm -rf "$K"' EXIT
cp -r kiosk "$K/kiosk" && rm -rf "$K/kiosk/build"
cd "$K/kiosk"
mkdir -p build/gen build/classes
"$BT/aapt2" compile --dir res -o build/res.zip
"$BT/aapt2" link -o build/base.apk -I "$JAR" --manifest AndroidManifest.xml build/res.zip --java build/gen \
  -A "$OLDPWD/build/assets" --min-sdk-version 23 --target-sdk-version 23 --version-code 4 --version-name 1.3-denver
javac -nowarn -source 8 -target 8 -classpath "$JAR" -d build/classes $(find src build/gen -name '*.java')
"$BT/d8" --min-api 23 --lib "$JAR" --output build $(find build/classes -name '*.class')
(cd build && zip -q base.apk classes.dex)
"$BT/zipalign" -f 4 build/base.apk build/aligned.apk
if [ ! -f "$KS" ]; then
  mkdir -p "$(dirname "$KS")"
  keytool -genkeypair -keystore "$KS" -storepass android -keypass android -alias androiddebugkey \
    -keyalg RSA -keysize 2048 -validity 10000 -dname 'CN=Android Debug,O=Android,C=US'
fi
"$BT/apksigner" sign --ks "$KS" --ks-pass pass:android --key-pass pass:android --out build/homehq.apk build/aligned.apk
cp build/homehq.apk "$OLDPWD/build/homehq.apk"
cd "$OLDPWD"
unzip -l build/homehq.apk | grep -E 'assets/'
sha256sum build/homehq.apk
