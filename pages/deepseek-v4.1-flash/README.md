# 鹈鹕骑士 · Pelican Rider 3D

一只鹈鹕骑着自行车，沿着海岸公路一路向南。

浏览器里的实时 3D 小场景：程序化生成的鹈鹕骨骼动画 + 自行车传动系统 + 无尽海岸公路 + 昼夜循环。
整个页面被编译成**单个自包含 HTML 文件**（约 720 KB，gzip ~200 KB，Three.js 内联，零外部请求）。

## 演示

打开 `index.html` 即可（也可用任意静态服务器托管）。

## 特点

**模型 · 全程序化，无外部资源**
- 鹈鹕：分层骨架（颈 5 节、双翼三段式、双腿两段式 + 蹼足），羽片、喙与喉囊、眼睑、起飞状态机
- 自行车：完整机械结构——车架/前叉/弯把/坐垫、辐条轮组（56 根线辐 + 花鼓 + 碟刹盘）、曲柄牙盘、84 节链条（带上下松弛变化）、前后变速器、铃铛、货架与木箱
- 每帧 IK 求解：翅膀搭在车把上、脚掌踩在脚踏上，随曲柄角实时变化

**世界**
- 无限滚动海岸公路（地形剖面 + 路肩 + 护栏 + 棕榈 + 岩石 + 草丛，全部实例化）
- 海面：自定义着色器（FFT 风格的波叠加 + 菲涅尔 + 深浅水色 + 水下焦散）
- 天空：单 draw call 的程序化大气着色器（体积云、日月、星空、太阳辉光）
- 昼夜循环：太阳/月亮轨道、天空与雾色联动、夜间车灯与星空

**渲染管线**
- HDR 半浮点渲染目标 + 自研后处理：ACES 色调映射、泛光、色散、晕影、胶片颗粒、速度径向模糊
- PMREM 天空 IBL（节流刷新）、级联阴影、实例化、按需降级的三档画质（低/中/高）

**交互与手感**
- 骑行模拟：踏频、齿比、坡度、风阻、体力消耗、里程
- 物理：空气阻力、跳跃与落地缓冲、刹车甩尾、车体倾斜
- 键盘 / 触屏摇杆 / 手柄三套输入；跟随·追身·侧掠·低机位·远景·骑手视角·电影 七种机位
- 音效：WebAudio 纯合成（链条声、风声、铃铛、海鸥），无音频文件
- 截图、录屏（MediaRecorder）、导出 GLB（自研序列化器，把程序化场景写成 glTF）
- 一天中的时间滑杆、五种涂装、性能与几何统计 HUD

## 操作

| 键 | 作用 |
|---|---|
| `W` / `↑` | 蹬踏加速 |
| `S` / `↓` | 刹车 |
| `A` `D` / `←` `→` | 转向 |
| `空格` | 跳跃 |
| `Shift` | 冲刺 |
| `C` | 切换机位 |
| `B` | 铃铛 |
| `T` | 下一天/时段切换 |
| `R` | 截图 |
| `H` / `?` | 帮助层 |
| 鼠标拖拽 / 滚轮 | 环绕 / 缩放 |

## 链接参数

```
index.html?cam=side&hour=19.5&livery=neon&q=high&auto=0
```

- `cam` = `chase` `onboard` `front` `side` `low` `wide` `cine`
- `hour` = 0–24（一天中的时间）
- `livery` = `sunset` `abyss` `matcha` `cream` `neon`
- `q` = `low` `mid` `high`
- `auto=0` 关闭默认的自动巡航

## 开发

```bash
npm install       # 安装 esbuild（唯一的 devDependency）
npm run build     # 编译成单文件 dist/index.html
npm run serve     # 本地起静态服务（默认 5178 端口）
```

源码结构：

```
src/
  main.js            装配一切、主循环、HUD 接线
  lib/util.js        通用数学与几何工具
  sim/sim.js         骑行物理与状态
  sim/input.js       键盘/触屏/手柄输入
  model/pelican.js   鹈鹕模型与骨骼动画（含 IK）
  model/bicycle.js   自行车建模与传动
  model/exporter.js  GLB 导出
  scene/world.js     地形、公路、海面、植被、道具
  scene/sky.js       大气与云
  scene/daycycle.js  日照曲线
  scene/env.js       光照、阴影、IBL
  scene/camera.js    机位导演与手柄跟随
  scene/postfx.js    后处理管线
  scene/spray.js     GPU 粒子（浪花、尘土、水雾）
  audio/audio.js     WebAudio 合成音效
  ui/stats.js        性能统计
  ui/hud.js          HUD 渲染与交互
```

## 说明

模型、贴图、音效全部由代码生成，没有使用任何外部素材；Three.js 以 r1xx 模块形式内联进产物。
