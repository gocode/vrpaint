import * as THREE from 'three';
import { state, set, subscribe, actions, setTool } from './state.js';
import { scraperById } from './scraper.js';
import { brushById, brushSize, brushReach } from './brush.js';
import { NEWSPAPER } from './newspaper.js';

const Y = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _h = new THREE.Vector3();
const _f = new THREE.Vector3();

// Manettes Quest (profil xr-standard) :
//   main de la bombe : gâchette = pulvériser / cliquer la palette,
//     joystick ←→ = rotation par crans, ↑↓ = nacelle, A = viseur, B = annuler,
//     gâchette latérale = passer de la bombe au dernier autre outil et retour
//   caches : gâchette sur le mur = poser (on le place avant de lâcher), sur un
//     cache = l'attraper ; tourner le poignet = le tourner ; joystick ↑↓ en le
//     visant = taille ; A = retirer le cache visé
//   racloirs : la lame racle quand elle touche le mur ; l'enfoncer (ou la
//     gâchette) appuie plus fort ; vibrations selon la pression et la vitesse
//   pinceaux, papier journal : de même au contact (poils pliés, boule écrasée)
//   main de la palette : joystick = se déplacer, X = masquer la palette, Y = jour/nuit
export class XRControls {
  constructor({ renderer, rig, camera, palette, world, audio, wall, tools }) {
    Object.assign(this, { renderer, rig, camera, palette, world, audio, wall, tools });
    this.maskGrab = null;
    this.maskHover = null;
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
      for (const m of this.tools.scraper.meshes.values()) {
        this.canHand.ray.add(m);
        m.position.set(0, 0, 0);
        m.quaternion.identity();
      }
      for (const m of this._contactMeshes()) {
        this.canHand.ray.add(m);
        m.position.set(0, 0, 0);
        m.quaternion.identity();
      }
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
    for (const m of this.tools.scraper.meshes.values()) this.world.scene.add(m);
    for (const m of this._contactMeshes()) this.world.scene.add(m);
    this._dropMask();
  }

  _dropMask() {
    if (this.maskGrab) this.tools.stencils.commit();
    this.maskGrab = null;
    this.tools.stencils.showGhost(null);
    this.tools.stencils.setHover(null);
    this.maskHover = null;
  }

  // Rotation du poignet autour du rayon, ramenée dans le plan de la toile
  _roll(frame, up) {
    return Math.atan2(-up.dot(frame.ex), up.dot(frame.ey));
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
    const masking = state.tool === 'cache';
    const sized = masking && (this.maskGrab || this.maskHover);
    if (Math.abs(sy) > 0.2 && Math.abs(sx) < 0.5) {
      if (sized) {
        const h = this.maskGrab || this.maskHover;
        this.tools.stencils.resize(h.canvas, h.mask, Math.exp(-sy * 1.2 * dt));
      } else {
        rig.position.y = THREE.MathUtils.clamp(rig.position.y - sy * 0.8 * dt, 0, Math.max(1, this.wall.height - 1.2));
      }
    }
    if (this.edge(can, 4)) {
      if (masking && this.maskHover && !this.maskGrab) {
        this.tools.stencils.remove(this.maskHover.canvas, this.maskHover.mask);
        this.maskHover = null;
        this.pulse(gp, 0.3, 30);
      } else set({ aim: !state.aim });
    }
    if (this.edge(can, 5)) actions.undo();
    if (this.edge(can, 1)) setTool(state.tool === 'bombe' ? state.lastTool || 'cache' : 'bombe');
    if (!masking && (this.maskGrab || this.maskHover)) this._dropMask();

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
    const uiHit = this.mode !== 'spray' && this.mode !== 'mask' && pal ? this.palette.raycast(inp.origin, inp.dir) : null;
    let pressEdge = false;
    if (pressed && this.mode === 'idle') {
      this.mode = uiHit ? 'ui' : masking ? 'mask' : 'spray';
      if (uiHit) this.palette.press(uiHit);
      else pressEdge = true;
    } else if (pressed && this.mode === 'ui' && uiHit) {
      this.palette.drag(uiHit);
    } else if (!pressed) {
      this.mode = 'idle';
    }
    this.palette.setHover(uiHit);
    this.laser.visible = !!uiHit;
    if (uiHit) this.laser.scale.z = uiHit.distance;

    if (masking) {
      this._maskMode(gp, inp, pressEdge && !uiHit, this.mode === 'mask', !!uiHit);
      return null;
    }
    if (this.mode === 'ui') return null;
    const tool = scraperById(state.tool);
    if (tool) return this._scraperMode(gp, inp, tool, this.mode === 'spray' ? trig : 0);
    if (brushById(state.tool) || state.tool === NEWSPAPER.id) return this._contactMode(gp, inp, this.mode === 'spray' ? trig : 0);
    inp.reach = 0;
    inp.pressure = this.mode === 'spray' ? trig : 0;
    if (inp.pressure > 0.05) this.pulse(gp, 0.05 + 0.15 * inp.pressure, 30);
    return inp;
  }

  pulse(gp, intensity, ms) {
    gp.hapticActuators?.[0]?.pulse?.(Math.min(1, intensity), ms);
  }

  // Caches : visée au rayon, pose / prise à la gâchette, rotation du poignet
  _maskMode(gp, inp, pressEdge, holding, onUI) {
    const S = this.tools.stencils, spray = this.tools.spray;
    const g = this.maskGrab;
    if (g) {
      if (!holding) { S.commit(); this.maskGrab = null; this.pulse(gp, 0.35, 25); }
      else {
        const h = spray.projectOn(g.canvas, inp.origin, inp.dir, inp.right, inp.up);
        if (h) {
          const rot = this._roll(g.canvas.frame, inp.up) + g.drot;
          S.move(g.canvas, g.mask, h.x + g.dx, h.y + g.dy, rot);
          this.laser.visible = true;
          this.laser.scale.z = h.t;
        }
      }
      S.showGhost(null);
      return;
    }
    const hit = onUI ? null : spray.project(inp.origin, inp.dir, inp.right, inp.up);
    const over = hit ? S.pick(hit.canvas, hit.x, hit.y) : null;
    S.setHover(over);
    this.maskHover = over ? { canvas: hit.canvas, mask: over } : null;
    if (hit) {
      this.laser.visible = true;
      this.laser.scale.z = hit.t;
    }
    const roll = hit ? this._roll(hit.canvas.frame, inp.up) : 0;
    if (pressEdge && hit) {
      let m = over;
      if (m) S.begin('déplacement du cache', m);
      else m = S.add(hit.canvas, { shape: state.maskShape, x: hit.x, y: hit.y, r: state.maskSize, rot: roll, lift: state.maskLift });
      if (m) {
        this.maskGrab = { canvas: hit.canvas, mask: m, dx: m.x - hit.x, dy: m.y - hit.y, drot: m.rot - roll };
        this.pulse(gp, 0.5, 30);
      } else {
        this.palette.flash('16 caches au plus par surface');
      }
      S.showGhost(null);
      return;
    }
    S.showGhost(!over && hit ? hit.canvas : null,
      hit && { shape: state.maskShape, x: hit.x, y: hit.y, r: state.maskSize, rot: roll, lift: state.maskLift });
  }

  _contactMeshes() {
    return [...this.tools.brush.meshes.values(), this.tools.newspaper.mesh];
  }

  // Pinceaux et papier journal : comme les racloirs, au contact du mur. Les
  // poils (la boule de papier) reculent dans la main au lieu de traverser.
  _contactMode(gp, inp, trig) {
    const br = brushById(state.tool);
    const sim = br ? this.tools.brush : this.tools.newspaper;
    const reach = br ? brushReach(br, brushSize(br, state.brushSizes)) : NEWSPAPER.reach;
    inp.reach = reach;
    inp.trigger = trig;
    inp.pressure = 0;
    const h = this.tools.spray.project(inp.origin, inp.dir, inp.right, inp.up);
    const mesh = br ? sim.meshes.get(br.id) : sim.mesh;
    mesh.position.set(0, 0, h ? THREE.MathUtils.clamp(reach - h.t, 0, 0.1) : 0);
    // vibrations : le pinceau frôle (doux, continu) ; le papier crisse à l'appui
    if (sim.contact) {
      const v = Math.min(1, sim.speed / 0.3);
      if (performance.now() - (sim.touched || 0) < 40) this.pulse(gp, br ? 0.25 : 0.5, 18);
      else if (br) this.pulse(gp, (0.04 + 0.2 * sim.pressure) * (0.4 + 0.6 * v), 25);
      else this.pulse(gp, (0.05 + 0.35 * sim.pressure) * (0.2 + 0.8 * v) * (0.6 + 0.8 * Math.random()), 25);
    }
    return inp;
  }

  // Racloirs : la pression vient de l'enfoncement de la lame dans le mur
  _scraperMode(gp, inp, tool, trig) {
    const sc = this.tools.scraper;
    inp.reach = tool.reach;
    inp.trigger = trig;
    inp.pressure = 0;
    // la lame ne traverse pas le mur : l'outil recule dans la main
    const h = this.tools.spray.project(inp.origin, inp.dir, inp.right, inp.up);
    const mesh = sc.meshes.get(tool.id);
    mesh.position.set(0, 0, h ? THREE.MathUtils.clamp(tool.reach - h.t, 0, 0.12) : 0);
    // vibrations : choc au contact, puis grain du raclage (pression × vitesse)
    if (sc.contact) {
      const now = performance.now();
      if (now - (sc.touched || 0) < 40) this.pulse(gp, 0.7, 18);
      else {
        const v = Math.min(1, sc.speed / 0.3);
        this.pulse(gp, (0.08 + 0.6 * sc.pressure) * (0.3 + 0.7 * v) * (0.7 + 0.6 * Math.random()), 25);
      }
    }
    return inp;
  }
}
