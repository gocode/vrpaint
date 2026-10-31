import * as THREE from 'three';
import { buildStreet } from './street.js';
import { Sky } from './sky.js';
import { Traffic } from './cars.js';

// ---------------------------------------------------------------------------
// Textures procédurales (aucun fichier externe)
// ---------------------------------------------------------------------------

function rng(seed) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function noise(ctx, w, h, amp, rand, mono = true) {
  const img = ctx.getImageData(0, 0, w, h), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rand() - 0.5) * amp;
    d[i] += n;
    d[i + 1] += mono ? n : (rand() - 0.5) * amp;
    d[i + 2] += mono ? n : (rand() - 0.5) * amp;
  }
  ctx.putImageData(img, 0, 0);
}

function blotches(ctx, w, h, count, rand, colors, maxR, alpha) {
  for (let i = 0; i < count; i++) {
    const x = rand() * w, y = rand() * h, r = maxR * (0.2 + rand());
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const c = colors[(rand() * colors.length) | 0];
    g.addColorStop(0, c);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = alpha * (0.4 + rand() * 0.6);
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  ctx.globalAlpha = 1;
}

function grime(ctx, w, h, ppm, rand) {
  // salissures au pied du mur et coulures de pluie depuis le haut
  const g = ctx.createLinearGradient(0, h, 0, h - 0.5 * ppm);
  g.addColorStop(0, 'rgba(40,34,28,0.45)');
  g.addColorStop(1, 'rgba(40,34,28,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, h - 0.5 * ppm, w, 0.5 * ppm);
  for (let i = 0; i < 5 * w / ppm; i++) {
    const x = rand() * w, len = (0.15 + rand() * 0.6) * ppm, wd = 4 + rand() * 14;
    const s = ctx.createLinearGradient(0, 0, 0, len);
    s.addColorStop(0, 'rgba(30,30,30,0.08)');
    s.addColorStop(1, 'rgba(30,30,30,0)');
    ctx.fillStyle = s;
    ctx.fillRect(x, 0, wd, len);
  }
}

// ~340 px/m, borné pour la mémoire du Quest
const texWidth = W => Math.min(4096, Math.max(1024, Math.round(W * 340)));

const RED_BRICKS = ['#9c4a32', '#a8553a', '#8e3f2b', '#b0623f', '#7d3a28', '#a14d36', '#b86f4c', '#954634'];

// Appareillage de briques (ou de parpaings) en quinconce.
function brickWall(W, H, { tones = RED_BRICKS, mortar = '#b1aa9f', burnt = '#5e2c1f', seed = 7,
  bw: bwm = 0.215, bh: bhm = 0.065, joint = 0.011, rough = 0.92, bumpScale = 4, variation = 0.25 } = {}) {
  const w = texWidth(W), h = Math.round(w * H / W), ppm = w / W, rand = rng(seed);
  const c = canvas(w, h), b = canvas(w, h), x = c.getContext('2d'), y = b.getContext('2d');
  x.fillStyle = mortar; x.fillRect(0, 0, w, h);
  y.fillStyle = '#404040'; y.fillRect(0, 0, w, h);
  const bw = bwm * ppm, bh = bhm * ppm, j = joint * ppm;
  for (let row = 0, y0 = h; y0 > -bh; row++, y0 -= bh + j) {
    const off = (row % 2) * (bw + j) / 2;
    for (let x0 = -off; x0 < w; x0 += bw + j) {
      x.fillStyle = burnt && rand() < 0.06 ? burnt : tones[(rand() * tones.length) | 0];
      x.globalAlpha = 1;
      x.fillRect(x0 + j / 2, y0 - bh - j / 2, bw, bh);
      x.globalAlpha = variation * rand();
      x.fillStyle = rand() < 0.5 ? '#000' : '#fff';
      x.fillRect(x0 + j / 2, y0 - bh - j / 2, bw, bh);
      const v = 185 + rand() * 50 | 0;
      y.fillStyle = `rgb(${v},${v},${v})`;
      y.fillRect(x0 + j / 2 + 1, y0 - bh - j / 2 + 1, bw - 2, bh - 2);
    }
  }
  x.globalAlpha = 1;
  blotches(x, w, h, 120, rand, ['#2b2520', '#d8cfc0'], 0.5 * ppm, 0.12);
  grime(x, w, h, ppm, rand);
  noise(x, w, h, 30, rand, false);
  noise(y, w, h, 50, rand);
  return { map: c, bump: b, rough, bumpScale };
}

// Moellons de pierre en assises irrégulières.
function stoneWall(W, H) {
  const w = texWidth(W), h = Math.round(w * H / W), ppm = w / W, rand = rng(23);
  const c = canvas(w, h), b = canvas(w, h), x = c.getContext('2d'), y = b.getContext('2d');
  x.fillStyle = '#7d756a'; x.fillRect(0, 0, w, h);
  y.fillStyle = '#2a2a2a'; y.fillRect(0, 0, w, h);
  const tones = ['#b9a98f', '#a8987e', '#c4b69c', '#9d9282', '#b3a48a', '#8f8678', '#c9bda6'];
  for (let y0 = h; y0 > 0;) {
    const rh = (0.18 + rand() * 0.16) * ppm;
    for (let x0 = -rand() * 0.3 * ppm; x0 < w;) {
      const sw = (0.25 + rand() * 0.45) * ppm, gap = 0.018 * ppm;
      const r = Math.min(sw, rh) * (0.15 + rand() * 0.2);
      x.fillStyle = tones[(rand() * tones.length) | 0];
      x.beginPath(); x.roundRect(x0 + gap, y0 - rh + gap, sw - gap * 2, rh - gap * 2, r); x.fill();
      const v = 150 + rand() * 90 | 0;
      y.fillStyle = `rgb(${v},${v},${v})`;
      y.beginPath(); y.roundRect(x0 + gap, y0 - rh + gap, sw - gap * 2, rh - gap * 2, r); y.fill();
      x0 += sw;
    }
    y0 -= rh;
  }
  blotches(x, w, h, 300, rand, ['#3a342c', '#ddd2bd', '#6f6a4a'], 0.3 * ppm, 0.12);
  grime(x, w, h, ppm, rand);
  noise(x, w, h, 34, rand, false);
  noise(y, w, h, 70, rand);
  return { map: c, bump: b, rough: 0.95, bumpScale: 6 };
}

// Tôle ondulée (onde de 7,6 cm), quelques traces de rouille.
function corrugatedWall(W, H) {
  const w = texWidth(W), h = Math.round(w * H / W), ppm = w / W, rand = rng(41);
  const c = canvas(w, h), b = canvas(w, h), x = c.getContext('2d'), y = b.getContext('2d');
  const period = 0.076 * ppm;
  const gx = x.createLinearGradient(0, 0, period, 0), gy = y.createLinearGradient(0, 0, period, 0);
  for (const [t, v] of [[0, 0.75], [0.25, 1], [0.5, 0.75], [0.75, 0.45], [1, 0.75]]) {
    const k = Math.round(v * 255);
    gx.addColorStop(t, `rgb(${k * 0.62 | 0},${k * 0.66 | 0},${k * 0.68 | 0})`);
    gy.addColorStop(t, `rgb(${k},${k},${k})`);
  }
  const px = x.createPattern(canvasStripe(period, h, gx), 'repeat');
  const pyy = y.createPattern(canvasStripe(period, h, gy), 'repeat');
  x.fillStyle = px; x.fillRect(0, 0, w, h);
  y.fillStyle = pyy; y.fillRect(0, 0, w, h);
  // plaques de 1 m de large qui se chevauchent
  x.fillStyle = 'rgba(0,0,0,0.25)';
  for (let k = 1; k < W; k++) x.fillRect(k * ppm, 0, 3, h);
  blotches(x, w, h, 90, rand, ['#8a4a22', '#6b3a1c', '#a35f2c'], 0.5 * ppm, 0.35);
  grime(x, w, h, ppm, rand);
  noise(x, w, h, 16, rand, false);
  return { map: c, bump: b, rough: 0.55, bumpScale: 8, metal: 0.5 };
}

function canvasStripe(pw, h, fill) {
  const s = canvas(Math.max(2, Math.round(pw)), 4), x = s.getContext('2d');
  x.fillStyle = fill; x.fillRect(0, 0, s.width, 4);
  return s;
}

// Palissade de planches verticales.
function woodWall(W, H) {
  const w = texWidth(W), h = Math.round(w * H / W), ppm = w / W, rand = rng(53);
  const c = canvas(w, h), b = canvas(w, h), x = c.getContext('2d'), y = b.getContext('2d');
  x.fillStyle = '#2a2018'; x.fillRect(0, 0, w, h);
  y.fillStyle = '#101010'; y.fillRect(0, 0, w, h);
  const tones = ['#8a6a48', '#7b5d3e', '#97764f', '#6f5236', '#a07c55'];
  for (let x0 = 0; x0 < w;) {
    const pw = (0.11 + rand() * 0.04) * ppm, gap = 0.008 * ppm;
    x.fillStyle = tones[(rand() * tones.length) | 0];
    x.fillRect(x0, 0, pw - gap, h);
    y.fillStyle = '#b8b8b8';
    y.fillRect(x0, 0, pw - gap, h);
    // veinage
    for (let k = 0; k < 14; k++) {
      x.strokeStyle = `rgba(40,25,10,${0.08 + rand() * 0.12})`;
      x.lineWidth = 1 + rand() * 2;
      x.beginPath();
      const gx = x0 + rand() * (pw - gap);
      x.moveTo(gx, 0);
      for (let yy = 0; yy < h; yy += 40) x.lineTo(gx + Math.sin(yy * 0.01 + k) * 3, yy);
      x.stroke();
    }
    // traverses et clous
    for (const ty of [0.35, H - 0.4]) {
      x.fillStyle = '#222'; x.beginPath(); x.arc(x0 + pw / 2, h - ty * ppm, 2.5, 0, 7); x.fill();
    }
    x0 += pw;
  }
  grime(x, w, h, ppm, rand);
  noise(x, w, h, 20, rand, false);
  noise(y, w, h, 30, rand);
  return { map: c, bump: b, rough: 0.9, bumpScale: 5 };
}

// Crépi projeté, très granuleux.
function roughcastWall(W, H) {
  const w = texWidth(W), h = Math.round(w * H / W), ppm = w / W, rand = rng(61);
  const c = canvas(w, h), b = canvas(w, h), x = c.getContext('2d'), y = b.getContext('2d');
  x.fillStyle = '#d9c9a3'; x.fillRect(0, 0, w, h);
  y.fillStyle = '#707070'; y.fillRect(0, 0, w, h);
  blotches(x, w, h, 300, rand, ['#b7a47c', '#efe3c6', '#8f8062'], 0.4 * ppm, 0.12);
  for (let i = 0; i < w * h / 60; i++) {
    const px = rand() * w, py = rand() * h, r = 0.8 + rand() * 2.2, v = 90 + rand() * 165 | 0;
    y.fillStyle = `rgb(${v},${v},${v})`;
    y.fillRect(px, py, r, r);
  }
  grime(x, w, h, ppm, rand);
  noise(x, w, h, 18, rand);
  return { map: c, bump: b, rough: 0.96, bumpScale: 5 };
}

// Carrelage biseauté de couloir de métro (15 × 7,5 cm).
function tileWall(W, H) {
  return brickWall(W, H, {
    tones: ['#f2f1ec', '#eeede7', '#f5f4ef', '#e9e8e1'], mortar: '#b9b7ae', burnt: null, seed: 71,
    bw: 0.15, bh: 0.075, joint: 0.004, rough: 0.25, bumpScale: 2, variation: 0.04,
  });
}

function concreteWall(W, H) {
  const w = texWidth(W), h = Math.round(w * H / W), ppm = w / W, rand = rng(11);
  const c = canvas(w, h), b = canvas(w, h), x = c.getContext('2d'), y = b.getContext('2d');
  x.fillStyle = '#a3a09a'; x.fillRect(0, 0, w, h);
  y.fillStyle = '#808080'; y.fillRect(0, 0, w, h);
  blotches(x, w, h, 500, rand, ['#7f7c76', '#bdb9b1', '#8f8a80', '#6f6c68'], 0.35 * ppm, 0.12);
  blotches(y, w, h, 300, rand, ['#606060', '#a0a0a0'], 0.2 * ppm, 0.2);
  // banches de coffrage 1,25 m × 0,625 m, joints et trous de tiges
  const pw = 1.25 * ppm, ph = 0.625 * ppm;
  x.strokeStyle = 'rgba(60,58,55,0.35)'; y.strokeStyle = '#303030';
  x.lineWidth = y.lineWidth = 2;
  for (let px = 0; px <= w; px += pw) for (const ctx of [x, y]) { ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, h); ctx.stroke(); }
  for (let py = h; py >= 0; py -= ph) for (const ctx of [x, y]) { ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(w, py); ctx.stroke(); }
  for (let px = pw / 2; px < w; px += pw) for (let py = h - ph / 2; py > 0; py -= ph) {
    x.fillStyle = 'rgba(45,42,40,0.8)'; y.fillStyle = '#101010';
    for (const [ctx] of [[x], [y]]) { ctx.beginPath(); ctx.arc(px, py, 0.012 * ppm, 0, Math.PI * 2); ctx.fill(); }
  }
  // bulles d'air
  for (let i = 0; i < 2500; i++) {
    const px = rand() * w, py = rand() * h, r = 0.5 + rand() * 1.8;
    x.fillStyle = 'rgba(70,68,64,0.5)'; y.fillStyle = '#383838';
    x.beginPath(); x.arc(px, py, r, 0, 7); x.fill();
    y.beginPath(); y.arc(px, py, r, 0, 7); y.fill();
  }
  grime(x, w, h, ppm, rand);
  noise(x, w, h, 22, rand);
  noise(y, w, h, 40, rand);
  return { map: c, bump: b, rough: 0.88, bumpScale: 2 };
}

function paintedWall(W, H, base, seed, rough) {
  const w = texWidth(W), h = Math.round(w * H / W), ppm = w / W, rand = rng(seed);
  const c = canvas(w, h), b = canvas(w, h), x = c.getContext('2d'), y = b.getContext('2d');
  x.fillStyle = base; x.fillRect(0, 0, w, h);
  y.fillStyle = '#808080'; y.fillRect(0, 0, w, h);
  blotches(x, w, h, 200, rand, ['#000', '#fff'], 0.4 * ppm, 0.035);
  blotches(y, w, h, 400, rand, ['#606060', '#a0a0a0'], 0.08 * ppm, 0.4);
  grime(x, w, h, ppm, rand);
  noise(x, w, h, 10, rand);
  noise(y, w, h, 60, rand);
  return { map: c, bump: b, rough, bumpScale: 1 };
}

const WALL_BUILDERS = {
  briques: (W, H) => brickWall(W, H),
  'briques-peintes': (W, H) => brickWall(W, H, {
    tones: ['#e8e4da', '#dedad0', '#ece9e1', '#d6d2c8'], mortar: '#c9c4b8', burnt: '#c7c1b3', seed: 9, rough: 0.8,
  }),
  parpaings: (W, H) => brickWall(W, H, {
    tones: ['#8f8d88', '#9a9893', '#85837e', '#a19f99'], mortar: '#6f6d68', burnt: '#76746f', seed: 13,
    bw: 0.5, bh: 0.2, joint: 0.012, rough: 0.97, bumpScale: 3,
  }),
  pierre: stoneWall,
  beton: concreteWall,
  crepi: roughcastWall,
  tole: corrugatedWall,
  bois: woodWall,
  carrelage: tileWall,
  blanc: (W, H) => paintedWall(W, H, '#e9e5dc', 3, 0.82),
  noir: (W, H) => paintedWall(W, H, '#252527', 5, 0.75),
};

// ---------------------------------------------------------------------------
// Bombe de peinture tenue en main. Origine = buse, jet vers -Z, corps vers -Y.
// ---------------------------------------------------------------------------

function makeCan() {
  const g = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: 0xd91e25, roughness: 0.35, metalness: 0.2 });
  const silver = new THREE.MeshStandardMaterial({ color: 0xcfd3d8, roughness: 0.25, metalness: 1 });
  const capMat = new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.5 });
  const R = 0.033;
  const cyl = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 0.165, 32), body);
  cyl.position.y = -0.12;
  const bottom = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.97, R * 0.9, 0.008, 32), silver);
  bottom.position.y = -0.206;
  const shoulder = new THREE.Mesh(new THREE.CylinderGeometry(0.016, R, 0.022, 32), silver);
  shoulder.position.y = -0.027;
  const valve = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, 0.008, 12), silver);
  valve.position.y = -0.014;
  const actuator = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.0095, 0.013, 24), capMat);
  actuator.position.set(0, -0.004, 0.002);
  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.0022, 0.0022, 0.004, 12), new THREE.MeshStandardMaterial({ color: 0x111111 }));
  nozzle.rotation.x = Math.PI / 2;
  nozzle.position.set(0, 0, -0.0075);
  g.add(cyl, bottom, shoulder, valve, actuator, nozzle);
  g.userData = { body, capMat };
  return g;
}

// Environnement de reflets extérieur : ciel bleu, horizon clair, sol sombre et
// soleil. C'est ce contraste qui donne leur aspect aux peintures chromées.
function makeEnvironment(renderer) {
  const env = new THREE.Scene();
  env.add(new THREE.Mesh(new THREE.SphereGeometry(10, 48, 24), new THREE.ShaderMaterial({
    side: THREE.BackSide,
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying vec3 vDir;
      void main(){
        float h = vDir.y;
        vec3 sky = mix(vec3(1.6, 1.65, 1.7), vec3(0.18, 0.38, 0.85), smoothstep(0.0, 0.5, h));
        vec3 ground = mix(vec3(0.75, 0.7, 0.65), vec3(0.22, 0.21, 0.2), smoothstep(0.0, -0.35, h));
        gl_FragColor = vec4(h > 0.0 ? sky : ground, 1.0);
      }`,
  })));
  const sun = new THREE.Mesh(new THREE.SphereGeometry(0.6, 16, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(30, 28, 24) }));
  sun.position.set(-4, 7, 5).setLength(9);
  env.add(sun);
  // quelques façades pour casser l'uniformité de l'horizon
  const facade = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 0.52, 0.46) });
  for (let i = 0; i < 9; i++) {
    const a = i / 9 * Math.PI * 2, hgt = 1 + (i * 7 % 5) * 0.5;
    const b = new THREE.Mesh(new THREE.BoxGeometry(2.4, hgt, 0.5), facade);
    b.position.set(Math.cos(a) * 8, hgt / 2 - 0.2, Math.sin(a) * 8);
    b.lookAt(0, hgt / 2, 0);
    env.add(b);
  }
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(env, 0.02).texture;
  pmrem.dispose();
  return tex;
}

// ---------------------------------------------------------------------------

export class World {
  constructor(scene, renderer, surface, wall) {
    this.scene = scene;
    this.renderer = renderer;
    this.wall = wall;
    const W = wall.width, H = wall.height, Z = wall.z;

    scene.environment = makeEnvironment(renderer);

    // Ciel (Voie lactée, avions, étoiles filantes la nuit)
    this.skyDome = new Sky(scene);

    scene.fog = new THREE.Fog(0xdfe9f0, 25, 110);

    // Lumières ; le projecteur suit le réverbère le plus proche du mur
    this.hemi = new THREE.HemisphereLight(0xdfe9ff, 0x6b6256, 0.6);
    this.sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
    this.sun.position.set(-4, 8, 6);
    this.lamp = new THREE.SpotLight(0xffd9a0, 0, 0, 0.6, 0.8, 1.6);
    scene.add(this.hemi, this.sun, this.lamp, this.lamp.target);

    // Façade peinte : texture du mur + couches de peinture
    this.wallUniforms = {
      uPaint: { value: null }, uAux: { value: null }, uGlow: { value: null }, uGlowK: { value: 0.2 },
    };
    this.wallMat = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0 });
    this.wallMat.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, this.wallUniforms);
      sh.fragmentShader = 'uniform sampler2D uPaint;\nuniform sampler2D uAux;\nuniform sampler2D uGlow;\nuniform float uGlowK;\n' + sh.fragmentShader
        .replace('#include <map_fragment>', `#include <map_fragment>
          vec4 pS = texture2D(uPaint, vMapUv);
          float pA = clamp(pS.a, 0.0, 1.0);
          diffuseColor.rgb = mix(diffuseColor.rgb, pS.rgb / max(pS.a, 1e-4), pA);
          vec4 aS = texture2D(uAux, vMapUv);
          float aA = clamp(aS.a, 0.0, 1.0);`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          roughnessFactor = roughnessFactor * (1.0 - aA) + aS.r;`)
        .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
          metalnessFactor = metalnessFactor * (1.0 - aA) + aS.g;`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          totalEmissiveRadiance += texture2D(uGlow, vMapUv).rgb * uGlowK;`);
    };
    this.concrete = new THREE.MeshStandardMaterial({ color: 0x8e8a84, roughness: 0.9 });
    this.wallTex = {};
    this.wallType = 'briques';
    this.wallFrame = {
      corner: new THREE.Vector3(),
      ex: new THREE.Vector3(1, 0, 0), ey: new THREE.Vector3(0, 1, 0), n: new THREE.Vector3(0, 0, 1),
    };
    this.wallGroup = null;
    // La rue est construite une fois pour toutes (implantation fixe)
    this.street = buildStreet(Z);
    scene.add(this.street.group);
    this.traffic = new Traffic(this.street.group, this.street.lanes, this.street.length);
    this.lamp.position.copy(this.street.lampPos);
    this._build(surface);
    // Bombe tenue, viseur et nacelle
    this.can = makeCan();
    scene.add(this.can);
    this.cursor = new THREE.Group();
    this.cursor.matrixAutoUpdate = false;
    const ringW = new THREE.Mesh(new THREE.RingGeometry(0.93, 1, 64),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false }));
    const ringB = new THREE.Mesh(new THREE.RingGeometry(1, 1.07, 64),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }));
    this.cursor.add(ringW, ringB);
    this.cursor.visible = false;
    scene.add(this.cursor);

    this.lift = new THREE.Group();
    const steel = new THREE.MeshStandardMaterial({ color: 0xf2b705, roughness: 0.6, metalness: 0.3 });
    const deck = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.05, 0.9), new THREE.MeshStandardMaterial({ color: 0x55585c, roughness: 0.8 }));
    deck.position.y = -0.025;
    const rail = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.04, 0.04), steel);
    rail.position.set(0, 1.05, 0.45);
    const posts = [-0.53, 0.53].map(x => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.05, 0.04), steel); m.position.set(x, 0.52, 0.45); return m; });
    this.liftLegs = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1, 0.5), steel);
    this.liftLegs.geometry.translate(0, -0.5, 0);
    this.lift.add(deck, rail, ...posts, this.liftLegs);
    this.lift.visible = false;

    this.setNight(false);
  }

  // (Re)construit le mur, ses bombes au sol et la rue pour la taille courante.
  _build(surface) {
    const W = this.wall.width, H = this.wall.height, Z = this.wall.z;
    if (this.wallGroup) {
      this.scene.remove(this.wallGroup);
      this.wallGroup.traverse(o => { if (o.isMesh && !o.userData.keepGeometry) o.geometry.dispose(); });
    }
    const g = this.wallGroup = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(W + 0.3, H + 0.08, 0.3), this.concrete);
    body.position.set(0, (H + 0.08) / 2, Z - 0.15);
    const coping = new THREE.Mesh(new THREE.BoxGeometry(W + 0.44, 0.08, 0.42), this.concrete);
    coping.position.set(0, H + 0.12, Z - 0.15);
    this.wallMesh = new THREE.Mesh(new THREE.PlaneGeometry(W, H), this.wallMat);
    this.wallMesh.position.set(0, H / 2, Z + 0.0005);
    this.wallFrame.corner.set(-W / 2, 0, Z + 0.0005);
    g.add(body, coping, this.wallMesh);

    this.cans = new THREE.Group();
    ['#ffd21f', '#1f5fbf', '#f4f4f0', '#e0287a', '#141414', '#24a248'].forEach((hex, i) => {
      const c = makeCan();
      c.userData.body.color.set(hex);
      c.position.set(-W / 2 + 0.3 + i * 0.11 + (i > 3 ? 0.3 : 0), 0.21, Z + 0.25 + (i % 2) * 0.09);
      if (i === 5) { c.rotation.z = Math.PI / 2; c.position.y = 0.033; c.position.x += 0.1; }
      this.cans.add(c);
    });
    g.add(this.cans);

    // murets entre le mur et les immeubles quand le mur est moins large que le maximum
    const gap = this.street.edge - (W / 2 + 0.15);
    if (gap > 0.05) {
      for (const s of [-1, 1]) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(gap, 2.2, 0.25), this.concrete);
        m.position.set(s * (W / 2 + 0.15 + gap / 2), 1.1, Z - 0.2);
        g.add(m);
      }
    }
    this.lamp.target.position.set(W / 2 - 1, 0.8, Z);
    this.scene.add(g);
    this.decor = [this.street.group, this.cans];

    this.setSurface(surface);
    // les textures du mur dépendent de ses dimensions
    for (const [key, t] of Object.entries(this.wallTex)) {
      if (!key.endsWith(`:${W}x${H}`)) { t.map.dispose(); t.bump.dispose(); delete this.wallTex[key]; }
    }
    this.setWallType(this.wallType);
    this.setNight(!!this.night);
    if (this.ar) this.setAR(true);
  }

  setSurface(surface) {
    const t = surface.textures;
    this.wallUniforms.uPaint.value = t.color;
    this.wallUniforms.uAux.value = t.aux;
    this.wallUniforms.uGlow.value = t.glow;
  }

  setWallSize(surface) {
    this._build(surface);
  }

  setWallType(type) {
    this.wallType = type;
    const key = `${type}:${this.wall.width}x${this.wall.height}`;
    if (!this.wallTex[key]) {
      const t = (WALL_BUILDERS[type] || WALL_BUILDERS.briques)(this.wall.width, this.wall.height);
      const map = new THREE.CanvasTexture(t.map);
      map.colorSpace = THREE.SRGBColorSpace;
      map.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
      const bump = new THREE.CanvasTexture(t.bump);
      this.wallTex[key] = { map, bump, rough: t.rough, bumpScale: t.bumpScale, metal: t.metal || 0 };
    }
    const t = this.wallTex[key];
    this.wallMat.map = t.map;
    this.wallMat.bumpMap = t.bump;
    this.wallMat.bumpScale = t.bumpScale;
    this.wallMat.roughness = t.rough;
    this.wallMat.metalness = t.metal;
    this.wallMat.needsUpdate = true;
  }

  setNight(night) {
    this.night = night;
    const top = new THREE.Color(night ? 0x03050d : 0x5d9bd6), hor = new THREE.Color(night ? 0x141a2c : 0xdbe6ee);
    this.skyDome.setColors(top, hor, night ? 0x07080b : 0x9a958c);
    if (night) {
      this.scene.fog.color.set(0x0b0e18);
      this.hemi.color.set(0x7088c0); this.hemi.intensity = 0.07;
      this.sun.color.set(0x9fb4ff); this.sun.intensity = 0.12;
      this.lamp.intensity = 9;
      this.scene.environmentIntensity = 0.04;
      this.wallUniforms.uGlowK.value = 1.25;
    } else {
      this.scene.fog.color.set(0xdbe6ee);
      this.hemi.color.set(0xdfe9ff); this.hemi.intensity = 0.6;
      this.sun.color.set(0xfff1dc); this.sun.intensity = 2.6;
      this.lamp.intensity = 0;
      this.scene.environmentIntensity = 0.45;
      this.wallUniforms.uGlowK.value = 0.2;
    }
    this.street.setNight(night, top, hor);
    this.traffic.setNight(night);
    this.skyDome.setNight(night, this.ar);
  }

  update(dt, camera, pixelRatio) {
    this.skyDome.update(dt, camera, pixelRatio);
    this.street.update(dt);
    this.traffic.update(dt);
  }

  setAR(ar) {
    this.ar = ar;
    for (const o of this.decor) o.visible = !ar;
    this.skyDome.setNight(!!this.night, ar);
  }

  setCanPaint(paint) {
    const { body, capMat } = this.can.userData;
    body.color.set(paint.hex);
    body.metalness = paint.metal > 0.5 ? 1 : 0.2;
    body.roughness = paint.metal > 0.5 ? 0.25 : 0.35;
    body.emissive.copy(paint.glowLin).multiplyScalar(this.wallUniforms.uGlowK.value * 0.5);
    capMat.color.set(paint.kind === 'std' ? '#f4f4f0' : paint.hex);
  }

  // Viseur : ellipse de 1,5 sigma (trait visible) posée sur le mur ;
  // size = [demi-axes] impose sa taille (fil d'une lame de racloir).
  updateCursor(hit, cap, show, size = null) {
    if (!show || !hit) { this.cursor.visible = false; return; }
    const f = hit.canvas ? hit.canvas.frame : this.wallFrame;
    const sigma = size ? 0 : hit.t * Math.tan(cap.angle * Math.PI / 180) * 1.5;
    const [ka, kb] = size || [sigma * cap.sx, sigma * cap.sy];
    const A = new THREE.Vector3().addScaledVector(f.ex, hit.rx * ka).addScaledVector(f.ey, hit.ry * ka);
    const B = new THREE.Vector3().addScaledVector(f.ex, hit.ux * kb).addScaledVector(f.ey, hit.uy * kb);
    const T = f.corner.clone().addScaledVector(f.ex, hit.x).addScaledVector(f.ey, hit.y).addScaledVector(f.n, 0.003);
    this.cursor.matrix.set(
      A.x, B.x, f.n.x, T.x,
      A.y, B.y, f.n.y, T.y,
      A.z, B.z, f.n.z, T.z,
      0, 0, 0, 1);
    this.cursor.matrixWorldNeedsUpdate = true;
    this.cursor.visible = true;
  }

  updateLift(rig) {
    const h = rig.position.y;
    this.lift.visible = h > 0.02;
    this.liftLegs.scale.y = Math.max(h, 0.001);
  }
}
