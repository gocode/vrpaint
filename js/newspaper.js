import * as THREE from 'three';
import { touchPressure } from './scraper.js';

// Papier journal froissé. Pressé sur le mur, il n'en touche que les crêtes :
// des pans plans inclinés en tous sens, bordés d'arêtes vives, comme un relief
// de montagnes vu du ciel. Là où il touche, il emporte une partie de la dernière
// couche (l'écart entre la couche visible et le « fond », voir paint.js) et
// laisse voir la peinture sèche du dessous ; il ne touche jamais au fond.
// Plus la peinture est fraîche, plus elle part ; sèche, elle ne part presque plus.
//
// Chaque appui est un nouveau froissage (graine et angle tirés au hasard) ;
// appuyer plus fort au même endroit agrandit le contact sans recompter ce qui
// est déjà parti ; rester appuyé boit la peinture peu à peu (le papier
// s'imbibe et s'aplatit un peu) ; frotter pose le motif tous les quelques millimètres, et la boule
// roule en partie : d'autres plis viennent toucher, au lieu de rayer le mur de traits droits.
export const NEWSPAPER = {
  id: 'journal', name: 'Journal', label: 'Papier journal',
  hint: 'papier journal froissé : tamponner ou frotter la peinture fraîche (touche J)',
  size: 0.11,               // diamètre de la boule (m), donc du plus grand contact…
  range: [0.05, 0.3],       // …réglable à la barre, au centimètre
  sizeTitle: 'Taille de la boule de papier (diamètre)', sizeWord: 'Diamètre',
  fold: 40,        // plis par mètre (grands pans d'environ 2,5 cm, petits d'1 cm)
};

// Distance manette → devant de la boule (VR) pour une boule de diamètre size
export function paperReach(size) {
  return 0.0265 + 0.85 * size;
}

const PRESS_DEPTH = 0.035;   // VR : écraser la boule de 3,5 cm = pression maximale
const STEP = 0.005;          // en frottant, le motif est reposé tous les 5 mm…
const TURN = 4 * Math.PI / 180;   // …ou tous les 4° de rotation du poignet
const RUB = 0.4;             // un passage en frottant emporte moins qu'un appui franc
const ROLL = 0.8;            // en frottant, la boule roule à 80 % et glisse à 20 % : le motif change sous elle
const FIRST = 0.85;          // un appui bref emporte l'essentiel de ce qu'il touche (peinture fraîche) : éclats francs…
const SOAK = 1.2;            // …puis, tant qu'on reste appuyé, le reste part à ce taux (par seconde)
const SOAK_STEP = 0.08;      // appui prolongé : motif reposé à ce rythme (s)
const FLATTEN = 0.3;         // et la boule s'aplatit : +30 % de pression en 2 s
const FRESH_CELL = 0.03;     // maille de la carte de fraîcheur (m)
const FRESH_TIME = 20;       // la peinture « prend » en quelques dizaines de secondes (s)

const WET_DRY = 0.12;         // sèche, la peinture ne donne plus que 12 % de ce qu'elle donnait fraîche

// Fraîcheur au texel, GLSL : la carte (heure du dernier dépôt par maille) est lue
// aux quatre mailles voisines, fraîcheur interpolée entre leurs centres.
// Part que le papier peut boire : WET_DRY (sèche) à 1 (posée à l'instant).
export const FRESH_GLSL = /* glsl */`
uniform sampler2D tFresh;
uniform vec4 uFresh;   // mailles en x, en y, taille d'une maille (m), heure (s)
float freshCell(ivec2 c) {
  float t = texelFetch(tFresh, clamp(c, ivec2(0), ivec2(uFresh.xy) - 1), 0).r;
  return exp(min(0.0, t - uFresh.w) / ${FRESH_TIME.toFixed(1)});
}
float wetAt(vec2 P) {
  vec2 g = P / uFresh.z - 0.5, w = fract(g);
  ivec2 c = ivec2(floor(g));
  float f = mix(mix(freshCell(c), freshCell(c + ivec2(1, 0)), w.x),
                mix(freshCell(c + ivec2(0, 1)), freshCell(c + ivec2(1, 1)), w.x), w.y);
  return ${WET_DRY.toFixed(2)} + ${(1 - WET_DRY).toFixed(2)} * f;
}`;

// Motif du papier froissé, GLSL. Cellules de Voronoi : chaque cellule est un
// pan de papier plan, à sa hauteur, incliné au hasard ; une partie des bords
// porte une arête en crête (un pli marqué). Deux échelles (2,5 cm et 1 cm,
// tournées l'une par rapport à l'autre), dont la somme reste plane par morceaux :
// le contact est fait d'éclats anguleux à bords droits. Plus fins, les plis
// tomberaient sous la taille d'un texel du mur.
export const CRUMPLE_GLSL = /* glsl */`
vec2 cHash2(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453);
}
float cHash1(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 15731.743); }
// distance (en cellules) à l'arête la plus proche ; id : cellule ; mr : du point au germe
float cFacet(vec2 x, out vec2 id, out vec2 mr) {
  vec2 n = floor(x), f = fract(x), mg = vec2(0.0);
  mr = vec2(0.0);
  float md = 8.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j));
    vec2 r = g + 0.1 + 0.8 * cHash2(n + g) - f;
    float d = dot(r, r);
    if (d < md) { md = d; mr = r; mg = g; }
  }
  md = 8.0;
  for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) {
    vec2 g = mg + vec2(float(i), float(j));
    vec2 r = g + 0.1 + 0.8 * cHash2(n + g) - f;
    vec2 e = r - mr;
    if (dot(e, e) > 1e-5) md = min(md, dot(0.5 * (mr + r), normalize(e)));
  }
  id = n + mg;
  return md;
}
// Pan plan : hauteur au germe, pente au hasard ; d : distance au bord ; crest : bord en crête
float cPlane(vec2 x, float seed, out float d, out float crest) {
  vec2 id, mr;
  d = cFacet(x, id, mr);
  vec2 g = cHash2(id + vec2(seed * 1.37, -seed)) * 2.0 - 1.0;
  crest = step(0.5, cHash1(vec2(id.y - seed * 3.1, id.x + 5.3)));
  return cHash1(id + vec2(seed, 0.0)) - 0.9 * dot(g, mr);
}
// Hauteur du papier (≈ 0..1) au point L (m, repère du papier)
float crumple(vec2 L, float seed, float fold) {
  vec2 o = 100.0 * vec2(cHash1(vec2(seed, 1.7)), cHash1(vec2(seed, 9.2)));
  float d1, d2, c1, c2;
  float h = cPlane(L * fold + o, seed, d1, c1);
  float a = 0.9 + seed;
  vec2 L2 = mat2(cos(a), sin(a), -sin(a), cos(a)) * L;
  h += 0.9 * cPlane(L2 * fold * 2.6 + o.yx, seed + 7.0, d2, c2);
  // arêtes en crête : fines lignes (2 à 3 mm) le long d'une partie des bords
  h += 0.35 * c1 * max(0.0, 1.0 - d1 / 0.07) + 0.5 * c2 * max(0.0, 1.0 - d2 / 0.12);
  return (h + 0.6) / 3.0;
}
// Bombé de la boule : un polyèdre (7 faces au contour), pas une sphère ; 0 au centre, 1 au bord
float crumpleBulge(vec2 Q, float R, float seed) {
  float r = 0.0;
  for (int k = 0; k < 7; k++) {
    float an = seed * 0.7 + float(k) * 0.8975979;
    r = max(r, dot(Q, vec2(cos(an), sin(an))));
  }
  r /= R * 0.9009689;   // cos(π/7) : polygone inscrit dans le disque
  return r * r;
}
// Part emportée sous la pression p. Le contact part du centre et s'étend quand
// on appuie ; son bord est net (arêtes du papier, sur un texel), et les crêtes
// les plus hautes, plus écrasées, boivent un peu plus.
float blotLift(float p, float Hd, float fw) {
  if (p <= 0.0) return 0.0;
  float thr = 0.76 - 0.46 * p;
  float edge = clamp((Hd - thr) / fw + 0.5, 0.0, 1.0);
  return (0.55 + 0.45 * p) * edge * (0.8 + 0.2 * step(thr + 0.18, Hd));
}`;

// Fraîcheur de la peinture : heure du dernier dépôt, par maille et par toile.
// Nourrie par la bombe et les pinceaux, vieillie par le chalumeau ; lue au texel
// par le shader du papier (FRESH_GLSL). Elle n'est pas enregistrée (un projet
// rouvert est sec).
// Une maille n'a qu'une heure : un dépôt rendrait fraîche toute la peinture qu'il
// recouvre, et le papier boirait jusqu'au mur une couche sèche (au chalumeau ou
// au temps) sous un voile frais. Avant de remettre l'heure à neuf, la part déjà
// prise de cette peinture (d, 0..1) est donc confiée à la surface, qui la fait
// entrer dans son fond au lot suivant (voir PaintSurface.queueDry).
class FreshMap {
  constructor() {
    this.grids = new Map();
    this.time = 0;
  }

  _grid(canvas) {
    let g = this.grids.get(canvas);
    if (!g) {
      const gw = Math.ceil(canvas.width / FRESH_CELL) + 1, gh = Math.ceil(canvas.height / FRESH_CELL) + 1;
      g = { gw, gh, t: new Float32Array(gw * gh).fill(-1e9), dirty: true };
      g.tex = new THREE.DataTexture(g.t, gw, gh, THREE.RedFormat, THREE.FloatType);
      g.tex.minFilter = g.tex.magFilter = THREE.NearestFilter;
      // part sèche de la peinture recouverte, en attente du prochain lot (×255)
      g.d = new Uint8Array(gw * gh);
      g.dtex = new THREE.DataTexture(g.d, gw, gh, THREE.RedFormat, THREE.UnsignedByteType);
      g.dtex.minFilter = g.dtex.magFilter = THREE.NearestFilter;
      g.dry = {
        tex: g.dtex, gw, gh, cell: FRESH_CELL, dirty: true,
        sync() { if (this.dirty) { g.dtex.needsUpdate = true; this.dirty = false; } },
        done() { g.d.fill(0); this.dirty = true; },
      };
      this.grids.set(canvas, g);
    }
    return g;
  }

  _each(g, x, y, r, f) {
    const x0 = Math.max(0, Math.floor((x - r) / FRESH_CELL)), x1 = Math.min(g.gw - 1, Math.floor((x + r) / FRESH_CELL));
    const y0 = Math.max(0, Math.floor((y - r) / FRESH_CELL)), y1 = Math.min(g.gh - 1, Math.floor((y + r) / FRESH_CELL));
    for (let j = y0; j <= y1; j++) for (let i = x0; i <= x1; i++) f(j * g.gw + i);
  }

  mark(canvas, x, y, r) {
    const g = this._grid(canvas), t = this.time;
    let dry = false;
    this._each(g, x, y, r, i => {
      const d = Math.round((1 - Math.exp(Math.min(0, g.t[i] - t) / FRESH_TIME)) * 255);
      if (d > g.d[i]) { g.d[i] = d; dry = true; }
      g.t[i] = t;
    });
    g.dirty = true;
    if (!dry) return;
    g.dry.dirty = true;
    // mailles touchées, plus une tout autour (la part sèche est interpolée entre les centres)
    const c = FRESH_CELL, i0 = Math.floor((x - r) / c) - 1, j0 = Math.floor((y - r) / c) - 1;
    canvas.ensureSurface?.().queueDry(g.dry, i0 * c, j0 * c, (Math.floor((x + r) / c) + 2) * c, (Math.floor((y + r) / c) + 2) * c);
  }

  // Chaleur (chalumeau) : la peinture sous la flamme vieillit de age secondes
  age(canvas, x, y, r, age) {
    const g = this._grid(canvas);
    this._each(g, x, y, r, i => { g.t[i] -= age; });
    g.dirty = true;
  }

  // Carte d'une toile pour le shader, envoyée au GPU si elle a changé : { tex, gw, gh, cell, now }
  source(canvas) {
    const g = this._grid(canvas);
    if (g.dirty) { g.tex.needsUpdate = true; g.dirty = false; }
    return { tex: g.tex, gw: g.gw, gh: g.gh, cell: FRESH_CELL, now: this.time };
  }

  clear() {
    for (const g of this.grids.values()) { g.tex.dispose(); g.dtex.dispose(); }
    this.grids.clear();
  }
}

const _e = new THREE.Vector3();

export class Newspaper {
  constructor({ project }) {
    this.project = project;     // (origin, dir, right, up) → impact sur une toile (voir Spray.project)
    this.fresh = new FreshMap();
    this.prev = null;
    this.stroking = false;
    this.onStrokeStart = null;
    this.hit = null;
    this.contact = false;
    this.pressure = 0;
    this.speed = 0;
    this.seed = 0;
    this.turn = 0;
    this.soak = 0;              // temps passé appuyé sans bouger
    this.soakDue = 0;           // part de ce temps pas encore reposée sur le mur
    this.size = NEWSPAPER.size;
    this.random = Math.random;  // tirage du froissage (le test le remplace par une suite à graine fixe)
    this.mesh = makePaperMesh();
  }

  // input : { origin, dir, right, up, pressure } + en VR { reach, trigger } ; size : diamètre de la boule (m)
  update(dt, input, size = this.size) {
    this.fresh.time += dt;
    this.size = size;
    const hit = input ? this.project(input.origin, input.dir, input.right, input.up) : null;
    this.hit = hit;
    const p = hit ? touchPressure(hit, input, PRESS_DEPTH).p : 0;
    const contact = p > 0.02;
    if (contact && !this.contact) this.touched = performance.now();
    this.contact = contact;
    this.pressure = contact ? p : 0;
    if (!contact) {
      this.prev = null;
      this.stroking = false;
      this.speed = 0;
      return false;
    }
    if (!this.stroking) {
      // nouvel appui : le papier a tourné dans la main et s'est re-froissé
      this.stroking = true;
      this.seed = this.random() * 61;
      this.turn = this.random() * Math.PI * 2;
      this.prev = null;
      this.soak = this.soakDue = 0;
      crumpleMesh(this.mesh);
      this.onStrokeStart?.();
    }
    const f = hit.canvas.frame;
    _e.copy(input.right).addScaledVector(f.n, -input.right.dot(f.n));
    const th = Math.atan2(_e.dot(f.ey), _e.dot(f.ex)) + this.turn;
    const S = hit.canvas.ensureSurface();
    const cur = { canvas: hit.canvas, x: hit.x, y: hit.y, th, p, kind: 1, rx: 0, ry: 0 };
    const prev = this.prev && this.prev.canvas === hit.canvas ? this.prev : null;
    if (!prev) {
      this._stamp(S, cur, 0);
      this.prev = cur;
      return true;
    }
    const dist = Math.hypot(cur.x - prev.x, cur.y - prev.y);
    let dth = th - prev.th;
    dth = Math.atan2(Math.sin(dth), Math.cos(dth));
    this.speed = dt > 0 ? dist / dt : 0;
    if (dist > STEP || Math.abs(dth) > TURN) {
      // frotter : le motif glisse avec le papier
      this.soak = this.soakDue = 0;
      if (dist > 0.5) { this.prev = cur; return true; }
      const n = Math.min(64, Math.ceil(Math.max(dist / STEP, Math.abs(dth) / TURN)));
      let last = null;
      for (let k = 1; k <= n; k++) {
        const u = k / n;
        // roulement : la partie du papier au contact avance avec le déplacement
        const r = last || prev, c = Math.cos(r.th), s = Math.sin(r.th);
        const dx = (cur.x - prev.x) / n * ROLL, dy = (cur.y - prev.y) / n * ROLL;
        last = { canvas: hit.canvas, x: prev.x + (cur.x - prev.x) * u, y: prev.y + (cur.y - prev.y) * u,
          th: prev.th + dth * u, p: prev.p + (cur.p - prev.p) * u, kind: RUB,
          rx: r.rx + c * dx + s * dy, ry: r.ry - s * dx + c * dy };
        this._stamp(S, last, 0);
      }
      this.prev = last;
    } else {
      // rester appuyé : le papier boit la peinture peu à peu et s'aplatit (le contact s'étend)
      this.soak += dt;
      this.soakDue += dt;
      const pe = Math.min(1, p * (1 + FLATTEN * Math.min(1, this.soak / 2)));
      if (pe > prev.p + 0.02) {
        // appuyer plus fort sur place : le contact s'étend, sans repasser sur ce qui est parti
        this._stamp(S, { ...prev, p: pe }, prev.p);
        prev.p = pe;
      }
      if (this.soakDue >= SOAK_STEP) {
        this._stamp(S, prev, 0, SOAK * this.soakDue);
        this.soakDue = 0;
      }
    }
    return true;
  }

  // Un motif : p0 > 0, seulement l'agrandissement du contact depuis la pression p0 ;
  // soak > 0, ce que boit encore le papier resté appuyé (taux × durée). Le shader
  // module la force par la fraîcheur de la peinture, texel par texel.
  _stamp(S, s, p0, soak = 0) {
    const R = this.size / 2;
    const strength = soak > 0 ? Math.min(0.9, soak) : s.kind * FIRST;
    S.setFreshness(this.fresh.source(s.canvas));
    S.pushBlot(s.x, s.y, s.th, R, this.seed, p0, s.p, strength, NEWSPAPER.fold, s.rx, s.ry);
  }

  reset() {
    this.prev = null;
    this.stroking = false;
    this.contact = false;
    this.pressure = 0;
  }
}

// Boule de papier journal : polyèdre irrégulier à facettes, colonnes d'imprimé.
// Le devant de la boule est en z = −reach (manette à l'origine).
let newsprint = null;
function newsprintTexture() {
  if (newsprint) return newsprint;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#d8d3c4';
  g.fillRect(0, 0, 256, 256);
  let s = 7;
  const rand = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let col = 0; col < 4; col++) {
    for (let y = 8; y < 248; y += 7) {
      if (rand() < 0.08) { y += 10; continue; }
      g.fillStyle = `rgba(40,40,40,${0.35 + rand() * 0.3})`;
      g.fillRect(8 + col * 62, y, 50 * (0.6 + rand() * 0.4), 3);
    }
  }
  g.fillStyle = 'rgba(30,30,30,0.7)';
  g.fillRect(8, 4, 240, 10);
  newsprint = new THREE.CanvasTexture(c);
  newsprint.colorSpace = THREE.SRGBColorSpace;
  return newsprint;
}

function makePaperMesh() {
  const g = new THREE.Group();
  const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2),
    new THREE.MeshStandardMaterial({ map: newsprintTexture(), roughness: 0.95, flatShading: true }));
  g.add(ball);
  g.userData.ball = ball;
  g.userData.base = ball.geometry.getAttribute('position').array.slice();
  sizePaperMesh(g, NEWSPAPER.size);
  crumpleMesh(g);
  g.visible = false;
  return g;
}

// Boule de diamètre size : son devant reste à paperReach(size) de la main
export function sizePaperMesh(g, size) {
  if (g.userData.size === size) return;
  g.userData.size = size;
  const r = size / 2 * 0.85, ball = g.userData.ball;
  ball.scale.setScalar(r);
  ball.position.z = -paperReach(size) + r;
}

// Nouveau froissage : chaque sommet rentre ou sort au hasard (les sommets
// confondus d'une arête bougent ensemble, la boule reste fermée).
function crumpleMesh(g) {
  const pos = g.userData.ball.geometry.getAttribute('position'), base = g.userData.base;
  const k = new Map();
  for (let i = 0; i < pos.count; i++) {
    const x = base[i * 3], y = base[i * 3 + 1], z = base[i * 3 + 2];
    const key = `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`;
    if (!k.has(key)) k.set(key, 0.7 + Math.random() * 0.45);
    const s = k.get(key);
    pos.setXYZ(i, x * s, y * s, z * s);
  }
  pos.needsUpdate = true;
  g.userData.ball.geometry.computeVertexNormals();
}
