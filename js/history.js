import * as THREE from 'three';

// Historique d'annulation commun à toutes les surfaces peintes.
//
// Chaque geste (trait, coulures comprises, effacement…) ouvre un enregistrement.
// Avant la première écriture d'un carreau de 256 × 256 texels pendant ce geste,
// son contenu est copié dans un « emplacement » d'atlas : on ne garde ainsi
// que ce que le geste a réellement modifié, et on peut remonter très loin.
// Les atlas sont alloués par pages ; au-delà du budget, les plus vieux
// enregistrements sont oubliés.

export const TILE = 256;     // carreau de la couche couleur (texels)
const SLOT_AUX = 128;        // emplacement réservé aux couches matière / émission
const PAGE = 1024;           // page d'atlas couleur : 4 × 4 emplacements

// Couches d'une surface peinte. Les trois premières sont affichées ; les trois
// « fond » gardent, sous chaque trait, ce qu'il recouvrait (révélé au raclage).
// full : couche à la résolution de la couleur (sinon, au quart).
export const LAYERS = [
  { key: 'color', full: true }, { key: 'aux', full: false }, { key: 'glow', full: false },
  { key: 'fondColor', full: true }, { key: 'fondAux', full: false }, { key: 'fondGlow', full: false },
];
const PAGE_BYTES = LAYERS.reduce((n, L) => n + (L.full ? PAGE * PAGE : (PAGE / 2) * (PAGE / 2)) * 8, 0);

const QUAD_VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy * 2.0, 0.0, 1.0); }`;

const RECT_FRAG = /* glsl */`
uniform sampler2D tSrc;
uniform vec4 uRect;   // zone source en uv : x, y, largeur, hauteur
varying vec2 vUv;
void main() { gl_FragColor = texture2D(tSrc, uRect.xy + vUv * uRect.zw); }`;

// Zone d'un carreau dans une couche (texels, arrondie vers l'extérieur) et,
// si un emplacement d'atlas est donné, sa place dans cet emplacement.
export function tileRect(surface, key, layer, slot = null) {
  const [tx, ty] = key.split(',').map(Number);
  const [W, H] = surface.res;
  const target = surface.targets[layer.key];
  const s = layer.full ? TILE : SLOT_AUX;
  const u0 = tx * TILE / W, v0 = ty * TILE / H;
  const uw = Math.min(TILE, W - tx * TILE) / W, vh = Math.min(TILE, H - ty * TILE) / H;
  const x0 = Math.floor(u0 * target.width), y0 = Math.floor(v0 * target.height);
  const x1 = Math.min(target.width, Math.ceil((u0 + uw) * target.width));
  const y1 = Math.min(target.height, Math.ceil((v0 + vh) * target.height));
  const w = Math.min(s, x1 - x0), h = Math.min(s, y1 - y0);
  return { target, x0, y0, w, h, ax: slot ? slot.i * s : 0, ay: slot ? slot.j * s : 0, atlas: slot ? slot.page[layer.key] : null };
}

export class History {
  constructor(renderer, { budgetBytes, maxRecords = 400 }) {
    this.renderer = renderer;
    this.maxPages = Math.max(2, Math.floor(budgetBytes / PAGE_BYTES));
    this.maxRecords = maxRecords;
    this.pages = [];
    this.free = [];
    this.records = [];
    this.current = null;
    this.onChange = null;
    this.cam = new THREE.Camera();
    this.scene = new THREE.Scene();
    this.mat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT, fragmentShader: RECT_FRAG,
      uniforms: { tSrc: { value: null }, uRect: { value: new THREE.Vector4() } },
      blending: THREE.NoBlending, depthTest: false, depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.mat);
    quad.frustumCulled = false;
    this.scene.add(quad);
  }

  get count() { return this.records.length + (this.current && !this.current.empty ? 1 : 0); }

  // --- gestes -----------------------------------------------------------------
  begin(label = '') {
    this._close();
    this.current = { type: 'tiles', label, entries: [], keys: new Set(), slots: new Map(), empty: true };
  }

  _close() {
    const c = this.current;
    this.current = null;
    if (c && !c.empty) {
      this.records.push(c);
      while (this.records.length > this.maxRecords) this._evictOldest();
      this.onChange?.();
    }
  }

  // Enregistrement non pixelisé (changement de taille du mur…) : `undo` le
  // défait, `dispose` libère ce qu'il retient, `bytes` compte dans le budget.
  pushCustom({ label, undo, dispose = () => {}, bytes = 0 }) {
    this._close();
    this.records.push({ type: 'custom', label, undo, dispose, units: Math.ceil(bytes / PAGE_BYTES) });
    this._fitBudget();
    this.onChange?.();
  }

  // Contenu d'un carreau au début du geste en cours (null s'il n'a pas pu être gardé).
  slotOf(surface, key) {
    return this.current?.slots.get(surface.uid + ':' + key) || null;
  }

  // Appelé par une surface juste avant d'écrire dans ces carreaux.
  protect(surface, keys) {
    if (!this.current) this.begin();
    const rec = this.current;
    for (const key of keys) {
      const id = surface.uid + ':' + key;
      if (rec.keys.has(id)) continue;
      rec.keys.add(id);
      const slot = this._slot();
      if (!slot) { rec.partial = true; continue; }
      this._copyTile(surface, key, slot, true);
      rec.entries.push({ surface, key, slot });
      rec.slots.set(id, slot);
      rec.empty = false;
    }
  }

  undo() {
    this._close();
    const rec = this.records.pop();
    if (!rec) return null;
    if (rec.type === 'custom') {
      rec.undo();
      rec.dispose();
    } else {
      for (let i = rec.entries.length - 1; i >= 0; i--) {
        const e = rec.entries[i];
        if (!e.surface.disposed) this._copyTile(e.surface, e.key, e.slot, false);
        this.free.push(e.slot);
      }
    }
    this.onChange?.();
    return rec;
  }

  reset() {
    this._close();
    while (this.records.length) this._evictOldest();
    this.onChange?.();
  }

  // Oublie les gestes qui concernent une surface supprimée.
  forget(surface) {
    this._close();
    this.records = this.records.filter(r => {
      if (r.type !== 'tiles' || !r.entries.some(e => e.surface === surface)) return true;
      for (const e of r.entries) this.free.push(e.slot);
      return false;
    });
  }

  // --- atlas -----------------------------------------------------------------
  _units() {
    return this.pages.length + this.records.reduce((n, r) => n + (r.units || 0), 0);
  }

  _evictOldest() {
    const r = this.records.shift();
    if (!r) return false;
    if (r.type === 'custom') r.dispose();
    else for (const e of r.entries) this.free.push(e.slot);
    return true;
  }

  _fitBudget() {
    while (this._units() > this.maxPages && this.records.length) this._evictOldest();
  }

  _slot() {
    if (!this.free.length) {
      if (this._units() >= this.maxPages) {
        // on oublie les plus vieux gestes jusqu'à libérer un emplacement
        while (!this.free.length && this.records.length) this._evictOldest();
      }
      if (!this.free.length && this._units() < this.maxPages) this._addPage();
    }
    return this.free.pop() || null;
  }

  _addPage() {
    const rt = (s) => new THREE.WebGLRenderTarget(s, s, {
      type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    });
    const page = {};
    for (const L of LAYERS) page[L.key] = rt(L.full ? PAGE : PAGE / 2);
    this.pages.push(page);
    const n = PAGE / TILE;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) this.free.push({ page, i, j });
  }

  // Copie carreau ↔ emplacement. save = true : surface → atlas.
  _copyTile(surface, key, slot, save) {
    const r = this.renderer;
    const prev = { rt: r.getRenderTarget(), xr: r.xr.enabled, autoClear: r.autoClear };
    r.xr.enabled = false;
    r.autoClear = false;
    for (const layer of LAYERS) {
      const { target, x0, y0, w, h, ax, ay, atlas } = tileRect(surface, key, layer, slot);
      if (w <= 0 || h <= 0) continue;
      if (save) {
        this._blit(target.texture, [x0 / target.width, y0 / target.height, w / target.width, h / target.height], atlas, [ax, ay, w, h]);
      } else {
        this._blit(atlas.texture, [ax / atlas.width, ay / atlas.height, w / atlas.width, h / atlas.height], target, [x0, y0, w, h]);
      }
    }
    r.setRenderTarget(prev.rt);
    r.xr.enabled = prev.xr;
    r.autoClear = prev.autoClear;
  }

  _blit(tex, srcRect, dst, [x, y, w, h]) {
    this.mat.uniforms.tSrc.value = tex;
    this.mat.uniforms.uRect.value.set(...srcRect);
    dst.viewport.set(x, y, w, h);
    dst.scissor.set(x, y, w, h);
    dst.scissorTest = true;
    this.renderer.setRenderTarget(dst);
    this.renderer.render(this.scene, this.cam);
    dst.viewport.set(0, 0, dst.width, dst.height);
    dst.scissor.set(0, 0, dst.width, dst.height);
    dst.scissorTest = false;
    this.renderer.setRenderTarget(null);
  }
}
