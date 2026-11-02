import * as THREE from 'three';
import { touchPressure } from './scraper.js';

// Pinceaux, rond et plat, chargés de la couleur courante. Chaque poil (une
// mèche de quelques poils, en fait) trace sa propre ligne de petits tampons
// nets : des stries parallèles au geste, plus ou moins chargées. Chaque poil a
// sa réserve de peinture, qui s'épuise en peignant : au bout du trait, les poils
// se vident l'un après l'autre et le trait se casse en traînées sèches.
// Le pinceau se recharge quand on le décolle du mur un instant (on le retrempe).
// Option « Charge réaliste » décochée : la réserve ne baisse pas, le trait reste plein.
// Le pinceau plat a une tranche : sa largeur suit le poignet. Large en travers
// du geste, il couvre une bande ; de chant, il trace un filet.
export const BRUSHES = [
  { id: 'pinceau-rond', kind: 'rond', name: 'Pinceau rond', short: 'Rond', sizes: [0.01, 0.025, 0.05],
    hint: 'pinceau rond : trace de poils, la charge s\'épuise le long du trait (touche P)' },
  { id: 'pinceau-plat', kind: 'plat', name: 'Pinceau plat', short: 'Plat', sizes: [0.02, 0.04, 0.08],
    hint: 'pinceau plat : la tranche suit le poignet, la charge s\'épuise (touche P)' },
];

export function brushById(id) {
  return BRUSHES.find(b => b.id === id) || null;
}

// Taille choisie (diamètre ou largeur, m) ; sizes : state.brushSizes. Un outil a des
// tailles fixes (sizes) ou une plage continue (range, taille par défaut size).
export function brushSize(tool, sizes) {
  const v = sizes?.[tool.id];
  if (tool.range) return v >= tool.range[0] && v <= tool.range[1] ? v : tool.size;
  return tool.sizes.includes(v) ? v : tool.sizes[1];
}

const FERRULE = 0.1;         // de la manette au bout de la virole (m)
const PRESS_DEPTH = 0.03;    // VR : plier les poils de 3 cm = pression maximale
const DRAIN = 1.4;           // peinture prise à un poil par mètre de trait à pleine couverture
const RELOAD = 0.6;          // décollé du mur aussi longtemps (s), le pinceau est rechargé

function bristleLength(tool, size) {
  return tool.kind === 'rond' ? Math.max(0.022, size * 1.1) : size * 0.55 + 0.018;
}

// Distance manette → bout des poils (VR)
export function brushReach(tool, size) {
  return FERRULE + bristleLength(tool, size);
}

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x6d2b79f5 >>> 0) / 4294967296);
}

// Bruit 1D lisse (0..1) : chaque poil sec accroche ou saute le long du trait
function hash(n) { const x = Math.sin(n * 127.1 + 31.7) * 43758.5453; return x - Math.floor(x); }
function vnoise(x) {
  const i = Math.floor(x), f = x - i, k = f * f * (3 - 2 * f);
  return hash(i) + (hash(i + 1) - hash(i)) * k;
}

// Touffe d'un pinceau : position de chaque poil dans la touffe (u, v : −1..1),
// rayon de sa trace, opacité, réserve. Toujours la même pour un pinceau donné.
function makeTuft(tool, size, texel) {
  const rand = rng(tool.id.length * 7919 + Math.round(size * 1e4));
  const round = tool.kind === 'rond';
  // une mèche couvre au moins 1,7 texel : plus fine, elle se tramerait entre les texels
  const rb = Math.max(texel * 1.7, size * (round ? 0.05 : 0.035));
  const n = round ? Math.round(10 + 2.4 * size / rb) : Math.round(2 * size / (1.25 * rb));
  const hairs = [];
  for (let i = 0; i < n; i++) {
    let u, v;
    if (round) {
      const r = Math.sqrt(rand()), a = rand() * Math.PI * 2;
      u = r * Math.cos(a); v = r * Math.sin(a);
    } else {
      u = -1 + 2 * (Math.floor(i / 2) + 0.15 + 0.7 * rand()) / Math.ceil(n / 2);
      v = rand() * 2 - 1;
    }
    hairs.push({
      u, v, r: rb * (0.7 + 0.6 * rand()), alpha: 0.55 + 0.45 * rand(), cap: 0.65 + 0.7 * rand(),
      phase: rand() * 100, freq: 1 / (0.002 + 0.004 * rand()),
    });
  }
  return { tool, size, texel, rb, hairs };
}

const _e = new THREE.Vector3();

export class Brush {
  constructor({ project }) {
    this.project = project;     // (origin, dir, right, up) → impact sur une toile (voir Spray.project)
    this.onStrokeStart = null;
    this.onDeposit = null;      // (toile, x, y, rayon) : peinture fraîche (voir newspaper.js)
    this.tuft = null;
    this.load = [];             // réserve de chaque poil
    this.dist = [];             // chemin de chaque poil depuis son dernier tampon
    this.run = [];              // chemin total de chaque poil (bruit du pinceau sec)
    this.prev = null;
    this.stroking = false;
    this.offWall = Infinity;
    this.hit = null;
    this.contact = false;
    this.pressure = 0;
    this.speed = 0;
    this.paint = null;
    this.meshes = new Map(BRUSHES.map(t => [t.id, makeBrushMesh(t)]));
  }

  // Réserve moyenne (0..1), pour la couleur des poils
  get level() {
    if (!this.load.length) return 1;
    let s = 0;
    for (let i = 0; i < this.load.length; i++) s += Math.min(1, this.load[i] / this.tuft.hairs[i].cap);
    return s / this.load.length;
  }

  reload() {
    if (!this.tuft) return;
    this.load = this.tuft.hairs.map(h => h.cap);
  }

  // Empreinte sur la toile à la pression p : demi-axes (le long du fil, en travers)
  footprint(tool, size, p) {
    if (tool.kind === 'rond') { const R = size / 2 * (0.3 + 0.7 * Math.sqrt(p)); return [R, R]; }
    return [size / 2 * (0.88 + 0.12 * p), Math.max(0.001, size * 0.07 * (0.35 + 0.65 * p))];
  }

  // input : { origin, dir, right, up, pressure } + en VR { reach, trigger } ;
  // realistic : la charge s'épuise le long du trait (sinon le pinceau reste plein)
  update(dt, input, tool, size, paint, realistic = true) {
    this.realistic = realistic;
    const hit = input && tool ? this.project(input.origin, input.dir, input.right, input.up) : null;
    this.hit = hit;
    const p = hit ? touchPressure(hit, input, PRESS_DEPTH).p : 0;
    const contact = p > 0.02;
    if (contact && !this.contact) this.touched = performance.now();
    this.contact = contact;
    this.pressure = contact ? p : 0;
    if (paint !== this.paint) { this.paint = paint; this.offWall = Infinity; }
    if (!contact) {
      this.offWall += dt;
      this.prev = null;
      this.stroking = false;
      this.speed = 0;
      return false;
    }
    const S = hit.canvas.ensureSurface();
    if (!this.tuft || this.tuft.tool !== tool || this.tuft.size !== size || this.tuft.texel !== S.texel) {
      this.tuft = makeTuft(tool, size, S.texel);
      this.offWall = Infinity;
    }
    if (!this.stroking) {
      this.stroking = true;
      if (this.offWall >= RELOAD || !realistic) this.reload();
      this.dist = this.tuft.hairs.map(() => 0);
      this.run = this.tuft.hairs.map(() => 0);
      this.onStrokeStart?.();
    }
    this.offWall = 0;
    const f = hit.canvas.frame;
    // axe de la touffe : « droite » de l'outil, couchée sur la toile (le fil du pinceau plat)
    _e.copy(input.right).addScaledVector(f.n, -input.right.dot(f.n));
    const th = Math.atan2(_e.dot(f.ey), _e.dot(f.ex));
    const cur = { canvas: hit.canvas, x: hit.x, y: hit.y, th, p };
    const prev = this.prev && this.prev.canvas === hit.canvas ? this.prev : null;
    if (!prev) {
      this._dab(S, cur, tool, size, paint);
    } else {
      const dist = Math.hypot(cur.x - prev.x, cur.y - prev.y);
      let dth = th - prev.th;
      dth = Math.atan2(Math.sin(dth), Math.cos(dth));
      this.speed = dt > 0 ? dist / dt : 0;
      if (dist > 0.5) this._dab(S, cur, tool, size, paint);
      else this._drag(S, prev, cur, dth, tool, size, paint);
    }
    const [a, b] = this.footprint(tool, size, p);
    this.onDeposit?.(hit.canvas, hit.x, hit.y, Math.max(a, b));
    this.prev = cur;
    return true;
  }

  _hairAt(h, s, A, B) {
    const c = Math.cos(s.th), n = Math.sin(s.th), du = h.u * A, dv = h.v * B;
    return [s.x + c * du - n * dv, s.y + n * du + c * dv];
  }

  // Premier contact : chaque poil se pose
  _dab(S, s, tool, size, paint) {
    const [A, B] = this.footprint(tool, size, s.p);
    this.tuft.hairs.forEach((h, i) => {
      const [x, y] = this._hairAt(h, s, A, B);
      this._deposit(S, i, h, x, y, s.p, h.r * 0.5, paint);
      this.dist[i] = 0;
    });
  }

  // Geste : chaque poil suit sa trajectoire et pose un tampon tous les ½ rayon
  _drag(S, a, b, dth, tool, size, paint) {
    const [A0, B0] = this.footprint(tool, size, a.p), [A1, B1] = this.footprint(tool, size, b.p);
    const reach = Math.max(A0, A1, B0, B1);
    const move = Math.max(Math.hypot(b.x - a.x, b.y - a.y) + Math.abs(dth) * reach + Math.abs(A1 - A0) + Math.abs(B1 - B0), 0);
    const n = Math.min(400, Math.max(1, Math.ceil(move / (this.tuft.rb * 0.4))));
    const hairs = this.tuft.hairs;
    const last = hairs.map(h => this._hairAt(h, a, A0, B0));
    for (let k = 1; k <= n; k++) {
      const u = k / n;
      const s = { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, th: a.th + dth * u, p: a.p + (b.p - a.p) * u };
      const A = A0 + (A1 - A0) * u, B = B0 + (B1 - B0) * u;
      for (let i = 0; i < hairs.length; i++) {
        const h = hairs[i], [x, y] = this._hairAt(h, s, A, B);
        const d = Math.hypot(x - last[i][0], y - last[i][1]);
        last[i][0] = x; last[i][1] = y;
        this.dist[i] += d;
        this.run[i] += d;
        const ds = h.r * 0.5;
        if (this.dist[i] >= ds) {
          this._deposit(S, i, h, x, y, s.p, this.dist[i], paint);
          this.dist[i] = 0;
        }
      }
    }
  }

  // Un tampon de poil. Chargé, il couvre ; en se vidant, il pâlit puis se casse
  // (le poil sec n'accroche plus que par endroits). ds : chemin qu'il représente.
  _deposit(S, i, h, x, y, p, ds, paint) {
    const L = this.load[i];
    if (L <= 0.002) return;
    const w = Math.min(1, L / 0.45);
    const gate = THREE.MathUtils.smoothstep(vnoise(this.run[i] * h.freq + h.phase) + w * 1.3 - 1, 0, 0.12);
    const a = Math.min(0.95, h.alpha * (0.3 + 0.55 * Math.sqrt(p)) * (0.35 + 0.65 * w) * gate);
    if (a <= 0.004) return;
    if (this.realistic) this.load[i] = Math.max(0, L - a * ds * DRAIN * (0.6 + 0.8 * p));
    S.push(x / S.width, y / S.height, a, 1, h.r, 0, 0, h.r, paint);
  }

  reset() {
    this.prev = null;
    this.stroking = false;
    this.contact = false;
    this.pressure = 0;
  }

  // Maillage tenu : poils à la taille choisie, couleur selon la charge
  updateMesh(tool, size, paint) {
    const m = this.meshes.get(tool.id), u = m.userData;
    if (u.size !== size) {
      u.size = size;
      u.ferrule.geometry.dispose();
      u.hair.geometry.dispose();
      u.ferrule.geometry = ferruleGeometry(tool, size);
      u.hair.geometry = hairGeometry(tool, size);
    }
    const key = (paint?.hex || '') + ':' + this.level.toFixed(2);
    if (u.key !== key) {
      u.key = key;
      u.wet.set(paint?.hex || '#888888');
      u.hairMat.color.copy(u.dry).lerp(u.wet, 0.25 + 0.75 * this.level);
      u.hairMat.roughness = 0.85 - 0.45 * this.level;
    }
  }
}

// Pinceau tenu : manche le long de +Z (vers la main), bout des poils en
// z = −reach. Virole et poils sont refaits quand la taille change.
function ferruleGeometry(t, size) {
  const g = t.kind === 'rond'
    ? new THREE.CylinderGeometry(0.0075, Math.max(0.0055, size * 0.5), 0.025, 14).rotateX(Math.PI / 2)
    : new THREE.BoxGeometry(size * 1.02, Math.max(0.006, size * 0.18), 0.025);
  return g.translate(0, 0, -FERRULE + 0.0125);
}

function hairGeometry(t, size) {
  const len = bristleLength(t, size);
  let g;
  if (t.kind === 'rond') {
    // touffe : ventre puis pointe (axe Y du tour, pointe vers −Z après rotation)
    const pts = [];
    for (let i = 0; i <= 10; i++) {
      const s = i / 10;
      pts.push(new THREE.Vector2(size * 0.5 * Math.sin(Math.min(1, (1 - s) * 1.4) * Math.PI / 2) * (1 - 0.15 * s), (s - 0.5) * len));
    }
    g = new THREE.LatheGeometry(pts, 14).rotateX(-Math.PI / 2);
  } else {
    g = new THREE.BoxGeometry(size, Math.max(0.004, size * 0.14), len);
  }
  return g.translate(0, 0, -FERRULE - len / 2);
}

function makeBrushMesh(t) {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: t.kind === 'rond' ? 0xb5362d : 0x2f5e8c, roughness: 0.45 });
  const metal = new THREE.MeshStandardMaterial({ color: 0xbfc3c9, metalness: 1, roughness: 0.3 });
  const hairMat = new THREE.MeshStandardMaterial({ color: 0xc8b48a, roughness: 0.8 });
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.0055, 0.0085, 0.17, 12), wood);
  handle.rotation.x = Math.PI / 2;
  handle.position.z = 0.01;
  const ferrule = new THREE.Mesh(ferruleGeometry(t, t.sizes[1]), metal);
  const hair = new THREE.Mesh(hairGeometry(t, t.sizes[1]), hairMat);
  g.add(handle, ferrule, hair);
  g.userData = { hair, ferrule, hairMat, size: t.sizes[1], wet: new THREE.Color(), dry: new THREE.Color(0xc8b48a), key: '' };
  g.visible = false;
  return g;
}
