import { PAINTS, paintById, customPaint, baseHex, finishOf } from './palette.js';
import { CAPS, tuneCap } from './spray.js';
import { SCRAPERS, scraperById } from './scraper.js';
import { BRUSHES, brushById } from './brush.js';
import { NEWSPAPER } from './newspaper.js';

export const WALLS = [
  { id: 'briques', name: 'Briques' },
  { id: 'briques-peintes', name: 'Briques peintes' },
  { id: 'parpaings', name: 'Parpaings' },
  { id: 'pierre', name: 'Pierre' },
  { id: 'beton', name: 'Béton banché' },
  { id: 'crepi', name: 'Crépi' },
  { id: 'tole', name: 'Tôle ondulée' },
  { id: 'bois', name: 'Palissade bois' },
  { id: 'carrelage', name: 'Carrelage métro' },
  { id: 'blanc', name: 'Mur blanc' },
  { id: 'noir', name: 'Mur noir' },
];

// Dimensions possibles du mur (m) : [min, max, pas]
export const WALL_LIMITS = { width: [3, 16, 1], height: [2, 6, 0.5] };
// Potentiomètre de largeur du jet : multiplicateur de l'angle du cap
export const CAP_SCALE = [0.3, 2.5];
export const MAX_SAVED_COLORS = 16;

// Outils en main : ceux qui posent la peinture (bombe, pinceaux) et les caches,
// puis ceux qui l'enlèvent (racloirs, papier journal)
export const TOOLS = [
  { id: 'bombe', name: 'Bombe', hint: 'peindre (touche B)' },
  ...BRUSHES.map(t => ({ id: t.id, name: t.name, short: t.short, hint: t.hint })),
  { id: 'cache', name: 'Caches', hint: 'poser, déplacer, tourner les pochoirs (touche M)' },
  ...SCRAPERS.map(t => ({ id: t.id, name: t.name, hint: t.hint + ' (touche R)' })),
  { id: NEWSPAPER.id, name: NEWSPAPER.name, hint: NEWSPAPER.hint },
];

// Outils qui travaillent au contact du mur, avec une pression : racloirs, pinceaux, papier journal
export function pressedTool(id) {
  return !!(scraperById(id) || brushById(id) || id === NEWSPAPER.id);
}

export const state = {
  paint: paintById('p13'),   // Rouge
  customFinish: 'satin',
  savedColors: [],           // couleurs perso enregistrées : { hex, finish }
  cap: 'standard',
  capScale: 1,
  drips: true,
  spatter: true,       // projections de gouttelettes autour du trait
  aim: true,
  night: false,
  wall: 'briques',
  wallWidth: 8,
  wallHeight: 3,
  projectId: null,
  projectName: 'Mon mur',
  refs: [],            // modèles photo du projet : { id, name, blob, w, h }
  refIndex: 0,
  refShow: true,
  refSide: 'droite',   // à côté de la palette : gauche, droite, dessus
  refScale: 1,
  refEasel: false,     // sur un chevalet près du mur plutôt qu'à la main
  distance: 0.15,  // souris : distance bombe-mur (m)
  pressure: 1,     // souris : pression de la gâchette
  angle: 0,        // souris : rotation du flat cap (degrés)
  leftHanded: false,
  spectator: 'tete', // vue du PC pendant une session Link : tete, mur, off
  tool: 'bombe',
  lastTool: 'cache',   // outil repris par la gâchette latérale (VR)
  maskShape: 'rond',
  maskSize: 0.15,      // demi-taille du prochain cache (m)
  maskLift: 0.002,     // décollement du prochain cache (m)
  brushSizes: {},      // taille choisie de chaque pinceau (m), voir brush.js
  touchDrag: 'regarder',   // écran tactile, deux doigts qui glissent : regarder | glisser (le long du mur)
  touchPinch: 'largeur',   // pincer : largeur (de l'outil) | avancer (vers le mur)
  touchPad: true,          // croix de déplacement à l'écran
};

const PREFS_KEY = 'vrpaint.prefs';
try {
  const saved = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null');
  if (saved) {
    const { paintId, customHex, ...rest } = saved;
    delete rest.refs;
    Object.assign(state, rest);
    state.paint = customHex ? customPaint(customHex, state.customFinish, paintId || 'custom') : paintById(paintId) || state.paint;
    state.night = false;
  }
} catch { /* préférences illisibles : valeurs par défaut */ }

const listeners = new Set();

export function set(patch) {
  Object.assign(state, patch);
  for (const f of listeners) f(patch);
  try {
    const { paint, night, projects, refs, ...rest } = state;
    localStorage.setItem(PREFS_KEY, JSON.stringify({
      ...rest, paintId: paint.id, customHex: paint.custom ? baseHex(paint) : null,
    }));
  } catch { /* stockage indisponible */ }
}

export function subscribe(f) {
  listeners.add(f);
  return () => listeners.delete(f);
}

// Rempli par main.js : undo, clear, photo, save, enterVR, enterAR, projets…
export const actions = {};

export function capById(id) {
  return CAPS.find(c => c.id === id) || CAPS[1];
}

// Cap courant, ajusté par le potentiomètre de largeur
export function currentCap() {
  return tuneCap(capById(state.cap), state.capScale);
}

// Change d'outil en retenant le dernier outil autre que la bombe.
export function setTool(id) {
  if (!TOOLS.some(t => t.id === id)) return;
  set(id === 'bombe' ? { tool: id } : { tool: id, lastTool: id });
}

export function setCustom(hex, finish = state.customFinish) {
  set({ customFinish: finish, paint: customPaint(hex, finish) });
}

export function savedPaints() {
  return state.savedColors.map((c, i) => customPaint(c.hex, c.finish, 'saved' + i));
}

// Enregistre la couleur courante dans « Mes couleurs » (sans doublon).
export function saveCurrentColor() {
  const p = state.paint;
  const c = p.custom
    ? { hex: baseHex(p), finish: p.finish }
    : { hex: p.kind === 'phospho' ? p.glow : p.hex, finish: finishOf(p) };
  const list = state.savedColors.filter(s => !(s.hex === c.hex && s.finish === c.finish));
  list.unshift(c);
  set({ savedColors: list.slice(0, MAX_SAVED_COLORS), customFinish: c.finish, paint: customPaint(c.hex, c.finish, 'saved0') });
}

export function removeSavedColor(index) {
  const list = state.savedColors.slice();
  list.splice(index, 1);
  // les id « savedN » se décalent : la couleur en main redevient une perso libre
  const p = state.paint;
  set({ savedColors: list, paint: p.id.startsWith('saved') ? customPaint(baseHex(p), p.finish) : p });
}

export { PAINTS };
