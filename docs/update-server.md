# Update server

After the first APK install the frame can fetch new page files over wifi. It needs a plain HTTP host that serves
`build/assets/` (the page files plus `manifest.json`). Pick one:

| Option | When | Command |
| --- | --- | --- |
| Quick | Trying changes from your computer; the frame fetches only while it runs | `./serve.sh` |
| Permanent | An always-on host, publishing from any machine | `deploy/create-lxc.sh` once, then `./publish.sh` |
| Your own | Any static web server you already run | copy `build/assets/` (below) |

Java changes (sleep, menu, permissions) still need a new APK.

## Quick: serve.sh

```sh
./serve.sh              # serves build/assets on :8099, config.js included
./serve.sh --no-config  # config.js is not served, the frame keeps its own
PORT=9000 ./serve.sh    # another port
```

It runs the tests, renders `config.js` from `secrets/config.json`, copies `page/*` to `build/assets/`, writes
`manifest.json`, and starts `python3 -m http.server`. It prints the address to give the frame. Rerun it after an edit.

## Permanent: an LXC on Proxmox

`deploy/create-lxc.sh` makes an unprivileged Alpine container (hostname `frame-files`, 1 core, 128 MB, 1 GB disk,
starts on boot) that serves `/srv/frame` with Caddy on port 8099. Caddy sends `Cache-Control: no-store`, so a browser
checking the files never sees an old copy.

1. On the Proxmox host, as root, fetch an Alpine template if there is none:

   ```sh
   pveam update && pveam available | grep alpine-3
   pveam download local alpine-3.18-default_20230607_amd64.tar.xz   # or the newest listed
   ```

2. Copy the script and the public key of the machine you will publish from to the host, then run it:

   ```sh
   ./create-lxc.sh ~/id_ed25519.pub <ip> <gateway>        # key, container IP, gateway
   ./create-lxc.sh ~/id_ed25519.pub <ip> <gateway> 150    # same, with container id 150
   ```

   It assumes the defaults of a stock install: storage `local` for templates, `local-lvm` for disks, bridge `vmbr0`,
   a `/24` network. Edit the `pct create` line if yours differ. It ends with `Ready: http://<ip>:8099/`.

3. From your computer (Node and rsync installed, `secrets/config.json` filled in):

   ```sh
   ./publish.sh root@<ip>                 # page files only; the frame keeps its own config.js
   ./publish.sh root@<ip> --with-config   # also publish config.js
   ```

   It runs the tests, builds `build/assets/` like `serve.sh`, and rsyncs it to `/srv/frame/` with `--delete`. Without `--with-config` it also deletes a `config.js`
   left there by an earlier publish. It prints
   the published version (`<git short sha> <UTC time>`).

No Proxmox: any small Linux box works the same way. Install Caddy, rsync and an SSH server, use the Caddyfile from the script, give your key
access to `/srv/frame`, and use `./publish.sh user@host`.

## Your own web server

Build the files without serving them, then copy `build/assets/` to the server:

```sh
npm test && node tools/render-config.mjs && cp page/* build/assets/ && node tools/manifest.mjs --no-config
rm build/assets/config.js
```

That leaves the token off the server and out of the manifest. For a private host that should hand out the token too
(below), drop `--no-config` and the `rm`. Every file keeps its name between versions, so serve them without long
caching (`Cache-Control: no-store` is simplest).

## Point the frame at the server

Once, over ADB:

```sh
adb shell am start -n com.wesbos.homehq/.MainActivity --es update_url http://<ip>:8099
```

Or type the address in Settings (gear at the bottom of the rail) if the frame has a keyboard app. Only `http` and
`https` addresses are kept. Then, each time you publish: Settings, Update now, or the two-finger menu, Update dashboard.
A toast shows `Updated to <version>`, and Settings shows the running version. "Use built-in" goes back to the page
bundled in the APK.

## How an update works

`tools/manifest.mjs` lists every file in `build/assets/` in `manifest.json` with a version. The frame reads the manifest,
downloads each listed file into a temp folder, and swaps that folder in only when every file arrived. A failed update
leaves the running copy alone. When the manifest does not list `config.js`, the frame copies over the one it is already
using. Limits: at most 64 files of 8 MB each, flat names (no folders).

## The token

`config.js` holds the Home Assistant token. Publish it (`serve.sh` without `--no-config`, `publish.sh --with-config`)
only to a host reachable from your LAN or tailnet, never one on the internet. The usual flow is to put the token on
the frame once, through the APK or one `--with-config` publish, and publish page files only after that.

## Troubleshooting

| Toast | Check |
| --- | --- |
| No update address set | Run the `adb ... --es update_url` command above |
| Update failed: HTTP 404 for manifest.json | The address points at the folder holding `manifest.json`; publish ran without errors |
| Update failed: connect timed out (or similar) | Open `http://<host>:8099/manifest.json` from another device on the frame's wifi; the container is running (`pct status <id>`) |
| Update failed: manifest has no index.html | `manifest.json` was written or copied by hand without `index.html`; rebuild with `publish.sh` or `serve.sh` |
| Updated, but the old page still shows | A page URL was saved with `--es url`; the kiosk loads that instead of the updated files. `pm clear com.wesbos.homehq` removes it (and the update address, so set that again) |
