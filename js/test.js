import * as THREE from 'three';

// Peinture scriptée pour vérifier le moteur sans casque : index.html?test
// (?test=night pour finir en mode nuit). Chaque trait est rejoué image par image.
export function runTest({ set, state, PAINTS, world, WALL, params, readWall }) {
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
    set({ paint: paint(s.paint), cap: s.cap, capScale: 1, angle: s.angle || 0 });
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
