# Minapp desktop widget (macOS 14+)

A native WidgetKit widget: now playing (title, artist, progress timer) with previous / play-pause / next buttons.
Add it with right-click on the desktop > Edit Widgets > Minapp.

- `Host/` – "Minapp Widget.app", a small background app (macOS only lists widgets that ship inside an app). It also asks
  WidgetKit to redraw when the song or play state changes, and quits when Minapp does.
- `Extension/` – the widget itself and its button intents.
- `Shared/` – state file format and App Group paths.
- `app/widget-bridge.js` (Electron side) writes state over loopback HTTP (127.0.0.1:47831, shared secret in ~/Library/Application Support/Minapp/widget-secret)
  (`~/Library/Group Containers/<TEAM>.com.minapp.widget`) and polls `commands/` for button presses. It does nothing
  until the widget app has been run once, and never touches the audio or visualizer code.

Build and install (ad-hoc signed, no Apple ID needed; needs Xcode):


    ./build.sh
