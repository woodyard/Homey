#!/bin/sh
# Pulls the latest homey-dashboard image and restarts the container only when the image
# changed. Run it from DSM Task Scheduler as root every 5 minutes:
#   sh /volume1/docker/homey-dashboard/update.sh
# Updates are logged to update.log next to this script.
set -eu

export PATH=/usr/local/bin:/usr/bin:/bin:$PATH
IMAGE=ghcr.io/woodyard/homey-dashboard:latest
cd "$(dirname "$0")"

if docker compose version >/dev/null 2>&1; then
  DC="docker compose"
else
  DC="docker-compose"
fi

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> update.log; }

before=$(docker image inspect -f '{{.Id}}' "$IMAGE" 2>/dev/null || echo none)
if ! out=$($DC pull -q 2>&1); then
  log "pull failed: $out"
  exit 1
fi
after=$(docker image inspect -f '{{.Id}}' "$IMAGE")

running=$(docker ps -q -f name='^homey-dashboard$')
if [ "$before" != "$after" ] || [ -z "$running" ]; then
  $DC up -d
  docker image prune -f >/dev/null
  log "started $after"
fi
