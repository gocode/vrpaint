import * as THREE from 'three';
import { state, set, actions, setTool, pressedTool } from './state.js';
import { CAPS } from './spray.js';
import { SCRAPERS, scraperById } from './scraper.js';
import { BRUSHES, brushById, brushSize, brushReach } from './brush.js';
import { NEWSPAPER } from './newspaper.js';
import { MASK_SIZE } from './stencils.js';
import { TouchControls } from './touch.js';

const _f = new THREE.Vector3();
const _r = new THREE.Vector3();
const _d = new THREE.Vector3();
const _m4 = new THREE.Matrix4();
const DEG = Math.PI / 180;
const ATTACK = 35 * DEG;   // angle de la lame sur le mur en mode souris
const TILT = 30 * DEG;     // pinceau : manche incliné vers le bas, pour qu'on le voie

// Mode souris / écran tactile. La bombe est tenue perpendiculaire au mur, à
// state.distance de la surface visée par le pointeur. Avec les caches, un clic
// pose (ou attrape) un cache ; avec un racloir, on racle en glissant.
// Les doigts passent par TouchControls (touch.js), la souris et le stylet ici.
export class DesktopControls {
  constructor({ camera, rig, canvas, world, audio, wall, canvases, tools }) {
    Object.assign(this, { camera, rig, canvas, world, audio, wall, canvases, tools });
    this.pressEdge = false;
    this.grab = null;
    this.hoverMask = null;
    this.ndc = new THREE.Vector2();
    this.hasPointer = false;
    this.down = false;
    this.shift = false;
    this.look = null;
    this.keys = new Set();
    this.raycaster = new THREE.Raycaster();
    this.input = { pressure: 0, origin: new THREE.Vector3(), dir: new THREE.Vector3(), right: new THREE.Vector3(), up: new THREE.Vector3() };
    this.reset();
    this.touch = new TouchControls(this);
    const finger = e => e.pointerType === 'touch';

    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('pointermove', e => { if (finger(e)) this.touch.move(e); else this._pointer(e); });
    canvas.addEventListener('pointerdown', e => {
      this.audio.ensure();
      if (finger(e)) { canvas.setPointerCapture(e.pointerId); this.touch.down(e); return; }
      this._pointer(e);
      canvas.setPointerCapture(e.pointerId);
      if (e.button === 0) { this.down = true; this.pressEdge = true; }
      else if (e.button === 2 || e.button === 1) this.look = { x: e.clientX, y: e.clientY };
    });
    const up = e => {
      if (finger(e)) { this.touch.up(e); return; }
      if (e.button === 0) this.down = false;
      if (e.button === 2 || e.button === 1) this.look = null;
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', e => { if (finger(e)) { this.touch.up(e); return; } this.down = false; this.look = null; });
    canvas.addEventListener('pointerleave', e => { if (finger(e)) return; if (!this.down && !this.look) this.hasPointer = false; this.shift = e.shiftKey; });
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const d = e.deltaY || e.deltaX;
      if (state.tool === 'cache') { this._wheelMask(d, e.shiftKey); return; }
      if (pressedTool(state.tool) && !e.shiftKey) {
        set({ pressure: THREE.MathUtils.clamp(Math.round(state.pressure * 20 - Math.sign(d)) / 20, 0.1, 1) });
        return;
      }
      if (e.shiftKey) {
        set({ angle: THREE.MathUtils.clamp(Math.round(state.angle - Math.sign(d) * 5), -90, 90) });
      } else {
        set({ distance: THREE.MathUtils.clamp(+(state.distance * Math.exp(d * 0.0012)).toFixed(3), 0.02, 0.8) });
      }
    }, { passive: false });

    addEventListener('keydown', e => {
      if (e.target.closest?.('input, select, textarea')) return;
      this.shift = e.shiftKey;
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); actions.undo(); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const digit = /^Digit([1-5])$/.exec(e.code);
      if (digit) { set({ cap: CAPS[+digit[1] - 1].id, capScale: 1 }); return; }
      if (k === 'n') set({ night: !state.night });
      else if (k === 'v') set({ aim: !state.aim });
      else if (k === 'c') set({ drips: !state.drips });
      else if (k === 'x') { this.audio.ensure(); this.audio.rattle(); }
      else if (k === 'b') setTool('bombe');
      else if (k === 'm') setTool('cache');
      else if (k === 'p') setTool(state.tool === BRUSHES[0].id ? BRUSHES[1].id : BRUSHES[0].id);
      else if (k === 'j') setTool(NEWSPAPER.id);
      else if (k === 'r') {
        const i = SCRAPERS.findIndex(t => t.id === state.tool);
        setTool(SCRAPERS[(i + 1) % SCRAPERS.length].id);
      }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && this.hoverMask) {
        this.tools.stencils.remove(this.hoverMask.canvas, this.hoverMask.mask);
        this.hoverMask = null;
      }
      this.keys.add(e.code);
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    });
    addEventListener('keyup', e => { this.keys.delete(e.code); this.shift = e.shiftKey; });
    addEventListener('blur', () => { this.keys.clear(); this.down = false; this.look = null; this.touch.reset(); });
  }

  reset() {
    this.yaw = 0;
    this.pitch = -0.1;
    // recul suffisant pour voir tout le mur (champ vertical 60°)
    this.rig.position.set(0, 0, this.wall.z + Math.min(11, Math.max(3.8, this.wall.width * 0.72, this.wall.height * 1.3)));
    this.rig.rotation.set(0, 0, 0);
    this.camera.position.set(0, 1.55, 0);
    this.camera.rotation.set(this.pitch, 0, 0);
  }

  // Surface peignable sous un point de l'écran (coordonnées normalisées)
  hitAt(ndc) {
    this.rig.updateMatrixWorld(true);
    this.raycaster.setFromCamera(ndc, this.camera);
    return this.pick(this.raycaster.ray);
  }

  // Surface peignable la plus proche sous le pointeur (mur ou devanture)
  pick(ray) {
    let best = null;
    for (const c of this.canvases()) {
      const f = c.frame, denom = ray.direction.dot(f.n);
      if (denom > -0.05) continue;
      const t = _r.subVectors(f.corner, ray.origin).dot(f.n) / denom;
      if (t <= 0 || (best && t >= best.t)) continue;
      const p = ray.origin.clone().addScaledVector(ray.direction, t);
      _f.subVectors(p, f.corner);
      const x = _f.dot(f.ex), y = _f.dot(f.ey);
      if (x < 0 || y < 0 || x > c.width || y > c.height) continue;
      best = { t, point: p, frame: f, canvas: c, x, y };
    }
    return best;
  }

  _pointer(e) {
    const r = this.canvas.getBoundingClientRect();
    if (this.look) {
      this.yaw -= (e.clientX - this.look.x) * 0.004;
      this.pitch = THREE.MathUtils.clamp(this.pitch - (e.clientY - this.look.y) * 0.004, -1.3, 1.3);
      this.look = { x: e.clientX, y: e.clientY };
    }
    this.ndc.set((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.hasPointer = true;
    this.shift = e.shiftKey;
  }

  update(dt) {
    const k = this.keys, rig = this.rig, pad = this.touch.pad, clamp = THREE.MathUtils.clamp;
    this.touch.update();
    // clavier et croix tactile s'additionnent
    const fwd = clamp((k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) + pad.fwd, -1, 1);
    const side = clamp((k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0) + pad.side, -1, 1);
    const lift = clamp((k.has('KeyE') || k.has('Space') ? 1 : 0) - (k.has('KeyQ') ? 1 : 0) + pad.lift, -1, 1);
    rig.rotation.y = this.yaw;
    this.camera.rotation.set(this.pitch, 0, 0);
    if (fwd || side) {
      _f.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      _r.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      rig.position.addScaledVector(_f, fwd * 1.8 * dt).addScaledVector(_r, side * 1.8 * dt);
    }
    if (lift) rig.position.y = THREE.MathUtils.clamp(rig.position.y + lift * 1.0 * dt, 0, Math.max(1, this.wall.height - 1.2));
    rig.position.z = THREE.MathUtils.clamp(rig.position.z, this.wall.z + 0.3, this.wall.z + 14);
    rig.position.x = THREE.MathUtils.clamp(rig.position.x, -this.wall.width / 2 - 10, this.wall.width / 2 + 10);

    const press = this.pressEdge;
    this.pressEdge = false;
    let hit = null;
    if (this.hasPointer) hit = this.hitAt(this.ndc);
    if (state.tool === 'cache') { this._maskTool(hit, press); return null; }
    this._maskTool(null, false);
    if (!hit) return null;
    const f = hit.frame, inp = this.input;
    const a = state.angle * DEG, ca = Math.cos(a), sa = Math.sin(a);
    inp.origin.copy(hit.point).addScaledVector(f.n, state.distance);
    inp.dir.copy(f.n).negate();
    inp.right.copy(f.ex).multiplyScalar(ca).addScaledVector(f.ey, sa);
    inp.up.copy(f.ey).multiplyScalar(ca).addScaledVector(f.ex, -sa);
    inp.pressure = this.down ? (this.shift ? 0.35 : state.pressure) : 0;

    const tool = scraperById(state.tool);
    if (tool) {
      // racloir : lame couchée à 35° sur le mur, fil sur le point visé, manche vers le haut
      inp.attack = ATTACK;
      inp.origin.copy(hit.point).addScaledVector(f.n, 0.05);
      const mesh = this.tools.scraper.meshes.get(tool.id);
      _d.crossVectors(f.n, inp.right).negate();
      _f.copy(f.n).multiplyScalar(-Math.sin(ATTACK)).addScaledVector(_d, Math.cos(ATTACK));   // vers la pointe
      _r.copy(_f).negate().cross(inp.right);
      _m4.makeBasis(inp.right, _r, _f.clone().negate());
      mesh.quaternion.setFromRotationMatrix(_m4);
      mesh.position.copy(hit.point).addScaledVector(_f, -tool.reach).addScaledVector(f.n, 0.002);
      return inp;
    }
    inp.attack = undefined;
    const br = brushById(state.tool);
    if (br || state.tool === NEWSPAPER.id) {
      // pinceau tenu presque droit, poils sur le point visé ; papier plaqué sur le mur
      inp.origin.copy(hit.point).addScaledVector(f.n, 0.05);
      _f.copy(f.n).multiplyScalar(Math.cos(TILT)).addScaledVector(inp.up, -Math.sin(TILT));   // vers la main
      _r.crossVectors(_f, inp.right);
      const mesh = br ? this.tools.brush.meshes.get(br.id) : this.tools.newspaper.mesh;
      mesh.quaternion.setFromRotationMatrix(_m4.makeBasis(inp.right, _r, _f));
      const reach = br ? brushReach(br, brushSize(br, state.brushSizes)) : NEWSPAPER.reach - NEWSPAPER.radius * 0.3;
      mesh.position.copy(hit.point).addScaledVector(_f, reach);
      return inp;
    }

    // bombe affichée à sa position réelle, buse vers le mur
    const can = this.world.can;
    can.position.copy(inp.origin);
    can.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(inp.right, inp.up, f.n));
    return inp;
  }

  // Caches : clic sur un cache = l'attraper et le glisser ; clic ailleurs =
  // en poser un (forme et taille choisies), qu'on peut placer avant de lâcher.
  _maskTool(hit, press) {
    const S = this.tools.stencils;
    if (this.grab) {
      const g = this.grab;
      if (!this.down || state.tool !== 'cache') { S.commit(); this.grab = null; }
      else if (hit && hit.canvas === g.canvas) S.move(g.canvas, g.mask, hit.x + g.dx, hit.y + g.dy);
      S.showGhost(null);
      return;
    }
    const over = hit ? S.pick(hit.canvas, hit.x, hit.y) : null;
    S.setHover(over);
    this.hoverMask = over ? { canvas: hit.canvas, mask: over } : null;
    if (press && hit) {
      if (over) {
        S.begin('déplacement du cache', over);
        this.grab = { canvas: hit.canvas, mask: over, dx: over.x - hit.x, dy: over.y - hit.y };
      } else {
        const m = S.add(hit.canvas, this._spec(hit));
        if (m) this.grab = { canvas: hit.canvas, mask: m, dx: 0, dy: 0 };
        else actions.notify?.('16 caches au plus par surface');
      }
      S.showGhost(null);
      return;
    }
    S.showGhost(!over && hit ? hit.canvas : null, hit && this._spec(hit));
  }

  _spec(hit) {
    return { shape: state.maskShape, x: hit.x, y: hit.y, r: state.maskSize, rot: state.angle * DEG, lift: state.maskLift };
  }

  // Molette sur un cache : taille (Maj : rotation) ; ailleurs : réglage du prochain cache.
  _wheelMask(d, shift) {
    const S = this.tools.stencils, h = this.hoverMask || (this.grab && { canvas: this.grab.canvas, mask: this.grab.mask });
    if (h) {
      if (shift) S.rotate(h.canvas, h.mask, -Math.sign(d) * 5 * DEG);
      else S.resize(h.canvas, h.mask, Math.exp(-d * 0.0012));
    } else if (shift) {
      set({ angle: THREE.MathUtils.clamp(Math.round(state.angle - Math.sign(d) * 5), -90, 90) });
    } else {
      set({ maskSize: THREE.MathUtils.clamp(+(state.maskSize * Math.exp(-d * 0.0012)).toFixed(3), ...MASK_SIZE) });
    }
  }
}
