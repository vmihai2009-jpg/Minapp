#!/bin/bash
# Removes Minapp from this Mac. Double-click it (right-click > Open the first time).
# It never touches anything outside Minapp's own files, and never needs an admin password.

HERE="$(cd "$(dirname "$0")" && pwd)"
SUP="$HOME/Library/Application Support/Minapp"

ANS="$(osascript -e 'button returned of (display dialog "Remove Minapp from this Mac?\n\n• Remove everything: the app, its settings and your skin library.\n• Keep my skins and settings: remove only the app, so a later reinstall picks up where you left off." with title "Uninstall Minapp" buttons {"Cancel", "Keep my skins and settings", "Remove everything"} default button 3 cancel button 1 with icon caution)' 2>/dev/null)"
case "$ANS" in
  "Remove everything") KEEP=0;;
  "Keep my skins and settings") KEEP=1;;
  *) echo "Cancelled. Nothing was removed."; exit 0;;
esac

echo "Quitting Minapp..."
# ask politely first (the "is running" test never launches the app), then stop any leftovers of Minapp's own engine
osascript -e 'if application "Minapp" is running then tell application "Minapp" to quit' >/dev/null 2>&1
sleep 1
pkill -f "^$SUP/engine/Minapp.app/Contents/" 2>/dev/null
sleep 1

trash() {  # move to the Trash when possible (so it can be recovered), otherwise delete
  [ -e "$1" ] || return 0
  local name; name="$(basename "$1")"; local dest="$HOME/.Trash/$name"
  [ -e "$dest" ] && dest="$HOME/.Trash/$name $(date +%H%M%S)"
  mv "$1" "$dest" 2>/dev/null || rm -rf "$1"
  echo "  removed $1"
}

echo "Removing the app..."
trash "/Applications/Minapp.app"
trash "$HOME/Applications/Minapp.app"
trash "$HERE/Minapp.app"

echo "Removing the player engine and downloads..."
trash "$SUP/engine"
trash "$SUP/engine.building"
trash "$SUP/downloads"
rm -f "$SUP/.asked-install"

if [ "$KEEP" = "0" ]; then
  echo "Removing settings, skins and logs..."
  trash "$SUP"
  trash "$HOME/Library/Caches/Minapp"
  trash "$HOME/Library/Caches/com.minapp.player"
  trash "$HOME/Library/Logs/Minapp"
  trash "$HOME/Library/Preferences/com.minapp.player.plist"
  trash "$HOME/Library/Saved Application State/com.minapp.player.savedState"
  trash "$HOME/Library/HTTPStorages/com.minapp.player"
  trash "$HOME/Library/WebKit/com.minapp.player"
else
  echo "Keeping your settings and skins in: $SUP"
fi

# this script lives in the Minapp folder you downloaded; the folder itself is yours to delete
[ "$HERE" != "$SUP" ] && echo && echo "Done. You can now delete this folder: $HERE"
[ "$HERE" = "$SUP" ] && [ "$KEEP" = "0" ] && rm -f "$0" 2>/dev/null
osascript -e 'display dialog "Minapp has been removed." with title "Uninstall Minapp" buttons {"OK"} default button 1' >/dev/null 2>&1
exit 0
