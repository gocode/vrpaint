import * as THREE from 'three';

// Vue spectateur : pendant une session VR rendue par le PC (Meta Horizon Link),
// Three.js dessine dans le framebuffer du casque et le canvas de la page reste
// figé sur la dernière image du mode souris. On y ajoute un second rendu, plus
// petit (1,44 Mpx au plus) et une image XR sur deux, pour suivre l'œuvre sur
// l'écran du PC :
//   tete : la caméra de tête, lissée (position, cap et tangage ; roulis supprimé),
//          pour ne pas donner le mal de mer à ceux qui regardent ;
//   mur  : caméra posée dans la rue, qui cadre le mur et suit le peintre.
// La silhouette du peintre est sur un calque que seule la caméra spectateur voit :
// ni le casque ni la photo du mur ne la montrent.
export const SPECTATOR_LAYER = 5;
export const SPECTATOR_MODES = [
  ['tete', 'Vue du casque'],
  ['mur', 'Vue du mur'],
  ['off', 'Coupée'],
];

const MAX_PIXELS = 1600 * 900;
const MAX_DIST = 5.5;   // la caméra « mur » reste sur le trottoir, avant la chaussée
const MARGIN = 0.6;     // marge autour du mur cadré (m)

const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _t = new THREE.Vector3();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const follow = (tau, dt) => 1 - Math.exp(-dt / tau);
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = THREE.MathUtils.clamp;

export class Spectator {
  constructor({ renderer, scene, wall }) {
    Object.assign(this, { renderer, scene, wall });
    this.camera = new THREE.PerspectiveCamera(65, 16 / 9, 0.05, 400);
    this.camera.layers.enable(SPECTATOR_LAYER);
    this.avatar = makeAvatar();
    scene.add(this.avatar);
    this.mode = 'tete';
    this.every = 2;       // une image XR sur deux (36 à 45 images/s)
    this.frames = 0;
    this.renders = 0;     // images spectateur rendues depuis le début de la session
    this.head = { pos: new THREE.Vector3(), yaw: 0, pitch: 0 };
    this.shot = new THREE.Vector3();   // point visé par la caméra « mur »
    this.start();
  }

  start() {
    this.fresh = true;
    this.frames = 0;
    this.elapsed = 0;
    this.renders = 0;
  }

  end() {
    this.avatar.visible = false;
  }

  // Appelé après le rendu XR de l'image. head : caméra XR de Three.js (pose monde).
  render(dt, head) {
    this.elapsed += dt;
    if (this.mode === 'off' || ++this.frames % this.every) return false;
    const step = this.elapsed;
    this.elapsed = 0;

    head.matrixWorld.decompose(_p, _q, _s);
    _e.setFromQuaternion(_q, 'YXZ');
    const h = this.head;
    if (this.fresh) {
      h.pos.copy(_p);
      h.yaw = _e.y;
      h.pitch = _e.x;
    } else {
      h.pos.lerp(_p, follow(0.12, step));
      h.yaw += wrap(_e.y - h.yaw) * follow(0.3, step);
      h.pitch += (_e.x - h.pitch) * follow(0.3, step);
    }

    const r = this.renderer, cv = r.domElement;
    const cw = Math.max(1, cv.clientWidth), ch = Math.max(1, cv.clientHeight);
    const k = Math.min(devicePixelRatio || 1, Math.sqrt(MAX_PIXELS / (cw * ch)));
    const w = Math.round(cw * k), hh = Math.round(ch * k);
    // setSize() est bloqué pendant la session ; le canvas n'est plus celui du casque
    if (cv.width !== w || cv.height !== hh) r.setDrawingBufferSize(w, hh, 1);

    const cam = this.camera;
    cam.aspect = w / hh;
    if (this.mode === 'mur') this.frameWall(step, cam.aspect);
    else {
      cam.fov = 65;
      cam.position.copy(h.pos);
      cam.rotation.set(h.pitch, h.yaw, 0, 'YXZ');
    }
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    this.placeAvatar();

    const prev = r.getRenderTarget();
    r.xr.enabled = false;
    r.setRenderTarget(null);
    r.render(this.scene, cam);
    r.setRenderTarget(prev);
    r.xr.enabled = true;
    this.fresh = false;
    this.renders++;
    return true;
  }

  // Cadre tout le mur s'il tient dans l'image, sinon la partie où travaille le peintre.
  frameWall(step, aspect) {
    const cam = this.camera, { width: W, height: H, z } = this.wall, h = this.head;
    cam.fov = 50;
    const t = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    const dist = Math.min(MAX_DIST, Math.max((H / 2 + MARGIN) / t, (W / 2 + MARGIN) / (t * aspect)));
    const limX = Math.max(0, W / 2 - (dist * t * aspect - MARGIN));
    const halfH = dist * t - MARGIN;
    const target = _t.set(
      clamp(h.pos.x, -limX, limX),
      halfH >= H / 2 ? H / 2 : clamp(h.pos.y - 0.2, halfH, H - halfH),
      Math.max(z + dist, h.pos.z + 1.2),   // jamais devant le peintre
    );
    if (this.fresh) this.shot.copy(target);
    else this.shot.lerp(target, follow(1.0, step));
    cam.position.set(this.shot.x, this.shot.y + 0.3, this.shot.z);
    cam.lookAt(this.shot.x, this.shot.y, z);
  }

  // Tête (casque Quest 2 blanc) à la pose réelle, buste qui ne suit que le cap.
  placeAvatar() {
    const a = this.avatar, { head, torso } = a.userData;
    a.visible = this.mode === 'mur';
    if (!a.visible) return;
    head.position.copy(_p);
    head.quaternion.copy(_q);
    torso.position.set(_p.x + Math.sin(_e.y) * 0.06, _p.y - 0.55, _p.z + Math.cos(_e.y) * 0.06);
    torso.rotation.set(0, _e.y, 0);
  }
}

function makeAvatar() {
  const skin = new THREE.MeshStandardMaterial({ color: 0x8d6e5a, roughness: 0.8 });
  const shell = new THREE.MeshStandardMaterial({ color: 0xf1f1ee, roughness: 0.45 });
  const strap = new THREE.MeshStandardMaterial({ color: 0x2a2b30, roughness: 0.7 });
  const hoodie = new THREE.MeshStandardMaterial({ color: 0x2d3340, roughness: 0.9 });

  const head = new THREE.Group();
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.1, 20, 14), skin);
  skull.scale.set(0.9, 1.1, 1);
  skull.position.z = 0.04;
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.11, 0.09), shell);
  visor.position.set(0, 0, -0.07);
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.012, 6, 24), strap);
  band.rotation.x = Math.PI / 2;
  band.scale.set(0.95, 1.05, 1);
  band.position.z = 0.03;
  head.add(skull, visor, band);

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.4, 4, 12), hoodie);
  torso.scale.set(1.25, 1, 0.75);

  const avatar = new THREE.Group();
  avatar.add(head, torso);
  avatar.traverse(o => o.layers.set(SPECTATOR_LAYER));
  avatar.userData = { head, torso };
  avatar.visible = false;
  return avatar;
}
