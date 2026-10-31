import * as THREE from 'three';

// Caches (pochoirs) posés sur une toile : la peinture ne passe pas dessous.
//
// Un cache : { shape, x, y (centre, m, repère de la toile), r (demi-taille, m),
//              rot (rad), lift (décollement du mur, m) }.
// Ils sont évalués analytiquement dans le shader des tampons (fonctions de
// distance signée), avec une parallaxe : la peinture passe sous le bord d'un
// cache décollé selon l'inclinaison du jet, et ce bord est d'autant plus flou
// que le cache est loin du mur. Les mêmes fonctions servent en JS pour viser.

export const SHAPES = [
  { id: 'rond', name: 'Rond', code: 0 },
  { id: 'carre', name: 'Carré', code: 1 },
  { id: 'triangle', name: 'Triangle', code: 2 },
  { id: 'cerceau', name: 'Cerceau', code: 3, param: 0.62 },    // rayon intérieur / extérieur
  { id: 'etoile', name: 'Étoile', code: 4, param: 0.45 },      // creux des branches
  { id: 'bande', name: 'Ruban', code: 5, param: 0.024 },       // ruban de masquage de 48 mm
];
export const MAX_MASKS = 16;   // par toile
export const MASK_SIZE = [0.03, 1.2];    // demi-taille (m)
export const MASK_LIFT = [0, 0.03];      // décollement (m)

export function shapeById(id) {
  return SHAPES.find(s => s.id === id) || SHAPES[0];
}

// Cache valide et complet (pose, chargement d'un projet)
function normalize(m) {
  return {
    shape: shapeById(m.shape).id, x: +m.x || 0, y: +m.y || 0,
    r: THREE.MathUtils.clamp(+m.r || 0.1, MASK_SIZE[0], MASK_SIZE[1]),
    rot: +m.rot || 0, lift: THREE.MathUtils.clamp(+(m.lift ?? 0.002) || 0, MASK_LIFT[0], MASK_LIFT[1]),
  };
}

export const MASK_GLSL = /* glsl */`
#define MAX_MASKS ${MAX_MASKS}
uniform int uMaskN;
uniform vec4 uMaskA[MAX_MASKS];   // centre x, y (m), cos, sin de la rotation
uniform vec4 uMaskB[MAX_MASKS];   // demi-taille (m), forme, paramètre, décollement (m)
uniform float uTexel;
float sdBox(vec2 p, vec2 b) {
  vec2 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}
float sdTri(vec2 p, float r) {
  const float k = 1.7320508;
  p.x = abs(p.x) - r;
  p.y = p.y + r / k;
  if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0;
  p.x -= clamp(p.x, -2.0 * r, 0.0);
  return -length(p) * sign(p.y);
}
float sdStar5(vec2 p, float r, float rf) {
  const vec2 k1 = vec2(0.809016994375, -0.587785252292);
  const vec2 k2 = vec2(-0.809016994375, -0.587785252292);
  p.x = abs(p.x);
  p -= 2.0 * max(dot(k1, p), 0.0) * k1;
  p -= 2.0 * max(dot(k2, p), 0.0) * k2;
  p.x = abs(p.x);
  p.y -= r;
  vec2 ba = rf * vec2(-k1.y, k1.x) - vec2(0.0, 1.0);
  float h = clamp(dot(p, ba) / dot(ba, ba), 0.0, r);
  return length(p - ba * h) * sign(p.y * ba.x - p.x * ba.y);
}
float sdMask(vec2 p, vec4 b) {
  float r = b.x;
  int t = int(b.y + 0.5);
  if (t == 0) return length(p) - r;
  if (t == 1) return sdBox(p, vec2(r));
  if (t == 2) return sdTri(p, r);
  if (t == 3) return abs(length(p) - r * (1.0 + b.z) * 0.5) - r * (1.0 - b.z) * 0.5;
  if (t == 4) return sdStar5(p, r, b.z);
  return sdBox(p, vec2(r, b.z));
}
// Part de peinture qui atteint le point P (m) de la toile. N : buse projetée
// (m) et sa distance au mur ; N.z = 0 : outil plaqué (raclage, coulure).
float maskOpen(vec2 P, vec3 N) {
  float open = 1.0;
  for (int i = 0; i < MAX_MASKS; i++) {
    if (i >= uMaskN) break;
    vec4 A = uMaskA[i], B = uMaskB[i];
    float h = B.w;
    vec2 q = P;
    float w = 0.5 * uTexel;
    if (N.z > 0.0) {
      // le jet coupe le plan du cache plus près de la buse ; un cache
      // décollé laisse filer un peu de brouillard sous son bord
      q += (N.xy - P) * (h / max(N.z, h * 1.5 + 0.005));
      w += 0.35 * h;
    }
    vec2 d = q - A.xy;
    d = vec2(A.z * d.x + A.w * d.y, -A.w * d.x + A.z * d.y);
    open *= smoothstep(-w, w, sdMask(d, B));
  }
  return open;
}`;

// Caches → uniformes du shader ; renvoie leur nombre.
export function packMasks(list, A, B) {
  const n = Math.min(list.length, MAX_MASKS);
  for (let i = 0; i < n; i++) {
    const m = list[i], s = shapeById(m.shape);
    A[i].set(m.x, m.y, Math.cos(m.rot), Math.sin(m.rot));
    B[i].set(m.r, s.code, s.param || 0, m.lift || 0);
  }
  return n;
}

// --- mêmes fonctions de distance, en JS (viser, dessiner) ---------------------
const K3 = Math.sqrt(3);
function sdBox(px, py, bx, by) {
  const dx = Math.abs(px) - bx, dy = Math.abs(py) - by;
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0);
}
function sdTri(px, py, r) {
  px = Math.abs(px) - r;
  py = py + r / K3;
  if (px + K3 * py > 0) [px, py] = [(px - K3 * py) / 2, (-K3 * px - py) / 2];
  px -= Math.min(Math.max(px, -2 * r), 0);
  return -Math.hypot(px, py) * Math.sign(py);
}
function sdStar5(px, py, r, rf) {
  const k1x = 0.809016994375, k1y = -0.587785252292, k2x = -k1x, k2y = k1y;
  px = Math.abs(px);
  let d = 2 * Math.max(k1x * px + k1y * py, 0);
  px -= d * k1x; py -= d * k1y;
  d = 2 * Math.max(k2x * px + k2y * py, 0);
  px -= d * k2x; py -= d * k2y;
  px = Math.abs(px);
  py -= r;
  const bax = rf * -k1y, bay = rf * k1x - 1;
  const h = Math.min(Math.max((px * bax + py * bay) / (bax * bax + bay * bay), 0), r);
  return Math.hypot(px - bax * h, py - bay * h) * Math.sign(py * bax - px * bay);
}
function sdLocal(shape, r, px, py) {
  const s = shapeById(shape);
  switch (s.code) {
    case 0: return Math.hypot(px, py) - r;
    case 1: return sdBox(px, py, r, r);
    case 2: return sdTri(px, py, r);
    case 3: return Math.abs(Math.hypot(px, py) - r * (1 + s.param) / 2) - r * (1 - s.param) / 2;
    case 4: return sdStar5(px, py, r, s.param);
    default: return sdBox(px, py, r, s.param);
  }
}

// Distance signée (m) du point (x, y) de la toile au bord du cache (négative dedans)
export function maskDistance(m, x, y) {
  const dx = x - m.x, dy = y - m.y, c = Math.cos(m.rot), s = Math.sin(m.rot);
  return sdLocal(m.shape, m.r, c * dx + s * dy, -s * dx + c * dy);
}

// Contours (repère local, m) : [extérieur, trou éventuel]
export function shapeOutline(shape, r) {
  const s = shapeById(shape);
  const circle = (rad, n = 64) => Array.from({ length: n }, (_, i) => [rad * Math.cos(i / n * 2 * Math.PI), rad * Math.sin(i / n * 2 * Math.PI)]);
  switch (s.code) {
    case 0: return [circle(r)];
    case 1: return [[[-r, -r], [r, -r], [r, r], [-r, r]]];
    case 2: return [[[-r, -r / K3], [r, -r / K3], [0, 2 * r / K3]]];
    case 3: return [circle(r), circle(r * s.param)];
    case 4: {
      // creux des branches : zéro de la distance entre deux pointes
      const dir = [Math.cos(Math.PI / 2 + Math.PI / 5), Math.sin(Math.PI / 2 + Math.PI / 5)];
      let a = 0, b = r;
      for (let k = 0; k < 40; k++) {
        const m = (a + b) / 2;
        if (sdLocal(shape, r, dir[0] * m, dir[1] * m) < 0) a = m; else b = m;
      }
      return [Array.from({ length: 10 }, (_, i) => {
        const ang = Math.PI / 2 + i * Math.PI / 5, rad = i % 2 ? a : r;
        return [rad * Math.cos(ang), rad * Math.sin(ang)];
      })];
    }
    default: return [[[-r, -s.param], [r, -s.param], [r, s.param], [-r, s.param]]];
  }
}

// Icône de forme pour les panneaux (canvas 2D)
export function drawShapeIcon(ctx, shape, x, y, w, h, color = '#e8e8e8') {
  const r = Math.min(w, h) * 0.36;
  const [outer, hole] = shapeOutline(shape, shape === 'bande' ? r * 1.25 : r);
  const k = shape === 'bande' ? Math.min(w, h) * 0.12 / shapeById('bande').param : 1;
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  ctx.fillStyle = color;
  ctx.beginPath();
  for (const ring of [outer, hole].filter(Boolean)) {
    ring.forEach(([px, py], i) => {
      const yy = shape === 'bande' ? Math.sign(py) * Math.min(Math.abs(py) * k, h * 0.12) : py;
      if (i) ctx.lineTo(px, -yy); else ctx.moveTo(px, -yy);
    });
    ctx.closePath();
  }
  ctx.fill('evenodd');
  ctx.restore();
}

const _m = new THREE.Matrix4();
const FILM = { color: 0x9cc8e8, opacity: 0.42 };
const TAPE = { color: 0xe6d6a2, opacity: 0.92 };

// Caches de toutes les toiles : affichage, édition et historique.
export class Stencils {
  constructor({ scene, history, canvases }) {
    this.history = history;
    this.canvases = canvases;    // () => toiles (mur + devantures)
    this.group = new THREE.Group();
    scene.add(this.group);
    this.views = new Map();      // cache → { mesh, key }
    this.hover = null;
    this.edit = null;            // geste en cours : { label, before, timer }
    this.ghost = this._makeView({ shape: 'rond', r: 0.1 }, true);
    this.ghost.mesh.visible = false;
    this.group.add(this.ghost.mesh);
  }

  list(canvas) {
    if (!canvas.masks) { canvas.masks = []; canvas.maskVersion = 0; }
    return canvas.masks;
  }

  // --- affichage ----------------------------------------------------------------
  _makeView(m, ghost = false) {
    const mesh = new THREE.Group();
    mesh.matrixAutoUpdate = false;
    const tape = m.shape === 'bande';
    const film = new THREE.MeshStandardMaterial({
      color: tape ? TAPE.color : FILM.color, transparent: true, opacity: (tape ? TAPE.opacity : FILM.opacity) * (ghost ? 0.55 : 1),
      roughness: tape ? 0.85 : 0.3, metalness: 0, side: THREE.DoubleSide, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
    const edge = new THREE.LineBasicMaterial({ color: ghost ? 0xffffff : 0x1d3b52, transparent: true, opacity: ghost ? 0.9 : 0.75, depthWrite: false });
    mesh.add(new THREE.Mesh(new THREE.BufferGeometry(), film), new THREE.Group());
    mesh.renderOrder = 3;
    return { mesh, film, edge, key: '' };
  }

  _shape(view, m) {
    const key = m.shape + ':' + m.r.toFixed(4);
    if (view.key === key) return;
    view.key = key;
    const [outer, hole] = shapeOutline(m.shape, m.r);
    const sh = new THREE.Shape(outer.map(([x, y]) => new THREE.Vector2(x, y)));
    if (hole) sh.holes.push(new THREE.Path(hole.map(([x, y]) => new THREE.Vector2(x, y)).reverse()));
    const [film, lines] = view.mesh.children;
    film.geometry.dispose();
    film.geometry = new THREE.ShapeGeometry(sh, 24);
    film.renderOrder = 3;
    for (const l of lines.children) l.geometry.dispose();
    lines.clear();
    for (const ring of [outer, hole].filter(Boolean)) {
      const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(ring.map(([x, y]) => new THREE.Vector3(x, y, 0.0005))), view.edge);
      line.renderOrder = 4;
      lines.add(line);
    }
  }

  _place(view, canvas, m) {
    const f = canvas.frame;
    _m.makeBasis(f.ex, f.ey, f.n).setPosition(f.corner);
    view.mesh.matrix.copy(_m).multiply(new THREE.Matrix4().compose(
      new THREE.Vector3(m.x, m.y, 0.006 + (m.lift || 0)),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), m.rot),
      new THREE.Vector3(1, 1, 1)));
    view.mesh.matrixWorldNeedsUpdate = true;
  }

  // À appeler après toute modification des caches d'une toile.
  changed(canvas) {
    canvas.maskVersion = (canvas.maskVersion || 0) + 1;
    const masks = this.list(canvas);
    for (const m of masks) {
      let v = this.views.get(m);
      if (!v) {
        v = this._makeView(m);
        this.views.set(m, v);
        this.group.add(v.mesh);
      }
      v.canvas = canvas;
      this._shape(v, m);
      this._place(v, canvas, m);
    }
    for (const [m, v] of this.views) {
      if (v.canvas === canvas && !masks.includes(m)) this._dropView(m, v);
    }
    this._highlight();
  }

  _dropView(m, v) {
    v.mesh.removeFromParent();
    v.mesh.children[0].geometry.dispose();
    for (const l of v.mesh.children[1].children) l.geometry.dispose();
    v.film.dispose();
    v.edge.dispose();
    this.views.delete(m);
  }

  _highlight() {
    for (const [m, v] of this.views) {
      const on = m === this.hover || m === this.edit?.mask;
      v.film.emissive.set(on ? 0x6a5a20 : 0x000000);
      v.edge.color.set(on ? 0xffe08a : 0x1d3b52);
    }
  }

  setHover(mask) {
    if (mask === this.hover) return;
    this.hover = mask;
    this._highlight();
  }

  showGhost(canvas, m) {
    if (!canvas || !m) { this.ghost.mesh.visible = false; return; }
    this._shape(this.ghost, m);
    this._place(this.ghost, canvas, m);
    this.ghost.film.color.set(m.shape === 'bande' ? TAPE.color : FILM.color);
    this.ghost.mesh.visible = true;
  }

  // --- visée --------------------------------------------------------------------
  // Cache le plus haut (le dernier posé) sous le point (x, y) de la toile.
  pick(canvas, x, y, margin = 0.004) {
    const masks = this.list(canvas);
    for (let i = masks.length - 1; i >= 0; i--) if (maskDistance(masks[i], x, y) < margin) return masks[i];
    return null;
  }

  // --- gestes (chacun annulable) ------------------------------------------------
  snapshot() {
    return this.canvases().map(c => [c, this.list(c).map(m => ({ ...m }))]);
  }

  restore(snap) {
    this.commit(false);
    for (const [c, masks] of snap) {
      c.masks = masks.map(m => ({ ...m }));
      this.changed(c);
    }
    this.hover = null;
    this._highlight();
  }

  // Ouvre un geste (si aucun n'est en cours) ; il sera enregistré par commit().
  begin(label, mask = null) {
    if (this.edit && this.edit.label === label && this.edit.mask === mask) return this.edit;
    this.commit();
    this.edit = { label, mask, before: this.snapshot() };
    this._highlight();
    return this.edit;
  }

  // Ferme le geste en cours ; il entre dans l'historique s'il a changé quelque chose.
  commit(record = true) {
    const e = this.edit;
    if (!e) return;
    clearTimeout(e.timer);
    this.edit = null;
    this._highlight();
    if (!record) return;
    const now = JSON.stringify(this.snapshot().map(([, l]) => l));
    if (now === JSON.stringify(e.before.map(([, l]) => l))) return;
    const before = e.before;
    this.history.pushCustom({ label: e.label, undo: () => this.restore(before) });
    this.onChange?.();
  }

  // Petits réglages en rafale (molette, joystick) : un seul geste après une pause.
  nudge(label, mask, fn) {
    const e = this.begin(label, mask);
    fn(mask);
    clearTimeout(e.timer);
    e.timer = setTimeout(() => { if (this.edit === e) this.commit(); }, 600);
  }

  add(canvas, spec) {
    const masks = this.list(canvas);
    if (masks.length >= MAX_MASKS) return null;
    this.begin('pose du cache');
    const m = normalize(spec);
    masks.push(m);
    this.edit.mask = m;
    this.changed(canvas);
    return m;
  }

  // Déplacement en direct (pendant un glisser)
  move(canvas, mask, x, y, rot = mask.rot) {
    Object.assign(mask, { x, y, rot });
    this.changed(canvas);
  }

  resize(canvas, mask, factor) {
    this.nudge('taille du cache', mask, m => {
      m.r = THREE.MathUtils.clamp(m.r * factor, MASK_SIZE[0], MASK_SIZE[1]);
      this.changed(canvas);
    });
  }

  rotate(canvas, mask, delta) {
    this.nudge('rotation du cache', mask, m => {
      m.rot = Math.atan2(Math.sin(m.rot + delta), Math.cos(m.rot + delta));
      this.changed(canvas);
    });
  }

  remove(canvas, mask) {
    this.commit();
    const masks = this.list(canvas), i = masks.indexOf(mask);
    if (i < 0) return;
    this.begin('retrait du cache');
    masks.splice(i, 1);
    if (this.hover === mask) this.hover = null;
    this.changed(canvas);
    this.commit();
  }

  removeAll() {
    this.commit();
    const used = this.canvases().filter(c => this.list(c).length);
    if (!used.length) return 0;
    this.begin('retrait des caches');
    let n = 0;
    for (const c of used) { n += c.masks.length; c.masks = []; this.changed(c); }
    this.hover = null;
    this.commit();
    return n;
  }

  count() {
    return this.canvases().reduce((n, c) => n + this.list(c).length, 0);
  }

  // Le mur change de largeur (centré) : les caches gardent leur place dans le monde.
  shift(canvas, dx) {
    if (!dx || !this.list(canvas).length) return;
    for (const m of canvas.masks) m.x += dx;
    this.changed(canvas);
  }

  // --- enregistrement -------------------------------------------------------------
  serialize() {
    const out = {};
    for (const c of this.canvases()) if (this.list(c).length) out[c.id] = c.masks.map(m => ({ ...m }));
    return out;
  }

  load(data = {}) {
    this.commit(false);
    for (const c of this.canvases()) {
      c.masks = (data[c.id] || []).slice(0, MAX_MASKS).map(normalize);
      this.changed(c);
    }
    this.hover = null;
  }
}
