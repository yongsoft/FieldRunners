# tools/bake —— Blender 正交烘焙管线

把炮塔/载具做成低模 → 用 Blender 正交相机烘成「多朝向序列帧」→ 打包成一张紧凑图集，
内联进 `js/bake-data.js`，游戏里每座塔每帧只多一次 `drawImage`。

这是「A + D 方案」的落地：**A** = 3D 建模 + 正交相机烘焙，**D** = AI/程序化资产。
比在 Canvas 里手写图元（`art.js` 的 `buildTop`）能表达多得多的体积细节，
而运行时开销和分桶缓存完全一样。

---

## 1. 为什么能直接替换程序化版本

`art.js` 的伪 3D 是一套**正交投影**，不是随手压扁：

```js
pt(u, v, w) = [u·cos(rot) − v·sin(rot), (u·sin(rot) + v·cos(rot))·GROUND_K − w·HZ]
GROUND_K = 0.46   // 地面在屏幕竖直方向压 0.46
```

一个俯角 θ 的正交相机，地面沿视线方向压 `sin θ`、竖直方向压 `cos θ`。
取 `sin θ = 0.46` → **θ = 27.386°**，此时 `cos θ = 0.8878 ≈ HZ(0.90)`，两者吻合。

所以只要 Blender 相机架在 **仰角 27.386°**，烘出来的 sprite 就能原样塞进
现有的 48 桶朝向缓存，落点、朝向、后座位移全部不用改。

坐标映射（`pt()` 的 u/v/w ↔ Blender 的 X/Y/Z）：

| 游戏 | Blender | 说明 |
|---|---|---|
| u（炮口前方） | +X | |
| v（右侧，**v 越大越靠近相机**） | **−Y** | 相机在 −Y 侧，所以是反的 |
| w（高度） | +Z | |
| 转塔 `+rot` | 绕 Z 转 `−rot` | 因为 v 轴反了 |

## 2. 两张画布的落点（**最容易错的地方**）

| | 画布 | 原点 | 相机注视点 |
|---|---|---|---|
| 基座 | 96×96 | **(48,48) = 画布正中** | `(0,0,0)` |
| 炮体 | 192×192 | **(84,124)，不是画布中心 (96,96)** | `(12/TT, 0, 28/(TT·cosθ))` |

`art.js` 的 `buildTop` 是 `x.translate(TPX=84, TPY=124)`，所以炮体原点在 (84,124)。
正交相机把**注视点**打在画面正中，因此要瞄一个偏移点，让模型原点落到 (84,124)。
搞错这一步的症状是整座塔平移 (12, 28) px —— 不算大，但和程序化版本叠在一起立刻穿帮。

两张画布的原点在游戏里分别对应：

```
groundY   = BASE_CY_TOP + BASE_RIM_H = 3.822 + 9.1 = 12.922   // 基座画布原点(48,48)
platformY = BASE_CY_TOP             = 3.822                   // 炮体画布原点(84,124)
```

`pack.py` 会把这两个数写进 `BAKE_META`，`art.js` 的 bake 分支直接读。

**基座用另一套俯角**：`art.js` 的台面椭圆比是 `BASE_RY/BASE_RX = 0.39`，
而炮塔地面偏移用 `GROUND_K = 0.46` —— 原画本来就不一致。
基座照 `asin(0.39) = 22.95°` 烘，台面才不会比程序化版本「胖一圈」。

## 3. 着色：三档赛璐璐 + 轴向分档

`cel_mat()` 走的是「几何法线 → 三档常值 ColorRamp → Emission」（无灯光、无反弹，
所以 Cycles 其实是在做光栅化，48 个朝向只要 ~8 秒）。

两种分档方式：

* **`mode='axis'`（方块用）** —— 按**零件自己的轴**分档：
  `f = |N·x|·0.52 + |N·y|·0.30 + max(N·z,0)·1.0`
  → 顶面 1.00 / 朝前后面 0.52 / 朝左右面 0.30。
  这正是 `art.js` `box()` 的做法（顶面固定 `OL.l`、U 面 `OL.m`、V 面 `OL.d`，
  和光从哪来无关）。
  ⚠️ 用世界空间 `N·L` 分档的话，朝向 45° 时两个可见侧面会落到同一档，
  炮体糊成一块 —— 这是第一版「偏灰偏平」的真正原因。
* **`mode='light'`（基座大圆柱用）** —— 世界空间 `N·L`，圆柱才有左右明暗。

再叠 `grads`（按 `Generated` 的 X/Y/Z 乘一层常值渐变），对应 `art.js` 的
`bodyGrad`（下暗上亮）和 `topGrad`（前暗后亮）。渐变跟着零件局部轴转 ——
和 `fillU/fillV/fillW` 在平面局部坐标里建渐变是一回事。

档宽是对着色稿量出来的：侧面 / 正面 / 顶面 在线性空间约 **0.30 : 0.52 : 1.00**
（`OL.d` / `OL.m` / `OL.l` 三个色的比例就是这么多）。

## 4. 跑一遍

```bash
# 依赖：Blender 4.5（headless 可用）、python3 + Pillow + numpy、node（仅 A/B 用）
BL=/tmp/bl/Blender.app/Contents/MacOS/Blender
PY=/Users/yong/.workbuddy-ai/binaries/python/envs/default/bin/python

$BL --background --factory-startup --python tools/bake/bake.py   # 建模型 + 烘 48 朝向
$PY tools/bake/post.py                                           # 粗黑描边 + 盒式降采样
$PY tools/bake/pack.py                                           # 紧凑图集 + base64 内联
```

环境变量：

| 变量 | 默认 | 说明 |
|---|---|---|
| `BAKE_WORK` | `/tmp/bl` | 中间产物目录（`out/`、`final/`、`platform.json`），不入库 |
| `BAKE_HEADINGS` | `48` | 烘几个朝向（预览时给 6，秒出） |
| `BAKE_SAMPLES` | `16` | Cycles 采样数 |
| `BAKE_DEBUG` | — | 打印每个零件的世界包围盒并逐个渲染，然后退出 |
| `FR_REPO` | 脚本上两级 | `js/bake-data.js` 的输出位置 |

A/B 对比（需要先起本地服务 + headless Chrome，见下）：

```bash
node tools/bake/ab.mjs 1   # 烘焙贴图
node tools/bake/ab.mjs 0   # 程序化（?bake=0）
```

```bash
python3 -m http.server 7777                       # 在 fieldrunners/ 下
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
  --remote-debugging-port=9222 --no-sandbox --disable-gpu-sandbox \
  --disable-dev-shm-usage --user-data-dir=/tmp/cdp-profile-fr2 about:blank
```

## 5. 描边与体积

`post.py` 在超采样分辨率（SS=4）上做 alpha 膨胀描边再盒式降采样，
所以描边宽度和抗锯齿都可控。两档宽度：

* 基座 `1.70`（对应 `towerBase` 的 `ink(2.8/2.6)`）
* 炮体 `1.65`（`buildTop` 零件描边多在 1.7~1.9，但枪管只有 1.0，取折中；
  太粗会把 r≈2.7px 的枪管吃掉）

## 6. 体积：调色板量化

赛璐璐着色天然只有几十种颜色，`pack.py` 里 `quantize(colors=128)` 之后：

| | 原始 RGBA | 128 色 |
|---|---|---|
| `atlas_top.png`（48 朝向） | 225 KB | **47 KB** |
| `bake-data.js`（base64 内联） | 300 KB | **66 KB** |

实测 mean\|Δ\| = 1.7/255，边缘的 39 级 alpha 全部保留。
不量化的话 6 塔 × 3 级要 ~5MB，量化后 ~1MB —— 内联进 HTML 才可行。

## 7. 踩过的坑（改之前先看这里）

1. **`box()` 的 `scale` 别除 2** —— `primitive_cube_add(size=1)` 的棱长就是 1，
   写成 `sx/2` 会让整个模型小一半。第一版「炮体偏瘦」就是这个。
2. **`ShaderNodeMix` 的同名 socket 有好几个**（Float/Vector/Color/Rotation），
   `inputs['A']` 拿到的是 Float 那个，接 Color 会**静默**出错。必须按索引取
   （RGBA 是 `inputs[6]/[7]`、`outputs[2]`）。
3. **倒角别超过最短边的一半** —— 会自交把网格搞没。
4. **基座别拆成「大圆柱 + 小圆盘」再给顶面换材质** —— 台面伸到 35 而深橄榄
   楔形板只到 31.7，会留一圈亮环。拆成「外壁到 `H_BASE-0.8` + 上面扣一只 r=32.8
   的浅灰盘」，和 `art.js` 的 `RX-2.2` 一致。
5. **`headless` 下只有 Cycles 能出图** —— `BLENDER_EEVEE_NEXT` 没有窗口服务器
   会渲染出 0 字节。
6. Blender 4.5 里是 `ShaderNodeEmission`，**没有** `ShaderNodeBsdfEmission`。

## 8. 还没做

* 目前只烘了 **机枪塔 lv0**（`Bake.has()` 里写死 `key==='gatling' && lv===0`）。
  其余 5 塔 × 3 级仍走程序化路径。
* 载具（敌人）还没接进来，但同一套管线可以直接用（`K_ENEMY = 0.46` 一致）。
* 等级灯目前烘在基座里（lv0 只亮一颗绿的），升级后需要换 base 图。
