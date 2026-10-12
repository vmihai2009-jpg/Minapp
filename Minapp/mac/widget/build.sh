#!/bin/sh
# Ad-hoc build + install of the Minapp desktop widget (no Apple ID needed). Run from this folder.
set -e
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
SECRET_FILE="$HOME/Library/Application Support/Minapp/widget-secret"
OUT="$HOME/Library/Caches/MinappWidgetBuild"   # outside ~/Documents: synced folders add xattrs that break codesign
mkdir -p "$(dirname "$SECRET_FILE")"
[ -s "$SECRET_FILE" ] || { openssl rand -hex 24 > "$SECRET_FILE"; chmod 600 "$SECRET_FILE"; }
xcodebuild -project MinappWidget.xcodeproj -scheme MinappWidget -configuration Release \
  -derivedDataPath "$OUT" MINAPP_WIDGET_SECRET="$(cat "$SECRET_FILE")" build
APP="$OUT/Build/Products/Release/Minapp Widget.app"
rm -rf "/Applications/Minapp Widget.app"
cp -R "$APP" /Applications/
open -g "/Applications/Minapp Widget.app" --args -background
