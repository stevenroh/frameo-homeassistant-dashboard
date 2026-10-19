#!/usr/bin/env bash
# Serve the dashboard files for the frame's "Update dashboard" (menu, or Settings in the dashboard). No APK needed.
#   ./serve.sh              serve on :8099 with config.js (LAN only: it holds the HA token)
#   ./serve.sh --no-config  leave config.js out (not served), so the frame keeps its own
# One-time on the frame: adb shell am start -n com.wesbos.homehq/.MainActivity --es update_url http://<this-ip>:8099
set -euo pipefail
cd "$(dirname "$0")"
PORT=${PORT:-8099}
npm test >/dev/null
rm -rf build/assets   # start clean, so files from older builds are not published
node tools/render-config.mjs >/dev/null
cp page/* build/assets/
node tools/manifest.mjs "$@"
[ "${1:-}" = "--no-config" ] && rm -f build/assets/config.js   # not served at all, not just left out of the manifest
echo "Serving build/assets on http://$(ip -4 route get 1.1.1.1 | grep -oP "src \K\S+"):$PORT  (Ctrl-C to stop; rerun to pick up edits)"
exec python3 -m http.server "$PORT" --directory build/assets
