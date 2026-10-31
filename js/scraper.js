import * as THREE from 'three';

// Outils de raclage. La lame balaie un quadrilatère entre deux positions ;
// le shader (paint.js) y retire la couche visible vers le « fond » (ce que le
// dernier trait avait recouvert), puis, sous forte pression, le fond lui-même.
//   width   : largeur de lame (m)        streak : pas des stries (m)
//   chip    : taille des éclats (m)      deep   : mordant (atteint le mur nu)
//   flex    : souplesse (moins de pression aux coins)
//   nicks   : part de la lame ébréchée (rayures jusqu'au mur)
//   chips / streaks : poids des éclats et des stries
//   reach   : distance manette → fil de la lame (VR)
export const SCRAPERS = [
  { id: 'couteau', name: 'Couteau', hint: 'couteau à peindre : lame souple de 3 cm, stries fines',
    width: 0.03, streak: 0.0035, chip: 0.006, deep: 0.8, flex: 0.55, nicks: 0.05, chips: 0.45, streaks: 0.8, reach: 0.17, blade: 0.07 },
  { id: 'spatule', name: 'Spatule', hint: 'spatule de 8 cm : arrache la peinture par plaques',
    width: 0.08, streak: 0.007, chip: 0.014, deep: 0.95, flex: 0.3, nicks: 0.025, chips: 1, streaks: 0.5, reach: 0.15, blade: 0.06 },
  { id: 'grattoir', name: 'Grattoir', hint: 'grattoir à lame de rasoir de 4 cm : coupe net, jusqu\'au mur',
    width: 0.04, streak: 0.005, chip: 0.01, deep: 1.35, flex: 0, nicks: 0.015, chips: 0.25, streaks: 0.3, reach: 0.12, blade: 0.025 },
];

export function scraperById(id) {
  return SCRAPERS.find(t => t.id === id) || null;
}

const PRESS_DEPTH = 0.03;   // VR : enfoncer la lame de 3 cm « dans » le mur = pression maximale

// Facteur d'attaque : angle entre l'outil et le mur (rad). Trop rasant, la
// lame glisse ; à 20–50° elle mord ; tenue droite, elle broute un peu.
function attackFactor(a) {
  if (a < 0.17) return 0.35 + 0.65 * a / 0.17;
  if (a < 0.9) return 1;
  return 1 - 0.3 * Math.min(1, (a - 0.9) / 0.67);
}

// Pression d'un outil tenu contre la toile. En VR (input.reach), elle vient de
// la profondeur à laquelle le bout de l'outil passerait derrière la toile, ou de
// la gâchette au contact ; à la souris, du réglage de pression.
export function touchPressure(hit, input, fullDepth) {
  const cosI = Math.max(0, -input.dir.dot(hit.canvas.frame.n));
  if (!input.reach) return { p: input.pressure, depth: 0, cosI };
  const depth = (input.reach - hit.t) * cosI;
  const p = depth > -0.003 ? Math.max(Math.min(1, (depth + 0.003) / fullDepth), input.trigger || 0) : 0;
  return { p, depth, cosI };
}

const _e = new THREE.Vector3();

export class Scraper {
  constructor({ project }) {
    this.project = project;     // (origin, dir, right, up) → impact sur une toile (voir Spray.project)
    this.prev = null;
    this.stroking = false;
    this.onStrokeStart = null;
    this.hit = null;
    this.contact = false;
    this.pressure = 0;
    this.speed = 0;
    this.seed = 0;
    this.meshes = new Map(SCRAPERS.map(t => [t.id, makeScraperMesh(t)]));
  }

  // input : { origin, dir, right, up, pressure } + en VR { reach, trigger } ; desktop : { attack }
  update(dt, input, tool) {
    const hit = input && tool ? this.project(input.origin, input.dir, input.right, input.up) : null;
    this.hit = hit;
    let p = 0, depth = 0;
    if (hit) {
      // pression : profondeur à laquelle le fil de la lame passerait derrière le mur
      const t = touchPressure(hit, input, PRESS_DEPTH);
      depth = t.depth;
      p = t.p * attackFactor(input.reach ? Math.asin(Math.min(1, t.cosI)) : input.attack ?? 0.5);
    }
    this.depth = depth;
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
      this.stroking = true;
      this.seed = Math.random() * 97;
      this.onStrokeStart?.();
    }
    const f = hit.canvas.frame;
    // fil de la lame : axe « droite » de l'outil, couché sur la toile
    _e.copy(input.right).addScaledVector(f.n, -input.right.dot(f.n));
    const th = Math.atan2(_e.dot(f.ey), _e.dot(f.ex));
    const S = hit.canvas.ensureSurface();
    S.setTool(tool, this.seed);
    const cur = { canvas: hit.canvas, x: hit.x, y: hit.y, th, p };
    const prev = this.prev && this.prev.canvas === hit.canvas ? this.prev : null;
    if (prev) {
      const dist = Math.hypot(cur.x - prev.x, cur.y - prev.y);
      let dth = th - prev.th;
      dth = Math.atan2(Math.sin(dth), Math.cos(dth));
      this.speed = dt > 0 ? dist / dt : 0;
      if (dist < 0.5) {
        const n = Math.min(48, Math.max(1, Math.ceil(Math.max(dist / 0.006, Math.abs(dth) / 0.06))));
        const hw = tool.width / 2;
        let a = blade(prev.x, prev.y, prev.th, hw);
        for (let i = 1; i <= n; i++) {
          const k = i / n;
          const b = blade(prev.x + (cur.x - prev.x) * k, prev.y + (cur.y - prev.y) * k, prev.th + dth * k, hw);
          const pa = prev.p + (cur.p - prev.p) * (k - 1 / n), pb = prev.p + (cur.p - prev.p) * k;
          S.pushScrape(a[0], a[1], a[2], a[3], b[2], b[3], b[0], b[1], pa, pb);
          a = b;
        }
      }
    }
    this.prev = cur;
    return true;
  }

  reset() {
    this.prev = null;
    this.stroking = false;
    this.contact = false;
    this.pressure = 0;
  }
}

// Extrémités gauche et droite de la lame
function blade(x, y, th, hw) {
  const c = Math.cos(th) * hw, s = Math.sin(th) * hw;
  return [x - c, y - s, x + c, y + s];
}

// Outil tenu : manche le long de +Z (vers la main), fil de la lame en z = −reach,
// le long de l'axe X. Origine = position de la manette.
function makeScraperMesh(t) {
  const g = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0xc9ccd1, metalness: 1, roughness: 0.28 });
  const wood = new THREE.MeshStandardMaterial({ color: t.id === 'grattoir' ? 0x2b2f36 : 0x9a6a3a, roughness: 0.7 });
  const bl = t.blade;
  if (t.id === 'couteau') {
    // lame en goutte, coudée, de plus en plus étroite vers le manche
    const shape = new THREE.Shape();
    shape.moveTo(-t.width / 2, 0);
    shape.lineTo(t.width / 2, 0);
    shape.quadraticCurveTo(t.width / 2, bl * 0.7, 0.004, bl);
    shape.lineTo(-0.004, bl);
    shape.quadraticCurveTo(-t.width / 2, bl * 0.7, -t.width / 2, 0);
    const blade = new THREE.Mesh(new THREE.ShapeGeometry(shape), steel);
    blade.material.side = THREE.DoubleSide;
    blade.rotation.x = -Math.PI / 2;
    blade.position.z = -t.reach;
    g.add(blade);
  } else {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(t.width, 0.0012, bl), steel);
    blade.position.z = -t.reach + bl / 2;
    g.add(blade);
  }
  const neckLen = t.reach - bl - 0.01;
  if (neckLen > 0) {
    const neck = new THREE.Mesh(new THREE.BoxGeometry(t.id === 'grattoir' ? t.width * 0.9 : 0.008, 0.004, neckLen), t.id === 'grattoir' ? wood : steel);
    neck.position.z = -t.reach + bl + neckLen / 2;
    g.add(neck);
  }
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.014, 0.11, 12), wood);
  handle.rotation.x = Math.PI / 2;
  handle.position.z = 0.045;
  g.add(handle);
  g.visible = false;
  return g;
}
