# Minapp desktop widget (macOS 14+)

A native WidgetKit widget (small and medium) that shows the real Minapp player picture (served by Minapp as `/frame`), a ticking
clock drawn from the skin's own digit sprites, and previous / play-pause / next buttons.
Add it with right-click on the desktop > Edit Widgets > Minapp.

- `Host/` – "Minapp Widget.app", a small background app (macOS only lists widgets that ship inside an app). It also asks
  WidgetKit to redraw when the song or play state changes, and quits when Minapp does.
- `Extension/` – the widget itself and its button intents.
- `Shared/` – the state format and the loopback client.
- `app/widget-bridge.js` (Electron side) serves `/state` and `/cmd` on 127.0.0.1:47831 only, guarded by a shared secret in
  `~/Library/Application Support/Minapp/widget-secret` (`build.sh` bakes the same secret into the widget). It never touches the audio or visualizer code.

Build and install (ad-hoc signed, no Apple ID needed; needs Xcode):

    ./build.sh

Limits: WidgetKit cannot animate continuously. The widget grabs a short run of pictures per refresh and macOS shows about one new
step every 3-4 s, so bars and the title scroll move in steps. Custom fonts made macOS fall back to the placeholder, hence the sprite
digits (`Shared/Digits.swift`). The window widget (Player menu > Widget) is the smooth, always-live option.
