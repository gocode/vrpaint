import * as THREE from 'three';
import { PAINTS } from './palette.js';
import { Spray } from './spray.js';
import { PaintSurface } from './paint.js';
import { World } from './world.js';
import { state, set, subscribe, actions, currentCap, WALL_LIMITS } from './state.js';
import { DesktopControls } from './desktop.js';
import { XRControls } from './xr.js';
import { VRPalette } from './vrui.js';
import { buildUI, setXRSupport, toast } from './ui.js';
import { SprayAudio } from './audio.js';
import { saveProject, loadProject, listProjects, deleteProject, renameProject, newProjectId } from './storage.js';
import { runTest } from './test.js';
import { History } from './history.js';
import { CanvasManager } from './canvases.js';
import { RefBoard } from './refs.js';

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
renderer.xr.setFoveation(0.6);
if (!renderer.extensions.has('EXT_color_buffer_float') && !renderer.extensions.has('EXT_color_buffer_half_float')) {
  console.warn('Render targets flottants non supportés : la peinture risque de ne pas s\'afficher.');
}

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.02, 400);
const rig = new THREE.Group();
rig.add(camera);
scene.add(rig);

// Historique d'annulation commun à toutes les surfaces (budget mémoire GPU)
const history = new History(renderer, { budgetBytes: mobile ? 120e6 : 600e6 });
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
};
const allCanvases = () => [wallCanvas, ...canvases.overlays];
const spray = new Spray();
spray.setCanvases(allCanvases());
spray.onStrokeStart = () => history.begin('trait');

const audio = new SprayAudio();
const palette = new VRPalette();
const desktop = new DesktopControls({ camera, rig, canvas, world, audio, wall: WALL, canvases: allCanvases });
const xr = new XRControls({ renderer, rig, camera, palette, world, audio, wall: WALL });
const refBoard = new RefBoard({ scene, palette, wall: WALL });

function flushAll() {
  surface.flush();
  canvases.flush();
}

function applyState(patch) {
  if ('paint' in patch) { spray.paint = state.paint; world.setCanPaint(state.paint); }
  if ('cap' in patch || 'capScale' in patch) spray.cap = currentCap();
  if ('drips' in patch) spray.dripsEnabled = state.drips;
  if ('night' in patch) { world.setNight(state.night); world.setCanPaint(state.paint); }
  if ('wall' in patch) world.setWallType(state.wall);
  if ('wallWidth' in patch || 'wallHeight' in patch) resizeWall(state.wallWidth, state.wallHeight);
}
subscribe(applyState);
applyState({ paint: 1, cap: 1, drips: 1, night: 1, wall: 1 });

// --- Taille du mur ------------------------------------------------------------
// La peinture est reprise telle quelle dans le monde : mur centré, pied fixe.
// L'ancien mur est gardé dans l'historique : Annuler le rend intact, y compris
// la partie que le redimensionnement avait coupée.
function applySurface(s, W, H) {
  surface = s;
  WALL.width = W;
  WALL.height = H;
  world.setWallSize(surface);
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
  const hidden = [world.cursor, world.can].filter(o => o.visible);
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
let dirty = false, lastPaint = 0, saving = null, loadedId = null;
function markDirty() { dirty = true; lastPaint = performance.now(); }

async function refreshProjects() {
  try { set({ projects: await listProjects() }); } catch (e) { console.warn(e); }
}

async function saveCurrent(manual = false) {
  if (saving) await saving;
  if (!dirty && !manual) return;
  dirty = false;
  saving = (async () => {
    try {
      const id = state.projectId || newProjectId();
      await saveProject({
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
      });
      if (state.projectId !== id) set({ projectId: id });
      loadedId = id;
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
  surface.clear(false);
  canvases.disposeAll();
  history.reset();
  set({ projectId: null, projectName: nextName() });
  loadedId = null;
  dirty = false;
  notify(`Nouveau projet : ${state.projectName}`);
}

async function openProject(id) {
  if (id === loadedId && !dirty) return;
  await saveCurrent();
  const p = await loadProject(id);
  if (!p) { notify('Projet introuvable'); return refreshProjects(); }
  spray.reset();
  resizeWall(p.wallWidth || 6, p.wallHeight || 3, { keepPaint: false, record: false });
  surface.clear(false);
  surface.importLayers(p.layers);
  canvases.disposeAll();
  for (const [cid, layers] of Object.entries(p.extra || {})) canvases.byId(cid)?.ensureSurface().importLayers(layers);
  history.reset();
  set({ projectId: p.id, projectName: p.name, wall: p.wall || state.wall, savedColors: p.savedColors || [], refs: p.refs || [] });
  loadedId = p.id;
  dirty = false;
  notify(`Projet « ${p.name} » ouvert`);
}

async function removeProject(id) {
  await deleteProject(id);
  if (id === state.projectId) { set({ projectId: null }); dirty = true; }
  await refreshProjects();
  notify('Projet supprimé');
}

actions.newProject = newProject;
actions.openProject = openProject;
actions.deleteProject = removeProject;
actions.renameProject = async name => {
  set({ projectName: name });
  if (state.projectId) { await renameProject(state.projectId, name); await refreshProjects(); }
};
actions.save = () => saveCurrent(true);
addEventListener('visibilitychange', () => { if (document.hidden) saveCurrent(); });

function notify(msg) {
  toast(msg);
  palette.flash(msg);
}

actions.undo = () => {
  spray.reset();
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
  history.begin('effacement');
  surface.clear();
  canvases.clearAll(true);
  history.begin();
  markDirty();
  notify('Tout est effacé (Annuler pour revenir)');
};
actions.photo = exportPhoto;
actions.enterVR = () => enterXR('immersive-vr');
actions.enterAR = () => enterXR('immersive-ar');

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
});
renderer.xr.addEventListener('sessionend', () => {
  xr.end();
  world.setAR(false);
  renderer.setClearColor(0x000000, 1);
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
    await refreshProjects();
    const list = state.projects || [];
    const last = list.find(p => p.id === state.projectId) || list[0];
    if (last) await openProject(last.id);
    else if (!state.projectName) set({ projectName: 'Mur 1' });
  })().catch(e => console.warn('Restauration impossible', e));
}

// Centre la vue sur la zone non couverte par le panneau latéral.
function resize() {
  const w = innerWidth, h = innerHeight, side = w > 760 ? 300 : 0;
  camera.aspect = w / h;
  if (side) camera.setViewOffset(w + side, h, 0, 0, w, h);
  else camera.clearViewOffset();
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}
addEventListener('resize', resize);
resize();

const test = params.has('test') ? runTest({ set, state, PAINTS, world, WALL, params, readWall }) : null;
window.__vrpaint = {
  get surface() { return surface; }, spray, history, canvases,
  state, set, actions, world, renderer, readWall, resizeWall, desktop, rig, palette,
};

const clock = new THREE.Clock();
const _camPos = new THREE.Vector3();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  const presenting = renderer.xr.isPresenting;
  const input = presenting ? xr.update(dt) : desktop.update(dt);
  let spraying;
  if (test) {
    // test : plusieurs pas de simulation par image (le rendu logiciel est lent)
    for (let k = 0; k < 40; k++) spraying = spray.update(1 / 60, test.step() || input);
  } else {
    spraying = spray.update(dt, input);
  }
  if (spraying || spray.drips.length) markDirty();
  flushAll();
  world.update(dt, renderer.xr.isPresenting ? renderer.xr.getCamera() : camera, renderer.getPixelRatio());
  audio.setSpray(spray.pressure, spray.cap);
  audio.setTraffic(world.traffic.nearest(camera.getWorldPosition(_camPos)));
  world.updateCursor(spray.hit, spray.cap, state.aim && !!input && !test && (!presenting || (spray.hit && spray.hit.t < 0.9)));
  world.can.visible = presenting || (!!input && !test);
  world.updateLift(rig);

  if (dirty && !saving && !spraying && !spray.drips.length && performance.now() - lastPaint > 4000 && !test) saveCurrent();
  renderer.render(scene, camera);
  if (test) test.after(renderer);
});
