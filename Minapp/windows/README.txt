MINAPP for Windows - no install, no admin

1. Unzip this folder anywhere you can write to (Desktop, Documents, a USB stick).
2. Double-click "Minapp.exe" (it has the Minapp icon). "Start Minapp.bat" does the same if you prefer it.
   Neither needs an admin password. Windows may say "Windows protected your PC" because the file is new and
   unsigned: click More info > Run anyway. Minapp then puts a "Minapp" shortcut on your Desktop and in the Start
   menu. START IT FROM THOSE SHORTCUTS: they run the engine directly, which carries no "downloaded from the
   internet" mark, so Windows never shows that screen again (it only shows for a freshly unzipped Minapp.exe).
   The shortcut can be pinned to the taskbar. If you move the folder, run Minapp.exe once to refresh them. To avoid even the first message: before unzipping, right-click the
   zip > Properties > tick Unblock > OK, then unzip. (The first run shows a progress window while it downloads; after that no console window appears.)
   - First run downloads about 150 MB into this folder (needs internet, once only).
   - If Windows says "Windows protected your PC", click More info > Run anyway.
     (Or right-click the zip before unzipping > Properties > tick Unblock.)
3. Open the Spotify desktop app and play something. The skin follows it.

BUTTONS: Previous / Play / Pause / Stop / Next, Shuffle, Repeat and the position bar all control the
active source (Shuffle and Repeat follow Spotify's own switches). Eject opens the menu.

MENU: click the skin's O button (top-left) or right-click the player. The same menu is in the TRAY
ICON (bottom-right, maybe under the ^ arrow); clicking the tray icon shows/hides the player.
It has: Source (Spotify / YouTube), Open Spotify, Playlist, Equalizer window, Milkdrop, Mini mode,
Skins, Pin on top, Size (0.5x to 3x), Equalizer sound, Visualizer, Spotify queue, Settings and Quit.
SKINS: Skins in the menu lists your skin library (the "skins" folder inside "data"). It fills itself: every skin
you load (Skins > Load skin from file), drag onto the player, or copy into that folder (Skins > Open skins folder)
appears in the list within a second. Click one to use it; "Minapp (default skin)" brings back the built-in look.
Click the Minapp logo in the bottom-right corner (or Skins > Get more skins) to open skins.webamp.org in your
browser, download a .wsz and drop it on the player. Every skin you load is
kept in data\skins and listed under Skins (with a Random skin button).

IF SPOTIFY DOESN'T SHOW UP
Tray icon > Check Spotify Connection. It tells you how the player is talking to Spotify, what it
sees, whether volume control works and whether Equalizer APO was found. Start a song in the Spotify
desktop app first (it must have played something once). A log is kept in the "data" folder
(bridge.log) - send it if you need help.

EQUALIZER SOUND (tray icon > Equalizer Sound)
- SPOTIFY: needs Equalizer APO, a free system-wide equalizer (https://sourceforge.net/projects/equalizerapo/).
  Install it, tick your speakers/headphones in its Configurator, restart Spotify, then choose
  "Equalizer sound". The skin's 10 sliders + preamp now change what you hear, live, with no delay.
  Minapp adds one "Include: minapp_eq.txt" line to Equalizer APO's config.txt (a backup,
  config.txt.minapp.bak, is made) and resets the EQ to flat when you quit.
  Without Equalizer APO you can pick an experimental mode that records the PC's sound and replays it
  through the EQ. It can go silent or squeal on some setups; turn it off from the same menu.
- YOUTUBE: the video's sound goes through the skin's EQ automatically, no extra software.
- The EQ window's ON button bypasses it, and pressing it again switches the equalizer sound back on. Your slider settings are remembered.

VISUALIZER / MILKDROP
"Visualizer follows the music" (on by default) listens to what the PC plays (it never mutes or
changes it), so the spectrum bars and Milkdrop move with the music. Turn it off in the menu if you
would rather not have the capture running.

VOLUME
The skin's volume slider now sets Spotify's own volume (per-app volume in Windows) and follows it when
you change it in Spotify. When the Spotify equalizer is on, the slider is the output level of the EQ.

PIN, QUEUE, TASKBAR
- The LEFT of the three top-right buttons on the skin pins the player above all other apps
  (it turns green while pinned). Same switch: tray icon > Pin on Top.
- Open the playlist (PL) window to see the current song and what's coming up. CLICK AN UPCOMING TITLE
  to jump to it (Spotify: the player skips ahead to it; YouTube: plays it directly). Adding, removing
  and reordering stay disabled.
  SCROLL UP in the playlist to see what you already played (history) and click one to go back to it.
  History starts when the player starts; for YouTube it is the part of the playlist before the video.
  YouTube playlists work straight away. For Spotify: tray icon > Connect Spotify Queue... (one-time
  setup with a free Spotify developer app; the account that creates it needs Premium).
- The taskbar button shows the song, with Previous / Play-Pause / Next buttons on its preview.
- Global hotkeys (Settings to turn off): Ctrl+Alt+Right = next, Ctrl+Alt+Left = previous,
  Ctrl+Alt+Down = play/pause, Ctrl+Alt+W = show/hide the player, Ctrl+Alt+V = show/hide the YouTube video.
- YouTube video: untick "Show YouTube video" in the menu to hear it without the window (it keeps playing).
  Videos whose owner switched embedding off cannot be played by any app: Minapp skips them
  (a note shows at the bottom of the video window) and logs them in data/bridge.log. YouTube Mixes are always
  playable; a normal playlist must be public or unlisted. YouTube asks that its player stays visible, so this is your own choice.
- Settings also has: Snap to screen edges, Song-change notifications, Start with Windows.
- The player remembers its position, size, pin state, skin and equalizer between runs.

Everything (settings, skins, last position) is kept in the "data" folder beside "app", so you can
move or delete the whole folder whenever you like. (If you use Start with Windows and then move the
folder, switch it off and on again once.) The only thing outside it is Equalizer APO's config line.

WINDOWS LIMITS
- Dragging the position bar depends on your Spotify version; it may be ignored.
- Needs the Spotify DESKTOP app (Microsoft Store or normal version), not the web player.
