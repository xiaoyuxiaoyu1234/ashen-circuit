// game.js — 主控：场景 / 竞技场 / 战斗结算 / 流程
import * as THREE from 'three';
import { clamp, rand, damp, angleDelta } from './engine.js';
import { Input, CameraRig, Feel } from './engine.js';
import { audio } from './audio.js';
import { FX } from './fx.js';
import { Player, Enemy, Boss, Projectile } from './entities.js';
import { Director, TOTAL_ROOMS } from './director.js';
import { UI, RARITY_MAP } from './ui.js';

const ARENA_R = 17;
const ACCENTS = [0x4fe3d0, 0x4fe3d0, 0x6ad0ff, 0x8f9cff, 0xc07bff, 0xff8a3d, 0xff6b3d, 0xff4d2e];

/** 程序化环境贴图：没有它，金属度材质会因为没有可反射的东西而全黑 */
function makeEnvTexture(renderer) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, '#3e5c78');
  grad.addColorStop(0.42, '#22303f');
  grad.addColorStop(0.56, '#151d27');
  grad.addColorStop(1, '#070a0e');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 128);

  const spot = (x, y, r, color) => {
    const rg = g.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, color);
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = rg;
    g.fillRect(0, 0, 256, 128);
  };
  spot(64, 38, 48, 'rgba(150,220,235,0.85)');
  spot(196, 50, 42, 'rgba(255,170,110,0.8)');
  spot(126, 20, 60, 'rgba(120,160,190,0.35)');

  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromEquirectangular(tex);
  pmrem.dispose();
  tex.dispose();
  return rt.texture;
}

/* ---------------- 场景 ---------------- */
class World {
  constructor(scene, renderer) {
    this.scene = scene;
    this.arenaRadius = ARENA_R;
    this.obstacles = [];
    this.group = new THREE.Group();
    scene.add(this.group);
    this.maxAniso = renderer.capabilities.getMaxAnisotropy();
    this.accent = ACCENTS[0];
    this.buildStatic();
  }

  buildStatic() {
    // 地面
    const tex = this.makeGroundTex();
    const floorGeo = new THREE.CircleGeometry(ARENA_R + 1.5, 72);
    floorGeo.rotateX(-Math.PI / 2);
    const floorMat = new THREE.MeshStandardMaterial({
      map: tex,
      color: 0xffffff,
      roughness: 0.9,
      metalness: 0.12,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.receiveShadow = true;
    this.group.add(floor);
    this.floor = floor;

    // 外墙
    const wallGeo = new THREE.CylinderGeometry(ARENA_R + 1.2, ARENA_R + 1.2, 6, 72, 1, true);
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x1c2634,
      roughness: 0.95,
      metalness: 0.1,
      side: THREE.BackSide,
    });
    const wall = new THREE.Mesh(wallGeo, wallMat);
    wall.position.y = 3;
    wall.receiveShadow = true;
    this.group.add(wall);

    // 边界光环
    this.rimMat = new THREE.MeshBasicMaterial({
      color: this.accent,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const rimGeo = new THREE.TorusGeometry(ARENA_R + 0.4, 0.05, 6, 120);
    rimGeo.rotateX(Math.PI / 2);
    this.rim = new THREE.Mesh(rimGeo, this.rimMat);
    this.rim.position.y = 0.06;
    this.group.add(this.rim);

    const rimGeo2 = new THREE.TorusGeometry(ARENA_R + 1.15, 0.07, 6, 120);
    rimGeo2.rotateX(Math.PI / 2);
    this.rim2 = new THREE.Mesh(rimGeo2, this.rimMat);
    this.rim2.position.y = 5.9;
    this.group.add(this.rim2);

    // 墙面竖向棱光（一次 InstancedMesh）
    const RIB = 48;
    const ribGeo = new THREE.BoxGeometry(0.07, 5.4, 0.14);
    this.ribMat = new THREE.MeshBasicMaterial({
      color: this.accent,
      transparent: true,
      opacity: 0.22,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const ribs = new THREE.InstancedMesh(ribGeo, this.ribMat, RIB);
    const mtx = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const sc3 = new THREE.Vector3(1, 1, 1);
    const pos3 = new THREE.Vector3();
    for (let i = 0; i < RIB; i++) {
      const a = (i / RIB) * Math.PI * 2;
      pos3.set(Math.cos(a) * (ARENA_R + 1.05), 2.7, Math.sin(a) * (ARENA_R + 1.05));
      quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a);
      mtx.compose(pos3, quat, sc3);
      ribs.setMatrixAt(i, mtx);
    }
    ribs.instanceMatrix.needsUpdate = true;
    this.ribs = ribs;
    this.group.add(ribs);

    // 浮尘
    const n = 260;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * (ARENA_R - 1);
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = Math.random() * 6;
      pos[i * 3 + 2] = Math.sin(a) * r;
    }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.dustMat = new THREE.PointsMaterial({
      size: 0.055,
      color: 0x86b6c8,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.dust = new THREE.Points(dg, this.dustMat);
    this.group.add(this.dust);

    this.obstacleGroup = new THREE.Group();
    this.group.add(this.obstacleGroup);
  }

  makeGroundTex() {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 512;
    const g = c.getContext('2d');
    g.fillStyle = '#151d28';
    g.fillRect(0, 0, 512, 512);
    g.strokeStyle = 'rgba(150,195,220,0.16)';
    g.lineWidth = 2;
    for (let i = 0; i <= 4; i++) {
      const p = i * 128;
      g.beginPath();
      g.moveTo(p + 0.5, 0);
      g.lineTo(p + 0.5, 512);
      g.moveTo(0, p + 0.5);
      g.lineTo(512, p + 0.5);
      g.stroke();
    }
    g.strokeStyle = 'rgba(150,195,220,0.07)';
    g.lineWidth = 1;
    for (let i = 0; i <= 16; i++) {
      const p = i * 32;
      g.beginPath();
      g.moveTo(p + 0.5, 0);
      g.lineTo(p + 0.5, 512);
      g.moveTo(0, p + 0.5);
      g.lineTo(512, p + 0.5);
      g.stroke();
    }
    for (let i = 0; i < 2400; i++) {
      g.fillStyle = `rgba(150,185,205,${Math.random() * 0.045})`;
      g.fillRect(Math.random() * 512, Math.random() * 512, 2, 2);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(5, 5);
    tex.anisotropy = Math.min(8, this.maxAniso);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  build(room) {
    // 清空旧障碍
    for (const m of [...this.obstacleGroup.children]) {
      this.obstacleGroup.remove(m);
      if (m.geometry) m.geometry.dispose();
    }
    this.obstacles.length = 0;

    this.accent = ACCENTS[Math.min(room - 1, ACCENTS.length - 1)];
    this.rimMat.color.setHex(this.accent);
    if (this.ribMat) this.ribMat.color.setHex(this.accent);
    if (this.dustMat) this.dustMat.color.setHex(this.accent);

    const count = clamp(4 + Math.floor(room * 0.5), 4, 9);
    const placed = [];
    let guard = 0;
    while (placed.length < count && guard++ < 200) {
      const a = rand(0, Math.PI * 2);
      const r = rand(4.2, ARENA_R - 5);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const hx = rand(0.75, 1.4);
      const hz = rand(0.75, 1.4);
      // 别糊在玩家出生点上
      if (Math.hypot(x, z - 6) < 5.5) continue;
      let ok = true;
      for (const p of placed) {
        if (Math.hypot(p.x - x, p.z - z) < 4.6) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      placed.push({ x, z, hx, hz });
    }

    if (!this.pillarMat) {
      this.pillarMat = new THREE.MeshStandardMaterial({ color: 0x2b3644, roughness: 0.78, metalness: 0.4 });
      this.glowMat = new THREE.MeshBasicMaterial({
        color: this.accent,
        transparent: true,
        opacity: 0.5,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
    }
    this.glowMat.color.setHex(this.accent);
    const mat = this.pillarMat;
    const glowMat = this.glowMat;

    for (const p of placed) {
      const h = rand(2.0, 3.8);
      const geo = new THREE.BoxGeometry(p.hx * 2, h, p.hz * 2);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(p.x, h / 2, p.z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.obstacleGroup.add(mesh);

      const capGeo = new THREE.BoxGeometry(p.hx * 2 + 0.12, 0.06, p.hz * 2 + 0.12);
      const cap = new THREE.Mesh(capGeo, glowMat);
      cap.position.set(p.x, h, p.z);
      this.obstacleGroup.add(cap);

      const stripGeo = new THREE.BoxGeometry(0.05, h * 0.7, 0.05);
      for (const s of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const strip = new THREE.Mesh(stripGeo, glowMat);
        strip.position.set(p.x + s[0] * p.hx, h * 0.42, p.z + s[1] * p.hz);
        this.obstacleGroup.add(strip);
      }

      this.obstacles.push({ x: p.x, z: p.z, hx: p.hx, hz: p.hz });
    }
  }

  collide(pos, radius) {
    for (const o of this.obstacles) {
      const dx = pos.x - o.x;
      const dz = pos.z - o.z;
      const cx = clamp(dx, -o.hx, o.hx);
      const cz = clamp(dz, -o.hz, o.hz);
      const ox = dx - cx;
      const oz = dz - cz;
      const d2 = ox * ox + oz * oz;
      if (d2 > radius * radius) continue;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        const push = radius - d;
        pos.x += (ox / d) * push;
        pos.z += (oz / d) * push;
      } else {
        const px = o.hx - Math.abs(dx);
        const pz = o.hz - Math.abs(dz);
        if (px < pz) pos.x = o.x + Math.sign(dx || 1) * (o.hx + radius);
        else pos.z = o.z + Math.sign(dz || 1) * (o.hz + radius);
      }
    }
    const d = Math.hypot(pos.x, pos.z);
    const max = this.arenaRadius - 0.35 - radius;
    if (d > max && d > 0.0001) {
      pos.x = (pos.x / d) * max;
      pos.z = (pos.z / d) * max;
    }
  }

  blocked(x, z, pad = 0) {
    if (Math.hypot(x, z) > this.arenaRadius - pad) return true;
    for (const o of this.obstacles) {
      if (Math.abs(x - o.x) < o.hx + pad && Math.abs(z - o.z) < o.hz + pad) return true;
    }
    return false;
  }

  update(dt) {
    if (this.dust) {
      this.dust.rotation.y += dt * 0.02;
      this.dust.position.y = Math.sin(performance.now() * 0.0002) * 0.3;
    }
    this.rimMat.opacity = 0.38 + Math.sin(performance.now() * 0.0012) * 0.12;
  }
}

/* ---------------- 主游戏 ---------------- */
export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      alpha: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.24;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x080c12);
    this.scene.fog = new THREE.FogExp2(0x080c12, 0.0135);
    this.scene.environment = makeEnvTexture(this.renderer);
    this.scene.environmentIntensity = 0.85;

    this.camera = new THREE.PerspectiveCamera(58, 1, 0.1, 220);
    this.camera.position.set(0, 8, 12);

    this.clock = new THREE.Clock();
    this.rig = new CameraRig(this.camera);
    this.feel = new Feel();
    this.input = new Input(canvas);
    this.ui = new UI();
    this.audio = audio;
    this.world = new World(this.scene, this.renderer);
    this.fx = new FX(this.scene);

    this.setupLights();

    this.player = null;
    this.enemies = [];
    this.projectiles = [];
    this.director = new Director(this);

    this.state = 'title';
    this.runTime = 0;
    this.kills = 0;
    this.deadTimer = 0;
    this.totalT = 0;
    this.titleFocus = new THREE.Vector3(0, 0.9, 0);
    this.best = this.loadBest();

    this.ctx = {
      input: this.input,
      world: this.world,
      fx: this.fx,
      ui: this.ui,
      audio: this.audio,
      feel: this.feel,
      rig: this.rig,
      basis: this.rig.basis(),
      player: null,
      enemies: this.enemies,
      hurtPlayer: (d, from) => this.hurtPlayer(d, from),
      hitSector: (p, o, f, r, a, dmg, o2) => this.hitSector(p, o, f, r, a, dmg, o2),
      hitEnemy: (e, dmg, o) => this.hitEnemy(e, dmg, o),
      spawnProjectile: (pos, dir, opts) => this.spawnProjectile(pos, dir, opts),
      spawnEnemy: (type, pos) => this.spawnEnemy(type, pos, this.director.room),
    };

    this.bindUI();
    this.bindEvents();
    this.resize();

    this.world.build(1);
    this.spawnPlayer();
    this.ui.showTitle(this.best);

    this.last = performance.now();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  setupLights() {
    this.hemi = new THREE.HemisphereLight(0x6f92b5, 0x1a222d, 1.05);
    this.scene.add(this.hemi);

    this.ambient = new THREE.AmbientLight(0x35506a, 0.5);
    this.scene.add(this.ambient);

    const dir = new THREE.DirectionalLight(0xe6f1ff, 2.35);
    dir.position.set(10, 20, 8);
    dir.castShadow = true;
    dir.shadow.mapSize.set(1024, 1024);
    const sc = dir.shadow.camera;
    sc.left = -18;
    sc.right = 18;
    sc.top = 18;
    sc.bottom = -18;
    sc.near = 1;
    sc.far = 70;
    dir.shadow.bias = -0.0008;
    dir.shadow.normalBias = 0.03;
    this.scene.add(dir);
    this.dirLight = dir;
    this.scene.add(dir.target);

    // 反向轮廓光：给角色留一道边缘，避免和背景糊在一起
    const rim = new THREE.DirectionalLight(0x8fc8ff, 0.55);
    rim.position.set(-12, 9, -12);
    this.scene.add(rim);
    this.scene.add(rim.target);
    this.rimLight = rim;

    const p1 = new THREE.PointLight(0x4fe3d0, 9, 22, 2);
    p1.position.set(-15, 5.5, -13);
    this.scene.add(p1);
    this.p1 = p1;

    const p2 = new THREE.PointLight(0xff8a3d, 8, 22, 2);
    p2.position.set(15, 5, 12);
    this.scene.add(p2);
    this.p2 = p2;

    // 相机补光：压暗部，避免角色正面死黑
    this.fill = new THREE.PointLight(0xa8cce0, 6, 12, 2);
    this.fill.position.set(0, 1.4, 1.6);
    this.camera.add(this.fill);
    this.scene.add(this.camera);
  }

  /* ---------------- 生命周期 ---------------- */
  spawnPlayer() {
    this.player = new Player(this.scene);
    this.player.taken = new Set();
    this.player.pos.set(0, 0, 6);
    this.player.facing = 0;
    this.ctx.player = this.player;
  }

  resetRun() {
    for (const e of this.enemies) {
      this.scene.remove(e.rig.root);
      e.rig.dispose();
      e.tel && e.tel.hide();
    }
    this.enemies.length = 0;
    for (const p of this.projectiles) p.dispose(this.scene);
    this.projectiles.length = 0;
    this.ui.clearNumbers();
    this.ui.showBoss(null);

    if (this.player) {
      this.scene.remove(this.player.rig.root);
      this.player.rig.dispose();
    }
    this.spawnPlayer();
    this.ctx.enemies = this.enemies;

    this.kills = 0;
    this.runTime = 0;
    this.deadTimer = 0;
    this.deathShown = false;
    this.relics = [];
    this.boss = null;
    this.ui.setKills(0);
    this.ui.setRelics([]);
    this.feel.freeze = 0;
    this.feel.slowmo = 0;
    this.rig.yaw = Math.PI;
    this.rig.pitch = 0.36;
    this.rig.trauma = 0;
    this.rig.pivot.set(0, 1.5, 6);
    this.director = new Director(this);
  }

  startRun() {
    this.resetRun();
    this.state = 'play';
    this.ui.hideAll();
    this.ui.hideDeath();
    this.audio.unlock().then(() => {
      this.audio.startMusic();
      this.audio.setIntensity(0.2);
    });
    this.director.start();
    this.input.requestLock();
    this.ui.toast('鼠标转动视角 · 左键连击 · 右键重击 · 空格翻滚', 3.4);
  }

  /* ---------------- 生成 ---------------- */
  buildArena(room) {
    this.world.build(room);
  }

  spawnEnemy(type, pos, level) {
    const e = new Enemy(this.scene, type, pos, level);
    this.enemies.push(e);
    this.fx.pillar(pos, 0xff8a3d);
    this.audio.play('spawn', { vol: 0.7 });
    return e;
  }

  spawnBoss(pos, level) {
    for (const e of this.enemies) {
      if (e.alive && e !== this.boss) e.takeDamage(9999, {});
    }
    const b = new Boss(this.scene, pos, level);
    this.enemies.push(b);
    this.boss = b;
    this.fx.pillar(pos, 0xff4d2e);
    this.audio.play('spawn');
    this.ui.showBoss(1, '灰烬之主');
    this.ui.toast('第 8 层 · 灰烬之主', 2.4);
    this.rig.addTrauma(0.5);
    return b;
  }

  spawnProjectile(pos, dir, opts) {
    const p = new Projectile(this.scene, pos, dir, opts);
    this.projectiles.push(p);
    return p;
  }

  /* ---------------- 战斗结算 ---------------- */
  hitSector(player, origin, facing, range, arc, dmg, opts) {
    const hitSet = opts.hitSet || new Set();
    for (const e of this.enemies) {
      if (!e.alive || hitSet.has(e)) continue;
      const dx = e.pos.x - origin.x;
      const dz = e.pos.z - origin.z;
      const d = Math.hypot(dx, dz);
      if (d > range + e.radius) continue;
      const ang = Math.abs(angleDelta(facing, Math.atan2(dx, dz)));
      if (ang > arc * 0.5) continue;
      hitSet.add(e);
      this.hitEnemy(e, dmg, {
        crit: opts.crit,
        knock: opts.knock,
        kind: opts.kind,
        dir: { x: dx / (d || 1), z: dz / (d || 1) },
      });
    }
  }

  hitEnemy(e, baseDmg, opts = {}) {
    if (!e.alive) return 0;
    let dmg = baseDmg;
    const p = this.player;
    if (p.mods.execute > 0 && e.hpRatio < 0.35) dmg *= 1 + p.mods.execute;
    if (p.mods.fury) dmg *= 1 + p.fury * 0.06;

    const applied = e.takeDamage(dmg, opts);
    const hp = { x: e.pos.x, y: 1.25 + e.radius * 0.3, z: e.pos.z };

    this.fx.impact(hp, opts.crit ? 0xffe08a : 0xbfefff, opts.crit ? 1.0 : 0.72);
    this.fx.spark(hp, opts.crit ? 0xffd166 : 0x9ef7ff, opts.crit ? 18 : 9, {
      speed: opts.crit ? 6.5 : 4.4,
      dir: opts.dir ? { x: opts.dir.x, y: 0.5, z: opts.dir.z } : null,
      life: 0.42,
    });
    this.ui.damageNumber(hp, String(applied), opts.crit ? 'crit' : 'enemy');
    this.audio.play(opts.crit ? 'crit' : 'hit', { vol: opts.kind === 'heavy' ? 1 : 0.75 });
    this.feel.hitstop(opts.crit ? 0.085 : opts.kind === 'heavy' ? 0.075 : 0.05);
    this.rig.addTrauma(opts.crit ? 0.34 : opts.kind === 'heavy' ? 0.28 : 0.16);
    this.ui.setFlash(this.feel.flash + (opts.crit ? 0.18 : 0.06));

    if (!e.alive) this.onEnemyDeath(e);
    return applied;
  }

  onEnemyDeath(e) {
    this.kills++;
    this.player.kills = this.kills;
    this.ui.setKills(this.kills);
    this.audio.play('die', { vol: e.type === 'boss' ? 1 : 0.7 });
    this.fx.spark({ x: e.pos.x, y: 1, z: e.pos.z }, 0xffb347, e.type === 'boss' ? 60 : 20, { speed: 6, life: 0.8 });
    this.fx.shockwave(e.pos, e.type === 'boss' ? 8 : 2.2, 0xff8a3d, 0.5);
    this.rig.addTrauma(e.type === 'boss' ? 0.9 : 0.14);

    if (this.player.mods.lifeOnKill > 0) {
      this.player.heal(this.player.mods.lifeOnKill);
      this.ui.setHp(this.player.hp, this.player.maxHp);
    }
    if (this.player.mods.fury) {
      this.player.fury = Math.min(10, this.player.fury + 1);
    }
    if (e.type === 'boss') {
      this.ui.showBoss(null);
      this.victory();
    }
  }

  hurtPlayer(dmg, fromPos) {
    if (this.state !== 'play') return;
    const applied = this.player.takeDamage(dmg, fromPos);
    if (!applied) return;
    if (this.player.mods.thorns > 0) {
      for (const e of this.enemies) {
        if (!e.alive) continue;
        if (Math.hypot(e.pos.x - this.player.pos.x, e.pos.z - this.player.pos.z) < 4.2) {
          this.hitEnemy(e, this.player.mods.thorns, { kind: 'thorns', knock: 2 });
        }
      }
    }
    if (this.player.dead) this.onPlayerDeath();
  }

  onPlayerDeath() {
    this.state = 'dead';
    this.deadTimer = 1.4;
    this.ui.showBoss(null);
    this.audio.setIntensity(0);
    this.audio.stopMusic(2);
    this.feel.slowmo = 0.9;
    this.rig.addTrauma(1);
  }

  onRoomClear() {
    if (this.director.isBossRoom) return;
    this.player.heal(12);
    this.audio.play('clear');
    this.audio.play('levelup');
    this.ui.setHp(this.player.hp, this.player.maxHp);
    this.state = 'upgrade';
    const player = this.player;
    const list = this.director.rollUpgrades(player, 3);
    this.pendingUpgrades = list;
    document.exitPointerLock && document.exitPointerLock();
    this.ui.showUpgrades(list, (u) => this.pickUpgrade(u));
    this.audio.setIntensity(0.15);
  }

  pickUpgrade(u) {
    if (this.state !== 'upgrade') return;
    this.audio.play('ui');
    this.player.addMods([u]);
    this.player.taken.add(u.id);
    this.relics = this.relics || [];
    this.relics.push(u);
    this.ui.setRelics(this.relics);
    this.ui.setHp(this.player.hp, this.player.maxHp);
    this.ui.setStamina(this.player.stamina, this.player.maxStamina);
    this.ui.hideUpgrades();
    this.state = 'play';
    this.director.nextRoom();
    this.input.requestLock();
  }

  victory() {
    this.state = 'victory';
    this.audio.setIntensity(0);
    this.audio.play('levelup');
    this.saveBest(TOTAL_ROOMS, true);
    this.audio.stopMusic(3);
    document.exitPointerLock && document.exitPointerLock();
    const stats = {
      room: TOTAL_ROOMS,
      kills: this.kills,
      time: this.fmt(this.runTime),
      best: Math.max(this.best?.room || 0, TOTAL_ROOMS),
      win: true,
    };
    this.ui.showDeath(stats, () => this.startRun());
    this.ui.setDeathTitle('回廊已破');
  }

  /* ---------------- 存档 ---------------- */
  loadBest() {
    try {
      const raw = localStorage.getItem('ashen.best');
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  saveBest(room, win = false) {
    try {
      const prev = this.best || { room: 0, kills: 0, time: '0:00' };
      if (room > (prev.room || 0) || win) {
        this.best = {
          room: Math.max(room, prev.room || 0),
          kills: Math.max(this.kills, prev.kills || 0),
          time: this.fmt(this.runTime),
          win: win || !!prev.win,
        };
        localStorage.setItem('ashen.best', JSON.stringify(this.best));
      }
    } catch (e) {
      /* localStorage 不可用时静默 */
    }
  }

  fmt(sec) {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  /* ---------------- 输入 / 事件 ---------------- */
  bindUI() {
    const start = document.getElementById('btn-start');
    if (start) start.addEventListener('click', () => this.startRun());
    const again = document.getElementById('btn-again');
    if (again) again.addEventListener('click', () => this.startRun());
    const resume = document.getElementById('btn-resume');
    if (resume) resume.addEventListener('click', () => this.togglePause(false));

    window.addEventListener('keydown', (e) => {
      if (this.state === 'upgrade' && ['Digit1', 'Digit2', 'Digit3'].includes(e.code)) {
        const i = Number(e.code.slice(-1)) - 1;
        const u = this.pendingUpgrades && this.pendingUpgrades[i];
        if (u) this.pickUpgrade(u);
      }
      if (e.code === 'Escape' || e.code === 'KeyP') {
        if (this.state === 'play') this.togglePause(true);
        else if (this.state === 'pause') this.togglePause(false);
      }
      if (e.code === 'KeyM') {
        this.audio.setMuted(!this.audio.muted);
        this.ui.toast(this.audio.muted ? '已静音' : '声音已开启', 1.2);
      }
      if (this.state === 'title' && (e.code === 'Space' || e.code === 'Enter')) this.startRun();
      if (this.state === 'dead' && e.code === 'Space') {
        if (this.deadTimer <= 0) this.startRun();
      }
    });

    this.input.onUnlock = () => {
      if (this.state !== 'play') return;
      // 恢复后的短暂窗口内忽略解锁事件，避免「继续」被立刻打断
      if (performance.now() < (this.resumeGraceUntil || 0)) return;
      this.togglePause(true);
    };

    this.input.onLockFail = () => {
      this.ui.toast('鼠标锁定不可用：按住左键拖动转视角，或按 Q / E', 3.6);
    };
  }

  togglePause(on) {
    if (on && this.state === 'play') {
      // 先切状态再解锁，避免解锁事件把这里再触发一次
      this.state = 'pause';
      if (document.pointerLockElement) document.exitPointerLock();
      this.ui.showPause(() => this.togglePause(false));
      this.audio.setIntensity(0);
    } else if (!on && this.state === 'pause') {
      this.state = 'play';
      this.resumeGraceUntil = performance.now() + 600;
      this.ui.hidePause();
      this.input.requestLock();
      this.audio.setIntensity(clamp(0.15 + this.director.room * 0.1, 0, 1));
    }
  }

  bindEvents() {
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'play') this.togglePause(true);
    });
    // 触屏按钮
    for (const [id, action] of [['btn-atk', 'light'], ['btn-heavy', 'heavy'], ['btn-dodge', 'dodge']]) {
      const el = document.getElementById(id);
      if (!el) continue;
      el.addEventListener('pointerdown', (ev) => {
        ev.preventDefault();
        this.input.press(action);
      });
    }
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.vw = w;
    this.vh = h;
  }

  /* ---------------- 主循环 ---------------- */
  loop(now) {
    requestAnimationFrame(this.loop);
    const real = clamp((now - this.last) / 1000, 0, 1 / 22);
    this.last = now;
    this.totalT += real;

    const dt = this.feel.tick(real);
    const playing = this.state === 'play';

    if (playing) {
      this.runTime += real;
      this.ctx.basis = this.rig.basis();
      this.ctx.enemies = this.enemies;

      // 玩家（攻击判定在内部触发）
      this.player.update(dt, this.ctx);

      // 敌人
      for (let i = this.enemies.length - 1; i >= 0; i--) {
        const e = this.enemies[i];
        const removable = e.update(dt, this.ctx);
        if (removable) {
          this.scene.remove(e.rig.root);
          e.rig.dispose();
          e.tel.hide();
          this.enemies.splice(i, 1);
        }
      }

      // 投射物
      for (let i = this.projectiles.length - 1; i >= 0; i--) {
        const pr = this.projectiles[i];
        if (pr.update(dt, this.ctx)) {
          pr.dispose(this.scene);
          this.projectiles.splice(i, 1);
        }
      }

      this.director.update(dt);

      // 相机
      this.rig.update(real, this.player.pos, this.input, this.world);

      // 光照跟随：主光挂在镜头右后方，保证玩家看到的永远是受光面
      const pl = this.player.pos;
      const bas = this.rig.basis();
      this.dirLight.position.set(pl.x - bas.fx * 9 + bas.rx * 7, 20, pl.z - bas.fz * 9 + bas.rz * 7);
      this.dirLight.target.position.set(pl.x, 0, pl.z);
      this.dirLight.target.updateMatrixWorld();
      this.rimLight.position.set(pl.x + bas.fx * 10, 8, pl.z + bas.fz * 10);
      this.rimLight.target.position.set(pl.x, 0.8, pl.z);
      this.rimLight.target.updateMatrixWorld();

      // HUD
      this.ui.setHp(this.player.hp, this.player.maxHp);
      this.ui.setStamina(this.player.stamina, this.player.maxStamina);
      this.ui.setTime(this.runTime);
      if (this.boss && this.boss.alive) this.ui.showBoss(this.boss.hpRatio, null);
    } else if (this.state === 'title') {
      this.rig.yaw += real * 0.06;
      this.rig.pitch = 0.3;
      // 把角色推到画面右侧，给标题文字让位
      const b = this.rig.basis();
      this.titleFocus.set(
        this.player.pos.x - b.rx * 4.3,
        2.2,
        this.player.pos.z - b.rz * 4.3
      );
      this.rig.update(real, this.titleFocus, this.input, this.world);
      if (this.player) {
        this.player.rig.animate(real, { speed: 0, attack: null, dodgeT: 0, hurtT: 0 });
        this.player.rig.tick(real);
        this.player.rig.root.position.copy(this.player.pos);
        this.player.rig.root.rotation.y = this.player.facing;
      }
    } else if (this.state === 'dead') {
      this.rig.update(real, this.player.pos, this.input, this.world);
      if (this.player) {
        this.player.update(real, this.ctx);
      }
      this.deadTimer -= real;
      if (this.deadTimer <= 0 && !this.deathShown) this.showDeath();
    } else {
      // pause / upgrade / victory：保持画面但不推进
      this.rig.update(real * 0.15, this.player.pos, this.input, this.world);
      if (this.player) this.player.rig.tick(real);
    }

    this.fx.update(dt);
    this.world.update(real);
    this.audio.update(real);
    this.ui.setFlash(this.feel.flash);
    this.ui.updateNumbers(real, this.camera, this.vw, this.vh);
    this.ui.tick(real);
    this.input.endFrame(real);

    this.renderer.render(this.scene, this.camera);
  }

  showDeath() {
    this.deathShown = true;
    this.saveBest(this.director.room);
    const stats = {
      room: this.director.room,
      kills: this.kills,
      time: this.fmt(this.runTime),
      best: Math.max(this.best?.room || 0, this.director.room),
      win: false,
    };
    this.ui.showDeath(stats, () => this.startRun());
    this.ui.setDeathTitle('你化为灰烬');
  }
}

/* ---------------- 启动 ---------------- */
const canvas = document.getElementById('stage');
if (canvas) {
  let game;
  try {
    game = new Game(canvas);
    window.__ashen = game;
    const loading = document.getElementById('loading');
    if (loading) setTimeout(() => loading.classList.add('off'), 240);
  } catch (err) {
    const loading = document.getElementById('loading');
    if (loading) {
      loading.innerHTML = `<div class="err">初始化失败<br><small>${String(err && err.message ? err.message : err)}</small><br><small>请使用支持 WebGL 的现代浏览器</small></div>`;
    }
    console.error(err);
  }
}
