import * as THREE from 'three';
import { state, set, currentCap, CAP_SCALE, pressedTool } from './state.js';
import { strokeWidthCm } from './spray.js';
import { MASK_SIZE } from './stencils.js';

const DEG = Math.PI / 180;
const HOLD_MS = 120;     // un doigt seul ne peint qu'après ce délai (ou dès qu'il glisse)…
const HOLD_PX = 10;      // …pour qu'un deuxième doigt posé juste après ne laisse aucune trace
const DRAG_PX = 18;      // deux doigts : glisser si le milieu bouge d'abord de tant de pixels…
const PINCH_PX = 22;     // …pincer si l'écart change d'abord de tant (ou s'ils tournent de TWIST)
const TWIST = 12 * DEG;
const PAD_DEAD = 0.2;    // zone morte au centre de la croix
const clamp = THREE.MathUtils.clamp;
const round = (v, step) => Math.round(v / step) * step;

// Écran tactile : un doigt peint (ou pose/racle selon l'outil), deux doigts
// regardent autour (ou glissent le long du mur), pincer règle la largeur de
// l'outil (ou avance), la croix à l'écran déplace et la paire ⤒ ⤓ monte la
// nacelle. La souris et le clavier ne passent pas par ici.
export class TouchControls {
  constructor(desktop) {
    this.d = desktop;
    this.fingers = new Map();      // pointerId → { x, y }
    this.mode = null;              // null | 'wait' | 'paint' | 'gesture' | 'void'
    this.timer = 0;
    this.start = null;             // doigt peintre : position et heure du contact
    this.hold = false;             // image suivante : peindre au point de contact
    this.pending = null;           // position où reprendre ensuite
    this.releaseAt = 0;            // tape brève : relâcher la gâchette à cette heure
    this.g = null;                 // geste à deux doigts en cours
    this.pad = { fwd: 0, side: 0, lift: 0 };
    this._buildPad();
    this.bubble = document.createElement('div');
    this.bubble.id = 'touch-bubble';
    document.body.append(this.bubble);
    if (matchMedia('(pointer: coarse)').matches) document.body.classList.add('touch');
    // Safari : pas de zoom de page au pincement
    document.addEventListener('gesturestart', e => e.preventDefault());
  }

  // --- Doigts sur la scène ---------------------------------------------------

  down(e) {
    document.body.classList.add('touch');
    this.fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    // panneau ouvert sur petit écran : toucher la scène le referme, sans peindre
    if (this.fingers.size === 1 && document.body.classList.contains('panel-open') && innerWidth <= 760) {
      document.body.classList.remove('panel-open');
      this.mode = 'void';
      return;
    }
    if (this.mode === 'void') return;
    if (this.fingers.size === 1) {
      if (this.releaseAt) { this.releaseAt = 0; this.d.down = false; }
      this.mode = 'wait';
      this.start = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() };
      this._setNdc(e.clientX, e.clientY);
      this.d.hasPointer = true;
      this.timer = setTimeout(() => this._paint(), HOLD_MS);
      return;
    }
    // deuxième doigt : la peinture n'a pas commencé (ou s'arrête) et le geste démarre
    clearTimeout(this.timer);
    this.d.down = false;
    this.releaseAt = 0;
    this.mode = 'gesture';
    this._gestureBegin();
  }

  move(e) {
    const f = this.fingers.get(e.pointerId);
    if (!f) return;
    f.x = e.clientX; f.y = e.clientY;
    if (this.mode === 'wait') {
      if (Math.hypot(f.x - this.start.x, f.y - this.start.y) > HOLD_PX) this._paint();
    } else if (this.mode === 'paint' && e.pointerId === this.start.id) {
      if (this.hold) this.pending = { x: f.x, y: f.y };
      else { this.pending = null; this._setNdc(f.x, f.y); }
    } else if (this.mode === 'gesture' && this.g) {
      this._gestureMove();
    }
  }

  up(e) {
    if (!this.fingers.delete(e.pointerId)) return;
    if (this.mode === 'wait') {
      // tape brève : un point de peinture (ou un cache posé), aussi long que la tape
      this._paint();
      this.releaseAt = performance.now() + (performance.now() - this.start.t);
    } else if (this.mode === 'paint' && e.pointerId === this.start.id) {
      this.d.down = false;
    } else if (this.mode === 'gesture') {
      if (this.fingers.size >= 2) this._gestureBegin();
      else this._gestureEnd();
    }
    if (!this.fingers.size) {
      if (this.mode !== 'wait' && !this.releaseAt) this.d.hasPointer = false;
      this.mode = null;
    }
  }

  reset() {
    clearTimeout(this.timer);
    this.fingers.clear();
    this.mode = null;
    this.hold = false;
    this.pending = null;
    this.releaseAt = 0;
    this._gestureEnd();
    this.pad.fwd = this.pad.side = this.pad.lift = 0;
    this.padEl.querySelectorAll('.on').forEach(b => b.classList.remove('on'));
  }

  // À chaque image, avant le lancer de rayon de DesktopControls.update.
  update() {
    const fresh = this.hold;   // première image du trait : elle peint au point de contact
    this.hold = false;
    if (this.pending && !fresh) { this._setNdc(this.pending.x, this.pending.y); this.pending = null; }
    if (this.releaseAt && !fresh && performance.now() >= this.releaseAt) {
      this.releaseAt = 0;
      this.d.down = false;
      if (!this.fingers.size) this.d.hasPointer = false;
    }
  }

  _setNdc(x, y) {
    const r = this.d.canvas.getBoundingClientRect();
    this.d.ndc.set((x - r.left) / r.width * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
  }

  // Le doigt seul devient le pinceau. La première image peint au point de
  // contact, la suivante rejoint le doigt : le trait part bien de là où il s'est posé.
  _paint() {
    clearTimeout(this.timer);
    if (this.mode !== 'wait') return;
    this.mode = 'paint';
    const f = this.fingers.get(this.start.id);
    this._setNdc(this.start.x, this.start.y);
    this.hold = true;
    this.pending = f && (f.x !== this.start.x || f.y !== this.start.y) ? { x: f.x, y: f.y } : null;
    this.d.down = true;
    this.d.pressEdge = true;
  }

  // --- Geste à deux doigts -----------------------------------------------------

  _pair() {
    const [a, b] = this.fingers.values();
    return {
      x: (a.x + b.x) / 2, y: (a.y + b.y) / 2,
      dist: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
      ang: Math.atan2(b.y - a.y, b.x - a.x),
    };
  }

  // (Re)prend la référence du geste : au deuxième doigt, ou quand un doigt
  // s'ajoute ou se retire, pour que la vue ne saute pas.
  _gestureBegin() {
    const p = this._pair();
    if (this.g) Object.assign(this.g, { last: p, origin: { ...p, scale: this.g.scale } });
    else this.g = { kind: null, last: p, origin: { ...p, scale: 1 }, scale: 1 };
    this._setNdc(p.x, p.y);
    this.d.hasPointer = true;
  }

  _gestureMove() {
    const g = this.g, p = this._pair(), o = g.origin;
    if (!g.kind) {
      // on décide une fois pour toutes : glisser ou pincer, pour qu'un glisser
      // à deux doigts ne change pas la largeur du jet en passant
      const moved = Math.hypot(p.x - o.x, p.y - o.y);
      const spread = Math.abs(p.dist - o.dist);
      const twist = Math.abs(Math.atan2(Math.sin(p.ang - o.ang), Math.cos(p.ang - o.ang)));
      if (spread > PINCH_PX || (twist > TWIST && state.tool === 'cache')) this._pinchBegin(p);
      else if (moved > DRAG_PX) g.kind = 'drag';
      else return;
    }
    const dx = p.x - g.last.x, dy = p.y - g.last.y;
    g.scale = o.scale * p.dist / o.dist;
    const ratio = p.dist / g.last.dist, dAng = Math.atan2(Math.sin(p.ang - g.last.ang), Math.cos(p.ang - g.last.ang));
    g.last = p;
    this._setNdc(p.x, p.y);
    if (g.kind === 'drag') this._drag(dx, dy);
    else this._pinch(ratio, dAng, p);
  }

  _gestureEnd() {
    if (this.g?.kind === 'pinch' && this.g.mask) this.d.tools.stencils.commit();
    this.g = null;
    this.bubble.classList.remove('show');
  }

  // Deux doigts qui glissent : on attrape le décor. « regarder » tourne la tête
  // (le décor suit les doigts) ; « glisser » déplace le long du mur.
  _drag(dx, dy) {
    const d = this.d, h = d.canvas.getBoundingClientRect().height, fov = d.camera.fov * DEG;
    if (state.touchDrag === 'glisser') {
      const k = 2 * this._wallDistance() * Math.tan(fov / 2) / h;
      d.rig.position.x -= Math.cos(d.yaw) * dx * k;
      d.rig.position.z += Math.sin(d.yaw) * dx * k;
      d.rig.position.y = clamp(d.rig.position.y + dy * k, 0, Math.max(1, d.wall.height - 1.2));
    } else {
      d.yaw += dx * fov / h;
      d.pitch = clamp(d.pitch + dy * fov / h, -1.3, 1.3);
    }
  }

  _wallDistance() {
    const d = this.d;
    d.rig.updateMatrixWorld(true);
    return Math.max(0.3, d.camera.getWorldPosition(new THREE.Vector3()).z - d.wall.z);
  }

  // Valeurs de départ du pincement, selon l'outil en main.
  _pinchBegin(p) {
    const g = this.g;
    g.kind = 'pinch';
    g.base = { capScale: state.capScale, maskSize: state.maskSize, pressure: state.pressure };
    g.mask = null;
    if (state.touchPinch !== 'avancer' && state.tool === 'cache') {
      // cache sous les doigts : c'est lui qu'on règle (taille et rotation)
      this._setNdc(p.x, p.y);
      const hit = this.d.hitAt(this.d.ndc), S = this.d.tools.stencils;
      const m = hit && S.pick(hit.canvas, hit.x, hit.y);
      if (m) {
        g.mask = { canvas: hit.canvas, mask: m };
        S.begin('taille et angle du cache', m);   // un seul pas d'annulation pour tout le geste
      }
    }
  }

  _pinch(ratio, dAng, p) {
    const g = this.g, b = g.base, d = this.d;
    let text;
    if (state.touchPinch === 'avancer') {
      // écarter les doigts rapproche du mur : le mur grossit comme l'écart
      const D = this._wallDistance();
      const fwd = D * (1 - 1 / ratio);
      d.rig.position.x -= Math.sin(d.yaw) * fwd;
      d.rig.position.z -= Math.cos(d.yaw) * fwd;
      d.rig.position.z = clamp(d.rig.position.z, d.wall.z + 0.3, d.wall.z + 14);
      text = `À ${this._wallDistance().toFixed(1).replace('.', ',')} m du mur`;
    } else if (g.mask) {
      const { canvas, mask } = g.mask, rot = mask.rot - dAng;
      mask.r = clamp(mask.r * ratio, ...MASK_SIZE);
      mask.rot = Math.atan2(Math.sin(rot), Math.cos(rot));   // l'écran descend, le mur monte : sens inversé
      d.tools.stencils.changed(canvas);
      text = `Cache ${Math.round(mask.r * 200)} cm · ${Math.round(mask.rot / DEG)}°`;
    } else if (state.tool === 'cache') {
      const v = clamp(round(b.maskSize * g.scale, 0.005), ...MASK_SIZE);
      if (v !== state.maskSize) set({ maskSize: v });
      text = `Prochain cache ${Math.round(state.maskSize * 200)} cm`;
    } else if (pressedTool(state.tool)) {
      const v = clamp(round(b.pressure * g.scale, 0.05), 0.1, 1);
      if (v !== state.pressure) set({ pressure: v });
      text = `Pression ${Math.round(state.pressure * 100)} %`;
    } else {
      const v = clamp(round(b.capScale * g.scale, 0.05), ...CAP_SCALE);
      if (v !== state.capScale) set({ capScale: +v.toFixed(2) });
      text = `Jet ${Math.round(state.capScale * 100)} % · ≈ ${Math.round(strokeWidthCm(currentCap(), state.distance))} cm`;
    }
    this._bubble(text, p);
  }

  _bubble(text, p) {
    const el = this.bubble;
    el.textContent = text;
    el.style.left = clamp(p.x, 90, innerWidth - 90) + 'px';
    el.style.top = Math.max(40, p.y - Math.min(110, p.dist / 2 + 50)) + 'px';
    el.classList.add('show');
  }

  // --- Croix de déplacement ----------------------------------------------------

  // La croix est analogique : plus le pouce s'éloigne du centre, plus on va vite,
  // et en diagonale on avance et on se décale à la fois.
  _buildPad() {
    const el = this.padEl = document.createElement('div');
    el.id = 'touch-pad';
    el.innerHTML = `
      <div class="cross" aria-label="Avancer, reculer, se décaler">
        <span data-dir="fwd">▲</span><span data-dir="left">◀</span><span data-dir="right">▶</span><span data-dir="back">▼</span><i></i>
      </div>
      <div class="lift" aria-label="Nacelle">
        <button type="button" data-lift="1" aria-label="Monter">⤒</button>
        <button type="button" data-lift="-1" aria-label="Descendre">⤓</button>
      </div>`;
    document.body.append(el);
    el.addEventListener('contextmenu', e => e.preventDefault());
    const cross = el.querySelector('.cross'), knob = cross.querySelector('i');
    let crossId = null;
    const aim = e => {
      const r = cross.getBoundingClientRect(), R = r.width / 2;
      let x = (e.clientX - r.left - R) / R, y = (e.clientY - r.top - R) / R;
      const n = Math.hypot(x, y);
      if (n > 1) { x /= n; y /= n; }
      const live = v => Math.abs(v) < PAD_DEAD ? 0 : (v - Math.sign(v) * PAD_DEAD) / (1 - PAD_DEAD);
      this.pad.side = live(x);
      this.pad.fwd = -live(y);
      knob.style.transform = `translate(${x * R * 0.6}px, ${y * R * 0.6}px)`;
      cross.querySelector('[data-dir=fwd]').classList.toggle('on', this.pad.fwd > 0);
      cross.querySelector('[data-dir=back]').classList.toggle('on', this.pad.fwd < 0);
      cross.querySelector('[data-dir=left]').classList.toggle('on', this.pad.side < 0);
      cross.querySelector('[data-dir=right]').classList.toggle('on', this.pad.side > 0);
    };
    const release = () => {
      crossId = null;
      this.pad.fwd = this.pad.side = 0;
      knob.style.transform = '';
      cross.querySelectorAll('.on').forEach(s => s.classList.remove('on'));
    };
    cross.addEventListener('pointerdown', e => {
      e.preventDefault();
      crossId = e.pointerId;
      cross.setPointerCapture(e.pointerId);
      aim(e);
    });
    cross.addEventListener('pointermove', e => { if (e.pointerId === crossId) aim(e); });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      cross.addEventListener(ev, e => { if (e.pointerId === crossId) release(); });
    }
    for (const b of el.querySelectorAll('[data-lift]')) {
      const off = () => { b.classList.remove('on'); this.pad.lift = 0; };
      b.addEventListener('pointerdown', e => {
        e.preventDefault();
        b.setPointerCapture(e.pointerId);
        b.classList.add('on');
        this.pad.lift = +b.dataset.lift;
      });
      for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(ev, off);
    }
  }
}
