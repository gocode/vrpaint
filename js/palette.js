import * as THREE from 'three';

// Teintes inspirées des gammes de bombes graffiti. Valeurs en sRGB ;
// THREE.Color les convertit en linéaire pour le moteur de peinture.
// rough : rugosité du film de peinture, metal : 1 pour les métallisées,
// glow : couleur émise (fluo le jour, phospho la nuit).
const RAW = [
  ['Neutres', 'Blanc', '#f4f4f0'],
  ['Neutres', 'Gris perle', '#c9cbcc'],
  ['Neutres', 'Gris béton', '#8d9092'],
  ['Neutres', 'Anthracite', '#3f4447'],
  ['Neutres', 'Noir', '#141414'],
  ['Neutres', 'Crème', '#efe2c0'],
  ['Neutres', 'Sable', '#cfb48a'],
  ['Neutres', 'Chocolat', '#5a3a26'],

  ['Chaudes', 'Jaune citron', '#f4e93a'],
  ['Chaudes', 'Jaune', '#ffd21f'],
  ['Chaudes', 'Jaune orangé', '#ffae1a'],
  ['Chaudes', 'Orange', '#ff7a1a'],
  ['Chaudes', 'Orange sang', '#f24a1d'],
  ['Chaudes', 'Rouge', '#d91e25'],
  ['Chaudes', 'Carmin', '#a8122a'],
  ['Chaudes', 'Bordeaux', '#6b1426'],

  ['Roses & violets', 'Rose poudré', '#f6bfcf'],
  ['Roses & violets', 'Rose', '#f27ea9'],
  ['Roses & violets', 'Fuchsia', '#e0287a'],
  ['Roses & violets', 'Magenta', '#b5157f'],
  ['Roses & violets', 'Lilas', '#b9a3dc'],
  ['Roses & violets', 'Violet', '#7b3fa8'],
  ['Roses & violets', 'Prune', '#4e1f5c'],
  ['Roses & violets', 'Indigo', '#2f2a7a'],

  ['Bleus', 'Bleu glacier', '#bfe3f2'],
  ['Bleus', 'Bleu ciel', '#62bde8'],
  ['Bleus', 'Turquoise', '#16b3b8'],
  ['Bleus', 'Cyan', '#0098d8'],
  ['Bleus', 'Bleu', '#1f5fbf'],
  ['Bleus', 'Bleu roi', '#1a3a9a'],
  ['Bleus', 'Bleu nuit', '#14204a'],
  ['Bleus', 'Pétrole', '#0f5560'],

  ['Verts & terres', 'Menthe', '#a8e6c4'],
  ['Verts & terres', 'Vert pomme', '#8ccf3a'],
  ['Verts & terres', 'Vert', '#24a248'],
  ['Verts & terres', 'Vert sapin', '#145a32'],
  ['Verts & terres', 'Kaki', '#6e6b3a'],
  ['Verts & terres', 'Ocre', '#c98a2b'],
  ['Verts & terres', 'Terre de Sienne', '#94502a'],
  ['Verts & terres', 'Saumon', '#f29a7e'],

  ['Métallisées', 'Chrome', '#dde1e6', { metal: 1, rough: 0.22, kind: 'metal' }],
  ['Métallisées', 'Argent satiné', '#b4b8bf', { metal: 1, rough: 0.45, kind: 'metal' }],
  ['Métallisées', 'Or', '#f0c060', { metal: 1, rough: 0.28, kind: 'metal' }],
  ['Métallisées', 'Or rose', '#e8a890', { metal: 1, rough: 0.3, kind: 'metal' }],
  ['Métallisées', 'Cuivre', '#d9825a', { metal: 1, rough: 0.32, kind: 'metal' }],
  ['Métallisées', 'Bronze', '#a87a3e', { metal: 1, rough: 0.38, kind: 'metal' }],
  ['Métallisées', 'Bleu métal', '#5d86c9', { metal: 1, rough: 0.3, kind: 'metal' }],
  ['Métallisées', 'Noir chromé', '#4a4c52', { metal: 1, rough: 0.25, kind: 'metal' }],

  ...[['Jaune', '#e9ff1f'], ['Vert', '#39ff3a'], ['Orange', '#ff6a13'], ['Rouge', '#ff3b30'],
    ['Rose', '#ff2f8e'], ['Magenta', '#ff1fd2'], ['Violet', '#b44dff'], ['Bleu', '#2fb4ff']]
    .map(([n, hex]) => ['Fluo', n + ' fluo', hex, { glow: hex, glowK: 0.9, rough: 0.6, kind: 'fluo' }]),

  // Les pigments phosphorescents sont pâles le jour et luisent la nuit.
  ...[['vert', '#e3ebbd', '#7dff5a'], ['jaune', '#efefc4', '#e8ff4a'], ['aqua', '#d3efe7', '#3cffd8'],
    ['bleu', '#dbe7f1', '#4aa8ff'], ['violet', '#e6dcf0', '#b070ff'], ['rose', '#f3dbe4', '#ff5fb0'],
    ['orange', '#f3dfc6', '#ff9a3c'], ['rouge', '#f2d6d0', '#ff4a3a']]
    .map(([n, day, glow]) => ['Phospho', 'Phospho ' + n, day, { glow, glowK: 1.6, rough: 0.7, kind: 'phospho' }]),
];

// Finitions applicables à une couleur personnalisée.
export const FINISHES = [
  { id: 'mat', name: 'Mat' },
  { id: 'satin', name: 'Satiné' },
  { id: 'brillant', name: 'Brillant' },
  { id: 'metal', name: 'Métal' },
  { id: 'fluo', name: 'Fluo' },
  { id: 'phospho', name: 'Phospho' },
];

export function makePaint({ id, group = 'Perso', name, hex, rough = 0.55, metal = 0, glow = null, glowK = 1, kind = 'std', finish = null, custom = false }) {
  const lin = new THREE.Color(hex);
  const glowLin = glow ? new THREE.Color(glow).multiplyScalar(glowK) : new THREE.Color(0, 0, 0);
  return { id, group, name, hex, rough, metal, glow, glowK, kind, finish, custom, lin, glowLin };
}

// Teinte de base d'une couleur perso (en phospho, c'est la lueur)
export function baseHex(paint) {
  return paint.custom && paint.finish === 'phospho' ? paint.glow : paint.hex;
}

// Finition d'une couleur du nuancier, pour ouvrir l'éditeur à partir d'elle
export function finishOf(paint) {
  if (paint.custom) return paint.finish;
  if (paint.kind === 'metal' || paint.kind === 'fluo' || paint.kind === 'phospho') return paint.kind;
  return paint.rough > 0.7 ? 'mat' : paint.rough < 0.3 ? 'brillant' : 'satin';
}

export const PAINTS = RAW.map(([group, name, hex, opts = {}], i) =>
  makePaint({ id: 'p' + i, group, name, hex, ...opts }));

export const GROUPS = [...new Set(PAINTS.map(p => p.group))];

export function paintById(id) {
  return PAINTS.find(p => p.id === id) || null;
}

// Couleur perso : la teinte choisie, avec la finition voulue. En phospho, la
// teinte choisie est celle de la lueur ; le pigment reste pâle à la lumière.
export function customPaint(hex, finish = 'satin', id = 'custom') {
  const f = FINISHES.find(x => x.id === finish) || FINISHES[1];
  const base = { id, group: 'Perso · ' + f.name, name: 'Perso ' + hex.toUpperCase(), hex, finish: f.id, custom: true };
  switch (f.id) {
    case 'mat': return makePaint({ ...base, rough: 0.82 });
    case 'brillant': return makePaint({ ...base, rough: 0.2 });
    case 'metal': return makePaint({ ...base, metal: 1, rough: 0.3, kind: 'metal' });
    case 'fluo': return makePaint({ ...base, glow: hex, glowK: 0.9, rough: 0.6, kind: 'fluo' });
    case 'phospho': return makePaint({ ...base, hex: mixHex(hex, '#f2f0dc', 0.78), glow: hex, glowK: 1.6, rough: 0.7, kind: 'phospho' });
    default: return makePaint({ ...base, rough: 0.5 });
  }
}

function mixHex(a, b, t) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = s => Math.round((pa >> s & 255) * (1 - t) + (pb >> s & 255) * t).toString(16).padStart(2, '0');
  return '#' + ch(16) + ch(8) + ch(0);
}

export function hsvToHex(h, s, v) {
  const f = n => {
    const k = (n + h * 6) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  const to = x => Math.round(x * 255).toString(16).padStart(2, '0');
  return '#' + to(f(5)) + to(f(3)) + to(f(1));
}

export function hexToHsv(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = (h / 6 + 1) % 1;
  }
  return { h, s: max ? d / max : 0, v: max };
}
