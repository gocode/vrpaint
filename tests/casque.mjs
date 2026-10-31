// Commandes du casque, en Chrome headless piloté par CDP (aucune fenêtre, aucun son). Chrome headless n'a pas
// de casque : la séance et les manettes sont simulées (faux XRSession, fausses manettes xr-standard).
//
// Sortie vers la page du navigateur — une séance VR ne doit jamais être une impasse :
//   - « Quitter la VR » existe sur chaque onglet de la palette, dans l'en-tête ;
//   - un appui seul ne quitte pas (« Confirmer ? »), un second appui dans les 3 s termine la séance,
//     et sans second appui le bouton se désarme ;
//   - la fin de séance rend la page du navigateur (caméra à 60°, classe xr-live retirée, palette détachée).
// Palette : sur aucun onglet deux zones cliquables ne se chevauchent ; le texte de l'en-tête reste avant le bouton.
// Main de la palette : joystick = avancer ; gâchette + joystick ↑↓ = largeur du jet (ou taille du cache)
//   sans bouger, ←→ = couleur suivante ; gâchette latérale = tirer le monde ; clic du joystick = face au mur.
// Projections : décochées, le trait reste intact à pleine gâchette et ne crachote plus à mi-gâchette.
// Image de la palette : tmp/casque/palette.png
//
//   node tests/casque.mjs                  (≈ 20 s)
//   CHROME=<chemin de chrome.exe> si Chrome n'est pas à sa place habituelle.
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tmp', 'casque');
fs.mkdirSync(OUT, { recursive: true });
const CHROME = process.env.CHROME || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => fs.existsSync(p));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'vrpaint-casque-'));

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

  // --- palette : aucune zone cliquable n'en chevauche une autre, sur aucun onglet -------------
  const layout = await ev(`(() => {
    const p = __vrpaint.palette, out = [];
    const tabs = p.regions.filter(r => r.type === 'tab').map(r => r.id);
    for (const tab of tabs) {
      p.tab = tab; p.draw();
      const R = p.regions, bad = [];
      for (let i = 0; i < R.length; i++) for (let j = i + 1; j < R.length; j++) {
        const a = R[i], b = R[j];
        if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) bad.push((a.id || a.type) + '/' + (b.id || b.type));
        }
      const out1 = R.filter(r => r.x < 0 || r.y < 0 || r.x + r.w > 1024 || r.y + r.h > 1600).map(r => r.id || r.type);
      out.push({ tab, n: R.length, bad: bad.concat(out1.map(s => s + ' hors palette')) });
    }
    p.tab = 'settings'; p.draw();
    return out;
  })()`);
  for (const t of layout) check(`onglet ${t.tab} : ${t.n} zones, aucune ne se chevauche`, !t.bad.length, t.bad.slice(0, 6).join(' '));
  fs.writeFileSync(path.join(OUT, 'reglages.png'), Buffer.from((await ev(`__vrpaint.palette.ctx.canvas.toDataURL('image/png')`)).split(',')[1], 'base64'));
  let r = await ev(`(() => { const v = __vrpaint, b = v.palette.regions.find(r => r.id === 'spatter'); const was = v.state.spatter;
    v.palette._buttonAction('spatter'); const now = v.state.spatter, sprayNow = v.spray.spatter; v.palette._buttonAction('spatter');
    return { exists: !!b, was, now, sprayNow, back: v.state.spatter }; })()`);
  check('Réglages : bouton « Projections » qui bascule la bombe', r.exists && r.was && !r.now && !r.sprayNow && r.back, JSON.stringify(r));

  // --- main de la palette (manette gauche simulée) --------------------------------------------
  await ev(`(() => {
    const v = __vrpaint, xr = v.xr, h = xr.hands[0];
    const btn = () => ({ pressed: false, touched: false, value: 0 });
    window.__pad = { axes: [0, 0, 0, 0], buttons: [btn(), btn(), btn(), btn(), btn(), btn()], hapticActuators: [] };
    h.src = { handedness: 'left', gamepad: __pad };
    xr.palHand = h; xr.canHand = null;
    window.__btn = (i, on) => { __pad.buttons[i].pressed = on; __pad.buttons[i].value = on ? 1 : 0; };
    window.__stick = (x, y) => { __pad.axes[2] = x; __pad.axes[3] = y; };
    window.__run = n => { for (let i = 0; i < n; i++) xr.update(1 / 60); };
    window.__pos = () => { const p = v.rig.position; return [p.x, p.y, p.z]; };
    v.set({ tool: 'bombe', capScale: 1, paint: v.PAINTS ? v.PAINTS[0] : v.state.paint });
    return true;
  })()`);
  r = await ev(`(() => { const a = __pos(); __stick(0, -1); __run(30); __stick(0, 0); __run(1); const b = __pos();
    return { moved: Math.hypot(b[0] - a[0], b[2] - a[2]) }; })()`);
  check('joystick gauche seul : on avance', r.moved > 0.3, `${r.moved.toFixed(2)} m en 0,5 s`);
  r = await ev(`(() => { const s0 = __vrpaint.state.capScale, a = __pos(); __btn(0, true); __stick(0, -1); __run(40); __stick(0, 0); __run(1);
    const s1 = __vrpaint.state.capScale; __stick(0, 1); __run(80); __stick(0, 0); __run(1); const s2 = __vrpaint.state.capScale; const b = __pos(); __btn(0, false); __run(1);
    return { s0, s1, s2, moved: Math.hypot(b[0] - a[0], b[2] - a[2]) }; })()`);
  check('gâchette gauche + ↑ : jet plus large, sans bouger', r.s1 > r.s0 && r.moved < 1e-6, `${r.s0} → ${r.s1}`);
  check('gâchette gauche + ↓ : jet plus fin, par crans de 5 %', r.s2 < r.s1 && Math.abs(r.s2 * 20 - Math.round(r.s2 * 20)) < 1e-9, `${r.s1} → ${r.s2}`);
  r = await ev(`(() => { const id0 = __vrpaint.state.paint.id; __btn(0, true);
    __stick(1, 0); __run(3); __stick(0, 0); __run(3); __stick(1, 0); __run(3); __stick(0, 0); __run(3); const id2 = __vrpaint.state.paint.id;
    __stick(-1, 0); __run(3); __stick(0, 0); __run(3); const id1 = __vrpaint.state.paint.id; __btn(0, false); __run(1);
    return { id0, id1, id2, msg: __vrpaint.palette.message }; })()`);
  check('gâchette gauche + → → ← : deux couleurs plus loin, puis une en arrière', r.id0 !== r.id2 && r.id1 !== r.id2 && r.id1 !== r.id0, `${r.id0} → ${r.id2} → ${r.id1} « ${r.msg} »`);
  r = await ev(`(() => { const v = __vrpaint; v.set({ tool: 'cache', maskSize: 0.15 }); __btn(0, true); __stick(0, -1); __run(40); __stick(0, 0); __btn(0, false); __run(1);
    const s = v.state.maskSize, cap = v.state.capScale; v.set({ tool: 'bombe' }); return { s, msg: v.palette.message }; })()`);
  check('avec les caches : gâchette gauche + ↑ agrandit le prochain cache', r.s > 0.15, `${r.s} m « ${r.msg} »`);
  r = await ev(`(() => { const v = __vrpaint; v.set({ tool: 'pinceau-rond', brushSizes: {} }); const cap = v.state.capScale;
    const size = () => v.state.brushSizes['pinceau-rond'] ?? 'défaut';
    __btn(0, true); __stick(0, -1); __run(20); const up1 = size(); __stick(0, 0); __run(2); __stick(0, -1); __run(5); const up2 = size(); __stick(0, 0); __run(2);
    __stick(0, -1); __run(5); const up3 = size(); __stick(0, 0); __run(2); __stick(0, 1); __run(5); const down = size(); __stick(0, 0); __btn(0, false); __run(1);
    const res = { up1, up2, up3, down, capSame: v.state.capScale === cap, msg: v.palette.message }; v.set({ tool: 'bombe' }); return res; })()`);
  check('avec un pinceau : gâchette gauche + ↑ ↓ change de taille, un cran par poussée', r.up1 === 0.05 && r.up2 === 0.05 && r.up3 === 0.05 && r.down === 0.025 && r.capSame,
    `${r.up1} → ${r.up2} → ${r.up3} → ${r.down} « ${r.msg} »`);
  r = await ev(`(() => { const v = __vrpaint, h = v.xr.hands[0], P = new v.rig.position.constructor();
    h.grip.position.set(0, 1, -0.3); h.grip.updateMatrix(); __btn(1, true); __run(1);
    h.grip.updateMatrixWorld(true); h.grip.getWorldPosition(P); const anchor = P.clone(), a = __pos();
    h.grip.position.set(0.25, 0.9, -0.3); h.grip.updateMatrix(); __run(1); h.grip.updateMatrixWorld(true); h.grip.getWorldPosition(P);
    const drift = P.distanceTo(anchor), b = __pos(); __btn(1, false); __run(1); h.grip.position.set(0, 0, 0); h.grip.updateMatrix();
    return { drift, moved: Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) }; })()`);
  check('gâchette latérale gauche : la main tient le monde', r.drift < 1e-6 && Math.abs(r.moved - Math.hypot(0.25, 0.1)) < 0.02, `déplacé de ${r.moved.toFixed(3)} m, main dérivée de ${r.drift.toExponential(1)} m`);
  r = await ev(`(() => { const v = __vrpaint, W = v.world.wallFrame; v.rig.position.x += 1.3; v.rig.position.z += 2; v.rig.rotation.y += 0.9; v.rig.updateMatrixWorld(true);
    __btn(3, true); __run(1); __btn(3, false); __run(1);
    const P = v.rig.position.clone(), D = P.clone(); const cam = v.renderer.xr.getCamera ? null : null;
    const c = v.rig.children.find(o => o.isPerspectiveCamera); c.getWorldPosition(P); c.getWorldDirection(D);
    return { dz: P.z - (W.corner.z), dirx: D.x, dirz: D.z }; })()`);
  check('clic du joystick gauche : face au mur, à 85 cm', Math.abs(r.dz - 0.85) < 0.01 && Math.abs(r.dirx) < 0.01 && r.dirz < 0, `à ${r.dz.toFixed(3)} m, regard (${r.dirx.toFixed(3)}, ${r.dirz.toFixed(3)})`);
  await ev(`(() => { const v = __vrpaint; v.xr.hands[0].src = null; v.xr.palHand = null; __start = null; return true; })()`);

  // --- projections ------------------------------------------------------------------------
  // Trait horizontal de 2 m, à `d` du mur et à pression `p` constante. « Loin » : à plus de 0,3 × d de
  // l'axe (4,5 cm à 15 cm du mur), au-delà du nuage du trait. La gâchette du Quest est analogique :
  // chaque début et chaque fin de trait passe par une pression faible, où la bombe crachote.
  const spatterRun = (on, pressure, dist) => ev(`(async () => {
    const v = __vrpaint, f = v.world.wallFrame, W = 4000, H = Math.round(W * v.state.wallHeight / v.state.wallWidth);
    const FAR = 0.3 * ${dist};
    v.set({ spatter: ${on}, tool: 'bombe', cap: 'standard', capScale: 1, drips: false });
    await new Promise(r => setTimeout(r, 300));
    const base = v.readWall(W, H);
    const T = v.rig.position.constructor, inp = { pressure: ${pressure}, origin: new T(), dir: new T(), right: new T(), up: new T() };
    const y0 = 1.5, x0 = v.state.wallWidth / 2 - 1;
    for (let i = 0; i <= 120; i++) {
      inp.origin.copy(f.corner).addScaledVector(f.ex, x0 + 2 * i / 120).addScaledVector(f.ey, y0).addScaledVector(f.n, ${dist});
      inp.dir.copy(f.n).negate(); inp.right.copy(f.ex); inp.up.copy(f.ey);
      v.spray.update(1 / 60, inp);
    }
    inp.pressure = 0; v.spray.update(1 / 60, inp);
    await new Promise(r => setTimeout(r, 600));
    const img = v.readWall(W, H), px = v.state.wallWidth / W;   // m par pixel
    let far = 0, near = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (Math.abs(img[i] - base[i]) + Math.abs(img[i + 1] - base[i + 1]) + Math.abs(img[i + 2] - base[i + 2]) < 30) continue;
      const wy = (H - 0.5 - y) * px, wx = (x + 0.5) * px;
      if (wx < x0 - FAR || wx > x0 + 2 + FAR || Math.abs(wy - y0) > FAR) far++; else near++;
    }
    v.actions.clear(); v.set({ spatter: true, drips: true });
    await new Promise(r => setTimeout(r, 300));
    return { far, near };
  })()`);
  // (à pleine gâchette, le halo d'overspray reste sous le seuil de détection : rien à comparer loin du trait)
  const cases = { plein: [1, 0.15], moitie: [0.35, 0.15] }, S = {};
  for (const [k, [pr, d]] of Object.entries(cases)) {
    S[k] = { on: await spatterRun(true, pr, d), off: await spatterRun(false, pr, d) };
    console.log(`  ${k} (gâchette ${pr * 100} %, ${d * 100} cm) : avec ${S[k].on.near} dans le trait / ${S[k].on.far} loin ; sans ${S[k].off.near} / ${S[k].off.far}`);
  }
  check('sans projections : trait intact à pleine gâchette', S.plein.off.near > S.plein.on.near * 0.9 && S.plein.off.far <= S.plein.on.far,
    `${S.plein.off.near} pixels contre ${S.plein.on.near}`);
  check('sans projections : la gâchette à moitié ne crachote plus', S.moitie.on.near > 1.8 * S.moitie.off.near,
    `${S.moitie.on.near} pixels peints avec, ${S.moitie.off.near} sans`);
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
