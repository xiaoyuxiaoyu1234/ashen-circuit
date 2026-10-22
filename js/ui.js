// ui.js — DOM 界面：HUD / 飘字 / 卡牌 / 结算
import * as THREE from 'three';
import { clamp } from './engine.js';

const $ = (id) => document.getElementById(id);

export class UI {
  constructor() {
    this.hud = $('hud');
    this.hpFill = $('hp-fill');
    this.hpText = $('hp-text');
    this.spFill = $('sp-fill');
    this.roomText = $('room-text');
    this.waveText = $('wave-text');
    this.killText = $('kill-text');
    this.timeText = $('time-text');
    this.relicList = $('relic-list');
    this.bossWrap = $('bossbar');
    this.bossFill = $('boss-fill');
    this.bossName = $('boss-name');
    this.dmgLayer = $('dmg-layer');
    this.flashEl = $('flash');
    this.hurtEl = $('hurt');
    this.toastEl = $('toast');
    this.titlePanel = $('panel-title');
    this.upgradePanel = $('panel-upgrade');
    this.deathPanel = $('panel-death');
    this.pausePanel = $('panel-pause');
    this.cardsEl = $('cards');
    this.deathStats = $('death-stats');
    this.bestText = $('best-line');
    this.numbers = [];
    this.toastT = 0;
    this._tmp = new THREE.Vector3();
    this.lastHp = -1;
    this.lastSp = -1;
  }

  /* ---------- HUD ---------- */
  setHp(cur, max) {
    const v = clamp(cur / max, 0, 1);
    this.hpFill.style.width = `${v * 100}%`;
    this.hpFill.classList.toggle('low', v < 0.3);
    this.hpText.textContent = `${Math.ceil(cur)} / ${Math.round(max)}`;
  }

  setStamina(cur, max) {
    this.spFill.style.width = `${clamp(cur / max, 0, 1) * 100}%`;
    this.spFill.classList.toggle('empty', cur < 22);
  }

  setRoom(r, total) {
    this.roomText.textContent = `${r} / ${total}`;
  }

  setWave(w, total) {
    this.waveText.textContent = total > 1 ? `波次 ${w} / ${total}` : '';
  }

  setKills(n) {
    this.killText.textContent = String(n);
  }

  setTime(sec) {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    this.timeText.textContent = `${m}:${String(s).padStart(2, '0')}`;
  }

  setRelics(list) {
    const map = new Map();
    for (const u of list) map.set(u.id, { u, n: (map.get(u.id)?.n || 0) + 1 });
    this.relicList.innerHTML = '';
    for (const { u, n } of map.values()) {
      const el = document.createElement('div');
      el.className = 'relic';
      el.style.setProperty('--rc', RARITY_MAP[u.rarity].color);
      el.innerHTML = `<span>${u.icon}</span>${n > 1 ? `<b>${n}</b>` : ''}`;
      el.title = `${u.name}：${u.desc}`;
      this.relicList.appendChild(el);
    }
  }

  showBoss(v, name) {
    if (v == null) {
      this.bossWrap.classList.remove('on');
      return;
    }
    this.bossWrap.classList.add('on');
    this.bossFill.style.width = `${clamp(v, 0, 1) * 100}%`;
    if (name) this.bossName.textContent = name;
  }

  /* ---------- 飘字 ---------- */
  damageNumber(pos, text, kind = 'enemy') {
    if (this.numbers.length > 44) {
      const old = this.numbers.shift();
      old.el.remove();
    }
    const el = document.createElement('div');
    el.className = `dmg ${kind}`;
    el.textContent = text;
    this.dmgLayer.appendChild(el);
    const w = new THREE.Vector3(
      pos.x + (Math.random() - 0.5) * 0.55,
      pos.y + (Math.random() - 0.5) * 0.5,
      pos.z + (Math.random() - 0.5) * 0.55
    );
    this.numbers.push({
      el,
      w,
      t: 0,
      dur: kind === 'player' ? 1.0 : 0.78,
      vy: kind === 'crit' ? 2.4 : 1.75,
      scale: kind === 'crit' ? 1.45 : 1,
    });
  }

  updateNumbers(dt, camera, width, height) {
    for (let i = this.numbers.length - 1; i >= 0; i--) {
      const n = this.numbers[i];
      n.t += dt;
      n.w.y += n.vy * dt;
      n.vy *= 0.94;
      const k = clamp(n.t / n.dur, 0, 1);
      const v = this._tmp.copy(n.w).project(camera);
      if (v.z > 1 || v.z < -1) {
        n.el.style.opacity = '0';
      } else {
        const x = (v.x * 0.5 + 0.5) * width;
        const y = (-v.y * 0.5 + 0.5) * height;
        const sc = n.scale * (1 + (k < 0.18 ? (1 - k / 0.18) * 0.45 : 0));
        n.el.style.transform = `translate(-50%,-50%) translate(${x.toFixed(1)}px,${y.toFixed(1)}px) scale(${sc.toFixed(3)})`;
        n.el.style.opacity = String(Math.pow(1 - k, 0.8));
      }
      if (k >= 1) {
        n.el.remove();
        this.numbers.splice(i, 1);
      }
    }
  }

  clearNumbers() {
    for (const n of this.numbers) n.el.remove();
    this.numbers.length = 0;
  }

  hurtFlash() {
    this.hurtEl.classList.remove('on');
    void this.hurtEl.offsetWidth;
    this.hurtEl.classList.add('on');
  }

  setFlash(v) {
    this.flashEl.style.opacity = String(clamp(v, 0, 1) * 0.55);
  }

  toast(text, dur = 2.2) {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('on');
    this.toastT = dur;
  }

  hideToast() {
    this.toastT = 0;
    this.toastEl.classList.remove('on');
  }

  tick(dt) {
    if (this.toastT > 0) {
      this.toastT -= dt;
      if (this.toastT <= 0) this.toastEl.classList.remove('on');
    }
  }

  /* ---------- 面板 ---------- */
  hideAll() {
    for (const p of [this.titlePanel, this.upgradePanel, this.deathPanel, this.pausePanel]) {
      p.classList.remove('on');
    }
    this.hud.classList.add('on');
  }

  showTitle(best) {
    this.hud.classList.remove('on');
    this.bestText.textContent = best ? `最深抵达 第 ${best.room} 层` : '尚无记录，成为第一个走完回廊的人';
    this.titlePanel.classList.add('on');
  }

  showUpgrades(list, onPick) {
    this.hideToast();
    this.cardsEl.innerHTML = '';
    for (let i = 0; i < list.length; i++) {
      const u = list[i];
      const r = RARITY_MAP[u.rarity];
      const card = document.createElement('button');
      card.className = 'card';
      card.style.setProperty('--rc', r.color);
      card.innerHTML = `
        <div class="card-idx">${i + 1}</div>
        <div class="card-icon">${u.icon}</div>
        <div class="card-name">${u.name}</div>
        <div class="card-rarity">${r.label}</div>
        <div class="card-desc">${u.desc}</div>`;
      card.addEventListener('click', () => onPick(u), { once: true });
      this.cardsEl.appendChild(card);
      card.animate(
        [{ opacity: 0, transform: 'translateY(18px) scale(0.96)' }, { opacity: 1, transform: 'none' }],
        { duration: 320, delay: i * 70, easing: 'cubic-bezier(.2,.9,.2,1)', fill: 'backwards' }
      );
    }
    this.upgradePanel.classList.add('on');
  }

  hideUpgrades() {
    this.upgradePanel.classList.remove('on');
  }

  showDeath(stats, onRetry) {
    this.hud.classList.remove('on');
    this.bossWrap.classList.remove('on');
    this.hideToast();
    this.deathStats.innerHTML = `
      <div><span>抵达层数</span><b>第 ${stats.room} 层</b></div>
      <div><span>击杀数</span><b>${stats.kills}</b></div>
      <div><span>生存时间</span><b>${stats.time}</b></div>
      <div><span>历史最深</span><b>第 ${stats.best} 层</b></div>`;
    this.deathPanel.classList.add('on');
    const btn = $('btn-retry');
    btn.onclick = onRetry;
  }

  hideDeath() {
    this.deathPanel.classList.remove('on');
  }

  setDeathTitle(text) {
    const el = $('death-title');
    if (el) el.textContent = text;
    const sub = $('death-sub');
    if (sub) sub.textContent = text === '回廊已破' ? '你走出了灰烬回廊' : '回廊吞下了又一个名字';
  }

  showPause(onResume) {
    this.hideToast();
    this.pausePanel.classList.add('on');
    $('btn-resume').onclick = onResume;
  }

  hidePause() {
    this.pausePanel.classList.remove('on');
  }
}

export const RARITY_MAP = {
  common: { label: '普通', color: '#8fa3bd' },
  rare: { label: '稀有', color: '#4fe3d0' },
  epic: { label: '史诗', color: '#ffb347' },
};
