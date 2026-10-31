import * as THREE from 'three';
import { PaintSurface } from './paint.js';

// Surfaces peignables autres que le mur principal (devantures, rideaux…).
// Chacune est un rectangle de la rue ; sa couche de peinture et le calque
// transparent qui l'affiche ne sont créés qu'au premier coup de bombe.

export class OverlayCanvas {
  constructor(manager, { id, frame, width, height }) {
    this.manager = manager;
    this.id = id;
    this.frame = frame;
    this.width = width;
    this.height = height;
    this.surface = null;
    this.mesh = null;
    this.masks = [];       // caches posés sur cette devanture (stencils.js)
    this.maskVersion = 0;
  }

  ensureSurface() {
    if (this.surface) return this.surface;
    const m = this.manager;
    this.surface = new PaintSurface(m.renderer, { width: this.width, height: this.height, history: m.history, ...m.resolution(this.width, this.height) });
    this.surface.maskSource = this;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(this.width, this.height), overlayMaterial(this.surface, m.glowK));
    const f = this.frame;
    const c = f.corner.clone().addScaledVector(f.ex, this.width / 2).addScaledVector(f.ey, this.height / 2).addScaledVector(f.n, 0.004);
    this.mesh.matrixAutoUpdate = false;
    this.mesh.matrix.makeBasis(f.ex, f.ey, f.n).setPosition(c);
    this.mesh.renderOrder = 2;
    m.scene.add(this.mesh);
    return this.surface;
  }

  dispose() {
    if (!this.surface) return;
    this.manager.history.forget(this.surface);
    this.surface.dispose();
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.surface = this.mesh = null;
  }
}

// Calque de peinture posé devant une façade : couleur dé-prémultipliée,
// rugosité / métal / lueur lus dans les couches matière.
function overlayMaterial(surface, glowK) {
  const t = surface.textures;
  const mat = new THREE.MeshStandardMaterial({
    map: t.color, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const uniforms = { uAux: { value: t.aux }, uGlow: { value: t.glow }, uGlowK: glowK };
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, uniforms);
    sh.fragmentShader = 'uniform sampler2D uAux;\nuniform sampler2D uGlow;\nuniform float uGlowK;\n' + sh.fragmentShader
      .replace('#include <map_fragment>', `
        vec4 pS = texture2D(map, vMapUv);
        float pA = clamp(pS.a, 0.0, 1.0);
        diffuseColor = vec4(pS.rgb / max(pS.a, 1e-4), pA);
        vec4 aS = texture2D(uAux, vMapUv);
        float aA = max(aS.a, 1e-4);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = aS.a > 1e-3 ? aS.r / aA : 0.6;`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor = aS.a > 1e-3 ? aS.g / aA : 0.0;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += texture2D(uGlow, vMapUv).rgb * uGlowK / max(pA, 0.02);`);
  };
  return mat;
}

export class CanvasManager {
  constructor({ renderer, scene, history, glowK, mobile }) {
    Object.assign(this, { renderer, scene, history, glowK, mobile });
    this.overlays = [];
  }

  // Résolution des devantures : un peu plus grossière que le mur principal.
  resolution(W, H) {
    const texel = this.mobile ? 0.0035 : 0.0025;
    let res = Math.min(4096, Math.ceil(W / texel));
    if (res * H / W > 4096) res = Math.floor(4096 * W / H);
    return { res, auxRes: Math.max(256, Math.round(res / 4)) };
  }

  setOverlays(defs) {
    for (const c of this.overlays) c.dispose();
    this.overlays = defs.map(d => new OverlayCanvas(this, d));
  }

  byId(id) {
    return this.overlays.find(c => c.id === id) || null;
  }

  painted() {
    return this.overlays.filter(c => c.surface);
  }

  flush() {
    for (const c of this.overlays) c.surface?.flush();
  }

  clearAll(undoable) {
    for (const c of this.painted()) c.surface.clear(undoable);
  }

  // Nouveau projet / chargement : on libère toute la mémoire des devantures.
  disposeAll() {
    for (const c of this.overlays) c.dispose();
  }
}
