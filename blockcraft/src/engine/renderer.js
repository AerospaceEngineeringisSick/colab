// three.js renderer, scene graph and per-frame lighting/fog/sky state.
import * as THREE from 'three';
import { U, chunkMaterials } from './materials.js';
import { Sky } from './sky.js';

export class Renderer {
  constructor(canvasEl) {
    this.gl = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: false, powerPreference: 'high-performance', alpha: false });
    this.gl.outputColorSpace = THREE.LinearSRGBColorSpace; // shaders output display-ready colour
    this.gl.autoClear = false;
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    this.gl.setPixelRatio(this.pixelRatio);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.05, 1200);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);
    // first-person hand is drawn in its own pass with its own camera
    this.handScene = new THREE.Scene();
    this.handCamera = new THREE.PerspectiveCamera(70, 1, 0.01, 10);
    this.handScene.add(this.handCamera);
    this.sky = new Sky(this.scene);
    this.fov = 70;
    this.fovMul = 1;
    this.underwater = 0;
    this.renderDistance = 8;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  initChunkMaterials(atlas) {
    this.chunkMats = chunkMaterials(atlas);
    return this.chunkMats;
  }

  setPixelRatio(r) {
    this.pixelRatio = r;
    this.gl.setPixelRatio(r);
    this.resize();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.gl.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.handCamera.aspect = w / h;
    this.handCamera.updateProjectionMatrix();
  }

  // env: { time, day, rain, thunder, flash, underwater (0/1 water, 2 lava), dt, clouds, gamma }
  updateEnvironment(env) {
    const r = this.environment(env);
    // night vision lifts every shadow
    if (env.nightVision) {
      const a = U.uAmbient.value, k = 0.8 * env.nightVision;
      a.setRGB(Math.max(a.r, k), Math.max(a.g, k), Math.max(a.b, k));
      if (env.underwater === 1) { U.uFogNear.value = 8; U.uFogFar.value = 60; }
    }
    return r;
  }

  environment(env) {
    const cam = this.camera;
    if (this.sky.endSky) this.sky.endSky.visible = env.dim === 'end';
    if (env.dim === 'nether') return this.netherEnvironment(env);
    if (env.dim === 'end') return this.endEnvironment(env);
    U.uAmbient.value.setRGB(0, 0, 0);
    this.sky.group.visible = true;
    const dir = new THREE.Vector3();
    cam.getWorldDirection(dir);
    const daylight = this.sky.update(cam, env.time, env.day, env.rain, env.thunder, dir, {
      underwater: env.underwater, dt: env.dt, clouds: env.clouds, far: this.renderDistance * 16 + 40,
    });
    // daylight for the sky channel of the light map (never fully dark)
    const rainDim = 1 - env.rain * 0.3 - env.thunder * 0.15;
    U.uDaylight.value = (0.16 + 0.84 * daylight) * rainDim;
    // night sky light is slightly blue
    U.uSkyLightColor.value.setRGB(0.78 + 0.22 * daylight, 0.82 + 0.18 * daylight, 1.0);
    U.uFlash.value = env.flash || 0;
    U.uGamma.value = env.gamma ?? 0.5;
    U.uTime.value = env.time_s;
    const far = this.renderDistance * 16;
    if (env.underwater === 1) {
      U.uFogColor.value.setRGB(0.05, 0.16, 0.42).multiplyScalar(0.3 + 0.7 * daylight);
      U.uFogNear.value = 2; U.uFogFar.value = 28;
    } else if (env.underwater === 2) {
      U.uFogColor.value.setRGB(0.6, 0.12, 0.02);
      U.uFogNear.value = 0; U.uFogFar.value = 2.5;
    } else {
      U.uFogColor.value.copy(this.sky.fog);
      U.uFogNear.value = far * (env.rain > 0.2 ? 0.45 : 0.7);
      U.uFogFar.value = far - 4;
    }
    this.gl.setClearColor(U.uFogColor.value);
    this.sky.dome.visible = !env.underwater;
    cam.far = Math.max(300, far + 200);
    const fov = this.fov * this.fovMul;
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; }
    cam.updateProjectionMatrix();
    return daylight;
  }

  // the Nether: no sky, a dim red glow everywhere and thick coloured fog (env.fog: the biome's)
  netherEnvironment(env) {
    const cam = this.camera;
    U.uDaylight.value = 0;
    U.uFlash.value = 0;
    U.uGamma.value = env.gamma ?? 0.5;
    U.uTime.value = env.time_s;
    U.uSkyLightColor.value.setRGB(1, 1, 1);
    U.uAmbient.value.setRGB(0.4, 0.29, 0.25);
    const far = this.renderDistance * 16;
    const fog = this.netherFog || (this.netherFog = new THREE.Color(0.2, 0.03, 0.03));
    if (env.fog !== undefined) {
      const c = new THREE.Color(env.fog);
      fog.lerp(c, 0.02);
    }
    if (env.underwater === 2) {
      U.uFogColor.value.setRGB(0.6, 0.12, 0.02);
      U.uFogNear.value = 0; U.uFogFar.value = 2.5;
    } else {
      U.uFogColor.value.copy(fog);
      U.uFogNear.value = Math.min(far, 192) * 0.05;
      U.uFogFar.value = Math.min(far, 192) * 0.5 + 16;
    }
    this.gl.setClearColor(U.uFogColor.value);
    this.sky.dome.visible = false;
    this.sky.group.visible = false;
    this.sky.clouds.mesh.visible = false;
    cam.far = Math.max(300, far + 200);
    const fov = this.fov * this.fovMul;
    if (Math.abs(cam.fov - fov) > 0.01) cam.fov = fov;
    cam.updateProjectionMatrix();
    return 0;
  }

  // the End: eternal dusk under a dark patterned sky, no sun, no weather
  endEnvironment(env) {
    const cam = this.camera, sc = this.sky.camera;
    cam.getWorldQuaternion(sc.quaternion);
    if (sc.fov !== cam.fov || sc.aspect !== cam.aspect) { sc.fov = cam.fov; sc.aspect = cam.aspect; sc.updateProjectionMatrix(); }
    U.uDaylight.value = 0.85;
    U.uSkyLightColor.value.setRGB(0.9, 0.84, 1.0);
    U.uAmbient.value.setRGB(0.14, 0.11, 0.17);
    U.uFlash.value = 0;
    U.uGamma.value = env.gamma ?? 0.5;
    U.uTime.value = env.time_s;
    const far = this.renderDistance * 16;
    if (env.underwater === 1) { U.uFogColor.value.setRGB(0.05, 0.16, 0.42); U.uFogNear.value = 2; U.uFogFar.value = 28; }
    else if (env.underwater === 2) { U.uFogColor.value.setRGB(0.6, 0.12, 0.02); U.uFogNear.value = 0; U.uFogFar.value = 2.5; }
    else { U.uFogColor.value.setRGB(0.1, 0.08, 0.13); U.uFogNear.value = far * 0.55; U.uFogFar.value = far - 4; }
    this.gl.setClearColor(U.uFogColor.value);
    this.sky.dome.visible = false;
    this.sky.group.visible = false;
    this.sky.clouds.mesh.visible = false;
    cam.far = Math.max(300, far + 200);
    const fov = this.fov * this.fovMul;
    if (Math.abs(cam.fov - fov) > 0.01) cam.fov = fov;
    cam.updateProjectionMatrix();
    return 0.62;
  }

  render(drawHand) {
    const gl = this.gl;
    gl.clear();
    if (this.sky.dome.visible || (this.sky.endSky && this.sky.endSky.visible)) {
      gl.render(this.sky.scene, this.sky.camera);
      gl.clearDepth();
    }
    gl.render(this.scene, this.camera);
    if (drawHand) {
      gl.clearDepth();
      gl.render(this.handScene, this.handCamera);
    }
  }
}
