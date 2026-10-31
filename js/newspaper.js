import * as THREE from 'three';
import { touchPressure } from './scraper.js';

// Papier journal froissé. Pressé sur le mur, il n'en touche que les crêtes :
// des facettes planes séparées par des arêtes vives, comme un relief de
// montagnes vu du ciel. Là où il touche, il emporte une partie de la dernière
// couche (l'écart entre la couche visible et le « fond », voir paint.js) et
// laisse voir la peinture sèche du dessous ; il ne touche jamais au fond.
// La peinture fraîche part mieux que la peinture récente, déjà prise.
//
// Chaque appui est un nouveau froissage (graine et angle tirés au hasard) ;
// appuyer plus fort au même endroit agrandit le contact sans recompter ce qui
// est déjà parti ; frotter pose le motif tous les quelques millimètres, et la boule
// roule en partie : d'autres plis viennent toucher, au lieu de rayer le mur de traits droits.
export const NEWSPAPER = {
  id: 'journal', name: 'Journal',
  hint: 'papier journal froissé : tamponner ou frotter la peinture fraîche (touche J)',
  radius: 0.055,   // rayon de la boule de papier (m), donc du plus grand contact
  reach: 0.12,     // distance manette → devant de la boule (VR)
  fold: 40,        // plis par mètre (facettes d'environ 2,5 cm)
};

const PRESS_DEPTH = 0.035;   // VR : écraser la boule de 3,5 cm = pression maximale
const STEP = 0.005;          // en frottant, le motif est reposé tous les 5 mm…
const TURN = 4 * Math.PI / 180;   // …ou tous les 4° de rotation du poignet
const RUB = 0.4;             // un passage en frottant emporte moins qu'un appui franc
const ROLL = 0.8;            // en frottant, la boule roule à 80 % et glisse à 20 % : le motif change sous elle
const FRESH_CELL = 0.03;     // maille de la carte de fraîcheur (m)
const FRESH_TIME = 8;        // la peinture « prend » en quelques secondes (s)

// Motif du papier froissé, GLSL. Facettes : distance aux bissectrices de
// Voronoi (plane par morceaux), chaque cellule est une petite pyramide dont la
// hauteur varie ; deux échelles de plis superposées (2,5 cm et 1,1 cm), planes par
// morceaux. Plus fins, les plis tomberaient sous la taille d'un texel du mur.
export const CRUMPLE_GLSL = /* glsl */`
vec2 cHash2(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453);
}
float cHash1(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 15731.743); }
// distance (en cellules) à l'arête la plus proche ; id : cellule
float cFacet(vec2 x, out vec2 id) {
  vec2 n = floor(x), f = fract(x), mg = vec2(0.0), mr = vec2(0.0);
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
// Hauteur du papier (≈ 0..1) au point L (m, repère du papier)
float crumple(vec2 L, float seed, float fold) {
  vec2 o = 100.0 * vec2(cHash1(vec2(seed, 1.7)), cHash1(vec2(seed, 9.2)));
  vec2 id;
  float h = cFacet(L * fold + o, id) * (0.55 + 0.9 * cHash1(id + seed));
  float a = 0.9 + seed;
  vec2 L2 = mat2(cos(a), sin(a), -sin(a), cos(a)) * L;
  h += 0.5 * cFacet(L2 * fold * 2.3 + o.yx, id) * (0.5 + cHash1(id - seed));
  return h / 0.62;
}
// Part emportée sous la pression p. La boule est bombée : le contact part du
// centre et s'étend quand on appuie ; le bord du contact est net (arêtes du
// papier, sur un texel), et chaque facette touche plus ou moins selon sa pente.
float blotLift(float p, float Hd, float fw) {
  if (p <= 0.0) return 0.0;
  float thr = 0.85 - 0.72 * p;
  float edge = clamp((Hd - thr) / fw + 0.5, 0.0, 1.0);
  float slope = smoothstep(thr, thr + 0.32, Hd);
  return (0.55 + 0.45 * p) * (0.6 * edge + 0.4 * slope);
}`;

// Fraîcheur de la peinture : heure du dernier dépôt, par maille et par toile.
// Nourrie par la bombe et les pinceaux ; elle n'est pas enregistrée (un projet
// rouvert est sec).
class FreshMap {
  constructor() {
    this.grids = new Map();
    this.time = 0;
  }

  _grid(canvas) {
    let g = this.grids.get(canvas);
    if (!g) {
      const gw = Math.ceil(canvas.width / FRESH_CELL) + 1, gh = Math.ceil(canvas.height / FRESH_CELL) + 1;
      g = { gw, gh, t: new Float32Array(gw * gh).fill(-1e9) };
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
    this._each(g, x, y, r, i => { g.t[i] = t; });
  }

  // 1 : peinture qui vient d'être posée ; 0 : prise depuis longtemps (ou rien)
  freshness(canvas, x, y, r) {
    const g = this._grid(canvas);
    let last = -1e9;
    this._each(g, x, y, r, i => { last = Math.max(last, g.t[i]); });
    return Math.exp(-(this.time - last) / FRESH_TIME);
  }

  clear() { this.grids.clear(); }
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
    this.mesh = makePaperMesh();
  }

  // input : { origin, dir, right, up, pressure } + en VR { reach, trigger }
  update(dt, input) {
    this.fresh.time += dt;
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
      this.seed = Math.random() * 61;
      this.turn = Math.random() * Math.PI * 2;
      this.prev = null;
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
    } else if (p > prev.p + 0.02) {
      // appuyer plus fort sur place : le contact s'étend, sans repasser sur ce qui est parti
      this._stamp(S, { ...prev, p }, prev.p);
      prev.p = p;
    }
    return true;
  }

  _stamp(S, s, p0) {
    const R = NEWSPAPER.radius;
    const strength = s.kind * (0.45 + 0.5 * this.fresh.freshness(s.canvas, s.x, s.y, R * 0.5));
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
  const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(NEWSPAPER.radius * 0.85, 2),
    new THREE.MeshStandardMaterial({ map: newsprintTexture(), roughness: 0.95, flatShading: true }));
  ball.position.z = -NEWSPAPER.reach + NEWSPAPER.radius * 0.85;
  g.add(ball);
  g.userData.ball = ball;
  g.userData.base = ball.geometry.getAttribute('position').array.slice();
  crumpleMesh(g);
  g.visible = false;
  return g;
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
