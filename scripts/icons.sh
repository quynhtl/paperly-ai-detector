#!/bin/bash
# Renders assets/icon.svg to src/icon-48.png and src/icon-96.png with headless
# Chrome: the marketplace takes PNG or JPEG icons, not SVG.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
for size in 48 96; do
	printf '<html><body style="margin:0"><img src="file://%s/assets/icon.svg" width="%s" height="%s"></body></html>' \
		"$HERE" "$size" "$size" > "$TMP/icon.html"
	"$CHROME" --headless --disable-gpu --hide-scrollbars --allow-file-access-from-files \
		--default-background-color=00000000 --force-device-scale-factor=1 \
		--screenshot="$HERE/src/icon-$size.png" --window-size="$size,$size" \
		"file://$TMP/icon.html" 2>/dev/null
	echo "src/icon-$size.png"
done
