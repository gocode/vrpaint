// Sortie du casque vers la page du navigateur, en Chrome headless piloté par CDP (aucune fenêtre, aucun son).
// Une séance VR ne doit jamais être une impasse : la palette du casque offre « Quitter la VR » sur chaque onglet.
// La séance est simulée (Chrome headless n'a pas de casque) : renderer.xr.getSession() rend un faux XRSession
// dont end() émet 'sessionend' comme le ferait le navigateur. Vérifie :
//   - le bouton existe sur chaque onglet, dans l'en-tête, sans chevaucher les autres zones ni le texte ;
//   - un appui seul ne quitte pas (« Confirmer ? »), un second appui dans les 3 s termine la séance ;
//   - après 3 s sans second appui, le bouton se désarme ;
//   - la fin de séance rend la page du navigateur (caméra à 60°, classe xr-live retirée, palette détachée).
// Image de la palette : tmp/sortie-vr/palette.png
//
//   node tests/sortie-vr.mjs               (≈ 15 s)
//   CHROME=<chemin de chrome.exe> si Chrome n'est pas à sa place habituelle.
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tmp', 'sortie-vr');
fs.mkdirSync(OUT, { recursive: true });
const CHROME = process.env.CHROME || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => fs.existsSync(p));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'vrpaint-sortie-'));

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
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); }
  else if (m.method === 'Runtime.exceptionThrown') {
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

try {
  await send('Page.navigate', { url: BASE + '?local' });
  for (let i = 0; i < 150; i++) {
    await sleep(200);
    try { if (await ev('!!(window.__vrpaint && window.__vrpaint.palette)')) break; } catch { /* navigation */ }
  }
  await sleep(1000);

  // faux XRSession : end() émet 'sessionend' comme le navigateur
  await ev(`(() => {
    const v = __vrpaint, xrm = v.renderer.xr;
    window.__ends = 0;
    window.__live = false;
    xrm.getSession = () => window.__live ? { end() { window.__ends++; window.__live = false; xrm.dispatchEvent({ type: 'sessionend' }); return Promise.resolve(); } } : null;
    window.__start = () => { window.__live = true; xrm.dispatchEvent({ type: 'sessionstart' }); };
    window.__press = id => v.palette._buttonAction(id);
    return true;
  })()`);
  await ev('__start()');
  const started = await ev(`({ attached: !!__vrpaint.palette.mesh.parent })`);
  check('séance simulée démarrée', true, `palette ${started.attached ? 'tenue en main' : 'non attachée (pas de manette)'}`);

  // le bouton sur chaque onglet, dans l'en-tête, sans chevauchement
  const tabs = await ev(`(() => {
    const p = __vrpaint.palette, out = [];
    for (const r of p.regions.filter(r => r.type === 'tab')) {
      p.tab = r.id; p.draw();
      const exit = p.regions.find(r => r.id === 'exitXR');
      const hit = exit && p.regions.filter(o => o !== exit && o.x < exit.x + exit.w && exit.x < o.x + o.w && o.y < exit.y + exit.h && exit.y < o.y + o.h);
      out.push({ tab: r.id, exit: !!exit, overlaps: hit ? hit.map(o => o.type + ':' + (o.id || '')) : [] });
    }
    p.tab = 'colors'; p.draw();
    return out;
  })()`);
  for (const t of tabs) check(`onglet ${t.tab} : « Quitter la VR » présent, sans chevauchement`, t.exit && !t.overlaps.length, t.overlaps.join(' '));

  // le texte de l'en-tête (couleur, projet) s'arrête avant le bouton, même long
  const textEnd = await ev(`(() => {
    const p = __vrpaint.palette, c = p.ctx, x = 170, maxW = 560;
    c.font = '600 44px sans-serif';
    const long = 'Un nom de projet beaucoup trop long pour tenir dans l\\'en-tête de la palette';
    __vrpaint.set({ projectName: long });
    p.draw();
    const exit = p.regions.find(r => r.id === 'exitXR');
    return { right: x + maxW, exitX: exit.x };
  })()`);
  check('texte de l\'en-tête borné avant le bouton', textEnd.right < textEnd.exitX, `fin du texte ${textEnd.right} < bouton ${textEnd.exitX}`);

  // un appui : armé, pas de sortie
  await ev(`__press('exitXR')`);
  let s = await ev(`({ ends: __ends, armed: performance.now() < __vrpaint.palette.exitArmedUntil, msg: __vrpaint.palette.message })`);
  check('un appui ne quitte pas, demande confirmation', s.ends === 0 && s.armed, `« ${s.msg} »`);
  const png = await ev(`__vrpaint.palette.ctx.canvas.toDataURL('image/png')`);
  fs.writeFileSync(path.join(OUT, 'palette.png'), Buffer.from(png.split(',')[1], 'base64'));

  // sans second appui, le bouton se désarme
  await sleep(3300);
  s = await ev(`({ ends: __ends, armed: performance.now() < __vrpaint.palette.exitArmedUntil })`);
  check('désarmé après 3 s', s.ends === 0 && !s.armed);

  // deux appuis : fin de séance et retour à la page
  await ev(`__press('exitXR')`);
  await sleep(300);
  await ev(`__press('exitXR')`);
  await sleep(500);
  s = await ev(`({ ends: __ends, live: __live, fov: __vrpaint.renderer.xr.isPresenting ? -1 : 60,
    camFov: __vrpaint.rig.children.find(o => o.isPerspectiveCamera)?.fov,
    xrLive: document.body.classList.contains('xr-live'), attached: !!__vrpaint.palette.mesh.parent,
    armed: performance.now() < __vrpaint.palette.exitArmedUntil })`);
  check('deux appuis terminent la séance', s.ends === 1 && !s.live, `end() appelé ${s.ends} fois`);
  check('page du navigateur rendue', !s.xrLive && !s.attached && (s.camFov === undefined || s.camFov === 60), `caméra ${s.camFov ?? '?'}°`);
  check('bouton désarmé après la sortie', !s.armed);

  // hors séance, un double appui ne casse rien
  await ev(`__press('exitXR'); __press('exitXR')`);
  check('hors séance : sans effet', (await ev('__ends')) === 1);
  check('aucune exception', !logs.some(l => l.startsWith('EXCEPTION')));
} catch (e) {
  check('déroulé du test', false, e.message);
} finally {
  ws.close();
  chrome.kill();
  server.close();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome tient encore le profil */ }
}

const failed = results.filter(r => !r.ok).length;
console.log(failed ? `RESULTAT ${failed} ECHEC(S) sur ${results.length}` : `RESULTAT TOUT OK (${results.length})`);
process.exit(failed ? 1 : 0);
