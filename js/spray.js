import * as THREE from 'three';

// Caps (embouts). angle : demi-angle du cône de pulvérisation (en degrés),
// flow : débit relatif, sx/sy : étirement du jet (flat cap = éventail).
export const CAPS = [
  { id: 'skinny', name: 'Skinny', hint: 'trait fin, détails', angle: 2.2, flow: 0.35, sx: 1, sy: 1 },
  { id: 'standard', name: 'Standard', hint: 'trait moyen, polyvalent', angle: 5, flow: 1, sx: 1, sy: 1 },
  { id: 'fat', name: 'Fat', hint: 'remplissage', angle: 11, flow: 3, sx: 1, sy: 1 },
  { id: 'superfat', name: 'Super fat', hint: 'grands aplats, fonds', angle: 18, flow: 5.5, sx: 1, sy: 1 },
  { id: 'flat', name: 'Flat', hint: 'éventail plat, remplissage et calligraphie', angle: 10, flow: 6, sx: 3.5, sy: 0.35 },
];

// Potentiomètre de largeur : élargit le cône ; le débit suit (un embout plus
// large laisse passer plus de peinture), donc la couverture par passe reste proche.
export function tuneCap(cap, scale = 1) {
  return { ...cap, scale, angle: cap.angle * scale, flow: cap.flow * Math.pow(scale, 1.3) };
}

// Largeur visible du trait (cm) à une distance donnée
export function strokeWidthCm(cap, distance = 0.15) {
  return 3 * distance * Math.tan(cap.angle * Math.PI / 180) * cap.sx * 100;
}

const Q0 = 0.05;      // m² de couverture opaque par seconde (cap standard, gâchette à fond, de près)
const DROP_RATE = 1600;  // gouttelettes visibles par seconde (cap standard)
const MAX_T = 1.4;       // au-delà de 1,4 m la peinture n'atteint plus le mur
const WET_CELL = 0.015;  // maille de la carte d'épaisseur de peinture fraîche (m)
const WET_LIMIT = 25;    // épaisseur (en couches opaques) à partir de laquelle ça coule
const DRY_TIME = 4;      // constante de séchage (s)
const MAX_DRIPS = 96;

const _d = new THREE.Vector3();
const _p = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _s = { x: 0, y: 0, t: 0, rx: 0, ry: 0, ux: 0, uy: 0 };

let gaussSpare = null;
function gauss() {
  if (gaussSpare !== null) { const g = gaussSpare; gaussSpare = null; return g; }
  let u = 0;
  while (u === 0) u = Math.random();
  const r = Math.sqrt(-2 * Math.log(u)), th = 2 * Math.PI * Math.random();
  gaussSpare = r * Math.sin(th);
  return r * Math.cos(th);
}

function pressureFlow(p) {
  return p <= 0.03 ? 0 : Math.pow((p - 0.03) / 0.97, 1.3);
}

function lerpHit(a, b, f, o) {
  o.x = a.x + (b.x - a.x) * f;
  o.y = a.y + (b.y - a.y) * f;
  o.t = a.t + (b.t - a.t) * f;
  o.rx = a.rx + (b.rx - a.rx) * f;
  o.ry = a.ry + (b.ry - a.ry) * f;
  o.ux = a.ux + (b.ux - a.ux) * f;
  o.uy = a.uy + (b.uy - a.uy) * f;
  return o;
}

// Simulation de la bombe : projection du cône sur la surface visée (mur,
// devanture…), nuage fin + gouttelettes, peinture fraîche et coulures.
//
// Une « toile » (canvas) est un rectangle peignable :
//   { id, frame: { corner, ex, ey, n }, width, height, ensureSurface() }
// Sa surface de peinture n'est créée qu'au premier coup de bombe.
const EDGE = 0.3;   // le jet déborde un peu des bords

export class Spray {
  constructor() {
    this.canvases = [];
    this.wetByCanvas = new Map();
    this.drips = [];
    this.prev = null;
    this.stroking = false;
    this.paint = null;
    this.cap = CAPS[1];
    this.dripsEnabled = true;
    this.onStrokeStart = null;
    this.hit = null;
    this.pressure = 0;
  }

  setCanvases(list) {
    this.canvases = list;
    this.reset();
  }

  reset() {
    this.wetByCanvas.clear();
    this.drips.length = 0;
    this.prev = null;
  }

  _wet(canvas) {
    let w = this.wetByCanvas.get(canvas);
    if (!w) {
      const gw = Math.ceil(canvas.width / WET_CELL), gh = Math.ceil(canvas.height / WET_CELL);
      w = { gw, gh, wet: new Float32Array(gw * gh), cells: new Set() };
      this.wetByCanvas.set(canvas, w);
    }
    return w;
  }

  // Intersection du jet avec une toile. Les axes r/u du nozzle sont projetés
  // parallèlement au jet : un jet oblique donne une tache étirée.
  projectOn(canvas, origin, dir, right, up) {
    const f = canvas.frame, n = f.n;
    const denom = dir.dot(n);
    if (denom > -0.1) return null;
    const t = _d.subVectors(f.corner, origin).dot(n) / denom;
    if (t < -0.05 || t > 3) return null;
    _p.copy(origin).addScaledVector(dir, t).sub(f.corner);
    const x = _p.dot(f.ex), y = _p.dot(f.ey);
    if (x < -EDGE || y < -EDGE || x > canvas.width + EDGE || y > canvas.height + EDGE) return null;
    const kr = right.dot(n) / denom, ku = up.dot(n) / denom;
    _a.copy(right).addScaledVector(dir, -kr);
    _b.copy(up).addScaledVector(dir, -ku);
    return {
      canvas, x, y, t: Math.max(t, 0.012),
      rx: _a.dot(f.ex), ry: _a.dot(f.ey), ux: _b.dot(f.ex), uy: _b.dot(f.ey),
    };
  }

  // Toile la plus proche dans l'axe du jet
  project(origin, dir, right, up) {
    let best = null;
    for (const c of this.canvases) {
      const h = this.projectOn(c, origin, dir, right, up);
      if (h && (!best || h.t < best.t)) best = h;
    }
    return best;
  }

  // input : { pressure 0..1, origin, dir, right, up } (Vector3 monde) ou null
  update(dt, input) {
    const hit = input ? this.project(input.origin, input.dir, input.right, input.up) : null;
    this.hit = hit;
    const p = input ? input.pressure : 0;
    const active = !!(hit && p > 0.03 && hit.t < MAX_T && this.paint);
    this.pressure = active ? p : 0;
    if (active) {
      if (!this.stroking && this.onStrokeStart) this.onStrokeStart();
      this.stroking = true;
      const tanA = Math.tan(this.cap.angle * Math.PI / 180);
      const prev = this.prev && this.prev.canvas === hit.canvas ? this.prev : null;
      const minR = hit.canvas.ensureSurface().texel * 0.75;
      let n = 1;
      if (prev) {
        const seg = Math.hypot(hit.x - prev.x, hit.y - prev.y);
        const sig = hit.t * tanA * Math.min(this.cap.sx, this.cap.sy);
        if (seg < 0.5) n = Math.min(64, Math.max(1, Math.ceil(seg / Math.max(sig * 0.5, minR))));
      }
      for (let i = 1; i <= n; i++) {
        this._emit(prev && n > 1 ? lerpHit(prev, hit, i / n, _s) : hit, dt / n, p, tanA, hit.canvas);
      }
      this.prev = hit;
    } else {
      this.prev = null;
      if (p <= 0.03) this.stroking = false;
    }
    this._dry(dt);
    this._runDrips(dt);
    return active;
  }

  _emit(s, dt, p, tanA, canvas) {
    const cap = this.cap, paint = this.paint, S = canvas.ensureSurface();
    const W = canvas.width, H = canvas.height, minR = S.texel * 0.75;
    const sigma = s.t * tanA;
    const sx = sigma * cap.sx, sy = sigma * cap.sy;
    let ax = s.rx * sx, ay = s.ry * sx, bx = s.ux * sy, by = s.uy * sy;
    const det = Math.abs(ax * by - ay * bx) + 1e-9;
    // Un jet plus fin qu'un texel tomberait entre les pixels : on l'élargit
    // au minimum rendable, la dose (∝ 1/aire) baisse d'autant.
    const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by), minSig = minR * 0.8;
    if (la < minSig) { ax *= minSig / la; ay *= minSig / la; }
    if (lb < minSig) { bx *= minSig / lb; by *= minSig / lb; }
    const detDraw = Math.abs(ax * by - ay * bx) + 1e-9;
    const pf = pressureFlow(p);
    const eff = 1 / (1 + (s.t / 0.45) ** 2);   // de loin, une partie du nuage se perd
    const mass = Q0 * cap.flow * pf * eff * dt;
    const u = s.x / W, v = s.y / H;

    // Nuage fin : profil gaussien, le shader convertit la dose en couverture.
    const dose = mass * 0.85 / (2 * Math.PI * detDraw);
    // la buse (s.x, s.y, à s.t du mur) sert à la parallaxe des caches décollés
    S.push(u, v, dose, 0, ax * 3, ay * 3, bx * 3, by * 3, paint, s.x, s.y, s.t);

    // Gouttelettes : grain de la bombe, plus un halo d'overspray.
    let nd = Math.floor(DROP_RATE * cap.flow ** 0.8 * pf * eff * dt + Math.random());
    const spit = 1 + (1 - p) * 1.6;           // gâchette à moitié : jet qui crachote
    while (nd-- > 0) {
      const far = Math.random() < 0.28;
      const k = far ? 2.1 : 1.1;
      const g1 = gauss() * k, g2 = gauss() * k;
      let r = (0.0005 + Math.random() * Math.random() * 0.0016) * spit;
      let a = (far ? 0.35 : 0.7) * (0.5 + Math.random() * 0.5);
      if (r < minR) { a *= (r / minR) ** 2; r = minR; }
      S.push(u + (g1 * ax + g2 * bx) / W, v + (g1 * ay + g2 * by) / H, a, 1,
        s.rx * r, s.ry * r, s.ux * r, s.uy * r, paint, s.x, s.y, s.t);
    }
    if (p < 0.45 && Math.random() < dt * 10 * (0.45 - p)) {
      const r = 0.0015 + Math.random() * 0.002, g1 = gauss(), g2 = gauss();
      S.push(u + (g1 * ax + g2 * bx) / W, v + (g1 * ay + g2 * by) / H, 0.9, 1,
        s.rx * r, s.ry * r, s.ux * r, s.uy * r, paint, s.x, s.y, s.t);
    }

    // Peinture fraîche accumulée sous le jet.
    const w = this._wet(canvas);
    const cx = Math.floor(s.x / WET_CELL), cy = Math.floor(s.y / WET_CELL);
    if (cx >= 0 && cy >= 0 && cx < w.gw && cy < w.gh) {
      const i = cy * w.gw + cx;
      w.wet[i] += mass / Math.max(WET_CELL * WET_CELL, 2 * Math.PI * det);
      w.cells.add(i);
    }
  }

  _dry(dt) {
    const k = Math.exp(-dt / DRY_TIME);
    for (const [canvas, w] of this.wetByCanvas) {
      for (const i of w.cells) {
        let v = w.wet[i] * k;
        if (v > WET_LIMIT) {
          if (this.dripsEnabled) this._spawnDrip(canvas, w, i);
          v = WET_LIMIT * 0.4;
        }
        if (v < 0.02) { v = 0; w.cells.delete(i); }
        w.wet[i] = v;
      }
    }
  }

  _spawnDrip(canvas, w, i) {
    const existing = this.drips.find(d => d.canvas === canvas && d.cell === i);
    if (existing) { existing.vol += 0.5; return; }
    if (this.drips.length >= MAX_DRIPS) return;
    const cx = i % w.gw, cy = (i / w.gw) | 0;
    const y = (cy + 0.35) * WET_CELL;
    this.drips.push({
      canvas,
      cell: i,
      x: (cx + 0.2 + Math.random() * 0.6) * WET_CELL,
      y, ty: y,
      vol: 0.5 + Math.random() * 0.5,
      v: 0,
      r: (0.0016 + Math.random() * 0.0012) * Math.pow(this.cap.flow, 0.25),
      paint: this.paint,
    });
  }

  _runDrips(dt) {
    for (let k = this.drips.length - 1; k >= 0; k--) {
      const d = this.drips[k], c = d.canvas, S = c.ensureSurface(), W = c.width, H = c.height;
      const vmax = 0.012 + 0.06 * Math.min(d.vol, 1.5);
      d.v += (vmax - d.v) * Math.min(1, dt * 3);
      const dy = d.v * dt;
      d.y -= dy;
      d.vol -= dy * 6;
      const step = d.r * 0.5;
      while (d.ty - d.y >= step) {
        d.ty -= step;
        d.x += (Math.random() - 0.5) * 0.00025;
        S.push(d.x / W, d.ty / H, 0.92, 1, d.r * 0.8, 0, 0, d.r, d.paint);
      }
      if (d.vol <= 0 || d.y < 0.004) {
        // perle au bout de la coulure
        S.push(d.x / W, (d.ty - d.r * 0.4) / H, 0.95, 1, d.r * 1.45, 0, 0, d.r * 1.7, d.paint);
        this.drips.splice(k, 1);
      }
    }
  }
}