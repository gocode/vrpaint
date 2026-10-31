import * as THREE from 'three';
import { state, set, actions } from './state.js';
import { CAPS } from './spray.js';

const _f = new THREE.Vector3();
const _r = new THREE.Vector3();

// Mode souris / écran tactile. La bombe est tenue perpendiculaire au mur, à
// state.distance de la surface visée par le pointeur.
export class DesktopControls {
  constructor({ camera, rig, canvas, world, audio, wall, canvases }) {
    Object.assign(this, { camera, rig, canvas, world, audio, wall, canvases });
    this.ndc = new THREE.Vector2();
    this.hasPointer = false;
    this.down = false;
    this.shift = false;
    this.look = null;
    this.keys = new Set();
    this.raycaster = new THREE.Raycaster();
    this.input = { pressure: 0, origin: new THREE.Vector3(), dir: new THREE.Vector3(), right: new THREE.Vector3(), up: new THREE.Vector3() };
    this.reset();

    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('pointermove', e => this._pointer(e));
    canvas.addEventListener('pointerdown', e => {
      this.audio.ensure();
      this._pointer(e);
      canvas.setPointerCapture(e.pointerId);
      if (e.button === 0) this.down = true;
      else if (e.button === 2 || e.button === 1) this.look = { x: e.clientX, y: e.clientY };
    });
    const up = e => {
      if (e.button === 0) this.down = false;
      if (e.button === 2 || e.button === 1) this.look = null;
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', () => { this.down = false; this.look = null; });
    canvas.addEventListener('pointerleave', e => { if (!this.down && !this.look) this.hasPointer = false; this.shift = e.shiftKey; });
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const d = e.deltaY || e.deltaX;
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
      this.keys.add(e.code);
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    });
    addEventListener('keyup', e => { this.keys.delete(e.code); this.shift = e.shiftKey; });
    addEventListener('blur', () => { this.keys.clear(); this.down = false; this.look = null; });
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
      best = { t, point: p, frame: f };
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
    const k = this.keys, rig = this.rig;
    const fwd = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const side = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const lift = (k.has('KeyE') || k.has('Space') ? 1 : 0) - (k.has('KeyQ') ? 1 : 0);
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

    if (!this.hasPointer) return null;
    rig.updateMatrixWorld(true);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const hit = this.pick(this.raycaster.ray);
    if (!hit) return null;
    const f = hit.frame, inp = this.input;
    const a = state.angle * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
    inp.origin.copy(hit.point).addScaledVector(f.n, state.distance);
    inp.dir.copy(f.n).negate();
    inp.right.copy(f.ex).multiplyScalar(ca).addScaledVector(f.ey, sa);
    inp.up.copy(f.ey).multiplyScalar(ca).addScaledVector(f.ex, -sa);
    inp.pressure = this.down ? (this.shift ? 0.35 : state.pressure) : 0;

    // bombe affichée à sa position réelle, buse vers le mur
    const can = this.world.can;
    can.position.copy(inp.origin);
    can.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(inp.right, inp.up, f.n));
    return inp;
  }
}
