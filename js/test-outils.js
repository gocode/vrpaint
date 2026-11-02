import * as THREE from 'three';
import { NEWSPAPER } from './newspaper.js';
import { sizedTool } from './state.js';

// ?test=outils : papier journal et pinceaux, gestes rejoués image par image.
//   - fond bleu sec, rouge par-dessus ; le papier journal emporte du rouge et ne montre que du bleu,
//     jamais le mur ; motif net (facettes), différent à chaque appui, plus large en appuyant,
//     plus marqué sur la peinture fraîche et quand on reste appuyé ; plus grand avec une grosse boule ;
//     frotter laisse une bande ;
//   - chalumeau : la peinture chauffée ne part presque plus au papier ; les coulures qui passent sous la flamme s'arrêtent ;
//   - pinceaux : couleur courante, charge qui s'épuise le long du trait, traînées de poils,
//     tranche du pinceau plat qui suit le poignet, tailles ; charge réaliste décochée : le trait reste plein ;
//   - éponge : grain poreux à la couleur courante, différent à chaque appui, plus large en appuyant et avec
//     une grande éponge, qui pâlit d'un appui à l'autre (sauf charge réaliste décochée), stries en frottant ;
//   - chalumeau : une grande flamme sèche une zone plus large ;
//   - annuler rend les couches d'avant au bit près ; enregistrer puis rouvrir rend le même mur ;
//   - au bord d'un voile de bombe, le fond ne saute pas (le papier n'y dessine pas le contour des tampons) ;
//   - sous un voile frais, une couche séchée au chalumeau reste : le papier ne remonte pas jusqu'au mur.
// Résultats : lignes « VRPAINT_OUTILS_<nom> OK|ECHEC … » ; images : window.__vrpaintShots.
export function runOutilsTest({ set, state, PAINTS, world, WALL, readWall, history }) {
  // froissage du papier, graine et rotation de l'éponge : tirages à graine fixe, les mêmes à chaque exécution
  // (Math.random est partagé avec le décor, qui en consomme selon le rythme des images : un contrôle limite
  // passait ou échouait selon le tirage)
  const seeded = seed => () => {
    seed = seed + 0x6d2b79f5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
  const v = () => window.__vrpaint;
  const paint = name => PAINTS.find(p => p.name === name);
  const f = world.wallFrame;
  const ox = (WALL.width - 6) / 2;   // repère du test : 6 m centrés sur le mur
  const keep = { wall: state.wall, drips: state.drips, pressure: state.pressure, angle: state.angle, brushSizes: state.brushSizes, realLoad: state.realLoad };
  const shots = window.__vrpaintShots = [];
  const K = 500;                     // pixels par mètre des images analysées (2 mm)
  const report = (name, ok, info) => console.log(`VRPAINT_OUTILS_${name} ${ok ? 'OK' : 'ECHEC'} ${info}`);

  // image d'une zone [x0, y0, x1, y1] (m, repère du test) ; ligne 0 en haut
  const zone = (x0, y0, x1, y1, k = K) => {
    const w = Math.round((x1 - x0) * k), h = Math.round((y1 - y0) * k);
    return { x0, y0, x1, y1, k, w, h, px: readWall(w, h, [x0 + ox, y0, x1 + ox, y1]) };
  };
  const save = (name, z) => {
    const c = document.createElement('canvas');
    c.width = z.w; c.height = z.h;
    c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(z.px), z.w, z.h), 0, 0);
    shots.push({ name, url: c.toDataURL('image/png') });
  };
  // pixels du disque (cx, cy, R) d'une zone : indices
  const disk = (z, cx, cy, R) => {
    const out = [];
    for (let j = 0; j < z.h; j++) for (let i = 0; i < z.w; i++) {
      const x = z.x0 + (i + 0.5) / z.k, y = z.y1 - (j + 0.5) / z.k;
      if ((x - cx) ** 2 + (y - cy) ** 2 < R * R) out.push({ i, j, o: (j * z.w + i) * 4, dx: Math.round((x - cx) * z.k), dy: Math.round((y - cy) * z.k) });
    }
    return out;
  };

  let before = null, recs = 0;
  const R = NEWSPAPER.size / 2;
  const BIG = 0.22;
  // Appuis du papier (m, repère du test ; rayon s'il n'est pas R) et bande frottée ; chacune est photographiée
  // à 1 mm par pixel sur le bleu sec, sur le rouge, puis après le papier
  const D = { frais0: [3.3, 2.3], frais1: [3.7, 2.3], sec0: [0.9, 2.0], sec1: [0.9, 1.0], leger: [1.7, 2.0], fort: [1.7, 1.0], repasse: [2.3, 2.2],
    court: [1.3, 1.0], long: [2.3, 1.0], grand: [3.5, 1.8, BIG / 2] };
  const rad = n => D[n]?.[2] || R;
  const RUB = [0.6, 2.4, 1.5];
  const areas = () => {
    const out = {};
    for (const [n, [x, y, r = R]] of Object.entries(D)) out[n] = zone(x - r, y - r, x + r, y + r, 1000);
    out.frotte = zone(RUB[0], RUB[2] - R, RUB[1], RUB[2] + R, 1000);
    return out;
  };
  let blue = null, red = null;
  // part de rouge emportée (0..1) le long du segment rouge → bleu, et écart à ce segment (le mur s'en écarte)
  const lift = (n, after, o) => {
    let dot = 0, n2 = 0, off = 0;
    const rp = red[n].px, bp = blue[n].px, ap = after[n].px;
    for (let c = 0; c < 3; c++) {
      const r = rp[o + c], b = bp[o + c], a = ap[o + c];
      dot += (r - a) * (r - b); n2 += (r - b) ** 2;
    }
    const L = n2 > 300 ? Math.min(1, Math.max(0, dot / n2)) : 0;
    for (let c = 0; c < 3; c++) {
      const r = rp[o + c], b = bp[o + c], a = ap[o + c];
      off = Math.max(off, Math.abs(a - (r + (b - r) * L)));
    }
    return { L, off };
  };
  const dabStats = (after, n, cx = D[n][0], cy = D[n][1]) => {
    const px = disk(after[n], cx, cy, rad(n));
    const Ls = px.map(p => lift(n, after, p.o));
    const sorted = Ls.map(l => l.L).sort((a, b) => a - b), top = sorted[Math.floor(sorted.length * 0.98)] || 0;
    const touched = Ls.filter(l => l.L > 0.15 * top).length;
    const mid = Ls.filter(l => l.L > 0.15 * top && l.L < 0.5 * top).length;
    return {
      px, Ls, top,
      area: touched / px.length,
      mean: Ls.reduce((s, l) => s + l.L, 0) / px.length,
      edge: touched ? mid / touched : 1,
      odd: Ls.filter(l => l.off > 45).length / px.length,
      map: new Map(px.map((p, k) => [p.dx + ',' + p.dy, Ls[k].L])),
    };
  };
  // Netteté, sur les texels bruts de la couche couleur (une image du mur est filtrée) : part
  // emportée de l'écart visible − fond, texel par texel ; largeur moyenne de la transition entre
  // « touché » et « pas touché » = texels intermédiaires / texels du pourtour (1 texel : bord net)
  const edgeWidth = (after, n) => {
    const S = v().surface, [W] = S.res, B = new Map(before);
    const c0 = B.get(S.uid + ':color'), f = B.get(S.uid + ':fondColor'), h = THREE.DataUtils.fromHalfFloat;
    const [cx, cy] = D[n], tx = Math.round((cx + ox) / S.width * W), ty = Math.round(cy / S.height * S.res[1]);
    const r = Math.floor(R / S.width * W), side = 2 * r + 1, L = new Float32Array(side * side).fill(NaN);
    for (let j = 0; j < side; j++) for (let i = 0; i < side; i++) {
      if ((i - r) ** 2 + (j - r) ** 2 > r * r) continue;
      const o = ((ty - r + j) * W + tx - r + i) * 4;
      let dot = 0, n2 = 0;
      for (let c = 0; c < 4; c++) { const a = h(c0[o + c]), b = h(f[o + c]), z = h(after[o + c]); dot += (a - z) * (a - b); n2 += (a - b) ** 2; }
      if (n2 > 1e-4) L[j * side + i] = dot / n2;
    }
    const top = [...L].filter(x => x === x).sort((a, b) => a - b).at(-Math.ceil(side * side * 0.02)) || 0;
    const on = k => L[k] > 0.15 * top;
    let mid = 0, rim = 0;
    for (let j = 1; j < side - 1; j++) for (let i = 1; i < side - 1; i++) {
      const k = j * side + i;
      if (!on(k)) continue;
      if (L[k] < 0.5 * top) mid++;
      if (!on(k - 1) || !on(k + 1) || !on(k - side) || !on(k + side)) rim++;
    }
    return rim ? mid / rim : 9;
  };
  const corr = (a, b) => {
    const keys = [...a.map.keys()].filter(k => b.map.has(k));
    const xs = keys.map(k => a.map.get(k)), ys = keys.map(k => b.map.get(k));
    const mx = xs.reduce((s, x) => s + x, 0) / xs.length, my = ys.reduce((s, y) => s + y, 0) / ys.length;
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < xs.length; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
    return sxy / Math.sqrt(sxx * syy + 1e-9);
  };
  // pinceau : écart au mur nu, par pixel (0..255)
  const ink = (z, base, o) => Math.max(...[0, 1, 2].map(c => Math.abs(z.px[o + c] - base.px[o + c])));
  // bande d'un trait horizontal (x0..x1, à ±5 cm de yc), comparée au mur nu pris avant
  const BANDS = { long: [4.5, 6.8, 2.6], across: [4.6, 5.4, 2.2], along: [4.6, 5.4, 1.9], small: [4.6, 5.4, 1.5], big: [4.6, 5.4, 1.2] };
  const bare = {};
  const bandZone = ([x0, x1, yc]) => zone(x0, yc - 0.05, x1, yc + 0.05, 1000);
  const band = key => {
    const z = bandZone(BANDS[key]), base = bare[key];
    return { z, base, d: (i, j) => ink(z, base, (j * z.w + i) * 4) };
  };
  const rows = (b, i0, i1) => {
    const prof = [];
    for (let j = 0; j < b.z.h; j++) { let s = 0; for (let i = i0; i < i1; i++) s += b.d(i, j); prof.push(s / (i1 - i0)); }
    return prof;
  };
  const height = (b, i0, i1, thr = 40) => rows(b, i0, i1).filter(x => x > thr).length / b.z.k;

  const raw = () => {
    const out = [];
    const surfaces = [v().surface, ...v().canvases.painted().map(c => c.surface)];
    for (const s of surfaces) for (const k of Object.keys(s.targets)) out.push([s.uid + ':' + k, s.readRaw(k)]);
    return out;
  };
  const sameRaw = (a, b) => {
    const B = new Map(b);
    let n = 0;
    for (const [k, x] of a) {
      const y = B.get(k);
      if (!y || y.length !== x.length) return -1;
      for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) n++;
    }
    return n;
  };

  const spray = (name, cap, d, dur, path) => ({ kind: 'spray', paint: name, cap, d, dur, path });
  const dab = (x, y, p, dur = 0.25, size) => ({ kind: 'tool', tool: 'journal', p, dur, size, path: () => [x, y] });
  // écart moyen (0..1) entre deux images d'un même disque
  const change = (a, b, cx, cy, r) => {
    const px = disk(a, cx, cy, r);
    return px.reduce((s, p) => s + Math.max(...[0, 1, 2].map(c => Math.abs(a.px[p.o + c] - b.px[p.o + c]))), 0) / px.length / 255;
  };
  // pixels peints (écart au mur nu > 40) d'une zone
  const inked = (z, base) => { let n = 0; for (let o = 0; o < z.px.length; o += 4) if (ink(z, base, o) > 40) n++; return n; };
  // tache rouge fraîche : deux points passent sous la flamme (chaud, et local pour la grosse boule), froid non
  const T = { chaud: [6.0, 0.6], froid: [4.9, 0.6], local: [5.45, 0.6] };
  const DRIP = { flamme: [6.8, 1.25], libre: [6.4, 1.25] };   // deux taches qui coulent ; la flamme attend sous la première
  const dripBand = x => zone(x - 0.04, 0.8, x + 0.04, 1.0, 1000);   // sous la zone chauffée (1,02 à 1,16 m)
  let torchBefore = null, dripBare = null;
  const stroke = (tool, size, name, p, angle, dur, path) => ({ kind: 'tool', tool, size, paint: name, p, angle, dur, path });
  const wait = dur => ({ kind: 'wait', dur });
  const SEC = [1.0, 0.2], secBox = [SEC[0] - 0.06, SEC[1] - 0.06, SEC[0] + 0.06, SEC[1] + 0.06], sec = {};
  // flamme moyenne et grande flamme sur une tache fraîche (bande libre à gauche du test)
  const FL = { petite: [-0.7, 0.5], grande: [-0.25, 0.5] };
  // éponge (Ø 8 cm sauf indication), dans la bande libre de gauche : appuis isolés, deux séries de six appuis
  // (charge réaliste ou non), une bande frottée ; trait de pinceau sans épuisement
  const SP = { a: [-0.75, 2.7], b: [-0.45, 2.7], leger: [-0.75, 2.4], fort: [-0.45, 2.4], petite: [-0.8, 2.1, 0.04], grande: [-0.4, 2.05, 0.16] };
  for (let k = 0; k < 6; k++) { SP['r' + k] = [-0.85 + k * 0.15, 1.75]; SP['n' + k] = [-0.85 + k * 0.15, 1.5]; }
  const SP_RUB = [-0.85, -0.05, 1.25], SP_BR = [-0.9, 0.0, 1.0];
  const spR = n => (SP[n][2] || 0.08) / 2 * 1.15;
  const spZones = () => {
    const out = {};
    for (const n in SP) { const [x, y] = SP[n], r = spR(n); out[n] = zone(x - r, y - r, x + r, y + r, 1000); }
    out.rub = zone(SP_RUB[0], SP_RUB[2] - 0.06, SP_RUB[1], SP_RUB[2] + 0.06, 1000);
    out.br = zone(SP_BR[0], SP_BR[2] - 0.05, SP_BR[1], SP_BR[2] + 0.05, 1000);
    return out;
  };
  let spBare = null;
  // empreinte d'un appui d'éponge : encre par pixel (0..1) dans le disque, trous au centre (½ rayon),
  // passages encre / trou le long des lignes du centre (par mètre)
  const spStats = (after, n) => {
    const z = after[n], base = spBare[n], [cx, cy] = SP[n], R = (SP[n][2] || 0.08) / 2;
    const px = disk(z, cx, cy, R * 1.15), map = new Map();
    let area = 0, sum = 0, mid = 0, holes = 0;
    const rgb = [0, 0, 0];
    for (const p of px) {
      const d = ink(z, base, p.o) / 255;
      map.set(p.dx + ',' + p.dy, d);
      sum += d;
      if (d > 0.25) { area++; for (let c = 0; c < 3; c++) rgb[c] += z.px[p.o + c]; }
      if (Math.hypot(p.dx, p.dy) / z.k < R * 0.5) { mid++; if (d < 0.1) holes++; }
    }
    let flips = 0, len = 0;
    for (let j = 0; j < z.h; j++) {
      const y = z.y1 - (j + 0.5) / z.k;
      if (Math.abs(y - cy) > R * 0.4) continue;
      let last = null;
      for (let i = 0; i < z.w; i++) {
        const x = z.x0 + (i + 0.5) / z.k;
        if (Math.abs(x - cx) > R * 0.4) continue;
        const on = ink(z, base, (j * z.w + i) * 4) > 64;
        if (last !== null && on !== last) flips++;
        last = on; len++;
      }
    }
    return { area, mean: sum / px.length, holes: holes / Math.max(1, mid), flips: flips / Math.max(1, len) * z.k, map,
      rgb: rgb.map(x => x / Math.max(1, area)) };
  };
  // humidité de la peinture (carte de fraîcheur du papier) au point (x, y) du test
  const wetAt = (x, y) => {
    const fr = v().newspaper.fresh, src = fr.source(v().wallCanvas), g = fr._grid(v().wallCanvas);
    const t = g.t[Math.floor(y / src.cell) * g.gw + Math.floor((x + ox) / src.cell)];
    return Math.exp(Math.min(0, t - src.now) / 20);
  };
  const steps = [
    { kind: 'do', fn: () => { set({ drips: false, wall: 'blanc' }); v().newspaper.random = seeded(20261102); v().sponge.random = seeded(1789); } },
    // mur nu de la zone des pinceaux, pour mesurer la peinture posée
    { kind: 'do', fn: () => { for (const k in BANDS) bare[k] = bandZone(BANDS[k]); } },
    // couches : bleu sec partout, rouge « récent » en A, rouge frais en C
    spray('Bleu ciel', 'superfat', 0.22, 45, t => [0.4 + 3.8 * tri(t * 30), 0.5 + 2.0 * t]),
    wait(30),
    { kind: 'do', fn: () => { blue = areas(); } },
    spray('Rouge', 'superfat', 0.2, 30, t => [0.45 + 2.1 * tri(t * 30), 0.5 + 2.0 * t]),
    wait(40),
    // rouge frais : il finit en haut, là où se posent les appuis « frais »
    spray('Rouge', 'superfat', 0.2, 10, t => [3.0 + 1.0 * tri(t * 16), 1.55 + 0.9 * t]),
    { kind: 'do', fn: () => {
      red = areas();
      save('1-rouge-sur-bleu', zone(0.4, 0.7, 4.2, 2.4));
      before = raw();
      recs = history.count;
    } },
    ...['frais0', 'frais1', 'sec0', 'sec1'].map(n => dab(...D[n], 0.6)),
    dab(...D.leger, 0.25),
    dab(...D.fort, 0.95),
    // frotter : la boule glisse sur 1,8 m
    { kind: 'tool', tool: 'journal', p: 0.5, dur: 1.5, path: t => [RUB[0] + (RUB[1] - RUB[0]) * t, RUB[2]] },
    ...Array.from({ length: 8 }, () => dab(...D.repasse, 1, 1)),
    // même pression, appui bref ou prolongé ; grosse boule
    dab(...D.court, 0.6, 0.1),
    dab(...D.long, 0.6, 1.5),
    dab(D.grand[0], D.grand[1], 0.6, 0.25, BIG),
    { kind: 'do', fn: () => {
      const after = areas();
      console.log('VRPAINT_TEST gestes ' + history.records.slice(-30).map(r => r.label).join(','));
      save('2-papier-journal', zone(0.4, 0.7, 4.2, 2.4));
      for (const n of ['frais0', 'sec0', 'fort', 'repasse', 'long', 'grand']) save('2-zoom-' + n, zone(D[n][0] - rad(n), D[n][1] - rad(n), D[n][0] + rad(n), D[n][1] + rad(n), n === 'grand' ? 2500 : 5000));
      save('2-zoom-frotte', zone(1.2, RUB[2] - R, 1.6, RUB[2] + R, 2500));
      const fr = ['frais0', 'frais1'].map(n => dabStats(after, n)), dr = ['sec0', 'sec1'].map(n => dabStats(after, n));
      const lo = dabStats(after, 'leger'), hi = dabStats(after, 'fort'), many = dabStats(after, 'repasse');
      const brief = dabStats(after, 'court'), held = dabStats(after, 'long'), big = dabStats(after, 'grand');
      const all = [...fr, ...dr, lo, hi, many, brief, held, big];
      const f2 = (x, n = 2) => x.toFixed(n);
      report('PAPIER_REVELE', all.every(s => s.odd < 0.01) && dr[0].area > 0.06 && dr[0].area < 0.9,
        `contact=${f2(dr[0].area)} hors-segment=${f2(Math.max(...all.map(s => s.odd)), 4)}`);
      // un appui seul : bord de contact net (le recouvrement de plusieurs appuis donne des paliers)
      const colorNow = v().surface.readRaw('color');
      const edges = ['frais0', 'frais1', 'sec0', 'sec1', 'leger', 'fort'].map(n => edgeWidth(colorNow, n));
      report('PAPIER_NET', edges.every(e => e < 1.2), `largeur du bord (texels)=${edges.map(e => f2(e)).join('/')}`);
      const c = corr(dr[0], dr[1]);
      report('PAPIER_CHAQUE_APPUI', Math.abs(c) < 0.5, `correlation=${f2(c)}`);
      report('PAPIER_PRESSION', hi.area > lo.area * 1.5 && hi.mean > lo.mean * 1.5, `contact ${f2(lo.area)} → ${f2(hi.area)}`);
      const mf = (fr[0].mean + fr[1].mean) / 2, md = (dr[0].mean + dr[1].mean) / 2;
      report('PAPIER_FRAIS', mf > md * 1.3, `frais=${f2(mf, 3)} recent=${f2(md, 3)}`);
      report('PAPIER_FOND_INTACT', many.odd < 0.01 && many.top > 0.75, `max=${f2(many.top)} hors-segment=${f2(many.odd, 4)}`);
      report('PAPIER_DUREE', held.mean > brief.mean * 1.8, `bref=${f2(brief.mean, 3)} prolonge=${f2(held.mean, 3)}`);
      // grosse boule : contact (en surface) bien plus grand qu'avec la moyenne, à même pression
      const touched = s => s.area * s.px.length;
      report('PAPIER_TAILLE', touched(big) > touched(fr[0]) * 2.2, `pixels touches ${Math.round(touched(fr[0]))} → ${Math.round(touched(big))} (Ø ${BIG * 100} cm)`);
      // bande frottée : du rouge parti tout du long, en traînées
      let n = 0, tot = 0;
      for (let x = RUB[0] + 0.1; x < RUB[1] - 0.1; x += 0.01) {
        const s = dabStats(after, 'frotte', x, RUB[2]);
        tot++; if (s.mean > 0.03) n++;
      }
      report('PAPIER_FROTTE', n / tot > 0.9, `colonnes=${f2(n / tot)}`);
    } },
    // chalumeau : tache rouge fraîche, flamme tenue 2 s à 5 cm sur sa moitié droite, puis un appui de papier de chaque côté
    spray('Rouge', 'superfat', 0.2, 6, t => [4.5 + 2.0 * tri(t * 8), 0.45 + 0.3 * tri(t * 3)]),
    { kind: 'tool', tool: 'chalumeau', p: 1, d: 0.05, dur: 2, path: () => T.chaud },
    { kind: 'tool', tool: 'chalumeau', p: 1, d: 0.05, dur: 2, path: () => T.local },
    { kind: 'do', fn: () => { torchBefore = Object.fromEntries(Object.entries(T).map(([n, [x, y]]) => [n, zone(x - BIG / 2, y - BIG / 2, x + BIG / 2, y + BIG / 2, 1000)])); } },
    dab(...T.chaud, 0.6, 0.5),
    dab(...T.froid, 0.6, 0.5),
    // grosse boule (22 cm) sur un point chauffé de quelques centimètres : seul ce point résiste
    dab(...T.local, 0.6, 0.5, BIG),
    { kind: 'do', fn: () => {
      const now = Object.fromEntries(Object.entries(T).map(([n, [x, y]]) => [n, zone(x - BIG / 2, y - BIG / 2, x + BIG / 2, y + BIG / 2, 1000)]));
      const c = Object.fromEntries(['chaud', 'froid'].map(n => [n, change(torchBefore[n], now[n], ...T[n], R)]));
      report('TORCHE_SECHE', c.chaud < c.froid * 0.4 && c.froid > 0.02, `papier sur peinture chauffee=${c.chaud.toFixed(3)} fraiche=${c.froid.toFixed(3)}`);
      // éclats du centre (chauffé) contre ceux d'une couronne à 7–10,5 cm (fraîche), dans la bande peinte : ce qu'emporte
      // un pixel touché (le contact est plus dense au centre, la boule étant bombée : on ne compare pas des moyennes)
      const a = torchBefore.local, b = now.local, [lx, ly] = T.local;
      let inner = 0, ni = 0, outer = 0, no = 0;
      for (const p of disk(a, lx, ly, BIG / 2)) {
        const r = Math.hypot(p.dx, p.dy) / a.k, d = Math.max(...[0, 1, 2].map(k => Math.abs(a.px[p.o + k] - b.px[p.o + k]))) / 255;
        if (d < 0.03) continue;
        if (r < 0.03) { inner += d; ni++; } else if (r > 0.07 && r < 0.105 && Math.abs(p.dy) / a.k < 0.1) { outer += d; no++; }
      }
      inner /= Math.max(1, ni); outer /= Math.max(1, no);
      report('TORCHE_LOCALE', inner < outer * 0.6 && ni > 50 && no > 50, `grosse boule, par pixel touche : centre chauffe=${inner.toFixed(3)} (${ni}) bord frais=${outer.toFixed(3)} (${no})`);
      save('4-chalumeau', zone(4.7, 0.4, 6.2, 0.8, 1000));
      dripBare = Object.fromEntries(Object.entries(DRIP).map(([n, [x]]) => [n, dripBand(x)]));
      set({ drips: true });
    } },
    // coulures : deux taches trop chargées ; la flamme attend sous la première (à 12 cm du mur, plus large)
    spray('Noir', 'superfat', 0.07, 1.2, () => DRIP.flamme),
    spray('Noir', 'superfat', 0.07, 1.2, () => DRIP.libre),
    { kind: 'tool', tool: 'chalumeau', p: 1, d: 0.12, dur: 5, path: () => [DRIP.flamme[0], DRIP.flamme[1] - 0.16] },
    { kind: 'do', fn: () => {
      const n = Object.fromEntries(Object.entries(DRIP).map(([k, [x]]) => [k, inked(dripBand(x), dripBare[k])]));
      report('TORCHE_COULURES', n.libre > 30 && n.flamme < n.libre * 0.15, `pixels de coulure sous la flamme=${n.flamme} sans flamme=${n.libre}`);
      save('4-coulures', zone(6.2, 0.8, 7.0, 1.4, 1000));
      set({ drips: false });
      v().spray.drips.length = 0;
    } },
    // pinceaux sur le mur nu (zone B)
    stroke('pinceau-rond', 0.025, 'Bleu roi', 0.6, 0, 2.3, t => [4.5 + 2.3 * t, 2.6]),
    wait(1),
    stroke('pinceau-plat', 0.04, 'Violet', 0.6, 90, 0.8, t => [4.6 + 0.8 * t, 2.2]),
    wait(1),
    stroke('pinceau-plat', 0.04, 'Violet', 0.6, 0, 0.8, t => [4.6 + 0.8 * t, 1.9]),
    wait(1),
    stroke('pinceau-rond', 0.01, 'Bleu roi', 0.6, 0, 0.8, t => [4.6 + 0.8 * t, 1.5]),
    wait(1),
    stroke('pinceau-rond', 0.05, 'Bleu roi', 0.6, 0, 0.8, t => [4.6 + 0.8 * t, 1.2]),
    { kind: 'do', fn: () => {
      save('3-pinceaux', zone(4.4, 1.0, 6.9, 2.75, 800));
      save('3-zoom-rond-debut', zone(4.5, 2.55, 4.75, 2.65, 2500));
      save('3-zoom-rond-sec', zone(5.4, 2.55, 5.65, 2.65, 2500));
      save('3-zoom-plat', zone(4.7, 2.15, 4.95, 2.25, 2500));
      const long = band('long');
      const cov = (x0, x1) => {
        const i0 = Math.round((x0 - 4.5) * 1000), i1 = Math.round((x1 - 4.5) * 1000);
        let s = 0, n = 0;
        for (let j = 0; j < long.z.h; j++) for (let i = i0; i < i1; i++) { const d = long.d(i, j); if (d > 40) s++; n++; }
        return s / n;
      };
      const c0 = cov(4.55, 4.8), c1 = cov(6.5, 6.75), cm = cov(5.3, 5.8);
      report('PINCEAU_CHARGE', c0 > 0.12 && c1 < c0 * 0.4 && cm < c0, `couverture debut=${c0.toFixed(3)} milieu=${cm.toFixed(3)} fin=${c1.toFixed(3)}`);
      // traînées : en travers du trait, le profil alterne poils chargés et vides
      const prof = rows(long, 400, 900).filter(x => x > 8);
      let runs = 0;
      for (let i0 = 700; i0 < 2200; i0 += 20) {
        const p = rows(long, i0, i0 + 20);
        let inRun = false, r = 0;
        for (const x of p) { if (x > 40 && !inRun) { r++; inRun = true; } else if (x <= 40) inRun = false; }
        if (r >= 2) runs++;
      }
      const mean = prof.reduce((s, x) => s + x, 0) / prof.length, sd = Math.sqrt(prof.reduce((s, x) => s + (x - mean) ** 2, 0) / prof.length);
      report('PINCEAU_POILS', sd / mean > 0.08 && runs >= 8, `stries=${(sd / mean).toFixed(2)} colonnes-en-traînées=${runs}/75`);
      // couleur : le bleu domine (Bleu roi) et le violet a du rouge et du bleu
      let rgb = [0, 0, 0], n = 0;
      for (let j = 0; j < long.z.h; j++) for (let i = 50; i < 300; i++) {
        const o = (j * long.z.w + i) * 4;
        if (long.d(i, j) > 80) { for (let c = 0; c < 3; c++) rgb[c] += long.z.px[o + c]; n++; }
      }
      rgb = rgb.map(x => x / Math.max(1, n));
      report('PINCEAU_COULEUR', n > 100 && rgb[2] > rgb[0] + 30 && rgb[2] > rgb[1] + 20, `rgb=${rgb.map(Math.round).join(',')}`);
      const across = height(band('across'), 150, 450), along = height(band('along'), 150, 450);
      report('PINCEAU_PLAT_TRANCHE', across > along * 3 && across > 0.03, `en travers=${(across * 100).toFixed(1)} cm, de chant=${(along * 100).toFixed(1)} cm`);
      const small = height(band('small'), 150, 450), big = height(band('big'), 150, 450);
      report('PINCEAU_TAILLES', big > small * 2.5, `1 cm → ${(small * 100).toFixed(1)} cm, 5 cm → ${(big * 100).toFixed(1)} cm`);
    } },
    // chalumeau : une tache fraîche, flamme de 6 cm sur un point, flamme de 24 cm sur l'autre
    spray('Rouge', 'superfat', 0.2, 4, t => [-0.85 + 0.8 * tri(t * 8), 0.45 + 0.1 * tri(t * 3)]),
    { kind: 'tool', tool: 'chalumeau', p: 1, d: 0.05, dur: 2, path: () => FL.petite },
    { kind: 'tool', tool: 'chalumeau', size: 0.24, p: 1, d: 0.05, dur: 2, path: () => FL.grande },
    { kind: 'do', fn: () => {
      const w = Object.fromEntries(Object.entries(FL).map(([n, [x, y]]) => [n, [wetAt(x, y), wetAt(x + 0.1, y)]]));
      report('TORCHE_TAILLE', w.petite[0] < 0.2 && w.grande[0] < 0.2 && w.petite[1] > 0.5 && w.grande[1] < w.petite[1] * 0.25,
        `humidite au centre / a 10 cm : flamme 6 cm=${w.petite.map(x => x.toFixed(2)).join(' / ')} flamme 24 cm=${w.grande.map(x => x.toFixed(2)).join(' / ')}`);
      spBare = spZones();
      set({ realLoad: false });
    } },
    // éponge, charge réaliste coupée : appuis isolés, pression, tailles, série de six, bande frottée
    stroke('eponge', 0.08, 'Bleu roi', 0.6, 0, 0.25, () => SP.a),
    stroke('eponge', 0.08, 'Bleu roi', 0.6, 0, 0.25, () => SP.b),
    stroke('eponge', 0.08, 'Bleu roi', 0.25, 0, 0.25, () => SP.leger),
    stroke('eponge', 0.08, 'Bleu roi', 1, 0, 0.25, () => SP.fort),
    stroke('eponge', 0.04, 'Bleu roi', 0.6, 0, 0.25, () => SP.petite),
    stroke('eponge', 0.16, 'Bleu roi', 0.6, 0, 0.25, () => SP.grande),
    ...Array.from({ length: 6 }, (_, k) => stroke('eponge', 0.08, 'Bleu roi', 0.6, 0, 0.25, () => SP['n' + k])),
    stroke('eponge', 0.06, 'Bleu roi', 0.6, 0, 1.6, t => [SP_RUB[0] + (SP_RUB[1] - SP_RUB[0]) * t, SP_RUB[2]]),
    stroke('pinceau-rond', 0.025, 'Bleu roi', 0.6, 0, 1.2, t => [SP_BR[0] + (SP_BR[1] - SP_BR[0]) * t, SP_BR[2]]),
    // charge réaliste : l'éponge, rechargée (loin du mur une seconde), puis six appuis rapprochés
    { kind: 'do', fn: () => set({ realLoad: true }) },
    wait(1.2),
    ...Array.from({ length: 6 }, (_, k) => stroke('eponge', 0.08, 'Bleu roi', 0.6, 0, 0.25, () => SP['r' + k])),
    { kind: 'do', fn: () => {
      const after = spZones(), st = Object.fromEntries(Object.keys(SP).map(n => [n, spStats(after, n)]));
      for (const n of ['a', 'fort', 'grande']) save('6-eponge-' + n, zone(SP[n][0] - spR(n), SP[n][1] - spR(n), SP[n][0] + spR(n), SP[n][1] + spR(n), 2500));
      save('6-eponge', zone(-0.95, 0.9, 0.1, 2.85, 600));
      save('6-eponge-frottee', zone(-0.6, SP_RUB[2] - 0.06, -0.3, SP_RUB[2] + 0.06, 2500));
      const a = st.a, f2 = (x, n = 2) => x.toFixed(n);
      report('EPONGE_POREUX', a.holes > 0.04 && a.holes < 0.7 && a.flips > 40 && a.area > 300,
        `trous au centre=${f2(a.holes)} passages encre/trou=${Math.round(a.flips)}/m pixels encres=${a.area}`);
      report('EPONGE_COULEUR', a.rgb[2] > a.rgb[0] + 30 && a.rgb[2] > a.rgb[1] + 20, `rgb=${a.rgb.map(Math.round).join(',')}`);
      const c = corr(st.a, st.b);
      report('EPONGE_CHAQUE_APPUI', Math.abs(c) < 0.5, `correlation=${f2(c)}`);
      report('EPONGE_PRESSION', st.fort.area > st.leger.area * 1.3, `pixels encres ${st.leger.area} → ${st.fort.area}`);
      report('EPONGE_TAILLE', st.grande.area > st.petite.area * 6, `Ø 4 cm=${st.petite.area} Ø 16 cm=${st.grande.area}`);
      // encre moyenne des trois premiers appuis, puis des deux derniers (un seul appui dépend trop de son motif)
      const avg = (k, ks) => ks.reduce((t, i) => t + st[k + i].mean, 0) / ks.length;
      const r = [avg('r', [0, 1, 2]), avg('r', [4, 5])], n = [avg('n', [0, 1, 2]), avg('n', [4, 5])];
      report('EPONGE_CHARGE', r[1] < r[0] * 0.55 && n[1] > n[0] * 0.65 && r[0] > 0.04,
        `encre appuis 1-3 → 5-6 : charge reelle ${f2(r[0], 3)} → ${f2(r[1], 3)}, sans ${f2(n[0], 3)} → ${f2(n[1], 3)}`);
      // bande frottée : encrée tout du long, et striée dans le sens du geste (profil en travers inégal)
      const z = after.rub, base = spBare.rub, d = (i, j) => ink(z, base, (j * z.w + i) * 4);
      let full = 0, cols = 0;
      for (let i0 = 50; i0 + 10 <= z.w - 50; i0 += 10) {
        let s = 0;
        for (let j = 0; j < z.h; j++) for (let i = i0; i < i0 + 10; i++) s += d(i, j);
        cols++; if (s / (10 * z.h) > 25) full++;
      }
      const prof = [];
      for (let j = 0; j < z.h; j++) { let s = 0; for (let i = 200; i < 600; i++) s += d(i, j); prof.push(s / 400); }
      const core = prof.filter(x => x > 20), mean = core.reduce((s, x) => s + x, 0) / Math.max(1, core.length);
      const sd = Math.sqrt(core.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, core.length));
      report('EPONGE_FROTTE', full / cols > 0.9 && sd / mean > 0.1 && core.length > 20, `colonnes=${f2(full / cols)} stries=${f2(sd / mean)} hauteur=${core.length} mm`);
      // pinceau sans épuisement : la fin du trait (90 cm) couvre autant que le début
      const b = after.br, bb = spBare.br, cov = (x0, x1) => {
        let on = 0, all = 0;
        for (let j = 0; j < b.h; j++) for (let i = Math.round((x0 - SP_BR[0]) * 1000); i < Math.round((x1 - SP_BR[0]) * 1000); i++) { all++; if (ink(b, bb, (j * b.w + i) * 4) > 40) on++; }
        return on / all;
      };
      const c0 = cov(-0.85, -0.6), c1 = cov(-0.3, -0.05);
      report('PINCEAU_SANS_CHARGE', c0 > 0.12 && c1 > c0 * 0.85, `couverture debut=${f2(c0, 3)} fin=${f2(c1, 3)}`);
    } },
    { kind: 'do', fn: () => {
      // annuler tous les gestes de papier et de pinceau : couches d'avant, au bit près
      const n = history.count - recs;
      for (let k = 0; k < n; k++) v().actions.undo();
      const d = sameRaw(before, raw());
      report('UNDO', d === 0 && n >= 16, `gestes=${n} texels=${d}`);
    } },
    // enregistrement : pinceau et papier sur le mur, puis réouverture
    stroke('pinceau-plat', 0.08, 'Jaune', 0.8, 70, 1.2, t => [0.6 + 1.8 * t, 2.25 - 0.3 * t]),
    dab(1.3, 2.15, 0.8),
    { kind: 'tool', tool: 'journal', p: 0.6, dur: 0.6, path: t => [3.2 + 0.5 * t, 2.0] },
    { kind: 'do', fn: async () => {
      const a = await v().exportAll();
      const img = zone(0.4, 0.7, 4.2, 2.4).px;
      await v().actions.save();
      const id = v().state.projectId;
      await v().actions.newProject();
      await v().actions.openProject(id);
      const b = await v().exportAll();
      let d = 0, pire = '';
      for (const k of Object.keys(a.mur)) {
        const x = a.mur[k].data, y = b.mur[k]?.data;
        if (!y) { d = Infinity; pire = k; continue; }
        for (let i = 0; i < x.length; i += 4) {
          const e = Math.max(Math.abs(x[i + 3] - y[i + 3]), ...[0, 1, 2].map(c => Math.abs(x[i + c] * x[i + 3] - y[i + c] * y[i + 3]) / 255));
          if (e > d) { d = e; pire = k; }
        }
      }
      const img2 = zone(0.4, 0.7, 4.2, 2.4).px;
      let px = 0;
      for (let i = 0; i < img.length; i += 4) if (Math.max(Math.abs(img[i] - img2[i]), Math.abs(img[i + 1] - img2[i + 1]), Math.abs(img[i + 2] - img2[i + 2])) > 6) px++;
      report('ENREGISTRE', d <= 1.5 && px < img.length / 4 * 0.002, `ecart8bits=${d.toFixed(2)} (${pire}) pixels=${px}`);
    } },
    // fond continu : un voile noir par-dessus du bleu. Au bord du voile, là où il ne dépose presque
    // rien, le fond (ce que le papier ou le grattoir laissent) ne doit pas sauter du bleu au mur nu :
    // ce saut dessinait au papier des ronds nets, le contour exact des tampons de la bombe.
    spray('Bleu ciel', 'superfat', 0.5, 2, t => [4.7 + 1.8 * t, 0.45]),
    wait(1),
    spray('Noir', 'superfat', 0.5, 0.6, t => [5.0 + 0.5 * t, 0.45]),
    { kind: 'do', fn: () => {
      const S = v().surface, [W, H] = S.res, h = THREE.DataUtils.fromHalfFloat;
      const c = S.readRaw('color'), f = S.readRaw('fondColor');
      const tx = x => Math.round((x + ox) / S.width * W);
      // pire saut du fond entre deux texels voisins, au-delà du saut visible au même endroit
      let jf = 0, jc = 0, at = 0;
      for (let y = 0.38; y <= 0.52; y += 0.02) {
        const ty = Math.round(y / S.height * H);
        for (let i = tx(4.8); i < tx(6.4); i++) {
          const o = (ty * W + i) * 4;
          for (let k = 0; k < 4; k++) {
            const dc = Math.abs(h(c[o + 4 + k]) - h(c[o + k])), df = Math.abs(h(f[o + 4 + k]) - h(f[o + k]));
            if (df - dc > jf) { jf = df - dc; jc = dc; at = (i + 0.5) / W * S.width - ox; }
          }
        }
      }
      report('FOND_CONTINU', jf < 0.05, `saut du fond=${(jf + jc).toFixed(3)} pour un saut visible de ${jc.toFixed(3)} (x=${at.toFixed(2)} m)`);
    } },
    // le papier frotté sur tout le voile : pas de contour de tampon
    ...[0.40, 0.45, 0.50].map(y => ({ kind: 'tool', tool: 'journal', p: 1, dur: 1, path: t => [4.8 + 1.6 * t, y] })),
    { kind: 'do', fn: () => save('4-voile-noir-papier', zone(4.7, 0.2, 6.5, 0.7, 800)) },
    // couche sèche sous un voile frais : une tache jaune séchée au chalumeau, un voile noir par-dessus.
    // Le papier, même insistant, emporte le noir et s'arrête sur le jaune, sans jamais montrer le mur.
    spray('Jaune', 'superfat', 0.1, 1.5, () => SEC),
    { kind: 'tool', tool: 'chalumeau', p: 1, d: 0.05, dur: 3, path: () => SEC },
    { kind: 'do', fn: () => { sec.jaune = zone(...secBox, 1000); } },
    spray('Noir', 'superfat', 0.3, 0.3, t => [SEC[0] - 0.1 + 0.2 * t, SEC[1]]),
    { kind: 'do', fn: () => { sec.noir = zone(...secBox, 1000); } },
    ...Array.from({ length: 6 }, () => dab(...SEC, 1, 0.5)),
    { kind: 'do', fn: () => {
      const a = sec.jaune, k = sec.noir, b = zone(...secBox, 1000);
      let mur = 0, noir = 0, reste = 0;
      const px = disk(a, ...SEC, 0.03);
      for (const p of px) {
        const dist = z => Math.max(...[0, 1, 2].map(c => Math.abs(z.px[p.o + c] - a.px[p.o + c])));
        if (b.px[p.o + 2] > a.px[p.o + 2] + 40) mur++;   // plus bleu que le jaune : le mur blanc (ou ce qu'il y avait dessous)
        noir += dist(k); reste += dist(b);
      }
      noir /= px.length * 255; reste /= px.length * 255;
      report('PAPIER_SOUS_COUCHE_SECHE', mur / px.length < 0.01 && noir > 0.15 && reste < noir * 0.6,
        `mur visible=${(100 * mur / px.length).toFixed(1)} % voile noir=${noir.toFixed(3)} reste apres papier=${reste.toFixed(3)}`);
      save('5-sous-couche-seche', zone(SEC[0] - 0.15, SEC[1] - 0.12, SEC[0] + 0.15, SEC[1] + 0.12, 1000));
    } },
  ];

  const input = { pressure: 0, origin: new THREE.Vector3(), dir: new THREE.Vector3(), right: new THREE.Vector3(), up: new THREE.Vector3() };
  let i = 0, t = 0, done = false, frames = 0;
  const started = performance.now();
  const next = () => { i++; t = 0; };
  return {
    step() {
      if (done) return null;
      const s = steps[i];
      if (!s) {
        done = true;
        set({ ...keep, tool: 'bombe' });
        console.log(`VRPAINT_TEST outils steps=${steps.length} frames=${frames} ms=${Math.round(performance.now() - started)}`);
        document.title = 'VRPAINT_DONE';
        return null;
      }
      if (s.kind === 'do') {
        if (!s.started) {
          s.started = true;
          let r;
          try { r = s.fn(); } catch (e) { console.log('VRPAINT_TEST erreur ' + (e.stack || e)); }
          if (!r?.then) { next(); return null; }
          r.catch(e => console.log('VRPAINT_TEST erreur ' + (e.stack || e))).finally(() => { s.ok = true; });
        }
        if (s.ok) next();
        return null;
      }
      t += 1 / 60;
      if (s.kind === 'wait') { if (t >= s.dur) next(); return null; }
      if (t <= 1 / 60 + 1e-9) {
        if (s.kind === 'spray') set({ tool: 'bombe', paint: paint(s.paint), cap: s.cap, capScale: 1, angle: 0 });
        else {
          set({ tool: s.tool, angle: s.angle || 0, pressure: s.p, ...(s.paint ? { paint: paint(s.paint) } : {}),
            // taille donnée, ou celle par défaut : jamais celle qu'une étape d'avant a laissée
            ...(sizedTool(s.tool) ? { brushSizes: { ...state.brushSizes, [s.tool]: s.size ?? (sizedTool(s.tool).size || sizedTool(s.tool).sizes[1]) } } : {}) });
        }
        console.log(`VRPAINT_TEST ${s.kind} ${s.paint || s.tool} frames=${frames}`);
      }
      const u = Math.min(1, t / s.dur);
      const [px, y] = s.path(u), x = px + ox;
      const a = (s.angle || 0) * Math.PI / 180;
      const d = s.d ?? 0.05;
      input.origin.copy(f.corner).addScaledVector(f.ex, x).addScaledVector(f.ey, y).addScaledVector(f.n, d);
      input.dir.copy(f.n).negate();
      input.right.copy(f.ex).multiplyScalar(Math.cos(a)).addScaledVector(f.ey, Math.sin(a));
      input.up.copy(f.ey).multiplyScalar(Math.cos(a)).addScaledVector(f.ex, -Math.sin(a));
      input.pressure = t < s.dur ? (s.kind === 'spray' ? 1 : s.p) : 0;
      // un temps sans contact entre deux gestes : le papier se re-froisse, le pinceau se décolle
      if (t >= s.dur + 0.05) next();
      return input;
    },
    after() { frames++; },
  };
}

function tri(x) { const k = x % 2; return k < 1 ? k : 2 - k; }
