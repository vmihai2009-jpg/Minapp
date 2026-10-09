#!/bin/bash
# Builds the two ready-to-run zips into ../docs/downloads. Usage: ./build.sh
set -e
cd "$(dirname "$0")"
V=$(node -p "require('./app/package.json').version")
OUT="$(cd .. && pwd)/docs/downloads"; mkdir -p "$OUT"
T=$(mktemp -d)
for P in windows mac; do
  D="$T/Minapp-${P^}"; mkdir -p "$D"
  mkdir -p "$D/app" && cp -R app/. "$D/app/" && rm -rf "$D/app/node_modules" "$D/app/data"
  cp -R "$P"/. "$D"/
  [ "$P" = mac ] && chmod +x "$D/setup.sh" "$D/Start Minapp.command"
  [ "$P" = mac ] && rm -f "$D/app/smtc.ps1"
  Z="$OUT/Minapp-${P^}-v$V.zip"; rm -f "$Z"
  (cd "$T" && zip -qrX "$Z" "Minapp-${P^}")
  echo "built $Z"
done
rm -rf "$T"
