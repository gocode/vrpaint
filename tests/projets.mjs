// Contrôle des projets communs au PC et au casque, en headless (rien à l'écran).
//   A : profil 1, http://localhost/VRpaint/   (le PC)
//   B : profil 2, https://localhost/          (le vhost du casque : autre origine, autre navigateur)
// Les deux pages utilisent une collection d'essai à part sur le PC (?projets=essai-…), supprimée à la fin.
// Vérifie :
//   - un projet de B resté dans son navigateur (ancienne version) rejoint la collection du PC ;
//   - le projet peint sur A (mur, devanture, couleurs perso, photo modèle) s'ouvre sur B identique :
//     couches (empreintes SHA-256), couverture de peinture, image du mur ;
//   - B le modifie et l'enregistre : A, qui l'avait ouvert sans y toucher, recharge la nouvelle version ;
//   - modifié des deux côtés à la fois : aucune version n'est perdue (l'une est gardée « … (copie PC) ») ;
//   - renommage et suppression vus de l'autre côté ;
//   - projet téléchargé en fichier .vrpaint, rouvert identique dans un navigateur neuf sans le PC,
//     sans doublon s'il est rouvert deux fois ; fichier tronqué refusé.
//
//   node tests/projets.mjs            (environ 4 min ; PLAYWRIGHT_CORE = chemin de playwright-core si besoin)
//   node tests/projets.mjs --rapide   (mur peint de rayures au lieu de la peinture scriptée)
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pwPath = [process.env.PLAYWRIGHT_CORE, 'playwright-core', 'D:/wamp/www/archinvoice/node_modules/playwright-core']
  .filter(Boolean).find(p => { try { require.resolve(p); return true; } catch { return false; } });
if (!pwPath) { console.error('playwright-core introuvable (variable PLAYWRIGHT_CORE)'); process.exit(2); }
const { chromium } = require(pwPath);

const RES = 1024;   // résolution réduite, la même des deux côtés (sinon l'ouverture rééchantillonne)
const quick = process.argv.includes('--rapide');
const C = 'essai-' + Date.now().toString(36);
const A_URL = `http://localhost/VRpaint/?projets=${C}&res=${RES}${quick ? '' : '&test'}`;
const B_URL = `https://localhost/?projets=${C}&res=${RES}`;

const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
// fenêtre réduite : le rendu logiciel de chaque image est plus court
const ctxA = await browser.newContext({ viewport: { width: 820, height: 420 } });
const ctxB = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 820, height: 420 } });
const A = await ctxA.newPage(), B = await ctxB.newPage();
for (const [n, p] of [['A', A], ['B', B]]) {
  p.on('console', m => { if ((m.type() === 'error' || m.type() === 'warning' || /VRPAINT_CLEAR/.test(m.text())) && !/GL Driver/.test(m.text())) console.log(`[${n}] ${m.text()}`); });
  p.on('pageerror', e => console.log(`[${n}] erreur page : ${e.message}`));
}

let failures = 0;
const check = (ok, what) => { console.log(`${ok ? 'OK   ' : 'ECHEC'} ${what}`); if (!ok) failures++; };
const MIN = 60e3;

// Empreinte du projet ouvert, calculée dans la page
async function signature(page) {
  return page.evaluate(async () => {
    const v = window.__vrpaint;
    const h = async u8 => [...new Uint8Array(await crypto.subtle.digest('SHA-256', u8))].slice(0, 10).map(b => b.toString(16).padStart(2, '0')).join('');
    const layers = await v.surface.exportLayers();
    const out = { id: v.state.projectId, name: v.state.projectName, wall: v.state.wall, size: `${v.state.wallWidth}x${v.state.wallHeight}`,
      colors: JSON.stringify(v.state.savedColors), layers: {}, extra: {}, refs: [] };
    for (const [k, L] of Object.entries(layers)) out.layers[k] = await h(L.data);
    const c = layers.color.data;
    let n = 0;
    for (let i = 3; i < c.length; i += 4) if (c[i]) n++;
    out.coverage = +(n / (c.length / 4)).toFixed(6);
    for (const cv of v.canvases.painted()) out.extra[cv.id] = await h((await cv.surface.exportLayers()).color.data);
    for (const r of v.state.refs || []) out.refs.push(`${r.name}:${await h(new Uint8Array(await r.blob.arrayBuffer()))}`);
    out.image = await h(v.readWall(400, Math.round(400 * v.state.wallHeight / v.state.wallWidth)));
    return out;
  });
}

function same(a, b, what) {
  const keys = ['id', 'name', 'wall', 'size', 'colors', 'coverage', 'image'];
  const diffs = keys.filter(k => a[k] !== b[k]).map(k => `${k}: ${a[k]} ≠ ${b[k]}`);
  const layerDiff = Object.keys(a.layers).filter(k => a.layers[k] !== b.layers[k]);
  if (layerDiff.length) diffs.push(`couches du mur (${layerDiff.join(', ')})`);
  if (JSON.stringify(a.extra) !== JSON.stringify(b.extra)) diffs.push(`devantures ${JSON.stringify(a.extra)} ≠ ${JSON.stringify(b.extra)}`);
  if (JSON.stringify(a.refs) !== JSON.stringify(b.refs)) diffs.push('photos modèles');
  check(!diffs.length, `${what}${diffs.length ? ' — ' + diffs.join(' ; ') : ` (couverture ${(a.coverage * 100).toFixed(2)} %, ${Object.keys(a.extra).length} devanture(s), ${a.refs.length} photo(s))`}`);
}

// Diagnostic : où diffèrent les couches couleur de deux pages
async function explainColor(P, Q) {
  const get = page => page.evaluate(async () => {
    const d = (await window.__vrpaint.surface.exportLayers()).color;
    let s = '';
    for (let i = 0; i < d.data.length; i += 32768) s += String.fromCharCode(...d.data.subarray(i, i + 32768));
    return { w: d.w, b64: btoa(s) };
  });
  const [p, q] = await Promise.all([get(P), get(Q)]);
  const a = Buffer.from(p.b64, 'base64'), b = Buffer.from(q.b64, 'base64');
  let n = 0, max = 0;
  const ex = [];
  for (let i = 0; i < a.length; i += 4) {
    let d = 0;
    for (let k = 0; k < 4; k++) d = Math.max(d, Math.abs(a[i + k] - b[i + k]));
    if (!d) continue;
    n++; max = Math.max(max, d);
    if (ex.length < 6) ex.push(`(${(i / 4) % p.w},${Math.floor(i / 4 / p.w)}) ${[...a.subarray(i, i + 4)]} / ${[...b.subarray(i, i + 4)]}`);
  }
  console.log(`  diagnostic couleur : ${n} texels différents, écart max ${max} ; ${ex.join(' ; ')}`);
}

const ready = page => page.waitForFunction(() => window.__vrpaint?.state.projects, null, { timeout: 2 * MIN, polling: 500 });
const projects = page => page.evaluate(async () => { await window.__vrpaint.actions.refreshProjects(); return window.__vrpaint.state.projects; });
const save = page => page.evaluate(() => window.__vrpaint.actions.save());
async function waitFor(page, fn, arg, what) {
  try { await page.waitForFunction(fn, arg, { timeout: 5 * MIN, polling: 1000 }); } catch { throw new Error(`attente dépassée : ${what}`); }
}
async function stripes(page, rgba) {
  await page.evaluate(async rgba => {
    const s = window.__vrpaint.surface, L = await s.exportLayers();
    for (let i = 0; i < L.color.data.length; i += 4) if (Math.floor(i / 4 / L.color.w) % 50 < 20) L.color.data.set(rgba, i);
    s.importLayers(L);
  }, rgba);
}

try {
  // 1. B, avant la collection commune : un projet resté dans son navigateur
  await B.goto(B_URL + '&local');
  await ready(B);
  await B.evaluate(() => window.__vrpaint.set({ projectName: 'Ancien mur du casque' }));
  await stripes(B, [250, 200, 20, 255]);
  await save(B);
  const localB = await B.evaluate(() => window.__vrpaint.state.projects.map(p => p.name));
  check(localB.includes('Ancien mur du casque'), 'projet enregistré dans le navigateur de B (mode ?local)');

  // 2. A peint, ajoute couleurs perso, photo modèle et une devanture, enregistre
  const t0 = Date.now();
  await A.goto(A_URL);
  if (quick) {
    await ready(A);
    await stripes(A, [40, 120, 230, 255]);
  } else {
    await A.waitForFunction(() => document.title === 'VRPAINT_DONE', null, { timeout: 15 * MIN, polling: 1000 });
  }
  console.log(`${quick ? 'mur peint directement' : 'peinture scriptée terminée'} en ${Math.round((Date.now() - t0) / 1000)} s`);
  await A.evaluate(async () => {
    const v = window.__vrpaint;
    const c = document.createElement('canvas');
    c.width = 320; c.height = 200;
    const g = c.getContext('2d');
    g.fillStyle = '#204080'; g.fillRect(0, 0, 320, 200);
    g.fillStyle = '#ffcc00'; g.font = 'bold 60px sans-serif'; g.fillText('VRpaint', 30, 120);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
    v.set({ projectName: 'Mur commun', savedColors: [{ hex: '#12ab34', finish: 'satin' }, { hex: '#ff00aa', finish: 'fluo' }],
      refs: [{ id: 'rtest', name: 'modele', blob, w: 320, h: 200 }] });
    const s = v.canvases.overlays[0].ensureSurface();
    const L = await s.exportLayers();
    for (let i = 0; i < L.color.data.length; i += 4) if (((i / 4) % L.color.w) % 64 < 24) L.color.data.set([230, 40, 90, 255], i);
    s.importLayers(L);
    await v.actions.save();
  });
  // Référence : le projet tel qu'il est enregistré, rouvert sur A (le mur vivant peut différer
  // d'un arrondi de l'enregistrement, qui se fait à 8 bits par canal).
  const id = await A.evaluate(async () => {
    const v = window.__vrpaint, id = v.state.projectId;
    await v.actions.newProject();
    await v.actions.openProject(id);
    return v.state.projectId === id && id;
  });
  check(!!id, 'projet enregistré sur le PC puis rouvert sur A');
  const sigA = await signature(A);
  check(sigA.coverage > 0.05 && Object.keys(sigA.extra).length === 1, `projet de départ peint (couverture ${(sigA.coverage * 100).toFixed(2)} %)`);

  // 3. B passe à la collection du PC : son ancien projet y est copié, il voit celui de A
  await B.goto(B_URL);
  await ready(B);
  await waitFor(B, () => window.__vrpaint.state.projects.some(p => p.name === 'Ancien mur du casque'), null, 'copie du projet local de B');
  const listB = (await projects(B)).map(p => p.name);
  check(listB.includes('Mur commun') && listB.includes('Ancien mur du casque'), `B voit la collection commune : ${listB.join(', ')}`);
  const listA = (await projects(A)).map(p => p.name);
  check(listA.includes('Ancien mur du casque'), 'A voit le projet venu du navigateur de B');
  check(await B.evaluate(() => document.querySelector('#projects-where').textContent.includes('PC')), 'panneau : « Enregistrés sur le PC »');

  // 4. B ouvre le projet de A depuis sa liste
  await B.click(`[data-project="${id}"]`);
  await waitFor(B, id => window.__vrpaint.state.projectId === id, id, 'ouverture sur B');
  same(sigA, await signature(B), 'projet de A ouvert sur B (autre profil, autre origine)');

  // 5. B le modifie et l'enregistre ; A l'a ouvert sans y toucher : il recharge la nouvelle version
  await B.evaluate(async () => { const v = window.__vrpaint; v.set({ savedColors: [{ hex: '#00ccff', finish: 'brillant' }, ...v.state.savedColors] }); });
  await stripes(B, [255, 255, 255, 255]);
  await save(B);
  const sigB = await signature(B);
  const sigB2 = await signature(B);
  if (JSON.stringify(sigB.layers) !== JSON.stringify(sigB2.layers)) console.log('note : la peinture de B change encore après son enregistrement');
  await projects(A);
  await waitFor(A, colors => JSON.stringify(window.__vrpaint.state.savedColors) === colors, sigB.colors, 'rechargement sur A');
  const sigA2 = await signature(A);
  same(sigB, sigA2, 'version enregistrée sur B rechargée sur A');
  if (sigA2.layers.color !== sigB.layers.color) await explainColor(B, A);

  // 6. Modifié des deux côtés à la fois : aucune version perdue
  const W = await A.evaluate(() => window.__vrpaint.state.wallWidth);
  await A.evaluate(W => window.__vrpaint.resizeWall(W + 1, window.__vrpaint.state.wallHeight), W);   // A : modification en cours
  await B.evaluate(async () => { const v = window.__vrpaint; v.set({ savedColors: [{ hex: '#abcdef', finish: 'mat' }] }); await v.actions.save(); });
  await save(A);
  const all = await projects(B);
  const versions = all.filter(p => p.name.startsWith('Mur commun'));
  const names = versions.map(p => p.name).sort();
  check(versions.length === 2 && names[1] === 'Mur commun (copie PC)', `deux versions gardées : ${names.join(', ')}`);
  check(versions.some(p => p.wallWidth === W + 1) && versions.some(p => p.wallWidth === W && p.savedColors?.[0]?.hex === '#abcdef'),
    'la version de A (mur élargi) et celle de B (nouvelle couleur) sont toutes deux intactes');

  // 7. Renommage et suppression vus de l'autre côté
  await B.evaluate(id => window.__vrpaint.actions.openProject(id), id);
  await waitFor(B, id => window.__vrpaint.state.projectId === id, id, 'réouverture sur B');
  await B.evaluate(() => window.__vrpaint.actions.renameProject('Mur renommé'));
  check((await projects(A)).some(p => p.id === id && p.name === 'Mur renommé'), 'renommage fait sur B visible sur A');
  const old = (await projects(A)).find(p => p.name === 'Ancien mur du casque');
  await A.evaluate(id => window.__vrpaint.actions.deleteProject(id), old.id);
  check(!(await projects(B)).some(p => p.id === old.id), 'suppression faite sur A visible sur B');

  // 8. Fichier .vrpaint : téléchargé sur A, rouvert dans un navigateur neuf sans le PC
  //    (comme la version en ligne, qui ne garde ses projets que dans le navigateur)
  await A.evaluate(id => window.__vrpaint.actions.openProject(id), id);
  await waitFor(A, id => window.__vrpaint.state.projectId === id, id, 'réouverture sur A');
  const sigF = await signature(A);
  const [dl] = await Promise.all([A.waitForEvent('download', { timeout: 5 * MIN }), A.click('[data-action="downloadProject"]')]);
  const file = `tmp/projets-${C}.vrpaint`;
  await dl.saveAs(file);
  check(dl.suggestedFilename() === 'Mur_renommé.vrpaint', `fichier téléchargé : ${dl.suggestedFilename()}`);
  await ctxB.close();   // B ne sert plus : une page de moins à rendre en logiciel
  const ctxD = await browser.newContext({ viewport: { width: 820, height: 420 } });
  const D = await ctxD.newPage();
  D.on('pageerror', e => console.log(`[D] erreur page : ${e.message}`));
  await D.goto(`http://localhost/VRpaint/?local&res=${RES}`, { waitUntil: 'domcontentloaded', timeout: 5 * MIN });
  await ready(D);
  await D.setInputFiles('#project-file', file);
  await waitFor(D, id => window.__vrpaint.state.projectId === id, id, 'ouverture du fichier sur D');
  same(sigF, await signature(D), 'fichier rouvert dans un navigateur neuf, sans le PC');
  check(await D.evaluate(() => document.querySelector('#projects-where').textContent.includes('navigateur')), 'panneau de D : « Enregistrés dans ce navigateur »');
  // le même fichier une seconde fois, ici et sur A : déjà dans la liste, pas de doublon
  await D.setInputFiles('#project-file', file);
  await A.setInputFiles('#project-file', file);
  await A.waitForTimeout(3000);
  const countOf = async P => (await projects(P)).filter(p => p.name.startsWith('Mur renommé')).length;
  check(await countOf(D) === 1 && await countOf(A) === 1, 'fichier rouvert une seconde fois : pas de doublon');
  // fichier abîmé : refusé, rien n'est ajouté
  const fs = await import('node:fs');
  const buf = fs.readFileSync(file);
  await D.setInputFiles('#project-file', { name: 'abime.vrpaint', mimeType: 'application/octet-stream', buffer: buf.subarray(0, buf.length >> 1) });
  await D.waitForTimeout(3000);
  check((await projects(D)).length === 1, 'fichier tronqué refusé');
  fs.rmSync(file, { force: true });
  await ctxD.close();
} catch (e) {
  failures++;
  console.log(`ECHEC ${e.message}`);
  await A.screenshot({ path: 'tmp/projets-A.png' }).catch(() => {});
  await B.screenshot({ path: 'tmp/projets-B.png' }).catch(() => {});   // B peut être déjà fermé
} finally {
  await A.evaluate(c => fetch(`projets.php?projets=${c}&vider`, { method: 'POST' }), C).catch(() => {});
  await browser.close();
}
console.log(failures ? `PROJETS_ECHEC (${failures})` : 'PROJETS_OK');
process.exit(failures ? 1 : 0);
