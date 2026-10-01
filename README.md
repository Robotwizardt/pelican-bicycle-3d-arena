# 🐦 鹈鹕骑自行车 3D · 九模型同题竞技场

同一条题目，九个大模型各自从零写出一个「鹈鹕骑自行车」的 Three.js 程序化 3D 页面，
自行完成建模、交互、部署，然后自己把访问链接交出来。九个页面放在同一个仓库里。

共两套 prompt、分三批跑（见 §二）：

- **第一批 4 个**（2026-09-30 05:11 → 09:59 UTC）：原本分散在三个 GitHub 仓库和一个 dataecho
  临时站点上，已合并进本仓库（原仓库 `pelican-ride-3d`、`pelican-bicycle-3d-deepseek-v4.1-flash`、
  `pelican-bicycle-3d-claude-opus-5-5` 与那个临时站点均已废弃）。
- **第二批 4 个**（同日 12:39 → 15:56 UTC）：带着新 prompt 跑的，产出直接提交到本仓库。
- **第三批 1 个**（次日 23:02 → 00:14 UTC）：用第二批**逐字相同**的 prompt 补跑的一个
  （`cn:glm-5.3`），产出同样直接提交到本仓库。

- **落地页（九页入口）**：https://robotwizardt.github.io/pelican-bicycle-3d-arena/
- 仓库：https://github.com/Robotwizardt/pelican-bicycle-3d-arena

---

## 一、结果页面

| # | 模型 | 页面（GitHub Pages） | 页面标题 |
|---|---|---|---|
| 1 | `step-5-preview`（阶跃星辰） | https://robotwizardt.github.io/pelican-bicycle-3d-arena/pages/step-5-preview/ | 鹈鹕骑行日记 · Pelican Ride 3D |
| 2 | `gpt-6-astra` | https://robotwizardt.github.io/pelican-bicycle-3d-arena/pages/gpt-6-astra/ | Pelican Post · 骑进海风里 |
| 3 | `cn:deepseek-v4.1-flash` | https://robotwizardt.github.io/pelican-bicycle-3d-arena/pages/deepseek-v4.1-flash/ | 鹈鹕骑士 3D · Pelican Rider |
| 4 | `claude-opus-5-5` | https://robotwizardt.github.io/pelican-bicycle-3d-arena/pages/claude-opus-5-5/ | 鹈鹕骑自行车 · Pelican on a Bicycle 3D |
| 5 | `cn:hy4-preview` | https://robotwizardt.github.io/pelican-bicycle-3d-arena/pages/pelican-bicycle-3d-hy4-preview/ | 鹈鹕骑自行车 · Pelican Rides a Bicycle |
| 6 | `grok-4.7` | https://robotwizardt.github.io/pelican-bicycle-3d-arena/pages/pelican-bicycle-3d-grok-4.7/ | 鹈鹕骑车 · grok-4.7 |
| 7 | `kimi-k3` | https://robotwizardt.github.io/pelican-bicycle-3d-arena/pages/pelican-bicycle-3d-kimi-k3/ | 鹈鹕快递员 · Pelican Courier 3D |
| 8 | `gpt-5.6-sol` ⚠️ | https://robotwizardt.github.io/pelican-bicycle-3d-arena/pages/pelican-bicycle-3d-gpt-5.6-sol/ | Pelican Velocity — 潮汐骑行竞技场 |
| 9 | `cn:glm-5.3` | https://robotwizardt.github.io/pelican-bicycle-3d-arena/pages/pelican-bicycle-3d-cn-glm-5.3/ | Pelican Rider — 鹈鹕骑行 · 3D |

> 顺序 = 会话开始时间（第一批 UTC 2026-09-30 05:11 → 09:59，第二批 12:39 → 13:14，第三批次日 23:02 → 00:14）。
> ⚠️ #8 `gpt-5.6-sol` 那一轮**模型被降智**，页面能打开但水平不作数，**不计入对比**，仅作留档。
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

**#5 / #6 / #7 / #8（`cn:hy4-preview`、`grok-4.7`、`kimi-k3`、`gpt-5.6-sol`）** —— 同日 12:39 UTC 跑的
第二批，四个会话收到的 prompt **逐字完全一致**（已用 md5 对过四份 transcript 的首条 user 消息）：

```
生成一个鹈鹕骑自行车的 3D 页面，尽可能把你所有的能力全部都用上。然后上传到 CDN，把访问链接给我。

新建文件夹 C:/Users/admin/pi-cwd-20260916/pelican-bicycle-3d-arena/pages/pelican-bicycle-3d-<你的模型名>/ 来执行，所有产出都写在这个新文件夹里，入口是它的 index.html，不需要构建步骤就能直接打开。

这个题目我之前已经让别的模型做过四版，成果就在 pages/ 下的另外四个文件夹里。本次全程不要读取、列出、搜索那四个文件夹里的任何内容，也不要看我的历史会话记录和我在网上发布的那四页——完全按你自己的思路写。除此之外联网随便用，教程素材都可以查。

另外：这个目录已经在一个发布到 GitHub Pages 的 git 仓库里。不要 git init，不要新建仓库或子仓库，也不要在文件夹里留 .git。发布就直接把你自己的文件夹 commit 并 push 到当前仓库（只 add 你自己的文件夹，不要改动或提交其他文件）；如果没有推送权限或推送失败，停下来告诉我，不要另建仓库。

拿不准的地方按你自己的判断做。
```

比第一批多了四条约束，都是冲着“合并进一个仓库后”这个新处境加的：

| 约束 | 为什么加 |
|---|---|
| 写死落点路径 `pages/pelican-bicycle-3d-<模型名>/` | 4 个原目录已收进竞技场的 `pages/` 下，不写死就会建到别处等人工搬 |
| 不许读那四个文件夹 / 历史会话 / 已发布页面 | 第一批是背靠背跑的、天然互为盲盒；第二批跟第一批同机同日，不堵就会看到别人的代码 |
| 不要 `git init`、不要建仓库，直接推当前仓库 | 第一批里三个是自建 GitHub 仓库发布的（另一个用 dataecho 临时站）；现在已有 Pages 仓库，再建会多出一堆仓库，而且嵌套 `.git` 会让外层 `git add` 只登记一个 gitlink、页面文件进不了仓库 |
| 只 add 自己的文件夹 | 防止它顺手改了落地页/README，或把无关文件一起提交 |

> 代价说明：这条 prompt 把“发布到 CDN”具体化成了“推当前仓库”，而第一批里
> `gpt-6-astra` 是用临时托管站发布、`step-5-preview` 是用自建仓库发布的 ——
> 两批的发布路径不完全可比，看结果时以页面本身为准。

---

### 第三批（#9）复用的就是上面这一份

`cn:glm-5.3` 收到的是**第二批那段的原样复制**，含那句已经过时的「已经让别的模型做过**四版**、
成果就在 `pages/` 下的另外**四个**文件夹里」（当时实际已经有 8 个页面了）。
五个会话的首条 user 消息 md5 完全相同：`252383107a76066abc5a6027dc8765d8`（511 字符）。
它没被过时描述带偏：其他 8 个页面的目录名在它整份 24.9 MB 的会话里一次都没出现过。
另外它把模型名里的冒号自己洗成了连字符（`cn:glm-5.3` → `pages/pelican-bicycle-3d-cn-glm-5.3/`），
因为 Windows 目录名不允许 `:`。

---

## 三、耗时、token 与费用

统计来源：pi-web 本地会话库 `~/.pi/agent/sessions/--C--Users-admin-pi-cwd-20260916--/`，
逐个 assistant message 的 `usage` 字段累加，耗时按首尾消息时间戳之差（UTC 墙上时间）。

| 模型 | 会话 ID | 耗时 | 总 token（含缓存读） | 非缓存 token（in+out） | 缓存读取 | 助手轮次 |
|---|---|---|---|---|---|---|
| `step-5-preview` | `01a0f0b9-fe26-755a-a8bf-2c87cef89ad3` | **74.1 min** ※ | 12,823,384 | 906,584 | 11,916,800 | 248 |
| `gpt-6-astra` | `01a0f1bc-7351-755a-a8bf-2c9346050731` | **47.5 min** | 2,867,749 | 423,913 | 2,443,836 | 78 |
| `cn:deepseek-v4.1-flash` | `01a0f1be-a4d7-755a-a8bf-2c95daae3609` | **93.1 min** | 22,900,589 | 920,301 | 21,980,288 | 388 |
| `claude-opus-5-5` | `01a0f1c1-3a7b-755a-a8bf-2c9988c01b4d` | **54.8 min** | 4,855,306 | 582,400 | 4,272,906 | 93 |
| `cn:hy4-preview` | `01a0f253-7eb5-7413-8032-34241212a06c` | **197.2 min** | 15,762,706 | 10,910,482 | 4,852,224 | 266 |
| `grok-4.7` | `01a0f253-e618-7413-8032-342646eda5b6` | **52.5 min** | 6,257,157 | 776,197 | 5,480,960 | 78 |
| `kimi-k3` | `01a0f254-1db0-7413-8032-34284369e49f` | **44.6 min** | 1,593,545 | 102,727 | 1,490,818 | 35 |
| `gpt-5.6-sol` ⚠️ | `01a0f273-b1a7-7413-8032-342d8c4c9a52` | **12.3 min** | 957,424 | 64,123 | 893,301 | 30 |
| `cn:glm-5.3` | `01a0f48d-d51e-7413-8032-34301b1c77b1` | **72.6 min** | 10,714,172 | 688,281 | 10,025,891 | 245 |

※ `step-5-preview` 的 74.1 分钟是**纯建站任务**耗时（05:11:56 → 06:26:03 UTC，
结束时已给出可用链接）。之后用户又追问了 3 轮「CDN 到底是怎么发布的」，会话拖到
09:10:31 UTC 才结束，含追问的整段为 238.6 min、总 token 12,823,384。
表中其余数字均为含追问的整段会话值；若只看建站任务，该会话为 12,110,890 / 637,738。

九个会话耗时各段相加 **648.7 min ≈ 10.8 h**（第一批四个 269.5 min + 第二批四个 306.6 min + 第三批 72.6 min）。
各会话各自独立计时，批内有重叠，不是墙上时间跨度：
第一批为 05:11:56 → 11:29:44 UTC（跨度 6.3 h），第二批为 12:39:13 → 15:56:23 UTC（跨度 3.3 h），
第三批为 2026-09-30 23:02:10 → 2026-10-01 00:14:44 UTC（跨度 1.2 h）。

⚠️ 第 8 行 `gpt-5.6-sol` 那一轮模型被降智（见 §四 · 8），数字只作留档，不计入任何对比。

### 明细拆分

| 模型 | input | output | reasoning | cacheRead |
|---|---|---|---|---|
| `step-5-preview` | 675,882 | 230,702 | 0 | 11,916,800 |
| `gpt-6-astra` | 371,769 | 52,144 | 18,416 | 2,443,836 |
| `cn:deepseek-v4.1-flash` | 453,709 | 466,592 | 263,136 | 21,980,288 |
| `claude-opus-5-5` | 517,845 | 64,555 | 0 | 4,272,906 |
| `cn:hy4-preview` | 10,476,560 | 433,922 | 282,232 | 4,852,224 |
| `grok-4.7` | 601,391 | 174,806 | 126,106 | 5,480,960 |
| `kimi-k3` | 69,003 | 33,724 | 13,006 | 1,490,818 |
| `gpt-5.6-sol` ⚠️ | 35,179 | 28,944 | 3,455 | 893,301 |
| `cn:glm-5.3` | 548,387 | 139,894 | 85,083 | 10,025,891 |

### 费用总表（官方 API 定价 · 仅第一批 1–4）

按各模型**官方价目表**的单价 × 上表实际 usage 计算，单位 USD。第二批的费用口径不同，单列在下。

| 模型 | input | output | cacheRead | 主会话费用 | 子代理 | 合计 |
|---|---|---|---|---|---|---|
| `step-5-preview` | $1.00 | $2.70 | $0.05 | **$1.89** | — | **$1.89** |
| `gpt-6-astra` | $10.00 | $50.00 | $1.00 | **$8.77** | $3.91 | **$12.68** |
| `cn:deepseek-v4.1-flash` | ¥1.00 ※ | ¥4.00 ※ | ¥0.02 ※ | **$0.44** | — | **$0.44** |
| `claude-opus-5-5` | $4.00 | $20.00 | $0.20 | **$4.22** | $0.15 | **$4.36** |
| **合计** | | | | **$15.32** | **$4.05** | **$19.37** |

单价单位：美元 / 百万 tokens。※ DeepSeek 官方以人民币计价且分峰谷两档，详见下节拆解。

### 费用（第二批 5–8 ＋ 第三批 9 · provider 记账）

第二批和第三批这五家的费用**没有按官方价目表重算**，而是直接汇总各 provider 在 transcript 里
记录的 `usage.cost.total` —— 它们分别跑在本地代理（workbuddy）和中转站（`api.laogou.org`、`cc`）上，
官方单价未必等于实际计费口径，硬套反而失真。这也意味着**两批不能横向比价**。

| 模型 | input | output | cacheRead | 费用 | 每轮成本 | 每百万 token |
|---|---|---|---|---|---|---|
| `cn:hy4-preview` | 10,476,560 | 433,922 | 4,852,224 | **$10.0265** | $0.0377 | $0.636 |
| `grok-4.7` | 601,391 | 174,806 | 5,480,960 | **$4.9921** | $0.0640 | $0.798 |
| `kimi-k3` | 69,003 | 33,724 | 1,490,818 | **$1.1601** | $0.0332 | $0.728 |
| `gpt-5.6-sol` ⚠️ | 35,179 | 28,944 | 893,301 | **$2.9817** | $0.0994 | $3.114 |
| `cn:glm-5.3` | 548,387 | 139,894 | 10,025,891 | **$3.9900** | $0.0163 | $0.372 |
| **合计** | 11,730,520 | 811,290 | 22,743,194 | **$23.15** | | |

- ⚠️ `gpt-5.6-sol` 那一轮被降智，这一行只作留档，不要拿去比。
- 四个新会话里另有 17 次 `cc/gpt-6-sol` 的调用（`kimi-k3` 会话 10 次、`gpt-5.6-sol` 会话 7 次）
  `usage` 全为 0 —— 那是编排用的空跑，不产生费用，也未计入轮次。
- **全场合计：主会话 $38.47，含子代理 $42.52**（第二、三批无子代理）。
- `cn:glm-5.3` 走 workbuddy 本地代理，登记单价 $1.4 / $4.4 / $0.26（输入 / 输出 / 缓存读），
  `usage.cost.total` 逐条相加为 $0.7677 + $0.6155 + $2.6067 = **$3.9900**，与按登记单价重算分毫不差；
  它也是这五个里每轮、每百万 token 最便宜的一个（$0.0163 / $0.372）。

#### 按 token 类型的费用拆解

| 模型 | input | output | cacheRead | 小计 |
|---|---|---|---|---|
| `step-5-preview` | 675,882 × $1.00 = $0.676 | 230,702 × $2.70 = $0.623 | 11,916,800 × $0.05 = $0.596 | **$1.895** |
| `gpt-6-astra` | 371,769 × $10 = $3.718 | 52,144 × $50 = $2.607 | 2,443,836 × $1.00 = $2.444 | **$8.769** |
| `cn:deepseek-v4.1-flash` | 空闲 435,334×¥1 + 高峰 18,375×¥2 = ¥0.472 | 空闲 435,076×¥4 + 高峰 31,516×¥8 = ¥1.992 | 空闲 21,443,328×¥0.02 + 高峰 536,960×¥0.04 = ¥0.450 | **¥2.915 ≈ $0.437** |
| `claude-opus-5-5` | 517,845 × $4.00 = $2.071 | 64,555 × $20 = $1.291 | 4,272,906 × $0.20 = $0.855 | **$4.217** |

#### 单位成本对比

| 模型 | 每轮成本 | 每百万 token 成本 | 相对最便宜 |
|---|---|---|---|
| `cn:deepseek-v4.1-flash` | $0.00113 | **$0.019** | 1.00× |
| `step-5-preview` | $0.00764 | $0.148 | 7.7× |
| `claude-opus-5-5` | $0.04534 | $0.869 | 45.5× |
| `gpt-6-astra` | $0.11242 | $3.058 | **160×** |

`gpt-6-astra` 每百万 token 比 deepseek 贵约 160 倍；而 deepseek 跑了 388 轮、
总 token 最多（2290 万），**总花费反而最低**。token 数和花费完全是两回事 ——
这正是把两者都列出来的原因。

#### 子代理开销（独立会话，未计入上表）

`gpt-6-astra` 与 `claude-opus-5-5` 在过程中派了子代理，它们是**各自独立的会话**，
token 不并入主会话，但钱确实花了：

| 主会话 | 子代理 | 跑在哪个模型 | 费用 |
|---|---|---|---|
| `gpt-6-astra` | 3 个：`01a0f1c1-13ff` 造骑手与自行车、`01a0f1c2-2d93` 造海岸岛屿环境、`01a0f1d8-c0ac` 交互审查 | 全部 `gpt-6-astra` | $1.82 + $1.59 + $0.49 = **$3.91** |
| `claude-opus-5-5` | 7 个：6 轮视觉审查 + 1 次截图 | `cn:glm-5.3` × 6、`gpt-6-sol` × 1 | **$0.15** |

注意 `claude-opus-5-5` 那 6 轮视觉审查**不是它自己做的**，是派给 `cn:glm-5.3` 做的 ——
所以这 $0.15 严格说是「另一个模型的钱」。`step-5-preview` 和 `cn:deepseek-v4.1-flash`
全程单干，没有子代理。

### 口径说明

- **总 token（含缓存读）** = `usage.totalTokens` 累加，即 input + output + cacheRead。
  第一批四个会话都是长上下文反复重发，缓存读占了 85%–96%，所以这个数看着很唬人；
  第二批的 `cn:hy4-preview` 是个反例 —— 它的网关几乎没命中缓存（缓存读只占 31%，
  input 高达 1047 万），于是净 token 冲到 1091 万，为全场最高，费用也跟着顶到 $10.03。
- **非缓存 token** = input + output，不含 `cacheRead`，更接近"模型真正处理了多少新内容"。
- 两者都写，是因为单看任何一个都会误导：只看总量会以为 deepseek 烧了 2290 万，
  但其中 2198 万是它自己反复重发的缓存；只看净量又会忽略单价差异
  （`gpt-6-astra` 净量最低仅 42 万，却是最贵的一档，$3.06/百万 token）。
- 九个会话均在同一台机器上跑，第一批、第二批都在 2026-09-30 当天，第三批跨到 10-01 凌晨；
  批内可横向比较，但两套费用口径不同（官方定价 vs provider 记账），**跨越口径比单价没有意义**。
- 时间戳为 UTC，北京时间 = 表中 +8h（第一批：`gpt-6-astra` 本地 17:54 → 18:41；
  第二批：`cn:hy4-preview` 本地 20:39 → 23:56；第三批：`cn:glm-5.3` 本地 10-01 07:02 → 08:14）。

**费用口径：**

- 费用按**官方价目表单价**计算，**不等于你实际付的账单**。四个模型里只有 `step-5-preview`
  是直连官方端点（`api.stepfun.com`）；`gpt-6-astra` 与 `claude-opus-5-5` 走的是
  `api.laogou.org` 中转；`cn:deepseek-v4.1-flash` 走本地代理（`127.0.0.1:7863`，workbuddy）。
  中转商可能加价或打折，所以这里算的是「如果按官方价目表买，要花多少钱」。
- 官方单价与 `~/.pi/agent/models.json` 里登记的 `cost` 字段**完全一致**（StepFun
  $1 / $0.05 / $2.70，OpenAI $10 / $1 / $12.5 / $50，Anthropic $4 / $0.20 / $5 / $20，
  DeepSeek 折合 $0.15 / $0.003 / $0.60），两处独立来源交叉验证通过。
- **没有触发任何长上下文加价档**：四个会话的单请求最大 prompt 分别为
  95,936 / 69,214 / 109,186 / 85,916 tokens，全部低于 GPT-6 Astra 的 272K 加价线
  （超出后输入 2×、输出 1.5×）和 Anthropic 的 200K 档。也就是说全程平价，没有隐藏倍率。
- **`claude-opus-5-5` 的费用是手算的**：transcript 里它 93 次请求的 `cost` 记录全是
  `{"total":0}` —— 该 provider 的 `cost` 配置是在会话末尾才补进 `models.json` 的
  （文件 mtime 2026-09-30 18:53:28 +0800 = 10:53:28 UTC，会话结束于 10:54:13 UTC），
  所以运行时算出来的费用被记成了 0。这一行不取自 transcript，而是用官方单价 × 实际 usage 重算。
- **DeepSeek 是峰谷定价**：官方以人民币计价，工作日北京时间 09:00–12:00、14:00–18:00
  为高峰（价目翻倍）。该会话 09:56–11:29 UTC = 北京 17:56–19:29，只有 17:56–17:59
  这 3.4 分钟落在高峰，命中 20/388 次请求（5.15%）。已按每条消息的时间戳逐条拆成
  峰/谷两段计价（拆分明细见上节表格）。折算汇率取 **¥1 = $0.15**
  （与 `models.json` 登记值一致）；假定 2026-09-30（周三）不是法定节假日 ——
  若当日是假日则全部按空闲计，费用为 $0.391，差额仅 $0.047。
- 主表的 token 与费用**都只统计主会话**，子代理单列，避免 token 列与费用列口径不一致。
- 同日 11:32 UTC 另有一个顶层会话（`01a0f216-1ac2`，231 条消息）同时引用了这四个目录，
  但那是另一个话题，不计入上表。

---

## 四、九个页面分别是什么

### 1. `step-5-preview` — 鹈鹕骑行日记 · Pelican Ride 3D

`pages/step-5-preview/`　耗时 74.1 min　12,823,384 token / 248 轮　费用 **$1.89**（无子代理）

戴水手帽、车筐里装鱼的鹈鹕骑复古公路车沿海岸公路前行。
全程序化建模（无任何外部模型/贴图）；两段式 IK 让脚掌贴合脚踏、身体随踏频起伏、
喉囊晃动、围巾飘动；黎明/正午/黄昏/夜晚四档昼夜 + 星空 + 潮汐雾 + 路灯与车灯光锥；
五机位（环绕/跟拍/侧面/正面/俯视）带缓动过渡；SVG 速度表遥测（速度/里程/踏频/FPS/三角形数）；
Web Audio 合成的车铃/风声/链条声；4 套整车涂装；移动端底部虚拟按键。

- 页面结构为多文件版：`index.html` + `app.js` + `three.min.js` + `OrbitControls.js`
- `pelican-ride.html` 是等价的 **672 KB 单文件版**（three.js 内联），离线双击可开
- 源码与构建脚本在 `src/`，回归截图在 `shots/`

### 2. `gpt-6-astra` — Pelican Post · 骑进海风里

`pages/gpt-6-astra/`　耗时 47.5 min　2,867,749 token / 78 轮　费用 **$12.68**（主会话 $8.77 + 子代理 $3.91）

中英双语的"海岛旅行杂志"风格页面：可交互的 3D 微缩海岛，灯塔、棕榈、帆船、海鸥、动态海面，
鹈鹕踩踏/车轮转动/围巾飘动，车篮装着鲜花。昼夜切换、速度 4–28 km/h、里程环线 1.2 km、
车铃与海浪声、一键导出 1800×1400 明信片 PNG。
Vite + Three.js 构建，附 10 项单元测试 / 23 项浏览器检查，`window.__pelican.status` 只读诊断接口。

- 页面为 `index.html` + `assets/`（JS/CSS）+ `fonts/`（本地 woff2），自包含无外部请求
- 源码在 `src/`，测试在 `tests/`，原 `publish.mjs` 发布脚本保留（原目标是 dataecho.ai）

### 3. `cn:deepseek-v4.1-flash` — 鹈鹕骑士 3D · Pelican Rider

`pages/deepseek-v4.1-flash/`　耗时 93.1 min　22,900,589 token / 388 轮　费用 **$0.44**（无子代理）

**单文件 740 KB、零外部请求**（three.js 全部内联）。程序化骨架：5 节颈、三段式双翼、
两段式双腿+蹼足、喙与喉囊、眼睑，每帧 IK 让翅膀搭车把、脚掌踩踏板；
自行车有辐条轮组（每轮 56 根辐条+花鼓+碟刹盘）、84 节带松弛变化的链条、变速器、货架木箱；
世界包含无限滚动海岸公路、FFT 风格海面着色器、单 draw call 体积云天空、实例化植被与 GPU 粒子；
HDR 半浮点 RT + 自研后处理（ACES/泛光/色散/晕影/颗粒/速度径向模糊）、PMREM 天空 IBL、级联阴影；
骑行物理（踏频/齿比/坡度/风阻/体力）、7 种机位、键盘+触屏+手柄、GLB 导出、5 种涂装。

- 页面：`index.html`（自包含单文件）
- 源码在 `src/`（25 个源文件），构建脚本 `build.mjs`，本地服务 `serve.mjs`

### 4. `claude-opus-5-5` — 鹈鹕骑自行车 · Pelican on a Bicycle 3D

`pages/claude-opus-5-5/`　耗时 54.8 min　4,855,306 token / 93 轮　费用 **$4.36**（主会话 $4.22 + 子代理 $0.15）

戴头盔系围巾的鹈鹕绕池塘兜圈：腿用 IK 踩踏板、翅膀用 IK 握车把，喉囊晃动、围巾飘动，
点头部会大叫掉羽毛、点自行车会按铃。起伏地形 + 环形公路 + 动态水波与荷花的池塘，
实例化树/草/花（草随风摆动）、路灯、云、远山、萤火虫、星空；物理天空昼夜循环，
黄昏偏暖、夜里路灯亮起带光晕、车灯亮起；辉光/暗角/胶片颗粒/车轮扬尘。
5 种相机（电影运镜/自由环绕/追尾/侧拍/鹈鹕视角）、加速减速滑行、截图、隐藏界面、
控制面板可改颜色/时间/画质；aria-live 读屏播报，尊重 `prefers-reduced-motion`。

- 页面：`index.html` + `js/`（8 个模块，源码即产物）
- **注意**：本页的 three.js 与 lil-gui 通过 jsDelivr CDN 的 importmap 加载，不是自包含的
- 生成过程用子代理做了 6 轮视觉审查；已知小瑕疵：头盔边缘下方能看到一小块头部、黄昏时天空顶部偏冷

### 5. `cn:hy4-preview` — 鹈鹕骑自行车 · Pelican Rides a Bicycle

`pages/pelican-bicycle-3d-hy4-preview/`　耗时 197.2 min　15,762,706 token / 266 轮　费用 **$10.03**（provider 记账，无子代理）

夜岛 + 昼夜循环 + 物理化骑行姿态。全场景运行时生成：地形、海浪、云、棕榈、羽毛质感、
天空散射与 IBL 都是算出来的，连车铃声也是代码合成的，无任何外部素材。
界面有暂停/昼夜/静音/车铃/叫一声/截图/隐藏界面/帮助，左侧面板可实时调参
（把翅膀张开、把时刻拖到黄昏），右侧状态面板显示骑手/翅膀/世界/渲染/色调映射/帧率/车速/里程/时刻/镜头/开销。

- 页面：`index.html`（526 行）+ `src/`（`audio` `bicycle` `effects` `main` `materials` `pelican` `postfx` `sky` `util` `world`）
- three.js 本地内置（`three.min.js`），无构建步骤，改文件即生效
- 本轮耗时最长（197.2 min）、净 token 最高（1091 万），且缓存几乎没命中

### 6. `grok-4.7` — 鹈鹕骑车 · grok-4.7

`pages/pelican-bicycle-3d-grok-4.7/`　耗时 52.5 min　6,257,157 token / 78 轮　费用 **$4.99**（provider 记账）

黄昏海岸的沙路上，一只美洲白鹈鹕骑着绿色城市车。场景、角色、车、声音全部程序化，
没有建模软件导出，也没有构建步骤。键位是八版里最全的：W/↑ 蹬、S/↓ 刹、A D 转向、Shift 冲刺、
空格车铃、F 振翅、V 叫一声、C 换镜头、N 入夜、R 回沙路、O 隐藏界面。

- 页面：`index.html` + `css/style.css` + `js/`（`audio` `bicycle` `main` `meshutil` `pelican` `world`）
- three.js r170（MIT）放在 `vendor/three.module.min.js`；因为是模块脚本，需网页服务器提供，`file://` 双击不行

### 7. `kimi-k3` — 鹈鹕快递员 · Pelican Courier 3D

`pages/pelican-bicycle-3d-kimi-k3/`　耗时 44.6 min　1,593,545 token / 35 轮　费用 **$1.16**（provider 记账）

唯一一版**有玩法**的：全程序化山谷里送小鱼干 —— 收集发光的小鱼干（小地图上青点），每 10 条触发庆祝；
橙色坡道冲上去就能起飞，空中按住 W 扑翼滑翔；昼夜切换后车头灯自动点亮，还能下雨。
Two-bone IK 实时吸附旋转脚踏；自研骑行物理（坡度加减速/滚动阻力/转向倾斜/坡道起跳/空中滑翔）；
值噪声地形与顶点着色、自定义天空渐变 shader、UnrealBloom 后处理、PCFSoft 阴影；
WebAudio 全合成音效（风声随速度滤波、踏板咔哒、拾取琶音、落地闷响）、2D Canvas 雷达小地图。

- 页面：`index.html` **单文件 44 KB**（+ `README.md`），全场体积最小、token 最省（净 10.3 万，全场最低）
- Three.js **r160 走 jsdelivr ESM**（importmap），需联网；已用 Playwright (Edge) 实机验证，控制台 0 报错

### 8. `gpt-5.6-sol` — Pelican Velocity — 潮汐骑行竞技场

`pages/pelican-bicycle-3d-gpt-5.6-sol/`　耗时 12.3 min　957,424 token / 30 轮　费用 **$2.98**（provider 记账）

暮色海岸竞速，有 FLIGHT DECK 骑行控制台（速度/圈速/里程/连击/巡航速度/太阳高度六项遥测）、
4 机位（追逐/环绕/电影/车载）、SPACE 腾跃、BOOST 加速、霓虹灯与速度线。

> ⚠️ **这一轮模型被降智**。12.3 分钟就交活，页面能打开，但水平不作数，
> **不计入对比**，仅作留档（对外引用请注明降智）。

- 页面：`index.html` + `app.js` + `styles.css` + `vendor/three.min.js` + `favicon.svg` + `preview-desktop.png`

### 9. `cn:glm-5.3` — Pelican Rider — 鹈鹕骑行 · 3D

`pages/pelican-bicycle-3d-cn-glm-5.3/`　耗时 72.6 min　10,714,172 token / 245 轮　费用 **$3.99**（provider 记账）

黄昏海面上的海岸公路，棕榈、路灯、车灯、星空与辉光随夜幕渐亮，鹈鹕的翅膀、喙与喉囊都是程序化建模。
右上角遥测 HUD 报车速／里程／踏频／风速／FPS／draw call，控制台可实时改巡航速度、海浪强度、
镜头距离与高度、云量、夜幕与辉光，还能导出 `.GLB`（另挂了 `VRButton`）。

- 页面：`index.html` **单文件 51 KB / 1051 行**（仓库里第二小的页面）
- three.js **0.160.0 走 jsDelivr ESM**（importmap）+ `EffectComposer` / `UnrealBloomPass` / `OutputPass` /
  `GLTFExporter` / `VRButton`，需联网；已用 Playwright (Edge) 实机验证：canvas 出画、画面在动、控制台 0 报错
  （唯一一条是浏览器去要 `robotwizardt.github.io/favicon.ico` 拿到 404，因为它没声明 favicon）
- 只有 1 条用户消息、245 轮；中途撞过着色器编译失败（`INVALID_OPERATION`），它自己修好了

---

## 五、目录结构

```
pelican-bicycle-3d-arena/
├── index.html                        落地页：九张卡片 + 九页入口
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
    ├── claude-opus-5-5/              （原仓库 pelican-bicycle-3d-claude-opus-5-5）
    │   ├── index.html
    │   └── js/                       8 个 ES 模块（源码即产物）
    ├── pelican-bicycle-3d-hy4-preview/       （第二批）
    │   ├── index.html                526 行
    │   ├── src/                      10 个 ES 模块
    │   └── three.min.js              本地内置 three.js
    ├── pelican-bicycle-3d-grok-4.7/          （第二批）
    │   ├── index.html  css/style.css
    │   ├── js/                       audio / bicycle / main / meshutil / pelican / world
    │   ├── vendor/three.module.min.js 本地内置 three.js r170
    │   └── README.md
    ├── pelican-bicycle-3d-kimi-k3/           （第二批）
    │   ├── index.html                44 KB 单文件（three.js 走 jsDelivr）
    │   └── README.md
    ├── pelican-bicycle-3d-gpt-5.6-sol/       （第二批，⚠️ 降智，不计入对比）
    │   ├── index.html  app.js  styles.css  favicon.svg
    │   ├── vendor/three.min.js      本地内置 three.js
    │   └── preview-desktop.png
    └── pelican-bicycle-3d-cn-glm-5.3/        （第三批）
        └── index.html                51 KB 单文件（three.js 走 jsDelivr）
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
6. **第二批 4 个是直接提交进本仓库的**（prompt 里就要求 push 到当前仓库），不是合并进来的，
   所以它们的 git 历史就是仓库自己的历史。同批还有一个 `pelican-bicycle-3d-claude-fable-5-1`，
   因 API 接口不稳定全程失败，只落下 `js/geometry.js`、`js/gl.js`、`js/math.js` 三个半成品，
   连 `index.html` 都没有，已删除，未收录。
7. **第三批 1 个也是直接提交进本仓库的**（同一份 prompt 里的同一条要求），
   落在 `pages/pelican-bicycle-3d-cn-glm-5.3/`，整个目录只有它自己的 `index.html`。

---

## 八、已知问题

- `claude-opus-5-5`、`kimi-k3`、`cn:glm-5.3` 的 three.js 走 jsDelivr（0.170.0 / r160 / 0.160.0），断网或被墙时打不开；其余六页的 three.js 都在仓库里。
- `step-5-preview` 与 `gpt-6-astra` 的页面在低端移动设备上会掉帧（shadow map + 后处理较重）。
- `deepseek-v4.1-flash` 单文件 740 KB，首次加载需要下载完整体积（gzip 后约 200 KB）。
- `gpt-5.6-sol` 那一版是降智产物，不要当基准引用；它的 `preview-desktop.png` 是它自己截的预览图。
- `cn:hy4-preview` 的网关缓存命中率很低，想重跑一遍的费用会很可观。
- `cn:hy4-preview` 与 `cn:glm-5.3` 都没声明 favicon，浏览器会去账号根要 `favicon.ico` 拿到 404（不影响画面，控制台里那条红字就是它）。
- jsDelivr 镜像的 `.html` 是 `text/plain`，只适合下载，不适合直接当页面入口。
