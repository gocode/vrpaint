import * as THREE from 'three';
import { TILE } from './history.js';

let uidCounter = 0;

// Le mur est peint sur GPU : chaque giclée est un « tampon » instancié rendu
// dans trois render targets en alpha prémultiplié (opération « over ») :
//   color : couleur linéaire + couverture (haute résolution)
//   aux   : r = rugosité, g = métal (prémultipliés)
//   glow  : couleur émise (fluo / phospho)
// Le matériau du mur compose ensuite ces couches sur la texture de base.

const STAMP_VERT = /* glsl */`
attribute vec4 iA; // u, v, alpha (ou dose), dureté
attribute vec4 iB; // axes de l'ellipse en mètres : a.xy, b.xy
attribute vec4 iC; // couleur linéaire, rugosité
attribute vec4 iD; // couleur émise, métal
uniform vec2 uWall;
varying vec2 vQ;
varying vec2 vAH;
varying vec4 vC;
varying vec4 vD;
void main() {
  vQ = position.xy * 2.0;
  vec2 off = vQ.x * iB.xy + vQ.y * iB.zw;
  vec2 uv = iA.xy + off / uWall;
  vAH = iA.zw;
  vC = iC;
  vD = iD;
  gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
}`;

const STAMP_FRAG = /* glsl */`
uniform int uPass;
varying vec2 vQ;
varying vec2 vAH;
varying vec4 vC;
varying vec4 vD;
void main() {
  float r2 = dot(vQ, vQ);
  if (r2 >= 1.0) discard;
  float a;
  if (vAH.y > 0.5) {
    // gouttelette : disque net antialiasé
    float r = sqrt(r2);
    float aa = max(fwidth(r), 1e-3);
    a = vAH.x * (1.0 - smoothstep(1.0 - aa * 1.5, 1.0, r));
  } else {
    // nuage : gaussienne (sigma = 1/3 du rayon), la dose sature au centre
    float g = exp(-4.5 * r2) * (1.0 - smoothstep(0.8, 1.0, r2));
    a = 1.0 - exp(-vAH.x * g);
  }
  if (uPass == 0) gl_FragColor = vec4(vC.rgb * a, a);
  else if (uPass == 1) gl_FragColor = vec4(vC.a * a, vD.a * a, 0.0, a);
  else gl_FragColor = vec4(vD.rgb * a, a);
}`;

const QUAD_VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy * 2.0, 0.0, 1.0); }`;

const COPY_FRAG = /* glsl */`
uniform sampler2D tSrc;
varying vec2 vUv;
void main() { gl_FragColor = texture2D(tSrc, vUv); }`;

// Sauvegarde : dé-prémultiplie et encode la couleur en sRGB 8 bits.
const ENCODE_FRAG = /* glsl */`
uniform sampler2D tSrc;
uniform int uMode;
varying vec2 vUv;
vec3 toSRGB(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
void main() {
  // lecture texel par texel (la cible a la taille de la couche) : le filtrage et les
  // mipmaps mêleraient un peu les voisins au bord des traits presque transparents
  vec4 s = texelFetch(tSrc, ivec2(gl_FragCoord.xy), 0);
  float a = clamp(s.a, 0.0, 1.0);
  // alpha qui s'arrondit à 0 sur 8 bits : texel vide, sans couleur résiduelle
  // (sinon chaque enregistrement + réouverture changerait ces texels invisibles)
  vec3 c = s.a >= 0.5 / 255.0 ? s.rgb / s.a : vec3(0.0);
  gl_FragColor = vec4(uMode == 1 ? clamp(c, 0.0, 1.0) : toSRGB(c), a);
}`;

const DECODE_FRAG = /* glsl */`
uniform sampler2D tSrc;
uniform int uMode;
varying vec2 vUv;
vec3 toLin(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
void main() {
  vec4 s = texture2D(tSrc, vUv);
  vec3 c = uMode == 1 ? s.rgb : toLin(s.rgb);
  gl_FragColor = vec4(c * s.a, s.a);
}`;

const ZERO_FRAG = /* glsl */`
void main() { gl_FragColor = vec4(0.0); }`;

// Changement de taille du mur : chaque trait garde sa position dans le monde.
const RESAMPLE_FRAG = /* glsl */`
uniform sampler2D tSrc;
uniform vec2 uScale;
uniform vec2 uOffset;
varying vec2 vUv;
void main() {
  vec2 s = vUv * uScale + uOffset;
  gl_FragColor = (s.x < 0.0 || s.y < 0.0 || s.x > 1.0 || s.y > 1.0) ? vec4(0.0) : texture2D(tSrc, s);
}`;

const LAYERS = ['color', 'aux', 'glow'];

export class PaintSurface {
  constructor(renderer, { width, height, res, auxRes, history = null, maxStamps = 8192 }) {
    this.renderer = renderer;
    this.width = width;
    this.height = height;
    this.res = [res, Math.round(res * height / width)];
    this.auxRes = [auxRes, Math.round(auxRes * height / width)];
    this.texel = width / res;
    this.uid = ++uidCounter;
    this.history = history;
    this.tilesX = Math.ceil(this.res[0] / TILE);
    this.tilesY = Math.ceil(this.res[1] / TILE);
    this.pending = new Set();   // carreaux touchés par le lot en cours
    this.painted = new Set();   // carreaux peut-être peints (pour l'effacement annulable)
    this.targets = this._makeSet();

    // Lot de tampons instanciés
    this.max = maxStamps;
    this.count = 0;
    const geo = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    this.attrs = {};
    for (const name of ['iA', 'iB', 'iC', 'iD']) {
      const attr = new THREE.InstancedBufferAttribute(new Float32Array(maxStamps * 4), 4);
      attr.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute(name, attr);
      this.attrs[name] = attr;
    }
    this.aA = this.attrs.iA.array;
    this.aB = this.attrs.iB.array;
    this.aC = this.attrs.iC.array;
    this.aD = this.attrs.iD.array;
    this.geo = geo;
    this.stampMat = new THREE.ShaderMaterial({
      vertexShader: STAMP_VERT,
      fragmentShader: STAMP_FRAG,
      uniforms: { uWall: { value: new THREE.Vector2(width, height) }, uPass: { value: 0 } },
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
      depthTest: false,
      depthWrite: false,
      transparent: true,
    });
    this.stampScene = new THREE.Scene();
    const mesh = new THREE.Mesh(geo, this.stampMat);
    mesh.frustumCulled = false;
    this.stampScene.add(mesh);

    // Quad plein écran pour copies / encodage / décodage
    this.cam = new THREE.Camera();
    this.quadScene = new THREE.Scene();
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1));
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
    const quadMat = frag => new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT, fragmentShader: frag,
      uniforms: { tSrc: { value: null }, uMode: { value: 0 } },
      blending: THREE.NoBlending, depthTest: false, depthWrite: false,
    });
    this.copyMat = quadMat(COPY_FRAG);
    this.encodeMat = quadMat(ENCODE_FRAG);
    this.decodeMat = quadMat(DECODE_FRAG);
    this.zeroMat = quadMat(ZERO_FRAG);
    this.resampleMat = quadMat(RESAMPLE_FRAG);
    this.resampleMat.uniforms.uScale = { value: new THREE.Vector2(1, 1) };
    this.resampleMat.uniforms.uOffset = { value: new THREE.Vector2(0, 0) };

    this._clearSet(this.targets);
  }

  // mémoire GPU occupée (couche couleur avec ses mipmaps + couches matière)
  get bytes() {
    return this.res[0] * this.res[1] * 8 * 1.33 + 2 * this.auxRes[0] * this.auxRes[1] * 8;
  }

  get textures() {
    return { color: this.targets.color.texture, aux: this.targets.aux.texture, glow: this.targets.glow.texture };
  }

  _makeRT(w, h, mips) {
    const rt = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: mips,
      minFilter: mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
    if (mips) rt.texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    return rt;
  }

  _makeSet() {
    return {
      color: this._makeRT(this.res[0], this.res[1], true),
      aux: this._makeRT(this.auxRes[0], this.auxRes[1], false),
      glow: this._makeRT(this.auxRes[0], this.auxRes[1], false),
    };
  }

  // Rendu hors écran : en XR, three remplacerait la caméra par celle du casque
  // et la cible courante est le framebuffer XR, d'où la sauvegarde/restauration.
  _begin() {
    const r = this.renderer;
    this._saved = { rt: r.getRenderTarget(), xr: r.xr.enabled, autoClear: r.autoClear };
    r.xr.enabled = false;
    r.autoClear = false;
  }

  _end() {
    const r = this.renderer, s = this._saved;
    r.setRenderTarget(s.rt);
    r.xr.enabled = s.xr;
    r.autoClear = s.autoClear;
  }

  _blit(mat, tex, rt, mode = 0) {
    mat.uniforms.tSrc.value = tex;
    mat.uniforms.uMode.value = mode;
    this.quad.material = mat;
    this.renderer.setRenderTarget(rt);
    this.renderer.render(this.quadScene, this.cam);
  }

  // Toute écriture dans une couche passe par renderer.render() : c'est lui qui
  // régénère les mipmaps de la couche couleur. Un renderer.clear() laisserait
  // les anciens traits dans les niveaux réduits, visibles de loin en VR.
  _clearSet(set) {
    this._begin();
    for (const k of LAYERS) this._blit(this.zeroMat, null, set[k]);
    this._end();
  }

  _copySet(src, dst) {
    this._begin();
    for (const k of LAYERS) this._blit(this.copyMat, src[k].texture, dst[k]);
    this._end();
  }

  push(u, v, a, hard, ax, ay, bx, by, paint) {
    if (this.count >= this.max) this.flush();
    // carreaux couverts par le tampon (pour l'historique)
    const [W, H] = this.res;
    const ex = (Math.abs(ax) + Math.abs(bx)) / this.width * W, ey = (Math.abs(ay) + Math.abs(by)) / this.height * H;
    const tx0 = Math.max(0, Math.floor((u * W - ex) / TILE)), tx1 = Math.min(this.tilesX - 1, Math.floor((u * W + ex) / TILE));
    const ty0 = Math.max(0, Math.floor((v * H - ey) / TILE)), ty1 = Math.min(this.tilesY - 1, Math.floor((v * H + ey) / TILE));
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) this.pending.add(tx + ',' + ty);
    const i = this.count++ * 4;
    const A = this.aA, B = this.aB, C = this.aC, D = this.aD;
    const c = paint.lin, g = paint.glowLin;
    A[i] = u; A[i + 1] = v; A[i + 2] = a; A[i + 3] = hard;
    B[i] = ax; B[i + 1] = ay; B[i + 2] = bx; B[i + 3] = by;
    C[i] = c.r; C[i + 1] = c.g; C[i + 2] = c.b; C[i + 3] = paint.rough;
    D[i] = g.r; D[i + 1] = g.g; D[i + 2] = g.b; D[i + 3] = paint.metal;
  }

  flush() {
    const n = this.count;
    if (!n) return 0;
    for (const attr of Object.values(this.attrs)) {
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, n * 4);
      attr.needsUpdate = true;
    }
    this.geo.instanceCount = n;
    if (this.pending.size) {
      // sauvegarde des carreaux avant qu'ils ne soient modifiés
      this.history?.protect(this, this.pending);
      for (const k of this.pending) this.painted.add(k);
      this.pending.clear();
    }
    this._begin();
    LAYERS.forEach((k, pass) => {
      this.stampMat.uniforms.uPass.value = pass;
      this.renderer.setRenderTarget(this.targets[k]);
      this.renderer.render(this.stampScene, this.cam);
    });
    this._end();
    this.count = 0;
    return n;
  }

  allTiles() {
    const keys = [];
    for (let ty = 0; ty < this.tilesY; ty++) for (let tx = 0; tx < this.tilesX; tx++) keys.push(tx + ',' + ty);
    return keys;
  }

  // Effacement : seuls les carreaux déjà peints sont sauvegardés pour l'annulation.
  clear(undoable = true) {
    this.flush();
    if (undoable && this.painted.size) this.history?.protect(this, this.painted);
    this._clearSet(this.targets);
  }
  // Export des couches en RGBA 8 bits (pour la sauvegarde locale).
  async exportLayers() {
    this.flush();
    const out = {};
    for (const k of LAYERS) {
      const src = this.targets[k];
      const w = src.width, h = src.height;
      const rt = new THREE.WebGLRenderTarget(w, h, { depthBuffer: false, stencilBuffer: false });
      this._begin();
      this._blit(this.encodeMat, src.texture, rt, k === 'aux' ? 1 : 0);
      this._end();
      const data = new Uint8Array(w * h * 4);
      if (this.renderer.readRenderTargetPixelsAsync) {
        await this.renderer.readRenderTargetPixelsAsync(rt, 0, 0, w, h, data);
      } else {
        this.renderer.readRenderTargetPixels(rt, 0, 0, w, h, data);
      }
      rt.dispose();
      out[k] = { w, h, data };
    }
    return out;
  }

  // Reprend la peinture d'une surface d'une autre taille : uvSrc = uv * scale + offset
  copyFrom(src, scale, offset) {
    src.flush();
    this.resampleMat.uniforms.uScale.value.copy(scale);
    this.resampleMat.uniforms.uOffset.value.copy(offset);
    this._begin();
    for (const k of LAYERS) this._blit(this.resampleMat, src.targets[k].texture, this.targets[k]);
    this._end();
    for (const k of this.allTiles()) this.painted.add(k);
  }

  dispose() {
    for (const k of LAYERS) this.targets[k].dispose();
    this.disposed = true;
    this.geo.dispose();
    for (const m of [this.stampMat, this.copyMat, this.encodeMat, this.decodeMat, this.zeroMat, this.resampleMat]) m.dispose();
  }

  importLayers(layers) {
    this.flush();
    this._begin();
    for (const k of LAYERS) {
      const L = layers[k];
      if (!L) continue;
      const tex = new THREE.DataTexture(L.data, L.w, L.h, THREE.RGBAFormat, THREE.UnsignedByteType);
      // même taille : copie texel à texel ; sinon (autre appareil, autre résolution) interpolation
      const same = L.w === this.targets[k].width && L.h === this.targets[k].height;
      tex.minFilter = tex.magFilter = same ? THREE.NearestFilter : THREE.LinearFilter;
      tex.needsUpdate = true;
      this._blit(this.decodeMat, tex, this.targets[k], k === 'aux' ? 1 : 0);
      tex.dispose();
    }
    this._end();
    for (const k of this.allTiles()) this.painted.add(k);
  }
}
