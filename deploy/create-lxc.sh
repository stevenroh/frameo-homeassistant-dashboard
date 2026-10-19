#!/usr/bin/env bash
# Run ON the Proxmox host (as root). Creates a tiny Alpine LXC that serves the frame's dashboard files with Caddy on :8099.
# Usage: ./create-lxc.sh <public-key-file> <ip> <gateway> [vmid]
# The key is added to the container's root so `./publish.sh` can rsync into it.
set -euo pipefail
KEY=${1:?path to the public key that may publish, e.g. ~/.ssh/id_ed25519.pub}
IP=${2:?container IP}; GW=${3:?gateway IP}; ID=${4:-$(pvesh get /cluster/nextid)}
TEMPLATE=$(ls /var/lib/vz/template/cache | grep -m1 '^alpine-3') || { echo "no alpine template: pveam download local alpine-3.18-default_20230607_amd64.tar.xz"; exit 1; }
pct create "$ID" "local:vztmpl/$TEMPLATE" --hostname frame-files --cores 1 --memory 128 --swap 0 --rootfs local-lvm:1 \
  --net0 "name=eth0,bridge=vmbr0,ip=$IP/24,gw=$GW" --unprivileged 1 --onboot 1 --ssh-public-keys "$KEY" \
  --tags frame --description "Serves the Frameo Home Assistant dashboard files (Caddy on :8099)"
pct start "$ID"; sleep 6
pct exec "$ID" -- sh -c 'apk update -q && apk add -q caddy openssh rsync && rc-update add sshd default && rc-service sshd start && mkdir -p /srv/frame'
pct exec "$ID" -- sh -c 'printf ":8099 {\n\troot * /srv/frame\n\tfile_server\n\theader Cache-Control no-store\n}\n" > /etc/caddy/Caddyfile && rc-update add caddy default && rc-service caddy restart'
echo "Ready: http://$IP:8099/  (publish with ./publish.sh root@$IP)"
