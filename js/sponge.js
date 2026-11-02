import * as THREE from 'three';
import { touchPressure } from './scraper.js';

// Éponge naturelle, chargée de la couleur courante. Tamponnée, elle ne pose la
// peinture que là où sa face touche : des îlots aux bords mous (ses bosses),
// percés de trous nets (ses pores), comme l'effet éponge des décorateurs.
// Chaque appui est différent (l'éponge a tourné dans la main) ; appuyer plus
// fort écrase l'éponge : le contact s'étend et les pores se resserrent.
// Frottée, elle traîne son motif : les pores s'étirent en stries le long du geste.
// Elle se vide d'un appui à l'autre (une éponge à moitié sèche ne marque plus
// que ses bosses) ; tenue loin du mur un instant, elle est rechargée.
export const SPONGE = {
  id: 'eponge', name: 'Éponge', label: 'Éponge',
  hint: 'éponge chargée de la couleur : tamponner pour un grain poreux, frotter pour l\'étaler (touche G)',
  size: 0.08,                 // diamètre de l'éponge (m)…
  range: [0.03, 0.2],         // …réglable à la barre, au centimètre
  sizeTitle: 'Taille de l\'éponge (diamètre)', sizeWord: 'Diamètre',
};

const PRESS_DEPTH = 0.03;    // VR : écraser l'éponge de 3 cm = pression maximale
const STEP = 0.003;          // en frottant, un tampon tous les 3 mm…
const TURN = 4 * Math.PI / 180;   // …ou tous les 4° de rotation du poignet
const DAB = 0.92;            // dose d'un appui franc (presque couvrant là où l'éponge touche)
const RUB = 0.22;            // dose d'un tampon de frottement (ils se recouvrent)
const DAB_COST = 0.18;       // charge prise par un appui à pleine pression : 5 à 6 appuis vident l'éponge
const RUB_COST = 1.4;        // charge prise par mètre frotté
const RELOAD = 1.0;          // tenue loin du mur aussi longtemps (s), l'éponge est rechargée
const WET = 0.6;             // au-dessus de cette charge, l'éponge marque à plein

// Distance manette → face de l'éponge (VR) : la main tient le dos de l'éponge
export function spongeDepth(size) {
  return Math.max(0.03, size * 0.5);
}
export function spongeReach(size) {
  return 0.03 + spongeDepth(size);
}

// Face de l'éponge, GLSL (tampons de paint.js, dureté 2 + pression). L : position
// sur la face (m) ; R : rayon ; p : pression ; dry : 0 chargée … 1 sèche.
// Relief : grandes bosses (2,5 cm) et grain (7 mm) ; la face est bombée, le centre
// touche d'abord. Pores : deux réseaux de trous ronds de tailles inégales,
// au moins 6 texels de maille (plus fins, ils se trameraient en gris).
export const SPONGE_GLSL = /* glsl */`
float sHash1(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 15731.743); }
vec2 sHash2(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453);
}
float sNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(sHash1(i), sHash1(i + vec2(1.0, 0.0)), f.x), mix(sHash1(i + vec2(0.0, 1.0)), sHash1(i + vec2(1.0, 1.0)), f.x), f.y);
}
// distance au pore le plus proche, rapportée à son rayon (< 1 : dans le trou)
float sPores(vec2 x, float seed, float rmin, float rmax) {
  vec2 n = floor(x), f = fract(x);
  float best = 8.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j)), id = n + g + seed;
    best = min(best, length(g + sHash2(id) - f) / mix(rmin, rmax, sHash1(id + 3.7)));
  }
  return best;
}
float spongeContact(vec2 L, float R, float p, float dry, float seed, float texel) {
  vec2 o = 37.0 * vec2(sHash1(vec2(seed, 1.3)), sHash1(vec2(seed, 7.9)));
  // contour bosselé
  float q = length(L) / (R * (0.86 + 0.14 * sNoise(normalize(L + 1e-6) * 1.8 + o)));
  if (q >= 1.0) return 0.0;
  float h = 0.5 * sNoise(L / 0.025 + o) + 0.5 * sNoise(L / 0.007 + o.yx);
  // appuyer abaisse le seuil de contact ; une éponge sèche ne marque que ses bosses
  float thr = 0.62 - 0.55 * p + 0.3 * dry;
  float c = smoothstep(thr - 0.03, thr + 0.03, h - 0.3 * q * q);
  // pores, resserrés quand l'éponge s'écrase ; bord net, sur un texel
  float cell = max(0.012, 6.0 * texel), k = 1.0 - 0.25 * p;
  float d1 = sPores(L / cell + o, seed, 0.2 * k, 0.45 * k);
  float d2 = sPores(L / (cell * 0.5) + o.yx * 1.7, seed + 11.0, 0.12 * k, 0.32 * k);
  float w1 = max(fwidth(d1), 1e-3), w2 = max(fwidth(d2), 1e-3);
  float solid = smoothstep(1.0 - w1, 1.0 + w1, d1) * smoothstep(1.0 - w2, 1.0 + w2, d2);
  return c * solid * (0.85 + 0.15 * h);
}`;

const _e = new THREE.Vector3();

export class Sponge {
  constructor({ project }) {
    this.project = project;     // (origin, dir, right, up) → impact sur une toile (voir Spray.project)
    this.onStrokeStart = null;
    this.onDeposit = null;      // (toile, x, y, rayon) : peinture fraîche (voir newspaper.js)
    this.hit = null;
    this.contact = false;
    this.pressure = 0;
    this.speed = 0;
    this.prev = null;
    this.stroking = false;
    this.load = 1;              // charge de l'éponge (0..1)
    this.offWall = Infinity;
    this.paint = null;
    this.seed = 0;
    this.turn = 0;
    this.size = SPONGE.size;
    this.random = Math.random;  // tirage de la graine et de la rotation (le test le remplace par une suite à graine fixe)
    this.mesh = makeSpongeMesh();
  }

  // input : { origin, dir, right, up, pressure } + en VR { reach, trigger } ; size : diamètre (m) ;
  // realistic : la charge s'épuise (sinon l'éponge reste pleine)
  update(dt, input, size = this.size, paint = this.paint, realistic = true) {
    this.size = size;
    const hit = input ? this.project(input.origin, input.dir, input.right, input.up) : null;
    this.hit = hit;
    const p = hit ? touchPressure(hit, input, PRESS_DEPTH).p : 0;
    const contact = p > 0.02;
    if (contact && !this.contact) this.touched = performance.now();
    this.contact = contact;
    this.pressure = contact ? p : 0;
    if (paint !== this.paint) { this.paint = paint; this.offWall = Infinity; }
    this.realistic = realistic;
    if (!contact) {
      this.offWall += dt;
      this.prev = null;
      this.stroking = false;
      this.speed = 0;
      return false;
    }
    if (!this.stroking) {
      // nouvel appui : l'éponge a tourné dans la main ; retrempée si elle est restée loin du mur
      this.stroking = true;
      if (this.offWall >= RELOAD || !realistic) this.load = 1;
      this.seed = Math.floor(this.random() * 61);
      this.turn = this.random() * Math.PI * 2;
      this.prev = null;
      this.onStrokeStart?.();
    }
    this.offWall = 0;
    const f = hit.canvas.frame;
    _e.copy(input.right).addScaledVector(f.n, -input.right.dot(f.n));
    const th = Math.atan2(_e.dot(f.ey), _e.dot(f.ex)) + this.turn;
    const S = hit.canvas.ensureSurface();
    const cur = { canvas: hit.canvas, x: hit.x, y: hit.y, th, p };
    const prev = this.prev && this.prev.canvas === hit.canvas ? this.prev : null;
    if (!prev) {
      this._stamp(S, cur, DAB);
      this._drain(DAB_COST * (0.5 + 0.5 * p));
      this.prev = cur;
    } else {
      const dist = Math.hypot(cur.x - prev.x, cur.y - prev.y);
      let dth = th - prev.th;
      dth = Math.atan2(Math.sin(dth), Math.cos(dth));
      this.speed = dt > 0 ? dist / dt : 0;
      if (dist > 0.5) {
        this.prev = cur;
      } else if (dist > STEP || Math.abs(dth) > TURN) {
        // frotter : le motif glisse avec l'éponge, ses pores s'étirent en stries
        const n = Math.min(64, Math.ceil(Math.max(dist / STEP, Math.abs(dth) / TURN)));
        let last = prev;
        for (let k = 1; k <= n; k++) {
          const u = k / n;
          last = { canvas: hit.canvas, x: prev.x + (cur.x - prev.x) * u, y: prev.y + (cur.y - prev.y) * u,
            th: prev.th + dth * u, p: prev.p + (cur.p - prev.p) * u };
          this._stamp(S, last, RUB);
        }
        this._drain(RUB_COST * dist * (0.6 + 0.4 * p));
        this.prev = last;
      } else if (p > prev.p + 0.05) {
        // appuyer plus fort sur place : l'éponge s'écrase, le contact s'étend
        this._stamp(S, { ...prev, p }, DAB * 0.5);
        prev.p = p;
      }
    }
    this.onDeposit?.(hit.canvas, hit.x, hit.y, size / 2);
    return true;
  }

  _drain(k) {
    if (this.realistic) this.load = Math.max(0, this.load - k);
  }

  // Un tampon de la face de l'éponge. Moins chargée, elle pose moins et ne marque
  // plus que ses bosses : la sécheresse est passée au shader avec la graine.
  _stamp(S, s, dose) {
    const w = Math.min(1, this.load / WET);
    if (w <= 0.02) return;
    const R = this.size / 2, A = R * 1.1, c = Math.cos(s.th), n = Math.sin(s.th);
    S.push(s.x / S.width, s.y / S.height, dose * (0.3 + 0.7 * w), 2 + Math.min(0.999, s.p),
      c * A, n * A, -n * A, c * A, this.paint, s.x, s.y, 0, this.seed + 0.99 * (1 - w));
  }

  reset() {
    this.prev = null;
    this.stroking = false;
    this.contact = false;
    this.pressure = 0;
  }

  // Éponge tenue : à la taille choisie, teintée de la couleur selon sa charge
  updateMesh(size, paint) {
    sizeSpongeMesh(this.mesh, size);
    const u = this.mesh.userData, key = (paint?.hex || '') + ':' + this.load.toFixed(2);
    if (u.key === key) return;
    u.key = key;
    u.wet.set(paint?.hex || '#888888');
    u.mat.color.copy(u.dry).lerp(u.wet, 0.15 + 0.65 * Math.min(1, this.load / WET));
  }
}

// Éponge tenue : galet bosselé, face vers −Z (sa face en z = −reach), pores sombres.
let poreTex = null;
function poreTexture() {
  if (poreTex) return poreTex;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, 256, 256);
  let s = 11;
  const rand = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 420; i++) {
    g.fillStyle = `rgba(40,30,20,${0.35 + rand() * 0.45})`;
    g.beginPath();
    g.arc(rand() * 256, rand() * 256, 1 + rand() * rand() * 7, 0, Math.PI * 2);
    g.fill();
  }
  poreTex = new THREE.CanvasTexture(c);
  poreTex.colorSpace = THREE.SRGBColorSpace;
  poreTex.wrapS = poreTex.wrapT = THREE.RepeatWrapping;
  return poreTex;
}

function makeSpongeMesh() {
  const g = new THREE.Group();
  const geo = new THREE.IcosahedronGeometry(1, 3);
  // bosses : chaque sommet rentre ou sort un peu (sommets confondus ensemble : la forme reste fermée)
  const pos = geo.getAttribute('position'), k = new Map();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), key = `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`;
    if (!k.has(key)) k.set(key, 0.88 + Math.random() * 0.2);
    const f = k.get(key);
    pos.setXYZ(i, x * f, y * f, z * f);
  }
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: 0xd8b56a, map: poreTexture(), roughness: 1 });
  const body = new THREE.Mesh(geo, mat);
  g.add(body);
  g.userData = { body, mat, size: 0, wet: new THREE.Color(), dry: new THREE.Color(0xd8b56a), key: '' };
  sizeSpongeMesh(g, SPONGE.size);
  g.visible = false;
  return g;
}

// Éponge de diamètre size : sa face reste à spongeReach(size) de la main
export function sizeSpongeMesh(g, size) {
  if (g.userData.size === size) return;
  g.userData.size = size;
  const d = spongeDepth(size), body = g.userData.body;
  body.scale.set(size / 2, size / 2 * 0.8, d / 2);
  body.position.z = -spongeReach(size) + d / 2;
}
