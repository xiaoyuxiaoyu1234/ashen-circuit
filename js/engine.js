// engine.js — 数学工具、输入、弹簧臂相机、打击感时间控制、碰撞
import * as THREE from 'three';

/* ---------------- 数学 ---------------- */
export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const rand = (min, max) => min + Math.random() * (max - min);
export const randInt = (min, max) => Math.floor(rand(min, max + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const easeOut = (t) => 1 - Math.pow(1 - t, 3);
export const easeIn = (t) => t * t * t;
export const easeOutBack = (t) => 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2);

export function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 归一化到 (-PI, PI] */
export function wrapAngle(a) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

/** a 到 b 的最短角度差 */
export const angleDelta = (a, b) => wrapAngle(b - a);

/** 朝目标角转动，每次最多 maxStep */
export function turnToward(cur, target, maxStep) {
  const d = angleDelta(cur, target);
  return cur + clamp(d, -maxStep, maxStep);
}

/* ---------------- 碰撞 ---------------- */
/** 圆 vs 轴对齐矩形（XZ 平面），就地推出，返回是否碰撞 */
export function resolveCircleRect(p, r, rect) {
  const dx = p.x - rect.x;
  const dz = p.z - rect.z;
  const cx = clamp(dx, -rect.hx, rect.hx);
  const cz = clamp(dz, -rect.hz, rect.hz);
  const ox = dx - cx;
  const oz = dz - cz;
  const d2 = ox * ox + oz * oz;
  if (d2 > r * r) return false;
  if (d2 > 1e-8) {
    const d = Math.sqrt(d2);
    const push = r - d;
    p.x += (ox / d) * push;
    p.z += (oz / d) * push;
  } else {
    const px = rect.hx - Math.abs(dx);
    const pz = rect.hz - Math.abs(dz);
    if (px < pz) p.x = rect.x + Math.sign(dx || 1) * (rect.hx + r);
    else p.z = rect.z + Math.sign(dz || 1) * (rect.hz + r);
  }
  return true;
}

/** 圆 vs 圆，就地推出 b */
export function resolveCircleCircle(a, ra, b, rb) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const rr = ra + rb;
  const d2 = dx * dx + dz * dz;
  if (d2 > rr * rr || d2 < 1e-8) return false;
  const d = Math.sqrt(d2);
  const push = rr - d;
  b.x += (dx / d) * push;
  b.z += (dz / d) * push;
  return true;
}

/* ---------------- 输入 ---------------- */
const KEYMAP = {
  KeyW: 'up', ArrowUp: 'up',
  KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  Space: 'dodge',
  KeyJ: 'light', KeyK: 'heavy',
  ShiftLeft: 'heavy', ShiftRight: 'heavy',
  KeyQ: 'camL', KeyE: 'camR',
  Escape: 'pause', KeyM: 'mute', KeyP: 'pause',
};

export class Input {
  constructor(dom) {
    this.dom = dom;
    this.down = new Set();
    this.buf = new Map();       // 动作 -> 剩余缓冲时间
    this.bufferWindow = 0.16;
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.locked = false;
    this.lockFailed = false;
    this.enabled = true;
    this.isTouch = false;
    this.sens = 0.0024;

    this.move = { x: 0, y: 0 };
    this.touchMove = { active: false, id: -1, ox: 0, oy: 0, x: 0, y: 0 };
    this.touchLook = { active: false, id: -1, lx: 0, ly: 0 };

    this._bindKeyboard();
    this._bindMouse();
    this._bindPointer();
  }

  _bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      const a = KEYMAP[e.code];
      if (!a) return;
      if (e.code === 'Space' || e.code === 'Tab' || e.code === 'ArrowUp' || e.code === 'ArrowDown') e.preventDefault();
      if (!this.down.has(a)) this.press(a);
      this.down.add(a);
    });
    window.addEventListener('keyup', (e) => {
      const a = KEYMAP[e.code];
      if (!a) return;
      this.down.delete(a);
    });
    window.addEventListener('blur', () => this.down.clear());
  }

  _bindMouse() {
    // 锁定与未锁定两种模式都要能转视角，否则在 iframe 里（默认禁用 pointer-lock）会完全不可玩
    window.addEventListener('mousemove', (e) => {
      const dx = e.movementX || 0;
      const dy = e.movementY || 0;
      if (this.locked) {
        this.mouseDX += dx;
        this.mouseDY += dy;
      } else if (this.dragging) {
        this.mouseDX += dx * 1.15;
        this.mouseDY += dy * 1.15;
      }
    });

    window.addEventListener('mouseup', () => {
      this.dragging = false;
    });
    window.addEventListener('blur', () => {
      this.dragging = false;
    });

    this.dom.addEventListener('contextmenu', (e) => e.preventDefault());

    this.dom.addEventListener('mousedown', (e) => {
      if (this.isTouch) return;
      if (e.button === 0) {
        this.press('light');
        this.dragging = true;
        if (!this.locked) this.requestLock();
      } else if (e.button === 2) {
        this.press('heavy');
        if (!this.locked) this.requestLock();
      }
    });

    document.addEventListener('pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === this.dom;
      if (this.locked) {
        this.everLocked = true;
        this.lockErrors = 0;
        return;
      }
      // 只有「真的锁上过又被解开」才算玩家主动退出（Esc），才暂停
      if (was && this.onUnlock) this.onUnlock();
    });

    // 锁失败不等于玩家想暂停：降级成拖动视角，绝不触发暂停，否则会和「继续」按钮形成死循环
    document.addEventListener('pointerlockerror', () => {
      this.locked = false;
      this.lockErrors = (this.lockErrors || 0) + 1;
      if (this.lockErrors >= 2 && !this.lockDisabled) {
        this.lockDisabled = true;
        if (this.onLockFail) this.onLockFail();
      }
    });
  }

  _bindPointer() {
    const el = this.dom;
    el.style.touchAction = 'none';
    const findT = (id) => (this.touchMove.id === id ? this.touchMove : this.touchLook.id === id ? this.touchLook : null);

    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      this.isTouch = true;
      const r = el.getBoundingClientRect();
      const x = e.clientX - r.left;
      if (x < r.width * 0.45 && !this.touchMove.active) {
        this.touchMove.active = true;
        this.touchMove.id = e.pointerId;
        this.touchMove.ox = x;
        this.touchMove.oy = e.clientY - r.top;
        this.touchMove.x = 0;
        this.touchMove.y = 0;
      } else if (!this.touchLook.active) {
        this.touchLook.active = true;
        this.touchLook.id = e.pointerId;
        this.touchLook.lx = e.clientX;
        this.touchLook.ly = e.clientY;
      }
    });

    el.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'touch') return;
      const t = findT(e.pointerId);
      if (!t) return;
      if (t === this.touchMove) {
        const r = el.getBoundingClientRect();
        t.x = (e.clientX - r.left) - t.ox;
        t.y = (e.clientY - r.top) - t.oy;
      } else {
        this.mouseDX += (e.clientX - t.lx) * 1.6;
        this.mouseDY += (e.clientY - t.ly) * 1.6;
        t.lx = e.clientX;
        t.ly = e.clientY;
      }
    });

    const up = (e) => {
      if (this.touchMove.id === e.pointerId) {
        this.touchMove.active = false;
        this.touchMove.id = -1;
        this.touchMove.x = 0;
        this.touchMove.y = 0;
      }
      if (this.touchLook.id === e.pointerId) {
        this.touchLook.active = false;
        this.touchLook.id = -1;
      }
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  requestLock() {
    if (this.isTouch || this.lockDisabled) return;
    // 浏览器在 Esc 退出后有约 1 秒的重锁冷却期，抢跑只会连续报错
    const now = performance.now();
    if (now - (this._lastLockTry || 0) < 700) return;
    this._lastLockTry = now;
    try {
      const p = this.dom.requestPointerLock();
      if (p && typeof p.catch === 'function') {
        p.catch(() => {
          this.lockErrors = (this.lockErrors || 0) + 1;
        });
      }
    } catch (err) {
      this.lockErrors = (this.lockErrors || 0) + 1;
    }
  }

  press(name) {
    if (!this.enabled && !['pause', 'mute'].includes(name)) return;
    this.buf.set(name, this.bufferWindow);
  }

  /** 消费缓冲中的动作，返回是否触发 */
  consume(name) {
    if (!this.buf.has(name)) return false;
    this.buf.delete(name);
    return true;
  }

  isDown(name) {
    return this.down.has(name) || this.buf.has(name);
  }

  /** 移动向量（相机空间），已归一化 */
  axis() {
    let x = 0;
    let y = 0;
    if (this.down.has('left')) x -= 1;
    if (this.down.has('right')) x += 1;
    if (this.down.has('up')) y += 1;
    if (this.down.has('down')) y -= 1;
    if (this.touchMove.active) {
      const m = Math.min(1, Math.hypot(this.touchMove.x, this.touchMove.y) / 48);
      const a = Math.atan2(this.touchMove.x, -this.touchMove.y);
      x += Math.sin(a) * m;
      y += Math.cos(a) * m;
    }
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    this.move.x = x;
    this.move.y = y;
    return this.move;
  }

  /** 每帧末尾：衰减缓冲、清零鼠标增量 */
  endFrame(dt) {
    for (const [k, v] of this.buf) {
      const nv = v - dt;
      if (nv <= 0) this.buf.delete(k);
      else this.buf.set(k, nv);
    }
  }

  takeMouse() {
    const dx = this.mouseDX;
    const dy = this.mouseDY;
    this.mouseDX = 0;
    this.mouseDY = 0;
    return { dx, dy };
  }
}

/* ---------------- 弹簧臂相机 ---------------- */
export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.yaw = Math.PI;
    this.pitch = 0.36;
    this.dist = 9.4;
    this.pivot = new THREE.Vector3(0, 1.5, 0);
    this.trauma = 0;
    this.time = 0;
    this._off = new THREE.Vector3();
    this._pos = new THREE.Vector3();
    this._look = new THREE.Vector3();
    this.fovBase = camera.fov;
    this.fovKick = 0;
  }

  look(dx, dy, sens) {
    this.yaw -= dx * sens;
    this.pitch = clamp(this.pitch + dy * sens * 0.62, -0.12, 1.02);
  }

  addTrauma(v) {
    this.trauma = clamp(this.trauma + v, 0, 1);
  }

  /** 相机朝向的水平前 / 右向量 */
  basis() {
    return {
      fx: Math.sin(this.yaw + Math.PI),
      fz: Math.cos(this.yaw + Math.PI),
      rx: Math.sin(this.yaw + Math.PI / 2),
      rz: Math.cos(this.yaw + Math.PI / 2),
    };
  }

  update(rt, focus, input, world) {
    this.time += rt;
    this.trauma = Math.max(0, this.trauma - rt * 1.55);

    const { dx, dy } = input.takeMouse();
    if (dx || dy) this.look(dx, dy, input.sens);
    if (input.down.has('camL')) this.yaw += rt * 2.1;
    if (input.down.has('camR')) this.yaw -= rt * 2.1;

    const px = focus.x;
    const py = focus.y + 1.55;
    const pz = focus.z;
    this.pivot.x = damp(this.pivot.x, px, 12, rt);
    this.pivot.y = damp(this.pivot.y, py, 9, rt);
    this.pivot.z = damp(this.pivot.z, pz, 12, rt);

    const wantDist = 6.4 + this.pitch * 2.7;
    this.dist = damp(this.dist, wantDist, 6, rt);

    const cy = Math.cos(this.pitch);
    const sy = Math.sin(this.pitch);
    this._off.set(Math.sin(this.yaw) * cy, sy, Math.cos(this.yaw) * cy).multiplyScalar(this.dist);

    // 相机遮挡：从远到近采样，找到第一个不被挡的位置
    let t = 1;
    if (world && world.blocked) {
      for (let i = 10; i >= 2; i--) {
        const k = i / 10;
        const x = this.pivot.x + this._off.x * k;
        const z = this.pivot.z + this._off.z * k;
        if (!world.blocked(x, z, 0.45)) { t = k; break; }
        t = k;
      }
    }

    this._pos.copy(this.pivot).addScaledVector(this._off, t);
    this._pos.y = Math.max(this._pos.y, 0.75);

    // 抖动：trauma 平方衰减，多频叠加避免机械感
    const s = this.trauma * this.trauma;
    if (s > 0.0001) {
      const tt = this.time;
      this._pos.x += Math.sin(tt * 47.3) * s * 0.42;
      this._pos.y += Math.sin(tt * 39.1 + 1.7) * s * 0.32;
      this._pos.z += Math.sin(tt * 51.7 + 3.1) * s * 0.42;
    }

    this.camera.position.copy(this._pos);
    this._look.copy(this.pivot);
    if (s > 0.0001) {
      this._look.x += Math.sin(this.time * 41.9) * s * 0.22;
      this._look.y += Math.sin(this.time * 33.7) * s * 0.16;
    }
    this.camera.lookAt(this._look);
    if (s > 0.0001) this.camera.rotateZ(Math.sin(this.time * 53.3) * s * 0.05);

    this.fovKick = damp(this.fovKick, 0, 6, rt);
    const wantFov = this.fovBase + this.fovKick;
    if (Math.abs(this.camera.fov - wantFov) > 0.01) {
      this.camera.fov = damp(this.camera.fov, wantFov, 8, rt);
      this.camera.updateProjectionMatrix();
    }
  }
}

/* ---------------- 打击感 ---------------- */
export class Feel {
  constructor() {
    this.freeze = 0;
    this.flash = 0;
    this.slowmo = 0;
  }

  hitstop(sec) {
    this.freeze = Math.max(this.freeze, sec);
  }

  /** 返回本帧可用于游戏的 dt（冻结时为 0） */
  tick(rt) {
    this.freeze = Math.max(0, this.freeze - rt);
    this.flash = Math.max(0, this.flash - rt * 3.2);
    if (this.freeze > 0) return 0;
    if (this.slowmo > 0) {
      this.slowmo = Math.max(0, this.slowmo - rt);
      return rt * 0.35;
    }
    return rt;
  }
}
