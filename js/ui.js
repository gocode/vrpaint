import { PAINTS, GROUPS, FINISHES, finishOf } from './palette.js';
import { CAPS, strokeWidthCm } from './spray.js';
import {
  state, set, subscribe, actions, WALLS, WALL_LIMITS, CAP_SCALE, currentCap,
  setCustom, savedPaints, saveCurrentColor, removeSavedColor, TOOLS, setTool, SIZED_TOOLS, toolSize,
} from './state.js';
import { drawCapIcon, drawToolIcon, editorHex } from './vrui.js';
import { SHAPES, MASK_SIZE, MASK_LIFT, drawShapeIcon } from './stencils.js';
import { scraperById } from './scraper.js';
import { brushById, brushSize } from './brush.js';
import { NEWSPAPER } from './newspaper.js';
import { TORCH, torchReach } from './torch.js';
import { SPONGE } from './sponge.js';
import { importImage, addRefs, removeRef, currentRef, REF_SIDES } from './refs.js';
import { SPECTATOR_MODES } from './spectator.js';
import { projectsWhere } from './storage.js';

const $ = (sel, root = document) => root.querySelector(sel);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const num = v => String(v).replace('.', ',');

function swatchStyle(p) {
  if (p.kind === 'metal') return `background: linear-gradient(135deg, #fff 0%, ${p.hex} 35%, color-mix(in srgb, ${p.hex} 45%, #000) 60%, ${p.hex} 80%, color-mix(in srgb, ${p.hex} 60%, #000) 100%)`;
  if (p.kind === 'phospho') return `background: radial-gradient(circle, ${p.glow} 0 32%, ${p.hex} 34%); box-shadow: 0 0 8px ${p.glow}`;
  if (p.kind === 'fluo') return `background: ${p.hex}; box-shadow: 0 0 8px ${p.hex}`;
  return `background: ${p.hex}`;
}

const swatch = p => `<button type="button" class="sw" data-paint="${p.id}" title="${esc(p.name)}" style="${swatchStyle(p)}"></button>`;

// Panneau d'outils du mode écran (souris / tactile).
export function buildUI() {
  const panel = $('#panel');
  const [wMin, wMax, wStep] = WALL_LIMITS.width, [hMin, hMax, hStep] = WALL_LIMITS.height;
  panel.innerHTML = `
    <header><h1>VRpaint</h1><span>mur de graffiti</span></header>
    <section>
      <button type="button" class="current" id="edit-current" title="Personnaliser cette couleur">
        <span class="dot"></span><span><strong></strong><small></small></span><span class="pen">✎</span>
      </button>
      <div class="editor" id="editor" hidden>
        <label class="row">Teinte <input type="color" id="custom-color"></label>
        <div class="finishes">${FINISHES.map(f => `<button type="button" data-finish="${f.id}">${f.name}</button>`).join('')}</div>
        <button type="button" id="save-color" class="primary-soft">Enregistrer dans Mes couleurs</button>
      </div>
      <h2>Mes couleurs <small>(clic droit pour retirer)</small></h2>
      <div class="swatches" id="saved-colors"></div>
      ${GROUPS.map(g => `<h2>${g}</h2><div class="swatches">${PAINTS.filter(p => p.group === g).map(swatch).join('')}</div>`).join('')}
    </section>
    <section>
      <h2>Outil</h2>
      <div class="caps" id="tools">${TOOLS.map(t => `
        <button type="button" class="cap" data-tool="${t.id}" title="${esc(t.hint)}">
          <canvas width="96" height="60"></canvas><span>${t.name}</span></button>`).join('')}
      </div>
      <div id="mask-opts">
        <h2>Forme du cache</h2>
        <div class="caps" id="shapes">${SHAPES.map(sh => `
          <button type="button" class="cap" data-shape="${sh.id}" title="${sh.name}">
            <canvas width="96" height="60"></canvas><span>${sh.name}</span></button>`).join('')}
        </div>
        <label class="slider">Taille du prochain cache <output id="o-msize"></output>
          <input type="range" id="mask-size" min="${MASK_SIZE[0] * 200}" max="${MASK_SIZE[1] * 200}" step="1"></label>
        <label class="slider">Décollement du mur <output id="o-mlift"></output>
          <input type="range" id="mask-lift" min="${MASK_LIFT[0] * 1000}" max="${MASK_LIFT[1] * 1000}" step="1"></label>
        <button type="button" data-action="removeMasks" class="wide">Retirer tous les caches</button>
        <p class="help">Clic sur le mur : poser un cache (glisser pour le placer) · clic sur un cache : le déplacer ·
          molette dessus : taille · Maj + molette : rotation · Suppr : le retirer. Plaqué, le bord est net ; décollé, il s'estompe.</p>
      </div>
      ${SIZED_TOOLS.map(b => `<div class="brush-opts" data-brush-opts="${b.id}">
        <h2>${b.sizeTitle || `Taille du pinceau ${b.kind === 'rond' ? '(diamètre)' : '(largeur)'}`}</h2>
        ${b.range ? `<label class="slider">${b.sizeWord} <output data-size-out="${b.id}"></output>
          <input type="range" data-size-range="${b.id}" min="${b.range[0] * 100}" max="${b.range[1] * 100}" step="1"></label>`
        : `<div class="finishes">${b.sizes.map(v => `<button type="button" data-brush="${b.id}" data-size="${v}">${num(Math.round(v * 1000) / 10)} cm</button>`).join('')}</div>`}
      </div>`).join('')}
      <p class="help" id="brush-help">Glisser sur le mur pour peindre avec la couleur en cours : le trait garde la trace des poils
        et pâlit quand la charge s'épuise ; lâcher un instant recharge le pinceau. Molette : pression (le pinceau rond s'écrase
        et s'élargit) · Maj + molette : angle du pinceau plat (de chant, il trace un filet).</p>
      <p class="help" id="sponge-help">Cliquer pour tamponner, glisser pour frotter : l'éponge pose la couleur en cours
        avec son grain (îlots percés de pores), différent à chaque appui ; frottée, elle l'étale en stries. Elle se vide
        d'un appui à l'autre ; lâcher une seconde la recharge. Molette : pression (l'éponge s'écrase, contact plus large).</p>
      <p class="help" id="paper-help">Cliquer pour tamponner, glisser pour frotter : le papier froissé emporte la peinture
        fraîche par éclats anguleux et laisse voir les couches sèches du dessous. Rester appuyé : il en boit davantage ;
        sèche, la peinture ne part presque plus. Chaque appui donne un nouveau froissage. Molette : pression (contact plus large).</p>
      <p class="help" id="torch-help">Maintenir le clic : la flamme sèche la peinture fraîche sous elle (le papier journal ne
        l'emporte plus, elle ne coule plus). Une grande flamme sèche d'un coup une grande surface, et porte plus loin.
        Molette : distance au mur ; plus près, la flamme chauffe plus fort (25 cm au plus pour la flamme de 6 cm).</p>
      <p class="help" id="scraper-help">Glisser sur le mur pour racler : la lame retire la dernière couche et laisse voir
        celle du dessous ; à forte pression, elle va jusqu'au mur. Molette : pression · Maj + molette : angle de la lame.</p>
    </section>
    <section>
      <h2>Cap</h2>
      <div class="caps">${CAPS.map((c, i) => `
        <button type="button" class="cap" data-cap="${c.id}" title="${c.hint} (touche ${i + 1})">
          <canvas width="96" height="60"></canvas><span>${c.name}</span></button>`).join('')}
      </div>
      <label class="slider">Largeur du jet <output id="o-scale"></output>
        <input type="range" id="cap-scale" min="${CAP_SCALE[0] * 100}" max="${CAP_SCALE[1] * 100}" step="5"></label>
      <label class="slider">Pression <output id="o-pressure"></output>
        <input type="range" id="pressure" min="10" max="100" step="5"></label>
      <label class="slider">Distance au mur <output id="o-distance"></output>
        <input type="range" id="distance" min="2" max="80" step="1"></label>
      <label class="slider" id="angle-row">Angle (flat cap, pinceau plat, lame, cache) <output id="o-angle"></output>
        <input type="range" id="angle" min="-90" max="90" step="5"></label>
    </section>
    <section class="touch-only">
      <h2>Écran tactile</h2>
      <label class="row">Deux doigts <select id="touch-drag">
        <option value="regarder">regarder autour</option><option value="glisser">glisser le long du mur</option></select></label>
      <label class="row">Pincer <select id="touch-pinch">
        <option value="largeur">largeur de l'outil</option><option value="avancer">avancer / reculer</option></select></label>
      <label class="check"><input type="checkbox" id="touch-pad-on"> Croix de déplacement</label>
      <p class="help">Un doigt peint. Pincer règle le jet de la bombe, la taille du cache touché (en tournant : son angle)
        ou la pression du racloir. Toucher la scène referme ce panneau.</p>
    </section>
    <section>
      <h2>Mur et ambiance</h2>
      <label class="row">Mur <select id="wall">${WALLS.map(w => `<option value="${w.id}">${w.name}</option>`).join('')}</select></label>
      <label class="slider">Largeur <output id="o-ww"></output>
        <input type="range" id="wall-w" min="${wMin}" max="${wMax}" step="${wStep}"></label>
      <label class="slider">Hauteur <output id="o-wh"></output>
        <input type="range" id="wall-h" min="${hMin}" max="${hMax}" step="${hStep}"></label>
      <button type="button" id="apply-size" class="wide" hidden>Appliquer la nouvelle taille</button>
      <label class="check"><input type="checkbox" id="night"> Nuit (phospho)</label>
      <label class="check"><input type="checkbox" id="drips"> Coulures</label>
      <label class="check" title="Gouttelettes autour du trait et jet qui crachote à mi-gâchette ; décoché : trait propre"><input type="checkbox" id="spatter"> Projections</label>
      <label class="check" title="Les pinceaux et l'éponge se vident en peignant et se rechargent quand on les décolle du mur ; décoché : ils restent toujours pleins"><input type="checkbox" id="realLoad"> Charge réaliste (pinceaux, éponge)</label>
      <label class="check"><input type="checkbox" id="aim"> Viseur</label>
    </section>
    <section>
      <h2>Modèle (photo)</h2>
      <label class="file-btn">Ajouter des photos<input type="file" id="ref-file" accept="image/*" multiple></label>
      <div class="refs" id="refs"></div>
      <label class="check"><input type="checkbox" id="ref-show"> Afficher le modèle</label>
      <label class="check"><input type="checkbox" id="ref-easel"> Sur un chevalet près du mur (VR)</label>
      <label class="row">À côté de la palette (VR) <select id="ref-side">${REF_SIDES.map(([id, n]) => `<option value="${id}">${n}</option>`).join('')}</select></label>
      <label class="slider">Taille <output id="o-refscale"></output>
        <input type="range" id="ref-scale" min="50" max="300" step="25"></label>
    </section>
    <section class="actions">
      <button type="button" data-action="undo">Annuler</button>
      <button type="button" data-action="clear" class="danger">Tout effacer</button>
      <button type="button" data-action="photo" class="wide">Exporter une photo</button>
    </section>
    <section>
      <h2>Projet</h2>
      <label class="row">Nom <input type="text" id="project-name" maxlength="40"></label>
      <div class="actions">
        <button type="button" data-action="save">Enregistrer</button>
        <button type="button" data-action="newProject">Nouveau projet</button>
      </div>
      <ul class="projects" id="projects"></ul>
      <p class="help" id="projects-where"></p>
      <div class="actions">
        <button type="button" data-action="downloadProject" title="Garder ce projet dans un fichier .vrpaint sur cet appareil">Télécharger</button>
        <label class="file-btn" title="Reprendre un projet téléchargé">Ouvrir un fichier<input type="file" id="project-file" accept=".vrpaint,application/octet-stream"></label>
      </div>
    </section>
    <section class="xr">
      <button type="button" id="enter-vr" class="primary" disabled>Entrer en VR</button>
      <button type="button" id="enter-ar" hidden>Entrer en AR (passthrough)</button>
      <p id="xr-status"></p>
      <label class="row" id="spectator-row">Vue sur le PC pendant la VR <select id="spectator">${SPECTATOR_MODES.map(([id, n]) => `<option value="${id}">${n}</option>`).join('')}</select></label>
      <p id="lan-url" class="lan" hidden></p>
    </section>
    <details>
      <summary>Commandes</summary>
      <ul class="help">
        <li><b>Clic gauche</b> : peindre (<b>Maj</b> : pression légère)</li>
        <li><b>Molette</b> : distance au mur · <b>Maj + molette</b> : angle du flat cap</li>
        <li><b>Clic droit + glisser</b> : regarder autour</li>
        <li><b>ZQSD</b> ou flèches : se déplacer · <b>A / E</b> : descendre / monter</li>
        <li><b>1 à 5</b> : caps · <b>Ctrl + Z</b> : annuler</li>
        <li><b>B</b> : bombe · <b>P</b> : pinceau rond / plat · <b>M</b> : caches · <b>R</b> : racloirs (couteau, spatule, grattoir) · <b>J</b> : papier journal · <b>T</b> : chalumeau</li>
        <li>Caches : <b>clic</b> poser / déplacer · <b>molette</b> taille · <b>Maj + molette</b> rotation · <b>Suppr</b> retirer</li>
        <li><b>N</b> : nuit · <b>V</b> : viseur · <b>C</b> : coulures · <b>X</b> : secouer</li>
        <li>Au doigt : <b>un doigt</b> peint · <b>deux doigts</b> regardent autour · <b>pincer</b> : largeur du jet ·
          <b>croix</b> : avancer, reculer, se décaler · <b>⤒ ⤓</b> : nacelle</li>
      </ul>
      <p class="help">Casque Quest : gâchette = peindre (pression analogique), viser la palette de l'autre main pour choisir. Toucher la pastille du haut pour personnaliser la couleur. Joystick gauche : marcher, droit : tourner / nacelle. A : viseur, B : annuler, X : palette, Y : nuit.</p>
    </details>`;

  panel.querySelectorAll('[data-cap] canvas').forEach((cv, i) => drawCapIcon(cv.getContext('2d'), CAPS[i], 0, 0, cv.width, cv.height, '#e8e8e8'));
  panel.querySelectorAll('[data-tool] canvas').forEach((cv, i) => drawToolIcon(cv.getContext('2d'), TOOLS[i].id, 0, 0, cv.width, cv.height, '#e8e8e8'));
  panel.querySelectorAll('[data-shape] canvas').forEach((cv, i) => drawShapeIcon(cv.getContext('2d'), SHAPES[i].id, 0, 0, cv.width, cv.height, '#9cc8e8'));

  const editor = $('#editor');
  let finish = finishOf(state.paint);
  const openEditor = () => {
    finish = finishOf(state.paint);
    editor.hidden = !editor.hidden;
    if (!editor.hidden && !state.paint.custom) setCustom(editorHex(state.paint), finish);
    sync({ paint: true });
  };

  panel.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.id === 'edit-current') openEditor();
    else if (b.dataset.paint) set({ paint: findPaint(b.dataset.paint) });
    else if (b.dataset.cap) set({ cap: b.dataset.cap, capScale: 1 });
    else if (b.dataset.tool) setTool(b.dataset.tool);
    else if (b.dataset.shape) set({ maskShape: b.dataset.shape });
    else if (b.dataset.brush) set({ brushSizes: { ...state.brushSizes, [b.dataset.brush]: +b.dataset.size } });
    else if (b.dataset.finish) { finish = b.dataset.finish; setCustom($('#custom-color').value, finish); }
    else if (b.id === 'save-color') { saveCurrentColor(); toast('Couleur enregistrée dans Mes couleurs'); }
    else if (b.id === 'apply-size') set({ wallWidth: +$('#wall-w').value, wallHeight: +$('#wall-h').value });
    else if (b.dataset.project) actions.openProject(b.dataset.project);
    else if (b.dataset.delete) {
      const p = (state.projects || []).find(x => x.id === b.dataset.delete);
      if (p && confirm(`Supprimer définitivement le projet « ${p.name} » ?`)) actions.deleteProject(p.id);
    }
    else if (b.dataset.action) actions[b.dataset.action]?.();
    b.blur();
  });
  $('#saved-colors').addEventListener('contextmenu', e => {
    const b = e.target.closest('[data-paint]');
    if (!b) return;
    e.preventDefault();
    removeSavedColor(+b.dataset.paint.slice(5));
  });
  $('#custom-color').addEventListener('input', e => setCustom(e.target.value, finish));
  $('#cap-scale').addEventListener('input', e => set({ capScale: e.target.value / 100 }));
  $('#pressure').addEventListener('input', e => set({ pressure: e.target.value / 100 }));
  $('#distance').addEventListener('input', e => set({ distance: e.target.value / 100 }));
  $('#angle').addEventListener('input', e => set({ angle: +e.target.value }));
  $('#mask-size').addEventListener('input', e => set({ maskSize: e.target.value / 200 }));
  panel.querySelectorAll('[data-size-range]').forEach(el => el.addEventListener('input', e => {
    set({ brushSizes: { ...state.brushSizes, [el.dataset.sizeRange]: e.target.value / 100 } });
  }));
  $('#mask-lift').addEventListener('input', e => set({ maskLift: e.target.value / 1000 }));
  $('#wall').addEventListener('change', e => set({ wall: e.target.value }));
  const sizeInput = () => {
    const w = +$('#wall-w').value, h = +$('#wall-h').value;
    $('#o-ww').textContent = num(w) + ' m';
    $('#o-wh').textContent = num(h) + ' m';
    $('#apply-size').hidden = w === state.wallWidth && h === state.wallHeight;
  };
  $('#wall-w').addEventListener('input', sizeInput);
  $('#wall-h').addEventListener('input', sizeInput);
  $('#project-file').addEventListener('change', e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) actions.openProjectFile(file);
  });
  $('#project-name').addEventListener('change', e => actions.renameProject(e.target.value.trim() || 'Sans titre'));
  for (const id of ['night', 'drips', 'spatter', 'realLoad', 'aim']) $('#' + id).addEventListener('change', e => set({ [id]: e.target.checked }));
  $('#ref-file').addEventListener('change', async e => {
    const files = [...e.target.files];
    e.target.value = '';
    if (!files.length) return;
    try { addRefs(await Promise.all(files.map(importImage))); toast(files.length > 1 ? `${files.length} modèles ajoutés` : 'Modèle ajouté'); }
    catch (err) { console.warn(err); toast('Image illisible'); }
  });
  $('#refs').addEventListener('click', e => {
    const del = e.target.closest('[data-delref]');
    if (del) { removeRef(del.dataset.delref); return; }
    const pick = e.target.closest('[data-ref]');
    if (pick) set({ refIndex: +pick.dataset.ref, refShow: true });
  });
  $('#ref-show').addEventListener('change', e => set({ refShow: e.target.checked }));
  $('#ref-easel').addEventListener('change', e => set({ refEasel: e.target.checked }));
  $('#ref-side').addEventListener('change', e => set({ refSide: e.target.value }));
  $('#ref-scale').addEventListener('input', e => set({ refScale: e.target.value / 100 }));
  $('#enter-vr').addEventListener('click', () => actions.enterVR());
  $('#enter-ar').addEventListener('click', () => actions.enterAR());
  $('#panel-toggle').addEventListener('click', () => document.body.classList.toggle('panel-open'));
  $('#spectator').addEventListener('change', e => set({ spectator: e.target.value }));
  // dans le navigateur du casque, personne ne regarde la page
  $('#spectator-row').hidden = /OculusBrowser|Quest|Pico/i.test(navigator.userAgent);

  // Barre de la vue spectateur, affichée pendant une session VR rendue par le PC
  const bar = $('#specbar');
  bar.innerHTML = SPECTATOR_MODES.map(([id, n]) => `<button type="button" data-spec="${id}">${n}</button>`).join('') +
    '<button type="button" data-spec="full" title="Plein écran (Échap pour sortir)">Plein écran</button>' +
    '<span class="msg">Vue coupée : le PC ne calcule que l\'image du casque.</span>';
  bar.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.spec !== 'full') set({ spectator: b.dataset.spec });
    else if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.().catch(() => toast('Plein écran refusé par le navigateur'));
    b.blur();
  });
  $('#touch-drag').addEventListener('change', e => set({ touchDrag: e.target.value }));
  $('#touch-pinch').addEventListener('change', e => set({ touchPinch: e.target.value }));
  $('#touch-pad-on').addEventListener('change', e => set({ touchPad: e.target.checked }));

  let lastProjects = null, lastSaved = null, lastRefs = null;
  const sync = (patch = {}) => {
    const p = state.paint;
    $('.current .dot', panel).setAttribute('style', swatchStyle(p));
    $('.current strong', panel).textContent = p.name;
    $('.current small', panel).textContent = p.group;
    if (lastSaved !== state.savedColors) {
      lastSaved = state.savedColors;
      const saved = savedPaints();
      $('#saved-colors').innerHTML = saved.length ? saved.map(swatch).join('') : '<p class="help">Aucune pour l\'instant : personnalise une couleur puis « Enregistrer ».</p>';
    }
    panel.querySelectorAll('.sw').forEach(b => b.classList.toggle('on', b.dataset.paint === p.id));
    panel.querySelectorAll('[data-cap]').forEach(b => b.classList.toggle('on', b.dataset.cap === state.cap));
    panel.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === state.tool));
    panel.querySelectorAll('[data-shape]').forEach(b => b.classList.toggle('on', b.dataset.shape === state.maskShape));
    const scr = scraperById(state.tool);
    $('#mask-opts').hidden = state.tool !== 'cache';
    $('#scraper-help').hidden = !scr;
    const br = brushById(state.tool);
    panel.querySelectorAll('[data-brush-opts]').forEach(el => { el.hidden = el.dataset.brushOpts !== state.tool; });
    panel.querySelectorAll('[data-brush]').forEach(b => b.classList.toggle('on', +b.dataset.size === toolSize(b.dataset.brush)));
    $('#brush-help').hidden = !br;
    $('#paper-help').hidden = state.tool !== NEWSPAPER.id;
    $('#sponge-help').hidden = state.tool !== SPONGE.id;
    panel.querySelectorAll('[data-size-range]').forEach(el => {
      const cm = Math.round(toolSize(el.dataset.sizeRange) * 100);
      el.value = cm;
      panel.querySelector(`[data-size-out="${el.dataset.sizeRange}"]`).textContent = cm + ' cm';
    });
    $('#torch-help').hidden = state.tool !== TORCH.id;
    $('#mask-size').value = Math.round(state.maskSize * 200);
    $('#o-msize').textContent = Math.round(state.maskSize * 200) + ' cm';
    $('#mask-lift').value = Math.round(state.maskLift * 1000);
    $('#o-mlift').textContent = Math.round(state.maskLift * 1000) + ' mm';
    if (!editor.hidden) {
      if ('paint' in patch || patch.init) $('#custom-color').value = editorHex(p);
      panel.querySelectorAll('[data-finish]').forEach(b => b.classList.toggle('on', b.dataset.finish === finish));
    }
    const cap = currentCap();
    $('#cap-scale').value = Math.round(state.capScale * 100);
    $('#o-scale').textContent = `${Math.round(state.capScale * 100)} % · ≈ ${Math.round(strokeWidthCm(cap, state.distance))} cm`;
    $('#pressure').value = Math.round(state.pressure * 100);
    $('#o-pressure').textContent = Math.round(state.pressure * 100) + ' %';
    $('#distance').value = Math.round(state.distance * 100);
    $('#o-distance').textContent = Math.round(state.distance * 100) + ' cm';
    $('#angle').value = state.angle;
    $('#o-angle').textContent = state.angle + '°';
    $('#angle-row').classList.toggle('dim', (state.tool === 'bombe' && state.cap !== 'flat') || state.tool === NEWSPAPER.id || state.tool === SPONGE.id || state.tool === TORCH.id || br?.kind === 'rond');
    $('#wall').value = state.wall;
    if ('wallWidth' in patch || 'wallHeight' in patch || patch.init) {
      $('#wall-w').value = state.wallWidth;
      $('#wall-h').value = state.wallHeight;
      sizeInput();
    }
    if (lastRefs !== state.refs || 'refIndex' in patch) {
      lastRefs = state.refs;
      $('#refs').innerHTML = (state.refs || []).map((r, i) => `
        <span class="ref ${i === state.refIndex ? 'on' : ''}"><img data-ref="${i}" src="${refUrl(r)}" alt="${esc(r.name)}" title="${esc(r.name)}">
        <button type="button" data-delref="${r.id}" title="Retirer">✕</button></span>`).join('');
    }
    $('#ref-show').checked = state.refShow;
    $('#ref-easel').checked = !!state.refEasel;
    $('#ref-side').value = state.refSide || 'droite';
    $('#ref-scale').value = Math.round((state.refScale || 1) * 100);
    $('#o-refscale').textContent = Math.round((state.refScale || 1) * 100) + ' %';
    const ref = currentRef(), view = $('#refview');
    view.hidden = !(ref && state.refShow);
    if (ref) { $('img', view).src = refUrl(ref); view.style.setProperty('--ref-h', `${Math.round(180 * (state.refScale || 1))}px`); }
    $('#spectator').value = state.spectator;
    bar.querySelectorAll('[data-spec]').forEach(b => b.classList.toggle('on', b.dataset.spec === state.spectator));
    $('#night').checked = state.night;
    $('#drips').checked = state.drips;
    $('#spatter').checked = state.spatter;
    $('#realLoad').checked = state.realLoad;
    $('#aim').checked = state.aim;
    $('#touch-drag').value = state.touchDrag;
    $('#touch-pinch').value = state.touchPinch;
    $('#touch-pad-on').checked = state.touchPad;
    document.body.classList.toggle('pad-off', !state.touchPad);
    if (document.activeElement !== $('#project-name')) $('#project-name').value = state.projectName;
    if (lastProjects !== state.projects || 'projectId' in patch) {
      lastProjects = state.projects;
      $('#projects').innerHTML = (state.projects || []).map(pr => `
        <li class="${pr.id === state.projectId ? 'on' : ''}">
          <button type="button" class="open" data-project="${pr.id}" title="Ouvrir">
            ${pr.thumb ? `<img src="${pr.thumb}" alt="">` : '<span class="nothumb"></span>'}
            <span><strong>${esc(pr.name)}</strong><small>${pr.wallWidth} × ${num(pr.wallHeight)} m · ${new Date(pr.date).toLocaleDateString('fr-FR')}</small></span>
          </button>
          <button type="button" class="del" data-delete="${pr.id}" title="Supprimer">✕</button>
        </li>`).join('') || '<li class="help">Aucun projet enregistré.</li>';
      const where = projectsWhere();
      $('#projects-where').textContent = where === 'pc' ? 'Enregistrés sur le PC : les mêmes dans le casque.'
        : where === 'navigateur' ? 'Enregistrés dans ce navigateur seulement (jeu non servi par le PC) : « Télécharger » en garde une copie.' : '';
    }
    const tool = TOOLS.find(t => t.id === state.tool);
    $('#hud').innerHTML = state.tool === 'cache'
      ? `Caches · ${SHAPES.find(s => s.id === state.maskShape)?.name} ${Math.round(state.maskSize * 200)} cm · décollé de ${Math.round(state.maskLift * 1000)} mm`
      : scr ? `${tool.name} · pression ${Math.round(state.pressure * 100)} % · lame à ${state.angle}°`
      : br ? `<span class="dot" style="${swatchStyle(p)}"></span>${esc(p.name)} · ${tool.name} ${num(Math.round(brushSize(br, state.brushSizes) * 1000) / 10)} cm · pression ${Math.round(state.pressure * 100)} %${br.kind === 'plat' ? ` · ${state.angle}°` : ''}`
      : state.tool === SPONGE.id ? `<span class="dot" style="${swatchStyle(p)}"></span>${esc(p.name)} · Éponge ${num(Math.round(toolSize(SPONGE.id) * 1000) / 10)} cm · pression ${Math.round(state.pressure * 100)} %`
      : state.tool === NEWSPAPER.id ? `Papier journal ${num(Math.round(toolSize(NEWSPAPER.id) * 1000) / 10)} cm · pression ${Math.round(state.pressure * 100)} %`
      : state.tool === TORCH.id ? `Chalumeau · flamme ${Math.round(toolSize(TORCH.id) * 100)} cm · à ${Math.round(state.distance * 100)} cm du mur${state.distance > torchReach(toolSize(TORCH.id)) ? ' (trop loin pour chauffer)' : ''}`
        : `<span class="dot" style="${swatchStyle(p)}"></span>${esc(p.name)} · ${cap.name} ${Math.round(state.capScale * 100)} % · ${Math.round(state.distance * 100)} cm · ${Math.round(state.pressure * 100)} %`;
  };
  subscribe(sync);
  sync({ init: true });
  showLanAddress();
}

// Adresse à taper dans le navigateur du casque. Hébergé en ligne, c'est
// l'adresse de la page elle-même ; servi par le PC, elle change avec le réseau
// et adresse.php la donne.
const LOCAL_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1)|\.(local|localhost|test)$/;

async function showLanAddress() {
  const el = $('#lan-url');
  if (!LOCAL_HOST.test(location.hostname)) {
    el.innerHTML = `Dans le navigateur du casque :<br><b>${esc(location.origin + location.pathname)}</b>`;
    el.hidden = false;
    return;
  }
  try {
    const list = await (await fetch('adresse.php', { cache: 'no-store' })).json();
    if (!Array.isArray(list) || !list.length) return;
    el.innerHTML = 'Dans le navigateur du casque (même Wi-Fi) :<br>' +
      list.map(a => `<b>${esc(a.url)}</b> <small>${esc(a.carte.trim())}</small>`).join('<br>');
    el.hidden = false;
  } catch { /* pas de serveur PHP : rien à afficher */ }
}

const refUrls = new Map();
function refUrl(ref) {
  if (!refUrls.has(ref.id)) refUrls.set(ref.id, URL.createObjectURL(ref.blob));
  return refUrls.get(ref.id);
}

function findPaint(id) {
  return PAINTS.find(p => p.id === id) || savedPaints().find(p => p.id === id);
}

export function setXRSupport({ vr, ar, reason }) {
  $('#enter-vr').disabled = !vr;
  $('#enter-ar').hidden = !ar;
  $('#xr-status').textContent = vr ? '' : reason;
}

let toastTimer;
export function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}
