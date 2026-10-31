import * as THREE from 'three';
import { NEWSPAPER } from './newspaper.js';

// ?test=outils : papier journal et pinceaux, gestes rejoués image par image.
//   - fond bleu sec, rouge par-dessus ; le papier journal emporte du rouge et ne montre que du bleu,
//     jamais le mur ; motif net (facettes), différent à chaque appui, plus large en appuyant,
//     plus marqué sur la peinture fraîche ; frotter laisse une bande ;
//   - pinceaux : couleur courante, charge qui s'épuise le long du trait, traînées de poils,
//     tranche du pinceau plat qui suit le poignet, tailles ;
//   - annuler rend les couches d'avant au bit près ; enregistrer puis rouvrir rend le même mur.
// Résultats : lignes « VRPAINT_OUTILS_<nom> OK|ECHEC … » ; images : window.__vrpaintShots.
export function runOutilsTest({ set, state, PAINTS, world, WALL, readWall, history }) {
  const v = () => window.__vrpaint;
  const paint = name => PAINTS.find(p => p.name === name);
  const f = world.wallFrame;
  const ox = (WALL.width - 6) / 2;   // repère du test : 6 m centrés sur le mur
  const keep = { wall: state.wall, drips: state.drips, pressure: state.pressure, angle: state.angle, brushSizes: state.brushSizes };
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
  const R = NEWSPAPER.radius;
  // Appuis du papier (m, repère du test) et bande frottée ; chacune est photographiée à 1 mm par pixel
  // sur le bleu sec, sur le rouge, puis après le papier
  const D = { frais0: [3.3, 2.3], frais1: [3.7, 2.3], sec0: [0.9, 2.0], sec1: [0.9, 1.0], leger: [1.7, 2.0], fort: [1.7, 1.0], repasse: [2.3, 2.2] };
  const RUB = [0.6, 2.4, 1.5];
  const areas = () => {
    const out = {};
    for (const [n, [x, y]] of Object.entries(D)) out[n] = zone(x - R, y - R, x + R, y + R, 1000);
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
    const px = disk(after[n], cx, cy, R);
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
  const dab = (x, y, p, dur = 0.25) => ({ kind: 'tool', tool: 'journal', p, dur, path: () => [x, y] });
  const stroke = (tool, size, name, p, angle, dur, path) => ({ kind: 'tool', tool, size, paint: name, p, angle, dur, path });
  const wait = dur => ({ kind: 'wait', dur });
  const steps = [
    { kind: 'do', fn: () => set({ drips: false, wall: 'blanc' }) },
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
    ...Array.from({ length: 8 }, () => dab(...D.repasse, 1, 0.12)),
    { kind: 'do', fn: () => {
      const after = areas();
      console.log('VRPAINT_TEST gestes ' + history.records.slice(-30).map(r => r.label).join(','));
      save('2-papier-journal', zone(0.4, 0.7, 4.2, 2.4));
      for (const n of ['frais0', 'sec0', 'fort', 'repasse']) save('2-zoom-' + n, zone(D[n][0] - R, D[n][1] - R, D[n][0] + R, D[n][1] + R, 5000));
      save('2-zoom-frotte', zone(1.2, RUB[2] - R, 1.6, RUB[2] + R, 2500));
      const fr = ['frais0', 'frais1'].map(n => dabStats(after, n)), dr = ['sec0', 'sec1'].map(n => dabStats(after, n));
      const lo = dabStats(after, 'leger'), hi = dabStats(after, 'fort'), many = dabStats(after, 'repasse');
      const all = [...fr, ...dr, lo, hi, many];
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
      // bande frottée : du rouge parti tout du long, en traînées
      let n = 0, tot = 0;
      for (let x = RUB[0] + 0.1; x < RUB[1] - 0.1; x += 0.01) {
        const s = dabStats(after, 'frotte', x, RUB[2]);
        tot++; if (s.mean > 0.03) n++;
      }
      report('PAPIER_FROTTE', n / tot > 0.9, `colonnes=${f2(n / tot)}`);
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
            ...(s.size ? { brushSizes: { ...state.brushSizes, [s.tool]: s.size } } : {}) });
        }
        console.log(`VRPAINT_TEST ${s.kind} ${s.paint || s.tool} frames=${frames}`);
      }
      const u = Math.min(1, t / s.dur);
      const [px, y] = s.path(u), x = px + ox;
      const a = (s.angle || 0) * Math.PI / 180;
      const d = s.kind === 'spray' ? s.d : 0.05;
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
