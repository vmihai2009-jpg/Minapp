#!/bin/bash
# Portable launcher: needs no install and no admin rights.
# First run downloads the player engine (Electron) and Webamp into this folder.
cd "$(dirname "$0")" || exit 1
ROOT="$PWD"; APP="$ROOT/app"; RT="$ROOT/runtime"
ELECTRON_VERSION="44.7.0"; WEBAMP_VERSION="2.3.1"
case "$(uname -m)" in arm64) ARCH=arm64;; *) ARCH=x64;; esac

fail() {
  echo; echo "Setup failed: $1"
  echo "If you are on a work or school network, it may block github.com or registry.npmjs.org."
  read -n 1 -s -r -p "Press any key to close"; echo; exit 1
}

EXE="$RT/Electron.app/Contents/MacOS/Electron"
if [ ! -x "$EXE" ]; then
  echo "First run: downloading the player engine (about 120 MB). This only happens once..."
  rm -rf "$ROOT/runtime.tmp" "$ROOT/electron.zip"
  curl -fL --retry 4 --retry-delay 2 -o "$ROOT/electron.zip" \
    "https://github.com/electron/electron/releases/download/v$ELECTRON_VERSION/electron-v$ELECTRON_VERSION-darwin-$ARCH.zip" \
    || fail "could not download Electron."
  echo "Unpacking..."
  mkdir "$ROOT/runtime.tmp" && ditto -x -k "$ROOT/electron.zip" "$ROOT/runtime.tmp" || fail "could not unpack Electron."
  rm -rf "$RT"; mv "$ROOT/runtime.tmp" "$RT"; rm -f "$ROOT/electron.zip"
fi

WA="$APP/node_modules/webamp"
if [ ! -f "$WA/built/webamp.bundle.min.js" ]; then
  echo "First run: downloading Webamp..."
  rm -rf "$ROOT/webamp.tmp" "$ROOT/webamp.tgz"; mkdir "$ROOT/webamp.tmp"
  curl -fL --retry 4 --retry-delay 2 -o "$ROOT/webamp.tgz" \
    "https://registry.npmjs.org/webamp/-/webamp-$WEBAMP_VERSION.tgz" || fail "could not download Webamp."
  tar -xzf "$ROOT/webamp.tgz" -C "$ROOT/webamp.tmp" || fail "could not unpack Webamp."
  mkdir -p "$APP/node_modules"; rm -rf "$WA"
  mv "$ROOT/webamp.tmp/package" "$WA"; rm -rf "$ROOT/webamp.tmp" "$ROOT/webamp.tgz"
fi

# files from a downloaded zip carry a quarantine mark that makes macOS refuse to open them
xattr -dr com.apple.quarantine "$ROOT" 2>/dev/null

nohup "$EXE" "$APP" >/dev/null 2>&1 &
disown 2>/dev/null
echo "Minapp is starting. You can close this window."
