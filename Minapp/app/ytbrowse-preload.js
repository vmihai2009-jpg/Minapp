const { ipcRenderer } = require('electron');
// A floating button on every youtube.com page: sends the current page (playlist or video) to Minapp to play.
window.addEventListener('DOMContentLoaded', () => {
  const b = document.createElement('button');
  b.textContent = '▶ Play in Minapp';
  b.title = 'Open a playlist or video, then click to play it in Minapp';
  b.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;padding:10px 16px;border:0;border-radius:20px;' +
    'background:#1db954;color:#000;font:600 14px -apple-system,Segoe UI,sans-serif;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.5)';
  b.addEventListener('click', () => ipcRenderer.send('ytb:play', location.href));
  document.documentElement.appendChild(b);
});
