// Navigation tactile et souris, en Chrome headless piloté par CDP (aucune fenêtre, aucun son).
// Sur un téléphone émulé (412 × 915, événements Input.dispatchTouchEvent), vérifie :
//   - deux doigts posés à 50 ms d'écart qui glissent : la vue tourne, rien n'est peint ;
//   - pincer : largeur du jet (bulle « Jet 200 % »), sans tourner la vue ; un glisser imparfait ne la change pas ;
//   - un doigt : un trait qui part du point de contact ; une tape : un point ;
//   - croix (avancer, se décaler, reculer) et nacelle ; la croix maintenue fait redessiner l'image ;
//   - réglages « glisser le long du mur » et « pincer pour avancer » ; caches : taille et angle au pincement ;
//   - panneau ouvert sur petit écran : pas de zoom de page, toucher la scène le referme sans peindre ;
//   - la croix est entière à l'écran et ne recouvre pas le HUD.
// Puis la souris et le clavier du PC (inchangés), puis ?test (VRPAINT_CLEAR_CHECK, VRPAINT_ORDER_CHECK).
//
//   node tests/tactile.mjs                 (≈ 1 min ; phases au choix : touch mouse test)
//   CHROME=<chemin de chrome.exe> si Chrome n'est pas à sa place habituelle.
// Il faut le GPU : en rendu logiciel, une image prend des secondes et les délais des gestes n'ont plus de sens.
// Avec CDP, touchMove ne relâche pas un doigt omis : touchEnd relâche les points qu'on lui passe.
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tmp', 'tactile');
fs.mkdirSync(OUT, { recursive: true });
const PHASES = process.argv.slice(2).length ? process.argv.slice(2) : ['touch', 'mouse', 'test'];
const CHROME = process.env.CHROME || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => fs.existsSync(p));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'vrpaint-tactile-'));

// serveur statique du dépôt, sur un port libre
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (err, data) => {
    if (err) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(data);
  });
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;

const chrome = spawn(CHROME, [
  '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
  ...(process.platform === 'win32' ? ['--use-angle=d3d11'] : []), '--enable-gpu', '--ignore-gpu-blocklist',
  '--no-first-run', '--no-default-browser-check', '--mute-audio', '--disable-notifications', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });

let results = [];
const check = (name, ok, info = '') => { results.push({ name, ok }); console.log(`${ok ? 'OK   ' : 'ECHEC'} ${name} ${info}`); };

// Chrome annonce son port de débogage sur stderr
async function connect() {
  const browserWs = await new Promise((resolve, reject) => {
    let buf = '';
    chrome.stderr.on('data', d => { buf += d; const m = /DevTools listening on (ws:\S+)/.exec(buf); if (m) resolve(m[1]); });
    setTimeout(() => reject(new Error('Chrome injoignable')), 15000);
  });
  const port = new URL(browserWs).port;
  for (let i = 0; i < 50; i++) {
    const page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page');
    if (page) return page.webSocketDebuggerUrl;
    await sleep(200);
  }
  throw new Error('aucun onglet');
}

const ws = new WebSocket(await connect());
await new Promise(r => ws.addEventListener('open', r, { once: true }));
let seq = 0;
const pending = new Map();
const logs = [];
ws.addEventListener('message', ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); }
  else if (m.method === 'Runtime.consoleAPICalled') {
    const line = m.params.args.map(a => a.value ?? a.description ?? '').join(' ');
    logs.push(line);
    if (/VRPAINT|Error|erreur/i.test(line)) console.log('  [console] ' + line.slice(0, 300));
  } else if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    console.log('  [exception] ' + (d.exception?.description || d.text).slice(0, 400));
    logs.push('EXCEPTION ' + (d.exception?.description || d.text));
  }
});
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
const ev = async expr => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
await send('Runtime.enable');
await send('Page.enable');

async function load(url) {
  await send('Page.navigate', { url });
  for (let i = 0; i < 150; i++) {
    await sleep(200);
    try { if (await ev('!!(window.__vrpaint && window.__vrpaint.frames)')) break; } catch { /* navigation */ }
  }
  await sleep(1500);
}

// --- Doigts --------------------------------------------------------------------
const touch = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y, id]) => ({ x, y, id, radiusX: 8, radiusY: 8, force: 1 })) });
// glisse les points de a vers b en n pas
async function slide(from, to, n = 12, ms = 240) {
  for (let i = 1; i <= n; i++) {
    const u = i / n;
    await touch('touchMove', from.map((p, k) => [p[0] + (to[k][0] - p[0]) * u, p[1] + (to[k][1] - p[1]) * u, p[2]]));
    await sleep(ms / n);
  }
}
const snap = () => ev(`(() => { const v = __vrpaint, d = v.desktop;
  return { yaw: d.yaw, pitch: d.pitch, x: v.rig.position.x, y: v.rig.position.y, z: v.rig.position.z,
    capScale: v.state.capScale, maskSize: v.state.maskSize, hist: v.history.count, down: d.down,
    masks: v.stencils.count(), scale: visualViewport.scale, scrollY, bubble: document.getElementById('touch-bubble')?.textContent,
    panel: document.body.classList.contains('panel-open'), drawn: v.frames.drawn }; })()`);
// image du mur réduite (200 × 75 : 4 cm par pixel sur un mur de 8 m ; 800 × 300 pour un point isolé)
const paintBase = (w = 200, h = 75) => ev(`(() => { window.__base = __vrpaint.readWall(${w}, ${h}); return true; })()`);
const paintDiff = (w = 200, h = 75) => ev(`(() => { const a = window.__base, b = __vrpaint.readWall(${w}, ${h}); let n = 0;
  for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i]-b[i]) + Math.abs(a[i+1]-b[i+1]) + Math.abs(a[i+2]-b[i+2]) > 24) n++; return n; })()`);
const shot = async name => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
};

async function phaseTouch() {
  console.log('--- tactile (téléphone 412 × 915, Android) ---');
  await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36' });
  await load(BASE);
  await ev(`__vrpaint.set({ capScale: 1, touchDrag: 'regarder', touchPinch: 'largeur', touchPad: true, tool: 'bombe', aim: true }), true`);
  await sleep(300);
  check('classe touch (pointer: coarse)', await ev(`document.body.classList.contains('touch')`));
  check('croix affichée, entière, sans chevaucher le HUD', await ev(`(() => { const p = document.getElementById('touch-pad'), r = p.getBoundingClientRect(), h = document.getElementById('hud').getBoundingClientRect();
    return getComputedStyle(p).display === 'flex' && r.left >= 0 && r.right <= innerWidth && r.bottom <= h.top; })()`), await ev(`JSON.stringify(document.getElementById('touch-pad').getBoundingClientRect())`));
  await paintBase();
  let s0 = await snap();

  // A. Deux doigts, posés à 50 ms d'écart (le cas de la peinture parasite), qui glissent de 150 px vers la droite
  await touch('touchStart', [[180, 450, 1]]);
  await sleep(50);
  await touch('touchStart', [[180, 450, 1], [240, 450, 2]]);
  await slide([[180, 450, 1], [240, 450, 2]], [[330, 450, 1], [390, 450, 2]]);
  await touch('touchEnd', [[390, 450, 2]]);    // un doigt se lève (CDP : touchEnd relâche les points cités)…
  await slide([[330, 450, 1]], [[250, 380, 1]], 6, 100);   // …l'autre glisse encore : rien ne doit se passer
  await touch('touchEnd', []);
  await sleep(300);
  let s = await snap(), paint = await paintDiff();
  const expYaw = 150 * (60 * Math.PI / 180) / 915;
  check('2 doigts : la vue tourne (regarder)', Math.abs(s.yaw - s0.yaw - expYaw) < 0.03, `dyaw=${(s.yaw - s0.yaw).toFixed(3)} attendu≈${expYaw.toFixed(3)}`);
  check('2 doigts : pas de peinture', paint === 0 && s.hist === s0.hist, `pixels=${paint} hist=${s0.hist}→${s.hist}`);
  check('2 doigts : pas de zoom navigateur', s.scale === 1 && s.scrollY === 0, `scale=${s.scale}`);

  // A2. Deux doigts qui descendent : la vue monte (on attrape le décor)
  s0 = s;
  await touch('touchStart', [[170, 420, 3], [250, 420, 4]]);
  await slide([[170, 420, 3], [250, 420, 4]], [[170, 520, 3], [250, 520, 4]]);
  await touch('touchEnd', []);
  await sleep(200);
  s = await snap();
  check('2 doigts vers le bas : la vue se lève', s.pitch - s0.pitch > 0.08, `dpitch=${(s.pitch - s0.pitch).toFixed(3)}`);

  // B. Pincer (écarter de 100 à 200 px) : largeur du jet ×2, sans tourner la vue
  s0 = s;
  await touch('touchStart', [[156, 460, 5], [256, 460, 6]]);
  await slide([[156, 460, 5], [256, 460, 6]], [[106, 460, 5], [306, 460, 6]]);
  s = await snap();
  await shot('pincement.png');
  await touch('touchEnd', []);
  await sleep(200);
  const s1 = await snap();
  check('pincer : largeur ×2', Math.abs(s1.capScale - 2) < 0.06, `capScale=${s1.capScale}`);
  check('pincer : bulle affichée', /^Jet 200 %/.test(s.bubble || ''), `« ${s.bubble} »`);
  check('pincer : vue immobile, pas de peinture', Math.abs(s1.yaw - s0.yaw) < 1e-6 && s1.hist === s0.hist && (await paintDiff()) === 0);
  check('pincer : pas de zoom navigateur', s1.scale === 1);

  // B2. Resserrer de 200 à 50 px : ÷4
  await touch('touchStart', [[106, 460, 7], [306, 460, 8]]);
  await slide([[106, 460, 7], [306, 460, 8]], [[181, 460, 7], [231, 460, 8]]);
  await touch('touchEnd', []);
  await sleep(200);
  s = await snap();
  check('resserrer : largeur ÷4', Math.abs(s.capScale - 0.5) < 0.06, `capScale=${s.capScale}`);
  await ev(`__vrpaint.set({ capScale: 1 }), true`);

  // C. Glisser à deux doigts qui s'écartent un peu (15 px) : reste un glisser, la largeur ne bouge pas
  s0 = await snap();
  await touch('touchStart', [[170, 450, 9], [250, 450, 10]]);
  await slide([[170, 450, 9], [250, 450, 10]], [[100, 450, 9], [195, 450, 10]]);
  await touch('touchEnd', []);
  await sleep(200);
  s = await snap();
  check('glisser imparfait : largeur inchangée', s.capScale === 1 && Math.abs(s.yaw - s0.yaw) > 0.05, `capScale=${s.capScale} dyaw=${(s.yaw - s0.yaw).toFixed(3)}`);

  // D. Un doigt : un trait, qui part bien du point de contact
  await ev(`(() => { const d = __vrpaint.desktop; d.yaw = 0; d.pitch = -0.1; return true; })()`);
  await sleep(200);
  await paintBase();
  s0 = await snap();
  const startWall = await ev(`(() => { const d = __vrpaint.desktop, r = d.canvas.getBoundingClientRect();
    const h = d.hitAt({ x: 150 / r.width * 2 - 1, y: -(430 / r.height) * 2 + 1 }); return h && h.canvas.id === 'mur' ? [h.x, h.y] : null; })()`);
  await touch('touchStart', [[150, 430, 11]]);
  await sleep(30);
  await slide([[150, 430, 11]], [[270, 430, 11]], 15, 300);
  await sleep(100);
  await touch('touchEnd', []);
  await sleep(400);
  s = await snap();
  paint = await paintDiff();
  check('1 doigt : un trait', paint > 10 && s.hist === s0.hist + 1, `pixels=${paint} hist=${s0.hist}→${s.hist}`);
  const startPainted = startWall && await ev(`(() => { const W = __vrpaint.wallCanvas.width, H = __vrpaint.wallCanvas.height;
    const a = window.__base, b = __vrpaint.readWall(200, 75), cx = Math.round(${startWall[0]} / W * 200), cy = Math.round((1 - ${startWall[1]} / H) * 75);
    for (let y = cy - 1; y <= cy + 1; y++) for (let x = cx - 1; x <= cx + 1; x++) { const i = (y * 200 + x) * 4;
      if (Math.abs(a[i]-b[i]) + Math.abs(a[i+1]-b[i+1]) + Math.abs(a[i+2]-b[i+2]) > 24) return true; } return false; })()`);
  check('1 doigt : le trait part du point de contact', !!startPainted, `point=${startWall?.map(v => v.toFixed(2))}`);
  check('1 doigt : gâchette relâchée', !s.down);

  // E. Tape brève : un point
  s0 = s;
  await paintBase(800, 300);
  await touch('touchStart', [[206, 520, 12]]);
  await sleep(30);
  await touch('touchEnd', []);
  await sleep(300);
  s = await snap();
  paint = await paintDiff(800, 300);
  check('tape : un point', paint > 0 && s.hist === s0.hist + 1 && !s.down, `pixels=${paint} hist=${s0.hist}→${s.hist}`);

  // F. Croix : avancer (pouce en haut, immobile) ; l'image doit suivre sans événement pointer
  const cross = await ev(`(() => { const r = document.querySelector('#touch-pad .cross').getBoundingClientRect(); return [r.left, r.top, r.width]; })()`);
  const [cl, ct, cw] = cross;
  s0 = await snap();
  await sleep(600);
  const idle0 = (await snap()).drawn; await sleep(500); const idle = (await snap()).drawn - idle0;
  await touch('touchStart', [[cl + cw / 2, ct + 8, 13]]);
  await sleep(300);
  const d0 = (await snap()).drawn;
  await sleep(500);
  const d1 = await snap();
  await shot('croix.png');
  await touch('touchEnd', []);
  await sleep(200);
  s = await snap();
  check('croix : avance vers le mur', s0.z - s.z > 0.5 && Math.abs(s.x - s0.x) < 0.05, `dz=${(s.z - s0.z).toFixed(2)} m dx=${(s.x - s0.x).toFixed(3)}`);
  check('croix maintenue : images redessinées', d1.drawn - d0 >= 15, `${d1.drawn - d0} images en 0,5 s (au repos : ${idle})`);
  check('croix : pas de peinture', s.hist === s0.hist);
  // à droite, en diagonale avant-droite
  s0 = s;
  await touch('touchStart', [[cl + cw - 6, ct + cw / 2, 14]]);
  await sleep(400);
  await touch('touchEnd', []);
  await sleep(100);
  s = await snap();
  check('croix : se décale à droite', s.x - s0.x > 0.3 && Math.abs(s.z - s0.z) < 0.05, `dx=${(s.x - s0.x).toFixed(2)}`);
  // recul
  s0 = s;
  await touch('touchStart', [[cl + cw / 2, ct + cw - 6, 15]]);
  await sleep(400);
  await touch('touchEnd', []);
  await sleep(100);
  s = await snap();
  check('croix : recule', s.z - s0.z > 0.3, `dz=${(s.z - s0.z).toFixed(2)}`);

  // G. Nacelle
  const up = await ev(`(() => { const r = document.querySelector('#touch-pad [data-lift="1"]').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
  s0 = s;
  await touch('touchStart', [[up[0], up[1], 16]]);
  await sleep(500);
  await touch('touchEnd', []);
  await sleep(100);
  s = await snap();
  check('⤒ : la nacelle monte', s.y - s0.y > 0.3, `dy=${(s.y - s0.y).toFixed(2)}`);
  check('⤒ : bouton relâché', await ev(`__vrpaint.desktop.touch.pad.lift === 0`));

  // H. Réglage « glisser le long du mur »
  await ev(`(() => { const v = __vrpaint; v.desktop.reset(); v.set({ touchDrag: 'glisser' }); return true; })()`);
  await sleep(200);
  s0 = await snap();
  await touch('touchStart', [[220, 450, 17], [300, 450, 18]]);
  await slide([[220, 450, 17], [300, 450, 18]], [[120, 500, 17], [200, 500, 18]]);
  await touch('touchEnd', []);
  await sleep(200);
  s = await snap();
  check('glisser le long du mur : se décale (droite) et monte', s.x - s0.x > 0.3 && s.y - s0.y > 0.1 && Math.abs(s.yaw - s0.yaw) < 1e-6, `dx=${(s.x - s0.x).toFixed(2)} dy=${(s.y - s0.y).toFixed(2)}`);

  // I. Réglage « pincer pour avancer »
  await ev(`__vrpaint.set({ touchDrag: 'regarder', touchPinch: 'avancer' }), true`);
  s0 = await snap();
  await touch('touchStart', [[156, 460, 19], [256, 460, 20]]);
  await slide([[156, 460, 19], [256, 460, 20]], [[106, 460, 19], [306, 460, 21 - 1]]);
  s = await snap();
  await touch('touchEnd', []);
  const camD = d => d - (-1);
  check('pincer (avancer) : distance au mur ÷2', Math.abs(camD(s.z) - camD(s0.z) / 2) < 0.15 && s.capScale === 1, `${camD(s0.z).toFixed(2)} → ${camD(s.z).toFixed(2)} m, bulle « ${s.bubble} »`);
  await ev(`(() => { const v = __vrpaint; v.desktop.reset(); v.set({ touchPinch: 'largeur', tool: 'cache', maskSize: 0.15 }); return true; })()`);
  await sleep(300);

  // J. Caches : une tape pose un cache ; pincer dessus l'agrandit, tourner le fait pivoter
  s0 = await snap();
  await touch('touchStart', [[206, 470, 22]]);
  await sleep(30);
  await touch('touchEnd', []);
  await sleep(300);
  s = await snap();
  check('caches : une tape pose un cache', s.masks === s0.masks + 1, `caches=${s.masks}`);
  const r0 = await ev(`__vrpaint.wallCanvas.masks.at(-1).r`);
  await touch('touchStart', [[176, 470, 23], [236, 470, 24]]);
  // écarte à 120 px en tournant de 30°
  const a = 30 * Math.PI / 180;
  await slide([[176, 470, 23], [236, 470, 24]], [[206 - 60 * Math.cos(a), 470 - 60 * Math.sin(a), 23], [206 + 60 * Math.cos(a), 470 + 60 * Math.sin(a), 24]]);
  s = await snap();
  await touch('touchEnd', []);
  await sleep(900);
  const m = await ev(`(() => { const m = __vrpaint.wallCanvas.masks.at(-1); return { r: m.r, rot: m.rot }; })()`);
  check('caches : pincer agrandit le cache touché', Math.abs(m.r / r0 - 2) < 0.1, `r ${r0.toFixed(3)} → ${m.r.toFixed(3)}, bulle « ${s.bubble} »`);
  check('caches : tourner le fait pivoter', Math.abs(m.rot + a) < 0.05, `rot=${(m.rot * 180 / Math.PI).toFixed(1)}°`);
  check('caches : un seul pas d\'annulation pour le geste', (await snap()).hist === s0.hist + 2, `hist=${s0.hist}→${(await snap()).hist}`);
  await ev(`__vrpaint.set({ tool: 'bombe' }), true`);

  // K. Panneau ouvert sur petit écran : pincer dessus ne zoome pas, toucher la scène le referme sans peindre
  await touch('touchStart', [[32, 32, 25]]);
  await sleep(40);
  await touch('touchEnd', []);
  await sleep(400);
  check('☰ ouvre le panneau', (await snap()).panel);
  await touch('touchStart', [[100, 500, 26], [200, 500, 27]]);
  await slide([[100, 500, 26], [200, 500, 27]], [[50, 500, 26], [260, 500, 27]]);
  await touch('touchEnd', []);
  await sleep(300);
  s0 = await snap();
  check('pincer sur le panneau : pas de zoom de page', s0.scale === 1, `scale=${s0.scale}`);
  await paintBase();
  await touch('touchStart', [[370, 500, 28]]);
  await slide([[370, 500, 28]], [[370, 600, 28]], 6, 200);
  await touch('touchEnd', []);
  await sleep(400);
  s = await snap();
  check('toucher la scène referme le panneau sans peindre', !s.panel && s.hist === s0.hist && (await paintDiff()) === 0, `panel=${s.panel} hist=${s0.hist}→${s.hist}`);
  await shot('telephone.png');
  check('aucune exception', !logs.some(l => l.startsWith('EXCEPTION')));
  await send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await send('Emulation.clearDeviceMetricsOverride');
  await send('Emulation.setUserAgentOverride', { userAgent: '' });
}

// --- Souris et clavier : inchangés -------------------------------------------------
async function phaseMouse() {
  console.log('--- souris (PC 1280 × 800) ---');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await load(BASE);
  await ev(`__vrpaint.set({ tool: 'bombe', distance: 0.15 }), true`);
  check('PC : pas de croix ni de section tactile', await ev(`getComputedStyle(document.getElementById('touch-pad')).display === 'none' && getComputedStyle(document.querySelector('.touch-only')).display === 'none'`));
  const mouse = (type, x, y, button = 'none', buttons = 0) => send('Input.dispatchMouseEvent', { type, x, y, button, buttons, clickCount: type === 'mouseMoved' ? 0 : 1, pointerType: 'mouse' });
  let s0 = await snap();
  await mouse('mouseMoved', 700, 400);
  await mouse('mousePressed', 700, 400, 'right', 2);
  for (let i = 1; i <= 10; i++) { await mouse('mouseMoved', 700 + i * 10, 400, 'right', 2); await sleep(16); }
  await mouse('mouseReleased', 800, 400, 'right', 0);
  await sleep(200);
  let s = await snap();
  check('clic droit + glisser : regarde (yaw −0,4)', Math.abs(s.yaw - s0.yaw + 0.4) < 0.01, `dyaw=${(s.yaw - s0.yaw).toFixed(3)}`);
  await ev(`(() => { const d = __vrpaint.desktop; d.yaw = 0; d.pitch = -0.1; return true; })()`);
  await sleep(200);
  await paintBase();
  s0 = await snap();
  await mouse('mouseMoved', 640, 420);
  await mouse('mousePressed', 640, 420, 'left', 1);
  for (let i = 1; i <= 15; i++) { await mouse('mouseMoved', 640 + i * 8, 420, 'left', 1); await sleep(20); }
  await mouse('mouseReleased', 760, 420, 'left', 0);
  await sleep(400);
  s = await snap();
  const paint = await paintDiff();
  check('clic gauche : peint immédiatement', paint > 10 && s.hist === s0.hist + 1, `pixels=${paint}`);
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 700, y: 400, deltaX: 0, deltaY: 100 });
  await sleep(100);
  check('molette : distance au mur', Math.abs(await ev('__vrpaint.state.distance') - +(0.15 * Math.exp(0.12)).toFixed(3)) < 1e-6);
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', code: 'KeyW', key: 'w', windowsVirtualKeyCode: 87 });
  await sleep(400);
  await send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyW', key: 'w', windowsVirtualKeyCode: 87 });
  s0 = s; s = await snap();
  check('Z/W : avance', s0.z - s.z > 0.3, `dz=${(s.z - s0.z).toFixed(2)}`);
  check('aucune exception', !logs.some(l => l.startsWith('EXCEPTION')));
}

async function phaseTest() {
  console.log('--- ?test ---');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  logs.length = 0;
  await send('Page.navigate', { url: BASE + '?test' });
  const t0 = Date.now();
  while (Date.now() - t0 < 480000) {
    await sleep(1000);
    if (logs.some(l => /VRPAINT_ORDER_CHECK/.test(l)) && logs.some(l => /VRPAINT_CLEAR_CHECK/.test(l))) break;
  }
  const clear = logs.find(l => /VRPAINT_CLEAR_CHECK/.test(l)), order = logs.find(l => /VRPAINT_ORDER_CHECK/.test(l));
  check('VRPAINT_CLEAR_CHECK', / OK/.test(clear || ''), clear || 'absent');
  check('VRPAINT_ORDER_CHECK', / OK/.test(order || ''), order || 'absent');
  check('aucune exception', !logs.some(l => l.startsWith('EXCEPTION')));
}

try {
  for (const p of PHASES) await { touch: phaseTouch, mouse: phaseMouse, test: phaseTest }[p]();
} catch (e) {
  console.log('ECHEC script ' + (e.stack || e));
  results.push({ ok: false });
} finally {
  const bad = results.filter(r => !r.ok).length;
  console.log(bad ? `RESULTAT ${bad} échec(s) sur ${results.length}` : `RESULTAT TOUT OK (${results.length})`);
  try { await send('Browser.close'); } catch { /* fermé */ }
  chrome.kill();
  server.close();
  setTimeout(() => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* verrou */ } process.exit(bad ? 1 : 0); }, 800);
}
