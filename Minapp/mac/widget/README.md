# Minapp desktop widget (macOS 14+)

A native WidgetKit widget: now playing (title, artist, progress timer) with previous / play-pause / next buttons.
Add it with right-click on the desktop > Edit Widgets > Minapp.

- `Host/` – "Minapp Widget.app", a small background app (macOS only lists widgets that ship inside an app). It also asks
  WidgetKit to redraw when the song or play state changes, and quits when Minapp does.
- `Extension/` – the widget itself and its button intents.
- `Shared/` – the state format and the loopback client.
- `app/widget-bridge.js` (Electron side) serves `/state` and `/cmd` on 127.0.0.1:47831 only, guarded by a shared secret in
  `~/Library/Application Support/Minapp/widget-secret` (`build.sh` bakes the same secret into the widget). It never touches the audio or visualizer code.

Build and install (ad-hoc signed, no Apple ID needed; needs Xcode):

    ./build.sh
