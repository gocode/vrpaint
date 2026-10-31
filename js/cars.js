import * as THREE from 'three';
import { toCreasedNormals, mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Voitures modernes procédurales : profil latéral extrudé avec passages de
// roue découpés, habitacle vitré teinté sous un toit couleur caisse, jantes à
// branches, bandeaux de phares et de feux. Repère : avant vers +x, sol à y = 0.

const MODELS = {
  // citadine / compacte à hayon
  hatch: { L: 4.1, W: 1.8, wb: 2.6, wr: 0.32, belt: 0.95, roof: 1.47, hood: 0.86, nose: 0.55, tail: 'hatch' },
  // berline fastback
  sedan: { L: 4.75, W: 1.85, wb: 2.85, wr: 0.33, belt: 0.92, roof: 1.44, hood: 0.8, nose: 0.5, tail: 'fastback' },
  // SUV
  suv: { L: 4.6, W: 1.9, wb: 2.75, wr: 0.37, belt: 1.12, roof: 1.68, hood: 1.02, nose: 0.66, tail: 'hatch' },
};

const EXTRUDE = { steps: 1, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.05, bevelSegments: 4, curveSegments: 14 };

// Profil extrudé sur la largeur, puis galbé : `bend(x, y)` donne le facteur de
// largeur en chaque point (caisse qui s'affine vers le nez et la poupe,
// habitacle qui se resserre vers le toit).
function extrude(shape, width, opts = EXTRUDE, bend = null) {
  let g = new THREE.ExtrudeGeometry(shape, { ...opts, depth: width - 2 * opts.bevelThickness });
  g.translate(0, 0, -(width - 2 * opts.bevelThickness) / 2);
  if (bend) {
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) * bend(p.getX(i), p.getY(i)));
  }
  // arrondis lissés, grandes faces planes gardées nettes
  return toCreasedNormals(g, 0.7);
}

const planBend = m => x => 1 - 0.16 * Math.pow(Math.min(1, Math.abs(x) / (m.L / 2)), 3);
const cabinBend = m => (x, y) => planBend(m)(x) * (1 - 0.2 * Math.min(1, Math.max(0, (y - m.belt) / (m.roof - m.belt))));

// Contour de la caisse sous la ligne de ceinture, roues découpées.
function bodyShape(m) {
  const hx = m.L / 2, fx = m.wb / 2, rx = -m.wb / 2, ar = m.wr + 0.06, cy = m.wr, low = 0.24 + (m.wr - 0.32);
  const s = new THREE.Shape();
  s.moveTo(hx - 0.08, low);
  s.lineTo(fx + ar, low);
  s.absarc(fx, cy, ar, -0.18, Math.PI + 0.18, false);
  s.lineTo(rx + ar, low);
  s.absarc(rx, cy, ar, -0.18, Math.PI + 0.18, false);
  s.lineTo(-hx + 0.1, low);
  s.quadraticCurveTo(-hx - 0.02, low + 0.05, -hx, low + 0.32);
  s.lineTo(-hx + 0.04, m.belt + 0.02);
  s.lineTo(fx - 0.35, m.belt);
  s.quadraticCurveTo(fx + 0.4, m.belt - 0.04, hx - 0.25, m.hood);
  s.quadraticCurveTo(hx + 0.02, m.hood - 0.05, hx, m.nose);
  s.quadraticCurveTo(hx + 0.01, low + 0.05, hx - 0.08, low);
  return s;
}

// Habitacle : vitrage complet (pare-brise, vitres latérales, lunette).
function cabinShape(m) {
  const hx = m.L / 2, fx = m.wb / 2, s = new THREE.Shape();
  const rearTop = m.tail === 'fastback' ? -hx + 1.15 : -hx + 0.42;
  const rearBase = m.tail === 'fastback' ? -hx + 0.35 : -hx + 0.08;
  s.moveTo(rearBase, m.belt);
  if (m.tail === 'fastback') s.quadraticCurveTo(rearTop - 0.25, m.roof - 0.05, rearTop + 0.2, m.roof - 0.02);
  else s.quadraticCurveTo(-hx + 0.12, m.roof - 0.08, rearTop, m.roof - 0.02);
  s.lineTo(fx - 1.05, m.roof);
  s.quadraticCurveTo(fx - 0.55, m.roof - 0.01, fx - 0.3, m.belt + 0.02);
  s.lineTo(rearBase, m.belt);
  return { shape: s, rearTop };
}

// Toit couleur caisse posé sur l'habitacle (montants arrière compris)
function roofShape(m, rearTop) {
  const fx = m.wb / 2, s = new THREE.Shape();
  s.moveTo(rearTop - 0.05, m.roof - 0.06);
  s.lineTo(rearTop + 0.2, m.roof + 0.015);
  s.lineTo(fx - 1.05, m.roof + 0.025);
  s.quadraticCurveTo(fx - 0.85, m.roof + 0.02, fx - 0.72, m.roof - 0.02);
  s.lineTo(fx - 0.95, m.roof - 0.04);
  s.lineTo(rearTop + 0.25, m.roof - 0.045);
  s.lineTo(rearTop - 0.05, m.roof - 0.06);
  return s;
}

function wheel(m, x, z, side) {
  const tyre = new THREE.CylinderGeometry(m.wr, m.wr, 0.23, 24);
  tyre.rotateX(Math.PI / 2);
  tyre.translate(x, m.wr, z);
  const rims = [];
  const disc = new THREE.CylinderGeometry(m.wr * 0.68, m.wr * 0.68, 0.02, 24);
  disc.rotateX(Math.PI / 2);
  disc.translate(x, m.wr, z + side * 0.112);
  rims.push(disc);
  for (let k = 0; k < 5; k++) {
    const sp = new THREE.BoxGeometry(m.wr * 1.25, 0.05, 0.03);
    sp.rotateZ(k * Math.PI / 5);
    sp.translate(x, m.wr, z + side * 0.125);
    rims.push(sp);
  }
  return { tyre, rims };
}

// Construit les géométries d'un modèle (repère local de la voiture).
function buildModel(m) {
  const body = [extrude(bodyShape(m), m.W, EXTRUDE, planBend(m))];
  const { shape, rearTop } = cabinShape(m);
  const glass = [extrude(shape, m.W - 0.2, { ...EXTRUDE, bevelThickness: 0.04, bevelSize: 0.03 }, cabinBend(m))];
  body.push(extrude(roofShape(m, rearTop), m.W - 0.16, { ...EXTRUDE, bevelThickness: 0.04, bevelSize: 0.02, bevelSegments: 3 }, cabinBend(m)));
  // rétroviseurs
  for (const side of [-1, 1]) {
    const mir = new THREE.BoxGeometry(0.16, 0.1, 0.18);
    mir.translate(m.wb / 2 - 0.42, m.belt + 0.08, side * (m.W / 2 + 0.06));
    body.push(mir);
  }
  const dark = [];
  // plancher et boucliers noirs
  const floor = new THREE.BoxGeometry(m.wb + 0.4, 0.14, m.W - 0.3);
  floor.translate(0, 0.25 + (m.wr - 0.32), 0);
  dark.push(floor);
  for (const sx of [1, -1]) {
    const skirt = new THREE.BoxGeometry(0.5, 0.12, m.W - 0.06);
    skirt.translate(sx * (m.L / 2 - 0.3), 0.3 + (m.wr - 0.32), 0);
    dark.push(skirt);
  }
  const tyres = [], rims = [];
  for (const x of [m.wb / 2, -m.wb / 2]) for (const side of [-1, 1]) {
    const w = wheel(m, x, side * (m.W / 2 - 0.16), side);
    tyres.push(w.tyre);
    rims.push(...w.rims);
  }
  const head = [], tail = [];
  for (const side of [-1, 1]) {
    // bandeau de phare qui suit le nez affiné de la caisse
    const h = new THREE.BoxGeometry(0.09, 0.05, 0.38);
    h.translate(m.L / 2 - 0.02, m.nose + 0.18, side * (m.W / 2 - 0.3) * planBend(m)(m.L / 2));
    head.push(h);
  }
  const bar = new THREE.BoxGeometry(0.09, 0.06, (m.W - 0.25) * planBend(m)(m.L / 2));
  bar.translate(-m.L / 2 + 0.02, m.belt - 0.08, 0);
  tail.push(bar);
  // toutes les pièces non indexées : elles sont fusionnées ensemble par matériau
  const ni = list => list.map(g => (g.index ? g.toNonIndexed() : g));
  // ombre de contact au sol
  const shadow = new THREE.PlaneGeometry(m.L + 0.5, m.W + 0.5);
  shadow.rotateX(-Math.PI / 2);
  shadow.translate(0, 0.012, 0);
  return { body: ni(body), glass: ni(glass), dark: ni(dark), tyres: ni(tyres), rims: ni(rims), head: ni(head), tail: ni(tail), shadow: ni([shadow]) };
}

const cache = {};
function model(id) {
  return cache[id] || (cache[id] = buildModel(MODELS[id]));
}

function shadowTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const x = c.getContext('2d');
  x.filter = 'blur(14px)';
  x.fillStyle = 'rgba(0,0,0,0.75)';
  x.beginPath(); x.roundRect(34, 24, 188, 80, 30); x.fill();
  return new THREE.CanvasTexture(c);
}

export const CAR_MATERIALS = {
  shadow: new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false }),
  glass: new THREE.MeshStandardMaterial({ color: 0x11161b, roughness: 0.08, metalness: 0.9 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x18191b, roughness: 0.8 }),
  tyre: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.95 }),
  rim: new THREE.MeshStandardMaterial({ color: 0xc9cdd2, roughness: 0.35, metalness: 0.6 }),
  head: new THREE.MeshStandardMaterial({ color: 0xdfe6ee, roughness: 0.2, emissive: 0xf4f8ff, emissiveIntensity: 0 }),
  tail: new THREE.MeshStandardMaterial({ color: 0x8a0f12, roughness: 0.3, emissive: 0xff2020, emissiveIntensity: 0 }),
};

export const CAR_COLORS = [0xe9ebee, 0x1d1f22, 0x7a7f86, 0xb9bec4, 0x1c3d6e, 0x8c1116, 0x2f4a3a, 0xd9d4c7, 0x5a2a6e];

// Ajoute une voiture aux listes de géométries à fusionner (par matériau).
export function addCar(add, bodyMat, kind, x, y, z, heading) {
  const g = model(kind);
  const mtx = new THREE.Matrix4().makeRotationY(heading).setPosition(x, y, z);
  const put = (mat, list) => list.forEach(geo => add(mat, geo.clone().applyMatrix4(mtx)));
  put(bodyMat, g.body);
  put(CAR_MATERIALS.glass, g.glass);
  put(CAR_MATERIALS.dark, g.dark);
  put(CAR_MATERIALS.tyre, g.tyres);
  put(CAR_MATERIALS.rim, g.rims);
  put(CAR_MATERIALS.head, g.head);
  put(CAR_MATERIALS.tail, g.tail);
  put(CAR_MATERIALS.shadow, g.shadow);
}

export const CAR_KINDS = Object.keys(MODELS);
export const CAR_LENGTH = id => MODELS[id].L;

// ---------------------------------------------------------------------------
// Circulation : de temps en temps une voiture passe sur l'une des deux voies.
// Phares et feux allumés la nuit, faisceau des phares projeté sur la chaussée.

const MOVING = {
  head: new THREE.MeshStandardMaterial({ color: 0xdfe6ee, roughness: 0.2, emissive: 0xf4f8ff, emissiveIntensity: 0 }),
  tail: new THREE.MeshStandardMaterial({ color: 0x8a0f12, roughness: 0.3, emissive: 0xff2020, emissiveIntensity: 0 }),
};

function beamTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 256;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 256, 10, 64, 200, 230);
  g.addColorStop(0, 'rgba(255,245,220,0.55)');
  g.addColorStop(1, 'rgba(255,245,220,0)');
  x.fillStyle = g;
  x.beginPath(); x.moveTo(50, 256); x.lineTo(78, 256); x.lineTo(128, 0); x.lineTo(0, 0); x.closePath(); x.fill();
  return new THREE.CanvasTexture(c);
}

const _sphere = new THREE.Sphere();
const partsCache = {};
function carParts(kind) {
  if (partsCache[kind]) return partsCache[kind];
  const g = model(kind), m = MODELS[kind];
  const merged = list => mergeGeometries(list.map(x => x.clone()));
  const beam = new THREE.PlaneGeometry(2.4, 9);
  beam.rotateX(-Math.PI / 2);
  beam.rotateY(-Math.PI / 2);
  beam.translate(m.L / 2 + 4.5, 0.02, 0);
  return (partsCache[kind] = {
    body: merged(g.body), glass: merged(g.glass), dark: merged(g.dark), tyres: merged(g.tyres),
    rims: merged(g.rims), head: merged(g.head), tail: merged(g.tail), shadow: merged(g.shadow), beam,
  });
}

export class Traffic {
  constructor(parent, lanes, length) {
    this.parent = parent;
    this.lanes = lanes.map(l => ({ ...l, cars: [], timer: 2 + Math.random() * 8 }));
    this.length = length;
    this.pool = [];
    this.bodyMats = CAR_COLORS.map(col => new THREE.MeshStandardMaterial({ color: col, roughness: 0.28, metalness: 0.55 }));
    this.beamMat = new THREE.MeshBasicMaterial({ map: beamTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    this.night = false;
  }

  _make() {
    const kind = CAR_KINDS[Math.floor(Math.random() * CAR_KINDS.length)];
    const p = carParts(kind);
    const g = new THREE.Group();
    const body = new THREE.Mesh(p.body, this.bodyMats[Math.floor(Math.random() * this.bodyMats.length)]);
    g.add(body, new THREE.Mesh(p.glass, CAR_MATERIALS.glass), new THREE.Mesh(p.dark, CAR_MATERIALS.dark),
      new THREE.Mesh(p.tyres, CAR_MATERIALS.tyre), new THREE.Mesh(p.rims, CAR_MATERIALS.rim),
      new THREE.Mesh(p.head, MOVING.head), new THREE.Mesh(p.tail, MOVING.tail), new THREE.Mesh(p.shadow, CAR_MATERIALS.shadow));
    const beam = new THREE.Mesh(p.beam, this.beamMat);
    beam.visible = this.night;
    g.add(beam);
    g.userData = { kind, len: MODELS[kind].L, beam, body };
    return g;
  }

  setNight(night) {
    this.night = night;
    MOVING.head.emissiveIntensity = night ? 3 : 0.4;
    MOVING.tail.emissiveIntensity = night ? 1.6 : 0.2;
    for (const l of this.lanes) for (const c of l.cars) c.obj.userData.beam.visible = night;
  }

  update(dt) {
    const half = this.length / 2;
    for (const lane of this.lanes) {
      const dir = Math.cos(lane.heading) > 0 ? 1 : -1;
      lane.timer -= dt;
      const last = lane.cars[lane.cars.length - 1];
      if (lane.timer <= 0 && (!last || Math.abs(last.x + dir * half) > 30)) {
        const obj = this.pool.pop() || this._make();
        obj.userData.body.material = this.bodyMats[Math.floor(Math.random() * this.bodyMats.length)];
        obj.userData.beam.visible = this.night;
        obj.rotation.y = lane.heading;
        this.parent.add(obj);
        lane.cars.push({ obj, x: -dir * half, v: 7 + Math.random() * 4.5 });
        lane.timer = 6 + Math.random() * 22;
      }
      for (let i = 0; i < lane.cars.length; i++) {
        const c = lane.cars[i], ahead = lane.cars[i - 1];
        let v = c.v;
        // garder ses distances avec la voiture de devant
        if (ahead && Math.abs(ahead.x - c.x) < 14) v = Math.min(v, ahead.v * 0.95);
        c.x += dir * v * dt;
        c.obj.position.set(c.x, lane.y, lane.z);
      }
      while (lane.cars.length && Math.abs(lane.cars[0].x) > half + 5) {
        const c = lane.cars.shift();
        c.obj.removeFromParent();
        this.pool.push(c.obj);
      }
    }
  }

  // Une voiture roule-t-elle dans ce champ de vision ? (phares compris la nuit)
  movingIn(frustum) {
    for (const l of this.lanes) for (const c of l.cars) {
      _sphere.center.set(c.x, l.y + 0.7, l.z);
      _sphere.radius = c.obj.userData.len / 2 + (this.night ? 9.5 : 0.5);
      if (frustum.intersectsSphere(_sphere)) return true;
    }
    return false;
  }

  // Voiture en mouvement la plus proche d'un point (pour le son)
  nearest(p) {
    let best = Infinity;
    for (const l of this.lanes) for (const c of l.cars) best = Math.min(best, Math.hypot(c.x - p.x, l.z - p.z));
    return best;
  }
}