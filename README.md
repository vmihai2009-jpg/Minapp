# Minapp

Project page: `docs/index.html` (published with GitHub Pages: Settings > Pages > Deploy from a branch > `main` / `/docs`).

A Winamp-skinned player that follows the **Spotify** desktop app (and YouTube playlists), built on [Webamp](https://github.com/captbaritone/webamp) and Electron. No install, no admin rights: unzip and run.

| Platform | Download | Start with |
|---|---|---|
| Windows 10/11 | [`docs/downloads/Minapp-Windows-v1.8.0.zip`](docs/downloads/Minapp-Windows-v1.8.0.zip) | `Minapp.exe` |
| macOS (Apple silicon and Intel) | [`docs/downloads/Minapp-Mac-v1.8.0.zip`](docs/downloads/Minapp-Mac-v1.8.0.zip) | `Minapp.app` (right-click > Open the first time) |

The first run downloads about 150 MB (Electron and Webamp) into the folder. Each zip has its own `README.txt`.
<img width="274" height="24" alt="image" src="https://github.com/user-attachments/assets/bec7146f-e738-4000-a393-c02c7b4497ed" />

## Features
- Any Winamp `.wsz` skin, from a skin library menu that fills itself: skins you load, drag onto the player or copy into the skins folder appear in it automatically. The corner logo opens skins.webamp.org to find more. Mini mode, always-on-top pin, 0.5x to 3x size
- Play / pause / next / previous / seek / volume / shuffle / repeat control Spotify
- Playlist window: the playing song, the upcoming queue and the history. Click an upcoming title to jump to it, scroll up and click to go back
- YouTube source (playlists or videos) with an option to hide the video window
- Local library source: import MP3s or a whole folder into playlists (menu > Local library) and play them with the same skin, queue and equalizer
- Windows: working 10-band equalizer for Spotify through [Equalizer APO](https://sourceforge.net/projects/equalizerapo/), real Spotify volume, audio-reactive visualizer and Milkdrop, taskbar buttons, tray menu
- Global hotkeys, snap to screen edges, remembered position and settings, optional song-change notifications
<img width="343" height="435" alt="image" src="https://github.com/user-attachments/assets/9c80b083-01a9-42ab-975f-79c6c6e7aa00" />

## Layout
```
Minapp/app/       shared Electron app (main.js, renderer.js, preload scripts, smtc.ps1 for Windows)
Minapp/windows/   launcher + README for the Windows zip
Minapp/mac/       launcher + README for the Mac zip
Minapp/build.sh   builds both zips into docs/downloads/
```
Rebuild the zips with `Minapp/build.sh` (needs `zip` and `node`).
