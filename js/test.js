import * as THREE from 'three';

// Peinture scriptée pour vérifier le moteur sans casque : index.html?test
// (?test=night pour finir en mode nuit). Chaque trait est rejoué image par image.
export function runTest(ctx) {
  if (ctx.params.get('test') === 'caches') return runCachesTest(ctx);
  const { set, PAINTS, world, WALL, params, readWall } = ctx;
  // image du mur vierge en basse résolution (elle passe par les mipmaps), prise avant tout trait
  const blank = readWall(32, 12);
  const paint = name => PAINTS.find(p => p.name === name);
  const f = world.wallFrame;
  const strokes = [
    // fond : 10 passes horizontales à ~1 m/s
    { paint: 'Bleu ciel', cap: 'superfat', d: 0.3, dur: 40, path: t => [0.9 + 4.2 * tri(t * 10), 0.6 + 1.9 * t] },
    { paint: 'Violet', cap: 'fat', d: 0.15, dur: 8, path: t => circle(3, 1.5, 0.85, t * 1.5) },
    { paint: 'Chrome', cap: 'standard', d: 0.12, dur: 8, path: t => [1 + 4 * t, 1.6 + 0.4 * Math.sin(t * Math.PI * 3)] },
    { paint: 'Or', cap: 'standard', d: 0.1, dur: 4, path: t => circle(1.4, 2.3, 0.25, t * 1.2) },
    { paint: 'Noir', cap: 'skinny', d: 0.06, dur: 10, hold: 1.4, path: t => [1 + 4 * t, 1.0] },
    { paint: 'Rose fluo', cap: 'flat', d: 0.12, angle: 45, dur: 2.5, path: t => [3.6 + 1.2 * t, 2.0 + 0.5 * t] },
    { paint: 'Blanc', cap: 'skinny', d: 0.05, dur: 3, pressure: 0.4, path: t => [1.2 + 0.8 * t, 2.65] },
    ...[[4.6, 2.5], [4.9, 2.2], [5.2, 2.5]].map(([x, y]) =>
      ({ paint: 'Phospho vert', cap: 'fat', d: 0.1, dur: 0.5, path: () => [x, y] })),
    // remplissage au flat cap : éventail horizontal, passes verticales à ~1 m/s
    { paint: 'Jaune', cap: 'flat', d: 0.15, dur: 12, abs: true, path: t => [WALL.width - 1.6 + 1.0 * t, 0.5 + 2.0 * tri(t * 6)] },
  ];
  const ox = (WALL.width - 6) / 2;
  const input = { pressure: 0, origin: new THREE.Vector3(), dir: new THREE.Vector3(), right: new THREE.Vector3(), up: new THREE.Vector3() };
  let i = 0, t = 0, frames = 0, done = false, started = performance.now();

  function begin(s) {
    set({ tool: 'bombe', paint: paint(s.paint), cap: s.cap, capScale: 1, angle: s.angle || 0 });
  }
  begin(strokes[0]);

  return {
    step() {
      if (done) return null;
      const s = strokes[i];
      const dtFixed = 1 / 60;
      t += dtFixed;
      const total = s.dur + (s.hold || 0);
      const u = Math.min(1, t / s.dur);
      const [px, y] = s.path(u), x = s.abs ? px : px + ox;
      const a = (s.angle || 0) * Math.PI / 180;
      input.origin.copy(f.corner).addScaledVector(f.ex, x).addScaledVector(f.ey, y).addScaledVector(f.n, s.d);
      input.dir.copy(f.n).negate();
      input.right.copy(f.ex).multiplyScalar(Math.cos(a)).addScaledVector(f.ey, Math.sin(a));
      input.up.copy(f.ey).multiplyScalar(Math.cos(a)).addScaledVector(f.ex, -Math.sin(a));
      input.pressure = t < total ? (s.pressure || 1) : 0;
      if (t >= total + 0.05) {
        i++; t = 0;
        if (i >= strokes.length) {
          done = true;
          console.log(`VRPAINT_TEST strokes=${strokes.length} frames=${frames} ms=${Math.round(performance.now() - started)}`);
          return null;
        }
        begin(strokes[i]);
        console.log(`VRPAINT_TEST stroke ${i} frames=${frames}`);
      }
      return input;
    },
    after(renderer) {
      frames++;
      const v = window.__vrpaint;
      if (done && !this.reported) {
        this.reported = true;
        const gl = renderer.getContext();
        console.log('VRPAINT_GL_ERROR ' + gl.getError() + ' drips=' + v.spray.drips.length);
        // « Tout effacer » doit aussi vider les niveaux réduits (vus de loin en VR)
        v.actions.clear();
        const low = v.readWall(32, 12);
        let diff = 0;
        for (let k = 0; k < low.length; k++) if (k % 4 !== 3) diff = Math.max(diff, Math.abs(low[k] - blank[k]));
        console.log(`VRPAINT_CLEAR_CHECK ${diff === 0 ? 'OK' : 'ECHEC'} ecart=${diff}`);
        v.actions.undo();
        // passage en nuit après le contrôle : l'image de référence est de jour
        if (params.get('test') === 'night') set({ night: true });
        document.title = 'VRPAINT_DONE';
      }
    },
  };
}

function tri(x) { const k = x % 2; return k < 1 ? k : 2 - k; }
function circle(cx, cy, r, t) { return [cx + r * Math.cos(t * Math.PI * 2), cy + r * Math.sin(t * Math.PI * 2)]; }

// ?test=caches : fond bleu, caches superposés, aplat rouge, retrait des caches,
// raclage (couteau, spatule, grattoir), puis contrôles d'annulation exacte sur
// les couches brutes (half-float) de toutes les surfaces.
// Images : window.__vrpaintShots ; pauses « VRPAINT_PAUSE nom » pour une capture
// d'écran (reprise par window.__vrpaintResume = nom, ou seule après 2 s).
function runCachesTest({ set, PAINTS, world, WALL, readWall, stencils, wallCanvas, history }) {
  const v = () => window.__vrpaint;
  const blank = readWall(32, 12);
  const paint = name => PAINTS.find(p => p.name === name);
  const f = world.wallFrame;
  const ox = (WALL.width - 6) / 2;
  const shots = window.__vrpaintShots = [];
  // image du mur entier sur w pixels ; zone [x0, y0, x1, y1] (m, repère du test) : recadrage
  const shot = (name, w = 2400, zone = null) => {
    const h = Math.round(w * WALL.height / WALL.width);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').putImageData(new ImageData(readWall(w, h), w, h), 0, 0);
    let out = c;
    if (zone) {
      const k = w / WALL.width, [x0, y0, x1, y1] = zone;
      out = document.createElement('canvas');
      out.width = Math.round((x1 - x0) * k);
      out.height = Math.round((y1 - y0) * k);
      out.getContext('2d').drawImage(c, (x0 + ox) * k, (WALL.height - y1) * k, out.width, out.height, 0, 0, out.width, out.height);
    }
    shots.push({ name, url: out.toDataURL('image/png') });
  };
  const mask = (shape, x, y, r, rot = 0, lift = 0.001) => {
    stencils.add(wallCanvas, { shape, x: x + ox, y, r, rot, lift });
    stencils.commit();
  };
  // couches brutes de toutes les surfaces peintes
  const raw = () => {
    const out = [];
    const surfaces = [v().surface, ...v().canvases.painted().map(c => c.surface)];
    for (const s of surfaces) for (const k of Object.keys(s.targets)) out.push([s.uid + ':' + k, s.readRaw(k)]);
    return out;
  };
  const diff = (a, b) => {
    let d = 0, n = 0;
    const B = new Map(b);
    for (const [k, x] of a) {
      const y = B.get(k);
      if (!y || y.length !== x.length) return { d: Infinity, n: -1 };
      for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) { n++; d = Math.max(d, Math.abs(halfToFloat(x[i]) - halfToFloat(y[i]))); }
    }
    return { d, n };
  };
  let before = null;
  const spray = (name, cap, d, dur, path) => ({ kind: 'spray', paint: name, cap, d, dur, path });
  const scrape = (tool, pressure, angle, dur, path) => ({ kind: 'scrape', tool, pressure, angle, dur, path });
  const steps = [
    { kind: 'do', fn: () => set({ drips: false }) },
    spray('Bleu ciel', 'superfat', 0.22, 36, t => [0.6 + 4.8 * tri(t * 18), 0.45 + 2.1 * t]),
    { kind: 'do', fn: () => {
      mask('rond', 1.25, 1.6, 0.32);
      mask('carre', 1.7, 1.2, 0.22, 0.35);                 // chevauche le rond
      mask('triangle', 2.65, 1.65, 0.34, 0.1);
      mask('cerceau', 3.55, 1.6, 0.32);
      mask('cerceau', 3.95, 1.85, 0.2);                     // à cheval sur le premier
      mask('etoile', 4.75, 1.6, 0.38, 0, 0.015);            // décollé de 15 mm : bord flou
      mask('bande', 3, 0.85, 2.3, 0.04);                    // ruban de masquage
      console.log('VRPAINT_TEST caches=' + stencils.count());
    } },
    { kind: 'pause', name: 'caches' },
    spray('Rouge', 'superfat', 0.2, 36, t => [0.55 + 4.9 * tri(t * 20), 0.5 + 2.0 * t]),
    { kind: 'pause', name: 'peint' },
    { kind: 'do', fn: () => shot('1-peint-sous-caches') },
    { kind: 'do', fn: () => {
      stencils.removeAll();
      shot('2-formes');
      shot('2-zoom-rond-carre', 5000, [0.85, 0.85, 2.0, 2.0]);
      shot('2-zoom-etoile-decollee', 5000, [4.3, 1.15, 5.2, 2.05]);
    } },
    { kind: 'do', fn: () => { before = raw(); } },
    scrape('couteau', 0.55, 0, 12, t => [0.95 + 1.05 * t, 0.75 + 1.55 * tri(t * 18)]),
    scrape('spatule', 0.7, 0, 9, t => [2.3 + 0.9 * t, 0.7 + 1.6 * tri(t * 8)]),
    scrape('grattoir', 1, 20, 10, t => [4.1 + 0.9 * t, 0.7 + 1.6 * tri(t * 12)]),
    scrape('couteau', 0.9, -50, 3, t => [3.3 + 0.4 * t, 2.25 - 1.4 * t]),
    { kind: 'do', fn: () => {
      shot('3-raclage');
      shot('3-zoom-couteau', 5000, [0.95, 1.0, 1.75, 1.8]);
      shot('3-zoom-spatule', 5000, [2.3, 1.0, 3.1, 1.8]);
      shot('3-zoom-grattoir', 5000, [4.1, 1.0, 4.9, 1.8]);
    } },
    { kind: 'pause', name: 'raclage' },
    { kind: 'do', fn: () => {
      // annuler les 4 raclages doit rendre exactement les couches d'avant
      for (let k = 0; k < 4; k++) v().actions.undo();
      const r = diff(before, raw());
      console.log(`VRPAINT_UNDO_CHECK ${r.n === 0 ? 'OK' : 'ECHEC'} ecart=${r.d} texels=${r.n}`);
      // tout annuler (traits, poses et retraits de caches) : mur vierge, aucun cache
      let guard = 200;
      while (history.count && guard--) v().actions.undo();
      const low = readWall(32, 12);
      let d = 0;
      for (let k = 0; k < low.length; k++) if (k % 4 !== 3) d = Math.max(d, Math.abs(low[k] - blank[k]));
      let nz = 0;
      for (const [, x] of raw()) for (let i = 0; i < x.length; i++) if (x[i]) nz++;
      console.log(`VRPAINT_UNDO_ALL_CHECK ${d === 0 && nz === 0 && stencils.count() === 0 ? 'OK' : 'ECHEC'} ecart=${d} texels=${nz} caches=${stencils.count()}`);
    } },
    // enregistrement : caches et couche « fond » doivent revenir à l'ouverture
    spray('Jaune', 'fat', 0.2, 3, t => [1 + 2 * t, 2.2]),
    { kind: 'do', fn: () => { mask('etoile', 2, 1.5, 0.2, 0.3, 0.004); mask('bande', 3, 1.2, 0.6, -0.2); } },
    spray('Noir', 'fat', 0.2, 3, t => [1 + 2 * t, 2.2]),
    scrape('spatule', 0.6, 0, 1.5, t => [1.6, 2.4 - 0.4 * t]),
    { kind: 'do', fn: async () => {
      const a = await v().exportAll();
      const masks = JSON.stringify(stencils.serialize());
      await v().actions.save();
      const id = v().state.projectId;
      await v().actions.newProject();
      const emptied = stencils.count();
      await v().actions.openProject(id);
      const b = await v().exportAll();
      // écart en valeurs prémultipliées (la teinte d'un texel transparent ne compte pas)
      let d = 0, fond = 0, pire = '';
      for (const k of Object.keys(a.mur)) {
        const x = a.mur[k].data, y = b.mur[k]?.data;
        if (!y) { d = Infinity; pire = k; continue; }
        for (let i = 0; i < x.length; i += 4) {
          const e = Math.max(Math.abs(x[i + 3] - y[i + 3]),
            ...[0, 1, 2].map(c => Math.abs(x[i + c] * x[i + 3] - y[i + c] * y[i + 3]) / 255));
          if (e > d) { d = e; pire = k; }
        }
        if (k === 'fondColor') for (let i = 3; i < y.length; i += 4) if (y[i]) fond++;
      }
      const same = JSON.stringify(stencils.serialize()) === masks;
      console.log(`VRPAINT_SAVE_CHECK ${same && emptied === 0 && fond > 0 && d <= 1.5 ? 'OK' : 'ECHEC'} caches=${stencils.count()} memes=${same} fond=${fond} ecart8bits=${d.toFixed(2)} (${pire})`);
    } },
  ];

  const input = { pressure: 0, origin: new THREE.Vector3(), dir: new THREE.Vector3(), right: new THREE.Vector3(), up: new THREE.Vector3(), attack: 35 * Math.PI / 180 };
  let i = 0, t = 0, waitUntil = 0, done = false, frames = 0;
  const started = performance.now();
  const next = () => { i++; t = 0; waitUntil = 0; };

  return {
    step() {
      if (done) return null;
      const s = steps[i];
      if (!s) {
        done = true;
        console.log(`VRPAINT_TEST caches steps=${steps.length} frames=${frames} ms=${Math.round(performance.now() - started)}`);
        set({ drips: true, tool: 'bombe' });
        document.title = 'VRPAINT_DONE';
        return null;
      }
      if (s.kind === 'do') {
        // une étape peut être asynchrone (enregistrement, ouverture de projet)
        if (!s.started) {
          s.started = true;
          const r = s.fn();
          if (!r?.then) { next(); return null; }
          r.catch(e => console.log('VRPAINT_TEST erreur ' + (e.stack || e))).finally(() => { s.ok = true; });
        }
        if (s.ok) next();
        return null;
      }
      if (s.kind === 'pause') {
        if (!waitUntil) { waitUntil = performance.now() + 2000; document.title = 'VRPAINT_PAUSE ' + s.name; }
        if (window.__vrpaintResume === s.name || performance.now() > waitUntil) { document.title = 'VRPAINT'; next(); }
        return null;
      }
      if (t === 0) {
        if (s.kind === 'spray') set({ tool: 'bombe', paint: paint(s.paint), cap: s.cap, capScale: 1, angle: 0 });
        else set({ tool: s.tool, angle: s.angle });
        console.log(`VRPAINT_TEST ${s.kind} ${s.paint || s.tool} frames=${frames}`);
      }
      t += 1 / 60;
      const u = Math.min(1, t / s.dur);
      const [px, y] = s.path(u), x = px + ox;
      const a = (s.angle || 0) * Math.PI / 180;
      const d = s.kind === 'spray' ? s.d : 0.05;
      input.origin.copy(f.corner).addScaledVector(f.ex, x).addScaledVector(f.ey, y).addScaledVector(f.n, d);
      input.dir.copy(f.n).negate();
      input.right.copy(f.ex).multiplyScalar(Math.cos(a)).addScaledVector(f.ey, Math.sin(a));
      input.up.copy(f.ey).multiplyScalar(Math.cos(a)).addScaledVector(f.ex, -Math.sin(a));
      input.pressure = t < s.dur ? (s.pressure || 1) : 0;
      if (t >= s.dur + 0.05) next();
      return input;
    },
    after() { frames++; },
  };
}

function halfToFloat(h) {
  const e = (h >> 10) & 31, m = h & 1023, s = h & 32768 ? -1 : 1;
  if (e === 0) return s * m * 2 ** -24;
  if (e === 31) return m ? NaN : s * Infinity;
  return s * (1 + m / 1024) * 2 ** (e - 15);
}
