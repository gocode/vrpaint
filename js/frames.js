import * as THREE from 'three';

// Rendu à la demande (hors casque). Une image n'est recalculée que si l'écran
// doit changer : la vue a bougé, quelque chose a été dessiné hors écran
// (peinture, historique, chargement), un réglage a changé, l'utilisateur agit,
// ou un objet animé est dans le champ. Sinon la toile garde l'image
// précédente, identique au pixel près, et la carte graphique se repose.
//
// Les changements sont détectés de façon générale plutôt que signalés un par
// un : tout rendu hors écran passe par renderer.render (compteur
// info.render.frame), toute création de texture ou de shader change les
// compteurs de mémoire. Filet de sécurité : une image au moins toutes les
// SAFETY_MS, pour ce qui changerait sans laisser de trace (texture mise à jour
// en place, par exemple).
const SAFETY_MS = 250;

export class FrameScheduler {
  constructor(renderer, camera) {
    this.renderer = renderer;
    this.camera = camera;
    this.dirty = true;
    this.busyUntil = 0;
    this.last = -Infinity;
    this.lastFrame = -1;
    this.lastMem = '';
    this.view = new Float32Array(32);
    this.skipped = 0;
    this.drawn = 0;
  }

  // Force l'image suivante ; ms > 0 garde la cadence pleine pendant ce délai.
  invalidate(ms = 0) {
    this.dirty = true;
    if (ms) this.busyUntil = Math.max(this.busyUntil, performance.now() + ms);
  }

  // fps : cadence utile pour ce qui bouge seul à l'écran (0 : rien, Infinity : tout).
  shouldRender(fps) {
    const now = performance.now(), r = this.renderer, info = r.info;
    if (this.dirty || now < this.busyUntil) return true;
    if (info.render.frame !== this.lastFrame) return true;
    if (this._mem() !== this.lastMem) return true;
    if (this._viewChanged()) return true;
    if (fps === Infinity) return true;
    if (fps > 0 && now - this.last >= 1000 / fps - 2) return true;
    if (now - this.last >= SAFETY_MS) return true;
    this.skipped++;
    return false;
  }

  // À appeler juste après le rendu de la scène.
  rendered() {
    this.dirty = false;
    this.last = performance.now();
    this.lastFrame = this.renderer.info.render.frame;
    this.lastMem = this._mem();
    this._viewChanged();
    this.drawn++;
  }

  _mem() {
    const m = this.renderer.info.memory;
    return `${m.geometries}/${m.textures}/${this.renderer.info.programs?.length ?? 0}`;
  }

  _viewChanged() {
    const c = this.camera, v = this.view;
    c.updateMatrixWorld();
    const a = c.matrixWorld.elements, b = c.projectionMatrix.elements;
    let changed = false;
    for (let i = 0; i < 16; i++) {
      if (v[i] !== Math.fround(a[i])) { v[i] = a[i]; changed = true; }
      if (v[16 + i] !== Math.fround(b[i])) { v[16 + i] = b[i]; changed = true; }
    }
    return changed;
  }
}

// Champ de vision d'une caméra, pour savoir si un objet animé y passe.
const _m = new THREE.Matrix4();
export function cameraFrustum(camera, out = new THREE.Frustum()) {
  camera.updateMatrixWorld();
  _m.copy(camera.matrixWorld).invert().premultiply(camera.projectionMatrix);
  return out.setFromProjectionMatrix(_m);
}
