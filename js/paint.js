import * as THREE from 'three';
import { TILE, LAYERS as LAYER_DEFS, tileRect } from './history.js';
import { MAX_MASKS, MASK_GLSL, packMasks } from './stencils.js';
import { CRUMPLE_GLSL, FRESH_GLSL } from './newspaper.js';
import { SPONGE_GLSL } from './sponge.js';

let uidCounter = 0;

// Le mur est peint sur GPU : chaque giclée est un « tampon » instancié rendu
// dans trois render targets en alpha prémultiplié (opération « over ») :
//   color : couleur linéaire + couverture (haute résolution)
//   aux   : r = rugosité, g = métal (prémultipliés)
//   glow  : couleur émise (fluo / phospho)
// Le matériau du mur compose ensuite ces couches sur la texture de base.
//
// Stratification : trois couches « fond » (mêmes tailles) gardent, sous chaque
// trait, ce que ce trait a recouvert (l'état du mur au début du geste, repris
// dans l'historique). Le raclage ramène la couche visible vers ce fond, puis,
// en appuyant fort, ronge le fond lui-même jusqu'au mur nu.
// Le fond glisse vers l'état d'avant le geste à proportion de la peinture que le
// geste dépose : sous un voile léger, il reste presque celui d'avant. Une bascule
// au moindre dépôt dessinait au papier et au grattoir le contour exact des tampons
// de la bombe (des ronds nets), là où rien ne se voyait.
// Il y glisse aussi à proportion de ce qui, dans la peinture recouverte, a déjà
// pris (séchée au temps ou au chalumeau, voir newspaper.js) : sous un voile frais,
// une couche sèche reste au fond, et le papier s'arrête sur elle.
//
// Caches : chaque toile a jusqu'à MAX_MASKS pochoirs, évalués analytiquement
// dans le shader des tampons (net à toute résolution, rien à allouer).
//
// Papier journal : comme le raclage, il ramène la couche visible vers le fond
// (motif de papier froissé, voir newspaper.js), mais ne touche jamais au fond.

const STAMP_VERT = /* glsl */`
attribute vec4 iA; // u, v, alpha (ou dose), dureté (0 nuage, 1 gouttelette, 2 + pression : éponge)
attribute vec4 iB; // axes de l'ellipse en mètres : a.xy, b.xy
attribute vec4 iC; // couleur linéaire, rugosité
attribute vec4 iD; // couleur émise, métal
attribute vec4 iE; // buse projetée sur la toile (m) : x, y, distance (0 : pas de parallaxe) ; éponge : graine + sécheresse
uniform vec2 uWall;
varying vec2 vQ;
varying vec2 vAH;
varying vec4 vC;
varying vec4 vD;
varying vec2 vP;
varying vec3 vN;
varying vec4 vS;
void main() {
  vQ = position.xy * 2.0;
  vec2 off = vQ.x * iB.xy + vQ.y * iB.zw;
  vec2 uv = iA.xy + off / uWall;
  vAH = iA.zw;
  vC = iC;
  vD = iD;
  vP = uv * uWall;
  vN = iE.xyz;
  // éponge : position sur sa face (m, repère de l'éponge), rayon (quad de 1,1 rayon : contour bosselé), graine
  vS = vec4(vQ * vec2(length(iB.xy), length(iB.zw)), length(iB.xy) / 1.1, iE.w);
  gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
}`;

const STAMP_FRAG = /* glsl */`
uniform int uPass;
uniform vec2 uWall;
varying vec2 vQ;
varying vec2 vAH;
varying vec4 vC;
varying vec4 vD;
varying vec2 vP;
varying vec3 vN;
varying vec4 vS;
${MASK_GLSL}
${SPONGE_GLSL}
void main() {
  float r2 = dot(vQ, vQ);
  if (r2 >= 1.0) discard;
  float a;
  if (vAH.y > 1.5) {
    // éponge : graine entière, sécheresse en partie fractionnaire
    a = vAH.x * spongeContact(vS.xy, vS.z, vAH.y - 2.0, fract(vS.w), floor(vS.w), uTexel);
  } else if (vAH.y > 0.5) {
    // gouttelette : disque net antialiasé
    float r = sqrt(r2);
    float aa = max(fwidth(r), 1e-3);
    a = vAH.x * (1.0 - smoothstep(1.0 - aa * 1.5, 1.0, r));
  } else {
    // nuage : gaussienne (sigma = 1/3 du rayon), la dose sature au centre
    float g = exp(-4.5 * r2) * (1.0 - smoothstep(0.8, 1.0, r2));
    a = 1.0 - exp(-vAH.x * g);
  }
  a *= maskOpen(vP, vN);
  if (uPass == 3) gl_FragColor = vec4(a, 0.0, 0.0, a);   // couverture du lot (fond)
  else if (uPass == 0) gl_FragColor = vec4(vC.rgb * a, a);
  else if (uPass == 1) gl_FragColor = vec4(vC.a * a, vD.a * a, 0.0, a);
  else gl_FragColor = vec4(vD.rgb * a, a);
}`;

// Raclage : quadrilatère balayé par la lame entre deux positions. Les
// quadrilatères successifs partagent leurs arêtes : chaque texel n'est raclé
// qu'une fois par passage, quelle que soit la vitesse du geste.
const SCRAPE_VERT = /* glsl */`
attribute vec2 aS;   // position le long de la lame (-1..1), pression effective
uniform vec2 uWall;
varying vec2 vS;
varying vec2 vP;
void main() {
  vS = aS;
  vP = position.xy * uWall;
  gl_Position = vec4(position.xy * 2.0 - 1.0, 0.0, 1.0);
}`;

const SCRAPE_FRAG = /* glsl */`
uniform int uMode;      // 0 : couche visible (en écart au fond), 1 : fond
uniform vec4 uToolA;    // demi-largeur (m), fréquence des stries (1/m), taille des éclats (m), mordant
uniform vec4 uToolB;    // souplesse, rayures, éclats, stries
uniform float uSeed;
varying vec2 vS;
varying vec2 vP;
${MASK_GLSL}
float h1(float n) { return fract(sin(n * 12.9898 + 4.1) * 43758.5453); }
float n1(float x) { float i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(h1(i), h1(i + 1.0), f); }
float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n2(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h2(i), h2(i + vec2(1.0, 0.0)), f.x), mix(h2(i + vec2(0.0, 1.0)), h2(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  // stries : profil de la lame (ses défauts), fixe pendant le geste
  float sm = vS.x * uToolA.x;
  float fq = uToolA.y;
  float st = 0.55 * n1(sm * fq + uSeed * 17.0) + 0.3 * n1(sm * fq * 2.7 + uSeed * 5.0) + 0.15 * n1(sm * fq * 0.31 + uSeed);
  // éclats : la peinture s'arrache par plaques irrégulières
  vec2 q = vP / uToolA.z + uSeed * 3.7;
  float ch = 0.6 * n2(q) + 0.4 * n2(q * 2.9 + 7.3);
  float p = vS.y * (1.0 - uToolB.x * pow(abs(vS.x), 3.0));
  float k1 = smoothstep(0.06, 0.42, p + uToolB.w * (st - 0.5) * 0.7 + uToolB.z * (ch - 0.5) * 0.45);
  float kd = smoothstep(0.55, 1.0, p * uToolA.w + uToolB.w * (st - 0.5) * 0.5 + uToolB.z * (ch - 0.5) * 0.9);
  // rayures : quelques défauts de la lame creusent jusqu'au mur
  float nick = step(1.0 - uToolB.y, h1(floor(sm / 0.0016) + uSeed * 31.0));
  kd = max(kd, nick * smoothstep(0.15, 0.6, p));
  k1 = max(k1, kd);
  float open = maskOpen(vP, vec3(0.0));
  k1 *= open;
  kd *= open;
  float e = uMode == 0 ? 1.0 - (1.0 - k1) * (1.0 - kd) : kd;
  gl_FragColor = vec4(0.0, 0.0, 0.0, e);
}`;

// Papier journal : un disque par appui (ou par pas de 5 mm en frottant), motif
// évalué dans le repère du papier. Un appui qui s'affermit au même endroit
// n'emporte que la différence entre les deux pressions : 1 − (1 − e1) / (1 − e0).
const BLOT_VERT = /* glsl */`
attribute vec4 jA;   // centre x, y (m), cos, sin de la rotation du papier
attribute vec4 jB;   // rayon (m), graine, pression d'avant, pression
attribute vec4 jC;   // force (appui, appui prolongé ou frottement), plis par mètre, roulement (m, repère du papier)
uniform vec2 uWall;
varying vec2 vP;
varying vec2 vL;
varying vec4 vB;
varying vec4 vC;
void main() {
  vec2 q = position.xy * 2.0 * jB.x;
  vP = jA.xy + q;
  vL = vec2(jA.z * q.x + jA.w * q.y, -jA.w * q.x + jA.z * q.y) + jC.zw;
  vB = jB;
  vC = jC;
  gl_Position = vec4(vP / uWall * 2.0 - 1.0, 0.0, 1.0);
}`;

const BLOT_FRAG = /* glsl */`
varying vec2 vP;
varying vec2 vL;
varying vec4 vB;
varying vec4 vC;
${MASK_GLSL}
${CRUMPLE_GLSL}
${FRESH_GLSL}
void main() {
  vec2 Q = vL - vC.zw;   // position dans le contact (la boule est bombée : le centre touche d'abord)
  float r2 = dot(Q, Q) / (vB.x * vB.x);
  if (r2 >= 1.0) discard;
  float Hd = crumple(vL, vB.y, vC.y) - 0.3 * crumpleBulge(Q, vB.x, vB.y);
  // pente par texel, bornée : au bord de deux pans, la hauteur saute (elle n'y a pas de pente)
  float fw = clamp(length(vec2(dFdx(Hd), dFdy(Hd))), 1e-4, 0.1);
  float k = vC.x * wetAt(vP);   // la peinture fraîche part, la sèche presque plus
  float e1 = k * blotLift(vB.w, Hd, fw), e0 = k * blotLift(vB.z, Hd, fw);
  float e = clamp(1.0 - (1.0 - e1) / max(1.0 - e0, 1e-3), 0.0, 1.0);
  gl_FragColor = vec4(0.0, 0.0, 0.0, e * maskOpen(vP, vec3(0.0)));
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

// Fond sous un lot de tampons de couverture c : fond·(1 − c) + avant·c, en deux
// passes mélangées (KEEP multiplie, ADD ajoute). Avant : carreau du début du geste,
// dans l'atlas de l'historique. Là où c = 0, le fond reste au bit près.
const FOND_KEEP_FRAG = /* glsl */`
uniform sampler2D tCov;
varying vec2 vUv;
void main() { gl_FragColor = vec4(0.0, 0.0, 0.0, clamp(texture2D(tCov, vUv).r, 0.0, 1.0)); }`;

const FOND_ADD_FRAG = /* glsl */`
uniform sampler2D tCov;
uniform sampler2D tSrc;
uniform vec4 uPre;   // uv couche → uv atlas : échelle, décalage
varying vec2 vUv;
void main() { gl_FragColor = texture2D(tSrc, vUv * uPre.xy + uPre.zw) * clamp(texture2D(tCov, vUv).r, 0.0, 1.0); }`;

// Part déjà prise de la peinture que recouvre le lot (carte de séchage de newspaper.js),
// interpolée entre les centres des mailles : point de départ de la couverture du lot.
const DRY_FRAG = /* glsl */`
uniform sampler2D tSrc;
uniform vec4 uDry;   // mailles en x, en y, taille d'une maille (m)
uniform vec2 uWall;
varying vec2 vUv;
float dryCell(ivec2 c) { return texelFetch(tSrc, clamp(c, ivec2(0), ivec2(uDry.xy) - 1), 0).r; }
void main() {
  vec2 g = vUv * uWall / uDry.z - 0.5, w = fract(g);
  ivec2 c = ivec2(floor(g));
  float d = mix(mix(dryCell(c), dryCell(c + ivec2(1, 0)), w.x),
                mix(dryCell(c + ivec2(0, 1)), dryCell(c + ivec2(1, 1)), w.x), w.y);
  gl_FragColor = vec4(d, 0.0, 0.0, d);
}`;

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

const LAYERS = LAYER_DEFS.map(L => L.key);
const SHOWN = ['color', 'aux', 'glow'];
const FOND = { color: 'fondColor', aux: 'fondAux', glow: 'fondGlow' };
const MAX_QUADS = 1024;
const MAX_BLOTS = 256;

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
    for (const name of ['iA', 'iB', 'iC', 'iD', 'iE']) {
      const attr = new THREE.InstancedBufferAttribute(new Float32Array(maxStamps * 4), 4);
      attr.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute(name, attr);
      this.attrs[name] = attr;
    }
    this.aA = this.attrs.iA.array;
    this.aB = this.attrs.iB.array;
    this.aC = this.attrs.iC.array;
    this.aD = this.attrs.iD.array;
    this.aE = this.attrs.iE.array;
    this.geo = geo;
    // caches de la toile (voir stencils.js), partagés par les shaders de tampon et de raclage
    this.maskSource = null;
    this._maskKey = null;
    this.maskUniforms = {
      uMaskN: { value: 0 },
      uMaskA: { value: Array.from({ length: MAX_MASKS }, () => new THREE.Vector4()) },
      uMaskB: { value: Array.from({ length: MAX_MASKS }, () => new THREE.Vector4()) },
      uTexel: { value: this.texel },
    };
    const stampUniforms = {
      uWall: { value: new THREE.Vector2(width, height) }, uPass: { value: 0 },
      ...this.maskUniforms,
    };
    this.stampMat = new THREE.ShaderMaterial({
      vertexShader: STAMP_VERT,
      fragmentShader: STAMP_FRAG,
      uniforms: stampUniforms,
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
    this.cover = null;   // couverture du lot en cours (fond), créée au premier lot
    this.drySrc = null;  // carte de séchage en attente (voir queueDry)
    this.dryTiles = new Set();
    this.stampScene = new THREE.Scene();
    this.stampMesh = new THREE.Mesh(geo, this.stampMat);
    this.stampMesh.frustumCulled = false;
    this.stampScene.add(this.stampMesh);

    // Lot de raclage : quadrilatères balayés par la lame
    this.scount = 0;
    this.spending = new Set();
    const sgeo = new THREE.BufferGeometry();
    this.sPos = new Float32Array(MAX_QUADS * 4 * 3);
    this.sAttr = new Float32Array(MAX_QUADS * 4 * 2);
    const idx = new Uint16Array(MAX_QUADS * 6);
    for (let q = 0; q < MAX_QUADS; q++) idx.set([0, 1, 2, 0, 2, 3].map(k => q * 4 + k), q * 6);
    sgeo.setIndex(new THREE.BufferAttribute(idx, 1));
    sgeo.setAttribute('position', new THREE.BufferAttribute(this.sPos, 3).setUsage(THREE.DynamicDrawUsage));
    sgeo.setAttribute('aS', new THREE.BufferAttribute(this.sAttr, 2).setUsage(THREE.DynamicDrawUsage));
    this.sgeo = sgeo;
    // dst × (1 − e) : l'effacement est multiplicatif, donc indépendant de l'ordre
    this.scrapeMat = new THREE.ShaderMaterial({
      vertexShader: SCRAPE_VERT, fragmentShader: SCRAPE_FRAG,
      uniforms: {
        uWall: stampUniforms.uWall, uMode: { value: 0 }, uSeed: { value: 0 },
        uToolA: { value: new THREE.Vector4() }, uToolB: { value: new THREE.Vector4() },
        ...this.maskUniforms,
      },
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.ZeroFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
      depthTest: false, depthWrite: false, transparent: true, side: THREE.DoubleSide,
    });
    this.scrapeScene = new THREE.Scene();
    const smesh = new THREE.Mesh(sgeo, this.scrapeMat);
    smesh.frustumCulled = false;
    this.scrapeScene.add(smesh);
    this.tool = null;

    // Lot du papier journal : disques instanciés, même mélange multiplicatif
    this.bcount = 0;
    const bgeo = new THREE.InstancedBufferGeometry();
    bgeo.index = quad.index;
    bgeo.setAttribute('position', quad.getAttribute('position'));
    this.battrs = {};
    for (const name of ['jA', 'jB', 'jC']) {
      const attr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BLOTS * 4), 4);
      attr.setUsage(THREE.DynamicDrawUsage);
      bgeo.setAttribute(name, attr);
      this.battrs[name] = attr;
    }
    this.bgeo = bgeo;
    this.blotMat = new THREE.ShaderMaterial({
      vertexShader: BLOT_VERT, fragmentShader: BLOT_FRAG,
      uniforms: { uWall: stampUniforms.uWall, tFresh: { value: null }, uFresh: { value: new THREE.Vector4(1, 1, 1, 0) }, ...this.maskUniforms },
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.ZeroFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
      depthTest: false, depthWrite: false, transparent: true,
    });
    this.blotScene = new THREE.Scene();
    const bmesh = new THREE.Mesh(bgeo, this.blotMat);
    bmesh.frustumCulled = false;
    this.blotScene.add(bmesh);

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
    // couche visible ± fond (raclage)
    const blendMat = equation => {
      const m = quadMat(COPY_FRAG);
      Object.assign(m, {
        blending: THREE.CustomBlending, blendEquation: equation, blendEquationAlpha: equation,
        blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor,
      });
      return m;
    };
    this.subMat = blendMat(THREE.ReverseSubtractEquation);
    this.addMat = blendMat(THREE.AddEquation);
    // fond ← fond·(1 − c) + avant·c
    this.fondKeepMat = quadMat(FOND_KEEP_FRAG);
    Object.assign(this.fondKeepMat, {
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendEquationAlpha: THREE.AddEquation,
      blendSrc: THREE.ZeroFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    this.fondAddMat = blendMat(THREE.AddEquation);
    this.fondAddMat.fragmentShader = FOND_ADD_FRAG;
    for (const m of [this.fondKeepMat, this.fondAddMat]) m.uniforms.tCov = { value: null };
    this.fondAddMat.uniforms.uPre = { value: new THREE.Vector4(1, 1, 0, 0) };
    this.dryMat = quadMat(DRY_FRAG);
    Object.assign(this.dryMat.uniforms, { uDry: { value: new THREE.Vector4(1, 1, 1, 0) }, uWall: stampUniforms.uWall });

    this._clearSet(this.targets);
  }

  // mémoire GPU occupée (couche couleur avec ses mipmaps, couches matière, fond, couverture du lot)
  get bytes() {
    return this.res[0] * this.res[1] * (8 * 2.33 + 2) + 4 * this.auxRes[0] * this.auxRes[1] * 8;
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

  // Couverture d'un lot de tampons (fond), à la taille de la couche couleur
  _cover() {
    const C = this.targets.color;
    if (!this.cover || this.cover.width !== C.width || this.cover.height !== C.height) {
      this.cover?.dispose();
      this.cover = new THREE.WebGLRenderTarget(C.width, C.height, {
        type: THREE.HalfFloatType, format: THREE.RedFormat, depthBuffer: false, stencilBuffer: false,
        generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      });
    }
    return this.cover;
  }

  _makeSet() {
    const set = {};
    for (const L of LAYER_DEFS) {
      const [w, h] = L.full ? this.res : this.auxRes;
      set[L.key] = this._makeRT(w, h, L.key === 'color');
    }
    return set;
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

  // nx, ny, nt : buse projetée sur la toile (m) et sa distance, pour la parallaxe des caches ;
  // seed : éponge (graine + sécheresse, voir sponge.js)
  push(u, v, a, hard, ax, ay, bx, by, paint, nx = u * this.width, ny = v * this.height, nt = 0, seed = 0) {
    if (this.count >= this.max) this.flush();
    // carreaux couverts par le tampon (pour l'historique)
    const [W, H] = this.res;
    const ex = (Math.abs(ax) + Math.abs(bx)) / this.width * W, ey = (Math.abs(ay) + Math.abs(by)) / this.height * H;
    const tx0 = Math.max(0, Math.floor((u * W - ex) / TILE)), tx1 = Math.min(this.tilesX - 1, Math.floor((u * W + ex) / TILE));
    const ty0 = Math.max(0, Math.floor((v * H - ey) / TILE)), ty1 = Math.min(this.tilesY - 1, Math.floor((v * H + ey) / TILE));
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) this.pending.add(tx + ',' + ty);
    const i = this.count++ * 4;
    const A = this.aA, B = this.aB, C = this.aC, D = this.aD, E = this.aE;
    const c = paint.lin, g = paint.glowLin;
    A[i] = u; A[i + 1] = v; A[i + 2] = a; A[i + 3] = hard;
    B[i] = ax; B[i + 1] = ay; B[i + 2] = bx; B[i + 3] = by;
    C[i] = c.r; C[i + 1] = c.g; C[i + 2] = c.b; C[i + 3] = paint.rough;
    D[i] = g.r; D[i + 1] = g.g; D[i + 2] = g.b; D[i + 3] = paint.metal;
    E[i] = nx; E[i + 1] = ny; E[i + 2] = nt; E[i + 3] = seed;
  }

  // Caches de la toile → uniformes (relus à chaque lot : impossible d'oublier une mise à jour)
  _syncMasks() {
    const src = this.maskSource;
    const key = src ? src.masks.length + ':' + (src.maskVersion || 0) : '0';
    if (key === this._maskKey) return;
    this._maskKey = key;
    const U = this.maskUniforms;
    U.uMaskN.value = packMasks(src ? src.masks : [], U.uMaskA.value, U.uMaskB.value);
  }

  // Carreaux couverts par une zone (texels de la couche couleur)
  _addTiles(set, x0, y0, x1, y1) {
    const tx0 = Math.max(0, Math.floor(x0 / TILE)), tx1 = Math.min(this.tilesX - 1, Math.floor(x1 / TILE));
    const ty0 = Math.max(0, Math.floor(y0 / TILE)), ty1 = Math.min(this.tilesY - 1, Math.floor(y1 / TILE));
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) set.add(tx + ',' + ty);
  }

  // Sauvegarde des carreaux avant qu'ils ne soient modifiés
  _protect(set) {
    const tiles = [...set];
    if (tiles.length) {
      this.history?.protect(this, tiles);
      for (const k of tiles) this.painted.add(k);
    }
    set.clear();
    return tiles;
  }

  _scissor(rt, x, y, w, h) {
    rt.scissor.set(x, y, w, h);
    rt.scissorTest = true;
  }

  _unscissor(rt) {
    rt.scissor.set(0, 0, rt.width, rt.height);
    rt.scissorTest = false;
  }

  // Peinture fraîche posée sur de la peinture déjà prise (src : carte de séchage, voir
  // newspaper.js ; zone x0..x1, y0..y1 en m) : au prochain lot, cette part entre dans le fond.
  queueDry(src, x0, y0, x1, y1) {
    this.drySrc = src;
    const [RW, RH] = this.res, set = new Set();
    this._addTiles(set, x0 / this.width * RW, y0 / this.height * RH, x1 / this.width * RW, y1 / this.height * RH);
    for (const k of set) { this.pending.add(k); this.dryTiles.add(k); }
  }

  flush() {
    let n = 0;
    if (this.count || this.drySrc) n += this._flushStamps();
    if (this.scount || this.bcount) n += this._flushLift();
    return n;
  }

  _flushStamps() {
    const n = this.count;
    for (const attr of Object.values(this.attrs)) {
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, n * 4);
      attr.needsUpdate = true;
    }
    this.geo.instanceCount = n;
    const tiles = this._protect(this.pending);
    this._syncMasks();
    const U = this.stampMat.uniforms, r = this.renderer;
    this._begin();
    // 1. fond : sous le trait, il glisse vers l'état du mur au début du geste (gardé par
    //    l'historique) à proportion de la couverture c du lot : fond·(1 − c) + avant·c.
    //    Lot après lot, c'est la couverture de tout le geste qui compte. La couverture part
    //    de la part sèche d de la peinture recouverte : c = 1 − (1 − d)·(1 − tampons).
    const dry = this.drySrc;
    if (this.history) {
      const cov = this._cover(), keep = this.fondKeepMat, add = this.fondAddMat;
      keep.uniforms.tCov.value = add.uniforms.tCov.value = cov.texture;
      if (dry) {
        dry.sync();
        this.dryMat.uniforms.uDry.value.set(dry.gw, dry.gh, dry.cell, 0);
      }
      for (const key of tiles) {
        const R = tileRect(this, key, LAYER_DEFS[0]);
        if (R.w <= 0 || R.h <= 0) continue;
        this._scissor(cov, R.x0, R.y0, R.w, R.h);
        if (dry && this.dryTiles.has(key)) this._blit(this.dryMat, dry.tex, cov);
        else this._blit(this.zeroMat, null, cov);
        this._unscissor(cov);
      }
      U.uPass.value = 3;
      r.setRenderTarget(cov);
      r.render(this.stampScene, this.cam);
      for (const key of tiles) {
        const slot = this.history.slotOf(this, key);
        if (!slot) continue;
        for (const L of LAYER_DEFS.slice(0, 3)) {
          const R = tileRect(this, key, L, slot);
          if (R.w <= 0 || R.h <= 0) continue;
          const fond = this.targets[FOND[L.key]];
          add.uniforms.uPre.value.set(fond.width / R.atlas.width, fond.height / R.atlas.height,
            (R.ax - R.x0) / R.atlas.width, (R.ay - R.y0) / R.atlas.height);
          this._scissor(fond, R.x0, R.y0, R.w, R.h);
          this._blit(keep, null, fond);
          this._blit(add, R.atlas.texture, fond);
          this._unscissor(fond);
        }
      }
      keep.uniforms.tCov.value = add.uniforms.tCov.value = add.uniforms.tSrc.value = this.dryMat.uniforms.tSrc.value = null;
    }
    if (dry) {
      dry.done();
      this.drySrc = null;
      this.dryTiles.clear();
    }
    // 2. peinture visible
    SHOWN.forEach((k, pass) => {
      U.uPass.value = pass;
      r.setRenderTarget(this.targets[k]);
      r.render(this.stampScene, this.cam);
    });
    this._end();
    this.count = 0;
    return n;
  }

  // --- raclage -----------------------------------------------------------------
  // tool : { width, streak, chip, deep, flex, nicks, chips, streaks } (voir scraper.js) ; seed : un par geste
  setTool(tool, seed) {
    if (this.tool === tool && this.toolSeed === seed) return;
    if (this.scount) this._flushLift();
    this.tool = tool;
    this.toolSeed = seed;
    const U = this.scrapeMat.uniforms;
    U.uToolA.value.set(tool.width / 2, 1 / tool.streak, tool.chip, tool.deep);
    U.uToolB.value.set(tool.flex, tool.nicks, tool.chips, tool.streaks);
    U.uSeed.value = seed;
  }

  // Quadrilatère balayé par la lame : extrémités gauche/droite avant (l0, r0) et après (r1, l1),
  // en mètres sur la toile ; p0, p1 : pression effective à chaque position.
  pushScrape(l0x, l0y, r0x, r0y, r1x, r1y, l1x, l1y, p0, p1) {
    if (this.scount >= MAX_QUADS) this._flushLift();
    const W = this.width, H = this.height, P = this.sPos;
    const q = this.scount++;
    const pts = [l0x, l0y, r0x, r0y, r1x, r1y, l1x, l1y];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let k = 0; k < 4; k++) {
      const u = pts[k * 2] / W, v = pts[k * 2 + 1] / H, o = (q * 4 + k) * 3;
      P[o] = u; P[o + 1] = v; P[o + 2] = 0;
      x0 = Math.min(x0, u); y0 = Math.min(y0, v); x1 = Math.max(x1, u); y1 = Math.max(y1, v);
    }
    this.sAttr.set([-1, p0, 1, p0, 1, p1, -1, p1], q * 8);
    const [RW, RH] = this.res;
    this._addTiles(this.spending, x0 * RW - 2, y0 * RH - 2, x1 * RW + 2, y1 * RH + 2);
  }

  // Papier journal : carte de fraîcheur de la peinture de cette toile (voir newspaper.js)
  setFreshness({ tex, gw, gh, cell, now }) {
    const U = this.blotMat.uniforms;
    U.tFresh.value = tex;
    U.uFresh.value.set(gw, gh, cell, now);
  }

  // Papier journal : disque de rayon R (m) centré en (x, y), papier tourné de th ;
  // p0 : pression déjà appliquée à cet endroit par cet appui (0 sinon) ; roll : chemin roulé (m).
  pushBlot(x, y, th, R, seed, p0, p1, strength, fold, rollX = 0, rollY = 0) {
    if (this.bcount >= MAX_BLOTS) this._flushLift();
    const i = this.bcount++ * 4;
    const A = this.battrs.jA.array, B = this.battrs.jB.array, C = this.battrs.jC.array;
    A[i] = x; A[i + 1] = y; A[i + 2] = Math.cos(th); A[i + 3] = Math.sin(th);
    B[i] = R; B[i + 1] = seed; B[i + 2] = p0; B[i + 3] = p1;
    C[i] = strength; C[i + 1] = fold; C[i + 2] = rollX; C[i + 3] = rollY;
    const [RW, RH] = this.res;
    this._addTiles(this.spending, (x - R) / this.width * RW - 2, (y - R) / this.height * RH - 2,
      (x + R) / this.width * RW + 2, (y + R) / this.height * RH + 2);
  }

  // Couche visible c, fond f : on racle l'écart (c − f), puis le fond. Résultat
  // f·(1−kd) + (c−f)·(1−k1)·(1−kd), exact quel que soit le recouvrement des quads.
  // Le papier journal multiplie aussi l'écart, sans toucher au fond.
  // Les passes ± fond se limitent aux carreaux touchés, sauvegardés par l'historique.
  _flushLift() {
    const n = this.scount, nb = this.bcount;
    for (const name of ['position', 'aS']) {
      const a = this.sgeo.getAttribute(name);
      a.clearUpdateRanges();
      a.addUpdateRange(0, n * 4 * a.itemSize);
      a.needsUpdate = true;
    }
    this.sgeo.setDrawRange(0, n * 6);
    for (const attr of Object.values(this.battrs)) {
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, nb * 4);
      attr.needsUpdate = true;
    }
    this.bgeo.instanceCount = nb;
    const tiles = this._protect(this.spending);
    this._syncMasks();
    const r = this.renderer, U = this.scrapeMat.uniforms, colorTex = this.targets.color.texture;
    this._begin();
    // les mipmaps de la couleur ne sont régénérées qu'au dernier rendu, une fois le fond rajouté
    colorTex.generateMipmaps = false;
    try {
      for (const L of LAYER_DEFS.slice(0, 3)) {
        const shown = this.targets[L.key], fond = this.targets[FOND[L.key]];
        const zone = tiles.map(key => tileRect(this, key, L)).filter(R => R.w > 0 && R.h > 0);
        const pass = (mat, R) => {
          this._scissor(shown, R.x0, R.y0, R.w, R.h);
          this._blit(mat, fond.texture, shown);
          this._unscissor(shown);
        };
        for (const R of zone) pass(this.subMat, R);
        r.setRenderTarget(shown);
        if (n) {
          U.uMode.value = 0;
          r.render(this.scrapeScene, this.cam);
        }
        if (nb) r.render(this.blotScene, this.cam);
        if (n) {
          U.uMode.value = 1;
          r.setRenderTarget(fond);
          r.render(this.scrapeScene, this.cam);
        }
        zone.forEach((R, i) => {
          if (L.key === 'color' && i === zone.length - 1) colorTex.generateMipmaps = true;
          pass(this.addMat, R);
        });
      }
    } finally {
      colorTex.generateMipmaps = true;
      this._end();
    }
    this.scount = 0;
    this.bcount = 0;
    return n + nb;
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
      this._blit(this.encodeMat, src.texture, rt, k === 'aux' || k === 'fondAux' ? 1 : 0);
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

  // Contenu brut (half-float) d'une couche, pour les contrôles d'annulation exacte
  readRaw(key) {
    this.flush();
    const rt = this.targets[key], out = new Uint16Array(rt.width * rt.height * 4);
    this._begin();
    this.renderer.readRenderTargetPixels(rt, 0, 0, rt.width, rt.height, out);
    this._end();
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
    this.cover?.dispose();
    this.disposed = true;
    this.geo.dispose();
    this.sgeo.dispose();
    this.bgeo.dispose();
    for (const m of [this.stampMat, this.fondKeepMat, this.fondAddMat, this.scrapeMat, this.blotMat, this.copyMat, this.encodeMat, this.decodeMat,
      this.zeroMat, this.resampleMat, this.subMat, this.addMat, this.dryMat]) m.dispose();
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
      this._blit(this.decodeMat, tex, this.targets[k], k === 'aux' || k === 'fondAux' ? 1 : 0);
      tex.dispose();
    }
    this._end();
    for (const k of this.allTiles()) this.painted.add(k);
  }
}
