# 灰烬回廊 · Ashen Circuit

一个跑在浏览器里的 3D 第三人称动作 roguelite。零构建链、零美术素材、零音频素材，整个目录拖进静态站就能上线。

- **引擎**：three.js r170（本地内置，不依赖 CDN）
- **体积**：全量 844 KB，其中引擎 676 KB（Cloudflare/GitHub 自动 gzip 后约 230 KB）
- **渲染**：WebGL2 · 单光源阴影 · ACES 色调映射 · 程序化环境贴图
- **系统**：三段连击 / 重击 / 翻滚无敌帧 / 体力 / hitstop / 震屏 / 13 种遗物 / 8 层推进 / 三阶段 Boss

---

## 本地运行

ES Module 不能走 `file://`，必须起一个静态服务器：

```bash
cd games/ashen-circuit
python -m http.server 8788
# 打开 http://127.0.0.1:8788
```

或者用 Node：

```bash
npx serve .
```

---

## 部署

### 放进现有个人站的子目录（当前采用）

把 `games/ashen-circuit/` 整个目录丢进你的站点仓库，push 即可：

```
你的仓库/
├── index.html
├── ...
└── games/
    └── ashen-circuit/
        ├── index.html
        ├── css/style.css
        ├── js/*.js
        └── libs/three.module.min.js
```

访问 `https://你的域名/games/ashen-circuit/`。所有路径都是相对路径，**不需要改任何配置**。

### Cloudflare Pages

- Framework preset：`None`
- Build command：留空
- Build output directory：`/`

如果游戏就是仓库根目录，直接把这些文件放根目录，输出目录填 `/` 即可。

### GitHub Pages

仓库 → Settings → Pages → Source 选分支 + 目录（根目录或 `/docs`）。

---

## 操作

| 输入 | 行为 |
|---|---|
| `WASD` | 相对镜头移动 |
| 鼠标 | 转动视角（点击画面会尝试锁定指针） |
| 按住左键拖拽 | 未锁定时同样可以转视角（iframe 等环境自动降级） |
| `Q` / `E` | 左右转视角（备用，永远可用） |
| 左键 | 三段连击（连按接续） |
| 右键 / `Shift` | 重击（高伤 + 高击退，慢） |
| `空格` | 翻滚（0.06s 后进入无敌帧） |
| `Esc` | 暂停 |
| `M` | 静音 |

触屏设备会自动出现「攻 / 重 / 滚」三个按钮，左侧半屏拖动移动，右侧拖动转视角。

---

## 玩法

**推进**：8 层。前 7 层清完所有波次后进入三选一遗物，第 8 层是 Boss「灰烬之主」。死亡即结束，只保留历史最深记录（localStorage）。

**敌人**

| 类型 | 行为 |
|---|---|
| 冲锋者 | 靠近后蓄力 0.55s，扇形预警，直线冲刺撞人 |
| 喷吐者 | 保持 8～10 米，横向游走，蓄力后发射远程弹 |
| 重甲 | 高血量、抗击退，3 米内砸地，范围伤害 |
| 灰烬之主 | 三阶段：冲锋连击 → 弹幕爆发 + 召唤 → 提速复合 |

**遗物**：13 种，分普通 / 稀有 / 史诗三档，加法叠加（`锋刃` 可重复拿）。

**手感层**（这是"像不像大厂"的关键，不是画质）

- **hitstop**：命中瞬间冻结 50～85ms，特效和镜头继续播
- **trauma 震屏**：按 `trauma²` 衰减，多频正弦叠加，避免机械抖动
- **弹簧臂相机**：位置阻尼跟随、遮挡自动收近、冲刺 FOV 外扩、受击后坐
- **输入缓冲**：按键提前 160ms 记录，攻击 / 翻滚都不会"吃输入"
- **软锁朝向**：出招瞬间自动转向 120° 内最近的敌人
- **打击反馈四件套**：闪白、火花、冲击光斑、飘字，同时触发
- **音频**：全部 WebAudio 实时合成，BGM 是 drone pad + 鼓组 + 贝斯，强度随层数上升

---

## 代码结构

```
js/
├── engine.js    数学 / 输入（键鼠 + 触屏）/ 弹簧臂相机 / 打击感时间控制 / 碰撞
├── audio.js     WebAudio 合成音效与分层 BGM
├── actors.js    程序化角色建模 + 程序化骨骼动画（走跑 / 攻击 / 翻滚 / 死亡）
├── fx.js        粒子池 / 冲击波 / 剑气弧 / 地面预警圈
├── entities.js  玩家 / 敌人 / Boss / 投射物
├── director.js  房间波次调度 / 遗物池
├── ui.js        HUD / 伤害飘字 / 卡牌 / 结算
└── game.js      场景搭建 / 光照 / 战斗结算 / 主循环
```

设计上有意保持「逻辑与表现分离」：`entities.js` 只改数值和状态，`actors.js` 负责把这些状态翻译成姿态。所以换模型、换动画不需要碰战斗逻辑。

---

## 调参入口

| 想改什么 | 去哪 |
|---|---|
| 连段伤害 / 前后摇 / 判定范围 | `entities.js` 顶部 `COMBO`、`HEAVY` |
| 敌人血量 / 速度 / 数量 | `entities.js` `TYPES`；Boss 在 `Boss` 构造函数 |
| 每层几波、什么组合 | `director.js` `ROOM_PLAN` |
| 遗物效果 | `director.js` `UPGRADES` + `entities.js` `Player.addMods` 的 switch |
| 相机距离 / 俯仰 / 灵敏度 | `engine.js` `CameraRig`（`wantDist`、`pitch` 钳制、`input.sens`） |
| 打击感强度 | 全局搜 `hitstop(` 与 `addTrauma(` |
| 场景配色 | `game.js` `ACCENTS`；角色配色 `actors.js` `PALETTES` |
| 地面 / 墙面 | `game.js` `World.makeGroundTex()`、`build()` |

---

## 性能

实测（1280×760，Chromium）：

- draw call 40～90
- 三角面 5k 左右
- 单帧 CPU 逻辑 < 2ms

优化点已经内置：几何体全局缓存、粒子对象池、冲击波/剑气网格复用、障碍物一次 InstancedMesh 渲染墙面棱光、阴影只用一个 1024 平行光且跟随镜头。

---

## 已知限制

- 触屏只有简易按键，没做虚拟摇杆死区调校，精细操作仍建议桌面端。
- 没有中途存档，只有「历史最深层数」记录。
- 不支持手柄（`Gamepad API` 接入点预留在 `engine.js` 的 `Input`，加一层映射即可）。
- 需要 WebGL2；极老的设备会停在加载页并给出提示。

---

## 常见问题

**Q：鼠标锁不定 / 一按就暂停 / 点「继续」没反应？**

页面被嵌在 iframe 里时（比如各种预览面板、内嵌分享页），浏览器的 pointer-lock 策略默认是拒绝的。旧逻辑把「锁定失败」也当成「玩家按了 Esc」，于是每次点「继续」都会重新申请锁定、失败、再次暂停，形成死循环。

现在的处理：

1. 失败 ≠ 暂停。只有**真的锁上过又被解开**才算玩家主动退出。
2. 连续失败两次后彻底放弃锁定，自动降级为「按住左键拖拽转视角」，并弹出提示。
3. 暂停时**一定会释放指针锁定**，否则光标被锁住，「继续」按钮根本点不到。
4. 恢复后有 600ms 的宽限期，忽略期间任何解锁事件。

如果你要嵌 iframe 并希望指针锁定可用，给 iframe 加 `allow="pointer-lock"`：

```html
<iframe src="games/ashen-circuit/" allow="pointer-lock" style="width:100%;height:100vh;border:0"></iframe>
```

