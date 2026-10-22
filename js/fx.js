// fx.js — 粒子 / 冲击波 / 剑气 / 预警圈（全部对象池化）
import * as THREE from 'three';
import { clamp, rand, easeOut, TAU } from './engine.js';

/* ---------------- 粒子池 ---------------- */
class Sparks {
  constructor(scene, max = 900) {
    this.max = max;
    this.count = 0;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.base = new Float32Array(max * 3);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, 0);
    geo.frustumCulled = false;
    this.geo = geo;

    const mat = new THREE.PointsMaterial({
      size: 0.13,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  emit(x, y, z, n, opts = {}) {
    const color = new THREE.Color(opts.color || 0xffffff);
    const speed = opts.speed == null ? 4 : opts.speed;
    const spread = opts.spread == null ? 1 : opts.spread;
    const life = opts.life == null ? 0.5 : opts.life;
    const dir = opts.dir || null;      // {x,y,z} 主方向
    const grav = opts.grav == null ? -9 : opts.grav;

    for (let i = 0; i < n; i++) {
      if (this.count >= this.max) return;
      const k = this.count++;
      let vx = rand(-1, 1) * spread;
      let vy = rand(0, 1.4) * spread;
      let vz = rand(-1, 1) * spread;
      if (dir) {
        vx = dir.x * speed + vx * speed * 0.45;
        vy = dir.y * speed + vy * speed * 0.45;
        vz = dir.z * speed + vz * speed * 0.45;
      } else {
        const len = Math.hypot(vx, vy, vz) || 1;
        vx = (vx / len) * speed * rand(0.4, 1.1);
        vy = (vy / len) * speed * rand(0.4, 1.1);
        vz = (vz / len) * speed * rand(0.4, 1.1);
      }
      this.pos[k * 3] = x;
      this.pos[k * 3 + 1] = y;
      this.pos[k * 3 + 2] = z;
      this.vel[k * 3] = vx;
      this.vel[k * 3 + 1] = vy;
      this.vel[k * 3 + 2] = vz;
      const l = life * rand(0.6, 1.25);
      this.life[k] = l;
      this.maxLife[k] = l;
      this.drag[k] = opts.drag == null ? 2.6 : opts.drag;
      this.grav[k] = grav;
      this.base[k * 3] = color.r;
      this.base[k * 3 + 1] = color.g;
      this.base[k * 3 + 2] = color.b;
      this.col[k * 3] = color.r;
      this.col[k * 3 + 1] = color.g;
      this.col[k * 3 + 2] = color.b;
    }
    this.geo.setDrawRange(0, this.count);
  }

  update(dt) {
    let i = 0;
    while (i < this.count) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        const last = --this.count;
        if (i !== last) {
          for (let c = 0; c < 3; c++) {
            this.pos[i * 3 + c] = this.pos[last * 3 + c];
            this.vel[i * 3 + c] = this.vel[last * 3 + c];
            this.base[i * 3 + c] = this.base[last * 3 + c];
            this.col[i * 3 + c] = this.col[last * 3 + c];
          }
          this.life[i] = this.life[last];
          this.maxLife[i] = this.maxLife[last];
          this.drag[i] = this.drag[last];
          this.grav[i] = this.grav[last];
        }
        continue;
      }
      const d = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= d;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d + this.grav[i] * dt;
      this.vel[i * 3 + 2] *= d;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.pos[i * 3 + 1] < 0.02) {
        this.pos[i * 3 + 1] = 0.02;
        this.vel[i * 3 + 1] *= -0.32;
      }
      const f = clamp(this.life[i] / this.maxLife[i], 0, 1);
      const k = f * f;
      this.col[i * 3] = this.base[i * 3] * k;
      this.col[i * 3 + 1] = this.base[i * 3 + 1] * k;
      this.col[i * 3 + 2] = this.base[i * 3 + 2] * k;
      i++;
    }
    this.geo.setDrawRange(0, this.count);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }
}

/* ---------------- 特效管理器 ---------------- */
export class FX {
  constructor(scene) {
    this.scene = scene;
    this.sparks = new Sparks(scene);

    // 冲击波环池
    this.rings = [];
    for (let i = 0; i < 14; i++) {
      const geo = new THREE.RingGeometry(0.86, 1, 36, 1);
      geo.rotateX(-Math.PI / 2);
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.rings.push({ mesh, t: 0, dur: 1, from: 1, to: 1, active: false, flat: true });
    }

    // 剑气弧池
    this.arcs = [];
    for (let i = 0; i < 10; i++) {
      const geo = new THREE.RingGeometry(0.55, 1, 20, 1);
      geo.rotateX(-Math.PI / 2);
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.arcs.push({ mesh, t: 0, dur: 1, active: false });
    }

    this.anims = [];
  }

  /* --- 火花 --- */
  spark(p, color = 0xffd9a0, n = 10, opts = {}) {
    this.sparks.emit(p.x, p.y, p.z, n, { color, ...opts });
  }

  /* --- 冲击波 --- */
  shockwave(p, radius, color = 0x66e8ff, dur = 0.45) {
    const r = this.rings.find((x) => !x.active);
    if (!r) return;
    r.active = true;
    r.t = 0;
    r.dur = dur;
    r.from = radius * 0.25;
    r.to = radius;
    r.mesh.position.set(p.x, 0.06, p.z);
    r.mesh.rotation.y = 0;
    r.mesh.scale.setScalar(r.from);
    r.mesh.material.color.set(color);
    r.mesh.material.opacity = 0.9;
    r.mesh.visible = true;
  }

  /* --- 剑气弧 --- */
  slash(p, facing, range, arc, color = 0x9ef7ff, dur = 0.22) {
    const a = this.arcs.find((x) => !x.active);
    if (!a) return;
    a.active = true;
    a.t = 0;
    a.dur = dur;
    a.mesh.geometry.dispose?.();
    a.mesh.geometry = (() => {
      const g = new THREE.RingGeometry(range * 0.42, range, 22, 1, -arc / 2, arc);
      g.rotateX(-Math.PI / 2);
      return g;
    })();
    a.mesh.position.set(p.x, p.y, p.z);
    a.mesh.rotation.y = facing - Math.PI / 2;
    a.mesh.scale.setScalar(0.86);
    a.mesh.material.color.set(color);
    a.mesh.material.opacity = 0.85;
    a.mesh.visible = true;
  }

  /* --- 出生光柱 --- */
  pillar(p, color = 0xff8a3d) {
    const geo = new THREE.CylinderGeometry(0.55, 0.75, 4.5, 8, 1, true);
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(p.x, 2.2, p.z);
    this.scene.add(mesh);
    this.spark({ x: p.x, y: 0.15, z: p.z }, color, 18, { speed: 3.2, life: 0.6, grav: 1.6, spread: 1.2 });
    this.anims.push({
      t: 0,
      dur: 0.65,
      update: (k) => {
        mesh.material.opacity = 0.55 * (1 - k);
        mesh.scale.set(1 + k * 0.8, 1, 1 + k * 0.8);
      },
      done: () => {
        this.scene.remove(mesh);
        geo.dispose();
        mat.dispose();
      },
    });
  }

  /* --- 命中光斑 --- */
  impact(p, color = 0xffffff, size = 0.5) {
    const geo = new THREE.SphereGeometry(1, 8, 6);
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(p);
    mesh.scale.setScalar(size * 0.4);
    this.scene.add(mesh);
    this.anims.push({
      t: 0,
      dur: 0.18,
      update: (k) => {
        mesh.scale.setScalar(size * (0.4 + k * 1.1));
        mesh.material.opacity = 0.8 * (1 - k);
      },
      done: () => {
        this.scene.remove(mesh);
        geo.dispose();
        mat.dispose();
      },
    });
  }

  update(dt) {
    this.sparks.update(dt);

    for (const r of this.rings) {
      if (!r.active) continue;
      r.t += dt;
      const k = clamp(r.t / r.dur, 0, 1);
      const s = r.from + (r.to - r.from) * easeOut(k);
      r.mesh.scale.setScalar(s);
      r.mesh.material.opacity = 0.9 * (1 - k) * (1 - k);
      if (k >= 1) {
        r.active = false;
        r.mesh.visible = false;
      }
    }

    for (const a of this.arcs) {
      if (!a.active) continue;
      a.t += dt;
      const k = clamp(a.t / a.dur, 0, 1);
      a.mesh.scale.setScalar(0.86 + k * 0.28);
      a.mesh.material.opacity = 0.85 * (1 - k);
      if (k >= 1) {
        a.active = false;
        a.mesh.visible = false;
      }
    }

    for (let i = this.anims.length - 1; i >= 0; i--) {
      const a = this.anims[i];
      a.t += dt;
      const k = clamp(a.t / a.dur, 0, 1);
      a.update(k);
      if (k >= 1) {
        a.done && a.done();
        this.anims.splice(i, 1);
      }
    }
  }
}

/* ---------------- 地面预警圈 ---------------- */
export class Telegraph {
  constructor(scene, color = 0xff5a3d) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);

    this.bandMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.fillMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0,
      blending: THREE.NormalBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    this.band = new THREE.Mesh(new THREE.BufferGeometry(), this.bandMat);
    this.fill = new THREE.Mesh(new THREE.BufferGeometry(), this.fillMat);
    this.band.frustumCulled = false;
    this.fill.frustumCulled = false;
    this.band.renderOrder = 2;
    this.fill.renderOrder = 1;
    this.group.add(this.band);
    this.group.add(this.fill);

    this.arcKey = -1;
    this.active = false;
    this.progress = 0;
    this.t = 0;
    this.dur = 1;
  }

  _setArc(arc) {
    const a = clamp(arc, 0.18, TAU);
    const key = Math.round(a * 100);
    if (this.arcKey === key) return;
    this.arcKey = key;
    this.band.geometry.dispose();
    this.fill.geometry.dispose();

    const bandGeo = new THREE.RingGeometry(0.9, 1, 48, 1, -a / 2, a);
    bandGeo.rotateX(-Math.PI / 2);
    this.band.geometry = bandGeo;

    const fillGeo = new THREE.RingGeometry(0.001, 0.995, 48, 1, -a / 2, a);
    fillGeo.rotateX(-Math.PI / 2);
    this.fill.geometry = fillGeo;
  }

  _place(p, radius, facing, dur) {
    this.active = true;
    this.t = 0;
    this.dur = dur;
    this.progress = 0;
    this.group.visible = true;
    this.group.position.set(p.x, 0.04, p.z);
    this.group.scale.setScalar(radius);
    this.group.rotation.y = facing - Math.PI / 2;
  }

  show(p, radius, dur) {
    this._setArc(TAU);
    this._place(p, radius, 0, dur);
  }

  showArc(p, radius, arc, facing, dur) {
    this._setArc(arc);
    this._place(p, radius, facing, dur);
  }

  update(dt) {
    if (!this.active) return;
    this.t += dt;
    this.progress = clamp(this.t / this.dur, 0, 1);
    const pulse = 0.5 + Math.sin(this.t * 26) * 0.5;
    this.bandMat.opacity = 0.5 + this.progress * 0.42 + pulse * 0.08;
    this.fillMat.opacity = 0.035 + this.progress * 0.14;
    if (this.progress >= 1) this.hide();
  }

  hide() {
    this.active = false;
    this.group.visible = false;
    this.bandMat.opacity = 0;
    this.fillMat.opacity = 0;
  }
}
