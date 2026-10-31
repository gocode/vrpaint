import * as THREE from 'three';
import { PAINTS } from './palette.js';
import { Spray } from './spray.js';
import { PaintSurface } from './paint.js';
import { World } from './world.js';
import { state, set, subscribe, actions, currentCap, WALL_LIMITS } from './state.js';
import { Stencils } from './stencils.js';
import { Scraper, scraperById } from './scraper.js';
import { DesktopControls } from './desktop.js';
import { XRControls } from './xr.js';
import { VRPalette } from './vrui.js';
import { buildUI, setXRSupport, toast } from './ui.js';
import { SprayAudio } from './audio.js';
import { saveProject, loadProject, listProjects, deleteProject, renameProject, newProjectId, moveLocalProjects, projectFile, importProjectFile } from './storage.js';
import { runTest } from './test.js';
import { History } from './history.js';
import { CanvasManager } from './canvases.js';
import { RefBoard } from './refs.js';
import { Spectator } from './spectator.js';
import { FrameScheduler } from './frames.js';

const params = new URLSearchParams(location.search);
const headset = /OculusBrowser|Quest|Pico/i.test(navigator.userAgent);
const mobile = headset || /Android|iPhone|iPad/i.test(navigator.userAgent);
const clampTo = (v, [a, b]) => Math.min(b, Math.max(a, v));
const WALL = {
  width: clampTo(state.wallWidth, WALL_LIMITS.width),
  height: clampTo(state.wallHeight, WALL_LIMITS.height),
  z: -1,
};

// Résolution de la peinture : ~2 mm par texel sur Quest 2, ~1,5 mm sur PC,
// 4096 texels au plus.
function surfaceOptions(W, H) {
  const texel = mobile ? 0.002 : 0.0015;
  let res = Math.min(+params.get('res') || 4096, Math.ceil(W / texel));
  if (res * H / W > 4096) res = Math.floor(4096 * W / H);
  return { width: W, height: H, res, auxRes: Math.max(512, Math.round(res / 4)), history };
}
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
// Fovéation fixe : le bord de l'image est calculé en plus basse définition. La palette,
// tenue bas devant soi, tombe dans ce bord : à 0,6 son texte devenait flou.
renderer.xr.setFoveation(0.3);
if (!renderer.extensions.has('EXT_color_buffer_float') && !renderer.extensions.has('EXT_color_buffer_half_float')) {
  console.warn('Render targets flottants non supportés : la peinture risque de ne pas s\'afficher.');
}

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.02, 400);
const rig = new THREE.Group();
rig.add(camera);
scene.add(rig);

// Historique d'annulation commun à toutes les surfaces (budget mémoire GPU ;
// chaque carreau garde aussi sa couche « fond », d'où un budget plus large)
const history = new History(renderer, { budgetBytes: mobile ? 200e6 : 900e6 });
let surface = new PaintSurface(renderer, surfaceOptions(WALL.width, WALL.height));
const world = new World(scene, renderer, surface, WALL);
rig.add(world.lift);

// Toiles : le mur principal + les devantures de la rue (créées au premier coup de bombe)
const canvases = new CanvasManager({ renderer, scene, history, glowK: world.wallUniforms.uGlowK, mobile });
canvases.setOverlays(world.street.canvases);
const wallCanvas = {
  id: 'mur',
  frame: world.wallFrame,
  get width() { return WALL.width; },
  get height() { return WALL.height; },
  ensureSurface: () => surface,
  masks: [],
  maskVersion: 0,
};
surface.maskSource = wallCanvas;
const allCanvases = () => [wallCanvas, ...canvases.overlays];
const spray = new Spray();
spray.setCanvases(allCanvases());
spray.onStrokeStart = () => history.begin('trait');
// Caches et racloirs
const stencils = new Stencils({ scene, history, canvases: allCanvases });
stencils.onChange = () => markDirty();
const scraper = new Scraper({ project: (o, d, r, u) => spray.project(o, d, r, u) });
scraper.onStrokeStart = () => history.begin('raclage');
for (const m of scraper.meshes.values()) scene.add(m);
const tools = { stencils, scraper, spray };

const audio = new SprayAudio();
const palette = new VRPalette();
const desktop = new DesktopControls({ camera, rig, canvas, world, audio, wall: WALL, canvases: allCanvases, tools });
const xr = new XRControls({ renderer, rig, camera, palette, world, audio, wall: WALL, tools });
const refBoard = new RefBoard({ scene, palette, wall: WALL });
// Vue spectateur sur l'écran du PC pendant une session Link. Dans le navigateur
// du casque, personne ne voit la page : on n'y dépense rien.
const spectator = headset ? null : new Spectator({ renderer, scene, wall: WALL });

function flushAll() {
  surface.flush();
  canvases.flush();
}

function applyState(patch) {
  if ('paint' in patch) { spray.paint = state.paint; world.setCanPaint(state.paint); }
  if ('cap' in patch || 'capScale' in patch) spray.cap = currentCap();
  if ('drips' in patch) spray.dripsEnabled = state.drips;
  if ('spatter' in patch) spray.spatter = state.spatter;
  if ('night' in patch) { world.setNight(state.night); world.setCanPaint(state.paint); }
  if ('wall' in patch) world.setWallType(state.wall);
  if ('wallWidth' in patch || 'wallHeight' in patch) resizeWall(state.wallWidth, state.wallHeight);
  if ('spectator' in patch && spectator) {
    spectator.mode = state.spectator;
    spectator.fresh = true;
    document.body.classList.toggle('spec-off', state.spectator === 'off');
  }
}
subscribe(applyState);
applyState({ paint: 1, cap: 1, drips: 1, spatter: 1, night: 1, wall: 1, spectator: 1 });

// --- Taille du mur ------------------------------------------------------------
// La peinture est reprise telle quelle dans le monde : mur centré, pied fixe.
// L'ancien mur est gardé dans l'historique : Annuler le rend intact, y compris
// la partie que le redimensionnement avait coupée.
function applySurface(s, W, H) {
  // les caches du mur gardent leur place dans le monde (mur centré)
  for (const m of wallCanvas.masks) m.x += (W - WALL.width) / 2;
  surface = s;
  surface.maskSource = wallCanvas;
  WALL.width = W;
  WALL.height = H;
  world.setWallSize(surface);
  stencils.changed(wallCanvas);
  world.setWallType(state.wall);
  spray.reset();
  if (state.wallWidth !== W || state.wallHeight !== H) set({ wallWidth: W, wallHeight: H });
  if (!renderer.xr.isPresenting) desktop.reset();
  refBoard.update();
}

function resizeWall(W, H, { keepPaint = true, record = true } = {}) {
  W = clampTo(W, WALL_LIMITS.width);
  H = clampTo(H, WALL_LIMITS.height);
  if (W === WALL.width && H === WALL.height) return;
  flushAll();
  const old = surface, oldW = WALL.width, oldH = WALL.height;
  const next = new PaintSurface(renderer, surfaceOptions(W, H));
  if (keepPaint) {
    next.copyFrom(old, new THREE.Vector2(W / old.width, H / old.height), new THREE.Vector2(0.5 - W / (2 * old.width), 0));
  }
  applySurface(next, W, H);
  if (record) {
    history.pushCustom({
      label: 'taille du mur',
      bytes: old.bytes,
      undo: () => {
        const cur = surface;
        applySurface(old, oldW, oldH);
        history.forget(cur);
        cur.dispose();
      },
      dispose: () => { if (surface !== old) old.dispose(); },
    });
  } else {
    old.dispose();
  }
  markDirty();
  notify(`Mur de ${W} × ${H} m`);
}
// --- Image du mur (photo, vignette de projet, contrôle) -------------------------
function readWall(w, h) {
  flushAll();
  const rt = new THREE.WebGLRenderTarget(w, h, { colorSpace: THREE.SRGBColorSpace });
  const cam = new THREE.OrthographicCamera(-WALL.width / 2, WALL.width / 2, WALL.height, 0, 0.001, 0.1);
  cam.position.set(0, 0, WALL.z + 0.05);
  const hidden = [world.cursor, world.can, stencils.group, ...scraper.meshes.values()].filter(o => o.visible);
  hidden.forEach(o => { o.visible = false; });
  const prev = renderer.getRenderTarget(), xrOn = renderer.xr.enabled;
  renderer.xr.enabled = false;
  renderer.setRenderTarget(rt);
  renderer.render(scene, cam);
  renderer.setRenderTarget(prev);
  renderer.xr.enabled = xrOn;
  hidden.forEach(o => { o.visible = true; });
  const px = new Uint8Array(w * h * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, w, h, px);
  rt.dispose();
  const out = new Uint8ClampedArray(w * h * 4), row = w * 4;
  for (let y = 0; y < h; y++) out.set(px.subarray((h - 1 - y) * row, (h - y) * row), y * row);
  return out;
}

function wallImage(w) {
  const h = Math.round(w * WALL.height / WALL.width);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').putImageData(new ImageData(readWall(w, h), w, h), 0, 0);
  return c;
}

function exportPhoto() {
  const c = wallImage(surface.res[0]);
  c.toBlob(blob => {
    const a = document.createElement('a');
    a.download = `${(state.projectName || 'vrpaint').replace(/[^\w-]+/g, '_')}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.png`;
    a.href = URL.createObjectURL(blob);
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }, 'image/png');
  notify('Photo exportée');
}

// --- Projets -------------------------------------------------------------------
// loadedDate : date de la version ouverte. Les projets sont communs au PC et au casque :
// si l'autre appareil enregistre une version plus récente du projet ouvert ici (sans
// modification en cours), elle est rechargée.
let dirty = false, lastPaint = 0, saving = null, loadedId = null, loadedDate = 0, following = false;
function markDirty() { dirty = true; lastPaint = performance.now(); }

const newerElsewhere = id => {
  const p = (state.projects || []).find(x => x.id === id);
  return !!p && id === loadedId && p.date > loadedDate;
};

async function refreshProjects() {
  try { set({ projects: await listProjects() }); } catch (e) { console.warn(e); return; }
  if (!dirty && !saving && !following && newerElsewhere(loadedId)) {
    following = true;
    try { await openProject(loadedId, 'Projet mis à jour depuis l\'autre appareil'); } finally { following = false; }
  }
}

async function currentProject(id) {
  return {
    id,
    name: state.projectName,
    wall: state.wall,
    wallWidth: WALL.width,
    wallHeight: WALL.height,
    savedColors: state.savedColors,
    thumb: wallImage(240).toDataURL('image/jpeg', 0.75),
    layers: await surface.exportLayers(),
    // devantures peintes de la rue
    extra: Object.fromEntries(await Promise.all(canvases.painted().map(async c => [c.id, await c.surface.exportLayers()]))),
    refs: state.refs,
    masks: stencils.serialize(),
  };
}

async function saveCurrent(manual = false) {
  if (saving) await saving;
  if (!dirty && !manual) return;
  dirty = false;
  saving = (async () => {
    try {
      const id = state.projectId || newProjectId();
      const rec = await saveProject(await currentProject(id));
      // projet enregistré entre-temps sur l'autre appareil : cette version a été gardée à part
      if (rec.id !== id) notify(`Modifié aussi sur l'autre appareil : ta version devient « ${rec.name} »`);
      if (state.projectId !== rec.id || state.projectName !== rec.name) set({ projectId: rec.id, projectName: rec.name });
      loadedId = rec.id;
      loadedDate = rec.date;
      await refreshProjects();
      if (manual) notify(`« ${state.projectName} » enregistré`);
    } catch (e) {
      console.warn('Sauvegarde impossible', e);
      dirty = true;
      if (manual) notify('Sauvegarde impossible');
    }
  })();
  await saving;
  saving = null;
}

function nextName() {
  const names = new Set((state.projects || []).map(p => p.name));
  let n = (state.projects || []).length + 1;
  while (names.has('Mur ' + n)) n++;
  return 'Mur ' + n;
}

// Nouveau projet : mur vierge, mêmes réglages et mêmes couleurs perso pour démarrer.
async function newProject() {
  await saveCurrent();
  spray.reset();
  scraper.reset();
  surface.clear(false);
  canvases.disposeAll();
  stencils.load({});
  history.reset();
  set({ projectId: null, projectName: nextName() });
  loadedId = null;
  loadedDate = 0;
  dirty = false;
  notify(`Nouveau projet : ${state.projectName}`);
}

async function openProject(id, message = null) {
  if (id === loadedId && !dirty && !newerElsewhere(id)) return;
  await saveCurrent();
  const p = await loadProject(id);
  if (!p) { notify('Projet introuvable'); return refreshProjects(); }
  spray.reset();
  resizeWall(p.wallWidth || 6, p.wallHeight || 3, { keepPaint: false, record: false });
  surface.clear(false);
  surface.importLayers(p.layers);
  canvases.disposeAll();
  for (const [cid, layers] of Object.entries(p.extra || {})) canvases.byId(cid)?.ensureSurface().importLayers(layers);
  // projets d'avant les caches : aucun cache, et un fond vide (le raclage révèle le mur)
  stencils.load(p.masks || {});
  scraper.reset();
  history.reset();
  set({ projectId: p.id, projectName: p.name, wall: p.wall || state.wall, savedColors: p.savedColors || [], refs: p.refs || [] });
  loadedId = p.id;
  loadedDate = p.date;
  dirty = false;
  notify(message || `Projet « ${p.name} » ouvert`);
}

async function removeProject(id) {
  await deleteProject(id);
  if (id === state.projectId) { set({ projectId: null }); dirty = true; }
  await refreshProjects();
  notify('Projet supprimé');
}

// Fichier .vrpaint sur l'appareil, pour reprendre le projet plus tard ailleurs ou si le
// navigateur a effacé ses projets (version en ligne). Le projet est d'abord enregistré :
// le fichier porte la même version, et le rouvrir ici ne crée pas de doublon.
async function downloadProjectFile() {
  await saveCurrent();
  const id = state.projectId || newProjectId();
  const blob = await projectFile({ ...await currentProject(id), date: !dirty && id === loadedId ? loadedDate : Date.now() });
  const a = document.createElement('a');
  a.download = `${(state.projectName || 'vrpaint').replace(/[^\p{L}\p{N}_-]+/gu, '_')}.vrpaint`;
  a.href = URL.createObjectURL(blob);
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 30e3);
  notify(`« ${state.projectName} » téléchargé`);
}

async function openProjectFile(file) {
  try {
    const { id, known } = await importProjectFile(file);
    await refreshProjects();
    const name = (state.projects || []).find(p => p.id === id)?.name || file.name;
    if (known && id === loadedId && !dirty) notify(`« ${name} » est déjà ouvert, dans cette version`);
    else await openProject(id, known ? `« ${name} » était déjà dans la liste : ouvert` : `« ${name} » ajouté depuis le fichier`);
  } catch (e) {
    console.warn('Fichier de projet illisible', e);
    notify(`Fichier illisible : ${e.message}`);
  }
}

actions.newProject = newProject;
actions.downloadProject = downloadProjectFile;
actions.openProjectFile = openProjectFile;
actions.openProject = id => openProject(id);
actions.refreshProjects = refreshProjects;
actions.deleteProject = removeProject;
actions.renameProject = async name => {
  set({ projectName: name });
  if (state.projectId) { await renameProject(state.projectId, name); await refreshProjects(); }
};
actions.save = () => saveCurrent(true);
addEventListener('visibilitychange', () => { if (document.hidden) saveCurrent(); else refreshProjects(); });
// liste tenue à jour : un projet enregistré sur l'autre appareil apparaît ici
setInterval(() => { if (!document.hidden) refreshProjects(); }, 15e3);

function notify(msg) {
  toast(msg);
  palette.flash(msg);
}
actions.notify = notify;

actions.undo = () => {
  spray.reset();
  scraper.reset();
  stencils.commit();
  flushAll();
  const rec = history.undo();
  if (!rec) { notify('Rien à annuler'); return; }
  markDirty();
  const left = history.count;
  notify(`Annulé${rec.label ? ' : ' + rec.label : ''}${left ? ` (encore ${left})` : ''}`);
};
// « Tout effacer » vide le mur et les devantures peintes, en un seul geste annulable.
actions.clear = () => {
  spray.reset();
  scraper.reset();
  history.begin('effacement');
  surface.clear();
  canvases.clearAll(true);
  history.begin();
  markDirty();
  notify('Tout est effacé (Annuler pour revenir)');
};
actions.photo = exportPhoto;
actions.removeMasks = () => {
  const n = stencils.removeAll();
  notify(n ? `${n > 1 ? n + ' caches retirés' : 'Cache retiré'} (Annuler pour les remettre)` : 'Aucun cache posé');
};
actions.enterVR = () => enterXR('immersive-vr');
actions.enterAR = () => enterXR('immersive-ar');
// la fin de session passe par 'sessionend' plus bas, qui enregistre le projet
actions.exitXR = () => renderer.xr.getSession()?.end();

// --- WebXR -------------------------------------------------------------------
async function enterXR(mode) {
  audio.ensure();
  try {
    const session = await navigator.xr.requestSession(mode, {
      requiredFeatures: ['local-floor'],
      optionalFeatures: ['bounded-floor'],
    });
    world.setAR(mode === 'immersive-ar');
    if (mode === 'immersive-ar') renderer.setClearColor(0x000000, 0);
    await renderer.xr.setSession(session);
  } catch (e) {
    console.error(e);
    notify('Impossible de lancer la session : ' + e.message);
  }
}

renderer.xr.addEventListener('sessionstart', () => {
  rig.position.set(0, 0, WALL.z + 0.85);
  rig.rotation.set(0, 0, 0);
  camera.position.set(0, 0, 0);
  camera.rotation.set(0, 0, 0);
  xr.start();
  spectator?.start();
  if (spectator) document.body.classList.add('xr-live');
});
renderer.xr.addEventListener('sessionend', () => {
  xr.end();
  spectator?.end();
  document.body.classList.remove('xr-live');
  world.setAR(false);
  renderer.setClearColor(0x000000, 1);
  // Three.js a laissé à la caméra le champ du casque et rendu au canvas sa taille du début
  camera.fov = 60;
  camera.zoom = 1;
  resize();
  desktop.reset();
  saveCurrent();
});

async function detectXR() {
  if (!navigator.xr) {
    const reason = window.isSecureContext
      ? 'WebXR indisponible sur ce navigateur (utilisez le navigateur du Quest).'
      : 'WebXR exige une page sécurisée : ouvrez-la en https:// ou via localhost (voir README).';
    setXRSupport({ vr: false, ar: false, reason });
    return;
  }
  const [vr, ar] = await Promise.all([
    navigator.xr.isSessionSupported('immersive-vr').catch(() => false),
    navigator.xr.isSessionSupported('immersive-ar').catch(() => false),
  ]);
  setXRSupport({ vr, ar, reason: 'Aucun casque VR détecté sur ce navigateur.' });
}

// --- Démarrage ----------------------------------------------------------------
buildUI();
detectXR();
// casque branché après l'ouverture de la page (Link, Air Link) : le bouton se réactive
navigator.xr?.addEventListener('devicechange', detectXR);
if (!params.has('test')) {
  (async () => {
    const moved = await moveLocalProjects().catch(e => { console.warn('Copie des projets locaux impossible', e); return 0; });
    if (moved) notify(`${moved} projet${moved > 1 ? 's' : ''} de ce navigateur ajouté${moved > 1 ? 's' : ''} aux projets du PC`);
    await refreshProjects();
    const list = state.projects || [];
    const last = list.find(p => p.id === state.projectId) || list[0];
    if (last) await openProject(last.id);
    else if (!state.projectName) set({ projectName: 'Mur 1' });
  })().catch(e => console.warn('Restauration impossible', e));
}

// Centre la vue sur la zone non couverte par le panneau latéral.
function resize() {
  if (renderer.xr.isPresenting) return;   // la vue spectateur suit seule la fenêtre
  const w = innerWidth, h = innerHeight, side = w > 760 ? 300 : 0;
  camera.aspect = w / h;
  if (side) camera.setViewOffset(w + side, h, 0, 0, w, h);
  else camera.clearViewOffset();
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}
addEventListener('resize', resize);
resize();

// Toutes les couches de toutes les surfaces (contrôle d'annulation exacte)
async function exportAll() {
  flushAll();
  const out = { mur: await surface.exportLayers() };
  for (const c of canvases.painted()) out[c.id] = await c.surface.exportLayers();
  return out;
}

const test = params.has('test') ? runTest({ set, state, PAINTS, world, WALL, params, readWall, stencils, wallCanvas, exportAll, history }) : null;
window.__vrpaint = {
  get surface() { return surface; }, spray, history, canvases, stencils, scraper, wallCanvas, exportAll,
  state, set, actions, world, renderer, readWall, resizeWall, desktop, rig, palette, spectator, xr,
};

// Hors casque, pas d'image recalculée quand l'écran n'a pas à changer.
// ?frames=all rend toutes les images (comparaison).
const frames = new FrameScheduler(renderer, camera);
const allFrames = params.get('frames') === 'all';
subscribe(() => frames.invalidate());
addEventListener('resize', () => frames.invalidate(300));
for (const ev of ['pointermove', 'pointerdown', 'pointerup', 'wheel', 'keydown', 'keyup', 'focus'])
  addEventListener(ev, () => frames.invalidate(150), { passive: true });
document.addEventListener('visibilitychange', () => frames.invalidate());
window.__vrpaint.frames = frames;

const clock = new THREE.Clock();
const _camPos = new THREE.Vector3();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  const presenting = renderer.xr.isPresenting;
  const input = presenting ? xr.update(dt) : desktop.update(dt);
  // l'outil en main reçoit l'entrée ; les coulures continuent quoi qu'il arrive
  const step = (h, inp) => {
    const scr = scraperById(state.tool);
    const sprayed = spray.update(h, state.tool === 'bombe' ? inp : null);
    const scraped = scraper.update(h, scr ? inp : null, scr);
    return sprayed || scraped;
  };
  let spraying;
  if (test) {
    // test : plusieurs pas de simulation par image (le rendu logiciel est lent)
    for (let k = 0; k < 40; k++) spraying = step(1 / 60, test.step() || input);
  } else {
    spraying = step(dt, input);
  }
  if (spraying || spray.drips.length) markDirty();
  flushAll();
  world.update(dt, renderer.xr.isPresenting ? renderer.xr.getCamera() : camera, renderer.getPixelRatio());
  audio.setSpray(spray.pressure, spray.cap);
  audio.setScrape(scraper.pressure, scraper.speed);
  audio.setTraffic(world.traffic.nearest(camera.getWorldPosition(_camPos)));
  const scr = scraperById(state.tool);
  if (scr) world.updateCursor(scraper.hit, null, state.aim && !!input && !test && !presenting, [scr.width / 2, 0.0025]);
  else world.updateCursor(spray.hit, spray.cap, state.aim && !!input && !test && (!presenting || (spray.hit && spray.hit.t < 0.9)));
  const inHand = presenting || (!!input && !test);
  world.can.visible = inHand && state.tool === 'bombe';
  for (const [id, m] of scraper.meshes) m.visible = inHand && id === state.tool;
  world.updateLift(rig);

  if (dirty && !saving && !spraying && !spray.drips.length && performance.now() - lastPaint > 4000 && !test) saveCurrent();
  const draw = presenting || test || allFrames || input || spraying || spray.drips.length
    || frames.shouldRender(world.motion(camera));
  if (!draw) return;
  renderer.render(scene, camera);
  frames.rendered();
  if (presenting) spectator?.render(dt, renderer.xr.getCamera());
  if (test) test.after(renderer);
});
