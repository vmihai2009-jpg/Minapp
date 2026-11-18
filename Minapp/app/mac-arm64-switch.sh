#!/bin/bash
# Mac only. Moves Minapp from the Intel engine (slow under Rosetta) to the native Apple chip engine.
#   mac-arm64-switch.sh build <electronVersion>   prepares the new engine next to the old one, prints "ready"
#   mac-arm64-switch.sh swap <pid> <open|noopen>  after Minapp (pid) has quit, puts the new engine in place
SUP="$HOME/Library/Application Support/Minapp"
ENGINE_DIR="$SUP/engine"
ENGINE="$ENGINE_DIR/Minapp.app"
CACHE="$SUP/downloads"
NEW="$SUP/engine.arm64"
LOG() { mkdir -p "$SUP"; echo "$(date '+%Y-%m-%d %H:%M:%S') [arm64-switch] $*" >> "$SUP/bridge.log"; }

# Names the program and its helper processes Minapp (they say "Electron" in Activity Monitor otherwise).
# Safe to run again: does nothing once renamed. Run before the ad-hoc signing.
rebrand_engine() {
  local C="$1/Contents" PB=/usr/libexec/PlistBuddy h n P
  [ -f "$C/MacOS/Electron" ] || return 0
  mv "$C/MacOS/Electron" "$C/MacOS/Minapp" || return 1
  "$PB" -c "Set :CFBundleExecutable Minapp" "$C/Info.plist" 2>/dev/null
  for h in "Electron Helper" "Electron Helper (Renderer)" "Electron Helper (GPU)" "Electron Helper (Plugin)"; do
    n="${h/Electron/Minapp}"
    [ -d "$C/Frameworks/$h.app" ] || continue
    mv "$C/Frameworks/$h.app" "$C/Frameworks/$n.app"
    mv "$C/Frameworks/$n.app/Contents/MacOS/$h" "$C/Frameworks/$n.app/Contents/MacOS/$n"
    P="$C/Frameworks/$n.app/Contents/Info.plist"
    "$PB" -c "Set :CFBundleName $n" "$P" 2>/dev/null
    "$PB" -c "Set :CFBundleDisplayName $n" "$P" 2>/dev/null || "$PB" -c "Add :CFBundleDisplayName string $n" "$P" 2>/dev/null
    "$PB" -c "Set :CFBundleIdentifier com.minapp.player.helper${n#Minapp Helper}" "$P" 2>/dev/null
  done
  return 0
}
engine_bin() { [ -f "$1/Contents/MacOS/Minapp" ] && echo "$1/Contents/MacOS/Minapp" || echo "$1/Contents/MacOS/Electron"; }

has_arm64() { file -b "$1" 2>/dev/null | grep -q arm64; }
# true on an Apple chip, also when this script itself is being run through Rosetta
apple_chip() { [ "$(sysctl -n hw.optional.arm64 2>/dev/null)" = "1" ] || [ "$(sysctl -n sysctl.proc_translated 2>/dev/null)" = "1" ]; }

build() {
  VER="$1"
  [ -n "$VER" ] || { LOG "no Electron version given"; exit 1; }
  if ! apple_chip || has_arm64 "$(engine_bin "$ENGINE")"; then
    echo skip; exit 0
  fi
  mkdir -p "$CACHE"
  EZIP="$CACHE/electron-v$VER-darwin-arm64.zip"
  if [ ! -s "$EZIP" ]; then
    LOG "downloading Electron $VER for Apple chips"
    if ! curl -fL --retry 4 --retry-delay 2 -o "$EZIP.part" \
        "https://github.com/electron/electron/releases/download/v$VER/electron-v$VER-darwin-arm64.zip"; then
      rm -f "$EZIP.part"; LOG "download failed"; exit 1
    fi
    mv "$EZIP.part" "$EZIP"
  fi
  rm -rf "$NEW"; mkdir -p "$NEW/x"
  if ! ditto -x -k "$EZIP" "$NEW/x"; then rm -f "$EZIP"; rm -rf "$NEW"; LOG "the downloaded engine was damaged"; exit 1; fi
  if ! mv "$NEW/x/Electron.app" "$NEW/Minapp.app"; then rm -rf "$NEW"; LOG "unexpected engine layout"; exit 1; fi
  E="$NEW/Minapp.app"
  # Minapp's code (with Webamp inside) comes from the running engine
  rm -rf "$E/Contents/Resources/app"
  cp -R "$ENGINE/Contents/Resources/app" "$E/Contents/Resources/app" || { rm -rf "$NEW"; LOG "could not copy the app"; exit 1; }
  cp "$ENGINE/Contents/Resources/electron.icns" "$E/Contents/Resources/electron.icns" 2>/dev/null
  P="$E/Contents/Info.plist"; PB=/usr/libexec/PlistBuddy
  setp() { "$PB" -c "Set :$1 $2" "$P" 2>/dev/null || "$PB" -c "Add :$1 string $2" "$P" 2>/dev/null; }
  setp CFBundleName Minapp; setp CFBundleDisplayName Minapp; setp CFBundleIdentifier com.minapp.player
  setp NSAudioCaptureUsageDescription "Minapp listens to the music that is playing so the visualizer can move with it."
  setp NSScreenCaptureUsageDescription "Minapp listens to the music that is playing so the visualizer can move with it. It never records the screen."
  setp NSAppleEventsUsageDescription "Minapp reads what the Spotify app is playing and sends it play, pause and skip commands."
  rebrand_engine "$E" || { rm -rf "$NEW"; LOG "could not rename the engine"; exit 1; }
  xattr -cr "$E" 2>/dev/null
  codesign --force --deep --sign - "$E" >/dev/null 2>&1
  cp "$ENGINE_DIR/.version" "$NEW/.version" 2>/dev/null
  rm -rf "$NEW/x"
  if has_arm64 "$(engine_bin "$E")" && codesign --verify --deep "$E" >/dev/null 2>&1; then
    LOG "native engine ready"
    echo ready; exit 0
  fi
  rm -rf "$NEW"; LOG "the new engine did not pass the checks"; exit 1
}

swap() {
  PID="$1"; MODE="$2"
  [ -d "$NEW/Minapp.app" ] || { LOG "swap: no new engine staged"; exit 1; }
  if [ -n "$PID" ]; then
    for _ in $(seq 150); do kill -0 "$PID" 2>/dev/null || break; sleep 0.2; done
  fi
  for _ in $(seq 25); do pgrep -f "^$ENGINE/Contents/" >/dev/null 2>&1 || break; sleep 0.2; done
  rm -rf "$ENGINE_DIR.intel-old"
  mv "$ENGINE_DIR" "$ENGINE_DIR.intel-old" || { LOG "swap: could not move the old engine"; exit 1; }
  if ! mv "$NEW" "$ENGINE_DIR"; then
    mv "$ENGINE_DIR.intel-old" "$ENGINE_DIR"; LOG "swap: could not move the new engine in"; exit 1
  fi
  rm -rf "$ENGINE_DIR.intel-old"
  LOG "swapped to the native engine"
  # older launchers pick the wrong chip: replace them with the one shipped in this version
  L="$ENGINE/Contents/Resources/app/mac-launcher.sh"
  if [ -f "$L" ]; then
    for A in "/Applications/Minapp.app" "$HOME/Applications/Minapp.app"; do
      T="$A/Contents/MacOS/Minapp"
      if [ -f "$T" ] && [ -w "$T" ] && ! cmp -s "$L" "$T"; then
        cp "$L" "$T" 2>/dev/null && chmod +x "$T" 2>/dev/null
      fi
    done
  fi
  [ "$MODE" = "open" ] && open "$ENGINE"
  exit 0
}

case "$1" in
  build) build "$2";;
  swap) swap "$2" "$3";;
  *) echo "usage: $0 build <electronVersion> | swap <pid> <open|noopen>" >&2; exit 2;;
esac
