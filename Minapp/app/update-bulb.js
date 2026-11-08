// A small glowing light bulb in the top-left of the player when a newer Minapp is on GitHub. Click: install it.
const PX = [ // 9 x 12 pixel art: Y glass, H highlight, O outline, B base, D dark base
  '..OOOOO..',
  '.OYYYYYO.',
  'OYHHYYYYO',
  'OYHYYYYYO',
  'OYYYYYYYO',
  'OYYYYYYYO',
  '.OYYYYYO.',
  '..OYYYO..',
  '..BBBBB..',
  '..DDDDD..',
  '..BBBBB..',
  '...DDD...',
];
const COL = { Y: '#ffe23a', H: '#fffbe0', O: '#b88a00', B: '#c8c8c8', D: '#6e6e6e' };
const svg = () => {
  let r = '';
  PX.forEach((row, y) => [...row].forEach((c, x) => { if (COL[c]) r += `<rect x="${x}" y="${y}" width="1" height="1" fill="${COL[c]}"/>`; }));
  return `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="9" height="12" shape-rendering="crispEdges">${r}</svg>`)}")`;
};

export function initUpdateBulb(api) {
  const style = document.createElement('style');
  style.textContent = `
#update-bulb { position: absolute; left: 22px; top: 1px; width: 9px; height: 12px; z-index: 60; cursor: pointer;
  background: ${svg()} no-repeat; image-rendering: pixelated; animation: bulb-glow 1.6s ease-in-out infinite; }
#update-bulb:hover { filter: brightness(1.2) drop-shadow(0 0 3px #fff36a) drop-shadow(0 0 6px #ffd400); }
#update-bulb:active { transform: translateY(1px); }
@keyframes bulb-glow {
  0%, 100% { filter: drop-shadow(0 0 1px #ffd400); }
  50% { filter: drop-shadow(0 0 3px #fff36a) drop-shadow(0 0 5px #ffd400); }
}
html.widget-small #update-bulb { display: none; }`;
  document.head.appendChild(style);
  let bulb = null, version = null;
  const place = () => {
    const main = document.querySelector('#main-window');
    if (!version || !main) { if (bulb) bulb.remove(); bulb = null; return; }
    if (!bulb || bulb.parentElement !== main) {
      bulb = bulb || document.createElement('div');
      bulb.id = 'update-bulb';
      bulb.addEventListener('mousedown', (e) => e.stopPropagation(), true); // not a window drag
      bulb.onclick = (e) => { e.stopPropagation(); api.updateInstall(); };
      main.appendChild(bulb);
    }
    bulb.title = `Minapp ${version} is ready: click to update`;
  };
  api.onUpdate((v) => { version = v || null; place(); });
  setInterval(place, 1000); // the skin re-renders the main window when it changes
  api.updateGet().then((v) => { version = v || null; place(); }).catch(() => {});
}
