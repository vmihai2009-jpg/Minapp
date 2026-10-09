MINAPP for Mac - an app, no admin password

INSTALL
1. Unzip. You get "Minapp.app", "Uninstall Minapp.command" and this file.
2. Right-click "Minapp.app" and choose Open (only the first time; macOS asks because the app was downloaded and
   is not from the App Store). On macOS 15 (Sequoia) or later, if it only offers "Done", open System Settings >
   Privacy & Security, scroll down and click "Open Anyway" next to Minapp.
   Optional shortcut for that: in Terminal run   xattr -dr com.apple.quarantine <the unzipped folder>
3. Minapp offers to copy itself into your Applications folder. Say yes: it then lives in Launchpad and you can
   keep it in the Dock like any app.
4. First launch only: it downloads its player engine (about 120 MB, needs internet) and builds a Minapp-branded
   copy, so the Dock and menu bar say Minapp. A window tells you when it is working; Minapp starts by itself.
5. macOS asks whether Minapp may control Spotify: click OK. If you missed it: System Settings > Privacy &
   Security > Automation > Minapp > tick Spotify.
6. Open the Spotify desktop app and play something. Minapp follows it.

WHERE THINGS LIVE
- The app: Minapp.app (in Applications, or wherever you put it).
- Everything else (the player engine, your settings, your skins, the log): ~/Library/Application Support/Minapp
  (Minapp menu > Settings > Open data folder). Your skins are in its "skins" folder.
- Updating: replace Minapp.app with a newer one and open it; it rebuilds the engine (quick, no new download)
  and keeps your settings and skins.

UNINSTALL
Double-click "Uninstall Minapp.command" (right-click > Open the first time). It asks, then:
- "Remove everything": the app (Applications, ~/Applications and the one in this folder), the player engine and
  downloads, your settings, skins and logs. Things go to the Trash where possible, so nothing is unrecoverable.
- "Keep my skins and settings": removes only the app and engine, so a later reinstall continues where you left off.
It only touches Minapp's own files and never needs an admin password. The same script is kept at
~/Library/Application Support/Minapp, and Minapp menu > Settings > Uninstall Minapp... starts it.

MENU: click the skin's O button (top-left) or right-click the player, or use the "Player" menu at the top
of the screen. It has: Source (Spotify / YouTube), Playlist, Equalizer window, Milkdrop, Mini mode, Skins,
Pin on top, Size (0.5x to 3x), Equalizer sound (YouTube), Visualizer, Spotify queue and Settings.
SKINS: Skins in the menu lists your skin library (the "skins" folder inside "data"). It fills itself: every skin
you load (Skins > Load skin from file), drag onto the player, or copy into that folder (Skins > Open skins folder)
appears in the list within a second. Click one to use it; "Minapp (default skin)" brings back the built-in look.
The version number is shown in tiny pixel digits under the Minapp logo in the bottom-right corner.
Click the Minapp logo (or Skins > Get more skins) to open skins.webamp.org in your
browser, download a .wsz and drop it on the player. Every skin you load is kept in
its skins folder and listed under Skins (with a Random skin button).

WHAT WORKS
- Play / pause / next / previous / position bar / volume / shuffle / repeat control the Spotify desktop app.
- PLAYLIST: shows the current song and (after the one-time "Connect Spotify queue" setup, which needs a free
  Spotify developer app from an account with Premium) what is coming up. CLICK AN UPCOMING TITLE to jump to
  it. SCROLL UP to see what you already played and click one to go back to it.
- YOUTUBE source: paste a playlist or video link (Player > YouTube link). "Show YouTube video" hides the
  video window while the sound keeps playing. Videos whose owner switched embedding off cannot be played by any app: Minapp skips them
  (a note shows at the bottom of the video window) and logs them in data/bridge.log. YouTube Mixes are always
  playable; a normal playlist must be public or unlisted. YouTube asks that its player stays visible; hiding is your choice.
- EQUALIZER SOUND works for the YouTube source (the video's sound goes through the skin's 10 sliders).
  The visualizer / Milkdrop and the equalizer for Spotify need system-audio capture, which macOS does not
  offer without extra software, so they are Windows-only for now.
- Global hotkeys (Settings to turn off): Ctrl+Alt+Right = next, Ctrl+Alt+Left = previous,
  Ctrl+Alt+Down = play/pause, Ctrl+Alt+Up = show/hide the player, Ctrl+Alt+PageUp = show/hide the YouTube video.
- The player remembers its position, size, pin state, skin and equalizer between runs.

If the window is hidden, click the Minapp icon in the Dock.

IF SPOTIFY DOESN'T SHOW UP
Start a song in the Spotify desktop app first (it must have played something once), and check the
Automation permission above. A log is kept in ~/Library/Application Support/Minapp (bridge.log).
