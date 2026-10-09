#!/bin/bash
# Builds the two ready-to-run zips into ../docs/downloads. Usage: ./build.sh
set -e
cd "$(dirname "$0")"
V=$(node -p "require('./app/package.json').version")
# precompiled Core Audio helper (loads in milliseconds; smtc.ps1 falls back to compiling the source)
if command -v mcs >/dev/null; then mcs -target:library -out:app/skinvol.dll tools/skinvol.cs; fi
# the Windows launcher (a prebuilt copy is committed; rebuilt when a compiler is available)
if command -v mcs >/dev/null; then (cd windows && mcs -target:winexe -win32icon:../app/icon.ico -out:Minapp.exe Launcher.cs); fi
OUT="$(cd .. && pwd)/docs/downloads"; mkdir -p "$OUT"
T=$(mktemp -d)

# ---- Windows: folder with Minapp.exe, the app and the first-run setup
D="$T/Minapp-Windows"; mkdir -p "$D/app"
cp -R app/. "$D/app/"; rm -rf "$D/app/node_modules" "$D/app/data"
cp -R windows/. "$D"/; rm -f "$D/Launcher.cs"
Z="$OUT/Minapp-Windows-v$V.zip"; rm -f "$Z"; (cd "$T" && zip -qrX "$Z" "Minapp-Windows"); echo "built $Z"

# ---- Mac: Minapp.app (a launcher that builds the branded player on first run) + the uninstaller
D="$T/Minapp-Mac"; mkdir -p "$D"
cp -R mac/. "$D"/
R="$D/Minapp.app/Contents/Resources"
mkdir -p "$R/app" && cp -R app/. "$R/app/"
rm -rf "$R/app/node_modules" "$R/app/data" "$R/app/smtc.ps1" "$R/app/skinvol.dll" "$R/app/icon.ico"
echo "$V" > "$R/VERSION"
cp "mac/Uninstall Minapp.command" "$R/Uninstall Minapp.command"
chmod +x "$D/Minapp.app/Contents/MacOS/Minapp" "$D/Uninstall Minapp.command" "$R/Uninstall Minapp.command"
Z="$OUT/Minapp-Mac-v$V.zip"; rm -f "$Z"; (cd "$T" && zip -qrX "$Z" "Minapp-Mac"); echo "built $Z"

rm -rf "$T"
