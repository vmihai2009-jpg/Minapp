MINAPP for Mac - no install, no admin

1. Unzip this folder anywhere you can write to (Desktop, Documents, a USB stick).
2. Right-click "Start Minapp.command" and choose Open (only the first time; macOS asks because the file
   was downloaded). If it still refuses: System Settings > Privacy & Security > "Open Anyway".
   - First run downloads about 150 MB into this folder (needs internet, once only).
3. macOS will ask whether Minapp (Electron) may control Spotify: click OK. If you missed it:
   System Settings > Privacy & Security > Automation > Electron > tick Spotify.
4. Open the Spotify desktop app and play something. The player follows it.

MENU: click the skin's O button (top-left) or right-click the player, or use the "Player" menu at the top
of the screen. It has: Source (Spotify / YouTube), Playlist, Equalizer window, Milkdrop, Mini mode, Skins,
Pin on top, Size, Equalizer sound (YouTube), Visualizer, Spotify queue and Settings.
Drag a .wsz skin from skins.webamp.org onto the window to change the skin. Every skin you load is kept in
data/skins and listed under Skins (with a Random skin button).

WHAT WORKS
- Play / pause / next / previous / position bar / volume / shuffle / repeat control the Spotify desktop app.
- PLAYLIST: shows the current song and (after the one-time "Connect Spotify queue" setup, which needs a free
  Spotify developer app from an account with Premium) what is coming up. CLICK AN UPCOMING TITLE to jump to
  it. SCROLL UP to see what you already played and click one to go back to it.
- YOUTUBE source: paste a playlist or video link (Player > YouTube link). "Show YouTube video" hides the
  video window while the sound keeps playing. YouTube asks that its player stays visible; hiding is your choice.
- EQUALIZER SOUND works for the YouTube source (the video's sound goes through the skin's 10 sliders).
  The visualizer / Milkdrop and the equalizer for Spotify need system-audio capture, which macOS does not
  offer without extra software, so they are Windows-only for now.
- Global hotkeys (Settings to turn off): Ctrl+Alt+Right = next, Ctrl+Alt+Left = previous,
  Ctrl+Alt+Down = play/pause, Ctrl+Alt+W = show/hide the player, Ctrl+Alt+V = show/hide the YouTube video.
- The player remembers its position, size, pin state, skin and equalizer between runs.

Everything (settings, skins, last position) is kept in the "data" folder beside "app", so you can move or
delete the whole folder whenever you like. If the window is hidden, click the Minapp icon in the Dock.

IF SPOTIFY DOESN'T SHOW UP
Start a song in the Spotify desktop app first (it must have played something once), and check the
Automation permission above. A log is kept in the "data" folder (bridge.log).
