#!/usr/bin/env bash
set -euo pipefail
find exports/playwright-results -name "*.webm" | while IFS= read -r f; do
  echo "re-encoding: $f"
  tmp=$(mktemp --suffix=.webm)
  ffmpeg -loglevel error -i "$f" -c:v libvpx-vp9 -crf 18 -b:v 0 -an -y "$tmp" && mv "$tmp" "$f"
done
echo "done"
