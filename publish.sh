#!/usr/bin/env bash
# Build the dashboard files and copy them to the file host; the frame picks them up with "Update now" in Settings.
#   ./publish.sh root@<ip>                 code only (the frame keeps its own config.js)
#   ./publish.sh root@<ip> --with-config   also publish config.js (it holds the HA token: LAN/tailnet hosts only)
set -euo pipefail
cd "$(dirname "$0")"
HOST=${1:?usage: ./publish.sh user@host [--with-config]}
FLAG=--no-config; [ "${2:-}" = "--with-config" ] && FLAG=
npm test >/dev/null
rm -rf build/assets   # start clean, so files from older builds are not published
node tools/render-config.mjs >/dev/null
cp page/* build/assets/
node tools/manifest.mjs $FLAG
if [ -z "$FLAG" ]; then rsync -a --delete build/assets/ "$HOST:/srv/frame/"
else rsync -a --delete --delete-excluded --exclude config.js build/assets/ "$HOST:/srv/frame/"; fi
echo "Published $(grep -o '"version": "[^"]*"' build/assets/manifest.json). On the frame: Settings, Update now."
