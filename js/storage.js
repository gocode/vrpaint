// Projets enregistrés dans IndexedDB :
//   meta     : nom, date, mur (type, taille), couleurs perso, vignette
//   projects : couches de peinture compressées gzip (lourdes, lues au chargement seulement)
// La version 1 n'avait qu'une sauvegarde automatique : elle devient un projet.
const DB = 'vrpaint', VERSION = 2;

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
  const all = await tx('meta', 'readonly', s => s.getAll());
  return (all || []).sort((a, b) => b.date - a.date);
}

async function pack(layers) {
  const out = {};
  for (const [k, L] of Object.entries(layers)) out[k] = { w: L.w, h: L.h, blob: await gzip(L.data) };
  return out;
}

async function unpack(layers) {
  const out = {};
  for (const [k, L] of Object.entries(layers)) out[k] = { w: L.w, h: L.h, data: await gunzip(L.blob) };
  return out;
}

// layers : mur principal ; extra : { idDevanture: couches } ; refs : modèles photo (Blob)
export async function saveProject({ id, layers, extra = {}, refs = [], ...meta }) {
  const data = { layers: await pack(layers), extra: {}, refs };
  for (const [cid, L] of Object.entries(extra)) data.extra[cid] = await pack(L);
  const record = { ...meta, id, date: Date.now(), refCount: refs.length };
  await tx(['projects', 'meta'], 'readwrite', (p, m) => { p.put(data, id); m.put(record, id); });
  return record;
}

export async function renameProject(id, name) {
  const meta = await tx('meta', 'readonly', s => s.get(id));
  if (meta) await tx('meta', 'readwrite', s => s.put({ ...meta, name }, id));
}

export async function loadProject(id) {
  const [meta, data] = await Promise.all([
    tx('meta', 'readonly', s => s.get(id)),
    tx('projects', 'readonly', s => s.get(id)),
  ]);
  if (!meta || !data) return null;
  const extra = {};
  for (const [cid, L] of Object.entries(data.extra || {})) extra[cid] = await unpack(L);
  return { ...meta, layers: await unpack(data.layers), extra, refs: data.refs || [] };
}

export async function deleteProject(id) {
  await tx(['projects', 'meta'], 'readwrite', (p, m) => { p.delete(id); m.delete(id); });
}
