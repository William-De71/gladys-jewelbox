#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# Generated illustrations of the widgets, in English and French:
#   docs/assets/widgets.<lang>.png   the five widgets: player, collection,
#                                    loans, album of the day, recently added
#
# They are NOT screenshots of a running Gladys: the contents come from the
# integration's own code (gen.mjs: the app, the fake Gladys of the SDK and
# the fake JewelBox server of the tests, invented albums on a fixed date,
# plain generated covers), and render.js draws them the way the Gladys front
# does (same slots, order and class names as
# front/src/components/boxs/external-widget, the official theme). Light
# theme: the dark mode of Gladys greys the badges out.
#
# Needs: Node, Chrome or Chromium (CHROME=/path/to/chrome, or the Playwright
# one), ImageMagick and Python 3 with Pillow. Run from the repository root:
#   docs/illustrations/render.sh
# -----------------------------------------------------------------------------
set -euo pipefail

repo="$(cd "$(dirname "$0")/../.." && pwd)"
here="$repo/docs/illustrations"
out="$repo/docs/assets"
# The Gladys front the styles are taken from (master of 2026-10-23).
gladys_ref="a5d8b8c89a46582d5ef6ba817f609d76235063e8"
gladys_raw="https://raw.githubusercontent.com/GladysAssistant/Gladys/${gladys_ref}/front/src"

chrome="${CHROME:-$(find "$HOME/.cache/ms-playwright" -path "*/chrome-linux*/chrome" -type f 2>/dev/null | sort | tail -n1)}"
if [ ! -x "$chrome" ]; then
  echo "Chrome not found: set CHROME=/path/to/chrome" >&2
  exit 1
fi

work="$(mktemp -d)"
trap '[ -n "${KEEP_WORK:-}" ] || rm -rf "$work"' EXIT
cp "$here/index.html" "$here/render.js" "$work/"

# The official theme, as the Gladys front bundles it.
mkdir -p "$work/vendor/theme" "$work/vendor/apexcharts"
(cd "$work/vendor" && npm pack -s @gladysassistant/theme-optimized@2.1.0 apexcharts@3.54.1 >/dev/null)
tar xzf "$work"/vendor/gladysassistant-theme-optimized-*.tgz -C "$work/vendor/theme"
tar xzf "$work"/vendor/apexcharts-*.tgz -C "$work/vendor/apexcharts"

# The widget styles are a CSS module: its class names are used as they are,
# except `.badge`, which the theme also defines (renamed `.wbadge`).
curl -fsS "$gladys_raw/components/boxs/external-widget/style.css" |
  sed -E 's/:global\(([^)]*)\)/\1/g; s/\.badge([^A-Za-z])/.wbadge\1/g' >"$work/widget.css"
curl -fsS "$gladys_raw/style/dark-mode.css" -o "$work/dark-mode.css"

# Plain covers: a gradient and a circle, never real artwork.
mkdir -p "$work/covers"
colors=("#3b5b92 #8fb3e8" "#1f4e5f #7cc6d6" "#6b3e75 #d8a7e0" "#8a4b2a #f0b27a" "#2f5d3a #9ad1a5" "#5c2a2a #e08a8a" "#33384a #a7b0cc" "#6a5a20 #e6d27a")
for n in "${!colors[@]}"; do
  read -r from to <<<"${colors[$n]}"
  magick -size 300x300 "gradient:${from}-${to}" -fill none -stroke 'rgba(255,255,255,0.55)' -strokewidth 6 \
    -draw "circle 150,150 150,$((60 + n * 6))" -fill 'rgba(255,255,255,0.8)' -stroke none -draw 'circle 150,150 150,138' \
    "$work/covers/$n.png"
done

TZ=Europe/Paris node "$here/gen.mjs" "$repo" "$work/covers" "$work/contents.json"
locales="$work/vendor/apexcharts/package/dist/locales"
{
  printf 'window.APEX_LOCALES=['
  for language in fr en; do cat "$locales/$language.json"; printf ','; done
  printf '];\nwindow.DATA='
  cat "$work/contents.json"
  printf ';\n'
} >"$work/data.js"

shot() {
  local file="$1" size="$2" query="$3"
  TZ=Europe/Paris "$chrome" --headless=new --no-sandbox --disable-gpu --hide-scrollbars \
    --allow-file-access-from-files --virtual-time-budget=4000 \
    --window-size="$size" --force-device-scale-factor=1.5 \
    --screenshot="$file" "file://$work/index.html?$query" >/dev/null 2>&1
  local background
  background="$(magick "$file" -format '%[pixel:p{2,2}]' info:)"
  magick "$file" -trim -bordercolor "$background" -border 30 "$file"
}

for language in en fr; do
  shot "$out/widgets.$language.png" 880,2700 "lang=$language&cards=playing,today,collection,loans,recent"
done

# 256 colors keep the small colored dots and badges exact.
python3 -I - "$out" <<'PY'
import glob
import sys
from PIL import Image

for path in glob.glob(f"{sys.argv[1]}/widgets.*.png"):
    image = Image.open(path).convert("RGB")
    image.quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).save(
        path, optimize=True
    )
PY
ls -l "$out"/widgets.*.png
