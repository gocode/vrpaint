import * as THREE from 'three';
import { state, set, subscribe, actions } from './state.js';

const Y = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _h = new THREE.Vector3();
const _f = new THREE.Vector3();

// Manettes Quest (profil xr-standard) :
//   main de la bombe : gâchette = pulvériser / cliquer la palette,
//     joystick ←→ = rotation par crans, ↑↓ = nacelle, A = viseur, B = annuler
//   main de la palette : joystick = se déplacer, X = masquer la palette, Y = jour/nuit
export class XRControls {
  constructor({ renderer, rig, camera, palette, world, audio, wall }) {
    Object.assign(this, { renderer, rig, camera, palette, world, audio, wall });
    this.hands = [0, 1].map(i => {
      const ray = renderer.xr.getController(i);
      const grip = renderer.xr.getControllerGrip(i);
      rig.add(ray, grip);
      const hand = { ray, grip, src: null, prev: [], snap: false, last: new THREE.Vector3(), vel: new THREE.Vector3(), hasLast: false };
      ray.addEventListener('connected', e => { hand.src = e.data; this.assign(); });
      ray.addEventListener('disconnected', () => { hand.src = null; hand.hasLast = false; this.assign(); });
      return hand;
    });
    this.mode = 'idle';
    this.lastShake = 0;
    this.input = { pressure: 0, origin: new THREE.Vector3(), dir: new THREE.Vector3(), right: new THREE.Vector3(), up: new THREE.Vector3() };
    const lg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
    this.laser = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 }));
    this.laser.visible = false;
    subscribe(patch => { if ('leftHanded' in patch) this.assign(); });
  }

  assign() {
    const side = state.leftHanded ? 'left' : 'right';
    const withPad = this.hands.filter(h => h.src && h.src.gamepad);
    this.canHand = withPad.find(h => h.src.handedness === side) || null;
    this.palHand = withPad.find(h => h !== this.canHand) || null;
    if (!this.renderer.xr.isPresenting) return;
    const can = this.world.can;
    if (this.canHand) {
      this.canHand.ray.add(can);
      can.position.set(0, 0, 0);
      can.quaternion.identity();
      this.canHand.ray.add(this.laser);
    }
    if (this.palHand) this.palHand.grip.add(this.palette.mesh);
    else this.palette.mesh.removeFromParent();
  }

  start() {
    this.mode = 'idle';
    this.assign();
  }

  end() {
    this.palette.mesh.removeFromParent();
    this.laser.removeFromParent();
    this.world.scene.add(this.world.can);
  }

  edge(hand, i) {
    const b = hand.src.gamepad.buttons[i];
    const down = !!(b && b.pressed);
    const was = hand.prev[i];
    hand.prev[i] = down;
    return down && !was;
  }

  turn(angle) {
    const rig = this.rig;
    this.camera.getWorldPosition(_h);
    _h.y = rig.position.y;
    rig.position.sub(_h).applyAxisAngle(Y, angle).add(_h);
    rig.rotation.y += angle;
  }

  move(x, y, dt) {
    this.camera.getWorldDirection(_f);
    _f.y = 0;
    if (_f.lengthSq() < 1e-4) return;
    _f.normalize();
    _v.crossVectors(_f, Y);
    this.rig.position.addScaledVector(_f, -y * 1.4 * dt).addScaledVector(_v, x * 1.4 * dt);
    // ne pas traverser le mur
    this.camera.getWorldPosition(_h);
    const limit = this.wall.z + 0.18;
    if (_h.z < limit && _h.x > -this.wall.width / 2 - 0.3 && _h.x < this.wall.width / 2 + 0.3) this.rig.position.z += limit - _h.z;
  }

  update(dt) {
    const rig = this.rig, pal = this.palHand, can = this.canHand;
    rig.updateMatrixWorld(true);

    if (pal) {
      const ax = pal.src.gamepad.axes;
      const x = ax[2] || 0, y = ax[3] || 0;
      if (Math.hypot(x, y) > 0.15) this.move(x, y, dt);
      if (this.edge(pal, 4)) this.palette.mesh.visible = !this.palette.mesh.visible;
      if (this.edge(pal, 5)) set({ night: !state.night });
    }
    if (!can) { this.laser.visible = false; return null; }

    const gp = can.src.gamepad;
    const sx = gp.axes[2] || 0, sy = gp.axes[3] || 0;
    if (Math.abs(sx) > 0.7 && !can.snap) { can.snap = true; this.turn(-Math.sign(sx) * Math.PI / 6); }
    else if (Math.abs(sx) < 0.3) can.snap = false;
    if (Math.abs(sy) > 0.2 && Math.abs(sx) < 0.5) {
      rig.position.y = THREE.MathUtils.clamp(rig.position.y - sy * 0.8 * dt, 0, Math.max(1, this.wall.height - 1.2));
    }
    if (this.edge(can, 4)) set({ aim: !state.aim });
    if (this.edge(can, 5)) actions.undo();

    rig.updateMatrixWorld(true);
    const inp = this.input;
    can.ray.matrixWorld.decompose(inp.origin, _q, _v);
    inp.dir.set(0, 0, -1).applyQuaternion(_q);
    inp.right.set(1, 0, 0).applyQuaternion(_q);
    inp.up.set(0, 1, 0).applyQuaternion(_q);

    // secouer la bombe : cliquetis de la bille
    if (can.hasLast && dt > 0) {
      _v.subVectors(inp.origin, can.last).divideScalar(dt);
      const acc = _v.distanceTo(can.vel) / dt;
      can.vel.copy(_v);
      const now = performance.now();
      if (acc > 40 && now - this.lastShake > 110) { this.lastShake = now; this.audio.rattle(); }
    }
    can.last.copy(inp.origin);
    can.hasLast = true;

    const trig = gp.buttons[0]?.value || 0;
    const pressed = trig > 0.08;
    const uiHit = this.mode !== 'spray' && pal ? this.palette.raycast(inp.origin, inp.dir) : null;
    if (pressed && this.mode === 'idle') {
      this.mode = uiHit ? 'ui' : 'spray';
      if (uiHit) this.palette.press(uiHit);
    } else if (pressed && this.mode === 'ui' && uiHit) {
      this.palette.drag(uiHit);
    } else if (!pressed) {
      this.mode = 'idle';
    }
    this.palette.setHover(uiHit);
    this.laser.visible = !!uiHit;
    if (uiHit) this.laser.scale.z = uiHit.distance;

    if (this.mode === 'ui') return null;
    inp.pressure = this.mode === 'spray' ? trig : 0;
    if (inp.pressure > 0.05) gp.hapticActuators?.[0]?.pulse?.(0.05 + 0.15 * inp.pressure, 30);
    return inp;
  }
}
