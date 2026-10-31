import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { addCar, CAR_COLORS, CAR_KINDS, CAR_LENGTH } from './cars.js';

// Rue autour du mur : trottoir, chaussée, trottoir d'en face, immeubles des
// deux côtés et derrière le mur, réverbères et voitures garées.
// Tout est procédural ; les immeubles d'un même style sont fusionnés en un
// seul maillage pour limiter les appels de rendu (Quest 2).

export const STREET = {
  walk: 5,      // trottoir côté mur (m)
  road: 8,      // chaussée
  walk2: 3,     // trottoir d'en face
  curb: 0.14,   // hauteur de bordure
  length: 150,
};

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

function grain(ctx, w, h, amp, rand) {
  const img = ctx.getImageData(0, 0, w, h), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rand() - 0.5) * amp;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}

function tex(c, srgb = true, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

// ---------------------------------------------------------------------------
// Façades : tuile de 8 travées × 8 étages de 3 m (24 m × 24 m), avec une
// carte d'émission où une partie des fenêtres est allumée la nuit.

const TILE = 24, BAY = 3;

const STYLES = [
  { id: 'brique', wall: '#8a4a36', wall2: '#6f3a2b', frame: '#e8e2d6', win: [1.3, 1.7], band: null },
  { id: 'enduit', wall: '#d6c7a6', wall2: '#c4b391', frame: '#f1ece0', win: [1.1, 2.0], band: '#e4d9bf', shutters: true },
  { id: 'beton', wall: '#9a9893', wall2: '#85837f', frame: '#3b3e42', win: [2.6, 1.4], band: '#b4b1ab' },
  { id: 'crepi', wall: '#b9c2c4', wall2: '#a4aeb0', frame: '#ffffff', win: [1.4, 1.5], band: null },
];

function facadeTextures(style, seed) {
  const S = 1024, ppm = S / TILE, rand = rng(seed);
  const c = canvas(S, S), e = canvas(S, S), x = c.getContext('2d'), y = e.getContext('2d');
  x.fillStyle = style.wall; x.fillRect(0, 0, S, S);
  y.fillStyle = '#000'; y.fillRect(0, 0, S, S);
  for (let i = 0; i < 160; i++) {
    x.globalAlpha = 0.08 + rand() * 0.1;
    x.fillStyle = rand() < 0.5 ? style.wall2 : '#000';
    x.fillRect(rand() * S, rand() * S, 20 + rand() * 120, 10 + rand() * 80);
  }
  x.globalAlpha = 1;
  if (style.id === 'brique') {
    x.strokeStyle = 'rgba(220,210,195,0.25)';
    x.lineWidth = 1;
    for (let py = 0; py < S; py += 0.075 * ppm) { x.beginPath(); x.moveTo(0, py); x.lineTo(S, py); x.stroke(); }
  }
  const [ww, wh] = style.win;
  for (let fl = 0; fl < TILE / BAY; fl++) {
    const top = S - (fl + 1) * BAY * ppm;
    if (style.band) { x.fillStyle = style.band; x.fillRect(0, top + BAY * ppm - 0.25 * ppm, S, 0.25 * ppm); }
    for (let b = 0; b < TILE / BAY; b++) {
      const wx = (b * BAY + (BAY - ww) / 2) * ppm, wy = top + (BAY - wh - 0.55) * ppm, w = ww * ppm, h = wh * ppm;
      if (style.shutters) {
        x.fillStyle = ['#4d6b5a', '#6b4d3a', '#47607a'][(seed + b) % 3];
        x.fillRect(wx - w * 0.5, wy, w * 0.45, h);
        x.fillRect(wx + w * 1.05, wy, w * 0.45, h);
      }
      x.fillStyle = style.frame;
      x.fillRect(wx - 4, wy - 4, w + 8, h + 8);
      const g = x.createLinearGradient(0, wy, 0, wy + h);
      g.addColorStop(0, '#8fb0cc'); g.addColorStop(0.5, '#4a5d70'); g.addColorStop(1, '#262d36');
      x.fillStyle = g;
      x.fillRect(wx, wy, w, h);
      x.fillStyle = style.frame;
      x.fillRect(wx + w / 2 - 2, wy, 4, h);
      x.fillRect(wx - 6, wy + h + 2, w + 12, 6);
      const curtain = rand() < 0.4;
      if (curtain) { x.fillStyle = 'rgba(230,220,200,0.55)'; x.fillRect(wx + 2, wy + 2, w * (0.2 + rand() * 0.3), h - 4); }
      // la nuit : environ un tiers des fenêtres allumées
      if (rand() < 0.34) {
        const warm = rand() < 0.8;
        const lg = y.createLinearGradient(0, wy, 0, wy + h);
        lg.addColorStop(0, warm ? '#ffcf8a' : '#cfe0ff');
        lg.addColorStop(1, warm ? '#c98a40' : '#7d95c9');
        y.fillStyle = lg;
        y.globalAlpha = 0.5 + rand() * 0.5;
        y.fillRect(wx, wy, w, h);
        y.globalAlpha = 1;
        y.fillStyle = '#000';
        y.fillRect(wx + w / 2 - 2, wy, 4, h);
        if (curtain) { y.fillStyle = 'rgba(0,0,0,0.35)'; y.fillRect(wx + 2, wy + 2, w * 0.3, h - 4); }
      }
    }
  }
  grain(x, S, S, 14, rand);
  return { map: tex(c), emissive: tex(e) };
}

// Rez-de-chaussée commerçant : tuile de 24 m × 4 m
const SHOP_H = 4;

// Commerces : [enseigne, couleur du bandeau, type d'intérieur]
const SHOPS = [
  ['Boulangerie', '#6b3b1f', 'bakery'], ['Café des Arts', '#1f3b33', 'cafe'], ['Pharmacie', '#f2f4f2', 'pharmacy'],
  ['Tabac Presse', '#7a1c1c', 'shelves'], ['Pizzeria Napoli', '#20402a', 'cafe'], ['Épicerie fine', '#2c2c2c', 'shelves'],
  ['Fleuriste', '#3d5a2a', 'flowers'], ['Coiffure', '#141414', 'salon'], ['Librairie', '#24345a', 'books'],
  ['Opticien', '#e9e6df', 'shelves'], ['Le Comptoir', '#40221a', 'cafe'], ['Laverie', '#1d5e8c', 'laundry'],
];
// type de boutique -> décor intérieur dans le shader des vitrines
const SHOP_KINDS = { shelves: 0, bakery: 1, cafe: 2, pharmacy: 3, flowers: 4, salon: 5, books: 6, laundry: 7 };
const SHOP_FONT = '"Arial Narrow", "Roboto Condensed", Arial, sans-serif';

// Intérieur d'une boutique vu à travers la vitrine. lit : version éclairée (nuit).
function shopInterior(x, ix, iy, iw, ih, kind, rand, lit) {
  const k = lit ? 1 : 0.55;
  const tone = (r, g, b) => `rgb(${r * k | 0},${g * k | 0},${b * k | 0})`;
  const back = { bakery: [222, 190, 140], cafe: [150, 110, 80], pharmacy: [235, 240, 236], flowers: [210, 220, 200],
    salon: [230, 225, 220], books: [180, 150, 110], laundry: [220, 230, 236], shelves: [215, 210, 200] }[kind];
  const g = x.createLinearGradient(0, iy, 0, iy + ih);
  g.addColorStop(0, tone(...back));
  g.addColorStop(0.75, tone(back[0] * 0.8, back[1] * 0.8, back[2] * 0.8));
  g.addColorStop(1, tone(70, 60, 55));
  x.fillStyle = g;
  x.fillRect(ix, iy, iw, ih);
  // plafonniers
  x.fillStyle = lit ? '#fffbe8' : tone(240, 240, 230);
  for (let lx = ix + iw * 0.12; lx < ix + iw; lx += iw * 0.25) x.fillRect(lx, iy + 3, iw * 0.1, 4);
  const shelf = (yy, n, colors) => {
    x.fillStyle = tone(90, 70, 55);
    x.fillRect(ix, yy, iw, 3);
    for (let i = 0; i < n; i++) {
      const w = iw / n * (0.5 + rand() * 0.4), px = ix + i * iw / n + rand() * 4, hgt = 6 + rand() * 12;
      const c = colors[Math.floor(rand() * colors.length)];
      x.fillStyle = tone(...c);
      x.fillRect(px, yy - hgt, w, hgt);
    }
  };
  const vivid = [[200, 60, 50], [60, 120, 190], [230, 190, 60], [70, 150, 90], [240, 240, 235], [150, 80, 160]];
  if (kind === 'bakery') {
    for (const yy of [0.35, 0.55]) shelf(iy + ih * yy, 10, [[205, 150, 80], [180, 120, 60], [225, 180, 110]]);
    x.fillStyle = tone(240, 235, 225); x.fillRect(ix, iy + ih * 0.7, iw, ih * 0.08);         // comptoir vitré
  } else if (kind === 'cafe') {
    x.fillStyle = tone(60, 40, 30); x.fillRect(ix + iw * 0.55, iy + ih * 0.55, iw * 0.45, ih * 0.25); // bar
    for (let i = 0; i < 3; i++) {                                                            // tables et chaises
      const tx = ix + iw * (0.1 + i * 0.16);
      x.fillStyle = tone(40, 30, 25);
      x.fillRect(tx, iy + ih * 0.62, iw * 0.1, 3);
      x.fillRect(tx + iw * 0.045, iy + ih * 0.62, 3, ih * 0.25);
    }
    shelf(iy + ih * 0.35, 12, [[120, 60, 40], [200, 180, 140], [60, 90, 60], [230, 230, 220]]);
  } else if (kind === 'pharmacy' || kind === 'shelves' || kind === 'laundry') {
    for (const yy of [0.3, 0.48, 0.66, 0.84]) shelf(iy + ih * yy, kind === 'laundry' ? 0 : 14, kind === 'pharmacy' ? [[240, 240, 240], [90, 170, 120], [70, 120, 190]] : vivid);
    if (kind === 'laundry') {
      for (let i = 0; i < 4; i++) {
        const cx = ix + iw * (0.15 + i * 0.22), cy = iy + ih * 0.62;
        x.fillStyle = tone(235, 238, 240); x.fillRect(cx - ih * 0.12, cy - ih * 0.14, ih * 0.24, ih * 0.3);
        x.fillStyle = tone(70, 90, 110); x.beginPath(); x.arc(cx, cy, ih * 0.08, 0, 7); x.fill();
      }
    }
  } else if (kind === 'books') {
    for (const yy of [0.25, 0.42, 0.59, 0.76]) shelf(iy + ih * yy, 26, [[120, 40, 40], [40, 60, 110], [200, 180, 120], [60, 90, 60], [30, 30, 30]]);
  } else if (kind === 'flowers') {
    for (let i = 0; i < 40; i++) {
      x.fillStyle = tone(...[[220, 60, 90], [250, 200, 60], [240, 240, 240], [180, 90, 200], [60, 140, 60]][i % 5]);
      x.beginPath(); x.arc(ix + rand() * iw, iy + ih * (0.45 + rand() * 0.4), 3 + rand() * 6, 0, 7); x.fill();
    }
  } else if (kind === 'salon') {
    for (let i = 0; i < 3; i++) {
      const mx = ix + iw * (0.12 + i * 0.3);
      x.fillStyle = tone(200, 215, 225); x.fillRect(mx, iy + ih * 0.2, iw * 0.16, ih * 0.35);   // miroirs
      x.fillStyle = tone(30, 30, 30); x.fillRect(mx + iw * 0.03, iy + ih * 0.62, iw * 0.1, ih * 0.22); // fauteuils
    }
  }
}

// Rideau métallique baissé… et tagué, comme souvent.
function shutter(x, sx, sy, sw, sh, rand) {
  x.fillStyle = '#9a9ea3';
  x.fillRect(sx, sy, sw, sh);
  for (let k = sy; k < sy + sh; k += 7) {
    x.fillStyle = 'rgba(0,0,0,0.22)'; x.fillRect(sx, k, sw, 2);
    x.fillStyle = 'rgba(255,255,255,0.12)'; x.fillRect(sx, k + 2, sw, 1);
  }
  const cols = ['#e0287a', '#1f5fbf', '#ffd21f', '#141414', '#24a248', '#ff7a1a', '#f4f4f0'];
  for (let t = 0; t < 2 + rand() * 3; t++) {
    const c = cols[Math.floor(rand() * cols.length)];
    let px = sx + rand() * sw * 0.6, py = sy + sh * (0.3 + rand() * 0.5);
    x.lineCap = 'round'; x.lineJoin = 'round';
    for (const [lw, col] of [[9, '#111'], [5, c]]) {
      x.strokeStyle = col; x.lineWidth = lw;
      x.beginPath(); x.moveTo(px, py);
      let qx = px, qy = py;
      const r2 = rng(t * 97 + Math.floor(px));
      for (let s = 0; s < 6; s++) {
        const nx = qx + 10 + r2() * 30, ny = qy + (r2() - 0.5) * 50;
        x.quadraticCurveTo(qx + r2() * 20, qy - 30 - r2() * 20, nx, ny);
        qx = nx; qy = ny;
      }
      x.stroke();
    }
  }
}

// Rez-de-chaussée commerçant : tuile de 24 m × 4 m (haut de la tuile = 4 m).
function shopTextures(seed) {
  const W = 2048, H = Math.round(W * SHOP_H / TILE), ppm = W / TILE, rand = rng(seed);
  const c = canvas(W, H), e = canvas(W, H), x = c.getContext('2d'), y = e.getContext('2d');
  const m = v => v * ppm;
  x.fillStyle = '#c9c1b2'; x.fillRect(0, 0, W, H);          // pierre de façade
  y.fillStyle = '#000'; y.fillRect(0, 0, W, H);
  x.fillStyle = 'rgba(0,0,0,0.12)';
  for (let yy = 0; yy < H; yy += m(0.5)) x.fillRect(0, yy, W, 2);
  let px = 0, n = Math.floor(rand() * SHOPS.length);
  const segments = [];   // boutiques de la tuile, en mètres : un immeuble commence et finit sur une limite
  while (px < W - 2) {
    const sw = Math.min(W - px, m(4 + Math.floor(rand() * 3) * 2));
    const [name, band, kind] = SHOPS[n++ % SHOPS.length];
    const x0 = px + m(0.3), x1 = px + sw - m(0.3), iw = x1 - x0;
    const closed = rand() < 0.25;
    // décrit la boutique pour la vitrine en profondeur et la devanture peignable
    const seg = { x: px / ppm, w: sw / ppm, closed, kind, name };
    segments.push(seg);
    // bandeau d'enseigne
    const fy = m(0.25), fh = m(0.65);
    x.fillStyle = band; x.fillRect(x0, fy, iw, fh);
    x.fillStyle = 'rgba(255,255,255,0.08)'; x.fillRect(x0, fy, iw, 3);
    x.fillStyle = 'rgba(0,0,0,0.3)'; x.fillRect(x0, fy + fh - 3, iw, 3);
    const light = parseInt(band.slice(1), 16) > 0xb00000;
    const ink = light ? (kind === 'pharmacy' ? '#1f8a4c' : '#2a2a2a') : '#f3ead2';
    x.font = `bold ${Math.round(fh * 0.6)}px ${SHOP_FONT}`;
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillStyle = ink;
    x.fillText(name.toUpperCase(), (x0 + x1) / 2, fy + fh / 2 + 2, iw - m(0.6));
    y.font = x.font; y.textAlign = 'center'; y.textBaseline = 'middle';
    y.fillStyle = light ? '#7dffb0' : '#fff3d0';
    y.fillText(name.toUpperCase(), (x0 + x1) / 2, fy + fh / 2 + 2, iw - m(0.6));
    if (kind === 'pharmacy') {
      // croix verte lumineuse
      const cx = x1 - m(0.5), cy = fy + fh / 2, a = m(0.12), b = m(0.36);
      for (const ctx of [x, y]) { ctx.fillStyle = '#21c46a'; ctx.fillRect(cx - a, cy - b, a * 2, b * 2); ctx.fillRect(cx - b, cy - a, b * 2, a * 2); }
    }
    // vitrine
    const gy = m(1.05), gb = H - m(0.3), gh = gb - gy;
    if (closed) {
      shutter(x, x0, gy - m(0.1), iw, gh + m(0.1), rand);
    } else {
      // même tirage pour la version de jour et la version éclairée de nuit
      shopInterior(x, x0, gy, iw, gh, kind, rng(seed * 100 + n), false);
      shopInterior(y, x0, gy, iw, gh, kind, rng(seed * 100 + n), true);
      // reflets du ciel et de la rue
      const rg = x.createLinearGradient(0, gy, 0, gb);
      rg.addColorStop(0, 'rgba(190,215,235,0.45)'); rg.addColorStop(0.5, 'rgba(120,140,160,0.25)'); rg.addColorStop(1, 'rgba(40,45,50,0.35)');
      x.fillStyle = rg; x.fillRect(x0, gy, iw, gh);
      x.fillStyle = 'rgba(255,255,255,0.18)';
      for (let k = 0; k < 3; k++) {
        const sx = x0 + rand() * iw;
        x.beginPath(); x.moveTo(sx, gy); x.lineTo(sx + m(0.25), gy); x.lineTo(sx - m(0.35), gb); x.lineTo(sx - m(0.6), gb); x.fill();
      }
      // menuiseries alu, porte vitrée, soubassement
      const door = rand() < 0.5 ? x0 + m(0.15) : x1 - m(1.15);
      seg.door = (door - px) / ppm;   // position de la porte dans la boutique (m)
      for (const ctx of [x, y]) {
        ctx.fillStyle = ctx === x ? '#2d3135' : '#000';
        ctx.fillRect(x0, gy - 4, iw, 6);
        ctx.fillRect(x0, gb - 2, iw, 4);
        ctx.fillRect(x0 - 3, gy, 6, gh); ctx.fillRect(x1 - 3, gy, 6, gh);
        ctx.fillRect(door - 3, gy, 6, gh); ctx.fillRect(door + m(1) - 3, gy, 6, gh);
        for (let mx = x0 + m(2.2); mx < x1 - m(1); mx += m(2.2)) if (Math.abs(mx - door) > m(1.2)) ctx.fillRect(mx - 2, gy, 4, gh);
        ctx.fillRect(door + m(0.85), gy + gh * 0.45, 4, gh * 0.2);   // poignée
      }
      x.fillStyle = '#bfc3c7'; x.fillRect(door + m(0.85), gy + gh * 0.45, 3, gh * 0.2);
    }
    x.fillStyle = '#8f877a'; x.fillRect(x0, gb, iw, H - gb);            // soubassement
    // store banne rayé sur une partie des boutiques ouvertes
    if (!closed && rand() < 0.45) {
      const ay = fy + fh, ah = m(0.55), stripe = m(0.25);
      const awn = ['#b3242c', '#1f4f8a', '#2f6a3a', '#7a2a6a'][Math.floor(rand() * 4)];
      for (let sx = x0; sx < x1; sx += stripe * 2) {
        x.fillStyle = awn; x.fillRect(sx, ay, Math.min(stripe, x1 - sx), ah);
        x.fillStyle = '#efe9dc'; x.fillRect(sx + stripe, ay, Math.min(stripe, Math.max(0, x1 - sx - stripe)), ah);
      }
      const sg = x.createLinearGradient(0, ay, 0, ay + ah);
      sg.addColorStop(0, 'rgba(0,0,0,0)'); sg.addColorStop(1, 'rgba(0,0,0,0.35)');
      x.fillStyle = sg; x.fillRect(x0, ay, iw, ah);
      for (let sx = x0; sx < x1; sx += m(0.2)) { x.fillStyle = awn; x.beginPath(); x.arc(sx + m(0.1), ay + ah, m(0.1), 0, Math.PI); x.fill(); }
      y.fillStyle = '#000'; y.fillRect(x0, ay, iw, ah + m(0.1));
    }
    // pilastre entre deux boutiques
    x.fillStyle = '#b8af9f'; x.fillRect(px, 0, m(0.3), H); x.fillRect(px + sw - m(0.3), 0, m(0.3), H);
    px += sw;
  }
  x.textAlign = y.textAlign = 'left';
  grain(x, W, H, 10, rand);
  return { map: tex(c), emissive: tex(e), segments };
}
// Boîte dont les UV sont en mètres / tuile, pour aligner les fenêtres.
// Ordre des faces de BoxGeometry : +x, -x, +y, -y, +z, -z.
function facadeBox(w, h, d, uOff, tileH) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.getAttribute('uv');
  const faces = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    const [fw, fh] = faces[f];
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      const flat = f === 2 || f === 3;
      uv.setXY(i, (uv.getX(i) * fw + uOff) / TILE, flat ? 0.01 : uv.getY(i) * fh / tileH);
    }
  }
  return g;
}

function asphaltTex(markings) {
  // tuile de 8 m le long de la rue × largeur de chaussée
  const W = 1024, H = 1024, rand = rng(markings ? 3 : 4);
  const c = canvas(W, H), x = c.getContext('2d');
  x.fillStyle = '#38383b'; x.fillRect(0, 0, W, H);
  for (let i = 0; i < 6000; i++) {
    const v = 60 + rand() * 80 | 0;
    x.fillStyle = `rgba(${v},${v},${v},0.5)`;
    x.fillRect(rand() * W, rand() * H, 1 + rand() * 2, 1 + rand() * 2);
  }
  for (let i = 0; i < 40; i++) {
    x.globalAlpha = 0.15; x.fillStyle = rand() < 0.5 ? '#222' : '#555';
    x.beginPath(); x.ellipse(rand() * W, rand() * H, 40 + rand() * 160, 20 + rand() * 80, rand() * 3, 0, 7); x.fill();
  }
  x.globalAlpha = 1;
  if (markings) {
    const ppm = W / 8;
    x.fillStyle = 'rgba(235,235,225,0.85)';
    x.fillRect(0, H / 2 - 0.06 * ppm, 3 * ppm, 0.12 * ppm);          // ligne médiane discontinue
    x.fillRect(0, 0.25 * ppm, W, 0.1 * ppm);                          // rives
    x.fillRect(0, H - 0.35 * ppm, W, 0.1 * ppm);
  }
  grain(x, W, H, 20, rand);
  return tex(c);
}

function slabTex() {
  const s = 512, rand = rng(31), c = canvas(s, s), x = c.getContext('2d');
  x.fillStyle = '#8b8781'; x.fillRect(0, 0, s, s);
  for (let i = 0; i < 80; i++) {
    x.globalAlpha = 0.2; x.fillStyle = rand() < 0.5 ? '#6d6a65' : '#a19d96';
    x.beginPath(); x.arc(rand() * s, rand() * s, 20 + rand() * 80, 0, 7); x.fill();
  }
  x.globalAlpha = 1;
  x.strokeStyle = 'rgba(40,40,40,0.6)'; x.lineWidth = 3;
  x.strokeRect(1, 1, s - 2, s - 2);
  grain(x, s, s, 26, rand);
  return tex(c);
}

function glowTex() {
  const s = 256, c = canvas(s, s), x = c.getContext('2d');
  const g = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,214,150,0.55)');
  g.addColorStop(0.4, 'rgba(255,200,130,0.2)');
  g.addColorStop(1, 'rgba(255,200,130,0)');
  x.fillStyle = g; x.fillRect(0, 0, s, s);
  return tex(c, true, false);
}

// ---------------------------------------------------------------------------
// Fenêtres et vitrines en profondeur (« interior mapping ») : chaque vitre est
// un simple quadrilatère, le shader lance le regard dans une pièce virtuelle
// (murs, sol, plafond, meubles ou rayonnages) qui suit la parallaxe, avec le
// reflet du ciel par-dessus. La nuit, une partie des pièces est allumée.

const INTERIOR_VERT = /* glsl */`
attribute vec2 aSize;
attribute vec4 aRoom;   // graine, allumée, rideaux (ou position de la porte), boutique
attribute vec3 aFrame;  // couleur des menuiseries
varying vec2 vLocal;
varying vec2 vSize;
varying vec4 vRoom;
varying vec3 vFrame;
varying vec3 vWorld;
varying vec3 vN;
#include <fog_pars_vertex>
void main() {
  vLocal = uv * aSize;
  vSize = aSize;
  vRoom = aRoom;
  vFrame = aFrame;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const INTERIOR_FRAG = /* glsl */`
uniform float uNight;
uniform float uTime;
uniform vec3 uSkyTop;
uniform vec3 uSkyHorizon;
varying vec2 vLocal;
varying vec2 vSize;
varying vec4 vRoom;
varying vec3 vFrame;
varying vec3 vWorld;
varying vec3 vN;
#include <fog_pars_fragment>
// hachages sans sinus : stables même pour de grandes valeurs (sinon grésillement)
float hash(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash2(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
vec3 wallTone(float s) {
  float k = hash(s * 7.13);
  return k < 0.25 ? vec3(0.93, 0.9, 0.84) : k < 0.5 ? vec3(0.8, 0.85, 0.88) : k < 0.75 ? vec3(0.9, 0.82, 0.68) : vec3(0.74, 0.8, 0.7);
}
vec3 shelves(vec2 q, float seed, float density, vec3 tint, float spread) {
  float row = floor((q.y + 0.3) / 0.42);
  float plank = step(0.1, fract((q.y + 0.3) / 0.42));
  // coordonnées entières de la case : la couleur d un produit ne dépend que d elles
  vec2 cell = vec2(floor(q.x * density), row + seed);
  float item = hash2(cell);
  vec3 prod = tint + spread * (vec3(hash2(cell + vec2(17.0, 0.0)), hash2(cell + vec2(0.0, 29.0)), hash2(cell + vec2(41.0, 53.0))) - 0.5);
  vec3 c = mix(vec3(0.32, 0.26, 0.2), prod, plank * step(0.22, item));
  // de loin, les produits deviennent plus petits qu'un pixel : teinte moyenne au lieu du fourmillement
  float far = smoothstep(0.35, 1.0, fwidth(q.x * density) + fwidth(q.y / 0.42));
  return mix(c, mix(vec3(0.32, 0.26, 0.2), tint, 0.7), far);
}
// Décor des murs d une boutique selon son type
vec3 shopWall(vec2 q, float kind, float seed, vec3 wall) {
  if (q.y < 0.05 || q.y > 2.3) return wall;
  if (kind < 0.5) return shelves(q, seed, 5.0, vec3(0.6), 0.8);                                  // épicerie, tabac, opticien
  if (kind < 1.5) return q.y < 0.95 ? vec3(0.92, 0.9, 0.86) : shelves(q, seed, 7.0, vec3(0.72, 0.5, 0.28), 0.25);   // boulangerie
  if (kind < 2.5) {                                                                              // café : comptoir, bouteilles, ardoise
    if (q.y < 1.05) return vec3(0.28, 0.17, 0.1) * (0.85 + 0.15 * step(0.5, fract(q.x * 2.0)));
    if (q.y > 1.5 && q.y < 2.1 && fract(q.x / 3.0) < 0.4) return vec3(0.12, 0.14, 0.13);
    return shelves(q, seed, 12.0, vec3(0.45, 0.4, 0.3), 0.6);
  }
  if (kind < 3.5) return shelves(q, seed, 6.0, vec3(0.85, 0.9, 0.86), 0.25);                     // pharmacie
  if (kind < 4.5) {                                                                              // fleuriste
    vec2 fc = floor(q * 9.0) + seed;
    float f = hash2(fc);
    vec3 petal = vec3(0.6) + 0.8 * (vec3(hash2(fc + 13.0), hash2(fc + 29.0), hash2(fc + 47.0)) - 0.5);
    return q.y < 1.3 ? mix(vec3(0.16, 0.36, 0.14), petal, step(0.55, f)) : wall;
  }
  if (kind < 5.5) {                                                                              // coiffeur : miroirs et fauteuils
    float m = fract(q.x / 1.4);
    if (q.y > 0.9 && q.y < 1.85 && m > 0.2 && m < 0.8) return vec3(0.7, 0.76, 0.8) * (0.9 + 0.1 * q.y);
    if (q.y < 0.75 && m > 0.3 && m < 0.7) return vec3(0.1);
    return wall;
  }
  if (kind < 6.5) return shelves(q, seed, 16.0, vec3(0.45, 0.32, 0.25), 0.7);                    // librairie
  // laverie : rangée de machines à hublot
  float cx = fract(q.x / 0.7) - 0.5, cy = q.y - 0.45;
  if (q.y < 0.9) return length(vec2(cx * 0.7, cy)) < 0.2 ? vec3(0.25, 0.32, 0.4) : vec3(0.9, 0.92, 0.94);
  return wall;
}
void main() {
  vec3 n = normalize(vN);
  vec3 ex = normalize(cross(vec3(0.0, 1.0, 0.0), n));
  vec3 V = normalize(vWorld - cameraPosition);
  vec3 d = vec3(dot(V, ex), V.y, min(dot(V, n), -0.02));
  // graine entière : l interpolation des attributs ajoute de minuscules écarts que le hachage amplifierait en bruit
  float seed = floor(vRoom.x + 0.5);
  bool shop = vRoom.w > 0.5;
  float depth = shop ? 6.0 : 3.0 + hash(seed) * 1.5;
  float mx = shop ? 0.05 : max(0.1, (3.0 - vSize.x) * 0.5 + 0.1);
  float x0 = -mx, x1 = vSize.x + mx;
  float y0 = shop ? -0.3 : -0.95;
  float y1 = vSize.y + (shop ? 0.75 : 0.45);
  vec3 p = vec3(vLocal, 0.0);
  float tx = d.x > 0.0 ? (x1 - p.x) / max(d.x, 1e-4) : (x0 - p.x) / min(d.x, -1e-4);
  float ty = d.y > 0.0 ? (y1 - p.y) / max(d.y, 1e-4) : (y0 - p.y) / min(d.y, -1e-4);
  float tz = -depth / d.z;
  float t = min(tx, min(ty, tz));
  vec3 h = p + d * t;
  vec3 wall = wallTone(seed);
  vec3 col;
  float shade;
  if (t == tz) {
    // mur du fond
    col = wall;
    if (shop) {
      col = shopWall(h.xy, vRoom.w - 1.0, seed, wall);
    } else {
      float k = hash(seed * 3.7);
      if (k < 0.45 && abs(h.x - vSize.x * 0.5) < 0.42 && h.y > 0.55 && h.y < 1.15) col = vec3(0.25 + 0.6 * hash(seed * 9.0), 0.35, 0.45);
      if (k > 0.6 && h.x < x0 + 0.9 && h.y < 1.9) {
        float b = hash2(vec2(floor(h.x * 14.0), floor((h.y + 1.0) / 0.35)));
        col = mix(vec3(0.3, 0.2, 0.12), vec3(0.2 + b * 0.6, 0.25 + b * 0.3, 0.45 - b * 0.3), step(0.12, fract((h.y + 1.0) / 0.35)));
      }
      if (h.y < -0.45 && abs(h.x - vSize.x * 0.5) < 0.9 && hash(seed * 5.3) > 0.4) col = vec3(0.25 + hash(seed) * 0.35, 0.2, 0.18);
    }
    shade = 0.8;
  } else if (t == ty) {
    if (d.y < 0.0) {
      // sol : parquet ou carrelage de boutique
      col = shop ? mix(vec3(0.78), vec3(0.62), step(0.5, fract(h.x * 1.25 + step(0.5, fract(h.z * 1.25)) * 0.5)))
                 : mix(vec3(0.4, 0.27, 0.15), vec3(0.5, 0.34, 0.2), step(0.5, fract(h.x * 5.0 + hash(floor(h.z * 0.8)) )));
      shade = 0.7;
    } else {
      // plafond et plafonnier
      col = vec3(0.95);
      vec2 c = vec2(vSize.x * 0.5, -depth * 0.45);
      col += vRoom.y * 2.5 * exp(-dot(h.xz - c, h.xz - c) * (shop ? 0.35 : 5.0));
      shade = 0.95;
    }
  } else {
    col = wall * 0.85;
    if (shop) col = shopWall(vec2(h.z, h.y), vRoom.w - 1.0, seed + 3.0, wall * 0.85);
    shade = 0.75;
  }
  shade *= 1.0 - clamp(-h.z / depth, 0.0, 1.0) * 0.35;
  float lit = vRoom.y;
  vec3 lamp = hash(seed * 7.7) > 0.8 ? vec3(0.85, 0.92, 1.05) : vec3(1.05, 0.85, 0.62);
  if (lit > 0.5 && !shop && hash(seed * 11.3) > 0.88) {
    // une télé allumée : lumière bleutée qui vacille
    lamp = mix(vec3(0.35, 0.5, 1.0), vec3(0.85, 0.9, 1.0), 0.5 + 0.5 * sin(uTime * 9.0 + seed * 20.0) * sin(uTime * 2.3));
  }
  float dayL = shop ? 0.8 : 0.32;
  float nightL = lit > 0.5 ? (shop ? 1.7 : 0.95) : 0.025;
  vec3 light = mix(vec3(dayL), lamp * nightL, uNight);
  vec3 rgb = col * shade * light;
  if (!shop) {
    // voilages de chaque côté
    float c = vRoom.z * vSize.x * 0.5;
    float inC = min(1.0, step(vLocal.x, c) + step(vSize.x - c, vLocal.x));
    vec3 fabric = vec3(0.86, 0.8, 0.72) * mix(vec3(0.55), light * 1.15, 0.85);
    rgb = mix(rgb, fabric * (0.85 + 0.15 * sin(vLocal.x * 60.0)), inC * 0.85);
  }
  // reflet du ciel et de la rue sur la vitre
  vec3 R = reflect(V, n);
  vec3 sky = R.y > 0.0 ? mix(uSkyHorizon, uSkyTop, clamp(R.y * 1.6, 0.0, 1.0)) : uSkyHorizon * 0.3;
  float fres = 0.05 + 0.6 * pow(1.0 - abs(dot(V, n)), 5.0);
  rgb = mix(rgb, sky, fres * (1.0 - uNight * 0.7));
  // menuiseries
  float fw = shop ? 0.045 : 0.035;
  float frame = step(vLocal.x, fw) + step(vSize.x - fw, vLocal.x) + step(vLocal.y, fw) + step(vSize.y - fw, vLocal.y);
  if (shop) {
    frame += step(abs(vLocal.x - vRoom.z), 0.03) + step(abs(vLocal.x - vRoom.z - 1.0), 0.03);
    float m = mod(vLocal.x + 1.1, 2.2);
    frame += step(min(m, 2.2 - m), 0.02) * step(1.3, abs(vLocal.x - vRoom.z - 0.5));
  } else {
    frame += step(abs(vLocal.x - vSize.x * 0.5), fw * 0.5);
  }
  rgb = mix(rgb, vFrame * mix(0.85, 0.05, uNight), min(frame, 1.0));
  gl_FragColor = vec4(rgb, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

function interiorMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: INTERIOR_VERT,
    fragmentShader: INTERIOR_FRAG,
    fog: true,
    // la vitre n'est qu'à 6 mm de la façade : au loin, la profondeur n'a plus
    // cette finesse et l'ordre de dessin décidait du gagnant (rayures)
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uNight: { value: 0 }, uTime: { value: 0 },
      uSkyTop: { value: new THREE.Color(0x5d9bd6) }, uSkyHorizon: { value: new THREE.Color(0xdbe6ee) },
    }]),
  });
}

// Tronçons de rue : les géométries sont fusionnées par matériau ET par tronçon,
// pour que le moteur écarte ce qui est hors du champ et dessine du plus proche
// au plus loin, au lieu de tout tracer en un bloc quelle que soit la vue.
const CHUNK_X = 24, CHUNK_Z = 12;
const chunkKey = (x, z) => `${Math.floor(x / CHUNK_X)}:${Math.floor(z / CHUNK_Z)}`;

function addChunked(group, mat, list) {
  const buckets = new Map();
  for (const g of list) {
    g.computeBoundingBox();
    const b = g.boundingBox;
    const k = chunkKey((b.min.x + b.max.x) / 2, (b.min.z + b.max.z) / 2);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(g);
  }
  const meshes = [];
  for (const l of buckets.values()) {
    const m = new THREE.Mesh(mergeGeometries(l), mat);
    group.add(m);
    meshes.push(m);
  }
  return meshes;
}

// Vitres rangées par tronçon (voir addChunked)
class ChunkedGlass {
  constructor() { this.batches = new Map(); }
  add(corner, ...rest) {
    const k = chunkKey(corner.x, corner.z);
    if (!this.batches.has(k)) this.batches.set(k, new GlassBatch());
    this.batches.get(k).add(corner, ...rest);
  }
  meshes(material) { return [...this.batches.values()].map(b => b.mesh(material)); }
}

// Lot de vitres : un quadrilatère par fenêtre, tout dans un seul maillage.
class GlassBatch {
  constructor() { this.p = []; this.n = []; this.uv = []; this.size = []; this.room = []; this.frame = []; this.idx = []; }
  add(corner, ex, n, w, h, room, frame) {
    const base = this.p.length / 3;
    for (const [a, b] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
      this.p.push(corner.x + ex.x * a * w, corner.y + b * h, corner.z + ex.z * a * w);
      this.n.push(n.x, n.y, n.z);
      this.uv.push(a, b);
      this.size.push(w, h);
      this.room.push(...room);
      this.frame.push(frame.r, frame.g, frame.b);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  mesh(material) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aSize', new THREE.Float32BufferAttribute(this.size, 2));
    g.setAttribute('aRoom', new THREE.Float32BufferAttribute(this.room, 4));
    g.setAttribute('aFrame', new THREE.Float32BufferAttribute(this.frame, 3));
    g.setIndex(this.idx);
    return new THREE.Mesh(g, material);
  }
}

// Garde-corps en fer forgé (texture découpée)
function railTex() {
  const c = canvas(256, 128), x = c.getContext('2d');
  x.strokeStyle = '#1c1d1f'; x.lineWidth = 6;
  x.strokeRect(3, 3, 250, 122);
  x.lineWidth = 3;
  for (let i = 16; i < 256; i += 16) { x.beginPath(); x.moveTo(i, 6); x.lineTo(i, 122); x.stroke(); }
  for (let i = 32; i < 256; i += 64) { x.beginPath(); x.arc(i, 64, 18, 0, Math.PI * 2); x.stroke(); }
  const t = tex(c, true, false);
  return t;
}

let shared = null;
function sharedAssets() {
  if (shared) return shared;
  const facades = STYLES.map((s, i) => {
    const t = facadeTextures(s, 11 + i * 17);
    // la texture sert aussi de relief (joints, encadrements, crépi)
    return new THREE.MeshStandardMaterial({ map: t.map, bumpMap: t.map, bumpScale: 1.5, roughness: 0.85 });
  });
  const st = shopTextures(5);
  shared = {
    facades,
    shopSegments: st.segments,
    shop: new THREE.MeshStandardMaterial({ map: st.map, emissiveMap: st.emissive, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.6 }),
    interior: interiorMaterial(),
    road: (() => { const m = asphaltTex(true); return new THREE.MeshStandardMaterial({ map: m, bumpMap: m, bumpScale: 0.8, roughness: 0.95 }); })(),
    asphalt: new THREE.MeshStandardMaterial({ map: asphaltTex(false), roughness: 0.95 }),
    slab: (() => { const m = slabTex(); return new THREE.MeshStandardMaterial({ map: m, bumpMap: m, bumpScale: 1.2, roughness: 0.9 }); })(),
    curb: new THREE.MeshStandardMaterial({ color: 0x9a9790, roughness: 0.85 }),
    gravel: new THREE.MeshStandardMaterial({ color: 0x6f6a60, roughness: 1 }),
    roof: new THREE.MeshStandardMaterial({ color: 0x4a4744, roughness: 0.9 }),
    stone: new THREE.MeshStandardMaterial({ color: 0xd8d2c4, roughness: 0.8 }),
    rail: new THREE.MeshStandardMaterial({ map: railTex(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.6 }),
    pole: new THREE.MeshStandardMaterial({ color: 0x2d3033, roughness: 0.5, metalness: 0.8 }),
    lampHead: new THREE.MeshStandardMaterial({ color: 0x2a2a2a, emissive: 0xffd9a0, emissiveIntensity: 0 }),
    pool: new THREE.MeshBasicMaterial({ map: glowTex(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
    zebra: new THREE.MeshStandardMaterial({ color: 0xe6e6dc, roughness: 0.8 }),
    trunk: new THREE.MeshStandardMaterial({ color: 0x4a3a2c, roughness: 0.95 }),
    foliage: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true }),
    grate: new THREE.MeshStandardMaterial({ color: 0x2a2b2c, roughness: 0.7, metalness: 0.5 }),
    wood: new THREE.MeshStandardMaterial({ color: 0x7a5a3a, roughness: 0.8 }),
    bin: new THREE.MeshStandardMaterial({ color: 0x2f5a3a, roughness: 0.6, metalness: 0.2 }),
  };
  return shared;
}

// Arbre d'alignement : tronc + houppier fait de quelques boules facettées.
function tree(x, z, rand, trunks, leaves, grates) {
  const h = 2.4 + rand() * 0.8;
  const tr = new THREE.CylinderGeometry(0.11, 0.16, h, 7);
  tr.translate(x, h / 2, z);
  trunks.push(tr);
  const green = new THREE.Color().setHSL(0.24 + rand() * 0.08, 0.45, 0.22 + rand() * 0.08);
  for (let k = 0; k < 4; k++) {
    const r = 1.0 + rand() * 0.7;
    const b = new THREE.IcosahedronGeometry(r, 1);
    const p = b.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const s = 0.85 + 0.3 * Math.abs(Math.sin(p.getX(i) * 3.1 + p.getY(i) * 2.3 + p.getZ(i) * 1.7 + k));
      p.setXYZ(i, p.getX(i) * s, p.getY(i) * s * 0.85, p.getZ(i) * s);
    }
    b.deleteAttribute('uv');
    const col = green.clone().offsetHSL(0, 0, (rand() - 0.5) * 0.06);
    b.setAttribute('color', new THREE.Float32BufferAttribute(new Array(p.count).fill(0).flatMap(() => [col.r, col.g, col.b]), 3));
    b.translate(x + (rand() - 0.5) * 1.6, h + 0.8 + rand() * 1.4, z + (rand() - 0.5) * 1.2);
    leaves.push(b);
  }
  const g = new THREE.BoxGeometry(1.2, 0.02, 1.2);
  g.translate(x, 0.01, z);
  grates.push(g);
}

export const WALL_MAX = 16;

// Rue autour du mur. Son implantation ne dépend pas de la taille du mur
// (prévue pour le plus grand, WALL_MAX) : les devantures peintes retrouvent
// toujours leur place. Z : plan de façade du mur.
export function buildStreet(Z) {
  const A = sharedAssets();
  const S = STREET, L = S.length;
  const group = new THREE.Group();
  const rand = rng(1234);
  const zRoad = Z + S.walk, zWalk2 = zRoad + S.road, zFar = zWalk2 + S.walk2;
  const edge = WALL_MAX / 2 + 0.8;

  // Sol : chaussée en contrebas, trottoirs en dalles, terrain vague derrière le mur
  const road = new THREE.Mesh(new THREE.PlaneGeometry(L, S.road), A.road);
  road.material.map.repeat.set(L / 8, 1);
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, -S.curb, zRoad + S.road / 2);
  const far = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), A.asphalt);
  A.asphalt.map.repeat.set(75, 75);
  far.rotation.x = -Math.PI / 2;
  far.position.y = -S.curb - 0.01;
  const walkMats = [A.curb, A.curb, A.slab, A.curb, A.curb, A.curb];
  for (const [z0, z1] of [[Z - 0.3, zRoad], [zWalk2, zFar]]) {
    const g = new THREE.BoxGeometry(L, S.curb, z1 - z0);
    const uv = g.getAttribute('uv');
    for (let i = 8; i < 12; i++) uv.setXY(i, uv.getX(i) * L / 1.5, uv.getY(i) * (z1 - z0) / 1.5);
    const walk = new THREE.Mesh(g, walkMats);
    walk.position.set(0, -S.curb / 2, (z0 + z1) / 2);
    group.add(walk);
  }
  const lot = new THREE.Mesh(new THREE.PlaneGeometry(edge * 2, 15), A.gravel);
  lot.rotation.x = -Math.PI / 2;
  lot.position.set(0, -0.02, Z - 0.3 - 7.5);
  group.add(road, far, lot);

  // Passage piéton
  const zebra = [];
  const zx = edge + 9;
  for (let k = 0; k < 7; k++) {
    const g = new THREE.BoxGeometry(3, 0.01, 0.5);
    g.translate(zx, -S.curb + 0.006, zRoad + 0.6 + k * 1.05);
    zebra.push(g);
  }
  group.add(new THREE.Mesh(mergeGeometries(zebra), A.zebra));

  // Immeubles
  const byMat = new Map();
  const add = (mat, g) => { if (!byMat.has(mat)) byMat.set(mat, []); byMat.get(mat).push(g); };
  const glass = new ChunkedGlass();
  const canvases = [];
  const segs = A.shopSegments;
  const UP = new THREE.Vector3(0, 1, 0);
  let lastSeg = -1;
  // Largeur d'un immeuble : un nombre entier de boutiques de la tuile, à partir de l'une d'elles.
  function frontage(maxW) {
    let k0 = Math.floor(rand() * segs.length);
    // ne pas recommencer par la boutique qui termine l'immeuble voisin
    if (k0 === lastSeg) k0 = (k0 + 1) % segs.length;
    let w = 0, k = k0;
    const list = [];
    while (w < 7 && w + segs[k % segs.length].w <= Math.max(maxW, segs[k % segs.length].w)) { list.push(k % segs.length); w += segs[k % segs.length].w; k++; }
    lastSeg = (k - 1) % segs.length;
    return { w: w || maxW, uShop: segs[k0].x, list };
  }
  function building(x0, x1, zFront, facing, minFl, maxFl, f, rowId, bi) {
    const w = x1 - x0, depth = 12, floors = minFl + Math.floor(rand() * (maxFl - minFl + 1));
    const h = SHOP_H + floors * BAY;
    const si = Math.floor(rand() * A.facades.length), style = STYLES[si], mat = A.facades[si];
    const uOff = Math.floor(rand() * 8) * BAY;
    const cz = zFront - facing * depth / 2;
    const up = facadeBox(w, h - SHOP_H, depth, uOff, TILE);
    up.translate((x0 + x1) / 2, SHOP_H + (h - SHOP_H) / 2, cz);
    add(mat, up);
    const shop = facadeBox(w, SHOP_H, depth + 0.1, f.uShop, SHOP_H);
    shop.translate((x0 + x1) / 2, SHOP_H / 2, cz);
    add(A.shop, shop);
    const roof = new THREE.BoxGeometry(w + 0.3, 0.4, depth + 0.3);
    roof.translate((x0 + x1) / 2, h + 0.2, cz);
    add(A.roof, roof);
    // corniche du toit et bandeau au-dessus des boutiques
    const cor = new THREE.BoxGeometry(w + 0.3, 0.3, 0.4);
    cor.translate((x0 + x1) / 2, h - 0.15, zFront + facing * 0.15);
    add(A.stone, cor);
    const band = new THREE.BoxGeometry(w, 0.18, 0.22);
    band.translate((x0 + x1) / 2, SHOP_H + 0.09, zFront + facing * 0.11);
    add(A.stone, band);

    const ex = new THREE.Vector3(facing, 0, 0), n = new THREE.Vector3(0, 0, facing);
    const left = new THREE.Vector3(facing > 0 ? x0 : x1, 0, zFront);
    const frameCol = new THREE.Color(style.frame);
    const [ww, wh] = style.win;
    // fenêtres alignées sur celles de la texture de façade
    for (let fl = 0; fl < floors; fl++) {
      for (let s = Math.ceil((uOff - (BAY - ww) / 2) / BAY) * BAY + (BAY - ww) / 2; s + ww <= uOff + w - 0.15; s += BAY) {
        if (s < uOff + 0.15) continue;
        const along = s - uOff, y = SHOP_H + fl * BAY + 0.55;
        const corner = left.clone().addScaledVector(ex, along).add(new THREE.Vector3(0, y, facing * 0.006));
        const seed = Math.floor(rand() * 1000);   // entier : voir le shader
        glass.add(corner, ex, n, ww, wh, [seed, rand() < 0.38 ? 1 : 0, rand() < 0.55 ? 0.25 + rand() * 0.35 : 0, 0], frameCol);
        const sill = new THREE.BoxGeometry(ww + 0.18, 0.06, 0.16);
        sill.translate(corner.x + ex.x * ww / 2, y - 0.03, zFront + facing * 0.08);
        add(A.stone, sill);
        if (style.shutters) {
          const rail = new THREE.PlaneGeometry(ww + 0.1, 0.9);
          if (facing < 0) rail.rotateY(Math.PI);
          rail.translate(corner.x + ex.x * ww / 2, y + 0.45, zFront + facing * 0.12);
          add(A.rail, rail);
        }
      }
    }
    // boutiques : vitrine en profondeur et devanture peignable
    let along = 0;
    f.list.forEach((k, j) => {
      const seg = segs[k];
      const sw = Math.min(seg.w, w - along);
      if (sw <= 0.5) return;
      if (!seg.closed && sw > 1.5) {
        const corner = left.clone().addScaledVector(ex, along + 0.3).add(new THREE.Vector3(0, 0.3, facing * 0.056));
        glass.add(corner, ex, n, sw - 0.6, 2.65, [Math.floor(rand() * 1000), rand() < 0.85 ? 1 : 0, (seg.door ?? 0.15) - 0.3, 1 + (SHOP_KINDS[seg.kind] ?? 0)], new THREE.Color(0x2d3135));
      }
      canvases.push({
        id: `${rowId}-${bi}-${j}`,
        frame: {
          corner: left.clone().addScaledVector(ex, along).add(new THREE.Vector3(0, 0, facing * 0.058)),
          ex: ex.clone(), ey: UP.clone(), n: n.clone(),
        },
        width: sw, height: SHOP_H,
      });
      along += sw;
    });
  }
  function row(xa, xb, zFront, facing, minFl, maxFl, rowId) {
    let x = xa, bi = 0;
    while (x < xb - 2) {
      const f = frontage(xb - x);
      const w = Math.min(xb - x, f.w);
      building(x, x + w, zFront, facing, minFl, maxFl, f, rowId, bi++);
      x += w;
    }
  }
  row(-L / 2, -edge, Z - 0.25, 1, 2, 5, 'g');
  row(edge, L / 2, Z - 0.25, 1, 2, 5, 'd');
  row(-L / 2, L / 2, zFar, -1, 2, 6, 'f');
  row(-edge - 10, edge + 10, Z - 0.3 - 15, 1, 3, 7, 'b');
  for (const [mat, list] of byMat) addChunked(group, mat, list);
  group.add(...glass.meshes(A.interior));

  // Réverbères des deux trottoirs, un tous les 20 m, l'un d'eux près du mur
  const poles = [], heads = [], pools = [];
  const lampAt = (x, z, dir) => {
    const mast = new THREE.CylinderGeometry(0.06, 0.08, 5.5, 8);
    mast.translate(x, 2.75, z);
    const arm = new THREE.BoxGeometry(0.06, 0.06, 1.3);
    arm.translate(x, 5.45, z + dir * 0.6);
    poles.push(mast, arm);
    const head = new THREE.BoxGeometry(0.28, 0.1, 0.5);
    head.translate(x, 5.38, z + dir * 1.15);
    heads.push(head);
    const pool = new THREE.PlaneGeometry(7, 7);
    pool.rotateX(-Math.PI / 2);
    pool.translate(x, 0.015, z + dir * 0.6);
    pools.push(pool);
  };
  const near = edge + 1.5;
  for (let x = near - 100; x <= L / 2; x += 20) if (x > -L / 2) lampAt(x, zRoad - 0.4, 1);
  for (let x = near - 110; x <= L / 2; x += 20) if (x > -L / 2) lampAt(x, zWalk2 + 0.4, -1);
  addChunked(group, A.pole, poles);
  addChunked(group, A.lampHead, heads);
  const poolMesh = new THREE.Mesh(mergeGeometries(pools), A.pool);
  poolMesh.renderOrder = 1;
  group.add(poolMesh);

  // Arbres d'alignement, bancs et poubelles
  const trunks = [], leaves = [], grates = [], benches = [], bins = [];
  for (let x = near - 100; x < L / 2 - 5; x += 10) {
    if (Math.abs(x - zx) < 4) continue;
    tree(x, zWalk2 + 1.3, rand, trunks, leaves, grates);
    if (Math.abs(x) > edge + 4) tree(x + 5, zRoad - 1.0, rand, trunks, leaves, grates);
    if (rand() < 0.4) {
      const seat = new THREE.BoxGeometry(1.8, 0.06, 0.45);
      seat.translate(x + 2.5, 0.45, zWalk2 + 2.2);
      const back = new THREE.BoxGeometry(1.8, 0.4, 0.05);
      back.translate(x + 2.5, 0.75, zWalk2 + 2.42);
      benches.push(seat, back);
    }
    if (rand() < 0.5 && Math.abs(x - 1.5) > edge + 3) {
      const b = new THREE.CylinderGeometry(0.25, 0.22, 0.85, 12);
      b.translate(x - 1.5, 0.43, zRoad - 0.35);
      bins.push(b);
    }
  }
  addChunked(group, A.trunk, trunks);
  addChunked(group, A.foliage, leaves);
  addChunked(group, A.grate, grates);
  addChunked(group, A.wood, benches);
  addChunked(group, A.bin, bins);

  // Voitures garées le long des deux trottoirs (créneau), sauf devant le mur
  const carGeo = new Map();
  const addGeo = (mat, g) => { if (!carGeo.has(mat)) carGeo.set(mat, []); carGeo.get(mat).push(g); };
  const ownMats = CAR_COLORS.map(col => new THREE.MeshStandardMaterial({ color: col, roughness: 0.28, metalness: 0.55 }));
  const park = (zCurb, heading, skip) => {
    for (let x = -L / 2 + 6; x < L / 2 - 6;) {
      const kind = CAR_KINDS[Math.floor(rand() * CAR_KINDS.length)], len = CAR_LENGTH(kind);
      const cx = x + len / 2;
      if (rand() < 0.22 || skip(cx, len) || Math.abs(cx - zx) < 3.5 + len / 2) { x += len + 1.5; continue; }
      addCar(addGeo, ownMats[Math.floor(rand() * ownMats.length)], kind, cx, -S.curb, zCurb, heading);
      x += len + 0.8 + rand() * 1.5;
    }
  };
  park(zWalk2 - 1.15, Math.PI, () => false);
  park(zRoad + 1.15, 0, (cx, len) => Math.abs(cx) < edge + 3 + len / 2);
  for (const [mat, list] of carGeo) addChunked(group, mat, list);

  return {
    group,
    canvases,
    edge,
    pools: poolMesh,
    lanes: [
      { z: zRoad + 3.15, heading: Math.PI, y: -S.curb },
      { z: zRoad + 4.85, heading: 0, y: -S.curb },
    ],
    length: L,
    lampPos: new THREE.Vector3(near, 5.38, zRoad - 0.4 + 1.15),
    setNight(night, skyTop, skyHorizon) {
      A.shop.emissiveIntensity = night ? 1.3 : 0;
      A.lampHead.emissiveIntensity = night ? 4 : 0;
      A.interior.uniforms.uNight.value = night ? 1 : 0;
      A.interior.uniforms.uSkyTop.value.copy(skyTop);
      A.interior.uniforms.uSkyHorizon.value.copy(skyHorizon);
      poolMesh.visible = night;
    },
    update(dt) {
      A.interior.uniforms.uTime.value += dt;
    },
    dispose() {
      group.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
      for (const m of ownMats) m.dispose();
    },
  };
}