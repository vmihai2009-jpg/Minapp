# Minapp

Project page: `docs/index.html` (published with GitHub Pages: Settings > Pages > Deploy from a branch > `main` / `/docs`).

A Winamp-skinned player that follows the **Spotify** desktop app (and YouTube playlists), built on [Webamp](https://github.com/captbaritone/webamp) and Electron. No install, no admin rights: unzip and run.

| Platform | Download | Start with |
|---|---|---|
| Windows 10/11 | [`docs/downloads/Minapp-Windows-v1.0.2.zip`](docs/downloads/Minapp-Windows-v1.0.2.zip) | `Start Minapp.bat` |
| macOS (Apple silicon and Intel) | [`docs/downloads/Minapp-Mac-v1.0.2.zip`](docs/downloads/Minapp-Mac-v1.0.2.zip) | `Start Minapp.command` (right-click > Open the first time) |

The first run downloads about 150 MB (Electron and Webamp) into the folder. Each zip has its own `README.txt`.

## Features
- Any Winamp `.wsz` skin (drag one on, keep a library, random skin), mini mode, always-on-top pin, 1x to 3x size
- Play / pause / next / previous / seek / volume / shuffle / repeat control Spotify
- Playlist window: the playing song, the upcoming queue and the history. Click an upcoming title to jump to it, scroll up and click to go back
- YouTube source (playlists or videos) with an option to hide the video window
- Windows: working 10-band equalizer for Spotify through [Equalizer APO](https://sourceforge.net/projects/equalizerapo/), real Spotify volume, audio-reactive visualizer and Milkdrop, taskbar buttons, tray menu
- Global hotkeys, snap to screen edges, remembered position and settings, optional song-change notifications

## Layout
```
Minapp/app/       shared Electron app (main.js, renderer.js, preload scripts, smtc.ps1 for Windows)
Minapp/windows/   launcher + README for the Windows zip
Minapp/mac/       launcher + README for the Mac zip
Minapp/build.sh   builds both zips into docs/downloads/
```
Rebuild the zips with `Minapp/build.sh` (needs `zip` and `node`).
