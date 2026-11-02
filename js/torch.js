import * as THREE from 'three';

// Chalumeau : sèche la peinture fraîche à distance. Sous la flamme, la peinture
// « prend » des dizaines de fois plus vite : le papier journal n'y boit plus
// presque rien, et la peinture trop chargée ne coule plus (les coulures en
// cours se figent). Il ne pose ni n'enlève rien sur le mur : aucun geste à annuler.
// La chaleur se perd avec la distance ; la flamme, plus loin, chauffe plus large.
// La taille de la flamme (barre, comme le papier journal) est la largeur de la zone
// chauffée au contact : une grande flamme sèche d'un coup une grande surface, aussi
// vite, et porte plus loin.
export const TORCH = {
  id: 'chalumeau', name: 'Chalumeau', label: 'Flamme du chalumeau',
  hint: 'chalumeau : sécher la peinture fraîche, de près (touche T)',
  size: 0.06,               // largeur de la zone chauffée, flamme au contact (m)…
  range: [0.03, 0.3],       // …réglable à la barre, au centimètre
  sizeTitle: 'Taille de la flamme (zone chauffée au contact)', sizeWord: 'Flamme',
};

const FLAME = 0.25;     // flamme moyenne : au-delà de 25 cm du mur, elle ne chauffe plus
const AGE = 40;         // en plein feu, au contact, la peinture vieillit de 40 s par seconde
const SPREAD = 0.3;     // la zone chauffée s'élargit de 30 % de la distance

// Portée de la flamme (m) : 25 cm pour la flamme moyenne, de 18 à 50 cm selon sa taille
export function torchReach(size) {
  return Math.min(0.5, Math.max(0.18, FLAME * Math.sqrt(size / TORCH.size)));
}

export class Torch {
  // project : (origin, dir, right, up) → impact ; fresh : carte de fraîcheur (newspaper.js) ; spray : coulures
  constructor({ project, fresh, spray }) {
    Object.assign(this, { project, fresh, spray });
    this.hit = null;
    this.flame = 0;          // gâchette (0..1), pour la flamme, le son et les vibrations
    this.heat = 0;           // chaleur reçue par le mur (0..1)
    this.size = TORCH.size;
    this.reach = FLAME;
    this.radius = TORCH.size / 2;
    this.mesh = makeTorchMesh();
    this.glow = makeGlow();
    this._t = 0;
  }

  // input : { origin, dir, right, up, pressure } ou null ; size : taille de la flamme (m)
  update(dt, input, size = this.size) {
    this._t += dt;
    this.size = size;
    this.reach = torchReach(size);
    const hit = input ? this.project(input.origin, input.dir, input.right, input.up) : null;
    this.hit = hit;
    this.flame = input && input.pressure > 0.05 ? input.pressure : 0;
    this.heat = hit && this.flame ? this.flame * Math.max(0, 1 - hit.t / this.reach) : 0;
    this.radius = size / 2 + SPREAD * (hit ? hit.t : 0);
    if (this.heat > 0) {
      const { canvas, x, y } = hit;
      this.fresh.age(canvas, x, y, this.radius, AGE * this.heat * dt);
      this.spray.heat(canvas, x, y, this.radius, this.heat * dt);
    }
    this._show(hit);
    return this.heat > 0;
  }

  // flamme qui vacille au bout de la buse, plus large et plus longue quand elle est
  // plus grande, écrasée par le mur ; lueur sur le mur chauffé
  _show(hit) {
    const f = this.mesh.userData.flame, k = this.flame;
    f.visible = k > 0;
    if (k > 0) {
      const flick = 0.85 + 0.15 * Math.sin(this._t * 53) * Math.sin(this._t * 31 + 1);
      const len = Math.min(this.reach, hit ? hit.t : this.reach) / FLAME, wide = (this.size / TORCH.size) ** 0.7;
      f.scale.set((0.6 + 0.4 * k) * wide, (0.6 + 0.4 * k) * wide, Math.max(0.15, len) * (0.5 + 0.5 * k) * flick);
    }
    const g = this.glow;
    g.visible = this.heat > 0;
    if (g.visible) {
      const fr = hit.canvas.frame;
      g.position.copy(fr.corner).addScaledVector(fr.ex, hit.x).addScaledVector(fr.ey, hit.y).addScaledVector(fr.n, 0.003);
      g.quaternion.setFromUnitVectors(_z, fr.n);
      g.scale.setScalar(this.radius);
      g.material.opacity = 0.15 + 0.45 * this.heat;
    }
  }

  reset() {
    this.hit = null;
    this.flame = this.heat = 0;
    this.mesh.userData.flame.visible = false;
    this.glow.visible = false;
  }
}

const _z = new THREE.Vector3(0, 0, 1);

// Chalumeau tenu : cartouche de gaz dans la main, tube et buse vers −Z, flamme
// partant de l'origine (le bout de la buse) vers −Z, longue de FLAME à pleine gâchette.
function makeTorchMesh() {
  const g = new THREE.Group();
  const can = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.13, 20),
    new THREE.MeshStandardMaterial({ color: 0x1f5fb4, roughness: 0.4, metalness: 0.3 }));
  can.position.set(0, -0.08, 0.12);
  const brass = new THREE.MeshStandardMaterial({ color: 0xc9a25a, metalness: 1, roughness: 0.35 });
  const valve = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.018, 0.03, 16), brass);
  valve.position.set(0, -0.002, 0.12);
  const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.012, 12),
    new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.6 }));
  knob.rotation.z = Math.PI / 2;
  knob.position.set(0.022, 0, 0.12);
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.008, 0.12, 12), brass);
  tube.rotation.x = Math.PI / 2;
  tube.position.set(0, 0, 0.065);
  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.009, 0.02, 14), brass);
  nozzle.rotation.x = Math.PI / 2;
  nozzle.position.set(0, 0, 0.0);
  // flamme : dard bleu dans une enveloppe orangée, en mélange additif
  const flame = new THREE.Group();
  const cone = (r, color, op) => {
    const m = new THREE.Mesh(new THREE.ConeGeometry(r, FLAME, 16, 1, true).translate(0, FLAME / 2, 0).rotateX(Math.PI / 2),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    m.rotation.x = Math.PI;   // large à la buse, pointe vers −Z
    return m;
  };
  flame.add(cone(0.016, 0xff8a2a, 0.45), cone(0.007, 0x5aa0ff, 0.9));
  flame.position.set(0, 0, -0.01);
  flame.visible = false;
  g.add(can, valve, knob, tube, nozzle, flame);
  g.userData.flame = flame;
  g.visible = false;
  return g;
}

function makeGlow() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d'), grd = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,190,110,1)');
  grd.addColorStop(0.5, 'rgba(255,120,40,0.45)');
  grd.addColorStop(1, 'rgba(255,80,20,0)');
  x.fillStyle = grd;
  x.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
  m.visible = false;
  m.renderOrder = 5;
  return m;
}
