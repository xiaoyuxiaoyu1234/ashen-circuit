// entities.js — 玩家 / 敌人 / 投射物
import * as THREE from 'three';
import { clamp, damp, rand, turnToward, angleDelta, TAU, lerp } from './engine.js';
import { HeroRig, GruntRig, SpitterRig, BruteRig, BossRig, PALETTES } from './actors.js';
import { Telegraph } from './fx.js';

const COMBO = [
  { kind: 'light', wind: 0.085, act: 0.09, rec: 0.17, dmg: 14, range: 2.3, arc: 1.9, lunge: 2.6, cost: 6, knock: 3.5, sfx: 'swing' },
  { kind: 'light', wind: 0.075, act: 0.09, rec: 0.19, dmg: 16, range: 2.35, arc: 2.1, lunge: 2.2, cost: 6, knock: 3.5, sfx: 'swing' },
  { kind: 'light', wind: 0.14, act: 0.11, rec: 0.34, dmg: 31, range: 2.9, arc: 2.55, lunge: 4.8, cost: 11, knock: 8, sfx: 'swingHeavy' },
];

const HEAVY = { kind: 'heavy', wind: 0.3, act: 0.13, rec: 0.36, dmg: 42, range: 3.1, arc: 2.75, lunge: 3.2, cost: 18, knock: 13, sfx: 'swingHeavy' };

export class Player {
  constructor(scene) {
    this.rig = new HeroRig(PALETTES.hero);
    scene.add(this.rig.root);

    this.pos = new THREE.Vector3(0, 0, 0);
    this.vel = new THREE.Vector3();
    this.facing = Math.PI;
    this.radius = 0.42;

    this.maxHp = 100;
    this.hp = 100;
    this.maxStamina = 100;
    this.stamina = 100;
    this.staminaDelay = 0;

    this.state = 'idle';
    this.attack = null;
    this.queued = null;
    this.dodge = null;
    this.dodgeT = 0;
    this.invuln = 0;
    this.hurtT = 0;
    this.comboIndex = 0;
    this.comboTimer = 0;
    this.attackT01 = 0;
    this.dead = false;
    this.stepT = 0;
    this.kills = 0;
    this.fury = 0;           // 战意层数

    this.mods = {
      dmg: 1,
      atkSpeed: 1,
      moveSpeed: 1,
      staminaRegen: 1,
      invulnBonus: 0,
      dodgeDamage: 0,
      swordWave: false,
      lifeOnKill: 0,
      damageTaken: 1,
      execute: 0,
      thorns: 0,
      crit: 0,
      fury: false,
    };
    this.ctx = null;
  }

  get forward() {
    return { x: Math.sin(this.facing), z: Math.cos(this.facing) };
  }

  heal(n) {
    this.hp = Math.min(this.maxHp, this.hp + n);
  }

  addMods(list) {
    for (const u of list) {
      switch (u.id) {
        case 'blade': this.mods.dmg += 0.2; break;
        case 'swift': this.mods.atkSpeed += 0.15; break;
        case 'stride': this.mods.moveSpeed += 0.12; break;
        case 'bone':
          this.maxHp += 30; this.hp = Math.min(this.maxHp, this.hp + 30); break;
        case 'spring':
          this.maxStamina += 30; this.stamina = this.maxStamina; this.mods.staminaRegen += 0.35; break;
        case 'phase': this.mods.invulnBonus += 0.09; this.mods.dodgeDamage += 22; break;
        case 'wave': this.mods.swordWave = true; break;
        case 'leech': this.mods.lifeOnKill += 7; break;
        case 'tough': this.mods.damageTaken *= 0.84; break;
        case 'execute': this.mods.execute += 0.6; break;
        case 'thorns': this.mods.thorns += 18; break;
        case 'crit': this.mods.crit += 0.2; break;
        case 'fury': this.mods.fury = true; break;
        default: break;
      }
    }
    this.hp = Math.min(this.hp, this.maxHp);
  }

  /* ---------------- 更新 ---------------- */
  update(dt, ctx) {
    this.ctx = ctx;
    if (this.dead) {
      this.rig.tick(dt);
      this.rig.root.position.copy(this.pos);
      return;
    }

    this.invuln = Math.max(0, this.invuln - dt);
    this.hurtT = Math.max(0, this.hurtT - dt);
    this.comboTimer = Math.max(0, this.comboTimer - dt);
    if (this.comboTimer <= 0 && !this.attack) this.comboIndex = 0;

    // 体力
    this.staminaDelay = Math.max(0, this.staminaDelay - dt);
    if (this.staminaDelay <= 0) {
      this.stamina = Math.min(this.maxStamina, this.stamina + (26 * this.mods.staminaRegen) * dt);
    }

    const ax = ctx.input.axis();
    let dirX = ctx.basis.rx * ax.x + ctx.basis.fx * ax.y;
    let dirZ = ctx.basis.rz * ax.x + ctx.basis.fz * ax.y;
    const inputLen = Math.hypot(dirX, dirZ);
    if (inputLen > 1) {
      dirX /= inputLen;
      dirZ /= inputLen;
    }

    if (this.state === 'dodge') this.updateDodge(dt);
    else if (this.state === 'attack') this.updateAttack(dt, ctx);
    else this.updateMove(dt, ctx, dirX, dirZ, inputLen);

    // 动作输入
    if (this.state !== 'dodge' && this.hurtT <= 0) {
      if (ctx.input.consume('dodge') && this.stamina >= 22) {
        this.startDodge(dirX, dirZ, inputLen);
      } else if (ctx.input.consume('light')) {
        this.tryAttack('light', ctx);
      } else if (ctx.input.consume('heavy')) {
        this.tryAttack('heavy', ctx);
      }
    }

    // 积分位置
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    ctx.world.collide(this.pos, this.radius);

    // 软锁：静止时缓慢面向最近敌人
    if (this.state !== 'attack' && this.state !== 'dodge' && inputLen > 0.1) {
      const want = Math.atan2(dirX, dirZ);
      this.facing = turnToward(this.facing, want, dt * 16);
    }

    // 脚步音效
    const spd = Math.hypot(this.vel.x, this.vel.z);
    if (spd > 1.4 && this.state !== 'dodge') {
      this.stepT -= dt * spd;
      if (this.stepT <= 0) {
        this.stepT = 5.2;
        ctx.audio.play('step', { vol: 0.55 });
      }
    }

    // 视觉
    this.rig.root.position.copy(this.pos);
    this.rig.root.rotation.y = this.facing;
    this.rig.animate(dt, {
      speed: spd,
      attack: this.attack ? { t01: this.attackT01, kind: this.attack.def.kind } : null,
      dodgeT: this.state === 'dodge' ? this.dodgeT / 0.34 : 0,
      hurtT: this.hurtT / 0.22,
    });
    this.rig.tick(dt);
    this.rig.root.visible = this.invuln > 0 && this.state === 'dodge'
      ? (Math.floor(this.invuln * 30) % 2 === 0)
      : true;
  }

  updateMove(dt, ctx, dirX, dirZ, inputLen) {
    const targetSpeed = 6.1 * this.mods.moveSpeed;
    const tx = dirX * targetSpeed;
    const tz = dirZ * targetSpeed;
    const accel = inputLen > 0.05 ? 13 : 18;
    this.vel.x = damp(this.vel.x, tx, accel, dt);
    this.vel.z = damp(this.vel.z, tz, accel, dt);
    this.staminaDelay = Math.max(this.staminaDelay, 0);
    if (inputLen > 0.05) this.facing = turnToward(this.facing, Math.atan2(dirX, dirZ), dt * 11);
  }

  startDodge(dirX, dirZ, inputLen) {
    this.state = 'dodge';
    this.dodgeT = 0;
    const f = inputLen > 0.2 ? { x: dirX / Math.max(inputLen, 0.001), z: dirZ / Math.max(inputLen, 0.001) } : this.forward;
    this.dodge = { x: f.x, z: f.z };
    this.facing = Math.atan2(f.x, f.z);
    this.invuln = 0.1 + 0.2 + this.mods.invulnBonus;
    this.stamina -= 22;
    this.staminaDelay = 0.5;
    this.attack = null;
    this.dodgeHits = new Set();
    this.ctx.audio.play('dodge');
    this.ctx.rig.fovKick = 5;
  }

  updateDodge(dt) {
    this.dodgeT += dt;
    const k = clamp(this.dodgeT / 0.34, 0, 1);
    const spd = 17 * Math.pow(1 - k, 1.35) + 2.5;
    this.vel.x = this.dodge.x * spd;
    this.vel.z = this.dodge.z * spd;

    // 幻步：翻滚穿过敌人造成伤害
    if (this.mods.dodgeDamage > 0 && k > 0.1 && k < 0.85) {
      for (const e of this.ctx.enemies) {
        if (!e.alive || this.dodgeHits.has(e)) continue;
        const d = Math.hypot(e.pos.x - this.pos.x, e.pos.z - this.pos.z);
        if (d < e.radius + this.radius + 0.25) {
          this.dodgeHits.add(e);
          this.ctx.hitEnemy(e, this.mods.dodgeDamage, { kind: 'dodge', knock: 4 });
        }
      }
    }

    if (k >= 1) {
      this.state = 'idle';
      this.dodge = null;
    }
  }

  tryAttack(kind, ctx) {
    const cost = kind === 'heavy' ? HEAVY.cost : COMBO[Math.min(this.comboIndex, 2)].cost;

    if (this.state === 'attack') {
      // 连段预输入
      const d = this.attack.def;
      const passed = this.attack.t;
      if (passed > d.wind + d.act * 0.4 && this.queued == null) {
        this.queued = kind;
        return;
      }
      return;
    }
    if (this.state === 'dodge') return;
    if (this.stamina < cost) {
      ctx.audio.play('block', { vol: 0.4 });
      return;
    }

    const def = kind === 'heavy' ? HEAVY : COMBO[Math.min(this.comboIndex, 2)];
    this.stamina -= cost;
    this.staminaDelay = 0.45;

    // 软锁：自动转向最近敌人
    let best = null;
    let bestD = 1e9;
    for (const e of ctx.enemies) {
      if (!e.alive) continue;
      const dx = e.pos.x - this.pos.x;
      const dz = e.pos.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 7.5) continue;
      const ang = Math.abs(angleDelta(this.facing, Math.atan2(dx, dz)));
      if (ang > 1.6) continue;
      const score = d + ang * 1.8;
      if (score < bestD) {
        bestD = score;
        best = Math.atan2(dx, dz);
      }
    }
    if (best != null) this.facing = best;

    const crit = Math.random() < this.mods.crit;
    this.attack = {
      def,
      t: 0,
      index: kind === 'light' ? this.comboIndex : 0,
      crit,
      hit: new Set(),
      lunged: false,
    };
    this.attackT01 = 0;
    this.state = 'attack';
    this.queued = null;
    this.rig.flash(0.12);
    ctx.audio.play(def.sfx, { vol: kind === 'heavy' ? 1 : 0.8 });
  }

  updateAttack(dt, ctx) {
    const a = this.attack;
    const sp = 1 / this.mods.atkSpeed;
    const d = a.def;
    const wind = d.wind * sp;
    const act = d.act * sp;
    const rec = d.rec * sp;
    const total = wind + act + rec;

    a.t += dt;
    this.attackT01 = clamp(a.t / total, 0, 1);

    // 冲刺位移
    if (!a.lunged && a.t >= wind) {
      a.lunged = true;
      const f = this.forward;
      this.vel.x += f.x * d.lunge;
      this.vel.z += f.z * d.lunge;
      ctx.rig.addTrauma(d.kind === 'heavy' ? 0.16 : 0.1);
      ctx.fx.slash(
        { x: this.pos.x, y: 0.85, z: this.pos.z },
        this.facing,
        d.range * 0.92,
        d.arc,
        a.crit ? 0xffe08a : 0x9ef7ff,
        d.kind === 'heavy' ? 0.28 : 0.2
      );
      // 裂空：三段连击的最后一击释放剑气
      if (this.mods.swordWave && d.kind === 'light' && a.index === COMBO.length - 1) {
        ctx.spawnProjectile(
          { x: this.pos.x + f.x * 1.15, y: 1.05, z: this.pos.z + f.z * 1.15 },
          f,
          { speed: 19, dmg: 24 * this.mods.dmg, color: 0x9ef7ff, radius: 0.45, life: 1.1, owner: 'player' }
        );
        ctx.audio.play('shoot', { vol: 0.8 });
      }
    }

    // 判定窗口
    if (a.t >= wind && a.t <= wind + act + 0.06) {
      const dmgBase = d.dmg * this.mods.dmg * (a.crit ? 2 : 1);
      ctx.hitSector(this, this.pos, this.facing, d.range, d.arc, dmgBase, {
        crit: a.crit,
        knock: d.knock,
        kind: d.kind,
        hitSet: a.hit,
      });
    }

    // 摩擦
    this.vel.x = damp(this.vel.x, 0, 9, dt);
    this.vel.z = damp(this.vel.z, 0, 9, dt);

    // 预输入
    if (a.t > wind + act * 0.5 && this.queued == null) {
      if (ctx.input.consume('light')) this.queued = 'light';
      else if (ctx.input.consume('heavy')) this.queued = 'heavy';
      else if (ctx.input.consume('dodge') && this.stamina >= 22 && a.t > wind + act) {
        this.startDodge(0, 0, 0);
        return;
      }
    }

    if (a.t >= total) {
      this.comboTimer = 0.62;
      if (this.queued === 'light' && d.kind === 'light' && a.index < COMBO.length - 1 && this.stamina >= COMBO[a.index + 1].cost) {
        this.comboIndex = a.index + 1;
        const q = this.queued;
        this.queued = null;
        this.state = 'idle';
        this.attack = null;
        this.tryAttack(q, ctx);
        return;
      }
      if (this.queued === 'heavy' && this.stamina >= HEAVY.cost) {
        const q = this.queued;
        this.queued = null;
        this.state = 'idle';
        this.attack = null;
        this.comboIndex = 0;
        this.tryAttack(q, ctx);
        return;
      }
      this.attack = null;
      this.state = 'idle';
      this.queued = null;
      if (d.kind === 'heavy') this.comboIndex = 0;
    }
  }

  takeDamage(amount, fromPos) {
    if (this.dead || this.invuln > 0 || this.state === 'dodge') return 0;
    const dmg = Math.max(1, Math.round(amount * this.mods.damageTaken));
    this.hp -= dmg;
    this.invuln = 0.62;
    this.hurtT = 0.22;
    this.fury = 0;
    this.staminaDelay = 0.7;

    // 击退
    if (fromPos) {
      const dx = this.pos.x - fromPos.x;
      const dz = this.pos.z - fromPos.z;
      const l = Math.hypot(dx, dz) || 1;
      this.vel.x += (dx / l) * 6;
      this.vel.z += (dz / l) * 6;
    }

    if (this.ctx) {
      this.ctx.audio.play('hurt');
      this.ctx.rig.addTrauma(0.5);
      this.ctx.fx.spark({ x: this.pos.x, y: 1.1, z: this.pos.z }, 0xff5a3d, 16, { speed: 5 });
      this.ctx.fx.impact({ x: this.pos.x, y: 1.1, z: this.pos.z }, 0xff6b3d, 1.2);
      this.ctx.ui.damageNumber({ x: this.pos.x, y: 1.9, z: this.pos.z }, `-${dmg}`, 'player');
      this.ctx.ui.hurtFlash();
      this.ctx.feel.hitstop(0.09);
    }
    this.rig.flash(0.7);

    if (this.hp <= 0) {
      this.hp = 0;
      this.dead = true;
      this.state = 'dead';
      this.attack = null;
      this.rig.die();
      if (this.ctx) {
        this.ctx.audio.play('die');
        this.ctx.rig.addTrauma(1);
      }
    }
    return dmg;
  }
}

/* ================= 敌人 ================= */
const TYPES = {
  grunt: { rig: GruntRig, pal: PALETTES.grunt, hp: 46, speed: 3.5, radius: 0.55, dmg: 12, armor: 0 },
  spitter: { rig: SpitterRig, pal: PALETTES.spitter, hp: 36, speed: 2.7, radius: 0.62, dmg: 9, armor: 0, ranged: true },
  brute: { rig: BruteRig, pal: PALETTES.brute, hp: 170, speed: 2.05, radius: 0.95, dmg: 24, armor: 0.35 },
};

export class Enemy {
  constructor(scene, type, pos, level = 1) {
    const cfg = TYPES[type];
    this.type = type;
    this.cfg = cfg;
    this.level = level;
    this.rig = new cfg.rig(cfg.pal);
    scene.add(this.rig.root);

    this.pos = new THREE.Vector3(pos.x, 0, pos.z);
    this.vel = new THREE.Vector3();
    this.facing = Math.atan2(-pos.x, -pos.z);
    this.radius = cfg.radius;
    this.maxHp = Math.round(cfg.hp * (1 + (level - 1) * 0.22));
    this.hp = this.maxHp;
    this.dmg = cfg.dmg * (1 + (level - 1) * 0.14);
    this.alive = true;
    this.state = 'chase';
    this.st = 0;
    this.cooldown = rand(0.4, 1.4);
    this.stagger = 0;
    this.hitFlash = 0;
    this.tel = new Telegraph(scene, 0xff5a3d);
    this.attackT01 = 0;
    this.dashDir = { x: 0, z: 1 };
    this.hitDone = false;
    this.kb = new THREE.Vector3();
    this.strafeDir = Math.random() < 0.5 ? -1 : 1;
    this.strafeT = 0;
    this.deadT = 0;
  }

  get hpRatio() {
    return this.hp / this.maxHp;
  }

  takeDamage(amount, opts = {}) {
    if (!this.alive) return 0;
    const dmg = Math.max(1, Math.round(amount));
    this.hp -= dmg;

    const arm = 1 - (this.cfg.armor || 0);
    const kb = (opts.knock == null ? 3 : opts.knock) * arm;
    const dir = opts.dir || { x: 0, z: 0 };
    this.kb.x += dir.x * kb;
    this.kb.z += dir.z * kb;
    this.rig.flash(1);
    this.stagger = Math.max(this.stagger, (opts.kind === 'heavy' ? 0.26 : 0.14) * (this.type === 'brute' ? 0.35 : 1));

    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      this.state = 'dead';
      this.rig.die();
      this.tel.hide();
    }
    return dmg;
  }

  update(dt, ctx) {
    if (!this.alive) {
      this.deadT += dt;
      this.rig.root.position.copy(this.pos);
      this.rig.root.rotation.y = this.facing;
      return this.rig.tick(dt);
    }

    this.stagger = Math.max(0, this.stagger - dt);
    this.cooldown = Math.max(0, this.cooldown - dt);

    const dx = ctx.player.pos.x - this.pos.x;
    const dz = ctx.player.pos.z - this.pos.z;
    const dist = Math.hypot(dx, dz) || 0.001;
    const toPlayer = Math.atan2(dx, dz);

    // 击退衰减
    this.vel.x += this.kb.x;
    this.vel.z += this.kb.z;
    this.kb.multiplyScalar(Math.exp(-9 * dt));

    if (this.stagger > 0) {
      this.vel.x = damp(this.vel.x, 0, 8, dt);
      this.vel.z = damp(this.vel.z, 0, 8, dt);
      const spd = Math.hypot(this.vel.x, this.vel.z);
      this.rig.root.position.copy(this.pos);
      this.rig.animate(dt, { speed: spd, attack: null });
      this.rig.tick(dt);
      this.pos.x += this.vel.x * dt;
      this.pos.z += this.vel.z * dt;
      ctx.world.collide(this.pos, this.radius);
      return false;
    }

    this.behave(dt, ctx, dist, toPlayer, dx, dz);

    // 位移积分
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    ctx.world.collide(this.pos, this.radius);

    // 与玩家分离
    const pd = Math.hypot(ctx.player.pos.x - this.pos.x, ctx.player.pos.z - this.pos.z);
    const minD = this.radius + ctx.player.radius;
    if (pd < minD && pd > 0.0001) {
      const nx = (this.pos.x - ctx.player.pos.x) / pd;
      const nz = (this.pos.z - ctx.player.pos.z) / pd;
      this.pos.x = ctx.player.pos.x + nx * minD;
      this.pos.z = ctx.player.pos.z + nz * minD;
    }

    this.rig.root.position.copy(this.pos);
    this.rig.root.rotation.y = this.facing;
    const spd = Math.hypot(this.vel.x, this.vel.z);
    this.rig.animate(dt, {
      speed: spd,
      attack: this.state === 'windup' || this.state === 'dash' || this.state === 'slam' || this.state === 'burst'
        ? { t01: this.attackT01 }
        : null,
    });
    return this.rig.tick(dt);
  }

  behave(dt, ctx, dist, toPlayer, dx, dz) {
    const cfg = this.cfg;

    if (this.type === 'grunt') {
      if (this.state === 'chase') {
        this.facing = turnToward(this.facing, toPlayer, dt * 5);
        const want = dist > 3.6 ? cfg.speed : cfg.speed * 0.35;
        this.vel.x = damp(this.vel.x, (dx / dist) * want, 8, dt);
        this.vel.z = damp(this.vel.z, (dz / dist) * want, 8, dt);
        if (dist < 4.2 && this.cooldown <= 0) {
          this.state = 'windup';
          this.st = 0;
          this.hitDone = false;
          this.dashDir = { x: dx / dist, z: dz / dist };
          this.tel.showArc(this.pos, 4.0, 1.1, this.facing, 0.55);
          ctx.audio.play('telegraph', { vol: 0.6 });
        }
      } else if (this.state === 'windup') {
        this.vel.x = damp(this.vel.x, 0, 12, dt);
        this.vel.z = damp(this.vel.z, 0, 12, dt);
        this.facing = turnToward(this.facing, toPlayer, dt * 2.4);
        this.attackT01 = clamp(this.st / 0.55, 0, 1);
        this.st += dt;
        if (this.st >= 0.55) {
          this.state = 'dash';
          this.st = 0;
          this.hitDone = false;
          this.tel.hide();
        }
      } else if (this.state === 'dash') {
        this.st += dt;
        this.vel.x = this.dashDir.x * 13.5;
        this.vel.z = this.dashDir.z * 13.5;
        if (!this.hitDone && dist < this.radius + ctx.player.radius + 0.55) {
          this.hitDone = true;
          ctx.hurtPlayer(this.dmg, this.pos);
          ctx.fx.shockwave(this.pos, 2.4, 0xff8a3d, 0.35);
        }
        if (this.st >= 0.34) {
          this.state = 'recover';
          this.st = 0;
          this.cooldown = rand(1.1, 1.8);
        }
      } else if (this.state === 'recover') {
        this.st += dt;
        this.vel.x = damp(this.vel.x, 0, 10, dt);
        this.vel.z = damp(this.vel.z, 0, 10, dt);
        if (this.st >= 0.62) this.state = 'chase';
      }
    } else if (this.type === 'spitter') {
      this.strafeT -= dt;
      if (this.strafeT <= 0) {
        this.strafeT = rand(1.2, 2.6);
        this.strafeDir *= -1;
      }
      this.facing = turnToward(this.facing, toPlayer, dt * 3.4);

      if (this.state === 'chase') {
        let wx = 0;
        let wz = 0;
        if (dist > 10) {
          wx = dx / dist;
          wz = dz / dist;
        } else if (dist < 6.5) {
          wx = -dx / dist;
          wz = -dz / dist;
        }
        wx += (-dz / dist) * this.strafeDir * 0.75;
        wz += (dx / dist) * this.strafeDir * 0.75;
        this.vel.x = damp(this.vel.x, wx * cfg.speed, 6, dt);
        this.vel.z = damp(this.vel.z, wz * cfg.speed, 6, dt);
        if (dist < 15 && this.cooldown <= 0) {
          this.state = 'windup';
          this.st = 0;
          this.tel.showArc(this.pos, 12, 0.5, this.facing, 0.62);
        }
      } else if (this.state === 'windup') {
        this.st += dt;
        this.attackT01 = clamp(this.st / 0.62, 0, 1);
        this.vel.x = damp(this.vel.x, 0, 10, dt);
        this.vel.z = damp(this.vel.z, 0, 10, dt);
        if (this.st >= 0.62) {
          this.tel.hide();
          const dir = { x: Math.sin(this.facing), z: Math.cos(this.facing) };
          ctx.spawnProjectile(
            { x: this.pos.x + dir.x * 0.7, y: 1.2, z: this.pos.z + dir.z * 0.7 },
            dir,
            { speed: 11, dmg: this.dmg, color: 0xc07bff, radius: 0.3, owner: this }
          );
          ctx.audio.play('shoot', { vol: 0.8 });
          this.state = 'chase';
          this.cooldown = rand(2.1, 2.9);
        }
      }
    } else if (this.type === 'brute') {
      if (this.state === 'chase') {
        this.facing = turnToward(this.facing, toPlayer, dt * 3);
        const want = dist > 2.6 ? cfg.speed : 0;
        this.vel.x = damp(this.vel.x, (dx / dist) * want, 6, dt);
        this.vel.z = damp(this.vel.z, (dz / dist) * want, 6, dt);
        if (dist < 3.6 && this.cooldown <= 0) {
          this.state = 'windup';
          this.st = 0;
          this.tel.show(this.pos, 4.3, 0.95);
          ctx.audio.play('telegraph', { vol: 0.8 });
        }
      } else if (this.state === 'windup') {
        this.st += dt;
        this.attackT01 = clamp(this.st / 0.95, 0, 1);
        this.vel.x = damp(this.vel.x, 0, 9, dt);
        this.vel.z = damp(this.vel.z, 0, 9, dt);
        if (this.st >= 0.95) {
          this.st = 0;
          this.state = 'recover';
          this.cooldown = rand(1.6, 2.2);
          this.tel.hide();
          ctx.fx.shockwave(this.pos, 4.3, 0xff3b52, 0.5);
          ctx.fx.spark({ x: this.pos.x, y: 0.2, z: this.pos.z }, 0xff5a3d, 26, { speed: 8, spread: 1.4, life: 0.6 });
          ctx.audio.play('boom', { vol: 0.85 });
          ctx.rig.addTrauma(0.45);
          if (dist < 4.3 + ctx.player.radius) ctx.hurtPlayer(this.dmg, this.pos);
        }
      } else if (this.state === 'recover') {
        this.st += dt;
        this.vel.x = damp(this.vel.x, 0, 8, dt);
        this.vel.z = damp(this.vel.z, 0, 8, dt);
        if (this.st >= 0.85) this.state = 'chase';
      }
    }
  }
}

/* ================= Boss ================= */
export class Boss extends Enemy {
  constructor(scene, pos, level = 1) {
    super(scene, 'grunt', pos, level);
    this.type = 'boss';
    this.cfg = { armor: 0.55, radius: 1.5 };
    this.rig.dispose();
    scene.remove(this.rig.root);
    this.rig = new BossRig(PALETTES.boss);
    scene.add(this.rig.root);

    this.radius = 1.5;
    this.maxHp = 1150;
    this.hp = this.maxHp;
    this.dmg = 26;
    this.phase = 1;
    this.cooldown = 1.6;
    this.action = null;
    this.summoned = 0;
    this.dashCount = 0;
    this.tel = new Telegraph(scene, 0xff7a18);
  }

  get phaseOf() {
    const r = this.hpRatio;
    if (r > 0.66) return 1;
    if (r > 0.33) return 2;
    return 3;
  }

  behave(dt, ctx, dist, toPlayer, dx, dz) {
    const ph = this.phaseOf;
    if (ph !== this.phase) {
      this.phase = ph;
      this.cooldown = 0.4;
      ctx.fx.shockwave(this.pos, 7, 0xff7a18, 0.7);
      ctx.audio.play('boom', { vol: 1 });
      ctx.rig.addTrauma(0.7);
      ctx.ui.toast(ph === 3 ? '灰烬之主 · 终末' : '灰烬之主 · 苏醒');
      for (const e of ctx.enemies) {
        if (e.alive && e !== this) {
          e.takeDamage(0, {});
        }
      }
    }

    if (this.state === 'chase') {
      this.facing = turnToward(this.facing, toPlayer, dt * 3.2);
      const want = dist > 4 ? this.cfg2Speed() : 0.6;
      this.vel.x = damp(this.vel.x, (dx / dist) * want, 6, dt);
      this.vel.z = damp(this.vel.z, (dz / dist) * want, 6, dt);
      if (this.cooldown <= 0) this.pickAction(ctx, dist, dx, dz);
    } else if (this.state === 'windup') {
      this.st += dt;
      this.attackT01 = clamp(this.st / this.actionDur, 0, 1);
      this.vel.x = damp(this.vel.x, 0, 9, dt);
      this.vel.z = damp(this.vel.z, 0, 9, dt);
      if (this.action === 'charge') this.facing = turnToward(this.facing, toPlayer, dt * 2.2);
      if (this.st >= this.actionDur) this.executeAction(ctx);
    } else if (this.state === 'dash') {
      this.st += dt;
      this.vel.x = this.dashDir.x * 15;
      this.vel.z = this.dashDir.z * 15;
      ctx.fx.spark({ x: this.pos.x, y: 0.4, z: this.pos.z }, 0xff7a18, 3, { speed: 1.5, life: 0.4 });
      if (!this.hitDone && dist < this.radius + ctx.player.radius + 0.4) {
        this.hitDone = true;
        ctx.hurtPlayer(this.dmg, this.pos);
      }
      if (this.st >= 0.42) {
        this.state = 'recover';
        this.st = 0;
        this.dashCount++;
        if (this.dashCount < (this.phase >= 3 ? 4 : 3) && this.cooldown < 0.05) {
          this.state = 'windup';
          this.action = 'charge';
          this.actionDur = 0.34;
          this.st = 0;
          this.tel.showArc(this.pos, 8, 1.2, this.facing, 0.34);
        } else {
          this.cooldown = this.phase >= 3 ? 1.0 : 1.5;
        }
      }
    } else if (this.state === 'recover') {
      this.st += dt;
      this.vel.x = damp(this.vel.x, 0, 8, dt);
      this.vel.z = damp(this.vel.z, 0, 8, dt);
      if (this.st >= 0.55) this.state = 'chase';
    }
  }

  cfg2Speed() {
    return this.phase >= 3 ? 3.6 : this.phase === 2 ? 3.0 : 2.6;
  }

  pickAction(ctx, dist, dx) {
    const r = Math.random();
    this.dashCount = 0;
    if (this.phase >= 2 && r < 0.34) {
      this.action = 'burst';
      this.actionDur = 0.85;
      this.state = 'windup';
      this.st = 0;
      this.tel.showArc(this.pos, 9, TAU, this.facing, 0.85);
      ctx.audio.play('telegraph');
    } else if (this.phase >= 2 && this.summoned < this.phase - 1 && r > 0.8) {
      this.action = 'summon';
      this.actionDur = 0.7;
      this.state = 'windup';
      this.st = 0;
      this.tel.show(this.pos, 3, 0.7);
    } else {
      this.action = 'charge';
      this.actionDur = 0.62;
      this.state = 'windup';
      this.st = 0;
      this.hitDone = false;
      this.dashDir = { x: dx / Math.max(dist, 0.01), z: 0 };
      this.tel.showArc(this.pos, 8, 1.1, this.facing, 0.62);
      ctx.audio.play('telegraph');
    }
  }

  executeAction(ctx) {
    this.tel.hide();
    if (this.action === 'charge') {
      this.state = 'dash';
      this.st = 0;
      this.hitDone = false;
      const dx = ctx.player.pos.x - this.pos.x;
      const dz = ctx.player.pos.z - this.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      this.dashDir = { x: dx / d, z: dz / d };
      this.facing = Math.atan2(dx, dz);
      ctx.audio.play('swingHeavy', { vol: 0.9 });
    } else if (this.action === 'burst') {
      const n = this.phase >= 3 ? 16 : 12;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + this.facing;
        ctx.spawnProjectile(
          { x: this.pos.x + Math.sin(a) * 1.2, y: 1.4, z: this.pos.z + Math.cos(a) * 1.2 },
          { x: Math.sin(a), z: Math.cos(a) },
          { speed: 9, dmg: this.dmg * 0.55, color: 0xff7a18, radius: 0.32, owner: this }
        );
      }
      ctx.fx.shockwave(this.pos, 5, 0xff7a18, 0.45);
      ctx.audio.play('boom', { vol: 0.8 });
      ctx.rig.addTrauma(0.4);
      this.state = 'recover';
      this.st = 0;
      this.cooldown = 1.8;
    } else if (this.action === 'summon') {
      this.summoned++;
      for (let i = 0; i < 2; i++) {
        const a = Math.random() * TAU;
        ctx.spawnEnemy('grunt', {
          x: this.pos.x + Math.cos(a) * 3.5,
          z: this.pos.z + Math.sin(a) * 3.5,
        });
      }
      ctx.audio.play('spawn');
      this.state = 'recover';
      this.st = 0;
      this.cooldown = 1.4;
    }
  }

  takeDamage(amount, opts = {}) {
    const wasAlive = this.alive;
    const dmg = super.takeDamage(amount, opts);
    if (wasAlive && this.alive) {
      // 受击时有概率立刻反击
      if (Math.random() < 0.12 && this.state === 'chase') this.cooldown = 0;
    }
    return dmg;
  }
}

/* ================= 投射物 ================= */
export class Projectile {
  constructor(scene, pos, dir, opts = {}) {
    this.pos = new THREE.Vector3(pos.x, pos.y, pos.z);
    this.dir = new THREE.Vector3(dir.x, 0, dir.z).normalize();
    this.speed = opts.speed || 10;
    this.dmg = opts.dmg || 10;
    this.radius = opts.radius || 0.3;
    this.life = opts.life || 3.6;
    this.owner = opts.owner || null;
    this.color = opts.color || 0xff7a18;
    this.alive = true;
    this.trailT = 0;

    const geo = new THREE.IcosahedronGeometry(this.radius, 0);
    const mat = new THREE.MeshBasicMaterial({ color: this.color, transparent: true, opacity: 0.95 });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.copy(this.pos);
    scene.add(this.mesh);
    this.geo = geo;
    this.mat = mat;

    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(this.radius * 2.1, 8, 6),
      new THREE.MeshBasicMaterial({ color: this.color, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    this.mesh.add(halo);
    this.halo = halo;
  }

  update(dt, ctx) {
    if (!this.alive) return true;
    this.life -= dt;
    this.pos.addScaledVector(this.dir, this.speed * dt);
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.x += dt * 6;
    this.mesh.rotation.y += dt * 4;

    this.trailT -= dt;
    if (this.trailT <= 0) {
      this.trailT = 0.05;
      ctx.fx.spark(this.pos, this.color, 1, { speed: 0.5, life: 0.26, grav: 0.5 });
    }

    const pd = Math.hypot(ctx.player.pos.x - this.pos.x, ctx.player.pos.z - this.pos.z);
    if (this.owner !== 'player') {
      if (pd < this.radius + ctx.player.radius + 0.2) {
        ctx.hurtPlayer(this.dmg, this.pos);
        this.explode(ctx);
        return true;
      }
    } else {
      for (const e of ctx.enemies) {
        if (!e.alive) continue;
        const d = Math.hypot(e.pos.x - this.pos.x, e.pos.z - this.pos.z);
        if (d < this.radius + e.radius) {
          ctx.hitEnemy(e, this.dmg, { kind: 'wave', knock: 7, dir: { x: this.dir.x, z: this.dir.z } });
          this.explode(ctx);
          return true;
        }
      }
    }
    if (this.life <= 0 || ctx.world.blocked(this.pos.x, this.pos.z, this.radius)) {
      this.explode(ctx);
      return true;
    }
    return false;
  }

  explode(ctx) {
    this.alive = false;
    ctx.fx.impact(this.pos, this.color, this.radius * 2.4);
    ctx.fx.spark(this.pos, this.color, 8, { speed: 3.2, life: 0.34 });
  }

  dispose(scene) {
    scene.remove(this.mesh);
    this.geo.dispose();
    this.mat.dispose();
    this.halo.geometry.dispose();
    this.halo.material.dispose();
  }
}
