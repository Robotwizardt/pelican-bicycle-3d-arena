# 🐦 鹈鹕骑自行车 3D · 四模型同题竞技场

同一条初始 prompt，四个大模型各自从零写出一个「鹈鹕骑自行车」的 Three.js 程序化 3D 页面，
自行完成建模、交互、部署，然后自己把访问链接交出来。

四个原本分散的仓库/托管点合并到这一个仓库，成为四个可直接打开的页面。
原来那三个 GitHub 仓库（`pelican-ride-3d`、`pelican-bicycle-3d-deepseek-v4.1-flash`、
`pelican-bicycle-3d-claude-opus-5-5`）以及 dataecho 上的临时站点均已废弃，本仓库是唯一留存。

- **落地页（四页入口）**：https://robotwizardt.github.io/pelican-bicycle-3d-arena/
- 仓库：https://github.com/Robotwizardt/pelican-bicycle-3d-arena

---

## 一、结果页面

| # | 模型 | 页面（GitHub Pages） | 页面标题 |
|---|---|---|---|
| 1 | `step-5-preview`（阶跃星辰） | https://robotwizardt.github.io/pelican-bicycle-3d-arena/pages/step-5-preview/ | 鹈鹕骑行日记 · Pelican Ride 3D |
| 2 | `gpt-6-astra` | https://robotwizardt.github.io/pelican-bicycle-3d-arena/pages/gpt-6-astra/ | Pelican Post · 骑进海风里 |
| 3 | `cn:deepseek-v4.1-flash` | https://robotwizardt.github.io/pelican-bicycle-3d-arena/pages/deepseek-v4.1-flash/ | 鹈鹕骑士 3D · Pelican Rider |
| 4 | `claude-opus-5-5` | https://robotwizardt.github.io/pelican-bicycle-3d-arena/pages/claude-opus-5-5/ | 鹈鹕骑自行车 · Pelican on a Bicycle 3D |

> 顺序 = 会话开始时间（UTC 2026-09-30 05:11 → 09:59）。
> jsDelivr 镜像：`https://cdn.jsdelivr.net/gh/Robotwizardt/pelican-bicycle-3d-arena@main/pages/<slug>/index.html`
> —— 注意 jsDelivr 对 `.html` 一律返回 `text/plain`（防滥用），只能当**下载**用，不能"打开即玩"。

---

## 二、每个对话的初始 prompt（原文）

**#1 `step-5-preview`** —— 唯一一个没有"新建文件夹"约束的：

```
生成一个鹈鹕骑自行车的 3D 页面，尽可能把你所有的能力全部都用上. 然后上传到 CDN 上, 把访问链接给我
```

**#2 / #3 / #4（`gpt-6-astra`、`deepseek-v4.1-flash`、`claude-opus-5-5`）** —— 完全相同，在上一句后面追加了三条约束：

```
生成一个鹈鹕骑自行车的 3D 页面，尽可能把你所有的能力全部都用上. 然后上传到 CDN 上, 把访问链接给我，忽略掉这个目录下的所有文件，自己新建个文件夹来执行，名字要把内容和模型名带上
```

「名字要把内容和模型名带上」这条约束正是四个目录名的来源，
本次合并也按这个约定把第 4 个从 `pelican3d` 改名为 `pelican-bicycle-3d-step-5-preview`。

---

## 三、耗时与 token 总表

统计来源：pi-web 本地会话库 `~/.pi/agent/sessions/--C--Users-admin-pi-cwd-20260916--/`，
逐个 assistant message 的 `usage` 字段累加，耗时按首尾消息时间戳之差（UTC 墙上时间）。

| 模型 | 会话 ID | 耗时 | 总 token（含缓存读） | 非缓存 token（in+out） | 缓存读取 | 助手轮次 |
|---|---|---|---|---|---|---|
| `step-5-preview` | `01a0f0b9-fe26-755a-a8bf-2c87cef89ad3` | **74.1 min** ※ | 12,823,384 | 906,584 | 11,916,800 | 248 |
| `gpt-6-astra` | `01a0f1bc-7351-755a-a8bf-2c9346050731` | **47.5 min** | 2,867,749 | 423,913 | 2,443,836 | 78 |
| `cn:deepseek-v4.1-flash` | `01a0f1be-a4d7-755a-a8bf-2c95daae3609` | **93.1 min** | 22,900,589 | 920,301 | 21,980,288 | 388 |
| `claude-opus-5-5` | `01a0f1c1-3a7b-755a-a8bf-2c9988c01b4d` | **54.8 min** | 4,855,306 | 582,400 | 4,272,906 | 93 |

※ `step-5-preview` 的 74.1 分钟是**纯建站任务**耗时（05:11:56 → 06:26:03 UTC，
结束时已给出可用链接）。之后用户又追问了 3 轮「CDN 到底是怎么发布的」，会话拖到
09:10:31 UTC 才结束，含追问的整段为 238.6 min、总 token 12,823,384。
表中其余数字均为含追问的整段会话值；若只看建站任务，该会话为 12,110,890 / 637,738。

### 明细拆分

| 模型 | input | output | reasoning | cacheRead |
|---|---|---|---|---|
| `step-5-preview` | 675,882 | 230,702 | 0 | 11,916,800 |
| `gpt-6-astra` | 371,769 | 52,144 | 18,416 | 2,443,836 |
| `cn:deepseek-v4.1-flash` | 453,709 | 466,592 | 263,136 | 21,980,288 |
| `claude-opus-5-5` | 517,845 | 64,555 | 0 | 4,272,906 |

### 口径说明

- **总 token（含缓存读）** = `usage.totalTokens` 累加，即 input + output + cacheRead。
  四个会话都是长上下文反复重发，缓存读占了 85%–96%，所以这个数看着很唬人。
- **非缓存 token** = input + output，不含 `cacheRead`，更接近"模型真正处理了多少新内容"。
- 两者都写，是因为单看任何一个都会误导：只看总量会以为 deepseek 烧了 2290 万，
  但其中 2198 万是它自己反复重发的缓存；只看净量又会忽略缓存复用效率的差异
  （`gpt-6-astra` 净量最低 42 万，`claude-opus-5-5` 轮次只有 93 就用了 58 万净 token/轮成本最高）。
- 四个会话均在同一台机器、同一时期跑（2026-09-30），可横向比较。
- 时间戳为 UTC，北京时间 = 表中 +8h（例：`gpt-6-astra` 本地 17:54 → 18:41）。

---

## 四、四个页面分别是什么

### 1. `step-5-preview` — 鹈鹕骑行日记 · Pelican Ride 3D

`pages/step-5-preview/`　耗时 74.1 min　12,823,384 token / 248 轮

戴水手帽、车筐里装鱼的鹈鹕骑复古公路车沿海岸公路前行。
全程序化建模（无任何外部模型/贴图）；两段式 IK 让脚掌贴合脚踏、身体随踏频起伏、
喉囊晃动、围巾飘动；黎明/正午/黄昏/夜晚四档昼夜 + 星空 + 潮汐雾 + 路灯与车灯光锥；
五机位（环绕/跟拍/侧面/正面/俯视）带缓动过渡；SVG 速度表遥测（速度/里程/踏频/FPS/三角形数）；
Web Audio 合成的车铃/风声/链条声；4 套整车涂装；移动端底部虚拟按键。

- 页面结构为多文件版：`index.html` + `app.js` + `three.min.js` + `OrbitControls.js`
- `pelican-ride.html` 是等价的 **672 KB 单文件版**（three.js 内联），离线双击可开
- 源码与构建脚本在 `src/`，回归截图在 `shots/`

### 2. `gpt-6-astra` — Pelican Post · 骑进海风里

`pages/gpt-6-astra/`　耗时 47.5 min　2,867,749 token / 78 轮

中英双语的"海岛旅行杂志"风格页面：可交互的 3D 微缩海岛，灯塔、棕榈、帆船、海鸥、动态海面，
鹈鹕踩踏/车轮转动/围巾飘动，车篮装着鲜花。昼夜切换、速度 4–28 km/h、里程环线 1.2 km、
车铃与海浪声、一键导出 1800×1400 明信片 PNG。
Vite + Three.js 构建，附 10 项单元测试 / 23 项浏览器检查，`window.__pelican.status` 只读诊断接口。

- 页面为 `index.html` + `assets/`（JS/CSS）+ `fonts/`（本地 woff2），自包含无外部请求
- 源码在 `src/`，测试在 `tests/`，原 `publish.mjs` 发布脚本保留（原目标是 dataecho.ai）

### 3. `cn:deepseek-v4.1-flash` — 鹈鹕骑士 3D · Pelican Rider

`pages/deepseek-v4.1-flash/`　耗时 93.1 min　22,900,589 token / 388 轮

**单文件 740 KB、零外部请求**（three.js 全部内联）。程序化骨架：5 节颈、三段式双翼、
两段式双腿+蹼足、喙与喉囊、眼睑，每帧 IK 让翅膀搭车把、脚掌踩踏板；
自行车有辐条轮组（每轮 56 根辐条+花鼓+碟刹盘）、84 节带松弛变化的链条、变速器、货架木箱；
世界包含无限滚动海岸公路、FFT 风格海面着色器、单 draw call 体积云天空、实例化植被与 GPU 粒子；
HDR 半浮点 RT + 自研后处理（ACES/泛光/色散/晕影/颗粒/速度径向模糊）、PMREM 天空 IBL、级联阴影；
骑行物理（踏频/齿比/坡度/风阻/体力）、7 种机位、键盘+触屏+手柄、GLB 导出、5 种涂装。

- 页面：`index.html`（自包含单文件）
- 源码在 `src/`（25 个源文件），构建脚本 `build.mjs`，本地服务 `serve.mjs`

### 4. `claude-opus-5-5` — 鹈鹕骑自行车 · Pelican on a Bicycle 3D

`pages/claude-opus-5-5/`　耗时 54.8 min　4,855,306 token / 93 轮

戴头盔系围巾的鹈鹕绕池塘兜圈：腿用 IK 踩踏板、翅膀用 IK 握车把，喉囊晃动、围巾飘动，
点头部会大叫掉羽毛、点自行车会按铃。起伏地形 + 环形公路 + 动态水波与荷花的池塘，
实例化树/草/花（草随风摆动）、路灯、云、远山、萤火虫、星空；物理天空昼夜循环，
黄昏偏暖、夜里路灯亮起带光晕、车灯亮起；辉光/暗角/胶片颗粒/车轮扬尘。
5 种相机（电影运镜/自由环绕/追尾/侧拍/鹈鹕视角）、加速减速滑行、截图、隐藏界面、
控制面板可改颜色/时间/画质；aria-live 读屏播报，尊重 `prefers-reduced-motion`。

- 页面：`index.html` + `js/`（8 个模块，源码即产物）
- **注意**：本页的 three.js 与 lil-gui 通过 jsDelivr CDN 的 importmap 加载，不是自包含的
- 生成过程用子代理做了 6 轮视觉审查；已知小瑕疵：头盔边缘下方能看到一小块头部、黄昏时天空顶部偏冷

---

## 五、目录结构

```
pelican-bicycle-3d-arena/
├── index.html                        落地页：四张卡片 + 四页入口
├── README.md                         本文件：prompt / 耗时 / token / 结果页面
├── .nojekyll                         关掉 GitHub Pages 的 Jekyll 处理
└── pages/
    ├── step-5-preview/               （原 pelican3d / 原仓库 pelican-ride-3d）
    │   ├── index.html                多文件版入口
    │   ├── pelican-ride.html         等价的 672 KB 单文件版
    │   ├── app.js  three.min.js  OrbitControls.js
    │   ├── src/                      构建源码 + 构建脚本
    │   ├── shots/                    回归截图
    │   └── README.md                 原项目说明
    ├── gpt-6-astra/                  （原 pelican-cycle-gpt-6-astra / dataecho 临时站）
    │   ├── index.html  assets/  fonts/  favicon.svg
    │   ├── src/  public/  tests/
    │   ├── publish.mjs  package.json  package-lock.json
    │   └── README.md
    ├── deepseek-v4.1-flash/          （原仓库 pelican-bicycle-3d-deepseek-v4.1-flash）
    │   ├── index.html                740 KB 自包含单文件
    │   ├── src/  build.mjs  serve.mjs
    │   ├── package.json  package-lock.json
    │   └── README.md
    └── claude-opus-5-5/              （原仓库 pelican-bicycle-3d-claude-opus-5-5）
        ├── index.html
        └── js/                       8 个 ES 模块（源码即产物）
```

---

## 六、本地预览

GitHub Pages 的 URL 与本地目录一一对应，本地起一个静态服务器即可对照调试：

```bash
cd pelican-bicycle-3d-arena
python -m http.server 8080
# 或  npx serve .
```

然后打开 http://localhost:8080/pages/step-5-preview/ 等。

各页面的重新构建方式见各自的 `README.md`（`gpt-6-astra` 需要 `npm i && npm run build`，
`deepseek-v4.1-flash` 需要 `node build.mjs`，`step-5-preview` 需要 `node src/build.js`）。

---

## 七、合并时做的改动（重要）

1. **`gpt-6-astra` 的绝对路径改写**。它原本是 Vite 默认 `base: '/'` 构建，
   产物里写死 `/assets/index-DmhmCYWI.js`、`/assets/index-D0YVdEB_.css`、`/favicon.svg`、
   `url(/fonts/*.woff2)`。放到子路径 `/pages/gpt-6-astra/` 下会全部 404，因此改成相对路径：
   `index.html` 里 3 处改为 `./...`，`assets/index-D0YVdEB_.css` 里 3 处改为 `../fonts/...`。
   **重新 `npm run build` 会把这 6 处改回去**，届时需要在 vite 配置里设 `base: './'`，
   或者重新执行同样的替换。
2. **第 4 个页面改名**：本地目录 `pelican3d` → `pelican-bicycle-3d-step-5-preview`
   （页面 slug 用 `step-5-preview`），对齐另外三个"内容+模型名"的命名约定。
3. **`pelican3d` 的过程产物未收录**：`diag*.js`（6 个）、`debug.js`、`drift.js`、`pwtest.js`、
   `q.js`、`verify-*.js`、`build*.js`（根目录副本）等诊断/验证脚本留在本地未进仓库；
   出版本用的是原出版仓库 `pelican-ride-3d` 里的那套文件。
   同理 `gpt-6-astra` 的 `artifacts/`（浏览器截图、视觉 QA 记录）和
   `deepseek-v4.1-flash` 的 `.tmp.b64` 未收录。
4. **`dist/` 目录被"展平"**：`gpt-6-astra/dist/*` 直接提到 `pages/gpt-6-astra/` 下，
   保证 URL 是 `/pages/gpt-6-astra/` 而不是 `/pages/gpt-6-astra/dist/`。
5. 三个原仓库保持不动，由仓库主自行删除；本地四个原始目录也未被修改。

---

## 八、已知问题

- `claude-opus-5-5` 页面依赖 jsDelivr 上的 three.js 0.170.0 与 lil-gui，断网/被墙时打不开（另外三页不依赖外部 CDN）。
- `step-5-preview` 与 `gpt-6-astra` 的页面在低端移动设备上会掉帧（shadow map + 后处理较重）。
- `deepseek-v4.1-flash` 单文件 740 KB，首次加载需要下载完整体积（gzip 后约 200 KB）。
- jsDelivr 镜像的 `.html` 是 `text/plain`，只适合下载，不适合直接当页面入口。
