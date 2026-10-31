// Fichier d'un projet (.vrpaint), tel que le range projets.php :
// 'VRPAINT1' · longueur de l'en-tête (u32 LE) · en-tête JSON · blocs binaires.
// L'en-tête porte la méta du projet (nom, date, mur, couleurs perso, vignette) et
// l'emplacement de chaque bloc : couches gzip du mur et des devantures, photos modèles.
const MAGIC = 'VRPAINT1';

// record : { meta, data: { layers, extra, refs } }, couches déjà compressées (storage.js)
export function encodeProject({ meta, data }) {
  const parts = [];
  let offset = 0;
  const add = blob => { parts.push(blob); const r = { o: offset, n: blob.size }; offset += blob.size; return r; };
  const layers = L => Object.fromEntries(Object.entries(L || {}).map(([k, v]) => [k, { w: v.w, h: v.h, ...add(v.blob) }]));
  const header = {
    format: 'vrpaint', version: 1,
    meta,
    layers: layers(data.layers),
    extra: Object.fromEntries(Object.entries(data.extra || {}).map(([cid, L]) => [cid, layers(L)])),
    refs: (data.refs || []).map(r => ({ id: r.id, name: r.name, w: r.w, h: r.h, type: r.blob.type || 'image/jpeg', ...add(r.blob) })),
  };
  const json = new TextEncoder().encode(JSON.stringify(header));
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, json.length, true);
  return new Blob([MAGIC, len, json, ...parts], { type: 'application/octet-stream' });
}

// Le contrôle des couches se fait à la décompression (CRC du gzip, taille) dans storage.js.
export async function decodeProject(blob) {
  const head = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  if (new TextDecoder().decode(head.subarray(0, 8)) !== MAGIC) throw new Error('ce n\'est pas un projet VRpaint');
  const len = new DataView(head.buffer).getUint32(8, true);
  const header = JSON.parse(new TextDecoder().decode(await blob.slice(12, 12 + len).arrayBuffer()));
  if (header.format !== 'vrpaint' || !header.meta?.id) throw new Error('en-tête invalide');
  if (header.version > 1) throw new Error('projet d\'une version plus récente de VRpaint');
  const base = 12 + len;
  const part = (p, type) => {
    if (base + p.o + p.n > blob.size) throw new Error('fichier tronqué');
    return blob.slice(base + p.o, base + p.o + p.n, type);
  };
  const layers = L => Object.fromEntries(Object.entries(L || {}).map(([k, v]) => [k, { w: v.w, h: v.h, blob: part(v) }]));
  return {
    meta: header.meta,
    data: {
      layers: layers(header.layers),
      extra: Object.fromEntries(Object.entries(header.extra || {}).map(([cid, L]) => [cid, layers(L)])),
      refs: (header.refs || []).map(r => ({ id: r.id, name: r.name, w: r.w, h: r.h, blob: part(r, r.type) })),
    },
  };
}
