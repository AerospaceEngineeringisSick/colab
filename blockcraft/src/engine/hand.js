// First-person arm + held item, and the third-person player model.
import * as THREE from 'three';
import { ITEMS } from '../shared/items.js';
import { makeItemObject } from './itemmesh.js';
import { MODELS, buildModel, boxGeometry } from './models.js';
import { entityMaterial } from './materials.js';
import { imageTexture } from './textures.js';
import { isEnchanted } from '../shared/enchant.js';

// enchanted items (and a few special ones) shimmer
const shines = (s) => !!s && (isEnchanted(s) || !!ITEMS[s.id].glint);

export class Hand {
  constructor(renderer, skin = 'entity/steve') {
    this.r = renderer;
    this.scene = renderer.handScene;
    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.skin = skin;
    // arm from the skin (64x32 legacy layout)
    const tex = imageTexture(skin);
    this.armMat = entityMaterial(tex, { alphaTest: 0.1 });
    const geo = boxGeometry([-2, -12, -2], [4, 12, 4], [40, 16], 64, 32);
    this.arm = new THREE.Mesh(geo, this.armMat);
    this.armPivot = new THREE.Group();
    this.armPivot.add(this.arm);
    this.root.add(this.armPivot);
    this.itemPivot = new THREE.Group();
    this.root.add(this.itemPivot);
    this.itemId = -1;
    this.itemObj = null;
    this.equip = 0; // 0 = fully raised, 1 = lowered
    this.lowering = false;
  }

  setItem(stack) {
    const glint = shines(stack);
    const key = stack ? stack.id + (glint ? 0.5 : 0) : -1;
    if (key === this.itemId) return;
    if (this.itemObj) {
      this.itemPivot.remove(this.itemObj);
      if (this.itemObj.userData.dispose) this.itemObj.userData.dispose();
      this.itemObj = null;
    }
    this.itemId = key;
    if (stack) this.itemObj = makeItemObject(stack.id, { depthTest: true, glint });
    if (this.itemObj) this.itemPivot.add(this.itemObj);
  }

  // state: { stack, swing (0..1), bobX, bobY, light:[s,b], using:{kind, ticks}, equipChange, sneak, a(lerp) }
  update(st, dt) {
    // equip animation: lower the old item, swap, raise the new one
    const k = st.stack ? st.stack.id + ':' + st.slot + (shines(st.stack) ? ':g' : '') : 'none:' + st.slot;
    if (k !== this.curKey) {
      if (this.curKey === undefined) { this.curKey = k; this.setItem(st.stack); }
      else { this.lowering = true; this.pendingKey = k; }
    }
    if (this.lowering) {
      this.equip = Math.min(1, this.equip + dt * 9);
      if (this.equip >= 1) { this.lowering = false; this.curKey = this.pendingKey; this.setItem(st.stack); }
    } else this.equip = Math.max(0, this.equip - dt * 6);
    const eq = this.equip;
    const sw = st.swing; // 0..1
    const s1 = Math.sin(sw * Math.PI), s2 = Math.sin(Math.sqrt(sw) * Math.PI);
    const has = !!st.stack;
    const block = this.itemObj && this.itemObj.userData.block;
    const it = st.stack ? ITEMS[st.stack.id] : null;
    const tool = it && (it.tool || it.durability || it.use === 'bow');
    // base positions in hand-camera space (camera at origin looking -Z)
    const root = this.root;
    root.position.set(st.bobX * 0.6, st.bobY * 0.6 - eq * 0.6, 0);
    root.rotation.set(0, 0, 0);

    // arm: aimed from a shoulder below-right of the view toward the crosshair, like vanilla
    this.armPivot.visible = !has;
    if (!has) {
      const ap = this.armPivot;
      const sx = 0.62 - s2 * 0.3, sy = -0.78 + Math.sin(sw * Math.PI * 2) * 0.1 + s1 * 0.12, sz = -0.36 - s1 * 0.25;
      const tx = 0.3 - s2 * 0.25, ty = -0.4 + s1 * 0.25, tz = -1.05;
      ap.position.set(sx, sy, sz);
      const d = new THREE.Vector3(tx - sx, ty - sy, tz - sz).normalize();
      ap.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), d);
      // roll so the inner side of the arm faces the camera
      ap.rotateY(-0.9 + s1 * 0.4);
    }
    // item
    const ip = this.itemPivot;
    ip.visible = has;
    if (has && this.itemObj) {
      const o = this.itemObj;
      ip.rotation.set(0, 0, 0);
      ip.rotation.order = 'YXZ';
      let px = 0.56, py = -0.5, pz = -0.72;
      // swing arc
      px -= s2 * 0.4; py += Math.sin(sw * Math.PI * 2) * 0.2 - s1 * 0.05; pz -= s1 * 0.2;
      ip.rotation.y = -s2 * 0.5;
      ip.rotation.x = -s1 * 0.9;
      ip.rotation.z = s1 * 0.3;
      if (st.using && (st.using.kind === 'eat' || st.using.kind === 'drink')) {
        const t = Math.min(1, st.using.ticks / 6);
        px -= 0.32 * t; py += 0.12 * t + (st.using.ticks > 6 ? Math.abs(Math.cos(st.using.ticks * 0.9)) * 0.05 : 0); pz += 0.15 * t;
        ip.rotation.y += 0.6 * t;
      }
      if (st.using && st.using.kind === 'bow') {
        const t = Math.min(1, st.using.ticks / 20);
        px = 0.12; py = -0.3; pz = -0.62 + t * 0.12;
        ip.rotation.y = 0; ip.rotation.x = 0; ip.rotation.z = 0;
        if (t >= 1) py += Math.sin(st.time * 40) * 0.004;
      }
      ip.position.set(px, py, pz);
      if (block) {
        o.scale.setScalar(0.42);
        o.position.set(0, 0.03, 0);
        o.rotation.set(0.08, Math.PI / 4 + 0.05, 0);
      } else if (st.using && st.using.kind === 'bow') {
        o.scale.setScalar(0.7);
        o.position.set(0, 0, 0);
        o.rotation.set(0, -Math.PI / 2 - 0.15, -0.6);
      } else if (tool) {
        o.scale.setScalar(0.75);
        o.position.set(0.02, 0.18, 0);
        o.rotation.set(0, -Math.PI / 2 + 0.35, 0.35);
      } else {
        o.scale.setScalar(0.5);
        o.position.set(0, 0.06, 0);
        o.rotation.set(0, -Math.PI / 2 + 0.6, 0.1);
      }
      o.userData.setLight(st.light[0], st.light[1]);
      // bow pull frames
      if (it && it.use === 'bow') this.bowFrame(st.using && st.using.kind === 'bow' ? st.using.ticks : -1);
    }
    this.armMat.uniforms.uLight.value.set(st.light[0], st.light[1]);
  }

  bowFrame(ticks) {
    const frame = ticks < 0 ? 'bow' : ticks >= 18 ? 'bow_pulling_2' : ticks >= 13 ? 'bow_pulling_1' : 'bow_pulling_0';
    if (this.curBow === frame || !this.itemObj) return;
    this.curBow = frame;
    const mesh = this.itemObj.children[0];
    if (mesh && mesh.material && mesh.material.uniforms.uMap) mesh.material.uniforms.uMap.value = imageTexture('item/' + frame);
  }
}

// third-person player model
export class PlayerModel {
  constructor(scene, skin = 'entity/steve') {
    this.model = buildModel(MODELS.player, skin, { texSize: [64, 32] });
    this.root = this.model.root;
    this.root.visible = false;
    scene.add(this.root);
    this.heldId = -1;
    this.held = null;
    this.armor = [];
  }
  setHeld(stack) {
    const glint = shines(stack);
    const id = stack ? stack.id + (glint ? 0.5 : 0) : -1;
    if (id === this.heldId) return;
    this.heldId = id;
    if (this.held) { this.model.parts.rightArm.remove(this.held); this.held = null; }
    if (stack) {
      this.held = makeItemObject(stack.id, { glint });
      const block = this.held.userData.block;
      this.held.scale.setScalar(block ? 0.3 : 0.5);
      this.held.position.set(-0.06, -0.62, block ? 0.0 : 0.1);
      this.held.rotation.set(block ? 0 : -Math.PI / 2 + 0.3, block ? Math.PI / 4 : Math.PI / 2, 0);
      this.model.parts.rightArm.add(this.held);
    }
  }
  update(p, a, t, light) {
    const m = this.model, P = m.parts;
    const [x, y, z] = p.renderPos(a);
    this.root.position.set(x, y, z);
    const yaw = p.yaw;
    this.bodyYaw = this.bodyYaw ?? yaw;
    const diff = Math.atan2(Math.sin(yaw - this.bodyYaw), Math.cos(yaw - this.bodyYaw));
    if (Math.abs(diff) > 0.8) this.bodyYaw += diff - Math.sign(diff) * 0.8;
    const moving = Math.hypot(p.x - p.px, p.z - p.pz) > 0.01;
    if (moving) this.bodyYaw += diff * 0.2;
    this.root.rotation.set(0, this.bodyYaw + Math.PI, 0);
    P.head.rotation.y = Math.atan2(Math.sin(yaw - this.bodyYaw), Math.cos(yaw - this.bodyYaw));
    P.head.rotation.x = -p.pitch;
    const sw = p.walkDist * 2.2, amt = Math.min(1, Math.hypot(p.x - p.px, p.z - p.pz) * 6);
    const c = Math.cos(sw * 0.6662), c2 = Math.cos(sw * 0.6662 + Math.PI);
    P.rightLeg.rotation.x = c * 1.4 * amt; P.leftLeg.rotation.x = c2 * 1.4 * amt;
    P.rightArm.rotation.x = c2 * amt * 0.8; P.leftArm.rotation.x = c * amt * 0.8;
    // seated in a boat or minecart (vanilla riding pose; our frame negates y rotations)
    const riding = !!p.vehicle;
    P.rightLeg.rotation.y = riding ? -Math.PI / 10 : 0; P.leftLeg.rotation.y = riding ? Math.PI / 10 : 0;
    if (riding) {
      P.rightLeg.rotation.x = P.leftLeg.rotation.x = -1.4137;
      P.rightArm.rotation.x = P.leftArm.rotation.x = -Math.PI / 5;
    }
    if (p.swing > 0) P.rightArm.rotation.x -= Math.sin((6 - p.swing) / 6 * Math.PI) * 1.2;
    if (this.held) P.rightArm.rotation.x -= 0.3;
    // sneaking
    P.body.rotation.x = p.sneaking ? 0.5 : 0;
    this.root.position.y -= p.sneaking ? 0.1 : 0;
    for (const mat of m.mats) {
      mat.uniforms.uLight.value.set(light[0], light[1]);
      mat.uniforms.uOverlay.value.set(1, 0, 0, p.hurtTime > 0 ? 0.4 : 0);
    }
    if (this.held) this.held.userData.setLight(light[0], light[1]);
    void t;
  }
}
