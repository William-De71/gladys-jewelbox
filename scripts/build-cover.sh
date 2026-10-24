#!/usr/bin/env bash
# Builds cover.jpg (800 x 534, < 150 KB, the size Gladys shows) from the icon
# of JewelBox Music Library (docs/assets/jewelbox-icon.png, copied from
# client/public/icons/icon-512.png). Needs ImageMagick and the Cantarell font.
set -euo pipefail
cd "$(dirname "$0")/.."
magick -size 800x534 gradient:'#2b3445'-'#11151c' \
  \( docs/assets/jewelbox-icon.png -resize 420x420 \) -gravity west -geometry +40+0 -composite \
  -gravity northwest -fill '#f4f6fa' -font Cantarell-Extra-Bold -pointsize 56 -annotate +492+186 'JewelBox' \
  -fill '#aab4c8' -font Cantarell -pointsize 30 -annotate +494+262 'Music Library' \
  -fill '#7fb2ff' -font Cantarell -pointsize 26 -annotate +494+318 'for Gladys Assistant' \
  -strip -quality 85 -sampling-factor 4:2:0 cover.jpg
size="$(stat -c %s cover.jpg)"
dims="$(magick identify -format '%wx%h' cover.jpg)"
echo "cover.jpg: ${dims}, ${size} bytes"
[ "$dims" = "800x534" ] || { echo "wrong dimensions" >&2; exit 1; }
[ "$size" -lt $((150 * 1024)) ] || { echo "too heavy" >&2; exit 1; }
