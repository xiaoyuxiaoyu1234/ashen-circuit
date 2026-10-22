// actors.js — 程序化角色模型与骨骼动画（零美术素材）
import * as THREE from 'three';
import { clamp, easeOut, easeIn, TAU } from './engine.js';

/* 几何体缓存：同尺寸复用，避免重复上传 GPU */
const GEO = new Map();
const cached = (key, make) => {
  let v = GEO.get(key);
  if (!v) {
    v = make();
    GEO.set(key, v);
  }
  return v;
};
const box = (w, h, d) => cached(`b${w}|${h}|${d}`, () => new THREE.BoxGeometry(w, h, d));
const ico = (r, det = 0) => cached(`i${r}|${det}`, () => new THREE.IcosahedronGeometry(r, det));
const oct = (r) => cached(`o${r}`, () => new THREE.OctahedronGeometry(r, 0));
const cyl = (rt, rb, h, s = 6) => cached(`c${rt}|${rb}|${h}|${s}`, () => new THREE.CylinderGeometry(rt, rb, h, s));
const cone = (r, h, s = 6) => cached(`k${r}|${h}|${s}`, () => new THREE.ConeGeometry(r, h, s));
const torus = (r, t, s1 = 6, s2 = 12) => cached(`t${r}|${t}|${s1}|${s2}`, () => new THREE.TorusGeometry(r, t, s1, s2));
const plane = (w, h) => cached(`p${w}|${h}`, () => new THREE.PlaneGeometry(w, h));

const WHITE = new THREE.Color(0xffffff);

/* ---------------- 基础 Rig ---------------- */
export class Rig {
  constructor() {
    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);
    this.mats = [];
    this.flashT = 0;
    this.dying = 0;
    this.spawnT = 0.999;
    this.t = Math.random() * 10;
    this.phase = Math.random() * TAU;
  }

  mat(color, emissive = 0x000000, ei = 0, opts = {}) {
    const m = new THREE.MeshStandardMaterial({
      color: new THREE.Color(color),
      emissive: new THREE.Color(emissive),
      emissiveIntensity: ei,
      roughness: opts.roughness == null ? 0.62 : opts.roughness,
      metalness: opts.metalness == null ? 0.2 : opts.metalness,
      flatShading: opts.flat !== false,
    });
    this.mats.push({ m, base: new THREE.Color(emissive), ei });
    return m;
  }

  mesh(geometry, material, parent, x = 0, y = 0, z = 0) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    (parent || this.body).add(mesh);
    return mesh;
  }

  flash(v = 1) {
    this.flashT = Math.max(this.flashT, v);
  }

  die() {
    if (!this.dying) this.dying = 0.0001;
  }

  /** 每帧：闪白衰减 / 出生上升 / 死亡倒地。返回 true 表示可移除 */
  tick(dt) {
    this.t += dt;
    const f = this.flashT;
    this.flashT = Math.max(0, f - dt * 8.5);
    for (const r of this.mats) {
      if (f > 0.001) {
        r.m.emissive.copy(r.base).lerp(WHITE, Math.min(1, f * 0.34));
        r.m.emissiveIntensity = r.ei + f * 0.95;
      } else {
        r.m.emissive.copy(r.base);
        r.m.emissiveIntensity = r.ei;
      }
    }

    if (this.spawnT > 0) {
      this.spawnT = Math.max(0, this.spawnT - dt * 2.6);
      const k = easeOut(1 - this.spawnT);
      this.body.scale.setScalar(0.55 + 0.45 * k);
      this.body.position.y = (1 - k) * -0.7;
      if (this.spawnT <= 0) {
        this.body.scale.setScalar(1);
        this.body.position.y = 0;
      }
    }

    if (this.dying) {
      this.dying += dt;
      const k = Math.min(1, this.dying / 0.62);
      this.body.rotation.z = k * 1.45;
      this.body.position.y = -k * 0.38;
      this.body.scale.setScalar(1 - k * 0.1);
      return this.dying > 0.8;
    }
    return false;
  }

  dispose() {
    for (const r of this.mats) r.m.dispose();
    this.mats.length = 0;
  }
}

/* ---------------- 玩家 ---------------- */
export class HeroRig extends Rig {
  constructor(pal) {
    super();
    const armor = this.mat(pal.armor, 0x000000, 0, { roughness: 0.5, metalness: 0.22 });
    const dark = this.mat(pal.dark, 0x000000, 0, { roughness: 0.85, metalness: 0.15 });
    const glow = this.mat(pal.glow, pal.glow, 2.1, { roughness: 0.25, metalness: 0.0 });
    const trim = this.mat(pal.trim || pal.armor, pal.glow, 0.28, { roughness: 0.45, metalness: 0.3 });

    // 骨盆（body 之下）
    const pelvis = new THREE.Group();
    pelvis.position.y = 0.9;
    this.body.add(pelvis);
    this.pelvis = pelvis;

    const torso = new THREE.Group();
    torso.position.y = 0.06;
    pelvis.add(torso);
    this.torso = torso;

    this.mesh(box(0.6, 0.68, 0.36), armor, torso, 0, 0.16, 0);
    this.mesh(box(0.58, 0.11, 0.36), trim, torso, 0, 0.45, 0);          // 护颈
    this.mesh(box(0.2, 0.2, 0.06), glow, torso, 0, 0.2, 0.19);          // 胸口核心
    this.mesh(box(0.52, 0.09, 0.34), dark, pelvis, 0, -0.02, 0);        // 腰带

    // 头
    const head = new THREE.Group();
    head.position.y = 0.62;
    torso.add(head);
    this.head = head;
    const skull = this.mesh(ico(0.21, 0), trim, head, 0, 0.07, 0);
    skull.scale.set(1, 1.05, 0.95);
    this.mesh(box(0.3, 0.07, 0.1), glow, head, 0, 0.06, 0.15);          // 面罩
    this.mesh(box(0.34, 0.1, 0.13), dark, head, 0, -0.06, 0.02);        // 下颌
    this.mesh(box(0.045, 0.15, 0.22), glow, head, 0, 0.29, -0.02);      // 头冠光条

    // 肩甲
    const padL = this.mesh(box(0.2, 0.14, 0.34), trim, torso, -0.4, 0.4, 0);
    padL.rotation.z = 0.22;
    const padR = this.mesh(box(0.2, 0.14, 0.34), trim, torso, 0.4, 0.4, 0);
    padR.rotation.z = -0.22;

    // 手臂
    const mkArm = (side) => {
      const shoulder = new THREE.Group();
      shoulder.position.set(side * 0.38, 0.36, 0);
      torso.add(shoulder);
      this.mesh(box(0.13, 0.32, 0.13), armor, shoulder, 0, -0.16, 0);
      const elbow = new THREE.Group();
      elbow.position.y = -0.32;
      shoulder.add(elbow);
      this.mesh(box(0.115, 0.3, 0.115), dark, elbow, 0, -0.15, 0);
      this.mesh(box(0.13, 0.12, 0.14), trim, elbow, 0, -0.3, 0);
      return { shoulder, elbow };
    };
    const L = mkArm(-1);
    const R = mkArm(1);
    this.armL = L.shoulder;
    this.armR = R.shoulder;
    this.elbowL = L.elbow;
    this.elbowR = R.elbow;

    // 剑（挂在右手，刀身沿局部 -Y，整体后倾）
    const weapon = new THREE.Group();
    weapon.position.y = -0.32;
    weapon.rotation.x = 0.95;
    this.elbowR.add(weapon);
    this.weapon = weapon;
    this.mesh(cyl(0.035, 0.04, 0.24, 6), dark, weapon, 0, -0.02, 0);
    this.mesh(box(0.26, 0.05, 0.07), trim, weapon, 0, -0.14, 0);
    const blade = this.mesh(box(0.075, 1.0, 0.025), armor, weapon, 0, -0.66, 0);
    blade.castShadow = true;
    this.mesh(box(0.02, 0.96, 0.045), glow, weapon, 0, -0.66, 0);       // 刃心发光
    this.mesh(cone(0.045, 0.14, 4), armor, weapon, 0, -1.06, 0);

    // 腿
    const mkLeg = (side) => {
      const hip = new THREE.Group();
      hip.position.set(side * 0.17, -0.02, 0);
      pelvis.add(hip);
      this.mesh(box(0.19, 0.4, 0.19), dark, hip, 0, -0.2, 0);
      const knee = new THREE.Group();
      knee.position.y = -0.4;
      hip.add(knee);
      this.mesh(box(0.165, 0.4, 0.165), armor, knee, 0, -0.2, 0);
      this.mesh(box(0.185, 0.11, 0.3), dark, knee, 0, -0.4, 0.055);
      return { hip, knee };
    };
    const legL = mkLeg(-1);
    const legR = mkLeg(1);
    this.legL = legL.hip;
    this.legR = legR.hip;
    this.kneeL = legL.knee;
    this.kneeR = legR.knee;

    // 脚下光环
    const ring = new THREE.Mesh(
      torus(0.42, 0.012, 4, 18),
      new THREE.MeshBasicMaterial({ color: pal.glow, transparent: true, opacity: 0.34, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.03;
    this.root.add(ring);
    this.groundRing = ring;
  }

  /** s: {speed, attack:{t01,kind}|null, dodgeT, hurtT, dead} */
  animate(dt, s) {
    const walkAmp = clamp(s.speed / 6.2, 0, 1);
    this.phase += dt * (3.2 + s.speed * 1.25);
    const ph = this.phase;
    const sw = Math.sin(ph) * 0.75 * walkAmp;
    const bob = Math.abs(Math.sin(ph)) * 0.05 * walkAmp;

    // 基础姿态
    let armRx = 0.5;
    let armRy = 0;
    let armRz = -0.14;
    let armLx = -sw * 0.85;
    let armLz = 0.16;
    let twist = -sw * 0.14;
    let lean = 0.05 + walkAmp * 0.1;
    let legLx = sw;
    let legRx = -sw;
    let kneeLx = Math.max(0, -sw) * 0.9;
    let kneeRx = Math.max(0, sw) * 0.9;
    let bodyY = 0;
    let roll = 0;

    if (s.attack) {
      const p = clamp(s.attack.t01, 0, 1);
      const heavy = s.attack.kind === 'heavy';
      const windEnd = heavy ? 0.46 : 0.36;
      const actEnd = heavy ? 0.66 : 0.56;

      let wWind;
      let wStrike;
      if (p < windEnd) {
        wWind = easeOut(p / windEnd);
        wStrike = 0;
      } else if (p < actEnd) {
        const k = (p - windEnd) / (actEnd - windEnd);
        wWind = 1 - k;
        wStrike = easeIn(k);
      } else {
        const k = (p - actEnd) / (1 - actEnd);
        wWind = 0;
        wStrike = 1 - easeOut(k);
      }
      const wIdle = Math.max(0, 1 - wWind - wStrike);
      const sum = wIdle + wWind + wStrike || 1;

      const R_IDLE = [0.5, 0, -0.14];
      const R_WIND = heavy ? [-2.55, 0.25, -0.62] : [-2.3, 0.2, -0.5];
      const R_HIT = heavy ? [0.75, 0.55, 0.5] : [0.6, 0.42, 0.4];

      armRx = (wIdle * R_IDLE[0] + wWind * R_WIND[0] + wStrike * R_HIT[0]) / sum;
      armRy = (wIdle * R_IDLE[1] + wWind * R_WIND[1] + wStrike * R_HIT[1]) / sum;
      armRz = (wIdle * R_IDLE[2] + wWind * R_WIND[2] + wStrike * R_HIT[2]) / sum;

      twist = (wWind * (heavy ? -0.85 : -0.7) + wStrike * (heavy ? 0.95 : 0.75)) / sum;
      lean = 0.05 + (wWind * -0.14 + wStrike * 0.3) / sum;
      legLx = (wIdle * sw + (wWind + wStrike) * (heavy ? 0.5 : 0.3)) / sum;
      legRx = (wIdle * -sw + (wWind + wStrike) * (heavy ? -0.35 : -0.2)) / sum;
      armLx = (wIdle * -sw * 0.85 + wWind * -1.1 + wStrike * 0.9) / sum;
      bodyY = (wStrike * -0.06) / sum;
      kneeLx = 0.25;
      kneeRx = 0.2;
    }

    if (s.dodgeT > 0) {
      const k = clamp(s.dodgeT, 0, 1);
      roll = -TAU * easeOut(k);
      bodyY = -0.18 * Math.sin(k * Math.PI);
      kneeLx = 1.0;
      kneeRx = 1.0;
      armRx = -0.9;
      armLx = -0.9;
      twist = 0;
      lean = 0;
    }

    if (s.hurtT > 0) {
      lean = -0.35 * s.hurtT;
      twist = 0.2 * s.hurtT;
      armRx = -0.2;
    }

    const lam = s.attack ? 34 : 16;
    this.armR.rotation.x = dampTo(this.armR.rotation.x, armRx, lam, dt);
    this.armR.rotation.y = dampTo(this.armR.rotation.y, armRy, lam, dt);
    this.armR.rotation.z = dampTo(this.armR.rotation.z, armRz, lam, dt);
    this.armL.rotation.x = dampTo(this.armL.rotation.x, armLx, lam, dt);
    this.armL.rotation.z = dampTo(this.armL.rotation.z, armLz, lam, dt);
    this.elbowR.rotation.x = dampTo(this.elbowR.rotation.x, s.attack ? -0.35 : -0.22, 18, dt);
    this.elbowL.rotation.x = dampTo(this.elbowL.rotation.x, -0.22, 14, dt);

    this.torso.rotation.y = dampTo(this.torso.rotation.y, twist, lam, dt);
    this.torso.rotation.x = dampTo(this.torso.rotation.x, lean, 14, dt);
    this.legL.rotation.x = dampTo(this.legL.rotation.x, legLx, 20, dt);
    this.legR.rotation.x = dampTo(this.legR.rotation.x, legRx, 20, dt);
    this.kneeL.rotation.x = dampTo(this.kneeL.rotation.x, kneeLx, 18, dt);
    this.kneeR.rotation.x = dampTo(this.kneeR.rotation.x, kneeRx, 18, dt);

    if (s.dodgeT > 0) {
      this.body.rotation.x = roll;
      this.pelvis.position.y = 0.9 + bodyY;
    } else {
      this.body.rotation.x = dampTo(this.body.rotation.x, 0, 14, dt);
      this.pelvis.position.y = 0.9 + bob + bodyY + Math.sin(this.t * 1.7) * 0.012;
    }
    this.groundRing.material.opacity = 0.16 + walkAmp * 0.16;
    this.groundRing.scale.setScalar(1 + Math.sin(this.t * 6) * 0.02);
  }
}

function dampTo(cur, target, lambda, dt) {
  return cur + (target - cur) * (1 - Math.exp(-lambda * dt));
}

/* ---------------- 敌人：冲锋者 ---------------- */
export class GruntRig extends Rig {
  constructor(pal) {
    super();
    const shell = this.mat(pal.armor, 0x000000, 0, { roughness: 0.68, metalness: 0.18 });
    const dark = this.mat(pal.dark, 0x000000, 0, { roughness: 0.9, metalness: 0.1 });
    const glow = this.mat(pal.glow, pal.glow, 1.9, { roughness: 0.3 });

    const pelvis = new THREE.Group();
    pelvis.position.y = 0.78;
    this.body.add(pelvis);
    this.pelvis = pelvis;

    const torso = new THREE.Group();
    torso.rotation.x = 0.25;
    pelvis.add(torso);
    this.torso = torso;

    this.mesh(box(0.52, 0.5, 0.34), shell, torso, 0, 0.14, 0);
    this.mesh(ico(0.17, 0), dark, torso, 0, 0.48, 0.08);
    this.mesh(box(0.2, 0.06, 0.06), glow, torso, 0, 0.46, 0.2);

    const armL = new THREE.Group();
    armL.position.set(-0.34, 0.32, 0);
    torso.add(armL);
    this.mesh(box(0.11, 0.5, 0.11), dark, armL, 0, -0.25, 0);
    this.armL = armL;

    const armR = new THREE.Group();
    armR.position.set(0.34, 0.32, 0);
    torso.add(armR);
    this.mesh(box(0.11, 0.46, 0.11), dark, armR, 0, -0.23, 0);
    const claw = this.mesh(box(0.09, 0.5, 0.09), glow, armR, 0, -0.7, 0.05);
    claw.rotation.x = 0.2;
    this.armR = armR;

    const mkLeg = (side) => {
      const hip = new THREE.Group();
      hip.position.set(side * 0.16, -0.04, 0);
      pelvis.add(hip);
      this.mesh(box(0.14, 0.4, 0.14), dark, hip, 0, -0.2, 0);
      const knee = new THREE.Group();
      knee.position.y = -0.4;
      hip.add(knee);
      this.mesh(box(0.12, 0.36, 0.12), shell, knee, 0, -0.18, 0);
      return { hip, knee };
    };
    const l = mkLeg(-1);
    const r = mkLeg(1);
    this.legL = l.hip;
    this.legR = r.hip;
    this.kneeL = l.knee;
    this.kneeR = r.knee;
  }

  animate(dt, s) {
    const amp = clamp(s.speed / 4, 0, 1);
    this.phase += dt * (3 + s.speed * 1.4);
    const sw = Math.sin(this.phase) * 0.8 * amp;
    let lean = 0.25 + amp * 0.1;
    let armRx = 0.3;
    let armLx = -sw * 0.7;

    if (s.attack) {
      const p = clamp(s.attack.t01, 0, 1);
      if (p < 0.55) {
        const k = easeOut(p / 0.55);
        lean = 0.25 - 0.45 * k;
        armRx = 0.3 - 1.5 * k;
        armLx = -0.4 * k;
      } else {
        const k = easeOut((p - 0.55) / 0.45);
        lean = -0.2 + 0.75 * k;
        armRx = -1.2 + 1.6 * k;
      }
    }

    this.torso.rotation.x = dampTo(this.torso.rotation.x, lean, 18, dt);
    this.armR.rotation.x = dampTo(this.armR.rotation.x, armRx, 18, dt);
    this.armL.rotation.x = dampTo(this.armL.rotation.x, armLx, 14, dt);
    this.legL.rotation.x = dampTo(this.legL.rotation.x, sw, 16, dt);
    this.legR.rotation.x = dampTo(this.legR.rotation.x, -sw, 16, dt);
    this.kneeL.rotation.x = dampTo(this.kneeL.rotation.x, Math.max(0, -sw) * 1.1, 16, dt);
    this.kneeR.rotation.x = dampTo(this.kneeR.rotation.x, Math.max(0, sw) * 1.1, 16, dt);
    this.pelvis.position.y = 0.78 + Math.abs(Math.sin(this.phase)) * 0.04 * amp;
  }
}

/* ---------------- 敌人：喷吐者（悬浮） ---------------- */
export class SpitterRig extends Rig {
  constructor(pal) {
    super();
    const shell = this.mat(pal.armor, 0x000000, 0, { roughness: 0.5, metalness: 0.2 });
    const glow = this.mat(pal.glow, pal.glow, 2.4, { roughness: 0.2 });
    const dark = this.mat(pal.dark, 0x000000, 0, { roughness: 0.8 });

    const core = new THREE.Group();
    core.position.y = 1.15;
    this.body.add(core);
    this.core = core;

    const orb = this.mesh(oct(0.42), shell, core, 0, 0, 0);
    orb.scale.set(1, 1.15, 1);
    this.mesh(ico(0.17, 0), glow, core, 0, 0, 0);
    this.mesh(cone(0.1, 0.34, 4), glow, core, 0, -0.48, 0).rotation.x = Math.PI;

    const ring = new THREE.Mesh(torus(0.62, 0.025, 4, 20), glow);
    ring.rotation.x = Math.PI / 2.4;
    core.add(ring);
    this.ring = ring;

    this.shards = [];
    for (let i = 0; i < 3; i++) {
      const s = this.mesh(oct(0.1), glow, core, 0, 0, 0);
      this.shards.push(s);
    }
    this.mesh(box(0.14, 0.14, 0.14), dark, this.body, 0, 1.15, 0);
  }

  animate(dt, s) {
    this.core.position.y = 1.15 + Math.sin(this.t * 2.1) * 0.11;
    this.ring.rotation.z += dt * 1.6;
    this.ring.rotation.y += dt * 0.7;
    this.shards.forEach((sh, i) => {
      const a = this.t * 1.5 + (i / 3) * TAU;
      sh.position.set(Math.cos(a) * 0.75, Math.sin(this.t * 2.4 + i) * 0.16, Math.sin(a) * 0.75);
      sh.rotation.x += dt * 2;
      sh.rotation.y += dt * 1.4;
    });
    const wind = s.attack ? Math.min(1, s.attack.t01 * 2.4) : 0;
    this.core.scale.setScalar(1 + wind * 0.22 + Math.sin(this.t * 4) * 0.02);
    this.core.rotation.y += dt * 0.5;
  }
}

/* ---------------- 敌人：重甲 ---------------- */
export class BruteRig extends Rig {
  constructor(pal) {
    super();
    const shell = this.mat(pal.armor, 0x000000, 0, { roughness: 0.58, metalness: 0.22 });
    const dark = this.mat(pal.dark, 0x000000, 0, { roughness: 0.9 });
    const glow = this.mat(pal.glow, pal.glow, 2.0, { roughness: 0.3 });

    const pelvis = new THREE.Group();
    pelvis.position.y = 1.05;
    this.body.add(pelvis);
    this.pelvis = pelvis;

    const torso = new THREE.Group();
    pelvis.add(torso);
    this.torso = torso;

    this.mesh(box(0.95, 0.8, 0.6), shell, torso, 0, 0.2, 0);
    this.mesh(box(0.3, 0.24, 0.12), glow, torso, 0, 0.26, 0.32);
    this.mesh(ico(0.2, 0), dark, torso, 0, 0.72, 0.06);
    this.mesh(box(0.3, 0.07, 0.07), glow, torso, 0, 0.7, 0.2);

    const mkArm = (side) => {
      const shoulder = new THREE.Group();
      shoulder.position.set(side * 0.62, 0.42, 0);
      torso.add(shoulder);
      this.mesh(box(0.28, 0.3, 0.34), dark, shoulder, 0, -0.1, 0);
      const elbow = new THREE.Group();
      elbow.position.y = -0.3;
      shoulder.add(elbow);
      this.mesh(box(0.24, 0.5, 0.24), shell, elbow, 0, -0.25, 0);
      this.mesh(box(0.34, 0.36, 0.34), dark, elbow, 0, -0.6, 0);
      return { shoulder, elbow };
    };
    const l = mkArm(-1);
    const r = mkArm(1);
    this.armL = l.shoulder;
    this.armR = r.shoulder;
    this.elbowL = l.elbow;
    this.elbowR = r.elbow;

    const mkLeg = (side) => {
      const hip = new THREE.Group();
      hip.position.set(side * 0.26, -0.02, 0);
      pelvis.add(hip);
      this.mesh(box(0.28, 0.44, 0.28), dark, hip, 0, -0.22, 0);
      const knee = new THREE.Group();
      knee.position.y = -0.44;
      hip.add(knee);
      this.mesh(box(0.24, 0.44, 0.24), shell, knee, 0, -0.22, 0);
      this.mesh(box(0.3, 0.12, 0.4), dark, knee, 0, -0.46, 0.06);
      return { hip, knee };
    };
    const ll = mkLeg(-1);
    const rr = mkLeg(1);
    this.legL = ll.hip;
    this.legR = rr.hip;
    this.kneeL = ll.knee;
    this.kneeR = rr.knee;
  }

  animate(dt, s) {
    const amp = clamp(s.speed / 2.4, 0, 1);
    this.phase += dt * (2.4 + s.speed * 1.5);
    const sw = Math.sin(this.phase) * 0.5 * amp;
    let lean = 0.08;
    let armLx = -0.2;
    let armRx = -0.2;
    let crouch = 0;

    if (s.attack) {
      const p = clamp(s.attack.t01, 0, 1);
      if (p < 0.7) {
        const k = easeOut(p / 0.7);
        armLx = -0.2 - 2.3 * k;
        armRx = -0.2 - 2.3 * k;
        lean = 0.08 - 0.3 * k;
        crouch = -0.06 * k;
      } else {
        const k = easeOut((p - 0.7) / 0.3);
        armLx = -2.5 + 2.7 * k;
        armRx = -2.5 + 2.7 * k;
        lean = -0.22 + 0.55 * k;
        crouch = -0.06 + 0.14 * k;
      }
    }

    this.torso.rotation.x = dampTo(this.torso.rotation.x, lean, 16, dt);
    this.armL.rotation.x = dampTo(this.armL.rotation.x, armLx, 20, dt);
    this.armR.rotation.x = dampTo(this.armR.rotation.x, armRx, 20, dt);
    this.legL.rotation.x = dampTo(this.legL.rotation.x, sw, 14, dt);
    this.legR.rotation.x = dampTo(this.legR.rotation.x, -sw, 14, dt);
    this.kneeL.rotation.x = dampTo(this.kneeL.rotation.x, Math.max(0, -sw) * 0.8, 14, dt);
    this.kneeR.rotation.x = dampTo(this.kneeR.rotation.x, Math.max(0, sw) * 0.8, 14, dt);
    this.pelvis.position.y = 1.05 + crouch + Math.abs(Math.sin(this.phase)) * 0.03 * amp;
  }
}

/* ---------------- Boss ---------------- */
export class BossRig extends Rig {
  constructor(pal) {
    super();
    const shell = this.mat(pal.armor, 0x000000, 0, { roughness: 0.42, metalness: 0.28 });
    const dark = this.mat(pal.dark, 0x000000, 0, { roughness: 0.9 });
    const glow = this.mat(pal.glow, pal.glow, 2.6, { roughness: 0.25 });
    const ember = this.mat(0xff4d1a, 0xff4d1a, 1.4, { roughness: 0.5 });

    const pelvis = new THREE.Group();
    pelvis.position.y = 1.55;
    this.body.add(pelvis);
    this.pelvis = pelvis;

    const torso = new THREE.Group();
    pelvis.add(torso);
    this.torso = torso;

    this.mesh(box(1.1, 1.0, 0.68), shell, torso, 0, 0.28, 0);
    this.mesh(box(0.34, 0.4, 0.14), ember, torso, 0, 0.3, 0.36);
    this.mesh(box(0.9, 0.12, 0.1), glow, torso, 0, -0.02, 0.33);

    const head = new THREE.Group();
    head.position.y = 0.96;
    torso.add(head);
    this.head = head;
    const skull = this.mesh(ico(0.26, 0), dark, head, 0, 0.02, 0);
    skull.scale.set(1, 0.9, 1.05);
    this.mesh(box(0.34, 0.06, 0.08), ember, head, 0, 0.04, 0.2);
    const hornL = this.mesh(cone(0.09, 0.55, 4), shell, head, -0.19, 0.26, -0.04);
    hornL.rotation.z = 0.5;
    const hornR = this.mesh(cone(0.09, 0.55, 4), shell, head, 0.19, 0.26, -0.04);
    hornR.rotation.z = -0.5;

    // 斗篷
    const cloak = this.mesh(cone(0.72, 1.5, 6), dark, torso, 0, -0.16, -0.1);
    cloak.rotation.x = Math.PI;
    cloak.material.side = THREE.DoubleSide;

    const mkArm = (side) => {
      const shoulder = new THREE.Group();
      shoulder.position.set(side * 0.72, 0.6, 0);
      torso.add(shoulder);
      this.mesh(box(0.34, 0.36, 0.4), dark, shoulder, 0, -0.1, 0);
      const elbow = new THREE.Group();
      elbow.position.y = -0.36;
      shoulder.add(elbow);
      this.mesh(box(0.26, 0.6, 0.26), shell, elbow, 0, -0.3, 0);
      const claw = this.mesh(cone(0.16, 0.7, 4), ember, elbow, 0, -0.88, 0.04);
      claw.rotation.x = Math.PI;
      return { shoulder, elbow };
    };
    const l = mkArm(-1);
    const r = mkArm(1);
    this.armL = l.shoulder;
    this.armR = r.shoulder;
    this.elbowL = l.elbow;
    this.elbowR = r.elbow;

    const mkLeg = (side) => {
      const hip = new THREE.Group();
      hip.position.set(side * 0.3, -0.04, 0);
      pelvis.add(hip);
      this.mesh(box(0.32, 0.5, 0.32), dark, hip, 0, -0.25, 0);
      const knee = new THREE.Group();
      knee.position.y = -0.5;
      hip.add(knee);
      this.mesh(box(0.28, 0.5, 0.28), shell, knee, 0, -0.25, 0);
      this.mesh(box(0.36, 0.14, 0.46), dark, knee, 0, -0.52, 0.07);
      return { hip, knee };
    };
    const ll = mkLeg(-1);
    const rr = mkLeg(1);
    this.legL = ll.hip;
    this.legR = rr.hip;
    this.kneeL = ll.knee;
    this.kneeR = rr.knee;

    // 环绕碎晶
    this.shards = [];
    for (let i = 0; i < 6; i++) {
      const s = this.mesh(oct(0.13), glow, this.body, 0, 0, 0);
      s.scale.set(1, 2.2, 1);
      this.shards.push(s);
    }

    this.aura = new THREE.Mesh(
      torus(1.5, 0.03, 4, 28),
      new THREE.MeshBasicMaterial({ color: pal.glow, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    this.aura.rotation.x = Math.PI / 2;
    this.aura.position.y = 0.04;
    this.root.add(this.aura);
  }

  animate(dt, s) {
    const amp = clamp(s.speed / 3, 0, 1);
    this.phase += dt * (2.2 + s.speed * 1.4);
    const sw = Math.sin(this.phase) * 0.6 * amp;
    let lean = 0.1;
    let armLx = -0.15;
    let armRx = -0.15;

    if (s.attack) {
      const p = clamp(s.attack.t01, 0, 1);
      if (p < 0.6) {
        const k = easeOut(p / 0.6);
        armLx = -0.15 - 2.5 * k;
        armRx = -0.15 - 2.5 * k;
        lean = 0.1 - 0.45 * k;
      } else {
        const k = easeOut((p - 0.6) / 0.4);
        armLx = -2.65 + 2.9 * k;
        armRx = -2.65 + 2.9 * k;
        lean = -0.35 + 0.6 * k;
      }
    }

    this.torso.rotation.x = dampTo(this.torso.rotation.x, lean, 14, dt);
    this.armL.rotation.x = dampTo(this.armL.rotation.x, armLx, 16, dt);
    this.armR.rotation.x = dampTo(this.armR.rotation.x, armRx, 16, dt);
    this.legL.rotation.x = dampTo(this.legL.rotation.x, sw, 12, dt);
    this.legR.rotation.x = dampTo(this.legR.rotation.x, -sw, 12, dt);
    this.kneeL.rotation.x = dampTo(this.kneeL.rotation.x, Math.max(0, -sw) * 0.8, 12, dt);
    this.kneeR.rotation.x = dampTo(this.kneeR.rotation.x, Math.max(0, sw) * 0.8, 12, dt);
    this.pelvis.position.y = 1.55 + Math.abs(Math.sin(this.phase)) * 0.04 * amp;

    this.shards.forEach((sh, i) => {
      const a = this.t * 0.9 + (i / 6) * TAU;
      sh.position.set(Math.cos(a) * 1.35, 1.3 + Math.sin(this.t * 1.8 + i) * 0.35, Math.sin(a) * 1.35);
      sh.rotation.y += dt * 1.8;
      sh.rotation.z += dt * 1.1;
    });
    this.aura.scale.setScalar(1 + Math.sin(this.t * 2) * 0.04);
  }
}

export const PALETTES = {
  hero: { armor: 0xc6d3e2, dark: 0x232b38, glow: 0x4fe3d0, trim: 0x8fa3bd },
  grunt: { armor: 0x8a6350, dark: 0x33241c, glow: 0xff8a3d },
  spitter: { armor: 0x64529a, dark: 0x241c3a, glow: 0xc07bff },
  brute: { armor: 0x7b828f, dark: 0x2b2e36, glow: 0xff3b52 },
  boss: { armor: 0x4c4756, dark: 0x16121c, glow: 0xff7a18 },
};
