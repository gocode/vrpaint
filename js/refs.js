import * as THREE from 'three';
import { state, set, subscribe } from './state.js';

// Modèles photo : images de référence enregistrées avec le projet. En VR, la
// photo choisie s'affiche à côté de la palette (ou sur un chevalet près du mur).

export const REF_SIDES = [['gauche', 'Gauche'], ['droite', 'Droite'], ['dessus', 'Dessus']];
const MAX_SIDE = 1600;   // les photos sont réduites à l'import pour la mémoire du casque

let nextId = 1;

// Lit un fichier image, le réduit et le convertit en Blob JPEG.
export async function importImage(file) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.88));
  return { id: 'r' + Date.now().toString(36) + (nextId++), name: file.name.replace(/\.[^.]+$/, ''), blob, w, h };
}

export function addRefs(list) {
  const refs = [...(state.refs || []), ...list];
  set({ refs, refIndex: refs.length - 1, refShow: true });
}

export function removeRef(id) {
  const refs = (state.refs || []).filter(r => r.id !== id);
  set({ refs, refIndex: Math.min(state.refIndex, refs.length - 1) });
}

export function currentRef() {
  const refs = state.refs || [];
  return refs[Math.max(0, Math.min(state.refIndex, refs.length - 1))] || null;
}

// Images décodées (pour les vignettes de la palette VR et les textures)
const bitmaps = new Map();
export function refBitmap(ref, onReady) {
  let e = bitmaps.get(ref.id);
  if (!e) {
    e = { bmp: null };
    bitmaps.set(ref.id, e);
    createImageBitmap(ref.blob).then(b => { e.bmp = b; onReady?.(); });
  }
  return e.bmp;
}

export class RefBoard {
  constructor({ scene, palette, wall }) {
    this.palette = palette;
    this.wall = wall;
    this.texture = null;
    this.mat = new THREE.MeshBasicMaterial({ toneMapped: false, side: THREE.DoubleSide });
    // à côté de la palette
    this.hand = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.mat);
    this.hand.visible = false;
    palette.mesh.add(this.hand);
    // sur un chevalet, à gauche du mur
    this.easel = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0x6b4a2e, roughness: 0.8 });
    for (const [x, rz] of [[-0.35, -0.12], [0.35, 0.12]]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.9, 0.04), wood);
      leg.position.set(x, 0.95, 0);
      leg.rotation.z = rz;
      this.easel.add(leg);
    }
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.8, 0.04), wood);
    back.position.set(0, 0.9, -0.35);
    back.rotation.x = -0.35;
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.04, 0.08), wood);
    shelf.position.set(0, 0.85, 0.02);
    this.easelImg = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.mat);
    this.easel.add(back, shelf, this.easelImg);
    this.easel.visible = false;
    scene.add(this.easel);
    this.shownId = null;
    subscribe(() => this.update());
    this.update();
  }

  update() {
    const ref = currentRef();
    if (ref && ref.id !== this.shownId) {
      this.shownId = ref.id;
      const bmp = refBitmap(ref, () => { this.shownId = null; this.update(); });
      if (bmp) {
        this.texture?.dispose();
        this.texture = new THREE.Texture(bmp);
        this.texture.colorSpace = THREE.SRGBColorSpace;
        this.texture.needsUpdate = true;
        this.mat.map = this.texture;
        this.mat.needsUpdate = true;
      } else {
        this.shownId = null;
      }
    }
    const show = !!(ref && state.refShow && this.mat.map);
    const aspect = ref ? ref.w / ref.h : 1;
    // palette : 0,2 m de large ; le modèle fait 0,22 m de haut à la taille 100 %
    const h = 0.22 * (state.refScale || 1), w = h * aspect;
    const PW = 0.2, PH = 0.3125, gap = 0.015;
    const side = state.refSide || 'droite';
    this.hand.scale.set(w, h, 1);
    if (side === 'gauche') this.hand.position.set(-PW / 2 - gap - w / 2, 0, 0);
    else if (side === 'droite') this.hand.position.set(PW / 2 + gap + w / 2, 0, 0);
    else this.hand.position.set(0, PH / 2 + gap + h / 2, 0);
    this.hand.visible = show && !state.refEasel;
    // chevalet : image de 0,8 m de haut posée sur la tablette
    const eh = 0.8, ew = Math.min(1.2, eh * aspect);
    this.easelImg.scale.set(ew, ew / aspect, 1);
    this.easelImg.position.set(0, 0.87 + ew / aspect / 2, 0.03);
    this.easelImg.rotation.x = -0.12;
    this.easel.position.set(-this.wall.width / 2 + 0.6, 0, this.wall.z + 1.3);
    this.easel.rotation.y = 0.45;
    this.easel.visible = show && !!state.refEasel;
  }
}
