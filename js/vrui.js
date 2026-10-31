import * as THREE from 'three';
import { PAINTS, FINISHES, hsvToHex, hexToHsv, finishOf } from './palette.js';
import { CAPS, strokeWidthCm } from './spray.js';
import { REF_SIDES, refBitmap } from './refs.js';
import {
  state, set, subscribe, actions, WALLS, WALL_LIMITS, CAP_SCALE, currentCap,
  setCustom, savedPaints, saveCurrentColor, removeSavedColor, TOOLS, setTool,
} from './state.js';
import { SHAPES, MASK_SIZE, MASK_LIFT, drawShapeIcon, shapeOutline } from './stencils.js';
import { scraperById } from './scraper.js';

// Icône d'outil : bombe, feuille de pochoir, lame de racloir.
export function drawToolIcon(ctx, id, x, y, w, h, color = '#e8e8e8') {
  const cx = x + w / 2, cy = y + h / 2, u = Math.min(w, h) / 10;
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  if (id === 'bombe') {
    ctx.beginPath(); ctx.roundRect(cx - 1.6 * u, cy - 2.6 * u, 3.2 * u, 6 * u, u * 0.6); ctx.fill();
    ctx.fillRect(cx - 0.8 * u, cy - 3.8 * u, 1.6 * u, 1 * u);
  } else if (id === 'cache') {
    // feuille ajourée d'une étoile
    ctx.beginPath();
    ctx.rect(cx - 3.6 * u, cy - 3.6 * u, 7.2 * u, 7.2 * u);
    shapeOutline('etoile', 2.8 * u)[0].forEach(([px, py], i) => (i ? ctx.lineTo(cx + px, cy - py) : ctx.moveTo(cx + px, cy - py)));
    ctx.closePath();
    ctx.globalAlpha = 0.8;
    ctx.fill('evenodd');
  } else {
    const t = scraperById(id);
    const bw = Math.min(4.2, t.width / 0.08 * 4.2) * u;
    ctx.lineWidth = u * 0.8;
    ctx.beginPath(); ctx.moveTo(cx, cy + 0.6 * u); ctx.lineTo(cx, cy + 4.2 * u); ctx.stroke();
    ctx.beginPath();
    if (id === 'couteau') {
      ctx.moveTo(cx - bw, cy - 3.6 * u); ctx.lineTo(cx + bw, cy - 3.6 * u);
      ctx.quadraticCurveTo(cx + bw, cy, cx + 0.3 * u, cy + 0.8 * u); ctx.lineTo(cx - 0.3 * u, cy + 0.8 * u);
      ctx.quadraticCurveTo(cx - bw, cy, cx - bw, cy - 3.6 * u);
    } else {
      ctx.moveTo(cx - bw, cy - 3.6 * u); ctx.lineTo(cx + bw, cy - 3.6 * u);
      ctx.lineTo(cx + bw * 0.7, cy + 0.8 * u); ctx.lineTo(cx - bw * 0.7, cy + 0.8 * u);
    }
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

// Icône d'un cap : empreinte de pulvérisation simulée.
export function drawCapIcon(ctx, cap, x, y, w, h, color = '#fff') {
  let seed = cap.id.length * 977;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const g = () => Math.sqrt(-2 * Math.log(rand() + 1e-9)) * Math.cos(6.2832 * rand());
  const s = Math.min(w, h) * (0.06 + cap.angle / 18 * 0.16);
  ctx.save();
  ctx.fillStyle = color;
  const n = 500 + Math.min(cap.flow, 6) * 150;
  for (let i = 0; i < n; i++) {
    const px = x + w / 2 + g() * s * Math.min(cap.sx, 1.8), py = y + h / 2 + g() * s * cap.sy;
    ctx.globalAlpha = 0.25 + rand() * 0.5;
    ctx.fillRect(px, py, 1.6, 1.6);
  }
  ctx.restore();
}

// Pastille de couleur selon le type de peinture.
export function drawSwatch(ctx, paint, cx, cy, r) {
  ctx.save();
  if (paint.kind === 'fluo' || paint.kind === 'phospho') {
    ctx.shadowColor = paint.glow;
    ctx.shadowBlur = r * 0.6;
  }
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  if (paint.kind === 'metal') {
    const g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.35, paint.hex);
    g.addColorStop(0.6, shade(paint.hex, 0.45));
    g.addColorStop(0.8, paint.hex);
    g.addColorStop(1, shade(paint.hex, 0.6));
    ctx.fillStyle = g;
  } else {
    ctx.fillStyle = paint.hex;
  }
  ctx.fill();
  ctx.shadowBlur = 0;
  if (paint.kind === 'phospho') {
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.38, 0, Math.PI * 2);
    ctx.fillStyle = paint.glow;
    ctx.fill();
  }
  ctx.restore();
}

function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const c = v => Math.round(v * k).toString(16).padStart(2, '0');
  return '#' + c(n >> 16 & 255) + c(n >> 8 & 255) + c(n & 255);
}

// Teinte d'où part l'éditeur : pour un phospho, c'est la couleur de la lueur.
export function editorHex(paint) {
  return paint.kind === 'phospho' ? paint.glow : paint.hex;
}

// Coordonnées logiques du panneau ; le canvas est rendu à 75 %.
const LW = 1024, LH = 1600, SCALE = 0.75;
const PW = 0.2, PH = PW * LH / LW;
const TABS = [['colors', 'Couleurs'], ['perso', 'Perso'], ['tools', 'Outils'], ['model', 'Modèle'], ['settings', 'Réglages'], ['projects', 'Projets']];
const FONT = 'system-ui, sans-serif';

// Palette tenue dans la main libre en VR, pointée avec la bombe.
export class VRPalette {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = LW * SCALE;
    this.canvas.height = LH * SCALE;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(PW, PH),
      new THREE.MeshBasicMaterial({ map: this.texture, toneMapped: false }));
    // au-dessus de la manette, incliné vers les yeux comme un pupitre
    this.mesh.position.set(0, 0.03 + PH / 2 * Math.cos(0.87), -0.02 - PH / 2 * Math.sin(0.87));
    this.mesh.rotation.x = -0.87;
    this.highlight = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18, depthWrite: false, toneMapped: false }));
    this.highlight.position.z = 0.001;
    this.highlight.visible = false;
    this.mesh.add(this.highlight);
    this.raycaster = new THREE.Raycaster();
    this.tab = 'colors';
    this.hover = null;
    this.message = '';
    this.messageUntil = 0;
    this.exitArmedUntil = 0;
    this.thumbs = new Map();
    this.pendW = state.wallWidth;
    this.pendH = state.wallHeight;
    this._syncEditor();
    this.draw();
    subscribe(patch => {
      if ('wallWidth' in patch || 'wallHeight' in patch) { this.pendW = state.wallWidth; this.pendH = state.wallHeight; }
      if ('paint' in patch && !this.editing) this._syncEditor();
      this.draw();
    });
  }

  _syncEditor() {
    const hsv = hexToHsv(editorHex(state.paint));
    this.h = hsv.h; this.s = hsv.s; this.v = hsv.v;
    this.finish = finishOf(state.paint);
  }

  flash(msg) {
    this.message = msg;
    this.messageUntil = performance.now() + 2500;
    this.draw();
    clearTimeout(this._msgTimer);
    this._msgTimer = setTimeout(() => this.draw(), 2600);
  }

  // --- dessin -----------------------------------------------------------------
  _button(r, label, { on = false, danger = false, size = 32 } = {}) {
    const c = this.ctx;
    c.fillStyle = danger ? '#4a1f24' : on ? '#3b4252' : '#252831';
    c.beginPath(); c.roundRect(r.x, r.y, r.w, r.h, 18); c.fill();
    if (on) { c.strokeStyle = '#fff'; c.lineWidth = 4; c.stroke(); }
    c.fillStyle = '#eceef2';
    c.font = `600 ${size}px ${FONT}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(label, r.x + r.w / 2, r.y + r.h / 2, r.w - 20);
    c.textAlign = 'left';
    c.textBaseline = 'alphabetic';
  }

  _text(str, x, y, size = 30, color = '#9aa0ab', weight = 400, maxW = undefined) {
    const c = this.ctx;
    c.fillStyle = color;
    c.font = `${weight} ${size}px ${FONT}`;
    c.fillText(str, x, y, maxW);
  }

  draw() {
    const c = this.ctx, R = this.regions = [];
    const reg = (o) => { R.push(o); return o; };
    c.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    c.fillStyle = '#131418';
    c.fillRect(0, 0, LW, LH);
    c.strokeStyle = '#2c2f37';
    c.lineWidth = 6;
    c.strokeRect(3, 3, LW - 6, LH - 6);

    // En-tête : la pastille ouvre l'éditeur à partir de la couleur courante
    reg({ type: 'edit', x: 24, y: 16, w: 136, h: 120 });
    drawSwatch(c, state.paint, 88, 76, 52);
    c.fillStyle = '#ffffffaa';
    c.font = `600 26px ${FONT}`;
    c.fillText('✎', 126, 126);
    this._text(state.paint.name, 170, 66, 44, '#f2f2f2', 600, 560);
    const msg = performance.now() < this.messageUntil ? this.message : `${state.projectName} · ${state.paint.group}`;
    this._text(msg, 170, 114, 30, undefined, undefined, 560);

    // Sortie du casque vers la page du navigateur, quel que soit l'onglet ouvert.
    // Deux appuis : un geste de peinture qui frôle la palette ne coupe pas la séance.
    const armed = performance.now() < this.exitArmedUntil;
    this._button(reg({ type: 'btn', id: 'exitXR', x: 752, y: 30, w: 240, h: 92 }),
      armed ? 'Confirmer ?' : 'Quitter la VR', { danger: armed, size: 30 });

    TABS.forEach(([id, label], i) => {
      this._button(reg({ type: 'tab', id, x: 32 + i * 161, y: 146, w: 153, h: 70 }), label, { on: this.tab === id, size: 26 });
    });

    this['_draw_' + this.tab](reg);

    // Pied : caps et potentiomètre de largeur, toujours accessibles
    CAPS.forEach((cap, i) => {
      const r = reg({ type: 'cap', cap, x: 32 + i * 192, y: 1296, w: 184, h: 130 });
      const on = cap.id === state.cap;
      c.fillStyle = on ? '#3b4252' : '#1e2027';
      c.beginPath(); c.roundRect(r.x, r.y, r.w, r.h, 18); c.fill();
      if (on) { c.strokeStyle = '#fff'; c.lineWidth = 4; c.stroke(); }
      drawCapIcon(c, cap, r.x, r.y, r.w, r.h - 34, '#e8e8e8');
      c.fillStyle = '#d7dae0';
      c.font = `600 26px ${FONT}`;
      c.textAlign = 'center';
      c.fillText(cap.name, r.x + r.w / 2, r.y + r.h - 12);
      c.textAlign = 'left';
    });
    const cap = currentCap();
    this._text(`Largeur du jet ${Math.round(state.capScale * 100)} %  ·  ≈ ${Math.round(strokeWidthCm(cap))} cm à 15 cm`, 32, 1474, 30, '#d7dae0');
    const tr = reg({ type: 'scale', x: 32, y: 1494, w: 960, h: 80 });
    c.fillStyle = '#252831';
    c.beginPath(); c.roundRect(tr.x, tr.y + 28, tr.w, 24, 12); c.fill();
    const f = (state.capScale - CAP_SCALE[0]) / (CAP_SCALE[1] - CAP_SCALE[0]);
    c.fillStyle = '#ff4d6d';
    c.beginPath(); c.roundRect(tr.x, tr.y + 28, tr.w * f, 24, 12); c.fill();
    c.fillStyle = '#fff';
    c.beginPath(); c.arc(tr.x + tr.w * f, tr.y + 40, 26, 0, Math.PI * 2); c.fill();

    this.texture.needsUpdate = true;
  }

  _draw_colors(reg) {
    const c = this.ctx;
    PAINTS.forEach((paint, i) => {
      const r = reg({ type: 'paint', paint, x: 32 + (i % 8) * 120, y: 232 + Math.floor(i / 8) * 131, w: 120, h: 131 });
      drawSwatch(c, paint, r.x + 60, r.y + 65, 46);
      if (paint.id === state.paint.id) {
        c.strokeStyle = '#fff'; c.lineWidth = 6;
        c.beginPath(); c.arc(r.x + 60, r.y + 65, 56, 0, Math.PI * 2); c.stroke();
      }
    });
  }

  _draw_tools(reg) {
    const c = this.ctx;
    this._text('Outil en main', 32, 270, 30, '#d7dae0', 600);
    TOOLS.forEach((t, i) => {
      const r = reg({ type: 'tool', id: t.id, x: 32 + i * 194, y: 290, w: 186, h: 150 });
      const on = t.id === state.tool;
      c.fillStyle = on ? '#3b4252' : '#1e2027';
      c.beginPath(); c.roundRect(r.x, r.y, r.w, r.h, 18); c.fill();
      if (on) { c.strokeStyle = '#fff'; c.lineWidth = 4; c.stroke(); }
      drawToolIcon(c, t.id, r.x, r.y + 6, r.w, r.h - 50, '#e8e8e8');
      c.fillStyle = '#d7dae0';
      c.font = `600 26px ${FONT}`;
      c.textAlign = 'center';
      c.fillText(t.name, r.x + r.w / 2, r.y + r.h - 14);
      c.textAlign = 'left';
    });
    const help = lines => lines.forEach((l, i) => this._text(l, 32, 1010 + i * 42, 28));
    if (state.tool === 'cache') {
      this._text('Forme', 32, 490, 30, '#d7dae0', 600);
      SHAPES.forEach((sh, i) => {
        const r = reg({ type: 'shape', id: sh.id, x: 32 + i * 161, y: 510, w: 153, h: 130 });
        const on = sh.id === state.maskShape;
        c.fillStyle = on ? '#3b4252' : '#1e2027';
        c.beginPath(); c.roundRect(r.x, r.y, r.w, r.h, 18); c.fill();
        if (on) { c.strokeStyle = '#fff'; c.lineWidth = 4; c.stroke(); }
        drawShapeIcon(c, sh.id, r.x, r.y + 4, r.w, r.h - 40, '#9cc8e8');
        c.fillStyle = '#d7dae0';
        c.font = `600 24px ${FONT}`;
        c.textAlign = 'center';
        c.fillText(sh.name, r.x + r.w / 2, r.y + r.h - 12);
        c.textAlign = 'left';
      });
      const lift = Math.round(state.maskLift * 1000);
      const rows = [
        ['mask', `Taille : ${Math.round(state.maskSize * 200)} cm`],
        ['lift', `Décollement : ${lift} mm${lift <= 1 ? ' (net)' : lift >= 10 ? ' (flou)' : ''}`],
      ];
      rows.forEach(([k, label], i) => {
        const y = 660 + i * 115;
        this._button(reg({ type: 'btn', id: k + 'Less', x: 32, y, w: 140, h: 100 }), '−', { size: 48 });
        this._button(reg({ type: 'btn', id: k + 'More', x: 852, y, w: 140, h: 100 }), '+', { size: 48 });
        c.textAlign = 'center';
        this._text(label, 512, y + 62, 36, '#f2f2f2', 600);
        c.textAlign = 'left';
      });
      this._button(reg({ type: 'btn', id: 'removeMasks', x: 32, y: 890, w: 960, h: 90 }), 'Retirer tous les caches', { danger: true });
      help(['Gâchette sur le mur : poser un cache, glisser pour le placer.',
        'Gâchette sur un cache : le déplacer ; tourner le poignet : rotation.',
        'Joystick ↑↓ en visant un cache : taille · A : le retirer.',
        'Les caches se superposent ; un cache décollé donne un bord flou.']);
    } else if (scraperById(state.tool)) {
      help(['Approche la lame du mur : elle racle au contact.',
        'Enfonce-la (ou presse la gâchette) pour appuyer plus fort.',
        'Le fil de la lame suit le poignet ; tirer en travers racle,',
        'glisser dans son axe ne fait rien. Légère : retire la dernière',
        'couche. Forte : jusqu\'au mur, avec des éclats et des stries.']);
    } else {
      help(['Gâchette latérale (bombe) : passer au dernier outil et revenir.']);
    }
  }

  _draw_perso(reg) {
    const c = this.ctx;
    const sv = reg({ type: 'sv', x: 32, y: 240, w: 560, h: 560 });
    c.fillStyle = hsvToHex(this.h, 1, 1);
    c.fillRect(sv.x, sv.y, sv.w, sv.h);
    let g = c.createLinearGradient(sv.x, 0, sv.x + sv.w, 0);
    g.addColorStop(0, '#fff'); g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g; c.fillRect(sv.x, sv.y, sv.w, sv.h);
    g = c.createLinearGradient(0, sv.y, 0, sv.y + sv.h);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, '#000');
    c.fillStyle = g; c.fillRect(sv.x, sv.y, sv.w, sv.h);
    c.strokeStyle = this.v > 0.5 ? '#000' : '#fff';
    c.lineWidth = 5;
    c.beginPath(); c.arc(sv.x + this.s * sv.w, sv.y + (1 - this.v) * sv.h, 18, 0, Math.PI * 2); c.stroke();

    const hue = reg({ type: 'hue', x: 612, y: 240, w: 70, h: 560 });
    g = c.createLinearGradient(0, hue.y, 0, hue.y + hue.h);
    for (let k = 0; k <= 6; k++) g.addColorStop(k / 6, hsvToHex(k / 6 % 1, 1, 1));
    c.fillStyle = g;
    c.fillRect(hue.x, hue.y, hue.w, hue.h);
    c.fillStyle = '#fff';
    c.fillRect(hue.x - 8, hue.y + this.h * hue.h - 5, hue.w + 16, 10);

    FINISHES.forEach((fin, i) => {
      this._button(reg({ type: 'finish', id: fin.id, x: 708, y: 240 + i * 94, w: 284, h: 82 }), fin.name, { on: this.finish === fin.id, size: 30 });
    });

    this._button(reg({ type: 'saveColor', x: 32, y: 822, w: 470, h: 96 }), 'Enregistrer la couleur', { size: 32 });
    const sel = state.paint.id.startsWith('saved');
    if (sel) this._button(reg({ type: 'removeColor', x: 522, y: 822, w: 470, h: 96 }), 'Retirer de Mes couleurs', { danger: true, size: 30 });

    this._text('Mes couleurs', 32, 972, 30, '#d7dae0', 600);
    const saved = savedPaints();
    if (!saved.length) this._text('Aucune : choisis une teinte puis « Enregistrer ».', 32, 1030, 28);
    saved.forEach((paint, i) => {
      const r = reg({ type: 'paint', paint, x: 32 + (i % 8) * 120, y: 990 + Math.floor(i / 8) * 140, w: 120, h: 140 });
      drawSwatch(c, paint, r.x + 60, r.y + 70, 46);
      if (paint.id === state.paint.id) {
        c.strokeStyle = '#fff'; c.lineWidth = 6;
        c.beginPath(); c.arc(r.x + 60, r.y + 70, 56, 0, Math.PI * 2); c.stroke();
      }
    });
  }

  _draw_settings(reg) {
    const buttons = [
      ['undo', 'Annuler'], ['clear', 'Effacer', true], ['night', state.night ? 'Jour' : 'Nuit'],
      ['drips', 'Coulures ' + (state.drips ? 'oui' : 'non')],
      ['aim', 'Viseur ' + (state.aim ? 'oui' : 'non')], ['hand', state.leftHanded ? 'Gaucher' : 'Droitier'],
      ['save', 'Sauver'], ['photo', 'Photo'],
    ];
    buttons.forEach(([id, label, danger], i) => {
      this._button(reg({ type: 'btn', id, x: 32 + (i % 4) * 244, y: 240 + Math.floor(i / 4) * 116, w: 232, h: 104 }), label, { danger });
    });
    this._text('Type de mur', 32, 520, 30, '#d7dae0', 600);
    const name = WALLS.find(w => w.id === state.wall)?.name || 'Mur';
    this._button(reg({ type: 'btn', id: 'wallPrev', x: 32, y: 540, w: 140, h: 100 }), '◀', { size: 40 });
    this._button(reg({ type: 'btn', id: 'wallNext', x: 852, y: 540, w: 140, h: 100 }), '▶', { size: 40 });
    this.ctx.textAlign = 'center';
    this._text(name, 512, 604, 38, '#f2f2f2', 600);
    this.ctx.textAlign = 'left';

    this._text('Taille du mur', 32, 700, 30, '#d7dae0', 600);
    const rows = [['W', 'Largeur', this.pendW, ' m'], ['H', 'Hauteur', this.pendH, ' m']];
    rows.forEach(([k, label, val, unit], i) => {
      const y = 720 + i * 120;
      this._button(reg({ type: 'btn', id: 'dec' + k, x: 32, y, w: 140, h: 100 }), '−', { size: 48 });
      this._button(reg({ type: 'btn', id: 'inc' + k, x: 852, y, w: 140, h: 100 }), '+', { size: 48 });
      this.ctx.textAlign = 'center';
      this._text(`${label} : ${String(val).replace('.', ',')}${unit}`, 512, y + 62, 38, '#f2f2f2', 600);
      this.ctx.textAlign = 'left';
    });
    const changed = this.pendW !== state.wallWidth || this.pendH !== state.wallHeight;
    this._button(reg({ type: 'btn', id: 'applySize', x: 32, y: 970, w: 960, h: 100 }),
      changed ? 'Appliquer la nouvelle taille' : `Mur actuel : ${state.wallWidth} × ${String(state.wallHeight).replace('.', ',')} m`, { on: changed });
    this._text('La peinture déjà faite reste à sa place.', 32, 1120, 28);
  }

  _draw_model(reg) {
    const c = this.ctx, refs = state.refs || [];
    if (!refs.length) {
      this._text('Aucun modèle dans ce projet.', 32, 300, 34, '#f2f2f2', 600);
      this._text('Ajoute des photos depuis le panneau du navigateur,', 32, 360, 28);
      this._text('avant d\'entrer en VR : section « Modèle » → Ajouter.', 32, 400, 28);
      this._text('Elles sont enregistrées avec le projet.', 32, 440, 28);
      return;
    }
    refs.slice(0, 8).forEach((ref, i) => {
      const r = reg({ type: 'ref', index: i, x: 32 + (i % 4) * 244, y: 240 + Math.floor(i / 4) * 200, w: 232, h: 188 });
      c.fillStyle = '#1e2027';
      c.beginPath(); c.roundRect(r.x, r.y, r.w, r.h, 16); c.fill();
      const bmp = refBitmap(ref, () => { if (this.tab === 'model') this.draw(); });
      if (bmp) {
        const k = Math.min((r.w - 16) / bmp.width, (r.h - 16) / bmp.height);
        const w = bmp.width * k, h = bmp.height * k;
        c.drawImage(bmp, r.x + (r.w - w) / 2, r.y + (r.h - h) / 2, w, h);
      }
      if (i === state.refIndex) { c.strokeStyle = '#fff'; c.lineWidth = 6; c.stroke(); }
    });
    const y = 660;
    this._button(reg({ type: 'btn', id: 'refShow', x: 32, y, w: 470, h: 100 }), state.refShow ? 'Masquer le modèle' : 'Afficher le modèle', { on: state.refShow });
    this._button(reg({ type: 'btn', id: 'refEasel', x: 522, y, w: 470, h: 100 }), state.refEasel ? 'Sur le chevalet' : 'À côté de la palette', { on: state.refEasel });
    this._text('Position', 32, y + 160, 30, '#d7dae0', 600);
    REF_SIDES.forEach(([id, label], i) => {
      this._button(reg({ type: 'btn', id: 'side:' + id, x: 32 + i * 325, y: y + 180, w: 315, h: 96 }), label, { on: (state.refSide || 'droite') === id && !state.refEasel });
    });
    this._text('Taille', 32, y + 340, 30, '#d7dae0', 600);
    this._button(reg({ type: 'btn', id: 'refSmaller', x: 32, y: y + 360, w: 140, h: 100 }), '−', { size: 48 });
    this._button(reg({ type: 'btn', id: 'refBigger', x: 852, y: y + 360, w: 140, h: 100 }), '+', { size: 48 });
    c.textAlign = 'center';
    this._text(`${Math.round((state.refScale || 1) * 100)} %`, 512, y + 424, 38, '#f2f2f2', 600);
    c.textAlign = 'left';
  }

  _draw_projects(reg) {
    const c = this.ctx;
    this._button(reg({ type: 'btn', id: 'newProject', x: 32, y: 240, w: 470, h: 96 }), 'Nouveau projet');
    this._button(reg({ type: 'btn', id: 'save', x: 522, y: 240, w: 470, h: 96 }), 'Enregistrer');
    const list = (state.projects || []).slice(0, 7);
    if (!list.length) this._text('Aucun projet enregistré pour l\'instant.', 32, 400, 30);
    list.forEach((p, i) => {
      const r = reg({ type: 'project', id: p.id, x: 32, y: 352 + i * 132, w: 960, h: 120 });
      const cur = p.id === state.projectId;
      c.fillStyle = cur ? '#3b4252' : '#1e2027';
      c.beginPath(); c.roundRect(r.x, r.y, r.w, r.h, 16); c.fill();
      if (cur) { c.strokeStyle = '#fff'; c.lineWidth = 4; c.stroke(); }
      const img = this._thumb(p);
      if (img?.complete && img.naturalWidth) {
        const th = r.h - 20, tw = Math.min(260, th * img.naturalWidth / img.naturalHeight);
        c.drawImage(img, r.x + 10, r.y + 10, tw, th);
      }
      this._text(p.name, r.x + 290, r.y + 52, 36, '#f2f2f2', 600);
      const d = new Date(p.date);
      this._text(`${p.wallWidth} × ${p.wallHeight} m · ${d.toLocaleDateString('fr-FR')} ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`, r.x + 290, r.y + 96, 26);
    });
  }

  _thumb(p) {
    if (!p.thumb) return null;
    let entry = this.thumbs.get(p.id);
    if (!entry || entry.src !== p.thumb) {
      const img = new Image();
      img.onload = () => { if (this.tab === 'projects') this.draw(); };
      img.src = p.thumb;
      entry = { src: p.thumb, img };
      this.thumbs.set(p.id, entry);
    }
    return entry.img;
  }

  // --- interaction --------------------------------------------------------------
  raycast(origin, dir, far = 0.8) {
    if (!this.mesh.visible || !this.mesh.parent) return null;
    this.raycaster.set(origin, dir);
    this.raycaster.far = far;
    const hit = this.raycaster.intersectObject(this.mesh, false)[0];
    if (!hit || !hit.uv) return null;
    const px = hit.uv.x * LW, py = (1 - hit.uv.y) * LH;
    const region = this.regions.find(r => px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h) || null;
    return { region, px, py, distance: hit.distance, point: hit.point };
  }

  setHover(hit) {
    const r = hit?.region || null;
    if (r === this.hover) return;
    this.hover = r;
    this.highlight.visible = !!r;
    if (r) {
      this.highlight.position.x = ((r.x + r.w / 2) / LW - 0.5) * PW;
      this.highlight.position.y = (0.5 - (r.y + r.h / 2) / LH) * PH;
      this.highlight.scale.set(r.w / LW * PW, r.h / LH * PH, 1);
    }
  }

  openEditor() {
    this._syncEditor();
    this.tab = 'perso';
    if (!state.paint.custom) setCustom(editorHex(state.paint), this.finish);
    else this.draw();
  }

  press(hit) {
    const r = hit.region;
    if (!r) return;
    this.editing = false;
    switch (r.type) {
      case 'edit': return this.openEditor();
      case 'tab': if (r.id === 'projects') actions.refreshProjects?.(); this.tab = r.id; this.hover = null; this.highlight.visible = false; return this.draw();
      case 'paint': return set({ paint: r.paint });
      case 'cap': return set({ cap: r.cap.id, capScale: 1 });
      case 'tool': return setTool(r.id);
      case 'shape': return set({ maskShape: r.id });
      case 'finish': this.finish = r.id; return setCustom(hsvToHex(this.h, this.s, this.v), r.id);
      case 'saveColor': saveCurrentColor(); return this.flash('Couleur enregistrée dans Mes couleurs');
      case 'removeColor': return removeSavedColor(+state.paint.id.slice(5));
      case 'project': return actions.openProject(r.id);
      case 'ref': return set({ refIndex: r.index, refShow: true });
      case 'btn': return this._buttonAction(r.id);
      default: return this.drag(hit);
    }
  }

  _buttonAction(id) {
    const i = WALLS.findIndex(w => w.id === state.wall);
    const [wMin, wMax, wStep] = WALL_LIMITS.width, [hMin, hMax, hStep] = WALL_LIMITS.height;
    const clamp = (v, a, b) => Math.min(b, Math.max(a, Math.round(v * 2) / 2));
    if (id.startsWith('side:')) return set({ refSide: id.slice(5), refEasel: false, refShow: true });
    ({
      undo: () => actions.undo(),
      clear: () => actions.clear(),
      night: () => set({ night: !state.night }),
      drips: () => set({ drips: !state.drips }),
      aim: () => set({ aim: !state.aim }),
      hand: () => set({ leftHanded: !state.leftHanded }),
      save: () => actions.save(),
      photo: () => actions.photo(),
      newProject: () => actions.newProject(),
      exitXR: () => {
        if (performance.now() < this.exitArmedUntil) { this.exitArmedUntil = 0; return actions.exitXR(); }
        this.exitArmedUntil = performance.now() + 3000;
        this.flash('Appuyez encore pour revenir au navigateur');
        clearTimeout(this._exitTimer);
        this._exitTimer = setTimeout(() => this.draw(), 3100);
      },
      wallPrev: () => set({ wall: WALLS[(i - 1 + WALLS.length) % WALLS.length].id }),
      wallNext: () => set({ wall: WALLS[(i + 1) % WALLS.length].id }),
      decW: () => { this.pendW = clamp(this.pendW - wStep, wMin, wMax); this.draw(); },
      incW: () => { this.pendW = clamp(this.pendW + wStep, wMin, wMax); this.draw(); },
      decH: () => { this.pendH = clamp(this.pendH - hStep, hMin, hMax); this.draw(); },
      incH: () => { this.pendH = clamp(this.pendH + hStep, hMin, hMax); this.draw(); },
      applySize: () => set({ wallWidth: this.pendW, wallHeight: this.pendH }),
      maskLess: () => set({ maskSize: Math.max(MASK_SIZE[0], Math.round(state.maskSize * 0.8 * 200) / 200) }),
      maskMore: () => set({ maskSize: Math.min(MASK_SIZE[1], Math.round(state.maskSize * 1.25 * 200) / 200) }),
      liftLess: () => set({ maskLift: Math.max(MASK_LIFT[0], Math.round(state.maskLift * 1000 - (state.maskLift > 0.005 ? 2 : 1)) / 1000) }),
      liftMore: () => set({ maskLift: Math.min(MASK_LIFT[1], Math.round(state.maskLift * 1000 + (state.maskLift >= 0.005 ? 2 : 1)) / 1000) }),
      removeMasks: () => actions.removeMasks(),
      refShow: () => set({ refShow: !state.refShow }),
      refEasel: () => set({ refEasel: !state.refEasel, refShow: true }),
      refSmaller: () => set({ refScale: Math.max(0.5, Math.round(((state.refScale || 1) - 0.25) * 4) / 4) }),
      refBigger: () => set({ refScale: Math.min(3, Math.round(((state.refScale || 1) + 0.25) * 4) / 4) }),
    })[id]?.();
  }

  // Glisser : sélecteur de couleur et potentiomètre de largeur
  drag(hit) {
    const r = hit.region;
    if (!r) return;
    const fx = Math.min(1, Math.max(0, (hit.px - r.x) / r.w));
    const fy = Math.min(1, Math.max(0, (hit.py - r.y) / r.h));
    if (r.type === 'scale') {
      set({ capScale: Math.round((CAP_SCALE[0] + fx * (CAP_SCALE[1] - CAP_SCALE[0])) * 20) / 20 });
      return;
    }
    if (r.type === 'sv') { this.s = fx; this.v = 1 - fy; }
    else if (r.type === 'hue') this.h = fy % 1;
    else return;
    this.editing = true;
    setCustom(hsvToHex(this.h, this.s, this.v), this.finish);
  }
}
