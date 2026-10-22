// director.js — 房间 / 波次 / 遗物
import { rand, pick, shuffle, clamp } from './engine.js';

export const UPGRADES = [
  { id: 'blade', name: '锋刃', desc: '攻击伤害 +20%', rarity: 'common', icon: '刃' },
  { id: 'swift', name: '疾风', desc: '攻击速度 +15%', rarity: 'common', icon: '疾' },
  { id: 'stride', name: '轻足', desc: '移动速度 +12%', rarity: 'common', icon: '足' },
  { id: 'tough', name: '坚韧', desc: '受到的伤害 -16%', rarity: 'common', icon: '韧' },
  { id: 'bone', name: '韧骨', desc: '生命上限 +30，并回复 30', rarity: 'rare', icon: '骨', unique: true },
  { id: 'spring', name: '涌泉', desc: '体力上限 +30，恢复速度 +35%', rarity: 'rare', icon: '泉', unique: true },
  { id: 'leech', name: '嗜血', desc: '每次击杀回复 7 点生命', rarity: 'rare', icon: '血' },
  { id: 'thorns', name: '荆棘', desc: '受伤时对 4 米内敌人造成 18 伤害', rarity: 'rare', icon: '刺' },
  { id: 'phase', name: '幻步', desc: '翻滚无敌 +0.09 秒，翻滚穿过敌人造成 22 伤害', rarity: 'epic', icon: '幻', unique: true },
  { id: 'wave', name: '裂空', desc: '三段连击的最后一击释放剑气', rarity: 'epic', icon: '空', unique: true },
  { id: 'execute', name: '处决', desc: '对生命低于 35% 的敌人伤害 +60%', rarity: 'epic', icon: '决' },
  { id: 'crit', name: '锐眼', desc: '暴击率 +20%（暴击造成双倍伤害）', rarity: 'epic', icon: '锐' },
  { id: 'fury', name: '战意', desc: '每击杀 +6% 伤害，最多 +60%，受伤清零', rarity: 'epic', icon: '战', unique: true },
];

export const RARITY = {
  common: { label: '普通', color: '#8fa3bd' },
  rare: { label: '稀有', color: '#4fe3d0' },
  epic: { label: '史诗', color: '#ffb347' },
};

/** 8 层房间的波次表：每层若干波，每波是敌人类型数组 */
const ROOM_PLAN = [
  [['grunt', 'grunt', 'grunt'], ['grunt', 'grunt', 'grunt', 'grunt']],
  [['grunt', 'grunt', 'grunt', 'grunt'], ['grunt', 'grunt', 'grunt', 'spitter']],
  [['grunt', 'grunt', 'spitter', 'spitter'], ['grunt', 'grunt', 'grunt', 'spitter', 'spitter']],
  [['brute', 'grunt', 'grunt'], ['brute', 'grunt', 'grunt', 'spitter', 'spitter']],
  [['brute', 'brute', 'grunt', 'grunt'], ['grunt', 'grunt', 'grunt', 'spitter', 'spitter']],
  [['brute', 'brute', 'grunt', 'grunt', 'spitter'], ['brute', 'grunt', 'grunt', 'grunt', 'spitter', 'spitter']],
  [['brute', 'brute', 'grunt', 'grunt', 'spitter', 'spitter'], ['brute', 'brute', 'brute', 'grunt', 'grunt', 'spitter']],
  [['boss']],
];

export const TOTAL_ROOMS = ROOM_PLAN.length;

export class Director {
  constructor(game) {
    this.game = game;
    this.room = 0;
    this.waveIndex = 0;
    this.waves = [];
    this.queue = [];
    this.spawnTimer = 0;
    this.state = 'idle';
    this.transition = 0;
    this.waveBanner = 0;
  }

  start() {
    this.room = 0;
    this.nextRoom();
  }

  nextRoom() {
    this.room++;
    this.waveIndex = 0;
    const plan = ROOM_PLAN[Math.min(this.room - 1, ROOM_PLAN.length - 1)];
    this.waves = plan;
    this.game.buildArena(this.room);
    this.game.ui.setRoom(this.room, TOTAL_ROOMS);
    this.state = 'wave';
    this.transition = 0.9;
    this.startWave();
    this.game.audio.setIntensity(clamp(0.15 + this.room * 0.1, 0, 1));
  }

  get isBossRoom() {
    return this.room === TOTAL_ROOMS;
  }

  startWave() {
    const list = this.waves[this.waveIndex];
    const level = Math.max(1, this.room);
    this.queue = list.map((type, i) => ({ type, delay: i * 0.32, level }));
    this.spawnTimer = 0;
    this.game.ui.setWave(this.waveIndex + 1, this.waves.length);
    if (!(this.waves.length === 1 && list.length === 1 && list[0] === 'boss')) {
      this.game.ui.toast(`第 ${this.room} 层 · 第 ${this.waveIndex + 1} / ${this.waves.length} 波`);
      this.waveBanner = 1.8;
    }
  }

  spawnPos(existing) {
    const g = this.game;
    for (let i = 0; i < 24; i++) {
      const a = rand(0, Math.PI * 2);
      const r = rand(7, Math.max(8, g.world.arenaRadius - 4));
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (g.world.blocked(x, z, 1.2)) continue;
      const dp = Math.hypot(x - g.player.pos.x, z - g.player.pos.z);
      if (dp < 7) continue;
      let ok = true;
      for (const e of existing) {
        if (Math.hypot(e.pos.x - x, e.pos.z - z) < 1.8) {
          ok = false;
          break;
        }
      }
      if (ok) return { x, z };
    }
    const a = rand(0, Math.PI * 2);
    return { x: Math.cos(a) * (g.world.arenaRadius - 6), z: Math.sin(a) * (g.world.arenaRadius - 6) };
  }

  update(dt) {
    this.waveBanner = Math.max(0, this.waveBanner - dt);

    if (this.transition > 0) {
      this.transition = Math.max(0, this.transition - dt);
    }

    if (this.state === 'wave') {
      if (this.queue.length) {
        this.spawnTimer -= dt;
        if (this.spawnTimer <= 0) {
          const item = this.queue[0];
          if (item.delay > 0) {
            item.delay -= dt;
          } else {
            this.queue.shift();
            const p = this.spawnPos(this.game.enemies);
            this.spawnTimer = 0.06;
            if (item.type === 'boss') this.game.spawnBoss(p, item.level);
            else this.game.spawnEnemy(item.type, p, item.level);
          }
        }
      } else if (this.game.enemies.filter((e) => e.alive).length === 0) {
        // 本波清空
        this.waveIndex++;
        if (this.waveIndex < this.waves.length) {
          this.state = 'gap';
          this.transition = 1.1;
        } else {
          this.state = 'clear';
          this.transition = 1.3;
          this.game.onRoomClear();
        }
      }
    } else if (this.state === 'gap') {
      this.transition -= dt;
      if (this.transition <= 0) {
        this.state = 'wave';
        this.startWave();
      }
    }
  }

  rollUpgrades(player, n = 3) {
    const pool = UPGRADES.filter((u) => !(u.unique && player.taken.has(u.id)));
    const weight = { common: 5, rare: 3, epic: 2 };
    const bag = [];
    for (const u of pool) {
      const w = weight[u.rarity] || 3;
      for (let i = 0; i < w; i++) bag.push(u);
    }
    const out = [];
    const used = new Set();
    let guard = 0;
    while (out.length < n && guard++ < 200) {
      const u = pick(bag);
      if (!u || used.has(u.id)) continue;
      used.add(u.id);
      out.push(u);
    }
    return out.length ? out : shuffle(UPGRADES).slice(0, n);
  }
}
