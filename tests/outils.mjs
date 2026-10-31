// Papier journal et pinceaux, en Chrome headless piloté par CDP (aucune fenêtre, aucun son), GPU par D3D11.
//   outils  : ?test=outils (VRPAINT_OUTILS_*) : le papier ne révèle que la couche sèche, motif net et
//             différent à chaque appui, pression, fraîcheur, frottement ; pinceaux : charge qui s'épuise,
//             traînées de poils, tranche du plat, tailles, couleur ; annulation exacte ; enregistrement ;
//   ui      : panneau du navigateur (boutons d'outil et de taille), touches P et J, vrais gestes de souris
//             (pinceau, papier sur de la peinture, Ctrl+Z), onglet Outils de la palette VR (régions, appuis) ;
//   touch   : téléphone émulé : un doigt peint au pinceau, pincer règle la pression ;
//   caches  : ?test=caches toujours bon (annulation exacte, enregistrement).
//
//   node tests/outils.mjs            (≈ 3 min ; phases au choix : outils ui touch caches)
//   CHROME=<chemin de chrome.exe> si Chrome n'est pas à sa place habituelle.
// Images dans tmp/outils/.
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tmp', 'outils');
fs.mkdirSync(OUT, { recursive: true });
const PHASES = process.argv.slice(2).length ? process.argv.slice(2) : ['outils', 'ui', 'touch', 'caches'];
const CHROME = process.env.CHROME || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => fs.existsSync(p));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'vrpaint-outils-'));

// serveur statique du dépôt, sur un port libre (sans PHP : projets dans le navigateur)
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

const results = [];
const check = (name, ok, info = '') => { results.push({ name, ok }); console.log(`${ok ? 'OK   ' : 'ECHEC'} ${name} ${info}`); };

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
    if (/VRPAINT_(OUTILS|UNDO|SAVE|TEST outils|TEST erreur|TEST gestes)|Error|erreur/i.test(line)) console.log('  [console] ' + line.slice(0, 300));
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
const saveShots = async prefix => {
  const shots = await ev('JSON.stringify((window.__vrpaintShots || []).map(s => [s.name, s.url]))');
  for (const [name, url] of JSON.parse(shots)) fs.writeFileSync(path.join(OUT, `${prefix}${name}.png`), Buffer.from(url.split(',')[1], 'base64'));
};
const screenshot = async name => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
};
// attend la fin d'un ?test (titre VRPAINT_DONE) en laissant la page tourner
async function runPageTest(url, minutes) {
  logs.length = 0;
  await send('Page.navigate', { url });
  const t0 = Date.now();
  while (Date.now() - t0 < minutes * 60e3) {
    await sleep(1000);
    if (logs.some(l => l.startsWith('EXCEPTION'))) break;   // page cassée : inutile d'attendre
    try { if ((await ev('document.title')) === 'VRPAINT_DONE') break; } catch { /* navigation */ }
  }
  await sleep(500);
}

async function phaseOutils() {
  console.log('--- ?test=outils ---');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await runPageTest(BASE + '?test=outils', 10);
  const expected = ['PAPIER_REVELE', 'PAPIER_NET', 'PAPIER_CHAQUE_APPUI', 'PAPIER_PRESSION', 'PAPIER_FRAIS', 'PAPIER_FOND_INTACT',
    'PAPIER_FROTTE', 'PINCEAU_CHARGE', 'PINCEAU_POILS', 'PINCEAU_COULEUR', 'PINCEAU_PLAT_TRANCHE', 'PINCEAU_TAILLES', 'UNDO', 'ENREGISTRE'];
  for (const name of expected) {
    const line = logs.find(l => l.startsWith(`VRPAINT_OUTILS_${name} `));
    check(name, / OK /.test(line || ''), line ? line.slice(`VRPAINT_OUTILS_${name} `.length) : 'absent');
  }
  check('?test=outils sans erreur', !logs.some(l => l.startsWith('EXCEPTION') || /VRPAINT_TEST erreur/.test(l)));
  await saveShots('');
}

const mouse = (type, x, y, button = 'none', buttons = 0, modifiers = 0) => send('Input.dispatchMouseEvent', { type, x, y, button, buttons, modifiers, clickCount: type === 'mouseMoved' ? 0 : 1, pointerType: 'mouse' });
const key = (code, k, vk, modifiers = 0) => send('Input.dispatchKeyEvent', { type: 'rawKeyDown', code, key: k, windowsVirtualKeyCode: vk, modifiers })
  .then(() => send('Input.dispatchKeyEvent', { type: 'keyUp', code, key: k, windowsVirtualKeyCode: vk, modifiers }));
const clickEl = async sel => {
  const r = await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'center' }); const b = e.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; })()`);
  if (!r) return false;
  await mouse('mouseMoved', r[0], r[1]);
  await mouse('mousePressed', r[0], r[1], 'left', 1);
  await mouse('mouseReleased', r[0], r[1], 'left', 0);
  await sleep(150);
  return true;
};
const drag = async (x0, y0, x1, y1, n = 15, ms = 20) => {
  await mouse('mouseMoved', x0, y0);
  await mouse('mousePressed', x0, y0, 'left', 1);
  for (let i = 1; i <= n; i++) { await mouse('mouseMoved', x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n, 'left', 1); await sleep(ms); }
  await mouse('mouseReleased', x1, y1, 'left', 0);
  await sleep(300);
};
// image du mur : 2 cm par pixel (5 mm pour le papier journal, dont les plaques font un centimètre)
const paintBase = (w = 400, h = 150) => ev(`(() => { window.__base = __vrpaint.readWall(${w}, ${h}); return true; })()`);
const paintDiff = (w = 400, h = 150) => ev(`(() => { const a = window.__base, b = __vrpaint.readWall(${w}, ${h}); let n = 0;
  for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i]-b[i]) + Math.abs(a[i+1]-b[i+1]) + Math.abs(a[i+2]-b[i+2]) > 24) n++; return n; })()`);
const hist = () => ev('__vrpaint.history.count');
const tool = () => ev('__vrpaint.state.tool');

async function phaseUI() {
  console.log('--- PC 1280 × 800 : panneau, souris, clavier, palette VR ---');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await load(BASE);
  await ev(`__vrpaint.set({ tool: 'bombe', distance: 0.15, pressure: 1, angle: 0, brushSizes: {} }), true`);
  for (const id of ['pinceau-rond', 'pinceau-plat', 'journal']) {
    await clickEl(`[data-tool="${id}"]`);
    check(`panneau : bouton ${id}`, (await tool()) === id);
  }
  await clickEl('[data-tool="pinceau-plat"]');
  check('panneau : tailles du pinceau plat affichées, pas celles du rond', await ev(`!document.querySelector('[data-brush-opts="pinceau-plat"]').hidden && document.querySelector('[data-brush-opts="pinceau-rond"]').hidden && !document.getElementById('brush-help').hidden`));
  await clickEl('[data-brush="pinceau-plat"][data-size="0.08"]');
  check('panneau : taille 8 cm', (await ev('__vrpaint.state.brushSizes["pinceau-plat"]')) === 0.08);
  check('HUD du pinceau', /Pinceau plat 8 cm/.test(await ev(`document.getElementById('hud').textContent`)), await ev(`document.getElementById('hud').textContent`));
  await mouse('mouseMoved', 640, 400);
  await key('KeyP', 'p', 80);
  check('touche P : pinceau rond ⇄ plat', (await tool()) === 'pinceau-rond');
  await key('KeyJ', 'j', 74);
  check('touche J : papier journal', (await tool()) === 'journal');

  // vrais gestes de souris
  await key('KeyB', 'b', 66);
  await ev(`(() => { const d = __vrpaint.desktop; d.yaw = 0; d.pitch = -0.1; return true; })()`);
  await sleep(200);
  await paintBase();
  let h0 = await hist();
  // un seul geste en zigzag : sous lui, le « fond » est le mur (sous un 2e trait, ce serait le 1er)
  await mouse('mouseMoved', 480, 380);
  await mouse('mousePressed', 480, 380, 'left', 1);
  for (let k = 0; k <= 80; k++) {
    const u = k / 80, x = 480 + 320 * (1 - Math.abs((u * 4) % 2 - 1)), y = 380 + 40 * u;
    await mouse('mouseMoved', x, y, 'left', 1);
    await sleep(25);
  }
  await mouse('mouseReleased', 480, 420, 'left', 0);
  await sleep(300);
  check('bombe : un aplat à frotter', (await paintDiff()) > 200 && (await hist()) === h0 + 1);
  await sleep(4200);   // la peinture « prend » un peu
  await paintBase(1600, 600);
  h0 = await hist();
  await key('KeyJ', 'j', 74);
  await mouse('mouseMoved', 560, 395);
  await mouse('mousePressed', 560, 395, 'left', 1);
  await sleep(250);
  await mouse('mouseReleased', 560, 395, 'left', 0);
  await sleep(300);
  const tap = await paintDiff(1600, 600);
  check('papier journal : un clic tamponne (un geste annulable)', tap > 0 && (await hist()) === h0 + 1, `pixels=${tap}`);
  await drag(600, 400, 760, 395, 20, 25);
  const rub = await paintDiff(1600, 600);
  check('papier journal : glisser frotte', rub > tap && (await hist()) === h0 + 2, `pixels=${rub}`);
  await key('KeyZ', 'z', 90, 2);
  await key('KeyZ', 'z', 90, 2);
  await sleep(300);
  check('Ctrl+Z ×2 : le papier est annulé', (await paintDiff(1600, 600)) === 0);
  await key('KeyP', 'p', 80);
  await mouse('mouseMoved', 520, 470);
  await sleep(300);
  check('pinceau en main sous le pointeur', await ev(`__vrpaint.brush.meshes.get(__vrpaint.state.tool).visible && !__vrpaint.world.can.visible`));
  await paintBase();
  h0 = await hist();
  await drag(500, 470, 820, 470, 30, 20);
  const br = await paintDiff();
  check('pinceau : un trait (un geste annulable)', br > 10 && (await hist()) === h0 + 1, `pixels=${br}`);
  await screenshot('pc-pinceau.png');
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 640, y: 400, deltaX: 0, deltaY: 100 });
  await sleep(100);
  check('molette : pression du pinceau', Math.abs((await ev('__vrpaint.state.pressure')) - 0.95) < 1e-6);

  // palette du casque : onglet Outils
  const pal = await ev(`(() => {
    const v = __vrpaint, P = v.palette, out = { tools: [], overlaps: [], outside: [], sizes: 0 };
    P.tab = 'tools';
    for (const t of ['bombe', 'pinceau-rond', 'pinceau-plat', 'cache', 'couteau', 'journal']) {
      v.set({ tool: t });
      P.draw();
      const R = P.regions.filter(r => r.y > 216 && r.y < 1296);
      if (t === 'bombe') out.tools = P.regions.filter(r => r.type === 'tool').map(r => r.id);
      for (const a of R) {
        if (a.x < 0 || a.x + a.w > 1024 || a.y + a.h > 1290) out.outside.push(t + ':' + (a.id || a.type));
        for (const b of R) if (a !== b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) out.overlaps.push(t + ':' + (a.id || a.type));
      }
      if (t === 'pinceau-rond') {
        const r = P.regions.find(r => r.type === 'brushSize' && r.size === 0.05);
        out.sizes = P.regions.filter(r => r.type === 'brushSize').length;
        P.press({ region: r });
        out.sized = v.state.brushSizes['pinceau-rond'];
      }
    }
    P.press({ region: P.regions.find(r => r.type === 'tool' && r.id === 'pinceau-plat') });
    out.pressed = v.state.tool;
    return out;
  })()`);
  check('palette VR : les 8 outils', ['bombe', 'pinceau-rond', 'pinceau-plat', 'cache', 'couteau', 'spatule', 'grattoir', 'journal'].every(id => pal.tools.includes(id)), pal.tools.join(','));
  check('palette VR : rien ne se chevauche ni ne déborde sur les caps', !pal.overlaps.length && !pal.outside.length, [...pal.overlaps, ...pal.outside].join(' '));
  check('palette VR : 3 tailles, appui = taille choisie', pal.sizes === 3 && pal.sized === 0.05);
  check('palette VR : appui sur un outil', pal.pressed === 'pinceau-plat');
  await ev(`(() => { const c = __vrpaint.palette.canvas; window.__pal = c.toDataURL('image/png'); return true; })()`);
  fs.writeFileSync(path.join(OUT, 'palette-outils.png'), Buffer.from((await ev('window.__pal')).split(',')[1], 'base64'));
  check('aucune exception', !logs.some(l => l.startsWith('EXCEPTION')));
}

async function phaseTouch() {
  console.log('--- tactile (téléphone 412 × 915) ---');
  await send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36' });
  await load(BASE);
  await ev(`__vrpaint.set({ tool: 'pinceau-plat', touchPinch: 'largeur', pressure: 0.5, angle: 90 }), true`);
  await sleep(300);
  const touch = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y, id]) => ({ x, y, id, radiusX: 8, radiusY: 8, force: 1 })) });
  const slide = async (from, to, n = 12, ms = 240) => {
    for (let i = 1; i <= n; i++) {
      await touch('touchMove', from.map((p, k) => [p[0] + (to[k][0] - p[0]) * i / n, p[1] + (to[k][1] - p[1]) * i / n, p[2]]));
      await sleep(ms / n);
    }
  };
  await paintBase();
  const h0 = await hist();
  await touch('touchStart', [[120, 470, 1]]);
  await slide([[120, 470, 1]], [[300, 480, 1]], 14, 400);
  await touch('touchEnd', []);
  await sleep(400);
  const n = await paintDiff();
  check('un doigt : trait de pinceau', n > 5 && (await hist()) === h0 + 1, `pixels=${n}`);
  await touch('touchStart', [[156, 600, 2], [256, 600, 3]]);
  await slide([[156, 600, 2], [256, 600, 3]], [[106, 600, 2], [306, 600, 3]]);
  const bubble = await ev(`document.getElementById('touch-bubble').textContent`);
  await touch('touchEnd', []);
  await sleep(200);
  check('pincer : pression du pinceau', Math.abs((await ev('__vrpaint.state.pressure')) - 1) < 0.06 && /^Pression/.test(bubble), `« ${bubble} »`);
  await screenshot('telephone-pinceau.png');
  check('aucune exception', !logs.some(l => l.startsWith('EXCEPTION')));
  await send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await send('Emulation.clearDeviceMetricsOverride');
  await send('Emulation.setUserAgentOverride', { userAgent: '' });
}

async function phaseCaches() {
  console.log('--- ?test=caches ---');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await runPageTest(BASE + '?test=caches', 10);
  for (const name of ['VRPAINT_UNDO_CHECK', 'VRPAINT_UNDO_ALL_CHECK', 'VRPAINT_SAVE_CHECK']) {
    const line = logs.find(l => l.startsWith(name + ' '));
    check(name, / OK/.test(line || ''), line || 'absent');
  }
  check('?test=caches sans erreur', !logs.some(l => l.startsWith('EXCEPTION') || /VRPAINT_TEST erreur/.test(l)));
}

try {
  for (const p of PHASES) await { outils: phaseOutils, ui: phaseUI, touch: phaseTouch, caches: phaseCaches }[p]();
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
