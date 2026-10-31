// Projets enregistrés.
// Servi par le PC (WAMP : http://localhost/VRpaint/, https://<IP du PC>/ dans le casque),
// le jeu range ses projets sur le PC, par projets.php : une seule collection, la même
// pour le PC et le casque. Sinon (version en ligne, sans PHP, ou ?local), dans le
// navigateur (IndexedDB) :
//   meta     : nom, date, mur (type, taille), couleurs perso, vignette
//   projects : couches de peinture compressées gzip (lourdes, lues au chargement seulement)
// La version 1 n'avait qu'une sauvegarde automatique : elle devient un projet.
import { encodeProject, decodeProject } from './projectfile.js';

const DB = 'vrpaint', VERSION = 2;
const params = new URLSearchParams(location.search);
// ?projets=<nom> : collection à part sur le PC (tests automatiques)
const API = 'projets.php?' + (params.get('projets') ? `projets=${encodeURIComponent(params.get('projets'))}&` : '');
const DEVICE = /OculusBrowser|Quest|Pico/i.test(navigator.userAgent) ? 'casque' : 'PC';
const MIGRATED_KEY = 'vrpaint.projetsSurLePC';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = e => {
      const db = req.result, tx = req.transaction;
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects');
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
      if (e.oldVersion === 1 && db.objectStoreNames.contains('works')) {
        const old = tx.objectStore('works').get('autosave');
        old.onsuccess = () => {
          const rec = old.result;
          if (rec) {
            const id = 'p' + (rec.date || Date.now());
            tx.objectStore('projects').put({ layers: rec.layers }, id);
            tx.objectStore('meta').put({ id, name: 'Mon premier mur', date: rec.date || Date.now(), wall: rec.wall || 'briques', wallWidth: 6, wallHeight: 3, savedColors: [] }, id);
          }
          db.deleteObjectStore('works');
        };
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(stores, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    const out = fn(...[].concat(stores).map(s => t.objectStore(s)));
    t.oncomplete = () => { db.close(); resolve(out && 'result' in out ? out.result : out); };
    t.onerror = () => { db.close(); reject(t.error); };
  });
}

// --- Où sont les projets ---------------------------------------------------------
let server = null;
function onServer() {
  if (params.has('local')) return Promise.resolve(false);
  return server ??= fetch(API + 'liste', { cache: 'no-cache' })
    .then(r => r.ok && /json/.test(r.headers.get('content-type') || ''))
    .catch(() => false);
}
let where = null;
// 'pc' (collection commune au PC et au casque), 'navigateur', ou null tant qu'on ne sait pas
export function projectsWhere() { return where; }

async function call(query, init = {}) {
  const r = await fetch(API + query, { cache: 'no-cache', ...init });
  if (!r.ok) {
    const err = new Error((await r.json().catch(() => ({}))).erreur || `HTTP ${r.status}`);
    err.status = r.status;
    throw err;
  }
  return r;
}

// Date de la version de chaque projet sur laquelle cet appareil travaille : le PC
// refuse un enregistrement fait sur une version dépassée (projet enregistré entre-temps
// sur l'autre appareil), qui est alors gardé à part au lieu d'écraser l'autre.
const bases = new Map();

async function gzip(u8) {
  const stream = new Blob([u8]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Response(stream).blob();
}

async function gunzip(blob) {
  const stream = blob.stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function newProjectId() {
  return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export async function listProjects() {
  const pc = await onServer();
  where = pc ? 'pc' : 'navigateur';
  const all = pc ? await (await call('liste')).json() : await tx('meta', 'readonly', s => s.getAll());
  return (all || []).sort((a, b) => b.date - a.date);
}

async function pack(layers) {
  const out = {};
  for (const [k, L] of Object.entries(layers)) out[k] = { w: L.w, h: L.h, blob: await gzip(L.data) };
  return out;
}

// La décompression contrôle aussi l'intégrité (CRC du gzip, taille attendue).
async function unpack(layers) {
  const out = {};
  for (const [k, L] of Object.entries(layers)) {
    const data = await gunzip(L.blob);
    if (data.length !== L.w * L.h * 4) throw new Error('couche de peinture abîmée');
    out[k] = { w: L.w, h: L.h, data };
  }
  return out;
}

async function putOnServer(meta, data, base) {
  const q = base == null ? '' : `base=${base}`;
  await call(q, { method: 'PUT', body: encodeProject({ meta, data }), headers: { 'Content-Type': 'application/octet-stream' } });
  bases.set(meta.id, meta.date);
}

// layers : mur principal ; extra : { idDevanture: couches } ; refs : modèles photo (Blob)
// Rend la méta enregistrée : son id et son nom changent si la version a dû être gardée à part.
export async function saveProject({ id, layers, extra = {}, refs = [], ...meta }) {
  const data = { layers: await pack(layers), extra: {}, refs };
  for (const [cid, L] of Object.entries(extra)) data.extra[cid] = await pack(L);
  const record = { ...meta, id, date: Date.now(), refCount: refs.length };
  if (!await onServer()) {
    await tx(['projects', 'meta'], 'readwrite', (p, m) => { p.put(data, id); m.put(record, id); });
    return record;
  }
  try {
    await putOnServer(record, data, bases.get(id));
    return record;
  } catch (e) {
    if (e.status !== 409) throw e;
    const copy = { ...record, id: newProjectId(), name: `${record.name} (copie ${DEVICE})` };
    await putOnServer(copy, data, null);
    return copy;
  }
}

export async function renameProject(id, name) {
  if (await onServer()) {
    await call(`renommer=${encodeURIComponent(id)}`, { method: 'POST', body: name });
    return;
  }
  const meta = await tx('meta', 'readonly', s => s.get(id));
  if (meta) await tx('meta', 'readwrite', s => s.put({ ...meta, name }, id));
}

export async function loadProject(id) {
  let rec;
  if (await onServer()) {
    const r = await fetch(`${API}id=${encodeURIComponent(id)}`, { cache: 'no-cache' });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    rec = await decodeProject(await r.blob());
  } else {
    rec = await getLocal(id);
    if (!rec) return null;
  }
  const { meta, data } = rec;
  const extra = {};
  for (const [cid, L] of Object.entries(data.extra || {})) extra[cid] = await unpack(L);
  const out = { ...meta, layers: await unpack(data.layers), extra, refs: data.refs || [] };
  bases.set(id, meta.date);
  return out;
}

export async function deleteProject(id) {
  if (await onServer()) await call(`supprimer=${encodeURIComponent(id)}`, { method: 'POST' });
  else await tx(['projects', 'meta'], 'readwrite', (p, m) => { p.delete(id); m.delete(id); });
  bases.delete(id);
}

async function getLocal(id) {
  const [meta, data] = await Promise.all([
    tx('meta', 'readonly', s => s.get(id)),
    tx('projects', 'readonly', s => s.get(id)),
  ]);
  return meta && data ? { meta, data } : null;
}

// Projets faits avant la collection commune, restés dans ce navigateur : copiés une
// fois sur le PC (ceux qui y sont déjà ne bougent pas). Ils restent aussi dans le
// navigateur, en secours. Rend le nombre de projets copiés.
export async function moveLocalProjects() {
  if (!await onServer()) return 0;
  try { if (localStorage.getItem(MIGRATED_KEY)) return 0; } catch { return 0; }
  let n = 0;
  const metas = await tx('meta', 'readonly', s => s.getAll()) || [];
  for (const m of metas) {
    const rec = await getLocal(m.id);
    if (!rec) continue;
    try { await putOnServer(rec.meta, rec.data, null); n++; } catch (e) { if (e.status !== 409) throw e; }
  }
  try { localStorage.setItem(MIGRATED_KEY, String(Date.now())); } catch { /* stockage indisponible */ }
  return n;
}
