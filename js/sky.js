import * as THREE from 'three';

// Ciel : dégradé de jour ; la nuit, Voie lactée, étoiles qui scintillent,
// passage d'avions de temps en temps et, plus rarement, étoiles filantes.

const R = 150;
// La bande passe au-dessus du mur (vers -z) puis derrière le joueur, légèrement inclinée.
const GAL_N = new THREE.Vector3(0.96, 0.18, 0.2).normalize();      // normale du plan galactique
const GAL_C = new THREE.Vector3(-0.12, 0.42, -0.9).normalize();    // direction du bulbe, au-dessus du mur
GAL_C.addScaledVector(GAL_N, -GAL_C.dot(GAL_N)).normalize();       // ramené dans le plan de la bande

const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const SKY_FRAG = /* glsl */`
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform float uNight;
uniform vec3 uGalN;
uniform vec3 uGalC;
varying vec3 vDir;
float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float fbm(vec3 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; } return s; }
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 c = mix(uHorizon, uTop, smoothstep(0.0, 0.55, h));
  if (uNight > 0.0 && h > -0.05) {
    // Voie lactée : bande de nuages d'étoiles, plus dense et chaude vers le bulbe
    float lat = dot(d, uGalN);
    float band = exp(-pow(lat / 0.2, 2.0));
    float core = pow(max(dot(d, uGalC), 0.0), 6.0);
    float clouds = fbm(d * 6.0) * 0.75 + fbm(d * 18.0) * 0.35;
    float dust = smoothstep(0.45, 0.75, fbm(d * 9.0 + 3.0)) * exp(-pow(lat / 0.06, 2.0));
    float mw = band * (0.25 + clouds) * (1.0 - 0.8 * dust) * (0.55 + 1.6 * core);
    vec3 mwCol = mix(vec3(0.55, 0.62, 0.85), vec3(1.0, 0.85, 0.65), core);
    float fade = smoothstep(-0.02, 0.25, h);   // la brume urbaine efface l'horizon
    c += mwCol * mw * 0.2 * fade * uNight;
    // halo orangé des lumières de la ville sur l'horizon
    c += vec3(0.22, 0.12, 0.05) * exp(-max(h, 0.0) * 9.0) * uNight * 0.6;
  }
  c = mix(uGround, c, smoothstep(-0.12, 0.0, h));
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const STAR_VERT = /* glsl */`
attribute float aSize;
attribute vec3 aColor;
attribute float aPhase;
uniform float uTime;
uniform float uPixel;
varying vec3 vColor;
varying float vTw;
void main() {
  float tw = 0.65 + 0.35 * sin(uTime * (1.5 + aPhase * 3.0) + aPhase * 40.0) * sin(uTime * 0.7 + aPhase * 13.0);
  vTw = tw;
  vColor = aColor;
  gl_PointSize = max(1.0, aSize * uPixel * (0.8 + 0.4 * tw));
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const STAR_FRAG = /* glsl */`
uniform float uNight;
varying vec3 vColor;
varying float vTw;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float a = exp(-dot(q, q) * 3.5);
  gl_FragColor = vec4(vColor * a * vTw * uNight, 1.0);
}`;

function starField(rand) {
  const pos = [], size = [], color = [], phase = [];
  const v = new THREE.Vector3();
  for (let i = 0; i < 3200; i++) {
    // 40 % des étoiles se resserrent le long de la Voie lactée
    if (i % 5 < 2) {
      const u = new THREE.Vector3().crossVectors(GAL_N, new THREE.Vector3(0, 1, 0)).normalize();
      const w = new THREE.Vector3().crossVectors(GAL_N, u);
      const a = rand() * Math.PI * 2, lat = (rand() + rand() + rand() - 1.5) * 0.18;
      v.copy(u).multiplyScalar(Math.cos(a)).addScaledVector(w, Math.sin(a)).addScaledVector(GAL_N, lat).normalize();
    } else {
      v.set(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1).normalize();
    }
    if (v.y < 0.02) { i--; continue; }
    pos.push(v.x * R * 0.95, v.y * R * 0.95, v.z * R * 0.95);
    const m = Math.pow(rand(), 3);   // beaucoup de faibles, peu de brillantes
    size.push(1.2 + m * 4.5);
    const t = rand();
    const c = t < 0.15 ? [1.0, 0.82, 0.65] : t < 0.3 ? [0.75, 0.85, 1.0] : [1, 1, 1];
    const b = 0.35 + m * 1.4;
    color.push(c[0] * b, c[1] * b, c[2] * b);
    phase.push(rand());
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aSize', new THREE.Float32BufferAttribute(size, 1));
  g.setAttribute('aColor', new THREE.Float32BufferAttribute(color, 3));
  g.setAttribute('aPhase', new THREE.Float32BufferAttribute(phase, 1));
  return g;
}

function rng(seed) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function dot(color, size) {
  return new THREE.Points(
    new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3)),
    new THREE.PointsMaterial({ color, size, sizeAttenuation: false, transparent: true, depthWrite: false, fog: false, toneMapped: false }));
}

export class Sky {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.uniforms = {
      uTop: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uGround: { value: new THREE.Color() },
      uNight: { value: 0 }, uGalN: { value: GAL_N }, uGalC: { value: GAL_C },
    };
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(R, 48, 24), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false, uniforms: this.uniforms,
      vertexShader: SKY_VERT, fragmentShader: SKY_FRAG,
    }));
    this.dome.renderOrder = -2;
    this.starUniforms = { uTime: { value: 0 }, uNight: { value: 0 }, uPixel: { value: 1 } };
    this.stars = new THREE.Points(starField(rng(99)), new THREE.ShaderMaterial({
      vertexShader: STAR_VERT, fragmentShader: STAR_FRAG, uniforms: this.starUniforms,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    }));
    this.stars.renderOrder = -1;
    this.group.add(this.dome, this.stars);

    // avion : flash blanc + feux de position rouge et vert
    this.plane = new THREE.Group();
    this.planeLights = { strobe: dot(0xffffff, 4), red: dot(0xff3030, 3), green: dot(0x30ff60, 3) };
    this.planeLights.red.position.set(-0.6, 0, 0);
    this.planeLights.green.position.set(0.6, 0, 0);
    this.plane.add(this.planeLights.strobe, this.planeLights.red, this.planeLights.green);
    this.plane.visible = false;
    this.group.add(this.plane);
    this.nextPlane = 15 + Math.random() * 40;

    // étoile filante : traînée étirée dans le sens du mouvement
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(12), 3));
    sg.setAttribute('color', new THREE.Float32BufferAttribute([1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0], 3));
    sg.setIndex([0, 1, 2, 0, 2, 3]);
    this.meteor = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide, fog: false, toneMapped: false,
    }));
    this.meteor.frustumCulled = false;
    this.meteor.visible = false;
    this.group.add(this.meteor);
    this.nextMeteor = 40 + Math.random() * 120;

    this.night = false;
    this.time = 0;
  }

  setColors(top, horizon, ground) {
    this.uniforms.uTop.value.set(top);
    this.uniforms.uHorizon.value.set(horizon);
    this.uniforms.uGround.value.set(ground);
  }

  setNight(night, ar = false) {
    this.night = night;
    this.uniforms.uNight.value = night ? 1 : 0;
    this.starUniforms.uNight.value = night ? 1 : 0;
    this.stars.visible = night && !ar;
    this.group.visible = !ar;
    if (!night) { this.plane.visible = false; this.meteor.visible = false; }
  }

  update(dt, camera, pixelRatio = 1) {
    this.time += dt;
    this.starUniforms.uTime.value = this.time;
    this.starUniforms.uPixel.value = pixelRatio;
    camera.getWorldPosition(this.group.position);   // le ciel reste « à l'infini »
    if (!this.night) return;

    // Avions : traversée lente et clignotement
    this.nextPlane -= dt;
    if (!this.plane.visible && this.nextPlane <= 0) {
      const a = Math.random() * Math.PI * 2, el = 0.35 + Math.random() * 0.4;
      this.planeFrom = new THREE.Vector3(Math.cos(a), el, Math.sin(a)).normalize();
      this.planeTo = new THREE.Vector3(-Math.cos(a + 0.6), el * 0.8, -Math.sin(a + 0.6)).normalize();
      this.planeT = 0;
      this.planeDur = 70 + Math.random() * 50;
      this.plane.visible = true;
    }
    if (this.plane.visible) {
      this.planeT += dt / this.planeDur;
      if (this.planeT >= 1) {
        this.plane.visible = false;
        this.nextPlane = 45 + Math.random() * 120;
      } else {
        const p = new THREE.Vector3().copy(this.planeFrom).lerp(this.planeTo, this.planeT).normalize().multiplyScalar(R * 0.9);
        this.plane.position.copy(p);
        this.plane.lookAt(this.group.position.x, p.y, this.group.position.z);
        const ph = (this.time % 1.3) / 1.3;
        this.planeLights.strobe.material.opacity = ph < 0.06 || (ph > 0.12 && ph < 0.16) ? 1 : 0;
        const steady = 0.6 + 0.4 * Math.sin(this.time * 6);
        this.planeLights.red.material.opacity = steady;
        this.planeLights.green.material.opacity = steady;
      }
    }

    // Étoiles filantes : rares, très brèves
    this.nextMeteor -= dt;
    if (!this.meteor.visible && this.nextMeteor <= 0) {
      const a = Math.random() * Math.PI * 2, el = 0.4 + Math.random() * 0.45;
      this.mStart = new THREE.Vector3(Math.cos(a), el, Math.sin(a)).normalize().multiplyScalar(R * 0.9);
      const tangent = new THREE.Vector3(-Math.sin(a), -0.35 - Math.random() * 0.4, Math.cos(a)).normalize();
      this.mVel = tangent.multiplyScalar((Math.random() < 0.5 ? 1 : -1) * (35 + Math.random() * 30));
      this.mVel.y = -Math.abs(this.mVel.y);
      this.mT = 0;
      this.mDur = 0.5 + Math.random() * 0.6;
      this.meteor.visible = true;
    }
    if (this.meteor.visible) {
      this.mT += dt;
      if (this.mT >= this.mDur) {
        this.meteor.visible = false;
        this.nextMeteor = 90 + Math.random() * 240;
      } else {
        const k = this.mT / this.mDur, fade = Math.sin(Math.PI * k);
        const head = this.mStart.clone().addScaledVector(this.mVel, this.mT);
        const tail = head.clone().addScaledVector(this.mVel, -0.25 * fade - 0.05);
        const side = new THREE.Vector3().crossVectors(this.mVel, head).normalize().multiplyScalar(0.22 * fade + 0.05);
        const p = this.meteor.geometry.getAttribute('position');
        p.setXYZ(0, head.x + side.x, head.y + side.y, head.z + side.z);
        p.setXYZ(1, head.x - side.x, head.y - side.y, head.z - side.z);
        p.setXYZ(2, tail.x, tail.y, tail.z);
        p.setXYZ(3, tail.x, tail.y, tail.z);
        p.needsUpdate = true;
        const c = this.meteor.geometry.getAttribute('color');
        for (const i of [0, 1]) c.setXYZ(i, fade, fade, fade * 0.95);
        c.needsUpdate = true;
      }
    }
  }
}
